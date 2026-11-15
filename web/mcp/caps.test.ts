// SPDX-License-Identifier: Apache-2.0
// The daily tool-call cap on real SQLite: stops at the cap, counts per member and UTC day, and is atomic under
// concurrency. Sharing the usage row with Ask's questions counter is in worker/ask-caps.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from '../worker/sqlite-d1.ts';
import { dailyToolCap, takeToolCall } from './caps.ts';
import { DEFAULT_DAILY_TOOL_CAP } from './contract.ts';

const A = 'ada@firm.example';
const B = 'bo@firm.example';
const DAY = '2026-10-01';

function usage(sqlite: ReturnType<typeof testDb>['sqlite']) {
  return sqlite
    .prepare('SELECT email, day, questions, tool_calls FROM usage ORDER BY email, day')
    .all()
    .map((r) => ({ ...r }));
}

test('dailyToolCap reads a positive integer, else the default', () => {
  assert.equal(dailyToolCap({ DAILY_TOOL_CAP: '25' }), 25);
  for (const bad of [undefined, '', '0', '-3', '2.5', 'many']) assert.equal(dailyToolCap({ DAILY_TOOL_CAP: bad }), DEFAULT_DAILY_TOOL_CAP, String(bad));
});

test('stops at the cap: N calls pass, the next is refused and not counted', async () => {
  const { db, sqlite } = testDb();
  for (let i = 0; i < 3; i++) assert.equal(await takeToolCall(db, A, 3, DAY), true, `call ${i + 1}`);
  assert.equal(await takeToolCall(db, A, 3, DAY), false);
  assert.equal(await takeToolCall(db, A, 3, DAY), false);
  assert.deepEqual(usage(sqlite), [{ email: A, day: DAY, questions: 0, tool_calls: 3 }]);
});

test('counts per member and per UTC day', async () => {
  const { db, sqlite } = testDb();
  assert.equal(await takeToolCall(db, A, 1, DAY), true);
  assert.equal(await takeToolCall(db, A, 1, DAY), false);
  assert.equal(await takeToolCall(db, B, 1, DAY), true);
  assert.equal(await takeToolCall(db, A, 1, '2026-10-06'), true);
  assert.deepEqual(usage(sqlite), [
    { email: A, day: DAY, questions: 0, tool_calls: 1 },
    { email: A, day: '2026-10-06', questions: 0, tool_calls: 1 },
    { email: B, day: DAY, questions: 0, tool_calls: 1 },
  ]);
});

test('a cap of zero or less refuses without writing', async () => {
  const { db, sqlite } = testDb();
  assert.equal(await takeToolCall(db, A, 0, DAY), false);
  assert.deepEqual(usage(sqlite), []);
});

test('atomic: 25 concurrent calls at a cap of 10 let exactly 10 through', async () => {
  const { db, sqlite } = testDb();
  const results = await Promise.all(Array.from({ length: 25 }, () => takeToolCall(db, A, 10, DAY)));
  assert.equal(results.filter(Boolean).length, 10);
  assert.deepEqual(usage(sqlite), [{ email: A, day: DAY, questions: 0, tool_calls: 10 }]);
});
