// SPDX-License-Identifier: Apache-2.0
// A repeat Connect click in the same browser gets the first click's redirect (its code still unexchanged); another
// browser, another member or a late click gets the expired page; and the connected-app email never holds up the
// redirect. Driven through handleAuthorize with the fake OAuth library (mcp/oauth-fakes.ts); no real email.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { GateDeps } from './authorize.ts';
import { handleAuthorize } from './authorize.ts';
import { CONSENT_DONE_PREFIX, CONSENT_DONE_TTL_SECONDS, findConsentDone, rememberConsentDone, REPEAT_WAITS_MS } from './consent-repeat.ts';
import type { McpEnv } from './contract.ts';
import { CIMD_CLIENT, CLAUDE_REDIRECT, COUNSEL, OWNER, fakeEnv, fakeKv, fakeOAuth, getKey, signedRequest } from './oauth-fakes.ts';

const CODE_REDIRECT = `${CLAUDE_REDIRECT}?code=c1&state=s1`;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
/** The library's binding cookie for a consent handle (workers-oauth-provider beginConsent). */
const binding = (handle: string) => `__Host-oauth-consent-${sha256(handle).slice(0, 16)}=${sha256(handle)}`;
const pageUrl = `/authorize?${new URLSearchParams({ response_type: 'code', client_id: CIMD_CLIENT, redirect_uri: CLAUDE_REDIRECT, state: 's1' })}`;

function instant() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

async function connect(env: McpEnv, deps: GateDeps, email = COUNSEL, cookie: string | null = binding('h1')): Promise<Response> {
  const headers: Record<string, string> = cookie ? { Cookie: cookie } : {};
  const body = new URLSearchParams({ handle: 'h1', decision: 'approve' });
  return handleAuthorize(await signedRequest('/authorize', email, { method: 'POST', body, headers }), env, deps);
}

async function shown(env: McpEnv, deps: GateDeps): Promise<void> {
  assert.equal((await handleAuthorize(await signedRequest(pageUrl, COUNSEL), env, deps)).status, 200);
}

test('a second Connect click in the same browser gets the same redirect, with no-store and the binding cleared', async (t: TestContext) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const { waits, sleep } = instant();
  const deps: GateDeps = { getKey, sleep };
  await shown(env, deps);
  const first = await connect(env, deps);
  assert.equal(first.status, 302);
  assert.equal(first.headers.get('location'), CODE_REDIRECT);
  const again = await connect(env, deps);
  assert.equal(again.status, 302);
  assert.equal(again.headers.get('location'), CODE_REDIRECT);
  assert.equal(again.headers.get('cache-control'), 'no-store');
  assert.equal(again.headers.get('set-cookie'), `__Host-oauth-consent-${sha256('h1').slice(0, 16)}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
  assert.equal(oauth.names().filter((name) => name === 'completeAuthorization').length, 1, 'one grant, one code');
  assert.deepEqual(waits, []);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [['mcp_consent_repeat', 'claude.ai']]);
  assert.doesNotMatch(JSON.stringify(warn.mock.calls.map((call) => call.arguments)), /h1|code=|oauth-consent/);
});

test('another browser, a forged binding or another member gets the expired page', async (t: TestContext) => {
  const error = t.mock.method(console, 'error', () => {});
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const { waits, sleep } = instant();
  const deps: GateDeps = { getKey, sleep };
  await shown(env, deps);
  assert.equal((await connect(env, deps)).status, 302);
  for (const [email, cookie] of [
    [COUNSEL, null],
    [COUNSEL, `__Host-oauth-consent-${sha256('h1').slice(0, 16)}=${sha256('h2')}`],
    [COUNSEL, binding('h2')],
    [COUNSEL, `${binding('h1')}0`],
    [OWNER, binding('h1')],
  ] as const) {
    const response = await connect(env, deps, email, cookie);
    assert.equal(response.status, 400, `${email} ${cookie}`);
    assert.match(await response.text(), /This page has expired/);
  }
  assert.deepEqual(waits, [], 'a request without the binding never waits');
  assert.ok(!error.mock.calls.some((call) => call.arguments[0] === 'mcp_consent_repeat_failed'), 'a missing or wrong binding is no error');
});

test('the binding cookie is found among other cookies', async () => {
  const kv = fakeKv().namespace;
  await rememberConsentDone(kv, 'h8', { email: COUNSEL, redirectTo: CODE_REDIRECT });
  const found = (cookie: string) =>
    findConsentDone(kv, new Request('https://mcp.room.example.com/authorize', { method: 'POST', headers: { Cookie: cookie } }), 'h8', COUNSEL, async () => {});
  assert.equal((await found(`theme=dark; flag; ${binding('h8')}`))?.redirectTo, CODE_REDIRECT);
});

test('the redirect is kept sealed for 120 seconds; after that a repeat click gets the expired page', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const { waits, sleep } = instant();
  const deps: GateDeps = { getKey, sleep };
  await shown(env, deps);
  const before = Math.floor(Date.now() / 1000);
  assert.equal((await connect(env, deps)).status, 302);
  const key = `${CONSENT_DONE_PREFIX}${sha256('h1')}`;
  const stored = oauth.kv.store.get(key) ?? '';
  // Base64 has no ':', '?', '@' or second '.', so neither the redirect nor the email can be in it in clear.
  assert.match(stored, /^[A-Za-z0-9+/]+=*\.[A-Za-z0-9+/]+=*$/, 'sealed: an IV and a ciphertext, nothing else');
  assert.ok(!stored.includes(CODE_REDIRECT) && !stored.includes(COUNSEL));
  assert.equal(CONSENT_DONE_TTL_SECONDS, 120);
  assert.ok(Math.abs((oauth.kv.expirations.get(key) ?? 0) - before - 120) <= 1);
  oauth.kv.store.delete(key); // what KV does when the 120 seconds are up
  assert.equal((await connect(env, deps)).status, 400);
  assert.deepEqual(waits, REPEAT_WAITS_MS.filter((ms) => ms > 0), 'it looked again after each pause first');
  assert.equal(waits.reduce((total, ms) => total + ms, 0), 5000, 'five seconds in all');
  assert.ok(Math.max(...waits) <= 500, 'in short steps');
});

test('a double click finds a first request that is still finishing', async () => {
  const kv = fakeKv().namespace;
  const request = new Request('https://mcp.room.example.com/authorize', { method: 'POST', headers: { Cookie: binding('h7') } });
  let looks = 0;
  const finishing = async () => {
    looks += 1;
    if (looks === 2) await rememberConsentDone(kv, 'h7', { email: COUNSEL, redirectTo: CODE_REDIRECT });
  };
  const found = await findConsentDone(kv, request, 'h7', COUNSEL, finishing);
  assert.equal(found?.redirectTo, CODE_REDIRECT);
  assert.equal(looks, 2);
  assert.equal(await findConsentDone(kv, request, 'h7', OWNER, async () => {}), null, 'never for another member');
});

test('the connected-app email never holds up the redirect: it runs under waitUntil', async () => {
  let release = () => {};
  const sent: string[] = [];
  const EMAIL = {
    send: (m: { subject: string }) =>
      new Promise<void>((resolve) => {
        release = () => {
          sent.push(m.subject);
          resolve();
        };
      }),
  };
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth, { ALERTS_ENABLED: '1', EMAIL } as unknown as Partial<McpEnv>);
  const later: Promise<unknown>[] = [];
  const deps: GateDeps = { getKey, waitUntil: (promise) => void later.push(promise) };
  await shown(env, deps);
  const stalled = new Promise<'stalled'>((resolve) => setTimeout(() => resolve('stalled'), 2000));
  const response = await Promise.race([connect(env, deps), stalled]);
  assert.notEqual(response, 'stalled', 'the redirect waited for the email');
  assert.equal((response as Response).status, 302);
  assert.equal(later.length, 2, 'the approval work and the email');
  assert.deepEqual(sent, []);
  release();
  await Promise.all(later);
  assert.deepEqual(sent, [`Legallas: ${COUNSEL} connected claude.ai`]);
});

test('once the consent is used, the grant finishes under waitUntil even when nobody awaits the response', async (t: TestContext) => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const later: Promise<unknown>[] = [];
  const deps: GateDeps = { getKey, waitUntil: (promise) => void later.push(promise) };
  await shown(env, deps);
  const complete = oauth.helpers.completeAuthorization.bind(oauth.helpers);
  let reached = () => {};
  let release = () => {};
  const atGrant = new Promise<void>((resolve) => (reached = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  t.mock.method(oauth.helpers, 'completeAuthorization', async (...args: Parameters<typeof complete>) => {
    reached();
    await gate;
    return complete(...args);
  });
  void connect(env, deps); // the browser cancelled this POST: nothing awaits its response
  await atGrant;
  assert.equal(later.length, 1, 'the approval work is registered before it finishes');
  release();
  const finished = (await later[0]) as Response;
  assert.equal(finished.status, 302);
  assert.equal(finished.headers.get('location'), CODE_REDIRECT);
  assert.ok(oauth.kv.store.has(`${CONSENT_DONE_PREFIX}${sha256('h1')}`), 'the redirect a repeat click picks up was kept');
});
