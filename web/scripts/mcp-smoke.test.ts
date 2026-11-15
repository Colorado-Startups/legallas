// SPDX-License-Identifier: Apache-2.0
// The legallas-mcp smoke end to end against a fake server (scripts/mcp-testkit.ts): every step of the local
// flow, production's public checks, the failures each check exists to catch, and that no token, secret or
// tool text reaches the printed table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MCP_ORIGIN } from './mcp-constants.ts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { zipStore } from '../mcp/zip.ts';
import { MCP_RESOURCE, SMOKE_CLIENT_NAME, TOOL_NAMES } from './mcp-constants.ts';
import { devVar, formatReport, type Report } from './mcp-flow.ts';
import { loadModule } from './load-module.ts';
import { CALL_ORDER, discoverOutcome, LOCAL_BASE, parseSmokeArgs, probeArgs, PROMPT_ARGS, runLocal, runProduction, toolNamesOk } from './mcp-smoke.ts';
import { kindCheckNames, perKind, fakeServer as testkitServer, type FakeOptions } from './mcp-testkit.ts';
import { authorizeUrl, registrationBody } from './mcp-oauth.ts';
import {
  auditBaseline,
  connectPageOk,
  localAuditProbe,
  originExpectation,
  PACKAGE_REFERENCE_ID,
  packageOutcome,
  rateLimitOutcome,
  refusedRegistration,
  TEAMS_REDIRECT,
} from './mcp-wave.ts';
import { looksLikeZip, readZip } from './mcp-zip.ts';

const TOOLS = {
  legallas_list_documents: { content: [{ type: 'text', text: '{"documents":[{"id":"doc-1","name":"Case text A"}]}' }], structuredContent: { documents: [{ id: 'doc-1', name: 'Case text A' }] } },
  legallas_search: { content: [{ type: 'text', text: '<case-record>Case text B</case-record>' }], structuredContent: { results: [] } },
  legallas_case_overview: { content: [{ type: 'text', text: 'Case text C' }], structuredContent: {} },
};

/** The shared fake, advertising client ID metadata documents as the real server does (mcp/oauth.ts); `asm` overrides. */
const fakeServer = (options: FakeOptions = {}) => testkitServer({ ...options, asm: { client_id_metadata_document_supported: true, ...options.asm } });

const outcomes = (report: Report) => Object.fromEntries(report.checks.map((c) => [c.name, c.outcome]));
const failures = (report: Report) => report.checks.filter((c) => c.outcome === 'fail').map((c) => c.name);

test('arguments: local by default, a local --base only, production fixed to the MCP origin', () => {
  const local = { mode: 'local', base: LOCAL_BASE, register: false, readOnly: false };
  assert.deepEqual(parseSmokeArgs([]), local);
  assert.deepEqual(parseSmokeArgs(['--local', '--base', 'http://127.0.0.1:9000/']), { ...local, base: 'http://127.0.0.1:9000' });
  const production = { mode: 'production', base: MCP_ORIGIN, register: false, readOnly: false };
  assert.deepEqual(parseSmokeArgs(['--production', '--base', 'http://localhost:1']), production);
  assert.deepEqual(parseSmokeArgs(['--production', '--register']), { ...production, register: true });
  assert.deepEqual(parseSmokeArgs(['--production', '--read-only']), { ...production, readOnly: true });
  assert.throws(() => parseSmokeArgs(['--production', '--register', '--read-only']), /contradict/);
  assert.throws(() => parseSmokeArgs(['--register']), /are for --production/);
  assert.throws(() => parseSmokeArgs(['--read-only']), /are for --production/);
  assert.throws(() => parseSmokeArgs(['--base', 'https://mcp.room.example.com']), /localhost/);
  assert.throws(() => parseSmokeArgs(['--nope']), /usage/);
});

test('tools/list: the nine tools, with or without the law search, and nothing else', () => {
  const nine = [
    'legallas_search',
    'legallas_case_overview',
    'legallas_list_documents',
    'legallas_get_document',
    'legallas_read_pages',
    'legallas_view_visual',
    'legallas_get_comments',
    'legallas_get_file',
    'legallas_template',
  ];
  assert.equal(toolNamesOk(nine), true);
  assert.equal(toolNamesOk([...nine, 'legallas_search_law']), true, 'the law library is on');
  assert.equal(toolNamesOk(nine.slice(1)), false, 'a contract tool is missing');
  assert.equal(toolNamesOk([...nine.slice(1), 'legallas_search_law']), false, 'the law search does not stand in for one');
  assert.equal(toolNamesOk([...nine, 'legallas_write']), false, 'an unknown tool');
  assert.equal(toolNamesOk([...nine, 'legallas_search_law', 'legallas_search_law']), false, 'listed twice');
});

test('probe arguments: document tools use a real id when one came back, a safe placeholder otherwise', () => {
  assert.deepEqual(probeArgs('legallas_get_document', 'doc-1'), { id: 'doc-1' });
  assert.deepEqual(probeArgs('legallas_read_pages', 'bad id!'), { id: 'smoke-missing-id', from: 1, to: 1 });
  assert.deepEqual(probeArgs('legallas_search', null), { query: 'agreement', limit: 3 });
  assert.deepEqual(probeArgs('legallas_get_comments', 'doc-1'), { id: 'doc-1' });
  assert.deepEqual(probeArgs('legallas_get_file', null), { id: 'smoke-missing-id' });
  assert.deepEqual(probeArgs('legallas_view_visual', 'doc-1'), {}, 'no id lists the binder');
});

test('calls: every contract tool once, so a tool added to the contract is called too', () => {
  assert.deepEqual([...CALL_ORDER].sort(), [...TOOL_NAMES].sort());
  assert.deepEqual(CALL_ORDER.slice(0, 2), ['legallas_list_documents', 'legallas_search'], 'an id first');
});

test('local: a tool still answering the contract stub\'s not_available fails its call check only', async () => {
  const stub = { isError: true, content: [{ type: 'text', text: 'not_available: This tool is not available yet.' }] };
  const report = await runLocal(fakeServer({ tools: { ...TOOLS, legallas_get_file: stub } }).fetcher, LOCAL_BASE);
  assert.deepEqual(failures(report), ['call_legallas_get_file', ...perKind('call_get_file')]);
  assert.match(formatReport(report), /call_legallas_get_file\s+code not_available/);
});

test('local: the whole flow passes, on localhost only, and the table holds no token, secret or tool text', async () => {
  const fake = fakeServer({ tools: TOOLS, law: true });
  const report = await runLocal(fake.fetcher, LOCAL_BASE, undefined, { audit: fake.audit });
  assert.deepEqual(failures(report), [], formatReport(report));
  assert.deepEqual(report.checks.filter((c) => c.outcome === 'skip'), [], formatReport(report));
  assert.deepEqual(Object.keys(outcomes(report)), [
    'challenge_401', 'protected_resource', 'authorization_server',
    'register_public', 'register_confidential', 'register_refused_redirect',
    'authorize_consent_page', 'approve_consent', 'token_exchange', 'client_id_metadata_documents',
    'register_teams_confidential', 'register_apim_public', 'register_harvey', 'register_harvey_lookalike_refused',
    'refresh_rotates', 'refresh_rotated_works', 'refresh_reuse_refused', 'wrong_resource_refused',
    'mcp_initialize_2025', 'mcp_discover_2026', 'mcp_tools_list', 'mcp_prompts_list', 'mcp_prompts_get', 'mcp_origin_unlisted',
    'call_legallas_list_documents', 'call_legallas_search', 'call_legallas_case_overview', 'call_legallas_get_document', 'call_legallas_read_pages',
    'call_legallas_view_visual', 'call_legallas_get_comments', 'call_legallas_get_file', 'call_legallas_template',
    'revoke_grant', 'revoked_access_refused', 'revoked_refresh_refused', 'revoke_audit_disconnect',
    'no_resource_token', ...kindCheckNames(),
    'connect_page', 'copilot_package_zip', 'register_rate_limited',
  ]);
  assert.ok(fake.requests.every((url) => url.startsWith(`${LOCAL_BASE}/`)), 'the production metadata URL was mapped onto localhost');
  const table = formatReport(report);
  assert.doesNotMatch(table, /SECRETVALUE|Case text/);
  assert.match(table, /code not_found/);
  assert.equal(fake.grants.every((g) => g.revoked), true);
});

test('prompts: the nine prompts with their arguments pass locally, anything else fails; production skips with its reason', async () => {
  const real = await loadModule<{ PROMPT_ARGUMENTS: Record<string, string[]> }>('mcp/prompts.ts');
  assert.deepEqual(PROMPT_ARGS, real.PROMPT_ARGUMENTS, 'the smoke mirrors mcp/prompts.ts');
  const run = async (prompts: { name: string; arguments?: { name: string; required: boolean }[] }[]) => failures(await runLocal(fakeServer({ tools: TOOLS, prompts }).fetcher, LOCAL_BASE));
  assert.deepEqual(await run([{ name: 'matter_briefing' }]), ['mcp_prompts_list', 'mcp_prompts_get'], 'two prompts missing');
  const kits = Object.keys(PROMPT_ARGS).slice(3).map((name) => ({ name }));
  assert.deepEqual(await run([{ name: 'matter_briefing' }, { name: 'violation_proof' }, { name: 'topic_chronology', arguments: [{ name: 'topic', required: true }] }, ...kits]), ['mcp_prompts_list'], 'an argument missing');
  const production = (await runProduction(fakeServer().fetcher, { readOnly: true })).checks.at(-1);
  assert.deepEqual(production, { name: 'mcp_prompts_list', outcome: 'skip', detail: 'needs a member grant; listed by the local run' });
});

test('local: a tool that is not built, or failing, fails its call check only', async () => {
  const fake = fakeServer({ tools: { ...TOOLS, legallas_search: { isError: true, content: [{ type: 'text', text: 'not_implemented: legallas_search is not built yet.' }] } } });
  const report = await runLocal(fake.fetcher, LOCAL_BASE);
  assert.deepEqual(failures(report), ['call_legallas_search', ...perKind('call_search')]);
  assert.match(formatReport(report), /call_legallas_search\s+code not_implemented/);
});

test('local: a server without S256 or without the server under test fails at discovery and stops', async () => {
  const noS256 = await runLocal(fakeServer({ asm: { code_challenge_methods_supported: ['plain'] } }).fetcher, LOCAL_BASE);
  assert.equal(outcomes(noS256).authorization_server, 'fail');
  assert.equal(noS256.checks.at(-1)!.name, 'authorization_server', 'nothing runs after it');
  const offsite = fakeServer({ asm: { token_endpoint: 'https://evil.example/token' } });
  const report = await runLocal(offsite.fetcher, LOCAL_BASE);
  assert.ok(failures(report).length > 0);
  assert.ok(offsite.requests.every((url) => !url.startsWith('https://evil.example')), 'no request left the server under test');
});

test('local under wrangler dev: portless endpoints map onto the base; the missing RFC 9728 document is a skip', async () => {
  const fake = fakeServer({ wranglerDev: true, tools: TOOLS });
  const report = await runLocal(fake.fetcher, 'http://localhost:8791');
  assert.deepEqual(failures(report), [], formatReport(report));
  assert.equal(outcomes(report).protected_resource, 'skip');
  assert.match(formatReport(report), /challenge_401\s+status 401, resource_metadata missing/);
  assert.ok(fake.requests.every((url) => url.startsWith('http://localhost:8791/')), 'every request went to the local base');
});

test('local with MCP_DEV_ORIGIN set: a missing RFC 9728 document fails and stops', async () => {
  const report = await runLocal(fakeServer({ wranglerDev: true }).fetcher, 'http://localhost:8791', undefined, { expectProtectedResource: true });
  assert.equal(report.checks.at(-1)!.name, 'protected_resource');
  assert.equal(report.checks.at(-1)!.outcome, 'fail');
  assert.match(report.checks.at(-1)!.detail, /MCP_DEV_ORIGIN/);
});

test('MCP_DEV_ORIGIN is read from the environment, else from .dev.vars', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devvars-'));
  const file = join(dir, '.dev.vars');
  await writeFile(file, '# comment\nALLOW_DEV_IDENTITY=1\nMCP_DEV_ORIGIN="http://localhost:8790"\nEMPTY=\n');
  assert.equal(await devVar('MCP_DEV_ORIGIN', {}, file), 'http://localhost:8790');
  assert.equal(await devVar('MCP_DEV_ORIGIN', { MCP_DEV_ORIGIN: 'http://127.0.0.1:1' }, file), 'http://127.0.0.1:1');
  assert.equal(await devVar('EMPTY', {}, file), null);
  assert.equal(await devVar('MCP_DEV_ORIGIN', {}, join(dir, 'missing')), null);
  await rm(dir, { recursive: true });
});

test('production: a missing RFC 9728 document is a failure, never a skip', async () => {
  const report = await runProduction(fakeServer({ wranglerDev: true }).fetcher);
  assert.equal(outcomes(report).protected_resource, 'fail');
});

test('local: nothing listening is one clear failure', async () => {
  const down = async () => {
    throw new TypeError('fetch failed');
  };
  const report = await runLocal(down, LOCAL_BASE);
  assert.deepEqual(report.checks, [{ name: 'discovery', outcome: 'fail', detail: 'error fetch failed' }]);
});

test('production: discovery, the 401, the refused redirect, the Microsoft and Harvey registrations and /connect', async () => {
  const fake = fakeServer();
  const report = await runProduction(fake.fetcher);
  assert.deepEqual(failures(report), [], formatReport(report));
  assert.deepEqual(Object.keys(outcomes(report)), [
    'protected_resource', 'authorization_server', 'client_id_metadata_documents', 'challenge_401', 'register_refused_redirect',
    'register_teams_confidential', 'register_apim_public', 'register_harvey', 'register_harvey_lookalike_refused',
    'connect_page', 'copilot_package_zip', 'mcp_prompts_list',
  ]);
  assert.ok(fake.requests.every((url) => url.startsWith(`${MCP_ORIGIN}/`)));
  assert.ok(!fake.requests.some((url) => url.includes('/authorize') || url.includes('/token')), 'production never tries consent or tokens');
  assert.equal(fake.requests.filter((url) => url.endsWith('/register')).length, 5, 'under REGISTER_LIMIT (10 a minute)');
});

test('production: every client it registers is named SMOKE_CLIENT_NAME, so the daily sweep deletes it', async () => {
  for (const options of [{}, { register: true }]) {
    const fake = fakeServer();
    const accepted: unknown[] = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const response = await fake.fetcher(input, init);
      if (String(input).endsWith('/register') && response.status === 201) accepted.push(JSON.parse(String(init?.body)).client_name);
      return response;
    };
    const report = await runProduction(fetcher, options);
    assert.deepEqual(failures(report), [], formatReport(report));
    assert.deepEqual(accepted, Array((options as { register?: boolean }).register ? 4 : 3).fill(SMOKE_CLIENT_NAME), JSON.stringify(options));
  }
});

test('production --read-only: nothing is registered; the refused redirect and /connect still run', async () => {
  const fake = fakeServer();
  const report = await runProduction(fake.fetcher, { readOnly: true });
  assert.deepEqual(failures(report), []);
  assert.deepEqual(Object.keys(outcomes(report)), ['protected_resource', 'authorization_server', 'client_id_metadata_documents', 'challenge_401', 'register_refused_redirect', 'connect_page', 'copilot_package_zip', 'mcp_prompts_list']);
});

test('production --register: also a public client with Claude\'s redirect', async () => {
  const report = await runProduction(fakeServer().fetcher, { register: true });
  assert.deepEqual(failures(report), []);
  assert.deepEqual(Object.keys(outcomes(report)).slice(4, 6), ['register_refused_redirect', 'register_public_claude']);
});

test('client ID metadata documents: advertised passes; missing or not true fails in both modes, without echoing the value', async () => {
  for (const value of [undefined, false, 'yes']) {
    const asm = { client_id_metadata_document_supported: value };
    const production = await runProduction(fakeServer({ asm }).fetcher, { readOnly: true });
    assert.deepEqual(failures(production), ['client_id_metadata_documents'], `production, ${value}`);
    const local = await runLocal(fakeServer({ tools: TOOLS, asm }).fetcher, LOCAL_BASE);
    assert.deepEqual(failures(local), ['client_id_metadata_documents'], `local, ${value}`);
    assert.equal(outcomes(local).register_teams_confidential, 'pass', 'the flow carries on after it');
    const detail = production.checks.find((c) => c.name === 'client_id_metadata_documents')!.detail;
    assert.equal(detail, `client_id_metadata_document_supported ${value === undefined ? 'missing' : 'not true'}`);
  }
  const passed = await runProduction(fakeServer().fetcher, { readOnly: true });
  assert.match(formatReport(passed), /PASS  client_id_metadata_documents\s+client_id_metadata_document_supported true/);
});

test('production: an endpoint off the MCP origin fails discovery and nothing is sent to it', async () => {
  for (const asm of [{ registration_endpoint: 'https://evil.example/register' }, { token_endpoint: 'https://evil.example/token' }]) {
    const fake = fakeServer({ asm });
    const report = await runProduction(fake.fetcher, { register: true });
    assert.equal(outcomes(report).authorization_server, 'fail');
    assert.match(formatReport(report), /endpoints off origin/);
    assert.equal(report.checks.some((c) => c.name.startsWith('register_')), false, 'no registration attempted');
    assert.ok(fake.requests.every((url) => url.startsWith(`${MCP_ORIGIN}/`)), 'no request left the production origin');
  }
});

test('2026-07-28: SKIP only when the server says it does not offer it; FAIL on 500, 401 or no reply', () => {
  const reply = (error: string | null, result: Record<string, unknown> | null = null, agreed: string | null = null) => ({ error, result, agreed });
  assert.equal(discoverOutcome(reply(null, { supportedVersions: ['2026-07-28'] }, '2026-07-28')), true);
  assert.equal(discoverOutcome(reply('rpc_-32601')), null, 'method not found');
  assert.equal(discoverOutcome(reply('rpc_-32022')), null, 'unsupported protocol version');
  assert.equal(discoverOutcome(reply(null, { supportedVersions: ['2027-01-01'] })), null, 'offers only other revisions');
  for (const error of ['http_500', 'http_401', 'no_reply', 'rpc_-32603']) assert.equal(discoverOutcome(reply(error)), false, error);
  assert.equal(discoverOutcome(reply(null, {})), false, 'a reply without supportedVersions');
});

test('local: an issuer that is not the resource\'s authorization server fails and stops', async () => {
  const report = await runLocal(fakeServer({ asm: { issuer: 'https://other.example' } }).fetcher, LOCAL_BASE);
  assert.equal(report.checks.at(-1)!.name, 'authorization_server');
  assert.match(report.checks.at(-1)!.detail, /issuer mismatch/);
});

test('local: a missing iss fails when the metadata promises it, and passes when it does not', async () => {
  const promised = await runLocal(fakeServer({ omitIss: true }).fetcher, LOCAL_BASE);
  assert.equal(outcomes(promised).approve_consent, 'fail');
  assert.match(formatReport(promised), /iss missing/);
  const notPromised = await runLocal(fakeServer({ omitIss: true, asm: { authorization_response_iss_parameter_supported: false }, tools: TOOLS }).fetcher, LOCAL_BASE);
  assert.equal(outcomes(notPromised).approve_consent, 'pass');
});

test('wave, pending PRs: stub /connect routes, no audit row and no rate-limit gate each fail their own check only', async () => {
  const fake = fakeServer({ tools: TOOLS, connectStubbed: true, skipRevokeAudit: true, registerLimit: Infinity });
  const report = await runLocal(fake.fetcher, LOCAL_BASE, undefined, { audit: fake.audit });
  assert.deepEqual(failures(report), ['revoke_audit_disconnect', 'connect_page', 'copilot_package_zip', 'register_rate_limited']);
  assert.match(formatReport(report), /register_rate_limited\s+no 429 after 11 POST \/register/);
  assert.equal(outcomes(await runLocal(fakeServer({ tools: TOOLS }).fetcher, LOCAL_BASE)).revoke_audit_disconnect, 'skip', 'no D1 probe');
});

test('wave: the unlisted Origin is served while MCP_ORIGIN_ENFORCE is "0" and refused at "1"', async () => {
  const enforcing = fakeServer({ tools: TOOLS, originEnforce: true });
  assert.equal(outcomes(await runLocal(enforcing.fetcher, LOCAL_BASE, undefined, { originEnforce: '1' })).mcp_origin_unlisted, 'pass');
  assert.equal(outcomes(await runLocal(fakeServer({ tools: TOOLS, originEnforce: true }).fetcher, LOCAL_BASE)).mcp_origin_unlisted, 'fail', 'flag "0" but refused');
  assert.equal(originExpectation(null), 200);
  assert.equal(originExpectation('0'), 200);
  assert.equal(originExpectation('1'), 403);
});

test('wave: the no-resource authorization sends no resource parameter anywhere and revokes its grant', async () => {
  const fake = fakeServer({ tools: TOOLS });
  const report = await runLocal(fake.fetcher, LOCAL_BASE);
  assert.equal(outcomes(report).no_resource_token, 'pass');
  const authorizes = fake.requests.filter((url) => url.includes('/authorize?'));
  assert.equal(authorizes.length, 2 + perKind('grant').length, 'the grant, the no-resource one, then one per kind');
  assert.ok(authorizes[0]!.includes('resource=') && !authorizes[1]!.includes('resource='));
  assert.ok(fake.grants.every((g) => g.revoked));
  const pkce = { verifier: 'v', challenge: 'c' };
  assert.ok(!new URL(authorizeUrl('http://localhost/authorize', { clientId: 'a', clientSecret: null }, 'http://127.0.0.1:1/cb', pkce, 's', null)).searchParams.has('resource'));
});

test('registration bodies: true and false keep their meaning; Basic for Microsoft; refusals are 4xx with no client', () => {
  assert.equal(registrationBody('n', 'u', true).token_endpoint_auth_method, 'client_secret_post');
  assert.equal(registrationBody('n', 'u', false).token_endpoint_auth_method, 'none');
  assert.deepEqual(registrationBody('n', TEAMS_REDIRECT, 'client_secret_basic').redirect_uris, [TEAMS_REDIRECT]);
  const reg = (status: number, client: boolean) => ({ status, client: client ? { clientId: 'x', clientSecret: null } : null, error: null, authMethod: null });
  assert.equal(refusedRegistration(reg(400, false)), true);
  assert.equal(refusedRegistration(reg(500, false)), false);
  assert.equal(refusedRegistration(reg(201, true)), false);
});

test('rate limit: PASS on a 429 with Retry-After; FAIL without one, on a 5xx, a stored client, or no 429 at all', () => {
  assert.equal(rateLimitOutcome([400, 400, 429], '60').ok, true);
  assert.match(rateLimitOutcome([400, 400, 429], '60').detail, /429 on request 3/);
  assert.equal(rateLimitOutcome([400, 429], null).ok, false, 'a 429 must say when to retry');
  assert.equal(rateLimitOutcome([400, 503], null).ok, false);
  assert.equal(rateLimitOutcome([201, 429], '60').ok, false, 'a refused redirect registered');
  assert.equal(rateLimitOutcome(Array(11).fill(400), null).ok, false, 'wrangler dev enforces the binding, so the gate is missing');
});

test('connect page: 200 HTML holding the MCP link', () => {
  assert.equal(connectPageOk(200, 'text/html; charset=utf-8', `<input value="${MCP_RESOURCE}">`), true);
  assert.equal(connectPageOk(200, 'text/plain', MCP_RESOURCE), false);
  assert.equal(connectPageOk(404, 'text/html', MCP_RESOURCE), false);
  assert.equal(connectPageOk(200, 'text/html', 'https://mcp.room.example.com/'), false);
});

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const pkg = (reference: string) => new Uint8Array(zipStore([{ name: 'manifest.json', data: encode({}) }, { name: 'ai-plugin.json', data: encode({ reference_id: reference }) }]));
const reply = (bytes: Uint8Array, contentType = 'application/zip') => ({ status: 200, contentType, disposition: 'attachment; filename="legallas-copilot-agent.zip"', bytes });

test('copilot package: a ZIP with manifest.json and the pasted ID, valid when a validator is given', () => {
  assert.equal(packageOutcome(reply(pkg(PACKAGE_REFERENCE_ID)), null).ok, true);
  assert.match(packageOutcome(reply(pkg(PACKAGE_REFERENCE_ID)), () => []).detail, /2 files, download, reference ok, problems 0/);
  assert.equal(packageOutcome(reply(pkg(PACKAGE_REFERENCE_ID)), () => ['manifest.json: bad']).ok, false);
  assert.equal(packageOutcome(reply(pkg('other-id')), null).ok, false, 'the ID was not substituted');
  assert.equal(packageOutcome(reply(pkg(PACKAGE_REFERENCE_ID), 'text/html'), null).ok, false);
  assert.match(packageOutcome(reply(new TextEncoder().encode('<html>')), null).detail, /PK no/);
  assert.match(packageOutcome(reply(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])), null).detail, /zip_/);
});

/** One deflated entry, built by hand, so the reader's method 8 path is covered (zipStore only stores). */
function deflatedZip(name: string, data: Uint8Array): Uint8Array {
  const packed = deflateRawSync(data);
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(30 + nameBytes.length + packed.length, 16);
  return new Uint8Array(Buffer.concat([local, nameBytes, packed, central, nameBytes, end]));
}

test('zip reader: stored and deflated entries by name; anything else is a zip_ code that quotes nothing', () => {
  const stored = readZip(pkg('x'));
  assert.deepEqual([...stored.keys()], ['manifest.json', 'ai-plugin.json']);
  assert.equal(new TextDecoder().decode(stored.get('manifest.json')), '{}');
  const text = new TextEncoder().encode('hello '.repeat(50));
  assert.deepEqual(readZip(deflatedZip('a.json', text)).get('a.json'), text);
  assert.equal(looksLikeZip(pkg('x')), true);
  assert.equal(looksLikeZip(new TextEncoder().encode('PK')), false);
  assert.throws(() => readZip(new TextEncoder().encode('not a zip at all, secret text')), /^Error: zip_no_end_record$/);
  assert.throws(() => readZip(deflatedZip('../evil', text)), /zip_unexpected_name/);
  assert.throws(() => readZip(pkg('x').subarray(0, 40)), /zip_/);
});

test('local D1 probe: two read-only counts, the id inlined as an integer; unreadable output throws', async () => {
  const seen: string[] = [];
  const probe = localAuditProbe(async (sql) => {
    seen.push(sql);
    return sql.includes('MAX') ? [{ id: 41 }] : [{ n: 1 }];
  });
  assert.equal(await probe.lastId(), 41);
  assert.equal(await probe.disconnectsAfter(41.9), 1);
  assert.match(seen[1]!, /action = 'ai_disconnect' AND id > 41$/);
  assert.ok(seen.every((sql) => sql.startsWith('SELECT')));
  await assert.rejects(localAuditProbe(async () => [{}]).lastId(), /audit_unreadable/);
  assert.equal(await auditBaseline(localAuditProbe(async () => { throw new Error('wrangler failed'); })), null);
});
