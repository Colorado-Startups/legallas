// SPDX-License-Identifier: Apache-2.0
// Migration 0004_ai_connections: the audit_log rebuild keeps history and ids, accepts the ai_* actions and
// `via`, adds usage.tool_calls, and applies before or after the comment-threads migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AUDIT_ACTIONS, parseActivityFilter, readActivity } from '../worker/audit.ts';
import { testDb } from '../worker/sqlite-d1.ts';
import { AI_AUDIT_ACTIONS } from './contract.ts';

const DIR = join(import.meta.dirname, '..', 'migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const AI = '0004_ai_connections.sql';
const THREADS = FILES.find((f) => f.endsWith('_comment_threads.sql'));
const sql = (file: string) => readFileSync(join(DIR, file), 'utf8');
const rows = (db: DatabaseSync, query: string) => db.prepare(query).all().map((r) => ({ ...r }));

/** A database with 0001 to 0003 applied and some audit history, the state production is in before 0004. */
function before0004(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_init.sql', '0002_sign_ins.sql', '0003_doc_numbers.sql']) db.exec(sql(file));
  db.exec(`
    INSERT INTO audit_log (ts, email, action, document_id, ip, user_agent) VALUES
      ('2026-01-01T00:00:00.000Z', 'p@x.test', 'view', 'd1', '192.0.2.1', 'UA one'),
      ('2026-01-02T00:00:00.000Z', 'p@x.test', 'key', 'd1', NULL, NULL),
      ('2026-01-03T00:00:00.000Z', 'a@x.test', 'ai_question', NULL, NULL, NULL);
    DELETE FROM audit_log WHERE id = 2;
    INSERT INTO usage (email, day, questions) VALUES ('p@x.test', '2026-01-01', 7);
  `);
  return db;
}

test('every migration applies on testDb, and AUDIT_ACTIONS lists the ai_* actions', () => {
  const { sqlite } = testDb();
  for (const action of AI_AUDIT_ACTIONS) assert.ok((AUDIT_ACTIONS as readonly string[]).includes(action), action);
  const columns = rows(sqlite, 'PRAGMA table_info(audit_log)').map((c) => c.name);
  // room_id: migration 0012 (deal rooms), a guest's row's room; NULL for every other row.
  assert.deepEqual(columns, ['id', 'ts', 'email', 'action', 'document_id', 'ip', 'user_agent', 'via', 'room_id']);
});

test('0004 keeps rows, ids, the sequence and both indexes', () => {
  const db = before0004();
  db.exec(sql(AI));
  assert.deepEqual(rows(db, 'SELECT id, ts, email, action, document_id, ip, user_agent, via FROM audit_log ORDER BY id'), [
    { id: 1, ts: '2026-01-01T00:00:00.000Z', email: 'p@x.test', action: 'view', document_id: 'd1', ip: '192.0.2.1', user_agent: 'UA one', via: null },
    { id: 3, ts: '2026-01-03T00:00:00.000Z', email: 'a@x.test', action: 'ai_question', document_id: null, ip: null, user_agent: null, via: null },
  ]);
  assert.deepEqual(rows(db, "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'audit_log' ORDER BY name"), [
    { name: 'audit_log_email_ts', sql: 'CREATE INDEX audit_log_email_ts ON audit_log (email, ts)' },
    { name: 'audit_log_ts', sql: 'CREATE INDEX audit_log_ts ON audit_log (ts)' },
  ]);
  db.exec("INSERT INTO audit_log (email, action) VALUES ('p@x.test', 'ai_connect')");
  assert.deepEqual(rows(db, 'SELECT max(id) AS id FROM audit_log'), [{ id: 4 }], 'ids continue after the copy');
  assert.equal(rows(db, "SELECT name FROM sqlite_master WHERE name = 'audit_log_new'").length, 0);
});

/** The id the next audit_log insert gets. */
function nextId(db: DatabaseSync): number {
  db.exec("INSERT INTO audit_log (email, action) VALUES ('p@x.test', 'ai_connect')");
  return Number((db.prepare('SELECT max(id) AS id FROM audit_log').get() as { id: number }).id);
}

/** 0001 to 0003 with `count` audit rows, then the given ids deleted. */
function withDeleted(count: number, deleted: number[]): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_init.sql', '0002_sign_ins.sql', '0003_doc_numbers.sql']) db.exec(sql(file));
  for (let i = 0; i < count; i++) db.exec("INSERT INTO audit_log (email, action) VALUES ('p@x.test', 'view')");
  for (const id of deleted) db.exec(`DELETE FROM audit_log WHERE id = ${id}`);
  return db;
}

test('0004 never reuses an id: the counter survives when the newest row was deleted', () => {
  const db = withDeleted(3, [3]);
  db.exec(sql(AI));
  assert.deepEqual(rows(db, 'SELECT id FROM audit_log ORDER BY id').map((r) => r.id), [1, 2]);
  assert.equal(nextId(db), 4);
});

test('0004 keeps the counter when every row was deleted, and starts at 1 on a never-used table', () => {
  const emptied = withDeleted(2, [1, 2]);
  emptied.exec(sql(AI));
  assert.equal(nextId(emptied), 3);

  // A table that never had a row may have no sqlite_sequence entry at all (0003's copy leaves seq 0; remove it).
  const unused = withDeleted(0, []);
  unused.exec("DELETE FROM sqlite_sequence WHERE name = 'audit_log'");
  unused.exec(sql(AI));
  assert.equal(nextId(unused), 1);
  assert.deepEqual(rows(unused, "SELECT name FROM sqlite_sequence WHERE name LIKE 'audit%'"), [{ name: 'audit_log' }]);
  assert.equal(rows(unused, "SELECT name FROM sqlite_master WHERE name = '_audit_seq'").length, 0);
});

test('testDb applies 0004 on an empty database and leaves no helper table', async () => {
  const { db, sqlite } = testDb();
  assert.equal(rows(sqlite, "SELECT name FROM sqlite_master WHERE name = '_audit_seq'").length, 0);
  await db.prepare("INSERT INTO audit_log (email, action) VALUES ('p@x.test', 'ai_read')").run();
  assert.deepEqual(rows(sqlite, 'SELECT id FROM audit_log'), [{ id: 1 }]);
});

test('the CHECK accepts every allowed action and the ai_* ones, and rejects anything else', () => {
  const db = before0004();
  db.exec(sql(AI));
  const insert = db.prepare("INSERT INTO audit_log (email, action, via) VALUES ('p@x.test', ?, 'Claude')");
  for (const action of AUDIT_ACTIONS) insert.run(action);
  assert.throws(() => insert.run('ai_write'), /CHECK constraint failed/);
  assert.throws(() => insert.run('sign_in'), /CHECK constraint failed/);
});

test('via is NULL or 1 to 80 characters', () => {
  const { sqlite } = testDb();
  const insert = sqlite.prepare("INSERT INTO audit_log (email, action, via) VALUES ('p@x.test', 'ai_search', ?)");
  insert.run(null);
  insert.run('x'.repeat(80));
  insert.run('é'.repeat(80));
  assert.throws(() => insert.run(''), /CHECK constraint failed/);
  assert.throws(() => insert.run('x'.repeat(81)), /CHECK constraint failed/);
});

test('usage gains tool_calls at 0 and keeps the Ask counts', () => {
  const db = before0004();
  db.exec(sql(AI));
  assert.deepEqual(rows(db, 'SELECT email, day, questions, tool_calls FROM usage'), [
    { email: 'p@x.test', day: '2026-01-01', questions: 7, tool_calls: 0 },
  ]);
});

test('0004 and the comment-threads migration apply in either order', () => {
  assert.ok(THREADS, 'the comment-threads migration exists');
  for (const order of [[AI, THREADS], [THREADS, AI]]) {
    const db = before0004();
    for (const file of order) db.exec(sql(file));
    const comments = rows(db, 'PRAGMA table_info(comments)').map((c) => c.name);
    assert.ok(comments.includes('parent_id') && comments.includes('page'), order.join(' then '));
    assert.ok(rows(db, 'PRAGMA table_info(audit_log)').some((c) => c.name === 'via'), order.join(' then '));
  }
});

test('the activity feed returns via for AI rows and null for room rows and sign-ins', async () => {
  const { db, sqlite } = testDb();
  sqlite.exec(`
    INSERT INTO audit_log (ts, email, action, document_id, via) VALUES
      ('2026-09-01T10:00:00.000Z', 'a@x.test', 'view', NULL, NULL),
      ('2026-09-02T10:00:00.000Z', 'a@x.test', 'ai_search', NULL, 'Claude'),
      ('2026-09-03T10:00:00.000Z', 'a@x.test', 'ai_connect', NULL, 'Harvey');
    INSERT INTO sign_ins (email, sub, iat, country, created_at) VALUES ('a@x.test', 's-a', 1, 'US', '2026-09-04T10:00:00.000Z');
  `);
  const all = await readActivity(db, parseActivityFilter(new URLSearchParams()));
  assert.deepEqual(
    all.rows.map((r) => [r.action, r.via]),
    [
      ['sign_in', null],
      ['ai_connect', 'Harvey'],
      ['ai_search', 'Claude'],
      ['view', null],
    ],
  );
  const searches = await readActivity(db, parseActivityFilter(new URLSearchParams('action=ai_search')));
  assert.deepEqual(searches.rows.map((r) => [r.ts, r.via]), [['2026-09-02T10:00:00.000Z', 'Claude']]);
});
