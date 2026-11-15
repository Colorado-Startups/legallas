// SPDX-License-Identifier: Apache-2.0
// Research threads (threads.ts) on node:sqlite through the same small SQL surface Durable Objects give: the member's
// index with its expiry, deletes and sweep, and a thread's owner, activity, expiry and server-written turns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { THREAD_ID, THREAD_TTL_DAYS } from './protocol.ts';
import {
  addTurn,
  createThread,
  dueThreads,
  expiresAt,
  expiryOf,
  hasThread,
  indexOf,
  KEPT_TURNS,
  lastActivity,
  listThreads,
  markDeleted,
  MAX_THREADS,
  memberOf,
  mintThreadId,
  nextSweep,
  ownedBy,
  ownerOf,
  pastTurns,
  sweepIndex,
  SWEEP_MARGIN_MS,
  SWEEP_RETRY_MS,
  titleFrom,
  touchActivity,
  touchThread,
  type Sql,
} from './threads.ts';

/** ctx.storage.sql's exec over node:sqlite. */
function sqlite(): Sql {
  const db = new DatabaseSync(':memory:');
  return {
    exec<T>(query: string, ...bindings: (string | number | null)[]) {
      const statement = db.prepare(query);
      const rows = /^\s*(SELECT|WITH)/i.test(query) ? statement.all(...(bindings as SQLInputValue[])) : (statement.run(...(bindings as SQLInputValue[])), []);
      return { toArray: () => rows.map((row) => ({ ...row })) as T[] };
    },
  };
}

const DAY = 86_400_000;
const TTL = THREAD_TTL_DAYS * DAY;
const NOW = Date.UTC(2026, 10, 5, 12);
const made = (sql: Sql, at: number) => (createThread(sql, at) as { id: string }).id;

test('thread ids are 128 random bits in the protocol\'s alphabet', () => {
  const ids = new Set(Array.from({ length: 50 }, mintThreadId));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, THREAD_ID);
});

test('titles: the first question on one line, cut at a word', () => {
  assert.equal(titleFrom('  When did\nDoe sign?  '), 'When did Doe sign?');
  const long = titleFrom(`${'word '.repeat(40)}end`);
  assert.ok(long.length <= 80 && long.endsWith('…'));
  assert.doesNotMatch(long, /wor…$/, 'cut at a word');
});

test('the index belongs to the first verified email that reaches it', () => {
  const sql = sqlite();
  assert.equal(memberOf(sql), null);
  assert.equal(indexOf(sql, 'a@example.test'), true);
  assert.equal(indexOf(sql, 'a@example.test'), true);
  assert.equal(indexOf(sql, 'b@example.test'), false);
  assert.equal(memberOf(sql), 'a@example.test');
});

test('the index: create, list newest first with expiry, a title only once and only when given', () => {
  const sql = sqlite();
  const a = made(sql, NOW);
  const b = made(sql, NOW + 1);
  touchThread(sql, a, null, NOW + 5);
  touchThread(sql, a, 'First question?', NOW + 10);
  touchThread(sql, a, 'Second question?', NOW + 20);
  const list = listThreads(sql, NOW + 30);
  assert.deepEqual(list.map((t) => t.id), [a, b]);
  assert.equal(list[0]!.title, 'First question?');
  assert.equal(list[0]!.expiresAt, new Date(NOW + 20 + TTL).toISOString());
  assert.equal(list[1]!.title, '');
  assert.equal(hasThread(sql, a, NOW), true);
  assert.equal(hasThread(sql, 'thread_unknown', NOW), false);
});

test('a delete hides the thread at once; its row stays until its instance is destroyed', async () => {
  const sql = sqlite();
  const a = made(sql, NOW);
  markDeleted(sql, a, NOW + 1);
  assert.equal(hasThread(sql, a, NOW + 1), false);
  assert.deepEqual(listThreads(sql, NOW + 1), []);
  touchThread(sql, a, 'late', NOW + 2);
  assert.deepEqual(dueThreads(sql, NOW + 2), [a]);
  // The instance could not be destroyed: the row stays, and the sweep comes back soon.
  assert.equal(await sweepIndex(sql, NOW + 3, async () => false), NOW + 3 + SWEEP_RETRY_MS);
  assert.deepEqual(dueThreads(sql, NOW + 3), [a]);
  // Next time it works: the row goes.
  const destroyed: string[] = [];
  assert.equal(await sweepIndex(sql, NOW + 4, async (id) => (destroyed.push(id), true)), null);
  assert.deepEqual(destroyed, [a]);
  assert.deepEqual(dueThreads(sql, NOW + 4), []);
});

test('the index sweep takes threads 90 days after their last activity, and schedules itself by the first expiry', async () => {
  const sql = sqlite();
  const old = made(sql, NOW);
  const fresh = made(sql, NOW);
  touchThread(sql, fresh, 'q', NOW + 50 * DAY);
  assert.equal(nextSweep(sql, NOW + DAY), NOW + TTL + SWEEP_MARGIN_MS);
  const later = NOW + TTL + DAY;
  assert.equal(hasThread(sql, old, later), false, 'hidden as soon as it expires');
  assert.deepEqual(listThreads(sql, later).map((t) => t.id), [fresh]);
  const destroyed: string[] = [];
  const next = await sweepIndex(sql, later, async (id) => (destroyed.push(id), true));
  assert.deepEqual(destroyed, [old]);
  assert.equal(next, expiresAt(NOW + 50 * DAY) + SWEEP_MARGIN_MS);
});

test('a member keeps at most MAX_THREADS threads', () => {
  const sql = sqlite();
  for (let i = 0; i < MAX_THREADS; i++) assert.ok('id' in createThread(sql, NOW + i));
  assert.deepEqual(createThread(sql, NOW), { error: 'thread_limit' });
});

test('a thread belongs to the first verified email and id that reach it, and to nobody else', () => {
  const sql = sqlite();
  assert.equal(ownerOf(sql), null);
  assert.deepEqual(ownedBy(sql, 'a@example.test', 't1', NOW), { owned: true, created: true });
  assert.deepEqual(ownedBy(sql, 'a@example.test', 't1', NOW + 1), { owned: true, created: false });
  assert.equal(ownedBy(sql, 'b@example.test', 't1', NOW).owned, false);
  assert.equal(ownedBy(sql, 'a@example.test', 't2', NOW).owned, false);
  assert.deepEqual(ownerOf(sql), { email: 'a@example.test', thread: 't1' });
});

test('a thread whose only question was refused still expires 90 days after that question', () => {
  const sql = sqlite();
  ownedBy(sql, 'a@example.test', 't1', NOW);
  touchActivity(sql, NOW + 10 * DAY); // the question, refused: it stays in the transcript all the same
  assert.equal(pastTurns(sql).length, 0);
  assert.equal(lastActivity(sql), NOW + 10 * DAY);
  assert.deepEqual(expiryOf(lastActivity(sql), NOW + TTL + DAY), { due: false, next: NOW + 10 * DAY + TTL + SWEEP_MARGIN_MS });
  assert.deepEqual(expiryOf(lastActivity(sql), NOW + 10 * DAY + TTL), { due: true });
  assert.deepEqual(expiryOf(null, NOW), { due: true }, 'a thread with no owner has nothing to keep');
});

test('turns: kept as the server wrote them, oldest first, the last KEPT_TURNS only', () => {
  const sql = sqlite();
  ownedBy(sql, 'a@example.test', 't1', NOW);
  for (let i = 0; i < KEPT_TURNS + 5; i++) addTurn(sql, { question: `q${i}`, answer: `a${i}` }, NOW + i);
  const turns = pastTurns(sql);
  assert.equal(turns.length, KEPT_TURNS);
  assert.deepEqual(turns[0], { question: 'q5', answer: 'a5' });
});
