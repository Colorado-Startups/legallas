// SPDX-License-Identifier: Apache-2.0
// REQUIRE_MFA (mfa.ts) on its own and through the room's real gate (room.ts), with locally signed Access tokens and real
// SQLite. The AI sign-in's side is in mcp/authorize-mfa.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair } from 'jose';
import { verifyAccessIdentity } from './auth.ts';
import type { Env } from './env.ts';
import { enrollUrl, hasSecondFactor, lacksSecondFactor, mfaRequired, SECOND_FACTOR_METHODS } from './mfa.ts';
import { handle } from './room.ts';
import { testDb } from './sqlite-d1.ts';

const TEAM = 'https://legallas-test.cloudflareaccess.com';
const AUD = 'aud-tag-1';
const ROOM = 'https://legallas.example.test';
const OWNER = 'founder@example.test';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const getKey = async () => publicKey;
// One Access session for every token here: the gate counts a sign-in per new iat.
const IAT = Math.floor(Date.now() / 1000) - 60;

function token(claims: Record<string, unknown> = {}) {
  return new SignJWT({ email: OWNER, type: 'app', sub: 'sub-founder', ...claims })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(TEAM)
    .setAudience(AUD)
    .setIssuedAt(IAT)
    .setExpirationTime('5m')
    .sign(privateKey);
}

/** What the emailed code could put in `amr`. Cloudflare doesn't say, so every shape the sources (mfa.ts) make possible. */
const EMAILED_CODE_AMRS: readonly string[][] = [
  ['otp'], // RFC 8176's one-time password; Entra writes it for a code sent by email or text
  ['pwd', 'otp'],
  ['mfa'], // names no method
  ['mfa', 'otp'],
  ['emailotp', 'mfa'], // Entra's Email method
  ['otp', 'mfa', 'pwd'],
  ['email'],
  ['onetimepin'], // Cloudflare's name for the login method, should it ever show as a value
];

test('only a security key or a biometric counts: Cloudflare\'s Security key and Biometrics values, nothing else', () => {
  assert.deepEqual([...SECOND_FACTOR_METHODS].sort(), ['face', 'fpt', 'hwk', 'iris', 'retina', 'swk', 'vbm']);
  for (const method of SECOND_FACTOR_METHODS) assert.equal(hasSecondFactor([method]), true, method);
});

test('the emailed code never counts, whatever Cloudflare or the IdP writes for it', () => {
  for (const amr of EMAILED_CODE_AMRS) assert.equal(hasSecondFactor(amr), false, JSON.stringify(amr));
  assert.equal(SECOND_FACTOR_METHODS.has('otp'), false, 'otp: an authenticator app and an emailed code look the same');
  assert.equal(SECOND_FACTOR_METHODS.has('mfa'), false, 'mfa: names no method');
});

test('an unknown value is no second factor: what Cloudflare ignores, other IdPs\' own values, near misses', () => {
  const values = ['pwd', 'sms', 'tel', 'geo', 'kba', 'sc', 'pin', 'user', 'mca', 'rba', 'wia', 'pop', 'totp', 'hotp', 'tap', 'fido', 'rsa', 'x509', 'ngcmfa', 'HWK', ' hwk', 'fpt ', ''];
  for (const method of values) assert.equal(hasSecondFactor([method]), false, method);
  assert.equal(hasSecondFactor(values), false, 'all of them together');
});

test('a key or a biometric counts beside the emailed code and any other value', () => {
  for (const amr of [['otp', 'hwk'], ['mfa', 'fpt'], ['pwd', 'otp', 'mfa', 'swk'], ['emailotp', 'mfa', 'face']]) {
    assert.equal(hasSecondFactor(amr), true, JSON.stringify(amr));
  }
});

test('any amr shape but a short array of strings is no second factor (fail closed)', () => {
  for (const amr of [undefined, null, 'hwk', { hwk: true }, 1, [], [1], [['hwk']], new Array(17).fill('hwk')]) {
    assert.equal(hasSecondFactor(amr), false, JSON.stringify(amr));
  }
});

test('REQUIRE_MFA is on only for exactly "1"; any other value is off, and a value but "0" or "1" logs once', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  assert.equal(mfaRequired({ REQUIRE_MFA: '1' }), true);
  for (const value of [undefined, '0']) assert.equal(mfaRequired({ REQUIRE_MFA: value }), false, String(value));
  assert.equal(warn.mock.callCount(), 0, '"0", "1" and unset are valid');
  for (const value of ['', 'true', 'yes', ' 1', 'true']) assert.equal(mfaRequired({ REQUIRE_MFA: value }), false, String(value));
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [['mfa_setting_invalid']], 'once per isolate, never the value');
});

test('off, nobody is refused; on, only a token without a second factor', () => {
  assert.equal(lacksSecondFactor({ secondFactor: false }, {}), false);
  assert.equal(lacksSecondFactor({ secondFactor: false }, { REQUIRE_MFA: '1' }), true);
  assert.equal(lacksSecondFactor({ secondFactor: true }, { REQUIRE_MFA: '1' }), false);
  assert.equal(lacksSecondFactor({ secondFactor: null }, { REQUIRE_MFA: '1' }), false, 'the dev identity has no token and is never refused');
});

test('the enrollment link is Cloudflare\'s page on the team domain, https only', () => {
  assert.equal(enrollUrl(TEAM), `${TEAM}/AddMfaDevice`);
  assert.equal(enrollUrl(`${TEAM}/`), `${TEAM}/AddMfaDevice`);
  for (const bad of [undefined, '', 'not a url', 'http://legallas-test.cloudflareaccess.com', 'javascript:alert(1)']) {
    assert.equal(enrollUrl(bad), null, String(bad));
  }
});

test('a verified token carries secondFactor from its amr claim; the localhost dev identity carries null', async () => {
  const env = { TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const read = async (claims: Record<string, unknown>) =>
    (await verifyAccessIdentity(new Request(`${ROOM}/`, { headers: { 'Cf-Access-Jwt-Assertion': await token(claims) } }), env, getKey))?.secondFactor;
  assert.equal(await read({}), false);
  assert.equal(await read({ amr: ['pwd'] }), false);
  assert.equal(await read({ amr: ['otp'] }), false);
  assert.equal(await read({ amr: ['pwd', 'otp'] }), false);
  assert.equal(await read({ amr: ['otp', 'hwk'] }), true);
  const dev = await verifyAccessIdentity(new Request('http://localhost:8789/'), { TEAM_DOMAIN: '', ACCESS_AUD: '', ALLOW_DEV_IDENTITY: '1', DEV_IDENTITY_EMAIL: OWNER });
  assert.equal(dev?.secondFactor, null);
});

/** The room with one owner, through room.ts handle(); `signIns` counts what the gate recorded. */
function room(extra: Partial<Env> = {}) {
  const { db, sqlite } = testDb();
  sqlite.exec(`INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Founder');`);
  const env = {
    ASSETS: { fetch: async () => new Response('shell') },
    DB: db,
    EMAIL: { send: async () => undefined },
    TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    ALERTS_ENABLED: '0',
    ...extra,
  } as unknown as Env;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
  const visit = async (request: Request) => {
    const response = await handle(request, env, ctx, getKey);
    await Promise.all(pending);
    return response;
  };
  const signIns = () => (sqlite.prepare('SELECT count(*) AS n FROM sign_ins').get() as { n: number }).n;
  return { visit, signIns };
}

const signed = async (claims: Record<string, unknown>, path = '/') =>
  new Request(`${ROOM}${path}`, { headers: { 'Cf-Access-Jwt-Assertion': await token(claims) } });

test('REQUIRE_MFA "1": an email-only sign-in gets the add-a-step page, reaches nothing and counts as no sign-in', async () => {
  const { visit, signIns } = room({ REQUIRE_MFA: '1' });
  for (const path of ['/', '/api/me', '/_astro/a.js']) {
    const response = await visit(await signed({ amr: ['pwd'] }, path));
    assert.equal(response.status, 403, path);
    const html = await response.text();
    assert.match(html, /Add a second sign-in step\./);
    assert.match(html, /A code from an authenticator app is not enough here\./);
    assert.ok(html.includes(`href="${TEAM}/AddMfaDevice"`), 'links to Cloudflare\'s enrollment page');
    assert.ok(html.includes('href="/cdn-cgi/access/logout"'), 'and to sign out, so the next session can carry the step');
    assert.equal(html.includes('shell'), false, 'no asset is served');
  }
  assert.equal(signIns(), 0);
});

test('REQUIRE_MFA "1": every amr the emailed code could carry gets the add-a-step page and counts as no sign-in', async () => {
  const { visit, signIns } = room({ REQUIRE_MFA: '1' });
  for (const amr of EMAILED_CODE_AMRS) {
    const response = await visit(await signed({ amr }));
    assert.equal(response.status, 403, JSON.stringify(amr));
    assert.match(await response.text(), /Add a second sign-in step\./);
  }
  assert.equal(signIns(), 0);
});

test('REQUIRE_MFA "1": a sign-in with a key or a biometric goes through as before', async () => {
  const { visit, signIns } = room({ REQUIRE_MFA: '1' });
  for (const amr of [['otp', 'hwk'], ['fpt'], ['mfa', 'swk']]) {
    const response = await visit(await signed({ amr }));
    assert.notEqual(response.status, 403, JSON.stringify(amr));
  }
  assert.equal(signIns(), 1, 'one Access session, one sign-in');
});

test('REQUIRE_MFA off, unset included: an email-only sign-in goes through exactly as before', async () => {
  for (const extra of [{}, { REQUIRE_MFA: '0' }]) {
    const { visit } = room(extra);
    assert.notEqual((await visit(await signed({}))).status, 403);
  }
});

test('REQUIRE_MFA "1" never refuses the localhost dev identity', async () => {
  const { visit } = room({ REQUIRE_MFA: '1', ALLOW_DEV_IDENTITY: '1', DEV_IDENTITY_EMAIL: OWNER });
  assert.notEqual((await visit(new Request('http://localhost:8789/'))).status, 403);
});

test('a stranger with no second factor sees the add-a-step page, not the room: nothing about membership is read first', async () => {
  const { visit } = room({ REQUIRE_MFA: '1' });
  const response = await visit(await signed({ email: 'stranger@example.test' }));
  assert.equal(response.status, 403);
  assert.match(await response.text(), /Add a second sign-in step\./);
});
