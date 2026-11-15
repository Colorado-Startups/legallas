// SPDX-License-Identifier: Apache-2.0
// /token's scope narrowed to the server's scopes before the library reads it, and failed /token and /register
// answers reported as sign-in failures. Plain Requests and Responses; no library, no real email.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { MCP_ORIGIN } from './contract.ts';
import { MAX_PREREAD_BYTES, prepareOAuthRequest, reportOAuthFailure, type OAuthSource } from './oauth-request.ts';
import { SIGNIN_FAILURE_PREFIX, type SignInFailureEnv } from './signin-failure.ts';

const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback';
const FORM = 'application/x-www-form-urlencoded';

function tokenRequest(form: string, headers: Record<string, string> = {}): Request {
  return new Request(`${MCP_ORIGIN}/token`, { method: 'POST', headers: { 'Content-Type': FORM, 'Content-Length': String(form.length), ...headers }, body: form });
}

const codeForm = (scope?: string) => {
  const params = new URLSearchParams({ grant_type: 'authorization_code', code: 'u:g:c', redirect_uri: CLAUDE_CB, code_verifier: 'v-1_~.' });
  if (scope !== undefined) params.set('scope', scope);
  params.append('resource', `${MCP_ORIGIN}/mcp`);
  return params.toString();
};

async function scopeOf(request: Request): Promise<string | null> {
  return new URLSearchParams(await request.text()).get('scope');
}

test('offline_access is dropped, and a scope with nothing known left goes entirely', async () => {
  const both = await prepareOAuthRequest(tokenRequest(codeForm('case.read offline_access')));
  assert.equal(await scopeOf(both.request), 'case.read');
  const only = await prepareOAuthRequest(tokenRequest(codeForm('offline_access')));
  const params = new URLSearchParams(await only.request.text());
  assert.equal(params.has('scope'), false);
  assert.equal(params.get('resource'), `${MCP_ORIGIN}/mcp`, 'resource is never touched');
});

test('a rewritten request keeps every other parameter and header, Authorization included, and drops the length', async () => {
  const original = tokenRequest(codeForm('offline_access case.read'), { Authorization: 'Basic Y2xpZW50OnNlY3JldA==', 'X-Trace': 't1' });
  const { request, source } = await prepareOAuthRequest(original);
  assert.notEqual(request, original);
  assert.equal(request.method, 'POST');
  assert.equal(request.url, `${MCP_ORIGIN}/token`);
  assert.equal(request.headers.get('authorization'), 'Basic Y2xpZW50OnNlY3JldA==');
  assert.equal(request.headers.get('x-trace'), 't1');
  assert.equal(request.headers.get('content-type'), FORM);
  assert.equal(request.headers.get('content-length'), null);
  const params = new URLSearchParams(await request.text());
  assert.deepEqual(Object.fromEntries(params), { ...Object.fromEntries(new URLSearchParams(codeForm())), scope: 'case.read' });
  assert.deepEqual(source, { where: 'token', host: 'claude.ai', grantType: 'authorization_code' });
  assert.equal(await original.text(), codeForm('offline_access case.read'), 'the original body was never consumed');
});

test('an unchanged request is returned as the same object, its body unread', async () => {
  for (const form of [codeForm('case.read'), codeForm()]) {
    const original = tokenRequest(form);
    const { request, source } = await prepareOAuthRequest(original);
    assert.equal(request, original);
    assert.equal(request.bodyUsed, false);
    assert.equal(source?.where, 'token');
  }
});

test('a repeated scope, GET, JSON, other paths and oversized bodies pass through untouched', async () => {
  const repeated = tokenRequest(`${codeForm('offline_access')}&scope=case.read`);
  assert.equal((await prepareOAuthRequest(repeated)).request, repeated);
  const get = new Request(`${MCP_ORIGIN}/token?scope=offline_access`);
  assert.deepEqual(await prepareOAuthRequest(get), { request: get });
  const json = new Request(`${MCP_ORIGIN}/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"scope":"offline_access"}' });
  assert.deepEqual(await prepareOAuthRequest(json), { request: json });
  const other = new Request(`${MCP_ORIGIN}/authorize`, { method: 'POST', headers: { 'Content-Type': FORM }, body: 'scope=offline_access' });
  assert.deepEqual(await prepareOAuthRequest(other), { request: other });
  const huge = tokenRequest(`${codeForm('offline_access')}&pad=${'x'.repeat(MAX_PREREAD_BYTES)}`);
  assert.deepEqual(await prepareOAuthRequest(huge), { request: huge });
});

test("/register notes its first redirect URI's host, and unknown when the body cannot be read", async () => {
  const register = (body: string) => new Request(`${MCP_ORIGIN}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const ok = register(JSON.stringify({ client_name: 'Harvey', redirect_uris: ['https://app.harvey.ai/oauth/callback', CLAUDE_CB] }));
  const prepared = await prepareOAuthRequest(ok);
  assert.equal(prepared.request, ok);
  assert.deepEqual(prepared.source, { where: 'register', host: 'app.harvey.ai' });
  for (const body of ['not json', '{}', '[1]', JSON.stringify({ redirect_uris: [7] }), JSON.stringify({ pad: 'x'.repeat(MAX_PREREAD_BYTES) })]) {
    assert.deepEqual((await prepareOAuthRequest(register(body))).source, { where: 'register', host: 'unknown' }, body.slice(0, 20));
  }
});

function mailEnv() {
  const store = new Map<string, string>();
  const sent: { text: string }[] = [];
  const env = {
    OAUTH_KV: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => void store.set(key, value),
      list: async ({ prefix = '' }: { prefix?: string } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
    },
    EMAIL: { send: async (m: { text: string }) => void sent.push(m) },
    ALERTS_ENABLED: '1',
  } as unknown as SignInFailureEnv;
  return { env, store, sent };
}

const oauthError = (error: string, status = 400) => Response.json({ error, error_description: 'Grant not found for https://claude.ai' }, { status });

test("a failed code exchange and a failed registration email the owner; the client's response stays readable", async (t: TestContext) => {
  t.mock.method(console, 'warn', () => {});
  const { env, store, sent } = mailEnv();
  const token: OAuthSource = { where: 'token', host: 'claude.ai', grantType: 'authorization_code' };
  const answer = oauthError('invalid_grant');
  await reportOAuthFailure(env, token, answer);
  assert.equal(((await answer.json()) as { error?: string }).error, 'invalid_grant');
  await reportOAuthFailure(env, { where: 'register', host: 'app.harvey.ai' }, oauthError('invalid_client_metadata'));
  await reportOAuthFailure(env, { where: 'register', host: 'unknown' }, new Response('upstream broke', { status: 502 }));
  assert.deepEqual([...store.keys()].sort(), [
    `${SIGNIN_FAILURE_PREFIX}public:register:http_502:unknown`,
    `${SIGNIN_FAILURE_PREFIX}public:register:invalid_client_metadata:app.harvey.ai`,
    `${SIGNIN_FAILURE_PREFIX}public:token:invalid_grant:claude.ai`,
  ]);
  assert.equal(sent.length, 3);
  assert.doesNotMatch(sent.map((m) => m.text).join('\n'), /Grant not found/, 'never the error description');
});

test('refreshes, revocations, successes and refused /register callbacks are not reported', async (t: TestContext) => {
  t.mock.method(console, 'warn', () => {});
  const { env, store, sent } = mailEnv();
  await reportOAuthFailure(env, { where: 'token', host: 'claude.ai', grantType: 'refresh_token' }, oauthError('invalid_grant'));
  await reportOAuthFailure(env, { where: 'token', host: 'claude.ai' }, oauthError('invalid_request'));
  await reportOAuthFailure(env, { where: 'token', host: 'claude.ai', grantType: 'authorization_code' }, Response.json({ access_token: 'a' }));
  await reportOAuthFailure(env, { where: 'register', host: 'connect.vendor.app' }, oauthError('invalid_redirect_uri'));
  assert.equal(store.size, 0);
  assert.equal(sent.length, 0);
});
