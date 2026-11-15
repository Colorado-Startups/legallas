// SPDX-License-Identifier: Apache-2.0
// REQUIRE_MFA on the AI sign-in (/authorize behind its own Access app): a sign-in whose Access token shows no second
// factor (worker/mfa.ts) gets a page saying how to add one, and no consent handle is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthorize } from './authorize.ts';
import { CIMD_CLIENT, CLAUDE_REDIRECT, COUNSEL, STRANGER, TEAM, accessToken, fakeEnv, fakeOAuth, getKey } from './oauth-fakes.ts';

const deps = { getKey };
const AUTHORIZE = `/authorize?${new URLSearchParams({ response_type: 'code', client_id: CIMD_CLIENT, redirect_uri: CLAUDE_REDIRECT, state: 's1' })}`;

async function signIn(email: string, amr?: unknown, method = 'GET'): Promise<Request> {
  const token = await accessToken(email, amr === undefined ? {} : { claims: { amr } });
  return new Request(new URL(AUTHORIZE, 'https://mcp.room.example.com'), {
    method,
    headers: { 'Cf-Access-Jwt-Assertion': token },
    ...(method === 'POST' ? { body: new URLSearchParams({ handle: 'h1', decision: 'approve' }) } : {}),
  });
}

test('REQUIRE_MFA "1": an email-only sign-in is refused on GET and POST with how to add a step, before any handle', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth, { REQUIRE_MFA: '1' });
  // No claim, a password, and what the emailed code could carry (worker/mfa.ts): otp, mfa, Entra's emailotp.
  const cases = [[undefined, 'GET'], [['pwd'], 'GET'], [['pwd'], 'POST'], [['otp'], 'GET'], [['otp'], 'POST'], [['mfa', 'otp'], 'GET'], [['emailotp', 'mfa'], 'GET']] as const;
  for (const [amr, method] of cases) {
    const response = await handleAuthorize(await signIn(COUNSEL, amr, method), env, deps);
    assert.equal(response.status, 403, `${JSON.stringify(amr)} ${method}`);
    const html = await response.text();
    assert.match(html, /Add a second sign-in step/);
    assert.match(html, /A code from an authenticator app is not enough here\./);
    assert.ok(html.includes(`href="${TEAM}/AddMfaDevice"`), 'links to Cloudflare\'s enrollment page');
    assert.ok(html.includes('href="/cdn-cgi/access/logout"'), 'and to sign out of the session that lacks it');
  }
  assert.deepEqual(oauth.names(), []);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), Array(cases.length).fill(['mcp_access_refused', 'second_factor']));
});

test('REQUIRE_MFA "1": a sign-in with a key or a biometric reaches the consent page as before', async () => {
  for (const amr of [['otp', 'hwk'], ['fpt']]) {
    const oauth = fakeOAuth();
    const response = await handleAuthorize(await signIn(COUNSEL, amr), fakeEnv(oauth, { REQUIRE_MFA: '1' }), deps);
    assert.equal(response.status, 200, JSON.stringify(amr));
    assert.ok(oauth.names().includes('beginConsent'));
  }
});

test('REQUIRE_MFA off: an email-only sign-in reaches the consent page as before', async () => {
  for (const extra of [{}, { REQUIRE_MFA: '0' }]) {
    const oauth = fakeOAuth();
    assert.equal((await handleAuthorize(await signIn(COUNSEL), fakeEnv(oauth, extra), deps)).status, 200);
  }
});

test('REQUIRE_MFA "1" never refuses the localhost dev identity', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth, { REQUIRE_MFA: '1', ALLOW_DEV_IDENTITY: '1', DEV_IDENTITY_EMAIL: COUNSEL });
  assert.equal((await handleAuthorize(new Request(`http://localhost:8790${AUTHORIZE}`), env, deps)).status, 200);
});

test('REQUIRE_MFA "1": a stranger with a second factor is still no member', async () => {
  const oauth = fakeOAuth();
  const response = await handleAuthorize(await signIn(STRANGER, ['hwk']), fakeEnv(oauth, { REQUIRE_MFA: '1' }), deps);
  assert.equal(response.status, 403);
  assert.match(await response.text(), /is not a member of the counsel room/);
});
