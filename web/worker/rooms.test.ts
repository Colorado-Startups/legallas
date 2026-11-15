// SPDX-License-Identifier: Apache-2.0
// Deal rooms' model (worker/rooms.ts) and migration 0012. The migration is additive: four new tables, and one nullable
// column each on comments and audit_log; every existing table, index, trigger and row is otherwise untouched, and the
// code on main keeps writing and reading as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canPerform, isRole, ROOM_READER, type Action } from './auth.ts';
import { insertComment, listThread } from './comments.ts';
import type { Role } from './env.ts';
import { NOT_HIDDEN_SQL } from './files-catalog.ts';
import { NOT_AGENT_FILE_SQL } from './agent-files.ts';
import { canInRoom, findRoomGuest, isRoomRole, privilegedMarks, roomsEnabled, VISIBLE_SQL, type RoomRole } from './rooms.ts';
import { invite, IVY, ROOM_A, ROOM_C, roomsDb } from './rooms-fixtures.ts';
import { testDb } from './sqlite-d1.ts';

const DIR = join(import.meta.dirname, '..', 'migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const ROOMS = '0012_deal_rooms.sql';
const rows = (db: DatabaseSync, sql: string) => db.prepare(sql).all().map((r) => ({ ...r }));

test('only "1" turns deal rooms on', () => {
  assert.equal(roomsEnabled({ ROOMS_ENABLED: '1' }), true);
  for (const value of [undefined, '', '0', 'true', 'yes', ' 1', '1 ']) assert.equal(roomsEnabled({ ROOMS_ENABLED: value }), false, String(value));
});

test('the investor may view, read and write comments and connect their own AI, and nothing else; unknown roles and actions are allowed nothing', () => {
  const allowed = ['view', 'readComments', 'comment', 'connect'];
  const every: string[] = ['view', 'viewPrivileged', 'download', 'readComments', 'comment', 'resolve', 'upload', 'ask', 'flag', 'connect', 'viewActivity', 'share', 'manageRooms'];
  for (const action of every) assert.equal(canInRoom('investor', action), allowed.includes(action), action);
  assert.equal(isRoomRole('investor'), true);
  for (const role of ['counsel', 'viewer', 'owner', 'constructor', '__proto__', 'toString']) {
    assert.equal(isRoomRole(role), false, role);
    for (const action of every) assert.equal(canInRoom(role as RoomRole, action), false, `${role} ${action}`);
  }
  for (const action of ['constructor', 'hasOwnProperty', '__proto__']) assert.equal(canInRoom('investor', action), false, action);
  // Guest roles never leak into the members' matrix: no member route can be handed a guest's role.
  for (const action of every) assert.equal(canPerform('investor' as Role, action as Action), false, action);
  // A guest's AI reads as ROOM_READER: it may view and nothing else, and it is never a members role.
  for (const action of every) assert.equal(canPerform(ROOM_READER, action as Action), action === 'view', `reader ${action}`);
  assert.equal(isRole(ROOM_READER), false);
});

test('with no FILES binding there are no privilege marks, and no error', async () => {
  assert.deepEqual(await privilegedMarks({ FILES: undefined as unknown as R2Bucket }, new Date()), new Set());
});

test('the room rule leaves out room data files with the catalog\'s own pattern', () => {
  assert.ok(VISIBLE_SQL.includes(`d.${NOT_HIDDEN_SQL}`));
  assert.ok(VISIBLE_SQL.includes(NOT_AGENT_FILE_SQL));
});

test('findRoomGuest reads every active invitation fresh, by room name, and none that are revoked', async () => {
  const { db, sqlite } = roomsDb();
  const now = new Date();
  const guest = await findRoomGuest(db, IVY, now);
  assert.deepEqual(guest?.rooms.map((r) => [r.id, r.role, r.joined]), [[ROOM_C, 'investor', true], [ROOM_A, 'investor', true]]);
  sqlite.prepare("UPDATE room_members SET revoked_at = '2026-06-01T00:00:00.000Z' WHERE email = ?1").run(IVY);
  assert.equal(await findRoomGuest(db, IVY, now), null);
  invite(sqlite, { room: ROOM_A, email: IVY });
  assert.equal((await findRoomGuest(db, IVY, now))?.rooms.length, 1, 'a new invitation after a revoke is a new row');
});

function before(file: string): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of FILES.filter((name) => name < file)) db.exec(readFileSync(join(DIR, f), 'utf8'));
  return db;
}

const SEED = `
  INSERT INTO members (email, role, name) VALUES ('founder@example.test', 'owner', 'Founder'), ('ada@firm.example', 'counsel', NULL);
  INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at)
    VALUES ('d1', 'Deals/Harbor Seed/Term sheet.pdf', 'Deals/Harbor Seed', 'Term sheet.pdf', 'pdf', 'application/pdf', 1, 'k1', 'mirror', '2026-01-01');
  INSERT INTO comments (id, document_id, author_email, body) VALUES ('c1', 'd1', 'ada@firm.example', 'A note');
  INSERT INTO audit_log (email, action, document_id) VALUES ('ada@firm.example', 'view', 'd1');
`;

test('0012 is additive: new tables, and one nullable column at the end of comments and audit_log; nothing else changes', () => {
  const db = before(ROOMS);
  db.exec(SEED);
  const tables = ['members', 'documents', 'comments', 'audit_log', 'usage', 'sign_ins', 'member_seen'];
  const data = Object.fromEntries(tables.map((t) => [t, rows(db, `SELECT * FROM ${t}`)]));
  const columns = Object.fromEntries(tables.map((t) => [t, rows(db, `PRAGMA table_info(${t})`)]));
  const schema = rows(db, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name");
  db.exec(readFileSync(join(DIR, ROOMS), 'utf8'));

  for (const table of tables) {
    const added = table === 'comments' || table === 'audit_log' ? [{ room_id: null }] : [];
    assert.deepEqual(rows(db, `SELECT * FROM ${table}`), data[table]!.map((row) => ({ ...row, ...(added[0] ?? {}) })), `${table}: every row kept`);
    const now = rows(db, `PRAGMA table_info(${table})`);
    assert.deepEqual(now.slice(0, columns[table]!.length), columns[table], `${table}: columns kept in place`);
    assert.deepEqual(now.slice(columns[table]!.length).map((c) => [c.name, c.notnull, c.dflt_value]), added.length ? [['room_id', 0, null]] : [], `${table}: added columns`);
  }
  const after = rows(db, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name");
  const changed = (e: Record<string, unknown>) => e.type === 'table' && (e.name === 'comments' || e.name === 'audit_log');
  assert.deepEqual(after.filter((e) => schema.some((s) => s.name === e.name) && !changed(e)), schema.filter((e) => !changed(e)), 'no other table, index or trigger changed');
  assert.deepEqual(after.filter((e) => !schema.some((s) => s.name === e.name)).map((e) => e.name).sort(), [
    'access_events', 'access_events_no_delete', 'access_events_no_update', 'access_events_ts', 'comments_room',
    'room_folders', 'room_folders_live', 'room_members', 'room_members_by_email', 'room_members_live', 'rooms',
  ]);
  const text = readFileSync(join(DIR, ROOMS), 'utf8').replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(text, /\bDROP\b|\bRENAME\b|\bDELETE\s+FROM\b|\bUPDATE\s+\w+\s+SET\b|\bINSERT\b/i);
  assert.deepEqual([...text.matchAll(/\bALTER TABLE (\w+) (\w+ \w+)/g)].map((m) => [m[1], m[2]]), [['comments', 'ADD COLUMN'], ['audit_log', 'ADD COLUMN']]);
});

test('after 0012 the code on main writes and reads comments and audit rows exactly as before', async () => {
  const { db, sqlite } = testDb();
  sqlite.exec(SEED);
  await insertComment(db, { id: 'c2', documentId: 'd1', email: 'ada@firm.example', body: 'Reply', parentId: 'c1', page: null }).run();
  sqlite.exec("INSERT INTO audit_log (email, action, document_id, ip, user_agent, via) VALUES ('ada@firm.example', 'ai_read', 'd1', NULL, NULL, 'Claude')");
  const thread = await listThread(db, 'd1', 'counsel');
  assert.deepEqual(thread.map((c) => [c.id, c.parent_id, Object.hasOwn(c, 'room_id')]), [['c1', null, false], ['c2', 'c1', false]], 'no room_id in what members are served');
  assert.deepEqual(rows(sqlite, 'SELECT room_id FROM comments UNION ALL SELECT room_id FROM audit_log'), [{ room_id: null }, { room_id: null }, { room_id: null }, { room_id: null }]);
});
