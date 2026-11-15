// SPDX-License-Identifier: Apache-2.0
// The OAuthProvider options as mcp/index.ts passes them, inspected and driven without loading the library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPILOT_PACKAGE_PATH, MCP_ORIGIN, MCP_RESOURCE, REFRESH_TOKEN_TTL_SECONDS, SCOPE_READ, SERVER_TITLE, type McpEnv, type Props } from './contract.ts';
import { RESOURCE_METADATA_PATH, RESOURCE_METADATA_ROOT, checkRegistration, oauthOptions, rootResourceMetadataRequest, route } from './oauth.ts';
import { AGENT_ZIP_PATH } from './pages/connect-copilot.ts';
import { COUNSEL, fakeEnv, fakeOAuth, getKey, signedRequest } from './oauth-fakes.ts';

const HARVEY = 'https://app.harvey.example/oauth/callback';
const options = oauthOptions({ redirectAllow: () => HARVEY, dcrEnabled: () => '1', getKey });

test('fixed 30-day refresh, one-hour access tokens, no idle TTL and never the implicit flow', () => {
  assert.equal(options.refreshTokenTTL, REFRESH_TOKEN_TTL_SECONDS);
  assert.equal(options.refreshTokenTTL, 30 * 24 * 3600);
  assert.equal(options.accessTokenTTL, 3600);
  assert.equal('refreshTokenIdleTTL' in options, false);
  assert.equal('allowImplicitFlow' in options, false);
  assert.equal('allowPlainPKCE' in options, false);
});

test('CIMD on, public registration allowed, the library endpoints and resource metadata', () => {
  assert.equal(options.clientIdMetadataDocumentEnabled, true);
  assert.equal('disallowPublicClientRegistration' in options, false);
  assert.equal(options.apiRoute, '/mcp');
  assert.equal(options.authorizeEndpoint, '/authorize');
  assert.equal(options.tokenEndpoint, '/token');
  assert.equal(options.clientRegistrationEndpoint, '/register');
  assert.deepEqual(options.scopesSupported, [SCOPE_READ]);
  assert.deepEqual(options.requiredScopes, [SCOPE_READ]);
  // The deprecated field would make the library throw alongside requiredScopes.
  assert.equal(options.resourceMetadata.scopes_supported, undefined);
  assert.deepEqual(options.resourceMetadata, { resource: MCP_RESOURCE, authorization_servers: [MCP_ORIGIN], resource_name: SERVER_TITLE });
});

test('registration accepts allowlisted redirects, including MCP_REDIRECT_ALLOW read at call time', () => {
  const register = options.clientRegistrationCallback!; // safe: set above
  const request = new Request(`${MCP_ORIGIN}/register`, { method: 'POST' });
  assert.equal(register({ clientMetadata: { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }, request }), undefined);
  assert.equal(register({ clientMetadata: { redirect_uris: [HARVEY] }, request }), undefined);
});

test('registration is closed unless DCR_ENABLED is "1"', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const closed = oauthOptions({ redirectAllow: () => undefined, getKey });
  const request = new Request(`${MCP_ORIGIN}/register`, { method: 'POST' });
  const result = await closed.clientRegistrationCallback!({ clientMetadata: { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }, request }); // safe: always set
  assert.deepEqual(result && { code: result.code, status: result.status }, { code: 'access_denied', status: 403 });
});

test('registration refuses oversized metadata and long client names', (t) => {
  t.mock.method(console, 'warn', () => {});
  const uris = ['https://claude.ai/api/mcp/auth_callback'];
  for (const metadata of [{ redirect_uris: uris, client_name: 'x'.repeat(81) }, { redirect_uris: uris, contacts: ['y'.repeat(5000)] }, { redirect_uris: uris, client_name: 42 }]) {
    const result = checkRegistration(metadata, undefined, '1');
    assert.equal(result?.code, 'invalid_client_metadata');
  }
});

test('loopback redirects register only when MCP_REDIRECT_ALLOW names them', (t) => {
  t.mock.method(console, 'warn', () => {});
  const loopback = { redirect_uris: ['http://localhost:6274/cb'] };
  assert.equal(checkRegistration(loopback, undefined, '1')?.code, 'invalid_redirect_uri');
  assert.equal(checkRegistration(loopback, 'http://localhost', '1'), undefined);
});

test('registration refuses any unlisted redirect with invalid_redirect_uri and logs only the host', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const refused = { code: 'invalid_redirect_uri', status: 400 };
  for (const uris of [['https://claude.ai/api/mcp/auth_callback', 'https://evil.example/cb?x=1'], [], 'https://claude.ai/api/mcp/auth_callback', [42]]) {
    const result = checkRegistration({ redirect_uris: uris }, undefined);
    assert.ok(result, JSON.stringify(uris));
    assert.deepEqual({ code: result.code, status: result.status }, refused);
  }
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
    ['mcp_redirect_refused', 'evil.example'],
    ['mcp_redirect_refused', 'invalid'],
    ['mcp_redirect_refused', 'invalid'],
    ['mcp_redirect_refused', 'invalid'],
  ]);
});

test('the API handler hands the decrypted props to the MCP server', async () => {
  const env = fakeEnv();
  // A non-member's props: the tool answers not_a_member, which it can only do if props.email arrived.
  const props: Props = { email: 'gone@example.test', role: 'counsel', clientId: 'c1', clientName: 'Claude' };
  const request = new Request(`${MCP_ORIGIN}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'legallas_search', arguments: { query: 'x' } } }),
  });
  const handler = options.apiHandler as { fetch(r: Request, e: McpEnv, c: ExecutionContext<Props>): Promise<Response> };
  const response = await handler.fetch(request, env, { props } as ExecutionContext<Props>);
  assert.match(await response.text(), /not_a_member/);
});

test('privacy and terms are public; unknown paths are 404, the Copilot package\'s too without pro', async () => {
  const env = fakeEnv();
  for (const path of ['/privacy', '/terms']) {
    const response = await route(new Request(`${MCP_ORIGIN}${path}`), env);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
  }
  assert.equal((await route(new Request(`${MCP_ORIGIN}/privacy`, { method: 'POST' }), env)).status, 405);
  // Pro adds the package pages (mcp/pro.ts; copilot-package.test.ts); this file never loads it.
  for (const path of ['/', '/admin', '/admin/other', '/authorize/x', '/.env', COPILOT_PACKAGE_PATH, AGENT_ZIP_PATH]) {
    assert.equal((await route(new Request(`${MCP_ORIGIN}${path}`), env)).status, 404, path);
  }
});

test('the default handler gates /connections, /authorize and /admin/clients on Access', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const handler = options.defaultHandler as { fetch(r: Request, e: McpEnv): Promise<Response> };
  for (const path of ['/connections', '/authorize?client_id=x', '/admin/clients']) {
    assert.equal((await handler.fetch(new Request(`${MCP_ORIGIN}${path}`), env)).status, 403, path);
  }
  assert.deepEqual(oauth.names(), []);
  // Past the gate, /connections belongs to its own module (session C2).
  const member = await handler.fetch(await signedRequest('/connections', COUNSEL), env);
  assert.notEqual(member.status, 403);
});

test('/connect is a public page: GET and HEAD only, never framed', async () => {
  const env = fakeEnv();
  const page = await route(new Request(`${MCP_ORIGIN}/connect`), env);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal((await route(new Request(`${MCP_ORIGIN}/connect`, { method: 'HEAD' }), env)).status, 200);
  const post = await route(new Request(`${MCP_ORIGIN}/connect`, { method: 'POST' }), env);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('an unexpected failure becomes a 500 page with a code-only log', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const oauth = fakeOAuth();
  oauth.helpers.parseAuthRequest = async () => ({ responseType: 'code', clientId: 'c', redirectUri: 'https://claude.ai/api/mcp/auth_callback', scope: [], state: '' });
  oauth.helpers.describeConsent = async () => ({ clientId: 'c', clientName: 'C', redirectUri: '', redirectHost: '', redirectIsLoopback: false, scope: [] });
  oauth.helpers.beginConsent = async () => {
    throw new TypeError('kv down: secret detail');
  };
  const response = await route(await signedRequest('/authorize', COUNSEL), fakeEnv(oauth), { getKey });
  assert.equal(response.status, 500);
  assert.deepEqual(error.mock.calls.map((call) => call.arguments), [['mcp_page_failed', 'TypeError']]);
});

test('the root RFC 9728 path is served as the /mcp document; every other path passes through', () => {
  assert.equal(RESOURCE_METADATA_ROOT, '/.well-known/oauth-protected-resource');
  assert.equal(RESOURCE_METADATA_PATH, '/.well-known/oauth-protected-resource/mcp');
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    const original = new Request(`${MCP_ORIGIN}${RESOURCE_METADATA_ROOT}?x=1`, { method, headers: { origin: 'https://copilotstudio.microsoft.com', accept: 'application/json' } });
    const aliased = rootResourceMetadataRequest(original);
    assert.ok(aliased, method);
    assert.equal(aliased.url, `${MCP_ORIGIN}${RESOURCE_METADATA_PATH}?x=1`, `${method}: same origin and query`);
    assert.equal(aliased.method, method);
    assert.equal(aliased.headers.get('origin'), 'https://copilotstudio.microsoft.com', `${method}: headers kept`);
  }
  // A local origin keeps its own host, so wrangler dev serves its own document.
  assert.equal(rootResourceMetadataRequest(new Request(`http://localhost:8790${RESOURCE_METADATA_ROOT}`))?.url, `http://localhost:8790${RESOURCE_METADATA_PATH}`);
  for (const path of [RESOURCE_METADATA_PATH, `${RESOURCE_METADATA_ROOT}/`, `${RESOURCE_METADATA_ROOT}/other`, '/.well-known/oauth-authorization-server', '/mcp', '/']) {
    assert.equal(rootResourceMetadataRequest(new Request(`${MCP_ORIGIN}${path}`)), null, path);
  }
  // The document it is aliased to names /mcp as the resource, which is what the 401 challenge points clients at.
  assert.equal(oauthOptions({ redirectAllow: () => undefined }).resourceMetadata?.resource, MCP_RESOURCE);
});

