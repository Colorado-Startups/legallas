// SPDX-License-Identifier: Apache-2.0
// The public-records settings and approval store (worker/public-records.ts, migration 0014) on real SQLite: names are
// cleaned before they can leave the room, settings fail closed, and a request is only ever its own member's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHECK_ID,
  cleanName,
  courtListenerToken,
  decideCheck,
  findApproved,
  findDeclined,
  MAX_PENDING,
  nameKey,
  newCheckId,
  publicRecordsEnabled,
  readCheck,
  requestCheck,
  secContact,
  sweepLapsedChecks,
} from './public-records.ts';
import { testDb } from './sqlite-d1.ts';

/** requestCheck where the member is under the cap, so a request always comes back. */
async function mustRequest(...args: Parameters<typeof requestCheck>) {
  const request = await requestCheck(...args);
  assert.ok(request, 'under the cap, a request is stored');
  return request;
}


const NOW = new Date('2026-11-01T14:05:00.000Z');
const ME = 'counsel@example.test';
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

test('the check is off unless the room sets PUBLIC_RECORDS to "1"', () => {
  assert.equal(publicRecordsEnabled({}), false);
  assert.equal(publicRecordsEnabled({ PUBLIC_RECORDS: '0' }), false);
  assert.equal(publicRecordsEnabled({ PUBLIC_RECORDS: 'yes' }), false);
  assert.equal(publicRecordsEnabled({ PUBLIC_RECORDS: '1' }), true);
});

test('the SEC contact and the CourtListener token are used only in their plain shapes', () => {
  assert.equal(secContact({ PUBLIC_RECORDS_CONTACT: ' owner@example.test ' }), 'owner@example.test');
  for (const bad of ['', 'owner', 'owner@example', 'a@b.c\r\nX: y', 'two@example.test three@example.test']) assert.equal(secContact({ PUBLIC_RECORDS_CONTACT: bad }), null, bad);
  assert.equal(courtListenerToken({ COURTLISTENER_TOKEN: 'c'.repeat(40) }), 'c'.repeat(40));
  assert.equal(courtListenerToken({ COURTLISTENER_TOKEN: 'abc def' }), null);
});

test('names: spaces collapsed, plain characters only, the same name matched however it is typed', () => {
  assert.equal(cleanName('  Harbor   Labs,\tInc. '), 'Harbor Labs, Inc.');
  assert.equal(cleanName('José Núñez-Doe'), 'José Núñez-Doe');
  assert.equal(cleanName("O'Doe & Co. (Colorado)"), "O'Doe & Co. (Colorado)");
  for (const bad of ['', 'A', '"quoted"', 'a*', 'name:value', 'x'.repeat(121), '<b>Doe</b>', '..', 42]) assert.equal(cleanName(bad), null, String(bad));
  assert.equal(nameKey('Harbor Labs, Inc.'), nameKey('harbor labs inc'));
  assert.notEqual(nameKey('Harbor Labs'), nameKey('Harbor Labs & Co'));
});

test('ids are long, random and of one shape', () => {
  const ids = new Set(Array.from({ length: 50 }, newCheckId));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, CHECK_ID);
});

test('a request is its own member\'s: read, approve and decline by anyone else read as not found', async () => {
  const { db } = testDb();
  const request = await mustRequest(db, { email: ME, name: 'Harbor Labs, Inc.', kind: 'company', sources: ['co_open_data'], via: 'Claude', now: NOW });
  assert.equal(request.state, 'pending');
  assert.equal(request.expiresAt, minutes(30).toISOString());
  assert.equal(await readCheck(db, request.id, 'someone@example.test', NOW), null);
  assert.equal(await decideCheck(db, request.id, 'someone@example.test', 'approve', NOW), null);
  assert.equal(await readCheck(db, 'not-a-valid-id!', ME, NOW), null);
  const approved = await decideCheck(db, request.id, ME, 'approve', minutes(2));
  assert.equal(approved?.state, 'approved');
  assert.equal(approved?.expiresAt, minutes(62).toISOString(), 'an hour from the approval');
  assert.equal(await decideCheck(db, request.id, ME, 'decline', minutes(3)), null, 'decided once');
  assert.ok(await findApproved(db, ME, 'harbor labs inc', 'company', minutes(61)));
  assert.equal(await findApproved(db, ME, 'harbor labs inc', 'company', minutes(63)), null);
  assert.equal(await findApproved(db, 'someone@example.test', 'Harbor Labs, Inc.', 'company', minutes(3)), null);
});

test('a decline holds until the request would have lapsed', async () => {
  const { db } = testDb();
  const request = await mustRequest(db, { email: ME, name: 'Jane Doe', kind: 'person', sources: ['sec_edgar'], via: 'Ask', now: NOW });
  await decideCheck(db, request.id, ME, 'decline', minutes(1));
  assert.ok(await findDeclined(db, ME, 'Jane Doe', 'person', minutes(29)));
  assert.equal(await findDeclined(db, ME, 'Jane Doe', 'person', minutes(31)), null);
});

test('the sweep deletes every lapsed request, anyone\'s, and nothing still open', async () => {
  const { db, sqlite } = testDb();
  const old = await mustRequest(db, { email: ME, name: 'Jane Doe', kind: 'person', sources: ['sec_edgar'], via: 'Claude', now: NOW });
  const theirs = await mustRequest(db, { email: 'someone@example.test', name: 'Harbor Labs', kind: 'company', sources: ['co_open_data'], via: 'Ask', now: NOW });
  const fresh = await mustRequest(db, { email: ME, name: 'Jane Roe', kind: 'person', sources: ['sec_edgar'], via: 'Claude', now: minutes(20) });
  assert.equal(await sweepLapsedChecks(db, minutes(31)), 2);
  const left = sqlite.prepare('SELECT id FROM record_checks').all().map((row) => row.id);
  assert.deepEqual(left, [fresh.id]);
  assert.ok(![old.id, theirs.id].some((id) => left.includes(id)));
  assert.equal(await sweepLapsedChecks(db, minutes(31)), 0);
});

test('a member may have at most MAX_PENDING requests waiting; asking again for one of them still works', async () => {
  const { db, sqlite } = testDb();
  const first = await mustRequest(db, { email: ME, name: 'Doe Company 0', kind: 'company', sources: ['co_open_data'], via: 'Claude', now: NOW });
  for (let i = 1; i < MAX_PENDING; i++) await mustRequest(db, { email: ME, name: `Doe Company ${i}`, kind: 'company', sources: ['co_open_data'], via: 'Claude', now: NOW });
  assert.equal(await requestCheck(db, { email: ME, name: 'One Too Many', kind: 'company', sources: ['co_open_data'], via: 'Claude', now: NOW }), null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM record_checks').get()!.n, MAX_PENDING, 'nothing stored past the cap');
  assert.equal((await requestCheck(db, { email: ME, name: 'Doe Company 0', kind: 'company', sources: ['co_open_data'], via: 'Claude', now: NOW }))?.id, first.id);
  assert.ok(await requestCheck(db, { email: 'someone@example.test', name: 'One Too Many', kind: 'company', sources: ['co_open_data'], via: 'Claude', now: NOW }), 'the cap is per member');
  await decideCheck(db, first.id, ME, 'decline', minutes(1));
  assert.ok(await requestCheck(db, { email: ME, name: 'One Too Many', kind: 'company', sources: ['co_open_data'], via: 'Claude', now: minutes(1) }), 'a decided request frees a place');
  assert.ok(await requestCheck(db, { email: ME, name: 'After They Lapse', kind: 'company', sources: ['co_open_data'], via: 'Claude', now: minutes(31) }), 'so does a lapsed one');
});

test('the app name is stored plain and short', async () => {
  const { db } = testDb();
  const request = await mustRequest(db, { email: ME, name: 'Jane Doe', kind: 'person', sources: ['sec_edgar'], via: '<script>Claude</script>', now: NOW });
  assert.equal(request.via, 'scriptClaudescript');
  const blank = await mustRequest(db, { email: ME, name: 'Jane Roe', kind: 'person', sources: ['sec_edgar'], via: '<>', now: NOW });
  assert.equal(blank.via, 'an AI app');
});

test('migration 0014 only adds a table and its indexes', () => {
  const sql = readFileSync(join(import.meta.dirname, '..', 'migrations', '0014_record_checks.sql'), 'utf8').replace(/--.*$/gm, '');
  const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(statements.map((s) => s.split(/\s+/).slice(0, 2).join(' ')), ['CREATE TABLE', 'CREATE INDEX', 'CREATE INDEX']);
});
