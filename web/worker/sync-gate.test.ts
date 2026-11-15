// SPDX-License-Identifier: Apache-2.0
// The sync endpoints' token check, through the real gate in room.ts: a service token reaches the sync paths and nothing
// else, a person never reaches them, and with the setting off the room is what it was. sync.test.ts covers the routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair, type CryptoKey } from 'jose';
import { verifyAccessIdentity, verifySyncToken } from './auth.ts';
import type { Env } from './env.ts';
import { handle } from './room.ts';
import { CLIENT, ORIGIN, OWNER, syncRoom } from './sync-fixtures.ts';

const TEAM = 'https://team.example.test';
const { publicKey, privateKey } = await generateKeyPair('RS256');
const other = await generateKeyPair('RS256');
const getKey = async () => publicKey;
const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;

interface TokenOptions {
  aud?: string;
  claims?: Record<string, unknown>;
  key?: CryptoKey;
  exp?: string;
  iss?: string;
}

/** A token as Access signs one for a service token: common_name, an empty sub, type "app" and no email. */
function serviceToken({ aud = 'sync-aud', claims = {}, key = privateKey, exp = '5m', iss = TEAM }: TokenOptions = {}) {
  return new SignJWT({ common_name: CLIENT, sub: '', type: 'app', ...claims })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);
}

/** A token as Access signs one for a person who signed in. */
function personToken(aud = 'people-aud', email = OWNER) {
  return new SignJWT({ email, sub: 'person-1', type: 'app', country: 'US' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(TEAM)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

function request(path: string, token?: string, init: RequestInit = {}, origin = ORIGIN) {
  const headers = new Headers(init.headers);
  if (token) headers.set('Cf-Access-Jwt-Assertion', token);
  return new Request(`${origin}${path}`, { ...init, headers });
}

const send = (env: Env, path: string, token?: string, init?: RequestInit) => handle(request(path, token, init), env, ctx, getKey);

test('a service token that maps to the owner reaches the sync endpoints', async () => {
  const { env } = syncRoom();
  const response = await send(env, '/api/sync/state', await serviceToken());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { rows: [], pending: [], index: {} });
  assert.ok(response.headers.get('X-Content-Type-Options'));
});

test('every token that is not exactly a service token for the sync application is refused', async () => {
  const { env } = syncRoom();
  const refused: [string, string | undefined][] = [
    ['no token', undefined],
    ['a token for the people\'s application', await serviceToken({ aud: 'people-aud' })],
    ['another key', await serviceToken({ key: other.privateKey })],
    ['another issuer', await serviceToken({ iss: 'https://other.example.test' })],
    ['expired', await serviceToken({ exp: '-1m' })],
    ['an org token', await serviceToken({ claims: { type: 'org' } })],
    ['with a person\'s email', await serviceToken({ claims: { email: OWNER } })],
    ['with a person\'s sub', await serviceToken({ claims: { sub: 'person-1' } })],
    ['no common_name', await serviceToken({ claims: { common_name: undefined } })],
    ['a common_name out of shape', await serviceToken({ claims: { common_name: "x' OR 1=1 --" } })],
    ['a client nobody registered', await serviceToken({ claims: { common_name: 'stranger.access' } })],
    ['the owner, signed in, for the people\'s application', await personToken()],
    ['the owner, signed in, with the sync application\'s audience', await personToken('sync-aud')],
    ['counsel, signed in', await personToken('people-aud', 'counsel@example.test')],
  ];
  for (const [what, token] of refused) {
    assert.equal((await send(env, '/api/sync/state', token)).status, 403, what);
  }
});

test('a service token reaches nothing but the sync paths', async () => {
  const { env } = syncRoom();
  const token = await serviceToken();
  for (const [method, path] of [
    ['GET', '/'],
    ['GET', '/api/documents'],
    ['GET', '/api/me'],
    ['GET', '/api/activity'],
    ['GET', '/api/uploads'],
    ['PUT', '/api/uploads'],
    ['GET', '/files/some-id'],
    ['GET', '/api/sync'],
    ['GET', '/API/SYNC/state'],
  ] as const) {
    const response = await send(env, path, token, { method });
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.match(await response.text(), /This room is private/, `${method} ${path}`);
  }
  // The same token also holds for the people's audience: still not a person.
  assert.equal((await send(env, '/api/documents', await serviceToken({ aud: 'people-aud' }))).status, 403);
  assert.equal(await verifyAccessIdentity(request('/', await serviceToken({ aud: 'people-aud' })), env, getKey), null);
});

test('with the setting off, or left out, the sync paths answer as they did before', async () => {
  for (const setting of [{ SYNC_ENDPOINTS: undefined }, { SYNC_ENDPOINTS: '0' }, { SYNC_ENDPOINTS: 'true' }]) {
    const { env } = syncRoom({ ...setting, ALERTS_ENABLED: '0' });
    const asToken = await send(env, '/api/sync/state', await serviceToken());
    assert.equal(asToken.status, 403);
    assert.match(await asToken.text(), /This room is private/);
    const asOwner = await send(env, '/api/sync/state', await personToken());
    assert.equal(asOwner.status, 404);
    assert.deepEqual(await asOwner.json(), { error: 'not_found' });
  }
});

test('turning the endpoints on leaves the owner\'s own way in as it was', async () => {
  const { env } = syncRoom({ ALERTS_ENABLED: '0' });
  assert.equal((await send(env, '/api/documents', await personToken())).status, 200);
});

test('with no sync audience set, nothing passes', async () => {
  const { env } = syncRoom({ SYNC_ACCESS_AUD: '' });
  assert.equal((await send(env, '/api/sync/state', await serviceToken())).status, 403);
  assert.equal(await verifySyncToken(request('/api/sync/state', await serviceToken()), { TEAM_DOMAIN: '', SYNC_ACCESS_AUD: 'sync-aud' }, getKey), null);
});

test('a browser request with a good token is refused', async () => {
  const { env } = syncRoom();
  const headers = { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' };
  assert.equal((await send(env, '/api/sync/state', await serviceToken(), { headers })).status, 403);
});

test('the local development identity works on localhost only', async () => {
  const dev = { TEAM_DOMAIN: '', SYNC_ACCESS_AUD: '', ALLOW_DEV_IDENTITY: '1', DEV_SYNC_CLIENT_ID: CLIENT };
  assert.equal(await verifySyncToken(request('/api/sync/state', undefined, {}, 'http://localhost:8789'), dev), CLIENT);
  assert.equal(await verifySyncToken(request('/api/sync/state'), dev), null);
  assert.equal(await verifySyncToken(request('/api/sync/state', undefined, {}, 'http://localhost:8789'), { ...dev, ALLOW_DEV_IDENTITY: '0' }), null);
  assert.equal(await verifySyncToken(request('/api/sync/state', undefined, {}, 'http://localhost:8789'), { ...dev, DEV_SYNC_CLIENT_ID: undefined }), null);
});
