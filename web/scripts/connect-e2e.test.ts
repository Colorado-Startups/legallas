// SPDX-License-Identifier: Apache-2.0
// connect-e2e (scripts/connect-e2e.ts, scripts/connect-e2e-kinds.ts): the four kinds pinned to the server's own
// rules, the profile checks and what each one catches, the arguments, the 0600 cache, reading the code from the
// consent redirect, and the whole authorize-then-code run per kind against the fake server (scripts/mcp-testkit.ts),
// with no token, secret, code or tool text in the printed table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DESKTOP_KINDS, KIND_NAMES, KINDS, kindProblem, minifiedObject, profileProblem, type ConnectKind } from './connect-e2e-kinds.ts';
import { ask, authorizeStep, cachePath, codeStep, loadSaved, parseE2eArgs, readCode, save, type E2eArgs } from './connect-e2e.ts';
import { MCP_ORIGIN } from './mcp-constants.ts';
import { formatReport, Report } from './mcp-flow.ts';
import { approveConsent, openConsent } from './mcp-grant.ts';
import { register, type Fetch } from './mcp-oauth.ts';
import { loadModule } from './load-module.ts';
import { fakeKindOf, fakeProfiled, fakeServer, type FakeOptions } from './mcp-testkit.ts';
import { CLAUDE_REDIRECT, HARVEY_LOOKALIKE, TEAMS_REDIRECT } from './mcp-wave.ts';

const text = (value: unknown, pretty = true) => ({ type: 'text', text: JSON.stringify(value, null, pretty ? 2 : undefined) });
const image = { type: 'image', data: 'AAAA', mimeType: 'image/png' };
const standard = (value: Record<string, unknown>, extra: Record<string, unknown>[] = []) => ({ content: [text(value), ...extra], structuredContent: value });
const compact = (value: Record<string, unknown>) => ({ content: [text(value, false)] });
const coded = { isError: true, content: [{ type: 'text', text: 'not_found: No such document.' }] };

test('kinds: each redirect is allowed and maps to its kind, profile and image rule on the server itself', async () => {
  const { clientKindOf } = await loadModule<{ clientKindOf(uris: string[]): string }>('mcp/server.ts');
  const { PROFILE_OF, DEFAULT_REDIRECT_ALLOW } = await loadModule<{ PROFILE_OF: Record<string, string>; DEFAULT_REDIRECT_ALLOW: readonly string[] }>('mcp/contract.ts');
  const { isAllowedRedirect } = await loadModule<{ isAllowedRedirect(uri: string, env: object): boolean }>('mcp/redirects.ts');
  const serverKind: Record<ConnectKind, string> = { claude: 'claude', teams: 'microsoft', apim: 'microsoft', harvey: 'harvey' };
  for (const kind of KIND_NAMES) {
    const spec = KINDS[kind];
    assert.equal(clientKindOf([spec.redirect]), serverKind[kind], kind);
    assert.equal(PROFILE_OF[clientKindOf([spec.redirect])], spec.profile, `${kind} profile`);
    assert.equal(spec.images, clientKindOf([spec.redirect]) === 'claude', `${kind} images: only the claude kind gets bytes (files.ts, visuals.ts)`);
    assert.ok(isAllowedRedirect(spec.redirect, {}), `${kind} redirect allowed by default`);
    assert.equal(fakeKindOf(spec.redirect), serverKind[kind], `the fake agrees for ${kind}`);
  }
  assert.ok(DEFAULT_REDIRECT_ALLOW.includes(CLAUDE_REDIRECT), "Claude's callback is on the default list");
  assert.ok(!isAllowedRedirect(HARVEY_LOOKALIKE, {}), 'a lookalike host stays refused');
  assert.deepEqual(new Set(KIND_NAMES.map((k) => KINDS[k].authMethod)), new Set(['none', 'client_secret_basic', 'client_secret_post']), 'all three auth methods are covered');
});

test('OpenCode: refused until loopback is allowed, then an unknown app on the compact profile with no bytes', async () => {
  const { clientKindOf } = await loadModule<{ clientKindOf(uris: string[]): string }>('mcp/server.ts');
  const { PROFILE_OF } = await loadModule<{ PROFILE_OF: Record<string, string> }>('mcp/contract.ts');
  const { isAllowedRedirect } = await loadModule<{ isAllowedRedirect(uri: string, env: object): boolean }>('mcp/redirects.ts');
  const spec = DESKTOP_KINDS.opencode;
  assert.equal(isAllowedRedirect(spec.redirect, {}), false, 'loopback stays off by default');
  assert.equal(isAllowedRedirect(spec.redirect, { MCP_REDIRECT_ALLOW: 'http://127.0.0.1,http://localhost' }), true, 'as local dev allows it');
  assert.equal(clientKindOf([spec.redirect]), 'unknown');
  assert.equal(PROFILE_OF[clientKindOf([spec.redirect])], spec.profile);
  assert.equal(spec.images, false);
});

test("the fake answers like format.ts forProfile: a compact caller gets the structured object once, minified", async () => {
  const { forProfile } = await loadModule<{ forProfile(profile: string, result: unknown): Record<string, unknown> }>('mcp/format.ts');
  const value = { results: [{ id: 'd1', passage: 'Case text' }] };
  for (const result of [standard(value), coded, { content: [text(value)] }]) {
    assert.deepEqual(fakeProfiled(result, false, true), forProfile('compact', result));
    assert.deepEqual(fakeProfiled(result, false, false), forProfile('standard', result));
  }
});

test('profile: compact is one minified JSON object and nothing else', () => {
  const teams = KINDS.teams;
  const value = { documents: [{ id: 'd1' }] };
  assert.equal(profileProblem(teams, 'legallas_list_documents', compact(value)), null);
  assert.equal(profileProblem(teams, 'legallas_list_documents', { ...compact(value), structuredContent: { documents: [] } }), null, 'the catalog keeps a small view');
  assert.equal(profileProblem(teams, 'legallas_search', { ...compact(value), structuredContent: value }), 'structured_content');
  assert.equal(profileProblem(teams, 'legallas_list_documents', { content: [text(value)] }), 'not_minified_json', 'pretty text');
  assert.equal(profileProblem(teams, 'legallas_list_documents', { content: [text(value, false), text(value, false)] }), 'extra_blocks');
  assert.equal(profileProblem(teams, 'legallas_list_documents', { content: [{ type: 'text', text: 'Case text' }] }), 'not_minified_json');
  assert.equal(profileProblem(teams, 'legallas_get_file', { content: [text(value, false), image] }), 'binary_content');
  assert.equal(profileProblem(teams, 'legallas_get_file', coded), null, 'an error is the same in every profile');
  assert.equal(minifiedObject('[1,2]'), false);
  assert.equal(minifiedObject('{"a":"line\\nbreak"}'), true, 'an escaped newline is still minified');
});

test('profile: standard keeps structured content; only Claude may get bytes, and only from get_file and view_visual', () => {
  const value = { id: 'd1', embedded: true };
  assert.equal(profileProblem(KINDS.harvey, 'legallas_get_document', standard(value)), null);
  assert.equal(profileProblem(KINDS.harvey, 'legallas_get_document', { content: [text(value)] }), 'no_structured_content');
  assert.equal(profileProblem(KINDS.claude, 'legallas_get_file', standard(value, [image])), null);
  assert.equal(profileProblem(KINDS.claude, 'legallas_view_visual', standard(value, [image])), null);
  assert.equal(profileProblem(KINDS.claude, 'legallas_search', standard(value, [image])), 'binary_content', 'no other tool sends bytes');
  assert.equal(profileProblem(KINDS.harvey, 'legallas_get_file', standard(value, [image])), 'binary_content');
  assert.equal(profileProblem(KINDS.claude, 'legallas_get_file', { content: [image] }), 'no_text');
});

test('kind: the server must treat Claude as Claude and nobody else as Claude', () => {
  assert.equal(kindProblem(KINDS.claude, 'legallas_get_file', { embedded: false, reason: 'client' }), 'not_seen_as_claude');
  assert.equal(kindProblem(KINDS.claude, 'legallas_get_file', { embedded: false, reason: 'pdf_as_text' }), null);
  assert.equal(kindProblem(KINDS.teams, 'legallas_get_file', { embedded: false, reason: 'client' }), null);
  assert.equal(kindProblem(KINDS.harvey, 'legallas_get_file', { embedded: false, reason: 'visual' }), null, 'a visual answers the same to everyone');
  assert.equal(kindProblem(KINDS.apim, 'legallas_get_file', { embedded: true }), 'embedded_file');
  assert.equal(kindProblem(KINDS.teams, 'legallas_get_file', { embedded: false, reason: 'pdf_as_text' }), 'unexpected_reason');
  assert.equal(kindProblem(KINDS.harvey, 'legallas_view_visual', { image_embedded: true }), 'embedded_image');
  assert.equal(kindProblem(KINDS.claude, 'legallas_view_visual', { image_embedded: true }), null);
  assert.equal(kindProblem(KINDS.teams, 'legallas_get_file', null), null);
});

test('arguments: one of --production or a local --base, a known kind; the code only on stdin, never as a value', () => {
  const base = { kind: 'teams', step: 'both', newClient: false };
  assert.deepEqual(parseE2eArgs(['--production', '--kind', 'teams']), { ...base, base: MCP_ORIGIN });
  assert.deepEqual(parseE2eArgs(['--base', 'http://localhost:8790/', '--kind', 'teams', '--authorize-only']), { ...base, base: 'http://localhost:8790', step: 'authorize' });
  assert.deepEqual(parseE2eArgs(['--production', '--kind', 'claude', '--code', '-', '--new-client']), { ...base, base: MCP_ORIGIN, kind: 'claude', step: 'code', newClient: true });
  for (const value of [['counsel@example.test:grant:SECRETVALUE'], ['--new-client'], []]) {
    assert.throws(() => parseE2eArgs(['--production', '--kind', 'teams', '--code', ...value]), (error: Error) => /goes on stdin/.test(error.message) && !/counsel@|SECRETVALUE/.test(error.message));
  }
  assert.throws(() => parseE2eArgs(['--kind', 'teams']), /exactly one/);
  assert.throws(() => parseE2eArgs(['--production', '--base', 'http://localhost:1', '--kind', 'teams']), /exactly one/);
  assert.throws(() => parseE2eArgs(['--base', 'https://mcp.room.example.com', '--kind', 'teams']), /localhost/);
  assert.throws(() => parseE2eArgs(['--production', '--kind', 'chatgpt']), /usage/);
  assert.throws(() => parseE2eArgs(['--production', '--kind', 'teams', '--authorize-only', '--code', '-']), /separate runs/);
});

test('the code: from the kind\'s callback with the saved state and the issuer\'s iss, or bare; refusals never quote the input', () => {
  const redirect = KINDS.teams.redirect;
  const code = 'counsel@example.test:grant1234:SECRETVALUE';
  const asm = { issuer: MCP_ORIGIN, issParameter: true };
  const at = (params: Record<string, string>) => `${redirect}?${new URLSearchParams(params)}`;
  const url = at({ code, state: 's1', iss: MCP_ORIGIN });
  assert.deepEqual(readCode(url, redirect, 's1', asm), { code, detail: 'from the redirect, state ok, iss ok' });
  assert.equal(readCode(url, redirect, 's2', asm).detail, 'state mismatch: not the pending authorization');
  assert.equal(readCode(at({ code, state: 's1', iss: 'https://evil.example' }), redirect, 's1', asm).detail, 'iss mismatch (RFC 9207)');
  assert.equal(readCode(at({ code, state: 's1' }), redirect, 's1', asm).detail, 'iss missing (RFC 9207)', 'the server promises iss');
  assert.equal(readCode(at({ code, state: 's1' }), redirect, 's1', { ...asm, issParameter: false }).detail, 'from the redirect, state ok, iss absent');
  assert.equal(readCode(url.replace('teams.microsoft.com', 'evil.example'), redirect, 's1', asm).detail, "not this kind's callback");
  assert.equal(readCode(at({ error: 'access_denied', state: 's1' }), redirect, 's1', asm).detail, 'consent answered access_denied');
  assert.equal(readCode(at({ error: '<b>Case text</b>' }), redirect, 's1', asm).detail, 'consent answered an error');
  assert.equal(readCode(at({ state: 's1', iss: MCP_ORIGIN }), redirect, 's1', asm).detail, 'no code in the redirect');
  assert.deepEqual(readCode(`  ${code}\n`, redirect, 's1', asm), { code, detail: 'bare code, state not checked' });
  assert.equal(readCode(encodeURIComponent(code), redirect, 's1', asm).code, code, 'copied from a URL bar, percent-encoded');
  assert.equal(readCode('short', redirect, 's1', asm).code, null);
  for (const input of [url, code, at({ error: 'x' })]) assert.doesNotMatch(readCode(input, redirect, 'other', asm).detail, /SECRETVALUE|counsel@/);
});

test('stdin: one line is the answer; a pipe that closes first is an error, never a silent pass', async () => {
  assert.equal(await ask('', Readable.from(['https://example.test/cb?code=x\n'])), 'https://example.test/cb?code=x');
  assert.equal(await ask('', Readable.from(['no newline at the end'])), 'no newline at the end');
  await assert.rejects(ask('', Readable.from([])), /stdin closed before a line/);
});

test('cache: one 0600 file per kind and server in a 0700 directory; a file others can read is refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'connect-e2e-'));
  try {
    const file = cachePath(join(dir, 'cache'), 'teams', MCP_ORIGIN);
    assert.match(file, /teams-mcp\.room\.example\.com\.json$/);
    await mkdir(join(dir, 'cache'), { mode: 0o755 });
    assert.notEqual(file, cachePath(join(dir, 'cache'), 'teams', 'http://localhost:8790'));
    const saved = { base: MCP_ORIGIN, kind: 'teams' as const, redirect: KINDS.teams.redirect, client: { clientId: 'c', clientSecret: 's', authMethod: 'client_secret_basic' as const }, pending: null, leftover: null };
    await save(file, saved);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(join(dir, 'cache'))).mode & 0o777, 0o700);
    assert.deepEqual(await loadSaved(file, { base: MCP_ORIGIN, kind: 'teams' }), saved);
    assert.equal(await loadSaved(file, { base: MCP_ORIGIN, kind: 'apim' }), null, 'another kind starts fresh');
    await chmod(file, 0o644);
    await assert.rejects(loadSaved(file, { base: MCP_ORIGIN, kind: 'teams' }), /readable by others/);
    assert.equal(await loadSaved(join(dir, 'none.json'), { base: MCP_ORIGIN, kind: 'teams' }), null);
    await writeFile(file, JSON.stringify({ ...saved, leftover: 'a-token' }), { mode: 0o600 });
    await chmod(file, 0o600);
    await assert.rejects(loadSaved(file, { base: MCP_ORIGIN, kind: 'teams' }), /leftover grant is unreadable/, 'a live grant is never forgotten');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const TOOLS = {
  legallas_search: standard({ results: [{ id: 'doc-1', passage: 'Case text A' }] }),
  legallas_list_documents: standard({ documents: [{ id: 'doc-1', name: 'Case text B' }] }),
  legallas_get_file: standard({ id: 'doc-1', embedded: true, content_type: 'image/png' }, [image]),
  legallas_view_visual: standard({ sections: [{ slug: 'tab-1', visuals: [{ id: 'vis-1', slug: 'v-1' }] }] }),
};

/** As a person does in Chrome: open the printed URL as the signed-in member, approve, read the redirect. */
async function consentAs(fetcher: Fetch, url: string, kind: ConnectKind): Promise<string> {
  const page = await openConsent(fetcher, url);
  const approval = await approveConsent(fetcher, page.form!, page.cookies, MCP_ORIGIN);
  return `${KINDS[kind].redirect}?${new URLSearchParams({ code: approval.code!, state: approval.state!, iss: approval.iss! })}`;
}

const argsFor = (kind: ConnectKind, extra: Partial<E2eArgs> = {}): E2eArgs => ({ base: MCP_ORIGIN, kind, step: 'both', newClient: false, ...extra });

/** Both runs of one kind against the fake in a fresh cache directory; `wrap` may put a fault in front of the server. */
async function run(kind: ConnectKind, options: FakeOptions = {}, wrap: (fetcher: Fetch) => Fetch = (f) => f) {
  const cache = await mkdtemp(join(tmpdir(), 'connect-e2e-'));
  const fake = fakeServer({ tools: TOOLS, law: true, ...options });
  const fetcher = wrap(fake.fetcher);
  const args = argsFor(kind);
  const file = cachePath(cache, kind, MCP_ORIGIN);
  const first = new Report();
  const url = await authorizeStep(first, fetcher, args, file);
  assert.ok(url, formatReport(first));
  const second = new Report();
  await codeStep(second, fetcher, args, file, await consentAs(fetcher, url, kind));
  return { fake, fetcher, args, first, second, file, cache };
}

/** A fault that answers (or throws) in the server's place while `state.on`; the request body is passed to it. */
function withFault(fault: (url: URL, body: string) => Response | null) {
  const state = { on: true };
  const wrap = (fetcher: Fetch): Fetch => async (input, init) => {
    const request = new Request(input, init);
    const body = request.method === 'POST' ? await request.clone().text() : '';
    return (state.on ? fault(new URL(request.url), body) : null) ?? fetcher(request);
  };
  return { state, wrap };
}
const isRevocation = (body: string) => body.includes('token_type_hint');
const savedIn = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

const outcomes = (report: Report) => Object.fromEntries(report.checks.map((c) => [c.name, c.outcome]));
const failed = (report: Report) => report.checks.filter((c) => c.outcome === 'fail').map((c) => c.name);

test('every kind: register, authorize, code, every tool with its profile, revoke; nothing secret is printed', async () => {
  for (const kind of KIND_NAMES) {
    const { fake, first, second, file, cache } = await run(kind);
    try {
      assert.deepEqual(Object.keys(outcomes(first)), ['discovery', 'register', 'authorize_url']);
      assert.deepEqual(failed(second), [], `${kind}\n${formatReport(second)}`);
      assert.deepEqual(Object.keys(outcomes(second)).slice(0, 6), ['pending_authorization', 'discovery', 'code', 'token_exchange', 'token_refresh', 'mcp_initialize']);
      assert.ok(['call_search_law_list', 'revoke_grant', 'revoked_access_refused', 'revoked_refresh_refused'].every((name) => outcomes(second)[name] === 'pass'));
      assert.ok(fake.grants.length === 1 && fake.grants[0]!.revoked, 'the grant is revoked');
      const tables = `${formatReport(first)}\n${formatReport(second)}`;
      assert.doesNotMatch(tables, /SECRETVALUE|Case text/);
      const expected = kind === 'claude' ? /call_get_file\s+ok, .*binary 1, standard ok/ : /call_get_file\s+ok, text \d+ chars, blocks 1, /;
      assert.match(tables, expected);
      const saved = JSON.parse(await readFile(file, 'utf8'));
      assert.equal(saved.pending, null, 'the code was single use');
      assert.equal(saved.leftover, null, 'nothing left to revoke');
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  }
});

test('a second run reuses the saved client; --new-client registers again', async () => {
  const { fake, cache, file } = await run('teams');
  try {
    const again = new Report();
    assert.ok(await authorizeStep(again, fake.fetcher, argsFor('teams', { step: 'authorize' }), file));
    assert.equal(outcomes(again).client, 'pass');
    assert.equal(outcomes(again).register, undefined);
    const fresh = new Report();
    await authorizeStep(fresh, fake.fetcher, argsFor('teams', { step: 'authorize', newClient: true }), file);
    assert.equal(outcomes(fresh).register, 'pass');
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test('a broken server fails the calls it breaks: structured content to Microsoft, an image to Harvey', async () => {
  const teams = await run('teams', { kinds: { compact: [] } });
  assert.ok(failed(teams.second).includes('call_search'));
  assert.match(formatReport(teams.second), /call_search\s+ok, .*compact structured_content/);
  const harvey = await run('harvey', { kinds: { images: ['claude', 'harvey'] } });
  assert.deepEqual(failed(harvey.second), ['call_get_file']);
  assert.match(formatReport(harvey.second), /call_get_file\s+.*standard binary_content/);
  await Promise.all([teams, harvey].map((r) => rm(r.cache, { recursive: true, force: true })));
});

test('without a pending authorization, or with a reused code, nothing is exchanged', async () => {
  const { fake, cache, file } = await run('apim');
  try {
    const report = new Report();
    await codeStep(report, fake.fetcher, argsFor('apim', { step: 'code' }), file, 'whatever-code-1234');
    assert.deepEqual(report.checks.map((c) => [c.name, c.outcome]), [['pending_authorization', 'fail']]);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test('a revocation that fails is not confirmed: the newest token stays in the cache, and the next run revokes it first', async () => {
  const fault = withFault((_, body) => (isRevocation(body) ? new Response('', { status: 503 }) : null));
  const r = await run('harvey', {}, fault.wrap);
  try {
    assert.equal(outcomes(r.second).revoke_grant, 'fail');
    assert.equal(outcomes(r.second).revoked_refresh_refused, 'fail');
    const kept = (await savedIn(r.file)).leftover;
    assert.equal(r.fake.grants[0]!.revoked, false);
    assert.equal(kept.refreshToken, r.fake.grants[0]!.refresh, 'the newest refresh token is the one kept');
    assert.equal(kept.client.clientId, r.fake.grants[0]!.clientId, 'with the client it was issued to');
    fault.state.on = false;
    const next = new Report();
    assert.ok(await authorizeStep(next, r.fetcher, r.args, r.file));
    assert.equal(outcomes(next).revoke_leftover, 'pass');
    assert.ok(r.fake.grants[0]!.revoked);
    assert.equal((await savedIn(r.file)).leftover, null);
  } finally {
    await rm(r.cache, { recursive: true, force: true });
  }
});

test('a revocation that answers 200 but leaves the grant live is a FAIL, and blocks any new authorization', async () => {
  const fault = withFault((_, body) => (isRevocation(body) ? new Response('', { status: 200 }) : null));
  const r = await run('teams', {}, fault.wrap);
  try {
    assert.equal(outcomes(r.second).revoke_grant, 'pass', 'the 200 itself');
    assert.equal(outcomes(r.second).revoked_refresh_refused, 'fail');
    assert.match(formatReport(r.second), /still refreshes after two revocations; kept in the cache/);
    const blocked = new Report();
    assert.equal(await authorizeStep(blocked, r.fetcher, r.args, r.file), null);
    assert.deepEqual(Object.keys(outcomes(blocked)), ['discovery', 'revoke_leftover']);
    assert.equal((await savedIn(r.file)).pending, null, 'nothing new was started');
    // A later --new-client run replaced the saved client: the leftover still goes back with its own.
    const other = await register(r.fetcher, `${MCP_ORIGIN}/register`, 'legallas-smoke-other', TEAMS_REDIRECT, 'client_secret_basic');
    await save(r.file, { ...(await savedIn(r.file)), client: { ...other.client!, authMethod: 'client_secret_basic' } });
    fault.state.on = false;
    const next = new Report();
    assert.ok(await authorizeStep(next, r.fetcher, argsFor('teams', { newClient: true }), r.file));
    assert.equal(outcomes(next).revoke_leftover, 'pass');
    assert.ok(r.fake.grants.every((g) => g.revoked));
  } finally {
    await rm(r.cache, { recursive: true, force: true });
  }
});

test('once a code is exchanged the grant is always revoked, even when the refresh or MCP throws', async () => {
  for (const failAt of ['refresh', 'mcp'] as const) {
    let thrown = false;
    const fault = withFault((url, body) => {
      const hit = failAt === 'refresh' ? body.includes('grant_type=refresh_token') : url.pathname === '/mcp' && body.includes('"initialize"');
      if (!hit || thrown) return null;
      thrown = true;
      throw new TypeError('fetch failed');
    });
    const r = await run('teams', {}, fault.wrap);
    try {
      assert.equal(outcomes(r.second)[failAt === 'refresh' ? 'token_refresh' : 'mcp'], 'fail', failAt);
      assert.equal(outcomes(r.second).revoked_refresh_refused, 'pass', failAt);
      assert.ok(r.fake.grants.every((g) => g.revoked), failAt);
      assert.equal((await savedIn(r.file)).leftover, null);
    } finally {
      await rm(r.cache, { recursive: true, force: true });
    }
  }
});
