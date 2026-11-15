// SPDX-License-Identifier: Apache-2.0
// POST /api/ask with Groq as the second backend (routes/ask.ts, ask-provider.ts): Workers AI's spent neurons hand the
// answer to Groq only through the ZDR gate; Groq's 429 is the out-of-budget answer, sent once, and the question is given
// back. Groq is a stand-in fetch: never a live call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseParser } from '../src/scripts/chat-sse.ts';
import { MAX_TOKENS } from './ask.ts';
import { ASK_MODEL, askRequest, harness, type Harness } from './ask-fixtures.ts';
import { groqSse } from './ask-groq-fixtures.ts';
import { GROQ_CHAT_URL, GROQ_PROMPT_CHARS } from './ask-groq.ts';
import { neuronLimit, neuronsFor, paidBefore, periodOf } from './budget.ts';
import { handle } from './index.ts';
import { chunk } from './room-fixtures.ts';

const ctx = {} as ExecutionContext;
const QUESTION = 'What does the alpha memo say about the zebra meeting?';
const OPEN = { ASK_GROQ: { enabled: true, zdr_confirmed: true, eval_runs: ['10000000001'] }, LEGALLAS_ASK_GROQ_API_KEY: 'groq-key' };

const today = () => periodOf('neurons', new Date());
const questionsToday = (h: Harness) => (h.db.prepare('SELECT coalesce(sum(questions), 0) AS n FROM usage').get() as { n: number }).n;
/**
 * Spends today's neurons down to `left`. A fresh database records no account days, so the day's limit is the free
 * 9,000, or on the 1st (no earlier days, nothing paid yet) the paid month's too.
 */
const spendDay = (h: Harness, left: number) =>
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', ?, ?)").run(today(), neuronLimit(today(), 'worker', paidBefore(today(), {}, {})) - left);

interface GroqCall {
  url: string;
  authorization: string | null;
  body: { model: string; messages: { content: string }[] };
}

/** Runs `body` with fetch standing in for Groq, console.error captured; the response is read inside. */
async function withGroq(respond: (call: number) => Response, body: () => Promise<Response>) {
  const original = globalThis.fetch;
  const originalError = console.error;
  const calls: GroqCall[] = [];
  const logs: unknown[][] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), authorization: headers.get('authorization'), body: JSON.parse(String(init?.body)) });
    return respond(calls.length);
  }) as typeof fetch;
  console.error = (...args: unknown[]) => logs.push(args);
  try {
    const res = await body();
    const text = await res.text();
    return { status: res.status, text, calls, logs };
  } finally {
    globalThis.fetch = original;
    console.error = originalError;
  }
}

function events(text: string) {
  const parser = sseParser();
  return [...parser.push(text), ...parser.end()];
}

const groqOk = (answer: string) => () => new Response(groqSse(answer), { status: 200 });

test('with the day spent and the gate open, Groq answers: one call, a fitted prompt, citations validated', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 2, 'The zebra meeting happened on Tuesday.'), chunk('doc-live-b', 1, 'Notes.')], extraVars: OPEN });
  spendDay(h, 500);
  const run = await withGroq(groqOk('- CONFIRMED: The meeting was on Tuesday [doc:D1 p:2].'), () => handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(run.status, 200);
  assert.equal(h.runs.length, 0, 'Workers AI is not asked once the pre-check finds the day spent');
  assert.equal(run.calls.length, 1);
  assert.equal(run.calls[0]!.url, GROQ_CHAT_URL);
  assert.equal(run.calls[0]!.authorization, 'Bearer groq-key');
  assert.equal(run.calls[0]!.body.model, 'openai/gpt-oss-120b');
  assert.ok(run.calls[0]!.body.messages.reduce((n, m) => n + m.content.length, 0) <= GROQ_PROMPT_CHARS);
  const all = events(run.text);
  assert.equal(all.filter((e) => e.event === 'delta').map((e) => (e.data as { text: string }).text).join(''), '- CONFIRMED: The meeting was on Tuesday [doc:doc-live-a p:2].');
  const citations = (all.find((e) => e.event === 'citations')!.data as { citations: { id: string; page: number }[] }).citations;
  assert.deepEqual(citations.map((c) => [c.id, c.page]), [['doc-live-a', 2]]);
  assert.equal(questionsToday(h), 1, 'a Groq answer counts like any answer');
});

test("when the model call's hold refuses, Groq answers in its place", async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], extraVars: OPEN });
  // Room for the output ceiling alone, not the prompt beside it: the pre-check passes, the hold does not.
  spendDay(h, neuronsFor(ASK_MODEL, 0, MAX_TOKENS));
  const run = await withGroq(groqOk('- READ: x [doc:D1 p:1].'), () => handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(run.status, 200);
  assert.equal(h.runs.length, 0, 'the hold refused before the binding ran');
  assert.equal(run.calls.length, 1);
  assert.ok(events(run.text).some((e) => e.event === 'done'));
});

test("Groq's 429 is 429 ai_budget after exactly one request, and the question is given back", async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], extraVars: OPEN });
  spendDay(h, 500);
  const run = await withGroq(() => new Response('{}', { status: 429, headers: { 'retry-after': '30' } }), () => handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(run.status, 429);
  assert.deepEqual(JSON.parse(run.text), { error: 'ai_budget' });
  assert.equal(run.calls.length, 1);
  assert.equal(questionsToday(h), 0);
  assert.ok(run.logs.some((l) => l[0] === 'ask_groq_refused'));
});

test('without zero data retention confirmed, nothing reaches Groq: 429 ai_budget before the cap, as before', async () => {
  for (const ASK_GROQ of [undefined, { ...OPEN.ASK_GROQ, zdr_confirmed: false }, { ...OPEN.ASK_GROQ, eval_runs: [] }, { ...OPEN.ASK_GROQ, enabled: false }]) {
    const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], extraVars: { ...OPEN, ASK_GROQ } });
    spendDay(h, 500);
    const run = await withGroq(groqOk('x'), () => handle(askRequest({ question: QUESTION }), h.env, ctx));
    assert.equal(run.status, 429, JSON.stringify(ASK_GROQ));
    assert.deepEqual(JSON.parse(run.text), { error: 'ai_budget' });
    assert.equal(run.calls.length, 0, `no Groq call with ${JSON.stringify(ASK_GROQ)}`);
    assert.equal(h.searches.length, 0);
    assert.equal(questionsToday(h), 0);
  }
});

test('without the key, nothing reaches Groq', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], extraVars: { ASK_GROQ: OPEN.ASK_GROQ } });
  spendDay(h, 500);
  const run = await withGroq(groqOk('x'), () => handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(run.status, 429);
  assert.equal(run.calls.length, 0);
  assert.ok(run.logs.some((l) => l[0] === 'ask_groq_closed' && l[1] === 'no_key'));
});

test('local development reaches Groq only with the remote-AI opt-in, like the billed bindings', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], extraVars: { ...OPEN, LEGALLAS_DEV_REMOTE_AI: undefined, ASK_MOCK: '1' } });
  spendDay(h, 500);
  const run = await withGroq(groqOk('x'), () => handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(run.calls.length, 0);
  assert.ok(run.logs.some((l) => l[0] === 'ask_groq_closed' && l[1] === 'local'));
});

test('while Workers AI has neurons, Groq is never called, even with the gate open', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], answer: '- READ: x [doc:D1 p:1].', extraVars: OPEN });
  const run = await withGroq(groqOk('x'), () => handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(run.status, 200);
  assert.equal(h.runs.length, 1);
  assert.equal(run.calls.length, 0);
});

test('a Workers AI outage stays model_unavailable: Groq answers only for spent neurons', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], extraVars: OPEN, refuse: () => new Error('503 Service Unavailable') });
  const run = await withGroq(groqOk('x'), () => handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(run.status, 503);
  assert.deepEqual(JSON.parse(run.text), { error: 'model_unavailable' });
  assert.equal(run.calls.length, 0);
});
