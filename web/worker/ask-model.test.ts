// SPDX-License-Identifier: Apache-2.0
// A refused model call is retried once, then handed to the fallback model, and a question that fails on our side
// is given back to the daily cap. Every call stays env.AI.run(model, input) with no options (no gateway).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseParser } from '../src/scripts/chat-sse.ts';
import { askRequest, harness, type Harness } from './ask-fixtures.ts';
import { FALLBACK_MODEL, MODEL_RETRY_MS, modelFailure, runModel } from './ask-model.ts';
import { REASONING_EFFORT } from './ask.ts';
import { handle } from './index.ts';
import { chunk } from './room-fixtures.ts';

const ctx = {} as ExecutionContext;
// A room still on glm-5.3-flash, which Workers AI retires on 2026-11-15 (budget.ts DEPRECATED_MODELS): on the default
// model, the fallback itself, there is no second model to go to.
const PRIMARY = '@cf/zai-org/glm-5.3-flash';
const ON_PRIMARY = { LEGALLAS_MODEL: PRIMARY };
const CAPACITY = () => new Error('3040: Capacity temporarily exceeded, please try again.');

async function ask(h: Harness) {
  const res = await handle(askRequest({ question: 'When was the meeting?' }), h.env, ctx);
  if (res.status !== 200) return { status: res.status, body: (await res.json()) as unknown, events: [] };
  const parser = sseParser();
  return { status: 200, body: null, events: [...parser.push(await res.text()), ...parser.end()] };
}

const questionsToday = (h: Harness) => (h.db.prepare('SELECT coalesce(sum(questions), 0) AS n FROM usage').get() as { n: number }).n;

/** Runs `body` with console.error captured; returns what was logged. */
async function logged(body: () => Promise<void>): Promise<unknown[][]> {
  const original = console.error;
  const lines: unknown[][] = [];
  console.error = (...args: unknown[]) => lines.push(args);
  try {
    await body();
  } finally {
    console.error = original;
  }
  return lines;
}

test('refusals are told apart by kind only: capacity, unavailable or other', () => {
  assert.equal(modelFailure(CAPACITY()), 'capacity');
  assert.equal(modelFailure(new Error('429 Too Many Requests')), 'capacity');
  assert.equal(modelFailure(new Error('503 Service Unavailable')), 'unavailable');
  assert.equal(modelFailure(new Error('5007: No such model')), 'other');
  assert.equal(modelFailure('nonsense'), 'other');
  assert.ok(MODEL_RETRY_MS > 0 && MODEL_RETRY_MS <= 2000, 'a short pause');
  assert.ok(Object.hasOwn(REASONING_EFFORT, FALLBACK_MODEL), 'the fallback has its own reasoning effort');
});

test('a call refused for capacity is asked once more after a short pause, and the answer streams', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'Tuesday.')], answer: 'READ: Tuesday [doc:doc-live-a p:1].', refuse: (_, call) => (call === 0 ? CAPACITY() : null), extraVars: ON_PRIMARY });
  let got: Awaited<ReturnType<typeof ask>> | undefined;
  const lines = await logged(async () => void (got = await ask(h)));
  assert.equal(got!.status, 200);
  assert.deepEqual(h.runs.map((r) => r.model), [PRIMARY, PRIMARY]);
  assert.deepEqual(got!.events.at(-1), { event: 'done', data: { dontKnow: false } });
  assert.deepEqual(lines, [['ask_model_retry', 'capacity']]);
  assert.equal(questionsToday(h), 1);
});

test('refused twice, the question goes to the fallback model with its own effort and still no options', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'Tuesday.')], answer: 'READ: Tuesday [doc:doc-live-a p:1].', refuse: (model) => (model === PRIMARY ? CAPACITY() : null), extraVars: ON_PRIMARY });
  let got: Awaited<ReturnType<typeof ask>> | undefined;
  const lines = await logged(async () => void (got = await ask(h)));
  assert.equal(got!.status, 200);
  assert.deepEqual(h.runs.map((r) => r.model), [PRIMARY, PRIMARY, FALLBACK_MODEL]);
  assert.equal(h.runs[2]!.input.reasoning_effort, REASONING_EFFORT[FALLBACK_MODEL]);
  assert.ok(h.runs.every((r) => r.options === undefined), 'no options object, so no AI Gateway');
  assert.equal(JSON.stringify(h.runs[2]!.input.messages), JSON.stringify(h.runs[0]!.input.messages), 'the same prompt');
  assert.deepEqual(lines, [['ask_model_retry', 'capacity'], ['ask_model_fallback', 'capacity']]);
  assert.equal(questionsToday(h), 1);
});

test('an error that is not a refusal goes straight to the fallback', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], refuse: (model) => (model === PRIMARY ? new Error('5007: No such model') : null), extraVars: ON_PRIMARY });
  const lines = await logged(async () => void (await ask(h)));
  assert.deepEqual(h.runs.map((r) => r.model), [PRIMARY, FALLBACK_MODEL]);
  assert.deepEqual(lines, [['ask_model_fallback', 'other']]);
});

test('on the default model, the fallback itself: refused twice is 503 model_unavailable, with no second model', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], refuse: () => CAPACITY() });
  assert.equal(h.env.LEGALLAS_MODEL, FALLBACK_MODEL);
  let got: Awaited<ReturnType<typeof ask>> | undefined;
  const lines = await logged(async () => void (got = await ask(h)));
  assert.equal(got!.status, 503);
  assert.deepEqual(got!.body, { error: 'model_unavailable' });
  assert.deepEqual(h.runs.map((r) => r.model), [FALLBACK_MODEL, FALLBACK_MODEL]);
  assert.deepEqual(lines.map((l) => l[0]), ['ask_model_retry', 'ask_model_unavailable', 'ask_model_failed']);
  assert.equal(questionsToday(h), 0);
});

test('every model refused: 503 model_unavailable, and the question is given back', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], refuse: () => CAPACITY(), extraVars: ON_PRIMARY });
  let got: Awaited<ReturnType<typeof ask>> | undefined;
  const lines = await logged(async () => void (got = await ask(h)));
  assert.equal(got!.status, 503);
  assert.deepEqual(got!.body, { error: 'model_unavailable' });
  assert.equal(h.runs.length, 3);
  assert.deepEqual(lines.map((l) => l[0]), ['ask_model_retry', 'ask_model_fallback', 'ask_model_unavailable', 'ask_model_failed']);
  assert.ok(lines.every((l) => l.every((v) => typeof v === 'string' && v.length < 32)), 'short words only, never the message');
  assert.equal(questionsToday(h), 0);
});

test('a search outage, or every model refused in the stream, gives the question back; a blank answer twice does not', async () => {
  const down = harness({ searchFails: true });
  await logged(async () => assert.equal((await ask(down)).status, 503));
  assert.equal(questionsToday(down), 0);
  // The first answer is blank, and the call that should replace it is refused by every model: our failure.
  const refused = harness({ chunks: [chunk('doc-live-a', 1, 'x')], answer: '', refuse: (_, call) => (call === 0 ? null : CAPACITY()) });
  let got: Awaited<ReturnType<typeof ask>> | undefined;
  await logged(async () => void (got = await ask(refused)));
  assert.deepEqual(got!.events.at(-1), { event: 'error', data: { error: 'answer_failed' } });
  assert.equal(questionsToday(refused), 0);
  // Two blank answers: the model ran twice and the question counts, as the cap guards model spend.
  const blank = harness({ chunks: [chunk('doc-live-a', 1, 'x')], answer: '' });
  await logged(async () => void (got = await ask(blank)));
  assert.deepEqual(got!.events.at(-1), { event: 'error', data: { error: 'answer_failed' } });
  assert.equal(questionsToday(blank), 1);
});

test('the fallback model is never its own fallback', async () => {
  const runs: string[] = [];
  const ai = { run: async (model: string) => (runs.push(model), Promise.reject(CAPACITY())) } as unknown as Pick<Ai, 'run'>;
  await logged(async () => {
    await assert.rejects(runModel(ai, FALLBACK_MODEL, [{ role: 'user', content: 'q' }], async () => undefined), { name: 'ModelUnavailable' });
  });
  assert.deepEqual(runs, [FALLBACK_MODEL, FALLBACK_MODEL]);
});
