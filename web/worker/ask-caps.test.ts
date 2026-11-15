// SPDX-License-Identifier: Apache-2.0
// Ask's daily questions counter and the MCP's tool-call counter (mcp/caps.ts) on real SQLite: one usage row per member
// and UTC day, each counter with its own allowance. The tool-call cap on its own is in mcp/caps.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeToolCall } from '../mcp/caps.ts';
import { takeQuestion } from './ask.ts';
import { testDb } from './sqlite-d1.ts';

const A = 'ada@firm.example';
const DAY = '2026-10-01';

function usage(sqlite: ReturnType<typeof testDb>['sqlite']) {
  return sqlite
    .prepare('SELECT email, day, questions, tool_calls FROM usage ORDER BY email, day')
    .all()
    .map((r) => ({ ...r }));
}

test("Ask's questions counter and the tool-call counter share a row without touching each other", async () => {
  const { db, sqlite } = testDb();
  assert.equal(await takeQuestion(db, A, 2, DAY), true);
  assert.equal(await takeToolCall(db, A, 1, DAY), true);
  assert.equal(await takeToolCall(db, A, 1, DAY), false, 'tool cap reached');
  assert.equal(await takeQuestion(db, A, 2, DAY), true, 'Ask still has its own allowance');
  assert.equal(await takeQuestion(db, A, 2, DAY), false);
  assert.deepEqual(usage(sqlite), [{ email: A, day: DAY, questions: 2, tool_calls: 1 }]);
});
