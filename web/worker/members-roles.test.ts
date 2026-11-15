// SPDX-License-Identifier: Apache-2.0
// members and its roles. Migration 0006 once added the read-only 'family' role; 0010 (the owner retired the role,
// 2026-10-20) is purely additive: two triggers refuse a new or changed family row, and no table, index or row
// changes. The Worker refuses the role too: a family row left from before 0010 is no member, and is allowed nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canPerform, findMember, type Action } from './auth.ts';
import type { RequestContext, Role } from './env.ts';
import { addLeftoverFamily } from './gate-fixtures.ts';
import { routes } from './routes/comments.ts';
import { testDb } from './sqlite-d1.ts';

const DIR = join(import.meta.dirname, '..', 'migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const ADD_FAMILY = '0006_family_role.sql';
const NO_FAMILY = '0010_members_no_family.sql';
const RETIRED = 'family' as Role;
const REFUSED = /family role retired/;
const ACTIONS: Action[] = [
  'view', 'viewPrivileged', 'download', 'readComments', 'comment', 'resolve', 'upload', 'ask', 'flag', 'connect',
  'viewActivity',
];
const rows = (db: DatabaseSync, query: string) => db.prepare(query).all().map((r) => ({ ...r }));
const members = (db: DatabaseSync) => rows(db, 'SELECT email, role, name, added_at FROM members ORDER BY email');
const schema = (db: DatabaseSync) => rows(db, 'SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name');
const migration = (file: string) => readFileSync(join(DIR, file), 'utf8');

/** A database with every migration before `file` applied. */
function before(file: string): DatabaseSync {
  assert.ok(FILES.includes(file), file);
  const db = new DatabaseSync(':memory:');
  for (const f of FILES.filter((name) => name < file)) db.exec(migration(f));
  return db;
}

const SEED = `
  INSERT INTO members (email, role, name, added_at) VALUES
    ('founder@example.test', 'owner', 'Founder', '2026-01-01T00:00:00.000Z'),
    ('ada@firm.example', 'counsel', NULL, '2026-02-01T00:00:00.000Z'),
    ('bo@firm.example', 'counsel', 'Bo Doe', '2026-03-01T00:00:00.000Z');
`;

test('0006 keeps every member row and its added_at, then accepts family', () => {
  const db = before(ADD_FAMILY);
  assert.throws(() => db.exec(`INSERT INTO members (email, role) VALUES ('kin@mail.example', 'family')`), /CHECK/);
  db.exec(SEED);
  const kept = members(db);
  db.exec(migration(ADD_FAMILY));
  assert.deepEqual(members(db), kept);
  db.exec(`INSERT INTO members (email, role, name) VALUES ('kin@mail.example', 'family', 'Kin')`);
  assert.equal(rows(db, `SELECT role FROM members WHERE email = 'kin@mail.example'`)[0]?.role, 'family');
});

test('0010 is additive: it adds exactly its two triggers; every table, index and row, a family row included, is untouched', () => {
  const db = before(NO_FAMILY);
  db.exec(SEED);
  db.exec(`INSERT INTO members (email, role, name, added_at) VALUES ('kin@mail.example', 'family', 'Kin', '2026-04-03T00:00:00.000Z')`);
  const was = { rows: members(db), schema: schema(db), columns: rows(db, 'PRAGMA table_info(members)') };
  db.exec(migration(NO_FAMILY));
  assert.deepEqual(members(db), was.rows, 'no row changed or dropped');
  assert.deepEqual(rows(db, 'PRAGMA table_info(members)'), was.columns);
  const now = schema(db);
  assert.deepEqual(now.filter((e) => e.type !== 'trigger'), was.schema, 'no table or index changed');
  assert.deepEqual(now.filter((e) => e.type === 'trigger').map((e) => [e.name, e.tbl_name]), [
    ['members_no_family_insert', 'members'],
    ['members_no_family_update', 'members'],
  ]);
  assert.doesNotMatch(migration(NO_FAMILY).replace(/^--.*$/gm, ''), /\b(DROP|RENAME|ALTER|DELETE|UPDATE\s+members)\b/i);
});

test('after 0010 the database refuses a new or changed family row: insert, upsert, replace and update', () => {
  const { sqlite } = testDb();
  sqlite.exec(SEED);
  const kept = members(sqlite);
  for (const sql of [
    `INSERT INTO members (email, role) VALUES ('kin@mail.example', 'family')`,
    `INSERT INTO members (email, role) VALUES ('ada@firm.example', 'family') ON CONFLICT (email) DO UPDATE SET role = excluded.role`,
    `INSERT OR REPLACE INTO members (email, role) VALUES ('ada@firm.example', 'family')`,
    `UPDATE members SET role = 'family' WHERE email = 'bo@firm.example'`,
  ]) assert.throws(() => sqlite.exec(sql), REFUSED, sql);
  assert.deepEqual(members(sqlite), kept, 'every refused statement changed nothing');
  assert.throws(() => sqlite.exec(`INSERT INTO members (email, role) VALUES ('x@y.example', 'observer')`), /CHECK/);
  assert.throws(() => sqlite.exec(`INSERT INTO members (email, role) VALUES ('X@y.example', 'counsel')`), /CHECK/);
});

test('after 0010 owner and counsel rows are written as before', () => {
  const { sqlite } = testDb();
  sqlite.exec(SEED);
  sqlite.exec(`INSERT INTO members (email, role) VALUES ('cy@firm.example', 'counsel')`);
  sqlite.exec(`UPDATE members SET role = 'owner', name = 'Bo' WHERE email = 'bo@firm.example'`);
  sqlite.exec(`INSERT INTO members (email, role, name) VALUES ('ada@firm.example', 'counsel', 'Ada') ON CONFLICT (email) DO UPDATE SET name = excluded.name`);
  assert.deepEqual(rows(sqlite, 'SELECT email, role, name FROM members ORDER BY email'), [
    { email: 'ada@firm.example', role: 'counsel', name: 'Ada' },
    { email: 'bo@firm.example', role: 'owner', name: 'Bo' },
    { email: 'cy@firm.example', role: 'counsel', name: null },
    { email: 'founder@example.test', role: 'owner', name: 'Founder' },
  ]);
  assert.match(String(rows(sqlite, `SELECT added_at FROM members WHERE email = 'cy@firm.example'`)[0]?.added_at), /^\d{4}-\d\d-\d\dT.*Z$/);
});

test('a family row left from before 0010 is no member, may be moved to counsel or removed, and the retired role is allowed nothing', async () => {
  const { sqlite, db } = testDb();
  addLeftoverFamily(sqlite, 'kin@mail.example', 'Kin');
  sqlite.exec(`INSERT INTO members (email, role, name) VALUES ('ada@firm.example', 'counsel', 'Ada')`);
  assert.equal(await findMember(db, 'kin@mail.example'), null);
  assert.deepEqual(await findMember(db, 'ada@firm.example'), { email: 'ada@firm.example', role: 'counsel', name: 'Ada' });
  for (const action of ACTIONS) assert.equal(canPerform(RETIRED, action), false, action);
  assert.throws(() => sqlite.exec(`INSERT INTO members (email, role) VALUES ('kin2@mail.example', 'family')`), REFUSED, 'the trigger is back');
  sqlite.exec(`UPDATE members SET name = 'Kin Doe', role = 'counsel' WHERE email = 'kin@mail.example'`);
  assert.deepEqual(await findMember(db, 'kin@mail.example'), { email: 'kin@mail.example', role: 'counsel', name: 'Kin Doe' });
  sqlite.exec(`DELETE FROM members WHERE email = 'kin@mail.example'`);
  assert.equal(await findMember(db, 'kin@mail.example'), null);
});

test('the retired family role is refused every comment route: no thread, no feed, no posting, no resolving, no activity', async () => {
  const { db } = testDb();
  for (const route of routes) {
    const path = route.path.replace(':id', 'd1');
    const context: RequestContext = {
      request: new Request(`http://localhost${path}`, {
        method: route.method,
        headers: { 'Content-Type': 'application/json' },
        body: route.method === 'GET' ? undefined : '{"body":"x","resolved":true}',
      }),
      env: { DB: db } as unknown as RequestContext['env'],
      ctx: {} as ExecutionContext,
      url: new URL(`http://localhost${path}`),
      member: { email: 'kin@mail.example', role: RETIRED, name: 'Kin' },
      params: { id: 'd1' },
    };
    const res = await route.handler(context);
    assert.equal(res.status, 403, `${route.method} ${route.path}`);
  }
});
