// SPDX-License-Identifier: Apache-2.0
// POST /api/ask with the room's own model host (routes/ask.ts, ask-provider.ts, ask-host.ts): an open gate sends the
// turn to the host instead of Workers AI; a failed host is 503 model_unavailable with the question given back; a
// missing key, a host that has not passed its release gate, or anything else closed sends nothing anywhere new and
// Ask answers on Workers AI exactly as without the setting. The host is a stand-in fetch: never a live call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseParser } from '../src/scripts/chat-sse.ts';
import { askRequest, harness, type Harness } from './ask-fixtures.ts';
import { HOST_CHAT_URL, HOST_KEY, HOST_ON, hostSse } from './ask-host-fixtures.ts';
import { neuronLimit, paidBefore, periodOf } from './budget.ts';
import { handle } from './index.ts';
import { chunk } from './room-fixtures.ts';

const ctx = {} as ExecutionContext;
const QUESTION = 'What does the alpha memo say about the zebra meeting?';
const OPEN = { ASK_HOST: HOST_ON, LEGALLAS_ASK_HOST_API_KEY: HOST_KEY };
const CHUNKS = [chunk('doc-live-a', 2, 'The zebra meeting happened on Tuesday.'), chunk('doc-live-b', 1, 'Notes.')];

const today = () => periodOf('neurons', new Date());
const questionsToday = (h: Harness) => (h.db.prepare('SELECT coalesce(sum(questions), 0) AS n FROM usage').get() as { n: number }).n;
/** Spends today's neurons down to `left` (as ask-groq-route.test.ts does). */
const spendDay = (h: Harness, left: number) =>
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', ?, ?)").run(today(), neuronLimit(today(), 'worker', paidBefore(today(), {}, {})) - left);

interface HostCall {
  url: string;
  authorization: string | null;
  body: { model: string; messages: { role: string; content: string }[]; max_tokens: number; stream: boolean };
}

/** Runs `body` with fetch standing in for the host, console.error captured; the response is read inside. */
async function withHost(respond: (call: number) => Response | Promise<Response>, body: () => Promise<Response>) {
  const original = globalThis.fetch;
  const originalError = console.error;
  const calls: HostCall[] = [];
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

/** The prompt's fence marker is random per question (prompt.ts); everything else must match byte for byte. */
const sameFence = (value: unknown) => JSON.parse(JSON.stringify(value).replace(/CASE-DATA-[0-9a-f]{24}/g, 'CASE-DATA-<random>'));
const answerOf = (text: string) => events(text).filter((e) => e.event === 'delta').map((e) => (e.data as { text: string }).text).join('');
const hostOk = (answer: string) => () => new Response(hostSse(answer), { status: 200 });

test('with the gate open, the host answers instead of Workers AI: one call, the whole turn, citations validated', async () => {
  const h = harness({ chunks: CHUNKS, answer: '- READ: Workers AI answered [doc:D1 p:2].', extraVars: OPEN });
  const run = await withHost(hostOk('- CONFIRMED: The meeting was on Tuesday [doc:D1 p:2].'), () => handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(run.status, 200);
  assert.equal(h.runs.length, 0, 'Workers AI is not asked');
  assert.equal(run.calls.length, 1);
  assert.equal(run.calls[0]!.url, HOST_CHAT_URL);
  assert.equal(run.calls[0]!.authorization, `Bearer ${HOST_KEY}`);
  assert.equal(run.calls[0]!.body.model, HOST_ON.model);
  assert.equal(run.calls[0]!.body.stream, true);
  assert.equal(answerOf(run.text), '- CONFIRMED: The meeting was on Tuesday [doc:doc-live-a p:2].');
  const citations = (events(run.text).find((e) => e.event === 'citations')!.data as { citations: { id: string; page: number }[] }).citations;
  assert.deepEqual(citations.map((c) => [c.id, c.page]), [['doc-live-a', 2]]);
  assert.equal(questionsToday(h), 1, 'a host answer counts against the daily cap like any answer');
});

test('the host gets the very prompt Workers AI would have got', async () => {
  const workers = harness({ chunks: CHUNKS, answer: '- READ: x [doc:D1 p:2].' });
  const before = await withHost(hostOk('x'), () => handle(askRequest({ question: QUESTION }), workers.env, ctx));
  assert.equal(before.calls.length, 0);
  const hosted = harness({ chunks: CHUNKS, extraVars: OPEN });
  const after = await withHost(hostOk('- READ: x [doc:D1 p:2].'), () => handle(askRequest({ question: QUESTION }), hosted.env, ctx));
  assert.deepEqual(sameFence(after.calls[0]!.body.messages), sameFence(workers.runs[0]!.input.messages));
});

test("the host answers even when the day's Workers AI neurons are spent: they are not its budget", async () => {
  const h = harness({ chunks: CHUNKS, extraVars: OPEN });
  spendDay(h, 0);
  const run = await withHost(hostOk('- READ: x [doc:D1 p:2].'), () => handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(run.status, 200);
  assert.equal(run.calls.length, 1);
});

test('a failed host is 503 model_unavailable after one call, the question given back, logged by status only', async () => {
  for (const respond of [
    () => new Response(`{"error":"the prompt said: secret case text"}`, { status: 502 }),
    () => new Response('{}', { status: 429, headers: { 'retry-after': '9' } }),
    () => new Response('{}', { status: 402 }),
    () => Promise.reject(new Error('getaddrinfo ENOTFOUND models.example.com')),
  ]) {
    const h = harness({ chunks: CHUNKS, answer: '- READ: Workers AI answered [doc:D1 p:2].', extraVars: OPEN });
    const run = await withHost(respond, () => handle(askRequest({ question: QUESTION }), h.env, ctx));
    assert.equal(run.status, 503);
    assert.deepEqual(JSON.parse(run.text), { error: 'model_unavailable' });
    assert.equal(run.calls.length, 1, 'never retried');
    assert.equal(h.runs.length, 0, 'never a quiet switch to Workers AI');
    assert.equal(questionsToday(h), 0, 'the question is given back');
    const line = run.logs.find((l) => l[0] === 'ask_host_unavailable');
    assert.ok(line && /^host_(?:http_\d{3}|fetch_failed)$/.test(String(line[1])), JSON.stringify(line));
    const logged = JSON.stringify(run.logs);
    for (const secret of ['secret', 'models.example.com', HOST_KEY]) assert.equal(logged.includes(secret), false, secret);
  }
});

test('a missing key, an unevaluated host or anything else closed sends nothing to the host, and Workers AI answers as before', async () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['no key', { ASK_HOST: HOST_ON }, 'no_key'],
    ['not passed its release gate', { ...OPEN, ASK_HOST: { ...HOST_ON, eval_runs: [] } }, 'no_eval'],
    ['zero data retention unconfirmed', { ...OPEN, ASK_HOST: { ...HOST_ON, zdr_confirmed: false } }, 'zdr_unconfirmed'],
    ['an http URL', { ...OPEN, ASK_HOST: { ...HOST_ON, url: 'http://models.example.com/v1' } }, 'bad_host'],
    ['local development without the opt-in', { ...OPEN, LEGALLAS_DEV_REMOTE_AI: undefined, ASK_MOCK: '1' }, 'local'],
  ];
  for (const [name, extraVars, reason] of cases) {
    const h = harness({ chunks: CHUNKS, answer: '- READ: Workers AI answered [doc:D1 p:2].', extraVars });
    const run = await withHost(hostOk('x'), () => handle(askRequest({ question: QUESTION }), h.env, ctx));
    assert.equal(run.calls.length, 0, `nothing sent: ${name}`);
    assert.ok(run.logs.some((l) => l[0] === 'ask_host_closed' && l[1] === reason), `${name}: ${JSON.stringify(run.logs)}`);
    if (reason !== 'local') {
      assert.equal(run.status, 200, name);
      assert.equal(h.runs.length, 1, `${name}: Workers AI answers`);
      assert.equal(answerOf(run.text), '- READ: Workers AI answered [doc:doc-live-a p:2].', name);
    }
  }
});

test('turned off or unset, the setting changes nothing: the same Workers AI call, the same response, no log line', async () => {
  const runOnce = async (extraVars?: Record<string, unknown>) => {
    const h = harness({ chunks: CHUNKS, answer: '- READ: Workers AI answered [doc:D1 p:2].', extraVars });
    const run = await withHost(hostOk('x'), () => handle(askRequest({ question: QUESTION }), h.env, ctx));
    return { h, run };
  };
  const unset = await runOnce();
  for (const extraVars of [{ ASK_HOST: { ...HOST_ON, enabled: false }, LEGALLAS_ASK_HOST_API_KEY: HOST_KEY }, { ASK_HOST: { enabled: false, zdr_confirmed: false, eval_runs: [], url: '', model: '' } }]) {
    const off = await runOnce(extraVars);
    assert.equal(off.run.calls.length, 0);
    assert.deepEqual(sameFence(off.h.runs), sameFence(unset.h.runs), 'the same model, input and options');
    assert.equal(off.run.text, unset.run.text, 'the same response, byte for byte');
    assert.deepEqual(off.run.logs, unset.run.logs, 'no new log line');
  }
  assert.equal(unset.h.runs[0]!.model, '@cf/openai/gpt-oss-120b');
});
