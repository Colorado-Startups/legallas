// SPDX-License-Identifier: Apache-2.0
// The orphan-grant sweep with a fake KV, a fake OAuth helper and real SQLite. The fake KV pages its listings
// three keys at a time and the fake helper deletes the grant key on revoke, like the library.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { PurgeOptions, PurgeResult } from '@cloudflare/workers-oauth-provider';
import { addLeftoverFamily } from '../worker/gate-fixtures.ts';
import { testDb } from '../worker/sqlite-d1.ts';
import type { AiAuditEntry } from './audit.ts';
import type { McpEnv } from './contract.ts';
import { MAX_REVOKES_PER_RUN, PURGE_CURSOR_KEY, SWEEP_VIA, parseGrantKey, sweepOrphanGrants } from './sweep.ts';

const OWNER = 'owner@example.test';
const ADA = 'ada@firm.example';
const GONE = 'gone@firm.example';

function fakeKv(entries: Record<string, unknown>, pageSize = 3) {
  const store = new Map(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]));
  const kv = {
    async list({ prefix = '', limit = 1000, cursor }: { prefix?: string; limit?: number; cursor?: string }) {
      const names = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = Number(cursor ?? 0);
      const end = Math.min(start + Math.min(limit, pageSize), names.length);
      const done = end >= names.length;
      return { keys: names.slice(start, end).map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(end) };
    },
    // Values are stored as JSON, so a text read of a put() string and a 'json' read of a record both parse.
    async get(key: string) {
      const value = store.get(key);
      return value === undefined ? null : JSON.parse(value);
    },
    async put(key: string, value: string) {
      store.set(key, JSON.stringify(value));
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
  return { kv: kv as unknown as KVNamespace, store };
}

function grantRecord(id: string, clientName?: string) {
  return { id, clientId: `client-${id}`, metadata: clientName === undefined ? null : { clientName, approvedAt: '2026-10-01T00:00:00Z' } };
}

function setup(entries: Record<string, unknown>, options: { members?: string[]; purge?: (o?: PurgeOptions) => Promise<PurgeResult> } = {}) {
  const { db, sqlite } = testDb();
  for (const email of options.members ?? [OWNER, ADA]) sqlite.prepare("INSERT INTO members (email, role) VALUES (?, 'counsel')").run(email);
  const { kv, store } = fakeKv(entries);
  const revoked: string[] = [];
  const helpers: Record<string, unknown> = {
    async revokeGrant(grantId: string, userId: string) {
      revoked.push(`${userId}:${grantId}`);
      store.delete(`grant:${userId}:${grantId}`);
    },
  };
  if (options.purge) helpers.purgeExpiredData = options.purge;
  const env = { DB: db, OAUTH_KV: kv, OAUTH_PROVIDER: helpers } as unknown as McpEnv;
  const audits: AiAuditEntry[] = [];
  const audit = async (_env: Pick<McpEnv, 'DB'>, entry: AiAuditEntry) => void audits.push(entry);
  return { env, store, revoked, audits, audit, sqlite };
}

const QUIET = (t: TestContext) => {
  t.mock.method(console, 'log', () => {});
  const errors: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => void errors.push(args));
  return errors;
};

test('parseGrantKey accepts only grant:<userId>:<grantId>', () => {
  assert.deepEqual(parseGrantKey(`grant:${ADA}:g1`), { key: `grant:${ADA}:g1`, userId: ADA, grantId: 'g1' });
  for (const key of ['token:a:b:c', 'grant:', 'grant:a', 'grant::g1', 'grant:a:', 'grant:a:b:c', 'client:x']) assert.equal(parseGrantKey(key), null, key);
});

test("revokes only removed members' grants, audits each with the app's name, across listing pages", async (t) => {
  QUIET(t);
  const { env, store, revoked, audits, audit } = setup({
    [`grant:${OWNER}:o1`]: grantRecord('o1', 'Claude'),
    [`grant:${ADA}:a1`]: grantRecord('a1', 'Harvey'),
    [`grant:${ADA}:a2`]: grantRecord('a2', 'Claude'),
    [`grant:${GONE}:x1`]: grantRecord('x1', 'Microsoft Copilot'),
    [`grant:${GONE}:x2`]: grantRecord('x2'),
    [`token:${GONE}:x1:t1`]: {},
    'client:client-a1': {},
  });
  const result = await sweepOrphanGrants(env, audit);
  assert.deepEqual(result, { checked: 5, revoked: 2, skipped: 0, auditFailed: 0, complete: true, purge: null });
  assert.deepEqual(revoked.sort(), [`${GONE}:x1`, `${GONE}:x2`]);
  assert.deepEqual(
    audits.map((a) => [a.email, a.action, a.documentId, a.via]).sort(),
    [
      [GONE, 'ai_disconnect', null, 'Microsoft Copilot'],
      [GONE, 'ai_disconnect', null, SWEEP_VIA],
    ],
  );
  assert.ok(store.has(`grant:${OWNER}:o1`) && store.has(`grant:${ADA}:a1`) && store.has(`grant:${ADA}:a2`));
});

/** A members row with the retired family role: only a row written before migration 0010 can hold it now. */
function leftover(sqlite: ReturnType<typeof setup>['sqlite'], email: string): void {
  addLeftoverFamily(sqlite, email);
}

test('a members row with a role the code does not know is no member: its grants are revoked and audited', async (t) => {
  QUIET(t);
  const KIN = 'kin@mail.example';
  const { env, store, revoked, audits, audit, sqlite } = setup({
    [`grant:${ADA}:a1`]: grantRecord('a1', 'Claude'),
    [`grant:${KIN}:k1`]: grantRecord('k1', 'Claude'),
  });
  leftover(sqlite, KIN);
  const result = await sweepOrphanGrants(env, audit);
  assert.deepEqual([result.revoked, result.skipped, result.complete], [1, 0, true]);
  assert.deepEqual(revoked, [`${KIN}:k1`]);
  assert.deepEqual(audits.map((a) => [a.email, a.action, a.via]), [[KIN, 'ai_disconnect', 'Claude']]);
  assert.ok(store.has(`grant:${ADA}:a1`), 'counsel keep their grant');
});

test('a members table with no known role counts as empty: nothing is revoked', async (t) => {
  const errors = QUIET(t);
  const { env, revoked, audits, audit, sqlite } = setup({ [`grant:${ADA}:a1`]: grantRecord('a1') }, { members: [] });
  leftover(sqlite, 'kin@mail.example');
  const result = await sweepOrphanGrants(env, audit);
  assert.deepEqual([revoked, audits, result.complete], [[], [], false]);
  assert.deepEqual(errors, [[JSON.stringify({ event: 'mcp.sweep_no_members', code: 'refused' })]]);
});

test('a failed audit still revokes (logging never keeps access alive) and is counted; codes only in the log', async (t) => {
  const errors = QUIET(t);
  const { env, store, revoked } = setup({ [`grant:${GONE}:x1`]: grantRecord('x1', 'Claude') });
  const failing = async () => {
    throw Object.assign(new Error(`D1_ERROR for ${GONE}`), { name: 'AuditError' });
  };
  const result = await sweepOrphanGrants(env, failing);
  assert.deepEqual([result.revoked, result.skipped, result.auditFailed, result.complete], [1, 0, 1, true]);
  assert.deepEqual(revoked, [`${GONE}:x1`]);
  assert.equal(store.has(`grant:${GONE}:x1`), false);
  assert.deepEqual(errors, [[JSON.stringify({ event: 'mcp.sweep_audit_failed', code: 'AuditError' })]]);
});

test('the grant is revoked before its audit row is written, and a failed revoke writes no row', async (t) => {
  QUIET(t);
  const { env, revoked, audit } = setup({ [`grant:${GONE}:x1`]: grantRecord('x1'), [`grant:${GONE}:x2`]: grantRecord('x2') });
  const helpers = env.OAUTH_PROVIDER as unknown as { revokeGrant: (g: string, u: string) => Promise<void> };
  const real = helpers.revokeGrant;
  helpers.revokeGrant = async (g, u) => {
    if (g === 'x2') throw new Error('kv');
    return real(g, u);
  };
  const order: string[] = [];
  await sweepOrphanGrants(env, async (e, entry) => {
    order.push(`audit after ${revoked.length} revoke`);
    await audit(e, entry);
  });
  assert.deepEqual(order, ['audit after 1 revoke']);
});

test('a failed revoke is counted and the sweep carries on with the next grant', async (t) => {
  const errors = QUIET(t);
  const { env, audit } = setup({ [`grant:${GONE}:x1`]: grantRecord('x1'), [`grant:${GONE}:x2`]: grantRecord('x2') });
  const helpers = env.OAUTH_PROVIDER as unknown as { revokeGrant: (g: string, u: string) => Promise<void> };
  const real = helpers.revokeGrant;
  helpers.revokeGrant = async (g, u) => {
    if (g === 'x1') throw Object.assign(new Error('kv'), { code: 'KV_ERROR' });
    return real(g, u);
  };
  const result = await sweepOrphanGrants(env, audit);
  assert.deepEqual([result.revoked, result.skipped, result.complete], [1, 1, false]);
  assert.deepEqual(errors, [[JSON.stringify({ event: 'mcp.sweep_revoke_failed', code: 'KV_ERROR' })]]);
});

test('revokes at most MAX_REVOKES_PER_RUN per run; the next run finishes the job', async (t) => {
  QUIET(t);
  const entries: Record<string, unknown> = {};
  for (let i = 0; i < MAX_REVOKES_PER_RUN + 5; i++) entries[`grant:${GONE}:x${String(i).padStart(2, '0')}`] = grantRecord(`x${i}`);
  const { env, audit } = setup(entries);
  const first = await sweepOrphanGrants(env, audit);
  assert.deepEqual([first.revoked, first.skipped, first.complete], [MAX_REVOKES_PER_RUN, 5, false]);
  const second = await sweepOrphanGrants(env, audit);
  assert.deepEqual([second.checked, second.revoked, second.skipped, second.complete], [5, 5, 0, true]);
});

test('an empty members table revokes nothing (something is wrong, the owner is always a member)', async (t) => {
  const errors = QUIET(t);
  const { env, revoked, audits, audit } = setup({ [`grant:${ADA}:a1`]: grantRecord('a1') }, { members: [] });
  const result = await sweepOrphanGrants(env, audit);
  assert.deepEqual([result.revoked, result.complete], [0, false]);
  assert.deepEqual(revoked, []);
  assert.deepEqual(audits, []);
  assert.deepEqual(errors, [[JSON.stringify({ event: 'mcp.sweep_no_members', code: 'refused' })]]);
});

test('runs one purge step when the helper has it, resuming and then clearing the saved cursor', async (t) => {
  QUIET(t);
  const seen: (string | undefined)[] = [];
  let calls = 0;
  const purge = async (options?: PurgeOptions): Promise<PurgeResult> => {
    seen.push(options?.cursor);
    calls++;
    return calls === 1
      ? { grantsChecked: 50, grantsPurged: 2, tokensChecked: 0, tokensPurged: 0, done: false, cursor: 'next-page' }
      : { grantsChecked: 3, grantsPurged: 0, tokensChecked: 9, tokensPurged: 4, done: true };
  };
  const { env, store, audit } = setup({}, { purge });
  assert.deepEqual((await sweepOrphanGrants(env, audit)).purge, { grantsPurged: 2, tokensPurged: 0, done: false });
  assert.ok(store.has(PURGE_CURSOR_KEY));
  assert.deepEqual((await sweepOrphanGrants(env, audit)).purge, { grantsPurged: 0, tokensPurged: 4, done: true });
  assert.deepEqual(seen, [undefined, 'next-page']);
  assert.equal(store.has(PURGE_CURSOR_KEY), false);
});

test('a failing purge is logged by code and never stops the sweep', async (t) => {
  const errors = QUIET(t);
  const purge = async (): Promise<PurgeResult> => {
    throw Object.assign(new Error('limit'), { code: 'TOO_MANY_SUBREQUESTS' });
  };
  const { env, revoked, audit } = setup({ [`grant:${GONE}:x1`]: grantRecord('x1') }, { purge });
  const result = await sweepOrphanGrants(env, audit);
  assert.deepEqual([result.revoked, result.purge], [1, null]);
  assert.equal(revoked.length, 1);
  assert.deepEqual(errors, [[JSON.stringify({ event: 'mcp.sweep_purge_failed', code: 'TOO_MANY_SUBREQUESTS' })]]);
});

test('a member added while the grants are listed keeps the grant they just made', async (t) => {
  QUIET(t);
  const NEW = 'new@firm.example';
  const { env, revoked, audits, audit, sqlite } = setup({ [`grant:${ADA}:a1`]: grantRecord('a1'), [`grant:${NEW}:n1`]: grantRecord('n1') });
  const kv = env.OAUTH_KV as unknown as { list: (o: object) => Promise<unknown> };
  const list = kv.list.bind(kv);
  kv.list = async (options) => {
    sqlite.prepare("INSERT OR IGNORE INTO members (email, role) VALUES (?, 'counsel')").run(NEW);
    return list(options);
  };
  const result = await sweepOrphanGrants(env, audit);
  assert.deepEqual([result.checked, result.revoked, result.complete], [2, 0, true]);
  assert.deepEqual(revoked, []);
  assert.deepEqual(audits, []);
});

test('a failed members read rejects, revoking and auditing nothing', async (t) => {
  QUIET(t);
  const { env, revoked, audits, audit } = setup({ [`grant:${GONE}:x1`]: grantRecord('x1') });
  const broken = {
    prepare: () => ({
      all: async () => {
        throw new Error('D1_ERROR: network');
      },
    }),
  };
  await assert.rejects(sweepOrphanGrants({ ...env, DB: broken as unknown as D1Database }, audit), /D1_ERROR/);
  assert.deepEqual(revoked, []);
  assert.deepEqual(audits, []);
});

test('grant user ids are compared normalized; one that is not an email is never a member', async (t) => {
  QUIET(t);
  // members.email is lowercase by its CHECK constraint; the sweep normalizes it too, as a second guard.
  const { env, revoked, audit } = setup({
    [`grant:Ada@Firm.example:a1`]: grantRecord('a1'),
    [`grant: ${OWNER}:o1`]: grantRecord('o1'),
    [`grant:not-an-email:z1`]: grantRecord('z1'),
  });
  const result = await sweepOrphanGrants(env, audit);
  assert.deepEqual(revoked, ['not-an-email:z1']);
  assert.equal(result.revoked, 1);
});

test('a listing cut off at the page cap reports incomplete', async (t) => {
  QUIET(t);
  const entries: Record<string, unknown> = {};
  // The fake pages three keys at a time, so 20 pages hold 60 keys; the 61st is never reached.
  for (let i = 0; i < 61; i++) entries[`grant:${ADA}:a${String(i).padStart(2, '0')}`] = grantRecord(`a${i}`);
  const { env, revoked, audit } = setup(entries);
  const result = await sweepOrphanGrants(env, audit);
  assert.deepEqual([result.checked, result.revoked, result.skipped, result.complete], [60, 0, 0, false]);
  assert.deepEqual(revoked, []);
});

test('a purge TypeError (an unreadable saved cursor) clears the cursor; other errors keep it', async (t) => {
  QUIET(t);
  const run = async (error: Error) => {
    const purge = async (): Promise<PurgeResult> => {
      throw error;
    };
    const { env, store, audit } = setup({}, { purge });
    store.set(PURGE_CURSOR_KEY, JSON.stringify('v1-cursor'));
    await sweepOrphanGrants(env, audit);
    return store.has(PURGE_CURSOR_KEY);
  };
  assert.equal(await run(new TypeError('bad cursor')), false);
  assert.equal(await run(new Error('limit')), true);
});
