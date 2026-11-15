// SPDX-License-Identifier: Apache-2.0
// /admin/clients: owner only, every change needs a same-origin post with the double-submit form token, and no
// request reads every client (a /register flood must not break the page or hide Microsoft's static client).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_REDIRECT_PREFIX, FIELDS, MCP_ORIGIN, REFUSED_REDIRECT_PREFIX, type McpEnv } from './contract.ts';
import { FORM_COOKIE, FORM_FIELD, formToken } from './forms.ts';
import { ADMIN_ACTIONS, PAGE_SIZE, adminView, STATIC_CLIENT_PREFIX, allClientsPage, handleAdminClients, openCreated, parseRedirectUris, staticClients } from './admin-clients.ts';
import { loadAllowedRedirects } from './redirects.ts';
import { COUNSEL, OWNER, STRANGER, fakeEnv, fakeOAuth, getKey, signedRequest, type FakeOAuth } from './oauth-fakes.ts';

const deps = { getKey };
const TEAMS = 'https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect';
const TOKEN = formToken(new Request(`${MCP_ORIGIN}/`)).token;

async function post(email: string, fields: Record<string, string>, opts: { origin?: string | null; token?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (opts.origin !== null) headers.origin = opts.origin ?? MCP_ORIGIN;
  if (opts.token !== null) headers.cookie = `${FORM_COOKIE}=${opts.token ?? TOKEN}`;
  const body = new URLSearchParams({ [FORM_FIELD]: TOKEN, ...fields });
  return signedRequest('/admin/clients', email, { method: 'POST', headers, body });
}

/** GET as the owner with the form cookie. */
async function view(path: string) {
  return signedRequest(path, OWNER, { headers: { cookie: `${FORM_COOKIE}=${TOKEN}` } });
}

async function createStatic(env: McpEnv, name = 'Microsoft'): Promise<Response> {
  return handleAdminClients(await post(OWNER, { action: 'create', client_name: name, redirect_uris: TEAMS }), env, deps);
}

test('counsel and non-members are refused; the owner sees the list and gets a form cookie', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  assert.equal((await handleAdminClients(await signedRequest('/admin/clients', COUNSEL), env, deps)).status, 403);
  assert.equal((await handleAdminClients(await signedRequest('/admin/clients', STRANGER), env, deps)).status, 403);
  assert.equal((await handleAdminClients(await signedRequest('/admin/clients', null), env, deps)).status, 403);
  assert.deepEqual(oauth.names(), []);
  const owner = await handleAdminClients(await signedRequest('/admin/clients', OWNER), env, deps);
  assert.equal(owner.status, 200);
  assert.match(owner.headers.get('set-cookie') ?? '', new RegExp(`^${FORM_COOKIE}=`));
  // Its forms post back here: same-origin keeps the real Origin that checkForm needs (null under no-referrer).
  assert.equal(owner.headers.get('referrer-policy'), 'same-origin');
  assert.equal(owner.headers.get('x-frame-options'), 'DENY');
});

test('counsel cannot post even with a valid form', async () => {
  const oauth = fakeOAuth();
  const request = await post(COUNSEL, { action: 'create', client_name: 'Microsoft', redirect_uris: TEAMS });
  assert.equal((await handleAdminClients(request, fakeEnv(oauth), deps)).status, 403);
  assert.deepEqual(oauth.names(), []);
});

test('cross-origin, origin-less and token-less posts are refused', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const fields = { action: 'create', client_name: 'Microsoft', redirect_uris: TEAMS };
  for (const opts of [{ origin: 'https://evil.example' }, { origin: null }, { token: null }, { token: 'x'.repeat(43) }]) {
    assert.equal((await handleAdminClients(await post(OWNER, fields, opts), env, deps)).status, 403, JSON.stringify(opts));
  }
  assert.deepEqual(oauth.names(), []);
});

test('creating a client indexes it and redirects (303) to a one-time view of its secret', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const request = await post(OWNER, { action: 'create', client_name: '  Microsoft   Copilot ', redirect_uris: `${TEAMS}\nhttps://global.consent.azure-apim.net/redirect/abc` });
  const response = await handleAdminClients(request, env, deps);
  assert.equal(response.status, 303);
  // No tokenEndpointAuthMethod: the library then issues a secret and accepts Basic or POST authentication.
  assert.deepEqual(oauth.calls.find((call) => call.name === 'createClient')?.args, [
    { clientName: 'Microsoft Copilot', redirectUris: [TEAMS, 'https://global.consent.azure-apim.net/redirect/abc'] },
  ]);
  assert.equal(oauth.kv.store.get(`${STATIC_CLIENT_PREFIX}static-1`), '1');
  const location = new URL(response.headers.get('location') ?? '');
  assert.equal(location.pathname, '/admin/clients');
  const ref = location.searchParams.get('created');
  // KV holds only ciphertext: never the secret itself.
  assert.ok(![...oauth.kv.store.values()].some((value) => value.includes('shown-once')));

  assert.deepEqual(await openCreated(env, TOKEN, ref), { clientId: 'static-1', clientSecret: 'shown-once', clientName: 'Microsoft Copilot' });
  assert.equal(await openCreated(env, TOKEN, ref), null, 'shown once');
});

test('the one-time view opens only in the browser that created it', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const ref = new URL((await createStatic(env)).headers.get('location') ?? '').searchParams.get('created');
  const other = formToken(new Request(`${MCP_ORIGIN}/`)).token;
  assert.equal(await openCreated(env, other, ref), null);
  assert.equal(await openCreated(env, TOKEN, ref), null, 'and the failed attempt used it up');
  assert.equal(await openCreated(env, TOKEN, '../../client:static-1'), null);
});

test('the redirect target page serves 200 and reading it consumes the secret', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const location = (await createStatic(env)).headers.get('location') ?? '';
  const first = await handleAdminClients(await view(location), env, deps);
  assert.equal(first.status, 200);
  assert.ok(![...oauth.kv.store.keys()].some((key) => key.startsWith('legallas-admin:created:')));
});

test('a redirect off the allowlist creates nothing and logs only its host', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const oauth = fakeOAuth();
  const request = await post(OWNER, { action: 'create', client_name: 'Other', redirect_uris: `${TEAMS}, https://evil.example/cb` });
  assert.equal((await handleAdminClients(request, fakeEnv(oauth), deps)).status, 400);
  assert.deepEqual(oauth.names(), []);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [['mcp_redirect_refused', 'evil.example']]);
});

test('a missing name or redirect is refused', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  for (const fields of [{ client_name: ' ', redirect_uris: TEAMS }, { client_name: 'x'.repeat(81), redirect_uris: TEAMS }, { client_name: 'Microsoft', redirect_uris: ' ' }]) {
    assert.equal((await handleAdminClients(await post(OWNER, { action: 'create', ...fields }), env, deps)).status, 400);
  }
  assert.deepEqual(oauth.names(), []);
});

test('if indexing fails the new client is removed again', async (t) => {
  t.mock.method(console, 'error', () => {});
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  oauth.kv.namespace.put = async () => {
    throw new Error('kv down');
  };
  assert.equal((await createStatic(env)).status, 500);
  assert.deepEqual(oauth.clients, []);
});

test('deleting a client revokes it, drops it from the index and goes back to the list', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  await createStatic(env);
  const response = await handleAdminClients(await post(OWNER, { action: 'delete', client_id: 'static-1' }), env, deps);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), `${MCP_ORIGIN}/admin/clients`);
  assert.ok(oauth.names().includes('deleteClient'));
  assert.equal(oauth.kv.store.has(`${STATIC_CLIENT_PREFIX}static-1`), false);
  assert.deepEqual((await staticClients(env)).rows, []);
});

const AZURE = 'https://global.consent.azure-apim.net/redirect/legallas-connector';

async function addRedirect(env: McpEnv, clientId: string, uris: string, opts: { origin?: string | null } = {}) {
  return handleAdminClients(await post(OWNER, { action: 'add_redirect', client_id: clientId, redirect_uris: uris }, opts), env, deps);
}

test('add_redirect appends allowlisted URIs to a static client and goes back to the list', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  await createStatic(env);
  const response = await addRedirect(env, 'static-1', `${AZURE}\n${TEAMS}`);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), `${MCP_ORIGIN}/admin/clients`);
  assert.deepEqual(oauth.calls.find((call) => call.name === 'updateClient')?.args, ['static-1', { redirectUris: [TEAMS, AZURE] }]);
  assert.deepEqual((await staticClients(env)).rows[0].redirectUris, [TEAMS, AZURE]);
});

test('add_redirect refuses dynamic registrations and unknown clients', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  oauth.register(1);
  assert.equal((await addRedirect(env, 'dcr-1', AZURE)).status, 404);
  assert.equal((await addRedirect(env, 'nobody', AZURE)).status, 404);
  assert.equal((await addRedirect(env, '', AZURE)).status, 404);
  assert.ok(!oauth.names().includes('updateClient'));
});

test('add_redirect refuses an unlisted URI, logging only its host', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  await createStatic(env);
  assert.equal((await addRedirect(env, 'static-1', `${AZURE}\nhttps://evil.example/cb`)).status, 400);
  assert.ok(!oauth.names().includes('updateClient'));
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [['mcp_redirect_refused', 'evil.example']]);
});

test('add_redirect keeps a client within ten redirect URIs', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  await createStatic(env);
  const nine = Array.from({ length: 9 }, (_, i) => `${AZURE}-${i}`).join('\n');
  assert.equal((await addRedirect(env, 'static-1', nine)).status, 303);
  assert.equal((await addRedirect(env, 'static-1', `${AZURE}-extra`)).status, 400);
  assert.equal((await addRedirect(env, 'static-1', `${AZURE}-0`)).status, 303, 'an existing URI is not counted twice');
});

test('add_redirect needs the owner and a same-origin form, and survives a library refusal', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  await createStatic(env);
  assert.equal((await addRedirect(env, 'static-1', AZURE, { origin: 'https://evil.example' })).status, 403);
  const counsel = await post(COUNSEL, { action: 'add_redirect', client_id: 'static-1', redirect_uris: AZURE });
  assert.equal((await handleAdminClients(counsel, env, deps)).status, 403);
  assert.ok(!oauth.names().includes('updateClient'));
  oauth.helpers.updateClient = async () => {
    throw new TypeError('redirect policy');
  };
  assert.equal((await addRedirect(env, 'static-1', AZURE)).status, 400);
});

test('an unknown action changes nothing', async () => {
  const oauth = fakeOAuth();
  assert.equal((await handleAdminClients(await post(OWNER, { action: 'purge' }), fakeEnv(oauth), deps)).status, 400);
  assert.deepEqual(oauth.names(), []);
});

async function flooded(): Promise<{ oauth: FakeOAuth; env: McpEnv }> {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  await createStatic(env);
  oauth.register(1500);
  return { oauth, env };
}

test('after a /register flood of 1,500 clients the static client is still listed, within the KV limit', async () => {
  const { oauth, env } = await flooded();
  const before = oauth.kv.ops;
  const rows = await staticClients(env);
  assert.deepEqual(rows.rows.map((row) => row.clientId), ['static-1']);
  assert.equal(rows.nextCursor, undefined);
  assert.ok(oauth.kv.ops - before < 10, `KV operations: ${oauth.kv.ops - before}`);
  assert.ok(!oauth.names().includes('listClients'));
});

test('the full list pages PAGE_SIZE clients per request with a cursor', async () => {
  const { oauth, env } = await flooded();
  const before = oauth.kv.ops;
  const first = await allClientsPage(env);
  assert.equal(first.rows.length, PAGE_SIZE);
  assert.ok(first.nextCursor);
  assert.ok(oauth.kv.ops - before <= PAGE_SIZE + 1);
  const second = await allClientsPage(env, first.nextCursor);
  assert.equal(second.rows[0].clientId, oauth.clients[PAGE_SIZE].clientId);
});

test('the page shows static clients by default and all clients with ?list=all', async () => {
  const { env } = await flooded();
  assert.equal((await handleAdminClients(await view('/admin/clients'), env, deps)).status, 200);
  const statics = await adminView(await view('/admin/clients'), env, TOKEN);
  assert.deepEqual(statics.clients.map((row) => row.clientId), ['static-1']);
  assert.equal(statics.list, 'static');
  const all = await adminView(await view('/admin/clients?list=all&cursor=50'), env, TOKEN);
  assert.equal(all.list, 'all');
  assert.equal(all.clients.length, PAGE_SIZE);
  assert.equal(all.clients[0].clientId, 'dcr-51');
  assert.equal(all.nextCursor, '100');
});

test('the view carries a new secret once, then never again', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const location = (await createStatic(env)).headers.get('location') ?? '';
  assert.equal((await adminView(await view(location), env, TOKEN)).created?.clientSecret, 'shown-once');
  assert.equal((await adminView(await view(location), env, TOKEN)).created, undefined);
});

test('parseRedirectUris dedupes, splits on lines and commas, and caps the count', () => {
  const env = fakeEnv();
  assert.deepEqual(parseRedirectUris(`${TEAMS}\n${TEAMS},\n`, env), [TEAMS]);
  assert.equal(parseRedirectUris(null, env), null);
  const many = Array.from({ length: 11 }, (_, i) => `http://localhost:${3000 + i}/cb`).join('\n');
  assert.equal(parseRedirectUris(many, env), null);
});

// ---- Sign-in callbacks a registration was refused for ----

const WAITING = 'https://connect.vendor.example/oauth/callback';
const waitingKey = (uri: string) => `${REFUSED_REDIRECT_PREFIX}${encodeURIComponent(uri)}`;
const allowedKey = (uri: string) => `${ALLOWED_REDIRECT_PREFIX}${encodeURIComponent(uri)}`;

async function pageHtml(env: McpEnv): Promise<string> {
  const response = await handleAdminClients(await view('/admin/clients'), env, deps);
  assert.equal(response.status, 200);
  return response.text();
}

test('the page lists waiting callbacks with Allow and Dismiss, allowed ones with Remove, and notes the wait at the top', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const empty = await pageHtml(env);
  assert.ok(empty.includes('<h2 id="callbacks">Sign-in callbacks waiting for approval</h2>'));
  assert.ok(empty.includes('No sign-in callbacks are waiting.'));
  assert.ok(empty.includes('No callbacks have been allowed here.'));
  assert.ok(!empty.includes('waiting for approval. <a'));

  oauth.kv.store.set(waitingKey(WAITING), '1');
  oauth.kv.store.set(allowedKey('https://ok.vendor.example/cb'), '1');
  const html = await pageHtml(env);
  assert.ok(html.includes('<p class="notice" role="status">1 sign-in callback is waiting for approval. <a href="#callbacks">Review</a></p>'));
  assert.ok(html.includes(`<span class="u-mono">${WAITING}</span>`));
  for (const action of [ADMIN_ACTIONS.allowCallback, ADMIN_ACTIONS.dismissCallback, ADMIN_ACTIONS.removeCallback]) {
    assert.ok(html.includes(`name="${FIELDS.action}" value="${action}"`), action);
  }
  assert.ok(html.includes(`name="${FIELDS.redirectUris}" value="${WAITING}"`));
  assert.ok(!html.includes('<script'));
  assert.equal(html.split('<h1').length - 1, 1);
});

test('Allow moves a waiting callback to the allowed list; Dismiss and Remove delete; each goes back to the page', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  oauth.kv.store.set(waitingKey(WAITING), '1');
  oauth.kv.store.set(waitingKey('https://other.example/cb'), '1');
  const allow = await handleAdminClients(await post(OWNER, { action: ADMIN_ACTIONS.allowCallback, redirect_uris: WAITING }), env, deps);
  assert.equal(allow.status, 303);
  assert.equal(new URL(allow.headers.get('location') ?? '').pathname, '/admin/clients');
  assert.equal(oauth.kv.store.has(waitingKey(WAITING)), false);
  assert.equal(oauth.kv.store.has(allowedKey(WAITING)), true);
  assert.equal(await loadAllowedRedirects(env), `=${WAITING}`);

  const dismiss = await handleAdminClients(await post(OWNER, { action: ADMIN_ACTIONS.dismissCallback, redirect_uris: 'https://other.example/cb' }), env, deps);
  assert.equal(dismiss.status, 303);
  assert.equal(oauth.kv.store.has(waitingKey('https://other.example/cb')), false);
  assert.equal(oauth.kv.store.has(allowedKey('https://other.example/cb')), false);

  const remove = await handleAdminClients(await post(OWNER, { action: ADMIN_ACTIONS.removeCallback, redirect_uris: WAITING }), env, deps);
  assert.equal(remove.status, 303);
  assert.equal(await loadAllowedRedirects(env), '');
});

test('Allow needs a waiting callback, the owner and a same-origin form', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const fields = { action: ADMIN_ACTIONS.allowCallback, redirect_uris: WAITING };
  assert.equal((await handleAdminClients(await post(OWNER, fields), env, deps)).status, 404, 'not waiting');
  assert.equal((await handleAdminClients(await post(OWNER, { ...fields, redirect_uris: 'http://plain.example/cb' }), env, deps)).status, 404);
  oauth.kv.store.set(waitingKey(WAITING), '1');
  assert.equal((await handleAdminClients(await post(COUNSEL, fields), env, deps)).status, 403);
  assert.equal((await handleAdminClients(await post(OWNER, fields, { origin: 'https://evil.example' }), env, deps)).status, 403);
  assert.equal((await handleAdminClients(await post(OWNER, fields, { token: null }), env, deps)).status, 403);
  assert.equal((await handleAdminClients(await post(OWNER, { action: ADMIN_ACTIONS.dismissCallback, redirect_uris: 'javascript:x' }), env, deps)).status, 400);
  assert.equal(oauth.kv.store.has(waitingKey(WAITING)), true);
  assert.equal([...oauth.kv.store.keys()].some((key) => key.startsWith(ALLOWED_REDIRECT_PREFIX)), false);
});

test('with "zero retention only", a waiting Claude or Microsoft callback has no Allow, and posting one is refused (card 12.5)', async () => {
  const claude = 'https://claude.ai/api/mcp/auth_callback';
  const vendor = 'https://ok.vendor.example/cb';
  const allows = (html: string) => html.split(`value="${ADMIN_ACTIONS.allowCallback}"`).length - 1;
  const oauth = fakeOAuth();
  oauth.kv.store.set(waitingKey(claude), '1');
  oauth.kv.store.set(waitingKey(vendor), '1');
  const env = fakeEnv(oauth, { AI_POLICY: 'zdr' });
  const html = await pageHtml(env);
  assert.equal(allows(html), 1, 'Allow stays for the vendor callback only');
  assert.match(html, /be allowed: this room is zero retention only/);
  const refused = await handleAdminClients(await post(OWNER, { action: ADMIN_ACTIONS.allowCallback, redirect_uris: claude }), env, deps);
  assert.equal(refused.status, 400);
  assert.equal(oauth.kv.store.has(waitingKey(claude)), true);
  assert.equal([...oauth.kv.store.keys()].some((key) => key.startsWith(ALLOWED_REDIRECT_PREFIX)), false);
  assert.equal(allows(await pageHtml(fakeEnv(oauth))), 2, 'with no policy, Allow for both');
});
