// SPDX-License-Identifier: Apache-2.0
// Burst limits on POST /api/ask, through the real gate in index.ts: over the limit is a 429 before anything is
// counted, and a broken limiter never blocks a question. The shared helper is in burst.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askRequest, harness } from './ask-fixtures.ts';
import { BURST_RETRY_AFTER_SECONDS } from './burst.ts';
import { handle } from './index.ts';
import { chunk, fakeLimiter } from './room-fixtures.ts';

const ctx = {} as ExecutionContext;
const QUESTION = 'What does the alpha memo say about the zebra meeting?';

function quietly<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  return run().finally(() => {
    console.error = original;
  });
}

test('Ask: over the burst limit is a 429 with Retry-After, before the daily cap, audit, retrieval or model', async () => {
  const limiter = fakeLimiter(1);
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], extraVars: { ASK_LIMIT: limiter.binding } });
  assert.equal((await handle(askRequest({ question: QUESTION }), h.env, ctx)).status, 200);
  const res = await handle(askRequest({ question: QUESTION }), h.env, ctx);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), String(BURST_RETRY_AFTER_SECONDS));
  assert.deepEqual(await res.json(), { error: 'rate_limited' });
  assert.equal(limiter.keys.length, 2);
  assert.ok(limiter.keys.every((key) => key === limiter.keys[0]), 'one key per member');
  assert.equal(h.searches.length, 1);
  assert.equal(h.runs.length, 1);
  assert.equal((h.db.prepare('SELECT questions FROM usage').get() as { questions: number }).questions, 1, 'the refused question did not count');
  assert.equal((h.db.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'ai_question'").get() as { n: number }).n, 1);
});

test('Ask: a broken limiter never blocks a question', async () => {
  const broken = { async limit() { throw new Error('down'); } } as unknown as RateLimit;
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], extraVars: { ASK_LIMIT: broken } });
  const res = await quietly(() => handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(res.status, 200);
  await res.text();
});
