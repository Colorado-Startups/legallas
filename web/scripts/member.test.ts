// SPDX-License-Identifier: Apache-2.0
// npm run member (scripts/member.ts): parsing, and the SQL it writes, audit rows included, run on real SQLite with every
// migration applied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ACCESS_TOKEN_ENV } from './access-offboard.ts';
import {
  accountFromWhoami,
  actorFromWhoami,
  manualSteps,
  memberSql,
  offboardReport,
  offboardSql,
  parseMemberArgs,
  type MemberCommand,
} from './member.ts';
import { ACTOR } from './room.ts';

const BY = 'founder@example.test';

function schema(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, file), 'utf8'));
  return db;
}

const run = (db: DatabaseSync, command: MemberCommand, actor = BY) => db.exec(memberSql(command, actor));
const events = (db: DatabaseSync) =>
  db.prepare('SELECT actor, action, room_id, subject_email, detail_code FROM access_events ORDER BY id').all().map((r) => ({ ...r }));
const members = (db: DatabaseSync) => db.prepare('SELECT email, role, name FROM members ORDER BY email').all().map((r) => ({ ...r }));

test('add normalizes the email and accepts only known roles', () => {
  assert.deepEqual(parseMemberArgs(['add', ' Ada@Firm.Example ', 'counsel', 'Ada', 'Lovelace']), {
    kind: 'add',
    email: 'ada@firm.example',
    role: 'counsel',
    name: 'Ada Lovelace',
  });
  assert.throws(() => parseMemberArgs(['add', 'ada@firm.example', 'admin']), /usage/);
  assert.throws(() => parseMemberArgs(['add', 'not-an-email', 'counsel']), /usage/);
});

test('--local is ignored by the parser wherever it appears', () => {
  assert.deepEqual(parseMemberArgs(['--local', 'remove', 'ada@firm.example']), { kind: 'remove', email: 'ada@firm.example' });
  assert.deepEqual(parseMemberArgs(['list', '--local']), { kind: 'list' });
  assert.deepEqual(parseMemberArgs(['history', '--local']), { kind: 'history', email: null });
});

test('history takes no email or one valid email', () => {
  assert.deepEqual(parseMemberArgs(['history']), { kind: 'history', email: null });
  assert.deepEqual(parseMemberArgs(['history', 'Ada@Firm.Example']), { kind: 'history', email: 'ada@firm.example' });
  assert.throws(() => parseMemberArgs(['history', 'not-an-email']), /usage/);
  assert.throws(() => parseMemberArgs(['history', 'ada@firm.example', 'extra']), /usage/);
});

test('generated SQL quotes every value', () => {
  const sql = memberSql({ kind: 'add', email: "o'brien@firm.example", role: 'counsel', name: "Pat O'Brien" }, "o'neil@example.test");
  assert.match(sql, /VALUES \('o''brien@firm\.example', 'counsel', 'Pat O''Brien'\)/);
  assert.match(sql, /SELECT 'o''neil@example\.test', 'person_added'/);
  assert.equal(memberSql({ kind: 'add', email: 'a@b.co', role: 'owner', name: null }).includes(', NULL)'), true);
  assert.match(memberSql({ kind: 'remove', email: 'a@b.co' }), /DELETE FROM members WHERE email = 'a@b\.co';$/);
});

test('add refuses the retired family role with a message that says so, whatever the email', () => {
  for (const [email, role] of [['Kin@Mail.Example', 'family'], ['not-an-email', 'family'], ['kin@mail.example', 'FAMILY']] as const) {
    assert.throws(() => parseMemberArgs(['add', email, role, 'Pat', 'Doe']), /family role was retired.*owner and counsel only/, role);
  }
  assert.throws(() => parseMemberArgs(['add', 'kin@mail.example', 'relative']), /^Error: usage/, 'any other role is just unknown');
  assert.deepEqual(parseMemberArgs(['remove', 'Kin@Mail.Example']), { kind: 'remove', email: 'kin@mail.example' }, 'a former member can still be removed');
});

test('each add, role change and removal writes one audit row: who ran it, which email, which role', () => {
  const db = schema();
  run(db, { kind: 'add', email: 'ada@firm.example', role: 'counsel', name: 'Ada' });
  run(db, { kind: 'add', email: 'ada@firm.example', role: 'owner', name: 'Ada' });
  run(db, { kind: 'remove', email: 'ada@firm.example' });
  assert.deepEqual(events(db), [
    { actor: BY, action: 'person_added', room_id: null, subject_email: 'ada@firm.example', detail_code: 'counsel' },
    { actor: BY, action: 'grant_changed', room_id: null, subject_email: 'ada@firm.example', detail_code: 'role_counsel_to_owner' },
    { actor: BY, action: 'person_disabled', room_id: null, subject_email: 'ada@firm.example', detail_code: 'owner' },
  ]);
  assert.deepEqual(members(db), []);
});

test('no change, no row: a re-add with the same role (a new name only) or a removal of a non-member writes nothing', () => {
  const db = schema();
  run(db, { kind: 'add', email: 'ada@firm.example', role: 'counsel', name: 'Ada' });
  run(db, { kind: 'add', email: 'ada@firm.example', role: 'counsel', name: 'Ada L.' });
  run(db, { kind: 'remove', email: 'nobody@firm.example' });
  assert.equal(events(db).length, 1);
  assert.deepEqual(members(db), [{ email: 'ada@firm.example', role: 'counsel', name: 'Ada L.' }]);
});

test('the default actor is the room CLI\'s, as scripts/room.ts writes', () => {
  const db = schema();
  db.exec(memberSql({ kind: 'add', email: 'ada@firm.example', role: 'counsel', name: null }));
  assert.equal(events(db)[0]?.actor, ACTOR);
});

test('the audit rows cannot be changed or deleted (migration 0012 triggers)', () => {
  const db = schema();
  run(db, { kind: 'add', email: 'ada@firm.example', role: 'counsel', name: null });
  assert.throws(() => db.exec("UPDATE access_events SET actor = 'someone-else'"), /append-only/);
  assert.throws(() => db.exec('DELETE FROM access_events'), /append-only/);
});

test('history lists the install\'s member events only, oldest first, for one email when given', () => {
  const db = schema();
  run(db, { kind: 'add', email: 'ada@firm.example', role: 'counsel', name: null });
  run(db, { kind: 'add', email: 'bo@firm.example', role: 'counsel', name: null });
  // A deal room's event carries its room_id and is not a member change.
  db.exec("INSERT INTO access_events (actor, action, room_id, subject_email) VALUES ('owner-cli', 'grant_changed', 'aaaaaaaa-0000-4000-8000-00000000000a', 'ada@firm.example')");
  const all = db.prepare(memberSql({ kind: 'history', email: null })).all();
  assert.deepEqual(all.map((r) => r.subject_email), ['ada@firm.example', 'bo@firm.example']);
  const one = db.prepare(memberSql({ kind: 'history', email: 'ada@firm.example' })).all();
  assert.deepEqual(one.map((r) => [r.action, r.detail_code]), [['person_added', 'counsel']]);
});

test('offboarding writes access_removed, sessions_ended and one access_sync_failed per kind of failure, all valid rows', () => {
  const db = schema();
  db.exec(offboardSql(BY, 'ada@firm.example', { removedFrom: ['Room members', 'AI connect'], sessionsEnded: true, failures: ['still_allowed'], problems: ['x'] }));
  assert.deepEqual(events(db).map((e) => [e.action, e.detail_code]), [
    ['access_removed', 'policies_2'],
    ['sessions_ended', null],
    ['access_sync_failed', 'still_allowed'],
  ]);
  assert.equal(offboardSql(BY, 'ada@firm.example', { removedFrom: [], sessionsEnded: false, failures: [], problems: [] }), '');
});

test('every failure code offboard can report fits access_events.detail_code', async () => {
  const source = readFileSync(join(import.meta.dirname, 'access-offboard.ts'), 'utf8');
  const codes = [...source.matchAll(/fail\('([^']+)'/g)].map((m) => m[1]!);
  assert.ok(codes.length >= 8, 'found the codes');
  const db = schema();
  for (const code of codes) db.exec(offboardSql(BY, 'ada@firm.example', { removedFrom: [], sessionsEnded: false, failures: [code], problems: [] }));
  assert.equal(events(db).length, codes.length);
});

test('who ran it: the email of wrangler\'s login, else the room CLI; the account from the env, else the only one', () => {
  const login = '⛅️ wrangler\n{"loggedIn":true,"email":"Founder@Example.test","accounts":[{"id":"0123456789abcdef0123456789abcdef","name":"x"}]}';
  assert.equal(actorFromWhoami(login), 'founder@example.test');
  assert.equal(actorFromWhoami('{"loggedIn":true,"authType":"API Token"}'), ACTOR);
  assert.equal(actorFromWhoami('not json'), ACTOR);
  assert.equal(actorFromWhoami(''), ACTOR);
  assert.equal(accountFromWhoami(login, {}), '0123456789abcdef0123456789abcdef');
  assert.equal(accountFromWhoami(login, { CLOUDFLARE_ACCOUNT_ID: 'fedcba9876543210fedcba9876543210' }), 'fedcba9876543210fedcba9876543210');
  assert.equal(accountFromWhoami('{"accounts":[{"id":"a"},{"id":"b"}]}', {}), '', 'two accounts: no guess');
});

test('without the token, remove prints both Access steps and how to do them in one step', () => {
  const text = manualSteps('ada@firm.example', false);
  assert.match(text, /remove ada@firm\.example from the Access policy and revoke their sessions/);
  assert.ok(text.includes(ACCESS_TOKEN_ENV));
  assert.equal(manualSteps('ada@firm.example', true).includes(ACCESS_TOKEN_ENV), false);
});

test('the offboarding report says what was done and what was not', () => {
  const done = offboardReport('ada@firm.example', { removedFrom: ['Room members'], sessionsEnded: true, failures: [], problems: [] });
  assert.match(done, /removed ada@firm\.example from "Room members", confirmed/);
  assert.match(done, /ended their sessions/);
  const partly = offboardReport('ada@firm.example', { removedFrom: [], sessionsEnded: false, failures: ['sessions_not_ended'], problems: ['Ending failed.'] });
  assert.match(partly, /^Not done: Ending failed\.$/m);
  assert.match(offboardReport('ada@firm.example', { removedFrom: [], sessionsEnded: true, failures: [], problems: [] }), /no policy of the room named/);
});
