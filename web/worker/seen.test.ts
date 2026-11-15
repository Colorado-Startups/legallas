// SPDX-License-Identifier: Apache-2.0
// "New since your last visit" on the server (worker/seen.ts, migration 0008, D17): the visit round-trip through the
// real gate in room.ts on real SQLite, the same-origin write check, and a migration that only adds a table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { VISIT_GAP_MS, type Visit } from '../src/scripts/overview-news-visit.ts';
import type { Env, Role } from './env.ts';
import { handle } from './room.ts';
import { recordVisit, SEEN_PATH } from './seen.ts';
import { testDb } from './sqlite-d1.ts';

const HOST = 'http://localhost:8789';
const PEOPLE: Record<Role, string> = { owner: 'founder@example.test', counsel: 'ada@firm.example' };
const SAME_ORIGIN = { Origin: HOST, 'Sec-Fetch-Site': 'same-origin' };

function room() {
  const { db, sqlite } = testDb();
  for (const [role, email] of Object.entries(PEOPLE)) sqlite.prepare('INSERT INTO members (email, role, name) VALUES (?1, ?2, NULL)').run(email, role);
  const post = (as: Role, headers: Record<string, string> = SAME_ORIGIN, method = 'POST') => {
    const env = {
      ASSETS: { fetch: async () => new Response('shell') }, DB: db,
      TEAM_DOMAIN: '', ACCESS_AUD: '', ALLOW_DEV_IDENTITY: '1', DEV_IDENTITY_EMAIL: PEOPLE[as],
    } as unknown as Env;
    return handle(new Request(`${HOST}${SEEN_PATH}`, { method, headers }), env, {} as ExecutionContext);
  };
  const stored = () => sqlite.prepare('SELECT email, last_seen_at, since_at FROM member_seen ORDER BY email').all().map((r) => ({ ...r }));
  return { db, sqlite, post, stored };
}

test('POST /api/seen: a first visit has no since; a reload continues the visit; each member keeps their own', async () => {
  const r = room();
  for (const role of ['owner', 'counsel'] as const) {
    const first = await r.post(role);
    assert.equal(first.status, 200, role);
    const visit = (await first.json()) as Visit;
    assert.equal(visit.since, null, `${role}: a first visit`);
    assert.ok(Date.now() - Date.parse(visit.seen) < 60_000);
    const again = (await (await r.post(role)).json()) as Visit;
    assert.equal(again.since, null, `${role}: the same visit`);
    assert.ok(again.seen >= visit.seen);
  }
  assert.deepEqual(r.stored().map((row) => row.email), Object.values(PEOPLE).sort());
});

test('the round-trip: a load after the gap measures "new" from the previous visit, on any browser', async () => {
  const { db, stored } = room();
  const email = PEOPLE.counsel;
  const t0 = new Date('2026-10-20T09:00:00.000Z');
  const at = (ms: number) => new Date(t0.getTime() + ms);
  assert.deepEqual(await recordVisit(db, email, t0), { since: null, seen: t0.toISOString() });
  assert.deepEqual(await recordVisit(db, email, at(10 * 60_000)), { since: null, seen: at(10 * 60_000).toISOString() }, 'same visit');
  const later = at(10 * 60_000 + VISIT_GAP_MS);
  assert.deepEqual(await recordVisit(db, email, later), { since: at(10 * 60_000).toISOString(), seen: later.toISOString() }, 'a new visit');
  const reload = at(10 * 60_000 + VISIT_GAP_MS + 1000);
  assert.deepEqual(await recordVisit(db, email, reload), { since: at(10 * 60_000).toISOString(), seen: reload.toISOString() }, 'its since holds');
  assert.deepEqual(stored(), [{ email, last_seen_at: reload.toISOString(), since_at: at(10 * 60_000).toISOString() }]);
  const skewed = new Date(t0.getTime() - 1000);
  assert.deepEqual(await recordVisit(db, email, skewed), { since: reload.toISOString(), seen: skewed.toISOString() }, 'a clock that ran back starts a new visit');
});

test('a row that is not a pair of instants reads as a first visit and is replaced', async () => {
  const { db, sqlite, stored } = room();
  sqlite.prepare("INSERT INTO member_seen (email, last_seen_at, since_at) VALUES (?1, 'not-an-instant-at-all', 'nor-is-this-one-okay')").run(PEOPLE.owner);
  const now = new Date('2026-10-20T09:00:00.000Z');
  assert.deepEqual(await recordVisit(db, PEOPLE.owner, now), { since: null, seen: now.toISOString() });
  assert.deepEqual(stored(), [{ email: PEOPLE.owner, last_seen_at: now.toISOString(), since_at: null }]);
});

test('a write from anywhere but the room is refused before it records anything', async () => {
  const r = room();
  const refused: Record<string, string>[] = [
    {}, { Origin: HOST }, { 'Sec-Fetch-Site': 'same-origin' }, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }, { Origin: HOST, 'Sec-Fetch-Site': 'same-site' },
  ];
  for (const headers of refused) {
    const response = await r.post('owner', headers);
    assert.equal(response.status, 403, JSON.stringify(headers));
  }
  assert.equal((await r.post('owner', SAME_ORIGIN, 'GET')).status, 405, 'a read never records a visit');
  assert.deepEqual(r.stored(), []);
});

test('before migration 0008 is applied, the room answers 503 and the page keeps its browser copy', async () => {
  const r = room();
  r.sqlite.exec('DROP TABLE member_seen');
  const response = await r.post('counsel');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'unavailable' });
});

const DIR = join(import.meta.dirname, '..', 'migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const SEEN = '0008_member_seen.sql';
const schema = (db: DatabaseSync) =>
  db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all().map((r) => ({ ...r }));

test('0008 is additive: it creates member_seen and leaves every other table, index and row as it was', () => {
  assert.ok(FILES.includes(SEEN));
  const db = new DatabaseSync(':memory:');
  for (const file of FILES.filter((f) => f < SEEN)) db.exec(readFileSync(join(DIR, file), 'utf8'));
  db.exec(`
    INSERT INTO members (email, role, name) VALUES ('p@x.test', 'owner', NULL);
    INSERT INTO audit_log (email, action) VALUES ('p@x.test', 'view');
  `);
  const before = schema(db);
  const rowsBefore = db.prepare('SELECT * FROM members').all().length + db.prepare('SELECT * FROM audit_log').all().length;
  db.exec(readFileSync(join(DIR, SEEN), 'utf8'));
  const after = schema(db);
  assert.deepEqual(after.filter((entry) => entry.tbl_name !== 'member_seen'), before, 'nothing else changes');
  assert.deepEqual(after.filter((entry) => entry.tbl_name === 'member_seen').map((e) => [e.type, e.name]), [['table', 'member_seen']]);
  const rowsAfter = db.prepare('SELECT * FROM members').all().length + db.prepare('SELECT * FROM audit_log').all().length;
  assert.equal(rowsAfter, rowsBefore);
  assert.throws(() => db.exec("INSERT INTO member_seen (email, last_seen_at) VALUES ('p@x.test', 'soon')"), /CHECK constraint failed/);
});
