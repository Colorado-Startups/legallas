// SPDX-License-Identifier: Apache-2.0
// The OAuth half of the legallas-mcp clients: PKCE, challenge and metadata parsing, endpoint pinning, the
// consent form and the token endpoint. No network: fetch is a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MCP_ORIGIN, MCP_RESOURCE } from './mcp-constants.ts';
import { parseConsentForm, refresh, tokenRequest } from './mcp-grant.ts';
import {
  authorizeUrl,
  authServerMetadataUrl,
  base64url,
  cookiesFrom,
  createPkce,
  onBase,
  parseAuthServer,
  parseBearerChallenge,
  parseJson,
  pinAuthServer,
  parseProtectedResource,
  pkceChallenge,
  protectedResourceMetadataUrl,
  resourceFor,
} from './mcp-oauth.ts';

test('PKCE S256 matches the RFC 7636 appendix B vector, and fresh verifiers are 43 url-safe characters', async () => {
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const pkce = await createPkce();
  assert.match(pkce.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(pkce.challenge, await pkceChallenge(pkce.verifier));
  assert.notEqual((await createPkce()).verifier, pkce.verifier);
  assert.equal(base64url(new Uint8Array([251, 255])), '-_8');
});

test('the Bearer challenge yields resource_metadata, quoted or not; other schemes are null', () => {
  const header = 'Bearer error="invalid_token", resource_metadata="https://x.test/.well-known/oauth-protected-resource/mcp", scope=case.read';
  assert.deepEqual(parseBearerChallenge(header), {
    error: 'invalid_token',
    resource_metadata: 'https://x.test/.well-known/oauth-protected-resource/mcp',
    scope: 'case.read',
  });
  assert.equal(parseBearerChallenge('Basic realm="x"'), null);
  assert.equal(parseBearerChallenge(null), null);
  assert.deepEqual(parseBearerChallenge('bearer realm="a \\"b\\""'), { realm: 'a "b"' });
});

test('discovered URLs stay on the server under test; production URLs map onto a local base', () => {
  assert.equal(onBase(`${MCP_ORIGIN}/token`, 'http://localhost:8790'), 'http://localhost:8790/token');
  assert.equal(onBase('/register', 'http://localhost:8790'), 'http://localhost:8790/register');
  assert.equal(onBase(`${MCP_ORIGIN}/token`, MCP_ORIGIN), `${MCP_ORIGIN}/token`);
  assert.throws(() => onBase('https://evil.example/token', 'http://localhost:8790'), /off the server/);
  assert.throws(() => onBase('http://localhost:8790/token', MCP_ORIGIN), /off the server/);
  assert.equal(onBase('http://localhost/token', 'http://localhost:8791'), 'http://localhost:8791/token', 'wrangler dev drops the port');
  assert.equal(onBase('http://127.0.0.1/token', 'http://localhost:8791'), 'http://localhost:8791/token');
  assert.throws(() => onBase('http://localhost/token', MCP_ORIGIN), /off the server/, 'never onto production');
  assert.throws(() => onBase('https://localhost/token', 'http://localhost:8791'), /off the server/);
  assert.throws(() => onBase('http://localhost:9999/token', 'http://localhost:8791'), /off the server/, 'another local port');
});

test('well-known URLs follow RFC 8414 and RFC 9728 path insertion', () => {
  assert.equal(authServerMetadataUrl(MCP_ORIGIN), `${MCP_ORIGIN}/.well-known/oauth-authorization-server`);
  assert.equal(authServerMetadataUrl('https://a.test/tenant/'), 'https://a.test/.well-known/oauth-authorization-server/tenant');
  assert.equal(protectedResourceMetadataUrl(MCP_RESOURCE), `${MCP_ORIGIN}/.well-known/oauth-protected-resource/mcp`);
});

test('metadata documents are validated, naming the missing field', () => {
  const prm = parseProtectedResource({ resource: MCP_RESOURCE, authorization_servers: [MCP_ORIGIN], scopes_supported: ['case.read'] });
  assert.deepEqual(prm, { resource: MCP_RESOURCE, authorizationServers: [MCP_ORIGIN], scopes: ['case.read'] });
  assert.throws(() => parseProtectedResource({ authorization_servers: [MCP_ORIGIN] }), /prm_missing_resource/);
  assert.throws(() => parseProtectedResource({ resource: MCP_RESOURCE }), /prm_missing_authorization_servers/);
  const doc = { issuer: MCP_ORIGIN, authorization_endpoint: 'a', token_endpoint: 't', registration_endpoint: 'r', code_challenge_methods_supported: ['plain'] };
  assert.equal(parseAuthServer(doc).s256, false);
  assert.equal(parseAuthServer(doc).revocationEndpoint, null);
  assert.throws(() => parseAuthServer({ ...doc, registration_endpoint: undefined }), /asm_missing_registration_endpoint/);
});

test('the token is requested for MCP_RESOURCE, or a local server advertising its own URL', () => {
  const prm = { resource: MCP_RESOURCE, authorizationServers: [MCP_ORIGIN], scopes: [] };
  assert.equal(resourceFor(prm, 'http://localhost:8790'), MCP_RESOURCE);
  assert.equal(resourceFor({ ...prm, resource: 'http://localhost:8790/mcp' }, 'http://localhost:8790'), 'http://localhost:8790/mcp');
  assert.equal(resourceFor({ ...prm, resource: 'https://evil.example/mcp' }, 'http://localhost:8790'), MCP_RESOURCE);
});

test('the authorization URL carries code flow, S256, the scope, state and resource', () => {
  const url = new URL(authorizeUrl(`${MCP_ORIGIN}/authorize`, { clientId: 'c1', clientSecret: null }, 'http://127.0.0.1:5000/cb', { verifier: 'v', challenge: 'ch' }, 'st', MCP_RESOURCE));
  const q = Object.fromEntries(url.searchParams);
  assert.deepEqual(q, { response_type: 'code', client_id: 'c1', redirect_uri: 'http://127.0.0.1:5000/cb', scope: 'case.read', state: 'st', code_challenge: 'ch', code_challenge_method: 'S256', resource: MCP_RESOURCE });
});

test('the consent form: the POST form with a handle, its hidden fields and the approve button, never deny', () => {
  const html = `<form method="get" action="/search"><input type="hidden" name="handle" value="no"></form>
    <form method="POST" action="/authorize?x=1"><input type="hidden" name="handle" value="h&amp;1">
    <input name="visible" value="typed"><input type='hidden' name='csrf' value='c'>
    <button name="action" value="deny">Cancel</button><button name="action" value="approve"><span>Allow</span></button></form>`;
  const form = parseConsentForm(html, 'http://localhost:8790/authorize?client_id=a');
  assert.deepEqual(form, { action: 'http://localhost:8790/authorize?x=1', fields: { handle: 'h&1', csrf: 'c', action: 'approve' } });
  const labelOnly = parseConsentForm('<form method="post"><input type="hidden" name="handle" value="h"><button name="go" value="1">Connect</button></form>', 'http://l.test/authorize');
  assert.deepEqual(labelOnly, { action: 'http://l.test/authorize', fields: { handle: 'h', go: '1' } });
  assert.equal(parseConsentForm('<p>Not a member</p>', 'http://l.test/authorize'), null);
});

test('Set-Cookie headers become name=value pairs without attributes', () => {
  const headers = new Headers();
  headers.append('Set-Cookie', '__Host-oauth-consent=abc; Path=/; Secure; HttpOnly');
  headers.append('Set-Cookie', 'other=1; Max-Age=60');
  assert.deepEqual(cookiesFrom(headers), ['__Host-oauth-consent=abc', 'other=1']);
});

test('token requests: client_secret_post only with a secret; OAuth errors come back as codes', async () => {
  const sent: URLSearchParams[] = [];
  const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    sent.push(new URLSearchParams(String(init?.body)));
    return new Response(JSON.stringify({ error: 'invalid_target' }), { status: 400 });
  };
  const result = await refresh(fetcher, 'http://l.test/token', { clientId: 'c', clientSecret: null }, 'r', MCP_RESOURCE);
  assert.deepEqual(result, { status: 400, tokens: null, error: 'invalid_target' });
  assert.equal(sent[0]!.get('grant_type'), 'refresh_token');
  assert.equal(sent[0]!.has('client_secret'), false);
  await tokenRequest(fetcher, 'http://l.test/token', { clientId: 'c', clientSecret: 's' }, { grant_type: 'x' });
  assert.equal(sent[1]!.get('client_secret'), 's');
  const broken = async () => new Response('<html>', { status: 502 });
  assert.equal((await tokenRequest(broken, 'http://l.test/token', { clientId: 'c', clientSecret: null }, {})).error, 'http_502');
});

test('parseJson fails with a fixed message that never quotes the input', () => {
  assert.deepEqual(parseJson('{"a":1}', 'x'), { a: 1 });
  assert.throws(() => parseJson('{"secret case text', 'the eval set'), (e: Error) => e.message === 'the eval set is not valid JSON');
});

test('pinAuthServer maps production endpoints onto a local base and refuses off-server ones', () => {
  const asm = { issuer: MCP_ORIGIN, authorizationEndpoint: `${MCP_ORIGIN}/authorize`, tokenEndpoint: `${MCP_ORIGIN}/token`, registrationEndpoint: `${MCP_ORIGIN}/register`, revocationEndpoint: null, s256: true, issParameter: true };
  assert.equal(pinAuthServer(asm, 'http://localhost:8790').tokenEndpoint, 'http://localhost:8790/token');
  assert.equal(pinAuthServer(asm, MCP_ORIGIN).registrationEndpoint, `${MCP_ORIGIN}/register`);
  assert.throws(() => pinAuthServer({ ...asm, revocationEndpoint: 'https://evil.example/revoke' }, MCP_ORIGIN), /off the server/);
});
