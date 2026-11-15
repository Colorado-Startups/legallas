// SPDX-License-Identifier: Apache-2.0
// Run with `npm test` (Node's built-in test runner; Node runs TypeScript directly).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair, type CryptoKey } from 'jose';
import { canPerform, findMember, isRole, verifyAccess, verifyAccessIdentity, type Action } from './auth.ts';
import type { Role } from './env.ts';

const TEAM = 'https://legallas-test.cloudflareaccess.com';
const AUD = 'aud-tag-1';
const env = { TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const ROOM = 'https://legallas.example.test/';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const other = await generateKeyPair('RS256');
const getKey = async () => publicKey;

async function token(claims: Record<string, unknown> = {}, opts: { key?: CryptoKey; iss?: string; aud?: string; exp?: string } = {}) {
  return new SignJWT({ email: 'Counsel@Firm.example', type: 'app', ...claims })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(opts.iss ?? TEAM)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.key ?? privateKey);
}

const req = (jwt?: string, url = ROOM) =>
  new Request(url, { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} });

test('a valid Access JWT yields the normalized email', async () => {
  assert.equal(await verifyAccess(req(await token()), env, getKey), 'counsel@firm.example');
});

test('a trailing slash on TEAM_DOMAIN still matches the issuer', async () => {
  assert.equal(await verifyAccess(req(await token()), { ...env, TEAM_DOMAIN: `${TEAM}/` }, getKey), 'counsel@firm.example');
});

test('one of several comma-separated audiences is enough', async () => {
  assert.equal(await verifyAccess(req(await token()), { ...env, ACCESS_AUD: `other, ${AUD}` }, getKey), 'counsel@firm.example');
});

test('a missing token is rejected', async () => {
  assert.equal(await verifyAccess(req(), env, getKey), null);
});

test('a token signed by another key (forged) is rejected', async () => {
  assert.equal(await verifyAccess(req(await token({}, { key: other.privateKey })), env, getKey), null);
});

test('an unsigned (alg none) token is rejected', async () => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'none' })}.${b64({ email: 'x@y.example', iss: TEAM, aud: AUD })}.`;
  assert.equal(await verifyAccess(req(unsigned), env, getKey), null);
});

test('a wrong audience is rejected', async () => {
  assert.equal(await verifyAccess(req(await token({}, { aud: 'someone-elses-app' })), env, getKey), null);
});

test('a wrong issuer is rejected', async () => {
  assert.equal(await verifyAccess(req(await token({}, { iss: 'https://evil.cloudflareaccess.com' })), env, getKey), null);
});

test('an expired token is rejected', async () => {
  assert.equal(await verifyAccess(req(await token({}, { exp: '-1m' })), env, getKey), null);
});

test('a token without an email (service token) is rejected', async () => {
  assert.equal(await verifyAccess(req(await token({ email: undefined })), env, getKey), null);
});

test('empty TEAM_DOMAIN or ACCESS_AUD denies everything (fail closed)', async () => {
  const jwt = await token();
  assert.equal(await verifyAccess(req(jwt), { TEAM_DOMAIN: '', ACCESS_AUD: AUD }, getKey), null);
  assert.equal(await verifyAccess(req(jwt), { TEAM_DOMAIN: TEAM, ACCESS_AUD: ' , ' }, getKey), null);
});

test('an unset TEAM_DOMAIN denies a token signed by the right key', async () => {
  // Unset, not empty: given no issuer, jose checks none, so only the early return stops this token.
  assert.equal(await verifyAccess(req(await token()), { ACCESS_AUD: AUD, TEAM_DOMAIN: undefined as unknown as string }, getKey), null);
});

test('an email claim that is not an email gives no identity', async () => {
  assert.equal(await verifyAccessIdentity(req(await token({ email: 'not an email' })), env, getKey), null);
});

test('sub is kept only from 1 to 128 characters', async () => {
  const subOf = async (sub: string) => (await verifyAccessIdentity(req(await token({ sub })), env, getKey))?.sub;
  assert.equal(await subOf(''), null);
  assert.equal(await subOf('s'.repeat(128)), 's'.repeat(128));
  assert.equal(await subOf('s'.repeat(129)), null);
});

test('the dev identity works only on localhost with ALLOW_DEV_IDENTITY=1', async () => {
  const dev = { ...env, ALLOW_DEV_IDENTITY: '1', DEV_IDENTITY_EMAIL: 'Dev@Example.test' };
  assert.equal(await verifyAccess(req(undefined, 'http://localhost:8789/'), dev, getKey), 'dev@example.test');
  assert.equal(await verifyAccess(req(undefined, 'http://127.0.0.1:8789/'), dev, getKey), 'dev@example.test');
  assert.equal(await verifyAccess(req(undefined, ROOM), dev, getKey), null, 'ignored on the real host');
  assert.equal(
    await verifyAccess(req(undefined, 'http://localhost:8789/'), { ...dev, ALLOW_DEV_IDENTITY: 'true' }, getKey),
    null,
    'only the exact value 1 enables it',
  );
});

test('findMember returns the row or null, and null for a role the code does not know', async () => {
  const rows: Record<string, { email: string; role: string; name: string | null }> = {
    'founder@example.test': { email: 'founder@example.test', role: 'owner', name: 'Founder' },
    'ada@firm.example': { email: 'ada@firm.example', role: 'counsel', name: null },
    'kin@mail.example': { email: 'kin@mail.example', role: 'family', name: 'Kin' },
    'proto@example.test': { email: 'proto@example.test', role: 'constructor', name: null },
  };
  let boundSql = '';
  const db = {
    prepare(sql: string) {
      boundSql = sql;
      return { bind: (email: string) => ({ first: async () => rows[email] ?? null }) };
    },
  } as unknown as D1Database;
  assert.deepEqual(await findMember(db, 'founder@example.test'), rows['founder@example.test']);
  assert.deepEqual(await findMember(db, 'ada@firm.example'), rows['ada@firm.example']);
  assert.equal(await findMember(db, 'stranger@example.test'), null);
  assert.equal(await findMember(db, 'kin@mail.example'), null, 'the retired family role is no member');
  assert.equal(await findMember(db, 'proto@example.test'), null, 'nor is a prototype name');
  assert.match(boundSql, /WHERE email = \?1/, 'uses a bound parameter, never string concatenation');
});

// The role matrix: owners can do everything; counsel everything except reading the activity log and setting the company's
// facts. Both may propose through their own AI and decide what it proposed. These are the only roles: the read-only family
// role was retired (migration 0010).
const MATRIX: Record<Role, Record<Action, boolean>> = {
  owner: {
    view: true, viewPrivileged: true, download: true, readComments: true, comment: true, resolve: true,
    upload: true, ask: true, flag: true, connect: true, viewActivity: true, propose: true, approve: true, setCompany: true,
  },
  counsel: {
    view: true, viewPrivileged: true, download: true, readComments: true, comment: true, resolve: true,
    upload: true, ask: true, flag: true, connect: true, viewActivity: false, propose: true, approve: true, setCompany: false,
  },
};

test('canPerform follows the role matrix', () => {
  for (const [role, actions] of Object.entries(MATRIX) as [Role, Record<Action, boolean>][]) {
    for (const [action, allowed] of Object.entries(actions) as [Action, boolean][]) {
      assert.equal(canPerform(role, action), allowed, `${role} ${action}`);
    }
  }
});

test('canPerform has no family case: the retired role is allowed nothing, not even view', () => {
  for (const action of Object.keys(MATRIX.owner) as Action[]) {
    assert.equal(canPerform('family' as Role, action), false, action);
  }
  assert.deepEqual(['owner', 'counsel', 'family', 'constructor', '', null].map(isRole), [true, true, false, false, false, false]);
});

test('canPerform fails closed for an unknown role or action', () => {
  assert.equal(canPerform('intruder' as Role, 'view'), false);
  assert.equal(canPerform('owner', 'delete-everything' as Action), false);
  // Prototype names must not slip through a plain object lookup.
  assert.equal(canPerform('constructor' as Role, 'view'), false);
  assert.equal(canPerform('owner', 'constructor' as Action), false);
  assert.equal(canPerform('__proto__' as Role, 'toString' as Action), false);
});
