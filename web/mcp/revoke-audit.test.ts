// SPDX-License-Identifier: Apache-2.0
// The RFC 7009 revocation audit with a fake KV and a fake library forward that behaves like the library: a refresh
// token deletes the grant, an access token deletes only its own token, and every outcome answers 200. One test
// writes through the real aiAudit on SQLite.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from '../worker/sqlite-d1.ts';
import type { AiAuditEntry } from './audit.ts';
import { MCP_ORIGIN } from './contract.ts';
import { MAX_PREREAD_BYTES } from './oauth-request.ts';
import { REVOKE_VIA, grantRefFromToken, viaForGrant, withRevocationAudit, type RevokeAuditEnv } from './revoke-audit.ts';

const ADA = 'ada@firm.example';
const GRANT = 'g1';
const GRANT_KEY = `grant:${ADA}:${GRANT}`;
const REFRESH = `${ADA}:${GRANT}:refresh-secret`;
const ACCESS = `${ADA}:${GRANT}:access-secret`;

/** A KV whose values are JSON strings: a 'json' read parses, a plain read returns the text, like Workers KV. */
function fakeKv(entries: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]));
  const kv = {
    async get(key: string, type?: string) {
      const value = store.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
  return { kv: kv as unknown as KVNamespace, store };
}

function grant(clientId = 'client-1', clientName: string | null = 'Harvey') {
  return { id: GRANT, userId: ADA, clientId, ...(clientName === null ? {} : { metadata: { clientName, approvedAt: '2026-10-01T00:00:00Z' } }) };
}

/** Stands in for provider.fetch: reads the original body, then revokes the way the library would. */
function fakeLibrary(store: Map<string, string>, status = 200) {
  const seen: string[] = [];
  const forward = async (request: Request) => {
    const form = await request.formData();
    const token = String(form.get('token') ?? '');
    seen.push(token);
    if (status === 200 && token === REFRESH) store.delete(GRANT_KEY);
    return new Response('', { status });
  };
  return { forward, seen };
}

function setup(entries: Record<string, unknown> = { [GRANT_KEY]: grant() }) {
  const { kv, store } = fakeKv(entries);
  const env = { DB: {} as D1Database, OAUTH_KV: kv } as RevokeAuditEnv;
  const audits: AiAuditEntry[] = [];
  const audit = async (_env: unknown, entry: AiAuditEntry) => void audits.push(entry);
  return { env, store, audits, audit };
}

function tokenRequest(fields: Record<string, string>, init: { contentType?: string; method?: string; path?: string } = {}): Request {
  return new Request(`${MCP_ORIGIN}${init.path ?? '/token'}`, {
    method: init.method ?? 'POST',
    headers: { 'Content-Type': init.contentType ?? 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '203.0.113.7' },
    body: new URLSearchParams(fields).toString(),
  });
}

function captureLogs(t: TestContext): string[] {
  const lines: string[] = [];
  const record = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  for (const level of ['log', 'warn', 'error'] as const) t.mock.method(console, level, record);
  return lines;
}

test('grantRefFromToken follows the library: three parts, user and grant non-empty', () => {
  assert.deepEqual(grantRefFromToken(REFRESH), { userId: ADA, grantId: GRANT });
  for (const token of ['', 'a:b', 'a:b:c:d', ':g:s', 'u::s', 'opaque']) assert.equal(grantRefFromToken(token), null, token);
});

test('revoking a refresh token writes one ai_disconnect for the member, via the app name', async () => {
  const { env, store, audits, audit } = setup();
  const library = fakeLibrary(store);
  const request = tokenRequest({ token: REFRESH, token_type_hint: 'refresh_token' });
  const response = await withRevocationAudit(request, env, library.forward, audit);
  assert.equal(response.status, 200);
  assert.deepEqual(library.seen, [REFRESH], 'the library still reads the original body');
  assert.equal(audits.length, 1);
  const [entry] = audits;
  assert.deepEqual({ ...entry, request: undefined }, { email: ADA, action: 'ai_disconnect', documentId: null, via: 'Harvey', request: undefined });
  assert.equal(entry.request, request);
});

test('revoking an access token leaves the grant and writes nothing', async () => {
  const { env, store, audits, audit } = setup();
  const response = await withRevocationAudit(tokenRequest({ token: ACCESS }), env, fakeLibrary(store).forward, audit);
  assert.equal(response.status, 200);
  assert.ok(store.has(GRANT_KEY));
  assert.deepEqual(audits, []);
});

test('a grant that did not exist before, or a non-200 answer, writes nothing', async () => {
  const missing = setup({});
  await withRevocationAudit(tokenRequest({ token: REFRESH }), missing.env, fakeLibrary(missing.store).forward, missing.audit);
  assert.deepEqual(missing.audits, []);
  const refused = setup();
  const response = await withRevocationAudit(tokenRequest({ token: REFRESH }), refused.env, fakeLibrary(refused.store, 401).forward, refused.audit);
  assert.equal(response.status, 401);
  assert.deepEqual(refused.audits, []);
});

test('token grants, other routes and other content types pass straight through', async () => {
  const cases = [
    tokenRequest({ grant_type: 'refresh_token', refresh_token: REFRESH }),
    tokenRequest({ grant_type: 'authorization_code', token: REFRESH }),
    tokenRequest({ token: 'opaque-token' }),
    tokenRequest({ token: REFRESH }, { path: '/register' }),
    tokenRequest({ token: REFRESH }, { contentType: 'application/json' }),
  ];
  for (const request of cases) {
    const { env, store, audits, audit } = setup();
    let forwarded = 0;
    const forward = async (req: Request) => {
      forwarded++;
      assert.equal(req, request, 'the original request is forwarded');
      store.delete(GRANT_KEY);
      return new Response('', { status: 200 });
    };
    await withRevocationAudit(request, env, forward, audit);
    assert.equal(forwarded, 1);
    assert.deepEqual(audits, [], request.url);
  }
});

test('a failed audit write keeps the 200 and logs a code, never the token', async (t) => {
  const logs = captureLogs(t);
  const { env, store } = setup();
  const failing = async () => Promise.reject(new Error(`D1 said ${REFRESH}`));
  const response = await withRevocationAudit(tokenRequest({ token: REFRESH }), env, fakeLibrary(store).forward, failing);
  assert.equal(response.status, 200);
  assert.deepEqual(logs, ['mcp_revoke_audit_failed']);
  assert.ok(logs.every((line) => !line.includes('secret')));
});

test('a form-encoded /token body over MAX_PREREAD_BYTES gets a 413 in the OAuth error shape and never reaches the library', async (t) => {
  const logs = captureLogs(t);
  const pad = 'x'.repeat(MAX_PREREAD_BYTES);
  const cases = [
    tokenRequest({ token: REFRESH, pad }),
    tokenRequest({ grant_type: 'authorization_code', code: 'c', pad }),
    new Request(`${MCP_ORIGIN}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(MAX_PREREAD_BYTES + 1) },
      body: `token=${REFRESH}`,
    }),
  ];
  for (const request of cases) {
    const { env, store, audits, audit } = setup();
    let forwarded = 0;
    const forward = async () => {
      forwarded++;
      return new Response('', { status: 200 });
    };
    const response = await withRevocationAudit(request, env, forward, audit);
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'invalid_request', error_description: 'The token request is too large.' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(forwarded, 0);
    assert.ok(store.has(GRANT_KEY));
    assert.deepEqual(audits, []);
  }
  assert.deepEqual(logs, ['mcp_token_too_large', 'mcp_token_too_large', 'mcp_token_too_large']);
  // Exactly the limit is still read and revoked.
  const { env, store, audits, audit } = setup();
  const fields = { token: REFRESH, pad: '' };
  fields.pad = 'x'.repeat(MAX_PREREAD_BYTES - new URLSearchParams(fields).toString().length);
  const atLimit = tokenRequest(fields);
  assert.equal((await withRevocationAudit(atLimit, env, fakeLibrary(store).forward, audit)).status, 200);
  assert.equal(audits.length, 1);
});

test('a /register body over MAX_PREREAD_BYTES gets a 413 before the library reads it; one at the limit goes on', async (t) => {
  const logs = captureLogs(t);
  const metadata = (pad: string) => JSON.stringify({ client_name: 'Example App', redirect_uris: ['https://app.example.test/cb'], pad });
  const big = metadata('x'.repeat(MAX_PREREAD_BYTES));
  let pulled = 0;
  const chunk = new TextEncoder().encode('x'.repeat(4096));
  const streamed = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += chunk.byteLength;
      if (pulled > 4 * 1024 * 1024) controller.close();
      else controller.enqueue(chunk);
    },
  });
  const cases = [
    new Request(`${MCP_ORIGIN}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big }),
    new Request(`${MCP_ORIGIN}/register`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: big }),
    new Request(`${MCP_ORIGIN}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(MAX_PREREAD_BYTES + 1) },
      body: metadata(''),
    }),
    new Request(`${MCP_ORIGIN}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: streamed, duplex: 'half' } as RequestInit),
  ];
  for (const request of cases) {
    const { env } = setup();
    let forwarded = 0;
    const forward = async () => {
      forwarded++;
      return new Response('{}', { status: 201 });
    };
    const response = await withRevocationAudit(request, env, forward);
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'invalid_client_metadata', error_description: 'The registration request is too large.' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(forwarded, 0, 'the library never sees it');
  }
  assert.ok(pulled < 64 * 1024, `pulled ${pulled} bytes of a 4 MiB streamed body`);
  assert.deepEqual(logs, Array(4).fill('mcp_register_too_large'));
  // Exactly the limit goes on to the library, which reads the original body whole.
  const atLimit = metadata('x'.repeat(MAX_PREREAD_BYTES - metadata('').length));
  assert.equal(new TextEncoder().encode(atLimit).byteLength, MAX_PREREAD_BYTES);
  const { env } = setup();
  let read = '';
  const forward = async (request: Request) => {
    read = await request.text();
    return new Response('{}', { status: 201 });
  };
  const response = await withRevocationAudit(new Request(`${MCP_ORIGIN}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: atLimit }), env, forward);
  assert.equal(response.status, 201);
  assert.equal(read, atLimit);
});

test('via falls back to the client record, then a CIMD host, then REVOKE_VIA', async () => {
  const { kv } = fakeKv({ 'client:dcr-1': { clientId: 'dcr-1', clientName: 'Copilot Studio' }, 'client:blank': { clientName: ' ' } });
  assert.equal(await viaForGrant(kv, grant('dcr-1', null)), 'Copilot Studio');
  assert.equal(await viaForGrant(kv, grant('dcr-1', '  ')), 'Copilot Studio');
  assert.equal(await viaForGrant(kv, grant('https://claude.ai/oauth/mcp-oauth-client-metadata', null)), 'claude.ai');
  assert.equal(await viaForGrant(kv, grant('blank', null)), REVOKE_VIA);
  assert.equal(await viaForGrant(kv, grant('gone', null)), REVOKE_VIA);
  assert.equal(await viaForGrant(kv, {}), REVOKE_VIA);
});

test('with the real aiAudit, the row lands in audit_log with via, ip and no token', async () => {
  const { db, sqlite } = testDb();
  const { kv, store } = fakeKv({ [GRANT_KEY]: grant('client-1', 'Harvey') });
  const env = { DB: db, OAUTH_KV: kv } as RevokeAuditEnv;
  await withRevocationAudit(tokenRequest({ token: REFRESH }), env, fakeLibrary(store).forward);
  const rows = sqlite.prepare('SELECT email, action, document_id, ip, via FROM audit_log').all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ email: ADA, action: 'ai_disconnect', document_id: null, ip: '203.0.113.7', via: 'Harvey' }]);
});
