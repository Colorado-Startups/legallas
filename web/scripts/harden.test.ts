// SPDX-License-Identifier: Apache-2.0
// `npm run harden` (harden.ts) on a fake Cloudflare API: each row passes, drifts and is unreadable (403); --apply
// changes only the Apply rows and never PUTs a phase entrypoint; the zone must be the account's; output and the report
// carry no hostname, id or token; the data file matches web/README.md "Edge rules".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cloudflareApi } from './backup.ts';
import { appFactors, checkAll, exitCode, findZone, forRoom, harden, MANAGED_RULESETS, parseArgs, readEdgeRules, type Context, type Row } from './harden.ts';

const ACCOUNT = 'a'.repeat(32);
const ZONE = 'b'.repeat(32);
const TOKEN = 'fake-token-value';
const ROOM = 'room.doe-harbor.test';
const MCP = 'mcp.room.doe-harbor.test';
const BUCKET = 'doe-backup-bucket';
const NOW = Date.parse('2026-11-17T12:00:00Z');
const rules = readEdgeRules();
const hosts = { room: ROOM, mcp: MCP };

type World = Record<string, unknown>;
const Z = `/zones/${ZONE}`;
const A = `/accounts/${ACCOUNT}`;
const FLOW = `${A}/workflows/legallas-backup/instances`;

/** A zone where every row passes. Keys are "METHOD path"; a number is an HTTP status. */
function passing(): World {
  return {
    [`GET ${A}/r2/buckets/${BUCKET}/lock`]: { rules: [{ id: 'keep-objects-30-days', prefix: 'objects/', enabled: true, condition: { type: 'Age', maxAgeSeconds: 30 * 86_400 } }] },
    [`GET ${Z}/security-center/securitytxt`]: { enabled: true, contact: ['mailto:security@example.com'], expires: '2027-11-01T00:00:00Z' },
    [`GET ${Z}/rulesets/phases/http_request_firewall_custom/entrypoint`]: { id: 'c'.repeat(32), rules: rules.custom.map((r) => ({ ref: r.ref, enabled: true })) },
    [`GET ${Z}/rulesets/phases/http_ratelimit/entrypoint`]: { id: 'd'.repeat(32), rules: [{ ref: rules.rateLimit.ref, enabled: true }] },
    [`GET ${Z}/rulesets/phases/http_request_firewall_managed/entrypoint`]: { id: 'e'.repeat(32), rules: Object.values(MANAGED_RULESETS).map((id) => ({ action: 'execute', action_parameters: { id } })) },
    [`GET ${A}`]: { settings: { enforce_twofactor: true } },
    [`GET ${A}/access/apps?page=1&per_page=50`]: [{ id: 'app-1', aud: 'aud-1', domain: ROOM, mfa_config: { allowed_authenticators: ['security_key', 'biometrics'] }, policies: [] }, { id: 'app-other', aud: 'aud-x', domain: 'other.example.com' }],
    [`GET ${A}/access/organizations`]: {},
    [`GET ${Z}/settings/min_tls_version`]: { value: '1.2' },
    [`GET ${Z}/settings/always_use_https`]: { value: 'on' },
    [`GET ${Z}/settings/security_header`]: { value: { strict_transport_security: { enabled: true } } },
    [`GET ${Z}/bot_management`]: { fight_mode: false },
    [`GET ${FLOW}?status=complete&per_page=50`]: [
      { id: 'run-drill', ended_on: '2026-11-17T06:00:00Z' },
      { id: 'run-backup', ended_on: '2026-11-17T02:00:00Z' },
    ],
    [`GET ${FLOW}/run-drill`]: { status: 'complete', output: { action: 'drill' } },
    [`GET ${FLOW}/run-backup`]: { status: 'complete', output: { action: 'backup' } },
    [`GET ${A}/r2/buckets/${BUCKET}/objects?prefix=drills%2F&per_page=1000`]: [{ key: 'drills/20261001T080000Z.json' }, { key: 'drills/20260801T080000Z.json' }],
  };
}

interface Call {
  method: string;
  path: string;
  body?: unknown;
  auth: string;
}

function fakeFetch(world: World, calls: Call[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const pathPart = String(url).replace('https://api.cloudflare.com/client/v4', '');
    const method = init.method ?? 'GET';
    calls.push({ method, path: pathPart, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: String((init.headers as Record<string, string>).authorization) });
    const key = `${method} ${pathPart}`;
    const value = key in world ? world[key] : method === 'GET' ? 404 : { id: 'f'.repeat(32) };
    if (typeof value === 'number') return new Response(JSON.stringify({ success: false, errors: [{ code: 10000 }] }), { status: value });
    return new Response(JSON.stringify({ success: true, result: value }), { status: 200 });
  }) as typeof fetch;
}

function context(world: World, calls: Call[] = [], extra: Partial<Context> = {}): Context {
  return {
    api: cloudflareApi(async () => TOKEN, fakeFetch(world, calls)),
    account: ACCOUNT,
    zone: ZONE,
    hosts,
    targets: { hosts: [ROOM, MCP], auds: ['aud-1'] },
    backupBucket: BUCKET,
    mcpVars: { RETAIN_SIGNINS_DAYS: '90', RETAIN_AUDIT_DAYS_AFTER_CLOSE: '365' },
    rules,
    now: NOW,
    ...extra,
  };
}

const byKey = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.key, r]));
const KEYS = ['lock', 'security_txt', 'custom_rules', 'rate_limit', 'managed', 'account_2fa', 'access_mfa', 'zone_tls', 'bot_fight', 'backup_running', 'drill_age', 'retention'];

test('every row passes on a hardened zone: exit 0', async () => {
  const rows = await checkAll(context(passing()));
  assert.deepEqual(rows.map((r) => r.key), KEYS);
  for (const row of rows) assert.equal(row.status, 'pass', `${row.key}: ${row.detail}`);
  assert.equal(exitCode(rows), 0);
  assert.equal(byKey(rows).drill_age!.days, 47);
});

test('each row drifts on its own setting: exit 1', async () => {
  const drift: Record<string, (w: World) => void> = {
    lock: (w) => (w[`GET ${A}/r2/buckets/${BUCKET}/lock`] = { rules: [{ id: 'short', prefix: 'objects/', enabled: true, condition: { type: 'Age', maxAgeSeconds: 86_400 } }] }),
    security_txt: (w) => (w[`GET ${Z}/security-center/securitytxt`] = { enabled: true, contact: ['mailto:security@example.com'], expires: '2026-11-01T00:00:00Z' }),
    custom_rules: (w) => (w[`GET ${Z}/rulesets/phases/http_request_firewall_custom/entrypoint`] = { id: 'c'.repeat(32), rules: [{ ref: rules.custom[0]!.ref }] }),
    rate_limit: (w) => (w[`GET ${Z}/rulesets/phases/http_ratelimit/entrypoint`] = { id: 'd'.repeat(32), rules: [{ ref: rules.rateLimit.ref, enabled: false }] }),
    managed: (w) => (w[`GET ${Z}/rulesets/phases/http_request_firewall_managed/entrypoint`] = 404),
    account_2fa: (w) => (w[`GET ${A}`] = { settings: { enforce_twofactor: false } }),
    access_mfa: (w) => (w[`GET ${A}/access/apps?page=1&per_page=50`] = [{ id: 'app-1', aud: 'aud-1', mfa_config: { allowed_authenticators: ['totp'] } }]),
    zone_tls: (w) => (w[`GET ${Z}/settings/min_tls_version`] = { value: '1.0' }),
    bot_fight: (w) => (w[`GET ${Z}/bot_management`] = { fight_mode: true }),
    backup_running: (w) => (w[`GET ${FLOW}?status=complete&per_page=50`] = [{ id: 'run-backup', ended_on: '2026-11-10T02:00:00Z' }]),
    drill_age: (w) => (w[`GET ${A}/r2/buckets/${BUCKET}/objects?prefix=drills%2F&per_page=1000`] = [{ key: 'drills/20260701T080000Z.json' }]),
  };
  for (const [key, change] of Object.entries(drift)) {
    const world = passing();
    change(world);
    const rows = byKey(await checkAll(context(world)));
    assert.equal(rows[key]!.status, 'drift', key);
    assert.ok(rows[key]!.step, `${key} prints a step`);
    for (const other of KEYS.filter((k) => k !== key)) assert.equal(rows[other]!.status, 'pass', `${key} changed ${other}`);
    assert.equal(exitCode(Object.values(rows)), 1);
  }
  const warn = byKey(await checkAll(context(passing(), [], { mcpVars: { RETAIN_SIGNINS_DAYS: '' } })));
  assert.equal(warn.retention!.status, 'warn');
  assert.equal(exitCode(Object.values(warn)), 0, 'a warning alone does not fail');
});

test('a 403 on any row makes it unreadable: exit 2, with the token hint', async () => {
  for (const key of Object.keys(passing())) {
    const world = passing();
    world[key] = 403;
    const rows = await checkAll(context(world));
    const bad = rows.filter((r) => r.status === 'error');
    assert.equal(bad.length, 1, key);
    assert.match(bad[0]!.detail, /403.*permission/);
    assert.equal(exitCode(rows), 2);
  }
});

test('--apply fixes only the Apply rows, one rule at a time, and never PUTs an entrypoint', async () => {
  const world = passing();
  for (const phase of ['http_request_firewall_custom', 'http_ratelimit', 'http_request_firewall_managed']) world[`GET ${Z}/rulesets/phases/${phase}/entrypoint`] = 404;
  world[`GET ${Z}/security-center/securitytxt`] = 404;
  world[`GET ${Z}/bot_management`] = { fight_mode: true };
  world[`GET ${Z}/settings/always_use_https`] = { value: 'off' };
  world[`GET ${A}/r2/buckets/${BUCKET}/lock`] = { rules: [{ id: 'mine', prefix: 'runs/', enabled: true, condition: { type: 'Indefinite' } }] };
  world[`GET ${A}`] = { settings: { enforce_twofactor: false } };
  const calls: Call[] = [];
  const lines: string[] = [];
  const code = await harden({ mode: 'apply' }, context(world, calls, { contact: 'mailto:security@example.com' }), (line) => lines.push(line));
  const writes = calls.filter((c) => c.method !== 'GET');
  assert.ok(writes.every((c) => !c.path.includes('/entrypoint')), 'no write to an entrypoint');
  assert.ok(writes.every((c) => c.method === 'POST' || c.method === 'PUT'));
  const allowed = [/\/r2\/buckets\/[^/]+\/lock$/, /\/security-center\/securitytxt$/, /\/rulesets$/, /\/rulesets\/[^/]+\/rules$/];
  for (const write of writes) assert.ok(allowed.some((re) => re.test(write.path)), `unexpected write ${write.method}`);
  assert.ok(!writes.some((c) => /settings|bot_management|access|workflows|\/accounts\/[a-f]+$/.test(c.path)), 'check-only rows untouched');
  // Lock: the owner's own rule is sent back with the new one.
  const lock = writes.find((c) => c.path.endsWith('/lock'))!;
  assert.deepEqual((lock.body as { rules: { id: string }[] }).rules.map((r) => r.id), ['mine', 'keep-objects-30-days']);
  // Custom rules: the first creates the phase ruleset, each other is its own POST; hosts swapped in.
  const custom = writes.filter((c) => c.path.endsWith('/rulesets') && (c.body as { phase: string }).phase === 'http_request_firewall_custom');
  assert.equal(custom.length, 1);
  assert.equal((custom[0]!.body as { rules: unknown[] }).rules.length, 1);
  assert.equal(writes.filter((c) => c.path.endsWith('/rules')).length, rules.custom.length - 1);
  const bodies = JSON.stringify(writes.map((c) => c.body));
  assert.ok(bodies.includes(ROOM) && bodies.includes(MCP) && !bodies.includes('room.example.com'));
  assert.equal(writes.filter((c) => (c.body as { phase?: string })?.phase === 'http_ratelimit').length, 1);
  assert.ok(lines.some((l) => l.startsWith('APPLY')));
  assert.equal(code, 1, 'the fake still answers 404 afterwards, so rows still drift');
});

test('--apply leaves a filled rate-limit slot and an existing security.txt alone', async () => {
  const world = passing();
  world[`GET ${Z}/rulesets/phases/http_ratelimit/entrypoint`] = { id: 'd'.repeat(32), rules: [{ ref: 'owners-own', expression: 'http.request.uri.path eq "/x"' }] };
  world[`GET ${Z}/security-center/securitytxt`] = { enabled: false, contact: ['mailto:security@example.com'] };
  const calls: Call[] = [];
  await harden({ mode: 'apply' }, context(world, calls, { contact: 'mailto:security@example.com' }), () => undefined);
  assert.deepEqual(calls.filter((c) => c.method !== 'GET'), []);
});

test('the zone is the longest suffix match and must be this account\'s', async () => {
  const zones = [
    { id: 'z-short', name: 'doe-harbor.test', account: { id: ACCOUNT } },
    { id: 'z-long', name: 'room.doe-harbor.test', account: { id: ACCOUNT } },
  ];
  const api = cloudflareApi(async () => TOKEN, fakeFetch({ [`GET /zones?account.id=${ACCOUNT}&per_page=50&page=1`]: zones }, []));
  assert.equal(await findZone(api, ACCOUNT, [ROOM, MCP]), 'z-long');
  const foreign = cloudflareApi(async () => TOKEN, fakeFetch({ [`GET /zones?account.id=${ACCOUNT}&per_page=50&page=1`]: [{ id: 'z', name: 'doe-harbor.test', account: { id: 'c'.repeat(32) } }] }, []));
  await assert.rejects(findZone(foreign, ACCOUNT, [ROOM]), /not this account/);
  await assert.rejects(findZone(api, ACCOUNT, ['elsewhere.test']), /No zone/);
});

test('output and the report carry no hostname, id, bucket or token', async () => {
  const world = passing();
  world[`GET ${A}`] = 403;
  world[`GET ${Z}/bot_management`] = { fight_mode: true };
  const lines: string[] = [];
  let html = '';
  await harden({ mode: 'check', report: 'r.html' }, context(world), (l) => lines.push(l), (_f, h) => (html = h));
  const text = `${lines.join('\n')}\n${html}`;
  for (const secret of [ROOM, MCP, ACCOUNT, ZONE, BUCKET, TOKEN, 'app-1', 'aud-1', 'run-backup']) assert.ok(!text.includes(secret), secret);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Restore drill: 47 of 90 days/);
  assert.doesNotMatch(html, /<script|src=|href=/);
});

test('MFA: policy over app over organization; an emailed or app code is not a key', () => {
  const org = { mfa_required_for_all_apps: true, mfa_config: { allowed_authenticators: ['biometrics'] } };
  assert.deepEqual(appFactors({}, org), ['biometrics']);
  assert.deepEqual(appFactors({}, {}), []);
  assert.deepEqual(appFactors({ mfa_config: { mfa_disabled: true } }, org), []);
  assert.deepEqual(appFactors({ policies: [{ mfa_config: { mfa_disabled: true } }] }, org), []);
  assert.deepEqual(appFactors({ mfa_config: { allowed_authenticators: ['totp'] } }, org), ['totp']);
});

test('arguments and host swaps', () => {
  assert.deepEqual(parseArgs(['--check']), { mode: 'check' });
  assert.deepEqual(parseArgs(['--apply', '--report', 'x.html']), { mode: 'apply', report: 'x.html' });
  for (const bad of [[], ['--check', '--apply'], ['--report'], ['--force']]) assert.throws(() => parseArgs(bad), /usage/);
  assert.equal(forRoom('http.host eq "mcp.room.example.com" or http.host eq "room.example.com"', hosts), `http.host eq "${MCP}" or http.host eq "${ROOM}"`);
  assert.equal(forRoom('http.host eq "mcp.room.example.com"', { room: ROOM }), null);
});

test('edge-rules.json is the README "Edge rules" table', () => {
  const readme = readFileSync(path.join(import.meta.dirname, '..', 'README.md'), 'utf8');
  const section = readme.slice(readme.indexOf('## Edge rules'));
  const table = [...section.matchAll(/^\| (\d) \| [^|]+ \| `(.+)` \| [^|]+ \|$/gm)].map((m) => [Number(m[1]), m[2]] as const);
  assert.deepEqual(
    table.map(([, expression]) => expression),
    [rules.rateLimit, ...rules.custom].map((r) => r.expression),
  );
  assert.equal(new Set([rules.rateLimit, ...rules.custom].map((r) => r.ref)).size, 5);
});
