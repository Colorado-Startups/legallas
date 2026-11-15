// SPDX-License-Identifier: Apache-2.0
// The gate in room.ts, end to end with fake bindings: who gets in, what they see, which headers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './room.ts';
import type { Env, Role } from './env.ts';
import { pastTheGate } from './gate-fixtures.ts';
import { readWranglerConfig } from './wrangler-config.ts';

const HOST = 'http://localhost:8789';

function fakeEnv(members: Record<string, string>, devEmail?: string): Env {
  // Answers the gate's members lookup only; any other query (/api/me's audit_log read) finds no row.
  const db = {
    prepare: (sql: string) => ({
      bind: (email: string) => ({
        first: async () => (sql.includes('FROM members') && members[email] ? { email, role: members[email], name: null } : null),
      }),
    }),
  };
  return {
    ASSETS: { fetch: async () => new Response('<html>APP-SHELL</html>', { headers: { 'Content-Type': 'text/html' } }) },
    DB: db,
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    LEGALLAS_MODEL: 'x',
    DAILY_QUESTION_CAP: '100',
    ...(devEmail ? { ALLOW_DEV_IDENTITY: '1', DEV_IDENTITY_EMAIL: devEmail } : {}),
  } as unknown as Env;
}

const ctx = {} as ExecutionContext;
const get = (env: Env, path: string, init?: RequestInit) => handle(new Request(`${HOST}${path}`, init), env, ctx);

test('without a verified identity every path is denied, assets included', async () => {
  const env = fakeEnv({ 'founder@example.test': 'owner' });
  for (const path of ['/', '/api/me', '/_astro/app.js', '/files/abc']) {
    const res = await get(env, path);
    assert.equal(res.status, 403, path);
    assert.doesNotMatch(await res.text(), /APP-SHELL/, `${path} must not serve the app`);
  }
});

test('a verified identity that is not a member is denied', async () => {
  const res = await get(fakeEnv({}, 'stranger@example.test'), '/');
  assert.equal(res.status, 403);
  assert.match(await res.text(), /This room is private\./);
});

test('a member gets the app and /api/me, with security headers', async () => {
  const env = fakeEnv({ 'founder@example.test': 'owner' }, 'Founder@Example.test');
  const page = await get(env, '/');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('Cache-Control'), 'private, no-store');
  assert.match(page.headers.get('Content-Security-Policy') ?? '', /frame-ancestors 'none'/);

  const me = await get(env, '/api/me');
  assert.deepEqual(await me.json(), {
    email: 'founder@example.test',
    role: 'owner',
    name: null,
    can: { readComments: true, comment: true, upload: true, flag: true, connect: true, viewActivity: true },
  });
  assert.equal(me.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
});

test('a member row left with the retired family role gets the room and /api/me exactly as a stranger does', async () => {
  const family = fakeEnv({ 'kin@mail.example': 'family' }, 'kin@mail.example');
  const stranger = fakeEnv({}, 'kin@mail.example');
  for (const path of ['/', '/api/me', '/connect']) {
    const [refused, expected] = [await get(family, path), await get(stranger, path)];
    assert.equal(refused.status, 403, path);
    assert.equal(await refused.text(), await expected.text(), path);
  }
});

test('/api/me tells counsel the Activity ledger is the owner\'s, so /activity/ never asks for a 403', async () => {
  const env = fakeEnv({ 'counsel@firm.example': 'counsel' }, 'counsel@firm.example');
  const me = (await (await get(env, '/api/me')).json()) as { role: string; can: Record<string, boolean> };
  assert.equal(me.role, 'counsel');
  assert.deepEqual(me.can, { readComments: true, comment: true, upload: true, flag: true, connect: true, viewActivity: false });
});

// GET /api/me/ai: the member's own live connection, asked of legallas-mcp over the MCP_GRANTS binding (a fake here;
// mcp/member-grants.test.ts covers the grants themselves).
function aiEnv(email: string, role: Role, grants?: unknown): Env {
  return { ...fakeEnv({ [email]: role }, email), ...(grants === undefined ? {} : { MCP_GRANTS: grants }) } as Env;
}

const CONNECTED = { connected: true, via: 'claude.ai', at: '2026-10-20T12:00:00.000Z' };

test('/api/me/ai asks the grants binding for the signed-in member only, owner and counsel alike', async () => {
  for (const [email, role] of [['founder@example.test', 'owner'], ['counsel@firm.example', 'counsel']] as const) {
    const asked: unknown[] = [];
    const grants = { live: async (who: unknown) => (asked.push(who), CONNECTED) };
    const res = await get(aiEnv(email, role, grants), '/api/me/ai');
    assert.equal(res.status, 200, role);
    assert.deepEqual(await res.json(), { ai: CONNECTED }, role);
    assert.deepEqual(asked, [email], `${role}: only their own email`);
  }
});

test('/api/me/ai is not connected with no binding, a failing one or an answer that is not ours', async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logged.push(args));
  const NONE = { ai: { connected: false, via: null, at: null } };
  const cases: [string, unknown][] = [
    ['no binding (local dev, an older config)', undefined],
    ['the call throws', { live: async () => { throw new TypeError('binding down'); } }],
    ['junk', { live: async () => ({ connected: 'yes', via: 'x' }) }],
  ];
  for (const [why, grants] of cases) {
    const res = await get(aiEnv('counsel@firm.example', 'counsel', grants), '/api/me/ai');
    assert.equal(res.status, 200, why);
    assert.deepEqual(await res.json(), NONE, why);
  }
  assert.deepEqual(logged, [['me_ai_unavailable', 'TypeError']], 'a reason word and the error name only');

  const odd = { live: async () => ({ connected: true, via: 7, at: null, extra: 'dropped' }) };
  assert.deepEqual(await (await get(aiEnv('counsel@firm.example', 'counsel', odd), '/api/me/ai')).json(), { ai: { connected: true, via: null, at: null } });
});

test('MCP_GRANTS binds only the MCP Worker\'s MemberGrants entrypoint, which the internet cannot reach', () => {
  const { config } = readWranglerConfig('wrangler');
  const { config: mcp } = readWranglerConfig('wrangler.mcp');
  assert.deepEqual(config.services, [{ binding: 'MCP_GRANTS', service: mcp.name, entrypoint: 'MemberGrants' }]);
});

test('/api/me/ai: a role without connect (the retired family, an unknown one) is not connected, with no binding call', async () => {
  // The gate already refuses these roles; pastTheGate reaches the route's own canPerform wall behind it.
  let calls = 0;
  const grants = { live: async () => (calls++, CONNECTED) };
  for (const role of ['family', 'limited']) {
    const env = aiEnv('kin@mail.example', 'counsel', grants);
    const res = await pastTheGate(new Request(`${HOST}/api/me/ai`), env, { email: 'kin@mail.example', role: role as Role, name: null });
    assert.equal(res.status, 200, role);
    assert.deepEqual(await res.json(), { ai: { connected: false, via: null, at: null } }, role);
  }
  assert.equal(calls, 0, 'the binding is never asked');
});

test('/api/me itself never waits on the grants binding', async () => {
  let calls = 0;
  const grants = { live: async () => (calls++, CONNECTED) };
  const me = (await (await get(aiEnv('counsel@firm.example', 'counsel', grants), '/api/me')).json()) as Record<string, unknown>;
  assert.equal('ai' in me, false);
  assert.equal(calls, 0);
});

test('unknown API paths are 404 JSON, never the app shell', async () => {
  const env = fakeEnv({ 'founder@example.test': 'owner' }, 'founder@example.test');
  const res = await get(env, '/api/nope');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'not_found' });
});

test('cross-origin writes are refused before any route runs', async () => {
  const env = fakeEnv({ 'founder@example.test': 'owner' }, 'founder@example.test');
  const res = await get(env, '/api/me', { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

test('a page path answers GET and HEAD only: a same-origin POST is 405', async () => {
  const env = fakeEnv({ 'founder@example.test': 'owner' }, 'founder@example.test');
  assert.equal((await get(env, '/', { method: 'HEAD' })).status, 200);
  const post = await get(env, '/', { method: 'POST', headers: { Origin: HOST, 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(post.status, 405);
  assert.deepEqual(await post.json(), { error: 'method_not_allowed' });
});

test('a wrong method on a known route is 405 with Allow', async () => {
  const env = fakeEnv({ 'founder@example.test': 'owner' }, 'founder@example.test');
  const res = await get(env, '/api/me', {
    method: 'DELETE',
    headers: { Origin: HOST, 'Sec-Fetch-Site': 'same-origin' },
  });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Allow'), 'GET');
});

test('the front door loads without signing in, before any token check', async () => {
  const env = fakeEnv({ 'founder@example.test': 'owner' });
  let keyLookups = 0;
  const getKey = (async () => {
    keyLookups += 1;
    throw new Error('the front door must not verify tokens');
  }) as unknown as Parameters<typeof handle>[3];
  for (const path of ['/welcome/', '/welcome/door.css', '/welcome/seal-access.svg']) {
    const req = new Request(`${HOST}${path}`, { headers: { 'Cf-Access-Jwt-Assertion': 'not-a-token' } });
    const res = await handle(req, env, ctx, getKey);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store', path);
    assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive', path);
    assert.match(res.headers.get('Content-Security-Policy') ?? '', /frame-ancestors 'none'/, path);
  }
  assert.equal(keyLookups, 0);
});

test('paths near the front door still need a verified member', async () => {
  const env = fakeEnv({ 'founder@example.test': 'owner' });
  for (const path of ['/welcomex', '/welcome/missing', '/Welcome/', '/welcome/%2e%2e/api/me', '/welcome/../api/me']) {
    const res = await get(env, path);
    assert.equal(res.status, 403, path);
    assert.doesNotMatch(await res.text(), /APP-SHELL/, `${path} must not serve the app`);
  }
});

test('/connect sends a member to Connect AI on legallas-mcp, and only after Access and the members check', async () => {
  const target = 'https://mcp.room.example.com/connect';
  for (const role of ['owner', 'counsel'] as const) {
    const env = fakeEnv({ 'm@example.test': role }, 'm@example.test');
    for (const path of ['/connect', '/connect/']) {
      const res = await get(env, path);
      assert.equal(res.status, 301, `${role} ${path}`);
      assert.equal(res.headers.get('Location'), target, `${role} ${path}`);
      assert.equal(res.headers.get('Cache-Control'), 'private, no-store', 'never cached past the session');
    }
  }
  const signedOut = await get(fakeEnv({ 'm@example.test': 'owner' }), '/connect');
  assert.equal(signedOut.status, 403);
  assert.equal(signedOut.headers.get('Location'), null);
  const stranger = await get(fakeEnv({}, 'stranger@example.test'), '/connect/');
  assert.equal(stranger.status, 403);
  assert.equal(stranger.headers.get('Location'), null);
  assert.match(await stranger.text(), /This room is private\./);
});

test('the 403 page uses only the front door stylesheet, never the room bundle', async () => {
  const res = await get(fakeEnv({}, 'stranger@example.test'), '/');
  const html = await res.text();
  assert.match(html, /<link rel="stylesheet" href="\/welcome\/door\.css">/);
  assert.match(html, /href="\/cdn-cgi\/access\/logout"/);
  assert.doesNotMatch(html, /\/_astro\//);
  assert.doesNotMatch(html, /<script|style=/);
});
