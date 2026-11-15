// SPDX-License-Identifier: Apache-2.0
// npm run room (scripts/room.ts): parsing, and the SQL it writes run on real SQLite with every migration applied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isMissingRoomsTable } from './member.ts';
import { ACTOR, DEFAULT_DAYS, FREE_SEATS, SEAT_WARN, seatNotice, seatsSql, endingSoonNotice, endingSoonSql, inviteSql, inviteStateSql, normalizeFolder, parseRoomArgs, revokeSql, roomSql, WARN_DAYS, type EndingSoon, type InviteState, type RoomCommand } from './room.ts';

const ROOM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const NOW = new Date('2026-11-01T12:00:00.000Z');

function schema(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, file), 'utf8'));
  return db;
}

const rows = (db: DatabaseSync, sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args).map((r) => ({ ...r }));
const ids = (...list: string[]) => () => list.shift() ?? crypto.randomUUID();
type Invite = Extract<RoomCommand, { kind: 'invite' }>;

function stateOf(db: DatabaseSync, command: Invite): InviteState {
  const row = db.prepare(inviteStateSql(command)).get() as Record<string, unknown>;
  return { isMember: row.is_member === 1, roomLive: row.room_live === 1, liveGrant: typeof row.grant_id === 'string' ? { id: row.grant_id, joined: row.joined === 1 } : null };
}

test('create takes a name and one or more folders, normalized; a room id is hex and dashes', () => {
  assert.deepEqual(parseRoomArgs(['create', 'Harbor', 'Labs', 'seed', '--folder', '/Deals/Harbor Seed/', '--folder', 'Deals/Harbor Seed', '--local']), {
    kind: 'create',
    name: 'Harbor Labs seed',
    folders: ['Deals/Harbor Seed'],
  });
  assert.throws(() => parseRoomArgs(['create', 'No folder']), /usage/);
  assert.throws(() => parseRoomArgs(['create', '--folder', 'Deals']), /usage/);
  assert.throws(() => parseRoomArgs(['archive', 'Harbor-Seed']), /room id/);
  assert.deepEqual(parseRoomArgs(['archive', ROOM]), { kind: 'archive', roomId: ROOM });
  assert.deepEqual(parseRoomArgs(['folder', 'remove', ROOM, 'Deals/Old']), { kind: 'folder', action: 'remove', roomId: ROOM, folder: 'Deals/Old' });
});

test('invite serves the investor role only, normalizes the email, refuses ":" and bounds the end date', () => {
  assert.deepEqual(parseRoomArgs(['invite', ROOM, ' Ivy@Fund.Example ', 'investor', 'Ivy', 'Doe', '--days', '30']), {
    kind: 'invite', roomId: ROOM, email: 'ivy@fund.example', role: 'investor', name: 'Ivy Doe', days: 30,
  });
  assert.equal((parseRoomArgs(['invite', ROOM, 'ivy@fund.example', 'investor']) as Invite).days, 120);
  for (const role of ['counsel', 'viewer', 'owner', 'Investor']) assert.throws(() => parseRoomArgs(['invite', ROOM, 'a@b.example', role]), /investor role only/, role);
  for (const days of ['0', '731', '1.5', 'x']) assert.throws(() => parseRoomArgs(['invite', ROOM, 'a@b.example', 'investor', '--days', days]), /--days/, days);
  assert.throws(() => parseRoomArgs(['invite', ROOM, 'a:b@c.example', 'investor']), /usage/);
  assert.throws(() => parseRoomArgs(['invite', ROOM, 'not-an-email', 'investor']), /usage/);
});

test('a folder with privileged in its path is refused by the CLI and by the database', () => {
  for (const raw of ['x/PRIVILEGED', 'Counsel Privileged']) assert.throws(() => normalizeFolder(raw), /privileged/i, raw);
  const db = schema();
  db.exec(`INSERT INTO rooms (id, name, created_by) VALUES ('${ROOM}', 'Harbor', 'x')`);
  assert.throws(() => db.prepare("INSERT INTO room_folders (id, room_id, folder, added_by) VALUES ('f1', ?1, 'x/PRIVILEGED', 'x')").run(ROOM));
});

test('a folder the CLI accepts is exactly one the database accepts', () => {
  const db = schema();
  db.exec(`INSERT INTO rooms (id, name, created_by) VALUES ('${ROOM}', 'Harbor', 'x')`);
  const inputs = ['Deals/Harbor Seed', '/Deals/x/', 'Deals//x', 'Deals/./x', 'Deals/../x', '..', 'a\\b', '', '/', 'Counsel Privileged', 'x/PRIVILEGED', 'from-counsel', 'from-counsel/x', 'from-counselling', 'Deals/Doe_Labs', 'Deals/100%'];
  let n = 0;
  for (const raw of inputs) {
    let folder: string | null = null;
    try {
      folder = normalizeFolder(raw);
    } catch {
      folder = null;
    }
    const value = folder ?? raw;
    let stored = true;
    try {
      db.prepare("INSERT INTO room_folders (id, room_id, folder, added_by) VALUES (?1, ?2, ?3, 'x')").run(`f${++n}`, ROOM, value);
    } catch {
      stored = false;
    }
    assert.equal(stored, folder !== null, `${JSON.stringify(raw)}: CLI ${folder !== null}, database ${stored}`);
  }
});

test('create, folder, invite, re-invite, revoke and archive write what they say, with an event for each change', () => {
  const db = schema();
  db.exec(roomSql({ kind: 'create', name: 'Harbor Labs seed', folders: ['Deals/Harbor Seed', 'Deals/Shared'] }, NOW, ids(ROOM, 'f1', 'f2')));
  assert.deepEqual(rows(db, 'SELECT id, kind, name, created_by FROM rooms'), [{ id: ROOM, kind: 'deal', name: 'Harbor Labs seed', created_by: ACTOR }]);
  assert.deepEqual(rows(db, 'SELECT folder FROM room_folders ORDER BY folder'), [{ folder: 'Deals/Harbor Seed' }, { folder: 'Deals/Shared' }]);
  db.exec(roomSql({ kind: 'folder', action: 'remove', roomId: ROOM, folder: 'Deals/Shared' }, NOW));
  assert.deepEqual(rows(db, 'SELECT folder FROM room_folders WHERE removed_at IS NULL'), [{ folder: 'Deals/Harbor Seed' }]);

  const command = parseRoomArgs(['invite', ROOM, 'ivy@fund.example', 'investor', '--days', '30']) as Invite;
  db.exec(inviteSql(command, stateOf(db, command), NOW, 'g1'));
  assert.deepEqual(rows(db, 'SELECT id, email, role, invited_at, accept_by, joined_at, expires_at, revoked_at FROM room_members'), [
    { id: 'g1', email: 'ivy@fund.example', role: 'investor', invited_at: '2026-11-01T12:00:00.000Z', accept_by: '2026-11-15T12:00:00.000Z', joined_at: null, expires_at: '2026-12-01T12:00:00.000Z', revoked_at: null },
  ]);
  const longer = { ...command, days: 60 };
  db.exec(inviteSql(longer, stateOf(db, longer), NOW, 'g2'));
  assert.deepEqual(rows(db, 'SELECT id, expires_at FROM room_members'), [{ id: 'g1', expires_at: '2026-12-31T12:00:00.000Z' }], 'new terms on the live invitation, never a second one');

  db.exec(revokeSql('ivy@fund.example', NOW, ROOM));
  db.exec(revokeSql('ivy@fund.example', new Date('2026-11-02T00:00:00.000Z'), ROOM));
  assert.deepEqual(rows(db, 'SELECT revoked_at, revoked_by FROM room_members'), [{ revoked_at: '2026-11-01T12:00:00.000Z', revoked_by: ACTOR }]);

  db.exec(inviteSql(command, stateOf(db, command), NOW, 'g3'));
  db.exec(roomSql({ kind: 'archive', roomId: ROOM }, NOW));
  assert.equal(rows(db, 'SELECT id FROM room_members WHERE revoked_at IS NULL').length, 0, 'archiving ends every invitation');
  assert.ok(rows(db, 'SELECT archived_at FROM rooms')[0]!.archived_at);
  assert.deepEqual(rows(db, 'SELECT actor, action, room_id, grant_id, subject_email FROM access_events ORDER BY id').map((e) => [e.action, e.grant_id]), [
    ['room_created', null],
    ['content_added', null],
    ['content_removed', null],
    ['invite_created', 'g1'],
    ['grant_changed', 'g1'],
    ['grant_revoked', 'g1'],
    ['invite_created', 'g3'],
    ['room_archived', null],
  ], 'the second revoke changed nothing and wrote nothing');
});

test('an invitation is refused for a member of the install and for a missing or archived room', () => {
  const db = schema();
  db.exec("INSERT INTO members (email, role) VALUES ('counsel@firm.example', 'counsel')");
  const member = parseRoomArgs(['invite', ROOM, 'counsel@firm.example', 'investor']) as Invite;
  db.exec(roomSql({ kind: 'create', name: 'Harbor', folders: ['Deals/Harbor Seed'] }, NOW, ids(ROOM)));
  assert.throws(() => inviteSql(member, stateOf(db, member), NOW, 'g1'), /already sees every room/);
  const missing = parseRoomArgs(['invite', 'bbbbbbbb-0000', 'ivy@fund.example', 'investor']) as Invite;
  assert.throws(() => inviteSql(missing, stateOf(db, missing), NOW, 'g1'), /no such room/);
  db.exec(roomSql({ kind: 'archive', roomId: ROOM }, NOW));
  const archived = parseRoomArgs(['invite', ROOM, 'ivy@fund.example', 'investor']) as Invite;
  assert.throws(() => inviteSql(archived, stateOf(db, archived), NOW, 'g1'), /no such room/);
});

test('revoke-all ends every live invitation of one person and no one else\'s; values are quoted', () => {
  const db = schema();
  db.exec(roomSql({ kind: 'create', name: "O'Brien deal", folders: ["Deals/O'Brien"] }, NOW, ids(ROOM)));
  for (const [id, email] of [['g1', "o'brien@fund.example"], ['g2', 'ivy@fund.example']]) {
    const command = parseRoomArgs(['invite', ROOM, email!, 'investor']) as Invite;
    db.exec(inviteSql(command, stateOf(db, command), NOW, id!));
  }
  db.exec(roomSql(parseRoomArgs(['revoke-all', "O'Brien@Fund.Example"]) as Exclude<RoomCommand, { kind: 'invite' }>, NOW));
  assert.deepEqual(rows(db, 'SELECT id FROM room_members WHERE revoked_at IS NULL'), [{ id: 'g2' }]);
  assert.equal(rows(db, 'SELECT name FROM rooms')[0]!.name, "O'Brien deal");
});

test('member remove treats only a database without migration 0012 as nothing to revoke', () => {
  assert.equal(isMissingRoomsTable('✘ [ERROR] no such table: room_members: SQLITE_ERROR'), true);
  assert.equal(isMissingRoomsTable('✘ [ERROR] Authentication error'), false);
});

test('matter create makes a matter room; matter invite invites counsel there, and each role goes only to its kind of room', () => {
  const db = schema();
  const MATTER = 'bbbbbbbb-0000-4000-8000-00000000000b';
  const create = parseRoomArgs(['matter', 'create', 'Harbor', 'dispute', '--folder', 'Matters/Harbor']);
  assert.deepEqual(create, { kind: 'create', name: 'Harbor dispute', folders: ['Matters/Harbor'], roomKind: 'matter' });
  db.exec(roomSql(create as Exclude<RoomCommand, { kind: 'invite' }>, NOW, ids(MATTER)));
  db.exec(roomSql({ kind: 'create', name: 'Harbor seed', folders: ['Deals/Harbor Seed'] }, NOW, ids(ROOM)));
  assert.deepEqual(rows(db, 'SELECT id, kind FROM rooms ORDER BY id'), [{ id: ROOM, kind: 'deal' }, { id: MATTER, kind: 'matter' }]);

  const counsel = parseRoomArgs(['matter', 'invite', MATTER, ' Cy@Firm.Example ', 'Cy', '--days', '30']) as Invite;
  assert.deepEqual(counsel, { kind: 'invite', roomId: MATTER, email: 'cy@firm.example', role: 'counsel', name: 'Cy', days: 30 });
  db.exec(inviteSql(counsel, stateOf(db, counsel), NOW, 'g1'));
  assert.deepEqual(rows(db, 'SELECT room_id, email, role FROM room_members'), [{ room_id: MATTER, email: 'cy@firm.example', role: 'counsel' }]);

  const counselToDeal = parseRoomArgs(['matter', 'invite', ROOM, 'cy@firm.example']) as Invite;
  assert.throws(() => inviteSql(counselToDeal, stateOf(db, counselToDeal), NOW, 'g2'), /not a matter room/);
  const investorToMatter = parseRoomArgs(['invite', MATTER, 'ivy@fund.example', 'investor']) as Invite;
  assert.throws(() => inviteSql(investorToMatter, stateOf(db, investorToMatter), NOW, 'g3'), /not a deal room/);
  assert.throws(() => parseRoomArgs(['matter', 'create', 'x', '--folder', 'Matters/Counsel privileged']), /privileged/);
});

test('an invitation with no --days outlasts a round: 120 days, over the 83-day average and the 106-day late-stage average (#202)', () => {
  assert.equal(DEFAULT_DAYS, 120);
  const db = schema();
  db.exec(roomSql({ kind: 'create', name: 'Harbor seed', folders: ['Deals/Harbor Seed'] }, NOW, ids(ROOM)));
  const command = parseRoomArgs(['invite', ROOM, 'ivy@fund.example', 'investor']) as Invite;
  db.exec(inviteSql(command, stateOf(db, command), NOW, 'g1'));
  assert.deepEqual(rows(db, 'SELECT expires_at FROM room_members'), [{ expires_at: '2027-03-01T12:00:00.000Z' }]);
  const counsel = parseRoomArgs(['matter', 'invite', ROOM, 'cy@firm.example']) as Invite;
  assert.equal(counsel.days, 120, 'matter invite takes the same default');
});

test('the owner is warned of each active invitation ending within 14 days, soonest first, with the command that extends it (#202)', () => {
  assert.equal(WARN_DAYS, 14);
  const db = schema();
  const MATTER = 'bbbbbbbb-0000-4000-8000-00000000000b';
  const ARCHIVED = 'cccccccc-0000-4000-8000-00000000000c';
  db.exec(roomSql({ kind: 'create', name: 'Harbor seed', folders: ['Deals/Harbor Seed'] }, NOW, ids(ROOM)));
  db.exec(roomSql({ kind: 'create', name: 'Harbor dispute', folders: ['Matters/Harbor'], roomKind: 'matter' }, NOW, ids(MATTER)));
  db.exec(roomSql({ kind: 'create', name: 'Old seed', folders: ['Deals/Old'] }, NOW, ids(ARCHIVED)));
  const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
  // [id, room, email, role, invited, accept_by, joined, expires, revoked]
  const grants: [string, string, string, string, string, string, string | null, string, string | null][] = [
    ['g1', ROOM, 'ivy@fund.example', 'investor', day(-100), day(-86), day(-99), day(5), null], // used, ends in 5 days: warned
    ['g2', MATTER, 'cy@firm.example', 'counsel', day(-100), day(-86), day(-90), day(14), null], // ends on day 14 exactly: warned
    ['g3', ROOM, 'bea@angel.example', 'investor', day(-2), day(12), null, day(10), null], // unused, still inside its window: warned
    ['g4', ROOM, 'otto@fund.example', 'investor', day(-100), day(-86), day(-99), day(15), null], // ends on day 15: not yet
    ['g5', ROOM, 'rex@fund.example', 'investor', day(-100), day(-86), null, day(3), null], // never used, window closed: lapsed
    ['g6', ROOM, 'sam@fund.example', 'investor', day(-100), day(-86), day(-99), day(4), day(-1)], // revoked
    ['g7', ROOM, 'tia@fund.example', 'investor', day(-100), day(-86), day(-99), day(-1), null], // already ended
    ['g8', ARCHIVED, 'uma@fund.example', 'investor', day(-100), day(-86), day(-99), day(2), null], // archived room, below
  ];
  const insert = db.prepare(
    "INSERT INTO room_members (id, room_id, email, role, invited_by, invited_at, accept_by, joined_at, expires_at, revoked_at) VALUES (?1, ?2, ?3, ?4, 'owner-cli', ?5, ?6, ?7, ?8, ?9)",
  );
  for (const grant of grants) insert.run(...grant);
  db.exec(roomSql({ kind: 'archive', roomId: ARCHIVED }, NOW));

  const soon = rows(db, endingSoonSql(NOW)) as unknown as EndingSoon[];
  assert.deepEqual(soon.map((row) => row.email), ['ivy@fund.example', 'bea@angel.example', 'cy@firm.example']);
  const notice = endingSoonNotice(soon, NOW);
  assert.equal(
    notice,
    '\n3 invitations end within 14 days:\n' +
      `  ivy@fund.example in Harbor seed: ends 2026-11-06, in 5 days. To extend (days count from today): npm run room -- invite ${ROOM} ivy@fund.example investor --days <1-730>\n` +
      `  bea@angel.example in Harbor seed: ends 2026-11-11, in 10 days. To extend (days count from today): npm run room -- invite ${ROOM} bea@angel.example investor --days <1-730>\n` +
      `  cy@firm.example in Harbor dispute: ends 2026-11-15, in 14 days. To extend (days count from today): npm run room -- matter invite ${MATTER} cy@firm.example --days <1-730>\n`,
  );
  assert.match(endingSoonNotice(soon.slice(0, 1), new Date(Date.parse(soon[0]!.expires_at) - 3_600_000)), /^\nAn invitation ends within 14 days:\n.*in 1 day\. /);
  assert.equal(endingSoonNotice([], NOW), '', 'nothing ending soon prints nothing');

  // Extending it, as the notice says, ends the warning and keeps the one invitation.
  const extend = parseRoomArgs(['invite', ROOM, 'ivy@fund.example', 'investor', '--days', '60']) as Invite;
  db.exec(inviteSql(extend, stateOf(db, extend), NOW, 'unused'));
  assert.deepEqual((rows(db, endingSoonSql(NOW)) as unknown as EndingSoon[]).map((row) => row.email), ['bea@angel.example', 'cy@firm.example']);
  assert.equal(rows(db, "SELECT id FROM room_members WHERE email = 'ivy@fund.example'").length, 1);
});

test('the owner is warned before a share passes the 50 free seats', () => {
  assert.equal(FREE_SEATS, 50);
  const db = schema();
  db.exec(roomSql({ kind: 'create', name: 'Harbor seed', folders: ['Deals/Harbor Seed'] }, NOW, ids(ROOM)));
  db.exec("INSERT INTO members (email, role) VALUES ('owner@doe.example', 'owner')");
  const seats = () => Number((db.prepare(seatsSql(NOW)).get() as { seats: number }).seats);
  for (let i = 1; i < SEAT_WARN - 1; i++) {
    const command = parseRoomArgs(['invite', ROOM, `investor${i}@fund.example`, 'investor']) as Invite;
    db.exec(inviteSql(command, stateOf(db, command), NOW, `g${i}`));
  }
  assert.equal(seats(), SEAT_WARN - 1);
  assert.equal(seatNotice(seats()), '', 'no warning while well under');
  db.exec("INSERT INTO room_members (id, room_id, email, role, invited_by, invited_at, accept_by, expires_at, revoked_at) VALUES ('old', 'aaaaaaaa-0000-4000-8000-00000000000a', 'gone@fund.example', 'investor', 'x', '2026-01-01T00:00:00.000Z', '2026-01-15T00:00:00.000Z', '2026-02-01T00:00:00.000Z', NULL)");
  assert.equal(seats(), SEAT_WARN - 1, 'an ended invitation uses no seat');
  // Never accepted and past accept_by: worker/rooms.ts ACTIVE_SQL refuses it, as endingSoonSql does (#575).
  db.exec("INSERT INTO room_members (id, room_id, email, role, invited_by, invited_at, accept_by, expires_at, revoked_at) VALUES ('lapsed', 'aaaaaaaa-0000-4000-8000-00000000000a', 'lapsed@fund.example', 'investor', 'x', '2026-10-01T00:00:00.000Z', '2026-10-15T00:00:00.000Z', '2026-12-31T00:00:00.000Z', NULL)");
  assert.equal(seats(), SEAT_WARN - 1, 'an invitation never accepted in its window uses no seat');
  db.exec("UPDATE room_members SET joined_at = '2026-10-10T00:00:00.000Z' WHERE id = 'lapsed'");
  assert.equal(seats(), SEAT_WARN, 'the same invitation, accepted in its window, uses a seat');
  db.exec("UPDATE room_members SET revoked_at = '2026-11-01T00:00:00.000Z' WHERE id = 'lapsed'");
  const next = parseRoomArgs(['invite', ROOM, 'one-more@fund.example', 'investor']) as Invite;
  db.exec(inviteSql(next, stateOf(db, next), NOW, 'g-next'));
  assert.match(seatNotice(seats()), /^\n45 people can now sign in to this room\. The free Cloudflare Zero Trust plan covers 50; each person past 50 who signs in costs \$7 a month\.\n/);
  assert.match(seatNotice(51), /past the 50 free Cloudflare Zero Trust seats/);
});
