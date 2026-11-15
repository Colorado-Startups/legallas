// SPDX-License-Identifier: Apache-2.0
// Delete old smoke clients on /admin/clients: owner only, the same form protection as every other action, one
// bounded pass of mcp/smoke-clients.ts per press, then All clients with the counts. Pressing while the note says more
// may remain must end, however many clients are registered.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS, MCP_ORIGIN, SMOKE_CLIENT_NAME, STATIC_CLIENT_PREFIX } from './contract.ts';
import { FORM_COOKIE, FORM_FIELD, formToken } from './forms.ts';
import { ADMIN_ACTIONS, handleAdminClients, sweptNotice } from './admin-clients.ts';
import { COUNSEL, OWNER, fakeEnv, fakeOAuth, getKey, signedRequest } from './oauth-fakes.ts';

const deps = { getKey };
const TOKEN = formToken(new Request(`${MCP_ORIGIN}/`)).token;
const TEAMS = 'https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect';
const DAY = 24 * 3600;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const old = () => ({ clientName: SMOKE_CLIENT_NAME, registrationDate: nowSeconds() - 2 * DAY });

async function post(email: string, fields: Record<string, string>, opts: { origin?: string | null; token?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (opts.origin !== null) headers.origin = opts.origin ?? MCP_ORIGIN;
  if (opts.token !== null) headers.cookie = `${FORM_COOKIE}=${opts.token ?? TOKEN}`;
  return signedRequest('/admin/clients', email, { method: 'POST', headers, body: new URLSearchParams({ [FORM_FIELD]: TOKEN, ...fields }) });
}

const press = async (env: Parameters<typeof handleAdminClients>[1]) => handleAdminClients(await post(OWNER, { action: ADMIN_ACTIONS.sweepSmoke }), env, deps);

function quietLog(t: TestContext): void {
  t.mock.method(console, 'log', () => {});
}

test('Delete old smoke clients deletes only old legallas-smoke registrations, then shows All clients with the count', async (t) => {
  quietLog(t);
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  await handleAdminClients(await post(OWNER, { action: 'create', client_name: SMOKE_CLIENT_NAME, redirect_uris: TEAMS }), env, deps);
  oauth.register(3, old());
  oauth.register(1, { clientName: SMOKE_CLIENT_NAME, registrationDate: nowSeconds() - 60 });
  oauth.register(1, { ...old(), clientName: 'legallas-smoke-harvey' });
  const response = await press(env);
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get('location') ?? '');
  assert.equal(`${location.pathname}${location.search}`, '/admin/clients?list=all&swept=3');
  assert.deepEqual(oauth.calls.filter((call) => call.name === 'deleteClient').map((call) => call.args[0]), ['dcr-2', 'dcr-3', 'dcr-4']);
  assert.deepEqual(oauth.clients.map((client) => client.clientId), ['static-1', 'dcr-5', 'dcr-6'], 'the static, fresh and connect-e2e clients stay');
  assert.equal(oauth.kv.store.get(`${STATIC_CLIENT_PREFIX}static-1`), '1');
  const page = await handleAdminClients(await signedRequest(location.href, OWNER, { headers: { cookie: `${FORM_COOKIE}=${TOKEN}` } }), env, deps);
  const html = await page.text();
  assert.ok(html.includes('<p class="notice" role="status">Deleted 3 old smoke clients.</p>'));
  assert.ok(html.includes(`name="${FIELDS.action}" value="${ADMIN_ACTIONS.sweepSmoke}"`));
});

test('with more than 100 clients, pressing until the note drops "more" deletes every old smoke client and ends', async (t) => {
  quietLog(t);
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  for (let i = 0; i < 40; i++) {
    oauth.register(3, { clientName: 'Claude' });
    oauth.register(1, old());
  }
  assert.equal(oauth.clients.length, 160);
  const seen: string[] = [];
  for (let presses = 0; presses < 20; presses++) {
    const location = new URL((await press(env)).headers.get('location') ?? '');
    seen.push(location.search);
    if (location.searchParams.get(FIELDS.more) === null) break;
  }
  assert.ok(seen.length <= 4, `presses: ${seen.join(' ')}`);
  assert.ok(seen.slice(0, -1).every((search) => search.includes('more=1')), 'more on every press but the last');
  assert.equal(oauth.clients.filter((client) => client.clientName === SMOKE_CLIENT_NAME).length, 0);
  assert.equal(oauth.clients.length, 120, 'every Claude client stays');
});

test('Delete old smoke clients needs the owner and a same-origin form', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  oauth.register(2, old());
  const fields = { action: ADMIN_ACTIONS.sweepSmoke };
  assert.equal((await handleAdminClients(await post(COUNSEL, fields), env, deps)).status, 403);
  assert.equal((await handleAdminClients(await post(OWNER, fields, { origin: 'https://evil.example' }), env, deps)).status, 403);
  assert.equal((await handleAdminClients(await post(OWNER, fields, { origin: null }), env, deps)).status, 403);
  assert.equal((await handleAdminClients(await post(OWNER, fields, { token: null }), env, deps)).status, 403);
  assert.ok(!oauth.names().includes('deleteClient'));
  assert.equal(oauth.clients.length, 2);
});

test('a failing smoke sweep shows an error page and logs only a code', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  oauth.register(1, old());
  oauth.helpers.lookupClient = async () => {
    throw new TypeError('kv down');
  };
  assert.equal((await press(env)).status, 500);
  assert.deepEqual(error.mock.calls.map((call) => call.arguments), [['mcp_admin_smoke_sweep_failed', 'TypeError']]);
});

test('a refused sweep (too many legacy grants to check) deletes nothing and says to delete by hand', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  oauth.register(1, old());
  // The shared fake lists keys without metadata, so every grant is a legacy one that must be read.
  for (let i = 0; i < 60; i++) oauth.kv.store.set(`grant:u@firm.example:g${String(i).padStart(2, '0')}`, '{}');
  const response = await press(env);
  assert.equal(response.status, 503);
  assert.match(await response.text(), /nothing was deleted/);
  assert.ok(!oauth.names().includes('deleteClient'));
  assert.deepEqual(error.mock.calls.map((call) => call.arguments), [['mcp_admin_smoke_sweep_failed', 'SmokeSweepRefused']]);
});

test('sweptNotice reads only the counts a sweep redirects with', () => {
  const notice = (query: string) => sweptNotice(new URLSearchParams(query));
  assert.deepEqual(notice('list=all&swept=12'), { deleted: 12, more: false });
  assert.deepEqual(notice('swept=0&more=1'), { deleted: 0, more: true });
  for (const query of ['', 'swept=', 'swept=-1', 'swept=1.5', 'swept=12345', 'swept=%3Cb%3E', 'more=1']) assert.equal(notice(query), undefined, query);
});
