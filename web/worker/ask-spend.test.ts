// SPDX-License-Identifier: Apache-2.0
// Ask and the spend budget: the scripts' copy of Ask's max_tokens, then POST /api/ask through the metered bindings,
// counting its model call and searches and refusing before the cap, the search or the model when there is no room.
// The guards on their own are in spend.test.ts, the budget's rules in budget.test.ts.
import './paid-month-ten.testkit.ts'; // first: a room with a $10 paid month
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseParser } from '../src/scripts/chat-sse.ts';
import { MAX_TOKENS } from './ask.ts';
import { ASK_MODEL, askRequest, harness } from './ask-fixtures.ts';
import { ASK_MAX_TOKENS, askQuestionWorst, CANCEL_MARGIN_TOKENS, earlierDaysOfMonth, inputChars, limitOf, neuronLimit, neuronsFor, PAID_STOP_NEURONS, periodOf, tokensFromChars, worstCaseNeurons } from './budget.ts';
import { monthPaid } from './spend.ts';
import { handle } from './index.ts';
import { chunk } from './room-fixtures.ts';

const ctx = {} as ExecutionContext;
const NOV = new Date('2026-11-05T12:00:00Z');
const QUESTION = 'What does the alpha memo say about the zebra meeting?';

test("the scripts' copy of Ask's max_tokens matches the worker's, and a question's worst case covers one answer", () => {
  assert.equal(ASK_MAX_TOKENS, MAX_TOKENS);
  const worst = askQuestionWorst(ASK_MODEL);
  assert.ok(worst.neurons >= neuronsFor(ASK_MODEL, 20_000, MAX_TOKENS));
  assert.equal(worst.search_semantic, 4);
});

async function events(res: Response) {
  const parser = sseParser();
  return [...parser.push(await res.text()), ...parser.end()];
}

const today = () => periodOf('neurons', new Date());
/** Today's neuron limit as the Worker reads it: 9,000, or past it on the paid month (always on the 1st, nothing paid yet). */
const dayLimit = async (h: ReturnType<typeof harness>) => neuronLimit(today(), 'worker', await monthPaid(h.env.DB, today()));
const questionsToday = (h: ReturnType<typeof harness>) =>
  (h.db.prepare('SELECT COALESCE(SUM(questions), 0) AS n FROM usage').get() as { n: number }).n;

test('Ask counts its model call and its search, and settles the hold when the answer ends', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 2, 'The zebra meeting happened.')], answer: 'READ: It happened [doc:doc-live-a p:2].', stop: 'stop' });
  const res = await handle(askRequest({ question: QUESTION }), h.env, ctx);
  assert.equal(res.status, 200);
  await events(res);
  const neurons = h.db.prepare("SELECT used FROM spend_counters WHERE meter = 'neurons' AND period = ?").get(today()) as { used: number };
  assert.equal(neurons.used, neuronsFor(ASK_MODEL, 41, 300));
  const searches = h.db.prepare("SELECT used FROM spend_counters WHERE meter = 'search_semantic'").get() as { used: number };
  assert.equal(searches.used, h.searches.length);
});

test('a member who closes the answer mid-stream: the model stream is cancelled and the hold settles below the worst case', async () => {
  // Lines, as real answers have: the shaper (answer-shape.ts) yields at line ends, where a cancel takes effect.
  const h = harness({ chunks: [chunk('doc-live-a', 2, 'The zebra meeting happened.')], answer: 'The meeting happened on the record.\n'.repeat(300), stop: 'stop' });
  const later: Promise<unknown>[] = [];
  const res = await handle(askRequest({ question: QUESTION }), h.env, { waitUntil: (promise: Promise<unknown>) => later.push(promise) } as unknown as ExecutionContext);
  const reader = res.body!.getReader(); // safe: an SSE answer has a body
  await reader.read();
  await reader.cancel();
  await Promise.all(later);
  assert.equal(later.length, 1, 'the cancel reached the metered stream, and its settle went to waitUntil');
  const input = h.runs[0]!.input;
  const neurons = (h.db.prepare("SELECT used FROM spend_counters WHERE meter = 'neurons' AND period = ?").get(today()) as { used: number }).used;
  assert.ok(neurons < worstCaseNeurons(ASK_MODEL, input), 'released from the worst case');
  assert.ok(neurons >= neuronsFor(ASK_MODEL, tokensFromChars(inputChars(input)), CANCEL_MARGIN_TOKENS), 'the whole prompt and the margin still count');
});

test('with the day spent, Ask refuses with ai_budget before the cap, the search or the model', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')] });
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', ?, ?)").run(today(), (await dayLimit(h)) - 500);
  const res = await handle(askRequest({ question: QUESTION }), h.env, ctx);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'ai_budget' });
  const retry = Number(res.headers.get('retry-after'));
  assert.ok(retry > 0 && retry <= 86_400, 'seconds to midnight UTC');
  assert.equal(h.searches.length, 0);
  assert.equal(h.runs.length, 0);
  assert.equal(questionsToday(h), 0, 'no question spent');
});

test("on the paid month Ask answers past the free 9,000, and at the month's $9.00 it refuses with ai_budget", async () => {
  // Every earlier day of this month in the analytics, none past the free 10,000: the whole $9.00 is left.
  const run = async (usedToday: (limit: number) => number) => {
    const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')] });
    for (const day of earlierDaysOfMonth(today())) h.db.prepare("INSERT INTO spend_account_days (day, neurons, read_at) VALUES (?, 0, '2026-11-05T00:10:00Z')").run(day);
    const limit = await dayLimit(h);
    assert.equal(limit, 9_000 + PAID_STOP_NEURONS.worker);
    h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', ?, ?)").run(today(), usedToday(limit));
    return { h, res: await handle(askRequest({ question: QUESTION }), h.env, ctx) };
  };
  const open = await run(() => 9_500);
  assert.equal(open.res.status, 200);
  await open.res.text();
  assert.equal(open.h.runs.length, 1, 'answered past the free day');
  const spent = await run((limit) => limit - 500);
  assert.equal(spent.res.status, 429);
  assert.deepEqual(await spent.res.json(), { error: 'ai_budget' });
  assert.equal(spent.h.runs.length, 0);
});

test("when the model's hold no longer fits, Ask refuses with ai_budget and gives the question back", async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')] });
  // Room for the output ceiling alone, not for the prompt beside it: the read passes, the hold does not.
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', ?, ?)").run(today(), (await dayLimit(h)) - neuronsFor(ASK_MODEL, 0, MAX_TOKENS));
  const res = await handle(askRequest({ question: QUESTION }), h.env, ctx);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'ai_budget' });
  assert.equal(h.runs.length, 0, 'never reached Workers AI, and no fallback was tried');
  assert.equal(questionsToday(h), 0, 'the question was given back');
});

test('with the month of searches spent (November 2026 on), Ask refuses with search_budget', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOV });
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')] });
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('search_semantic', '2026-11', ?)").run(limitOf('search_semantic', '2026-11'));
  const res = await handle(askRequest({ question: QUESTION }), h.env, ctx);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'search_budget' });
  assert.equal(h.searches.length, 0);
});

test('without its counters (migration 0007 not applied), Ask fails closed before the cap, the search or the model', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')] });
  h.db.exec('DROP TABLE spend_counters');
  const res = await handle(askRequest({ question: QUESTION }), h.env, ctx);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'budget_unavailable' });
  assert.equal(h.searches.length + h.runs.length, 0);
  assert.equal(questionsToday(h), 0);
});

test('with the law library on, Ask needs room for both searches before it starts', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOV });
  let lawSearches = 0;
  const law = { LAW_LIBRARY: '1', LAW: { get: async () => null }, LAW_SEARCH: { search: async () => ((lawSearches += 1), { search_query: '', chunks: [] }) } };
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], extraVars: law as never });
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('search_semantic', '2026-11', ?)").run(limitOf('search_semantic', '2026-11') - 1);
  const res = await handle(askRequest({ question: QUESTION }), h.env, ctx);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'search_budget' });
  assert.equal(h.searches.length + lawSearches, 0, 'one query left is not enough for the record and the law library');
  assert.equal(questionsToday(h), 0);
});

test('on localhost without LEGALLAS_DEV_REMOTE_AI, Ask refuses the billed bindings and gives the question back', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], extraVars: { LEGALLAS_DEV_REMOTE_AI: undefined } });
  const res = await handle(askRequest({ question: QUESTION }), h.env, ctx);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'dev_remote_ai_off' });
  assert.equal(h.searches.length + h.runs.length, 0, 'local D1 never counts a billed call');
  assert.equal(questionsToday(h), 0);
});
