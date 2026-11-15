// SPDX-License-Identifier: Apache-2.0
// Burst limits: the shared helper. POST /api/ask through the real gate in index.ts is in ask-burst.test.ts, the MCP
// side in mcp/burst.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withinBurst } from './burst.ts';
import { fakeLimiter } from './room-fixtures.ts';

test('withinBurst passes under the limit and refuses over it, keyed by the given key', async () => {
  const limiter = fakeLimiter(1);
  assert.equal(await withinBurst(limiter.binding, 'a@example.test', 'code'), true);
  assert.equal(await withinBurst(limiter.binding, 'a@example.test', 'code'), false);
  assert.deepEqual(limiter.keys, ['a@example.test', 'a@example.test']);
});

test('withinBurst fails open without a binding, and when the binding throws (logging the code only)', async () => {
  assert.equal(await withinBurst(undefined, 'a@example.test', 'code'), true);
  const broken = { async limit() { throw new Error('limiter down for a@example.test'); } } as unknown as RateLimit;
  const original = console.error;
  const lines: unknown[][] = [];
  console.error = (...args: unknown[]) => void lines.push(args);
  try {
    assert.equal(await withinBurst(broken, 'a@example.test', 'ask_ratelimit_error'), true);
  } finally {
    console.error = original;
  }
  assert.deepEqual(lines, [['ask_ratelimit_error']]);
});

