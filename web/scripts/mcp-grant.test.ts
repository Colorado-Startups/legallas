// SPDX-License-Identifier: Apache-2.0
// The token endpoint client authentication (scripts/mcp-grant.ts): a Teams client registered with
// client_secret_basic exchanges, refreshes and revokes with Basic credentials and nothing in the body; a
// client_secret_post client sends its secret in the body; a public client sends its id alone. The fake server
// (scripts/mcp-testkit.ts) refuses any other method, as workers-oauth-provider does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MCP_RESOURCE } from './mcp-constants.ts';
import { approveConsent, basicCredentials, clientAuth, exchangeCode, openConsent, refresh, revoke, tokenRequest, type TokenClient } from './mcp-grant.ts';
import { authorizeUrl, createPkce, discover, randomToken, register, type AuthMethod, type Fetch } from './mcp-oauth.ts';
import { fakeServer } from './mcp-testkit.ts';
import { HARVEY_REDIRECT, TEAMS_REDIRECT } from './mcp-wave.ts';

const BASE = 'http://localhost:8790';

/** Records every token endpoint request's Authorization header and body, then passes it on. */
function recording(fetcher: Fetch) {
  const seen: { authorization: string | null; body: URLSearchParams }[] = [];
  const wrapped: Fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname === '/token') seen.push({ authorization: request.headers.get('Authorization'), body: new URLSearchParams(await request.clone().text()) });
    return fetcher(request);
  };
  return { fetcher: wrapped, seen };
}

/** Registers a client with `method`, consents and exchanges the code; returns what a test needs next. */
async function grant(method: AuthMethod, redirect: string, as: AuthMethod = method) {
  const fake = fakeServer();
  const { fetcher, seen } = recording(fake.fetcher);
  const { asm } = await discover(fetcher, BASE);
  const registration = await register(fetcher, asm.registrationEndpoint, 'legallas-smoke-test', redirect, method);
  const client: TokenClient = { ...registration.client!, authMethod: as };
  const pkce = await createPkce();
  const page = await openConsent(fetcher, authorizeUrl(asm.authorizationEndpoint, client, redirect, pkce, randomToken(8), MCP_RESOURCE));
  const approval = await approveConsent(fetcher, page.form!, page.cookies, BASE);
  const token = await exchangeCode(fetcher, asm.tokenEndpoint, client, approval.code!, redirect, pkce.verifier, MCP_RESOURCE);
  return { fake, fetcher, seen, asm, client, token };
}

test('Basic credentials: id and secret form-encoded, joined by a colon, base64; the library decodes them back', () => {
  assert.equal(basicCredentials('client-1', 's3cret'), `Basic ${btoa('client-1:s3cret')}`);
  const header = basicCredentials('a b:c', 'x+y/z=&%');
  const pair = atob(header.slice('Basic '.length));
  assert.equal(pair, 'a+b%3Ac:x%2By%2Fz%3D%26%25', 'a colon inside the id cannot split the pair');
  const decode = (value: string) => decodeURIComponent(value.replace(/\+/g, ' '));
  assert.deepEqual([decode(pair.slice(0, pair.indexOf(':'))), decode(pair.slice(pair.indexOf(':') + 1))], ['a b:c', 'x+y/z=&%']);
});

test('client auth: Basic in the header only; post in the body; a public client its id alone; unset keeps the old rule', () => {
  const secret = { clientId: 'c', clientSecret: 's' };
  assert.deepEqual(clientAuth({ ...secret, authMethod: 'client_secret_basic' }), { headers: { Authorization: basicCredentials('c', 's') }, fields: {} });
  assert.deepEqual(clientAuth({ ...secret, authMethod: 'client_secret_post' }), { headers: {}, fields: { client_id: 'c', client_secret: 's' } });
  assert.deepEqual(clientAuth({ ...secret }), { headers: {}, fields: { client_id: 'c', client_secret: 's' } }, 'no method: the secret goes in the body, as before');
  assert.deepEqual(clientAuth({ clientId: 'c', clientSecret: null, authMethod: 'none' }), { headers: {}, fields: { client_id: 'c' } });
  assert.deepEqual(clientAuth({ ...secret, authMethod: 'none' }), { headers: {}, fields: { client_id: 'c' } }, 'a public client never sends a secret');
  assert.throws(() => clientAuth({ clientId: 'c', clientSecret: null, authMethod: 'client_secret_basic' }), /needs a client secret/);
});

test('Teams (client_secret_basic): the code exchange, refresh and revocation all use Basic with no client_id in the body', async () => {
  const { fetcher, seen, asm, client, token } = await grant('client_secret_basic', TEAMS_REDIRECT);
  assert.equal(token.error, null);
  assert.ok(token.tokens?.refreshToken);
  const refreshed = await refresh(fetcher, asm.tokenEndpoint, client, token.tokens!.refreshToken!, MCP_RESOURCE);
  assert.equal(refreshed.error, null, 'refresh with Basic');
  assert.notEqual(refreshed.tokens!.refreshToken, token.tokens!.refreshToken, 'it rotated');
  assert.equal(await revoke(fetcher, asm.revocationEndpoint!, client, refreshed.tokens!.refreshToken!), 200);
  assert.equal(seen.length, 3);
  for (const request of seen) {
    assert.equal(request.authorization, basicCredentials(client.clientId, client.clientSecret!));
    assert.equal(request.body.has('client_id'), false);
    assert.equal(request.body.has('client_secret'), false);
  }
  const after = await refresh(fetcher, asm.tokenEndpoint, client, refreshed.tokens!.refreshToken!, MCP_RESOURCE);
  assert.equal(after.error, 'invalid_grant', 'the revocation reached the grant');
});

test('Harvey (client_secret_post): the secret goes in the body on exchange and refresh, never in a header', async () => {
  const { fetcher, seen, asm, client, token } = await grant('client_secret_post', HARVEY_REDIRECT);
  assert.equal(token.error, null);
  const refreshed = await refresh(fetcher, asm.tokenEndpoint, client, token.tokens!.refreshToken!, MCP_RESOURCE);
  assert.equal(refreshed.error, null);
  for (const request of seen) {
    assert.equal(request.authorization, null);
    assert.equal(request.body.get('client_id'), client.clientId);
    assert.equal(request.body.get('client_secret'), client.clientSecret);
  }
});

test('the server holds each client to its registered method: post for a Basic client, or Basic for a post client, is invalid_client', async () => {
  const basicAsPost = await grant('client_secret_basic', TEAMS_REDIRECT, 'client_secret_post');
  assert.equal(basicAsPost.token.error, 'invalid_client');
  const postAsBasic = await grant('client_secret_post', HARVEY_REDIRECT, 'client_secret_basic');
  assert.equal(postAsBasic.token.error, 'invalid_client');
});

test('Basic credentials plus a body client_id are two methods: invalid_request, as the library answers', async () => {
  const { fetcher, asm, client, token } = await grant('client_secret_basic', TEAMS_REDIRECT);
  const both = await fetcher(asm.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicCredentials(client.clientId, client.clientSecret!) },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.tokens!.refreshToken!, client_id: client.clientId }).toString(),
  });
  assert.equal(both.status, 400);
  assert.equal(((await both.json()) as { error: string }).error, 'invalid_request');
  const wrong = await tokenRequest(fetcher, asm.tokenEndpoint, { ...client, clientSecret: 'wrong' }, { grant_type: 'refresh_token', refresh_token: token.tokens!.refreshToken!, resource: MCP_RESOURCE });
  assert.equal(wrong.error, 'invalid_client', 'a wrong secret in Basic is refused');
});
