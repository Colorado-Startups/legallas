// SPDX-License-Identifier: Apache-2.0
// /connections with a fake OAuth helper and real SQLite: who sees which connections, who may revoke which,
// the form protection, and the ai_disconnect audit. The fake pages grants two at a time, like a KV listing.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { GrantSummary } from '@cloudflare/workers-oauth-provider';
import type { Member } from '../worker/env.ts';
import { testDb } from '../worker/sqlite-d1.ts';
import type { AiAuditEntry } from './audit.ts';
import { grantStore, handleConnections, visibleConnections } from './connections.ts';
import type { McpEnv, OAuthHelpersLike } from './contract.ts';
import { FORM_COOKIE, FORM_FIELD, GRANT_FIELD, formToken } from './forms.ts';

const ORIGIN = 'https://mcp.room.example.com';
const OWNER: Member = { email: 'owner@example.test', role: 'owner', name: 'Owner' };
const ADA: Member = { email: 'ada@firm.example', role: 'counsel', name: null };
const BO: Member = { email: 'bo@firm.example', role: 'counsel', name: null };

function grant(id: string, userId: string, createdAt: number, clientName?: string): GrantSummary {
  const metadata = clientName === undefined ? undefined : { clientName, approvedAt: '2026-10-01T00:00:00Z' };
  return { id, clientId: `client-${id}`, userId, scope: ['case.read'], metadata, createdAt, expiresAt: createdAt + 30 * 86400 };
}

function fakeOAuth(grants: GrantSummary[]) {
  const revoked: { grantId: string; userId: string }[] = [];
  let live = [...grants];
  const helpers = {
    async listUserGrants(userId: string, options?: { limit?: number; cursor?: string }) {
      const mine = live.filter((g) => g.userId === userId);
      const start = Number(options?.cursor ?? 0);
      const items = mine.slice(start, start + 2);
      return { items, cursor: start + 2 < mine.length ? String(start + 2) : undefined };
    },
    async revokeGrant(grantId: string, userId: string) {
      revoked.push({ grantId, userId });
      // Like the library: the key is grant:<userId>:<grantId>, so another member's grant is untouched.
      live = live.filter((g) => !(g.id === grantId && g.userId === userId));
    },
  } as unknown as OAuthHelpersLike;
  return { helpers, revoked };
}

function setup() {
  const { db, sqlite } = testDb();
  for (const m of [OWNER, ADA, BO]) sqlite.prepare('INSERT INTO members (email, role, name) VALUES (?, ?, ?)').run(m.email, m.role, m.name);
  const { helpers, revoked } = fakeOAuth([
    grant('adaClaude0001', ADA.email, 100, 'Claude'),
    grant('adaHarvey0001', ADA.email, 300, 'Harvey'),
    grant('adaCopilot001', ADA.email, 200, '  '),
    grant('boCopilot0001', BO.email, 150, 'Microsoft Copilot'),
    grant('goneMember001', 'removed@firm.example', 400, 'Claude'),
  ]);
  const env = { DB: db, OAUTH_PROVIDER: helpers, TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv;
  const audits: AiAuditEntry[] = [];
  const audit = async (_env: Pick<McpEnv, 'DB'>, entry: AiAuditEntry) => void audits.push(entry);
  return { env, revoked, audits, audit };
}

const TOKEN = formToken(new Request(`${ORIGIN}/connections`)).token;

function revokePost(grantId: string, options: { origin?: string | null; field?: string; cookie?: string } = {}) {
  const headers = new Headers({ cookie: `${FORM_COOKIE}=${options.cookie ?? TOKEN}` });
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin) headers.set('origin', origin);
  const body = new FormData();
  body.set(FORM_FIELD, options.field ?? TOKEN);
  body.set(GRANT_FIELD, grantId);
  return new Request(`${ORIGIN}/connections`, { method: 'POST', headers, body });
}

test('grantStore pages through every grant and names the app from metadata, else the client id', async () => {
  const { env } = setup();
  const rows = await grantStore(env).listForMember(ADA.email);
  assert.deepEqual(
    rows.map((r) => [r.grantId, r.email, r.clientName, r.createdAt, r.expiresAt]),
    [
      ['adaClaude0001', ADA.email, 'Claude', 100, 100 + 30 * 86400],
      ['adaHarvey0001', ADA.email, 'Harvey', 300, 300 + 30 * 86400],
      ['adaCopilot001', ADA.email, 'client-adaCopilot001', 200, 200 + 30 * 86400],
    ],
  );
});

test('counsel see only their own connections, newest first', async () => {
  const { env } = setup();
  const rows = await visibleConnections(env, ADA);
  assert.deepEqual(rows.map((r) => r.grantId), ['adaHarvey0001', 'adaCopilot001', 'adaClaude0001']);
  assert.deepEqual((await visibleConnections(env, BO)).map((r) => r.grantId), ['boCopilot0001']);
});

test("the owner sees every member's connections, and only members'", async () => {
  const { env } = setup();
  const rows = await visibleConnections(env, OWNER);
  assert.deepEqual(rows.map((r) => r.grantId), ['adaHarvey0001', 'adaCopilot001', 'adaClaude0001', 'boCopilot0001']);
});

test('GET renders the page with a form cookie for a new browser; other methods get 405', async () => {
  const { env } = setup();
  const page = await handleConnections(new Request(`${ORIGIN}/connections`), env, ADA);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  assert.ok(page.headers.get('set-cookie')?.startsWith(`${FORM_COOKIE}=`));
  // Disconnect posts back here: same-origin keeps the real Origin that checkForm needs (null under no-referrer).
  assert.equal(page.headers.get('referrer-policy'), 'same-origin');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  const put = await handleConnections(new Request(`${ORIGIN}/connections`, { method: 'PUT' }), env, ADA);
  assert.equal(put.status, 405);
  assert.equal(put.headers.get('allow'), 'GET, HEAD, POST');
});

test('counsel revoke their own connection, and ai_disconnect names the app', async () => {
  const { env, revoked, audits, audit } = setup();
  const response = await handleConnections(revokePost('adaHarvey0001'), env, ADA, audit);
  assert.equal(response.status, 200);
  assert.deepEqual(revoked, [{ grantId: 'adaHarvey0001', userId: ADA.email }]);
  assert.equal(audits.length, 1);
  const [entry] = audits;
  assert.deepEqual({ ...entry, request: undefined }, { email: ADA.email, action: 'ai_disconnect', documentId: null, via: 'Harvey', request: undefined });
  assert.ok(entry.request instanceof Request);
  assert.deepEqual((await visibleConnections(env, ADA)).map((r) => r.grantId), ['adaCopilot001', 'adaClaude0001']);
});

test("counsel cannot revoke another member's connection", async () => {
  const { env, revoked, audits, audit } = setup();
  const response = await handleConnections(revokePost('boCopilot0001'), env, ADA, audit);
  assert.equal(response.status, 404);
  assert.deepEqual(revoked, []);
  assert.deepEqual(audits, []);
  assert.equal((await visibleConnections(env, BO)).length, 1);
});

test("the owner revokes a member's connection under that member's id; the audit row records the owner", async () => {
  const { env, revoked, audits, audit } = setup();
  const response = await handleConnections(revokePost('boCopilot0001'), env, OWNER, audit);
  assert.equal(response.status, 200);
  assert.deepEqual(revoked, [{ grantId: 'boCopilot0001', userId: BO.email }]);
  assert.equal(audits[0]?.email, OWNER.email);
  assert.equal(audits[0]?.via, 'Microsoft Copilot');
});

test('cross-origin, missing-origin and bad-token posts are refused before anything is revoked', async () => {
  const other = formToken(new Request(`${ORIGIN}/`)).token;
  for (const options of [{ origin: 'https://evil.example' }, { origin: null }, { field: other }, { cookie: other }]) {
    const { env, revoked, audits, audit } = setup();
    const response = await handleConnections(revokePost('adaHarvey0001', options), env, ADA, audit);
    assert.equal(response.status, 403, JSON.stringify(options));
    assert.deepEqual(revoked, []);
    assert.deepEqual(audits, []);
  }
});

test('a missing or malformed grant id is a 400', async () => {
  for (const id of ['', 'a', 'has space in it!', 'x'.repeat(65)]) {
    const { env, revoked, audit } = setup();
    const response = await handleConnections(revokePost(id), env, ADA, audit);
    assert.equal(response.status, 400, id);
    assert.deepEqual(revoked, []);
  }
});

test('the grant is revoked before the audit row is written', async () => {
  const { env, revoked, audit } = setup();
  const order: string[] = [];
  const spyAudit: typeof audit = async (e, entry) => {
    order.push(`audit after ${revoked.length} revoke`);
    await audit(e, entry);
  };
  await handleConnections(revokePost('adaClaude0001'), env, ADA, spyAudit);
  assert.deepEqual(order, ['audit after 1 revoke']);
});

test('a failed audit write still disconnects (a logging failure never keeps access alive) and logs a code only', async (t: TestContext) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => void logged.push(args));
  const { env, revoked } = setup();
  const failing = async () => {
    throw Object.assign(new Error('mcp_audit_failed'), { name: 'AuditError' });
  };
  const response = await handleConnections(revokePost('adaClaude0001'), env, ADA, failing);
  assert.equal(response.status, 200);
  assert.deepEqual(revoked, [{ grantId: 'adaClaude0001', userId: ADA.email }]);
  assert.deepEqual((await visibleConnections(env, ADA)).map((r) => r.grantId), ['adaHarvey0001', 'adaCopilot001']);
  assert.deepEqual(logged, [[JSON.stringify({ event: 'connections.audit_failed', code: 'AuditError' })]]);
});

test('a failed revoke is a 503, writes no audit row and logs a code only', async (t: TestContext) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => void logged.push(args));
  const { env, audits, audit } = setup();
  const helpers = env.OAUTH_PROVIDER as unknown as { revokeGrant: () => Promise<void> };
  helpers.revokeGrant = async () => {
    throw new TypeError(`KV delete failed for grant:${ADA.email}:adaClaude0001`);
  };
  const response = await handleConnections(revokePost('adaClaude0001'), env, ADA, audit);
  assert.equal(response.status, 503);
  assert.deepEqual(audits, []);
  assert.deepEqual(logged, [[JSON.stringify({ event: 'connections.revoke_failed', code: 'TypeError' })]]);
});
