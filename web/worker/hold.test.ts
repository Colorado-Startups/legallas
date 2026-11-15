// SPDX-License-Identifier: Apache-2.0
// Legal hold through the gate on real SQLite (every migration applied). The Data room page
// (quality-speed/pages/data-room/list.ts) reads these tests by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Role } from './env.ts';
import { addCustodian, HOLD_CANNOT_REACH, HOLD_CANNOT_REACH_HEADING, HOLD_RECORDS_ONLY, holdNotice, recordAcknowledgment, startHold } from './hold.ts';
import { handle } from './index.ts';
import { routes } from './routes/hold.ts';
import { COUNSEL, HOST, OWNER, roomsDb, roomsEnv, SAME_ORIGIN } from './rooms-fixtures.ts';

const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
const WEB = join(import.meta.dirname, '..');

const as = (db: D1Database, email: string, path: string, init: RequestInit = {}) =>
  handle(new Request(`${HOST}${path}`, init), roomsEnv(db, email).env, ctx);
const post = (db: D1Database, email: string, path: string, body: unknown = {}) =>
  as(db, email, path, { method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify(body) });
const start = (db: D1Database, email: string, body: unknown = {}) => post(db, email, '/api/hold', body);

test('a hold starts with no case number and stores the date and who', async () => {
  const { db, sqlite } = roomsDb();
  const before = new Date().toISOString();
  const res = await start(db, COUNSEL);
  const after = new Date().toISOString();
  assert.equal(res.status, 201);

  const rows = sqlite.prepare('SELECT started_at, started_by, case_number, released_at FROM legal_holds').all();
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.started_by, COUNSEL);
  assert.equal(row.case_number, null);
  assert.equal(row.released_at, null);
  assert.ok(String(row.started_at) >= before && String(row.started_at) <= after, 'the server stamps the date and time');
  assert.match(String(row.started_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  const shown = (await (await as(db, OWNER, '/api/hold')).json()) as { hold: Record<string, unknown> };
  assert.deepEqual(shown.hold, { started_at: row.started_at, started_by: COUNSEL, case_number: null });
  const events = sqlite.prepare('SELECT actor, action FROM hold_events').all().map((e) => ({ ...e }));
  assert.deepEqual(events, [{ actor: COUNSEL, action: 'hold_started' }]);

  assert.equal((await start(db, OWNER, { case_number: 'DOE-2026-1' })).status, 409, 'one hold at a time');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM legal_holds').get()!.n, 1);
  assert.throws(() => sqlite.exec('DELETE FROM hold_events'), /append-only/);
});

test('the hold screen lists AI chats, messaging, phones and version history', async () => {
  const notices = readFileSync(join(WEB, '..', 'docs', 'legal', 'product-notices.md'), 'utf8');
  assert.ok(notices.includes(`**${HOLD_CANNOT_REACH_HEADING}** ${HOLD_CANNOT_REACH.join('; ')}.`), 'word for word A7');
  const list = HOLD_CANNOT_REACH.join('\n');
  for (const named of [/AI account's chat history/, /messaging apps/, /phones/, /version history/]) assert.match(list, named);

  const page = readFileSync(join(WEB, 'src', 'pages', 'hold', 'index.astro'), 'utf8');
  assert.match(page, /<h2 [^>]*>\{HOLD_CANNOT_REACH_HEADING\}<\/h2>/);
  assert.match(page, /\{HOLD_CANNOT_REACH\.map\(\(item\) => <li>\{item\}<\/li>\)\}/);
  assert.doesNotMatch(page, /data-case-only|hidden>\s*<h2/, 'shown in every room, hold on or off');
  // Nothing refuses a removal yet, so the screen says so and never claims A7's blocking sentence.
  assert.match(page, /<p class="hold-limit">\{HOLD_RECORDS_ONLY\}<\/p>/);
  assert.match(HOLD_RECORDS_ONLY, /doesn't block deleting, cleanup or uninstall yet/);
  for (const source of [page, readFileSync(join(WEB, 'src', 'scripts', 'hold.ts'), 'utf8')]) {
    assert.doesNotMatch(source, /are blocked in this room/);
  }

  const { db } = roomsDb();
  for (const email of [OWNER, COUNSEL]) {
    const res = await as(db, email, '/api/hold');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { hold: null, custodians: [], notice: holdNotice(email), cannot_reach: [...HOLD_CANNOT_REACH] });
  }
});

const ADA = 'ada@harbor.example';
const BO = 'bo@harbor.example';

test('a hold records custodians, notice, each acknowledgment, reminders and release, and an unacknowledged one is flagged', async () => {
  const { db, sqlite } = roomsDb();
  assert.equal((await start(db, OWNER)).status, 201);
  assert.equal((await post(db, OWNER, '/api/hold/custodians', { email: 'Ada@Harbor.example', name: 'Ada Doe' })).status, 200);
  assert.equal((await post(db, OWNER, '/api/hold/custodians', { email: BO })).status, 200);
  assert.equal((await post(db, OWNER, '/api/hold/custodians', { email: BO })).status, 409, 'once each');
  assert.equal((await post(db, OWNER, '/api/hold/notice')).status, 200);
  assert.equal((await post(db, COUNSEL, '/api/hold/acknowledgments', { email: ADA })).status, 200);
  assert.equal((await post(db, COUNSEL, '/api/hold/acknowledgments', { email: ADA })).status, 409, 'recorded once');
  assert.equal((await post(db, OWNER, '/api/hold/reminders')).status, 200);

  const view = (await (await as(db, OWNER, '/api/hold')).json()) as { custodians: Record<string, unknown>[]; notice: string };
  const shown = view.custodians.map((c) => [c.email, c.name, c.notified_at !== null, c.acknowledged_by, c.last_reminded_at !== null, c.unacknowledged]);
  assert.deepEqual(shown, [
    [ADA, 'Ada Doe', true, COUNSEL, false, false],
    [BO, null, true, null, true, true],
  ]);
  for (const part of [OWNER, /auto-delete/, /phone or computer/, /Reply to say you got this notice/]) assert.match(view.notice, part instanceof RegExp ? part : new RegExp(part));

  assert.equal((await post(db, OWNER, '/api/hold/release', {})).status, 400, 'a release needs a reason');
  assert.equal((await post(db, COUNSEL, '/api/hold/release', { reason: 'DOE-2026-1 settled and dismissed' })).status, 200);
  const hold = sqlite.prepare('SELECT released_by, release_reason, released_at IS NOT NULL AS released FROM legal_holds').get();
  assert.deepEqual({ ...hold }, { released_by: COUNSEL, release_reason: 'DOE-2026-1 settled and dismissed', released: 1 });
  assert.equal(((await (await as(db, OWNER, '/api/hold')).json()) as { hold: unknown }).hold, null);
  assert.equal((await post(db, OWNER, '/api/hold/reminders')).status, 409, 'no hold on');

  const events = sqlite.prepare('SELECT actor, action, subject FROM hold_events ORDER BY id').all().map((e) => [e.actor, e.action, e.subject]);
  assert.deepEqual(events, [
    [OWNER, 'hold_started', null],
    [OWNER, 'custodian_added', ADA],
    [OWNER, 'custodian_added', BO],
    [OWNER, 'notice_sent', ADA],
    [OWNER, 'notice_sent', BO],
    [COUNSEL, 'notice_acknowledged', ADA],
    [OWNER, 'reminder_sent', BO],
    [COUNSEL, 'hold_released', null],
  ]);
  const script = readFileSync(join(WEB, 'src', 'scripts', 'hold.ts'), 'utf8');
  assert.match(script, /c\.unacknowledged \? \{ class: 'hold-flag' \}/, 'the screen flags it');
  assert.match(script, /NOT ACKNOWLEDGED/);
});

test('starting or releasing a hold needs a writing role', async () => {
  const { db, sqlite } = roomsDb();
  const { env } = roomsEnv(db, OWNER);
  const readOnly = { email: 'reader@harbor.example', role: 'limited' as Role, name: 'Reader' };
  const call = (path: string, body: unknown) => {
    const route = routes.find((r) => r.method === 'POST' && r.path === path)!;
    const request = new Request(`${HOST}${path}`, { method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify(body) });
    return route.handler({ request, env, ctx, url: new URL(request.url), member: readOnly, params: {} });
  };
  assert.equal((await call('/api/hold', {})).status, 403);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM legal_holds').get()!.n, 0);
  assert.equal((await start(db, COUNSEL)).status, 201);
  for (const path of ['/api/hold/custodians', '/api/hold/notice', '/api/hold/acknowledgments', '/api/hold/reminders', '/api/hold/release']) {
    assert.equal((await call(path, { email: ADA, reason: 'DOE test' })).status, 403, path);
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM legal_holds WHERE released_at IS NULL').get()!.n, 1, 'still on');
  assert.equal((await post(db, OWNER, '/api/hold/release', { reason: 'DOE-2026-1 withdrawn' })).status, 200, 'the owner, with flag, releases it');
});

test('two acknowledgments in the same millisecond record one event', async () => {
  const { db, sqlite } = roomsDb();
  const now = new Date('2026-11-05T12:00:00.000Z');
  const hold = await startHold(db, OWNER, now);
  assert.ok(hold);
  assert.ok(await addCustodian(db, hold.id, OWNER, 'ada@harbor.example', null, now));
  assert.equal(await recordAcknowledgment(db, hold.id, COUNSEL, 'ada@harbor.example', now), true);
  assert.equal(await recordAcknowledgment(db, hold.id, COUNSEL, 'ada@harbor.example', now), false, 'recorded once');
  const events = sqlite.prepare("SELECT count(*) AS n FROM hold_events WHERE action = 'notice_acknowledged'").get() as { n: number };
  assert.equal(events.n, 1);
});

test('two adds of one custodian in the same millisecond record one event', async () => {
  const { db, sqlite } = roomsDb();
  const now = new Date('2026-11-06T12:00:00.000Z');
  const hold = await startHold(db, OWNER, now);
  assert.ok(hold);
  assert.ok(await addCustodian(db, hold.id, OWNER, 'bo@harbor.example', null, now));
  await addCustodian(db, hold.id, OWNER, 'bo@harbor.example', null, now);
  const events = sqlite.prepare("SELECT count(*) AS n FROM hold_events WHERE action = 'custodian_added'").get() as { n: number };
  assert.equal(events.n, 1);
});
