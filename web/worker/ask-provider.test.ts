// SPDX-License-Identifier: Apache-2.0
// Ask's backend switch (ask-provider.ts) with a fake Workers AI binding and a fake fetch: never a live call. Groq answers
// only after Workers AI's neurons refuse and only through the ZDR gate; a 429 is the out-of-budget answer, sent once;
// the answer is shaped and its citations validated against the fitted turn. The room's own host, through the same
// gate, answers in place of both, and its failure is model_unavailable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerWith, groqConfig, groqGate, type AnswerDeps, type GroqGate } from './ask-provider.ts';
import { ModelUnavailable } from './ask-model.ts';
import { modelSse } from './room-fixtures.ts';
import { retryDegenerate } from './ask-stream.ts';
import type { TurnInput } from './ask-turn.ts';
import type { CitableDoc } from './passages.ts';
import { groqSse } from './ask-groq-fixtures.ts';
import { GROQ_CHAT_URL, GROQ_PROMPT_CHARS, type Fetcher } from './ask-groq.ts';
import { BudgetExhausted, LocalSpendOff } from './spend.ts';
import { readWranglerConfig } from './wrangler-config.ts';
import { hostGate } from './ask-host.ts';
import { HOST_CHAT_URL, HOST_KEY, HOST_ON, hostSse } from './ask-host-fixtures.ts';

const PRIMARY = '@cf/zai-org/glm-5.3-flash';
const OPEN: GroqGate = { open: true, apiKey: 'groq-key' };
const CONFIG_ON = { enabled: true, zdr_confirmed: true, eval_runs: ['10000000001'] };

const doc = (id: string): CitableDoc => ({ id, name: `${id}.pdf`, pages: 9, control_seq: null, folder: null });

/** A turn input as large as a real one: 20 passages of about 1,250 characters and a long case picture. */
function bigInput(): TurnInput {
  const chunks = Array.from({ length: 20 }, (_, i) => ({ docId: `doc-${i}`, name: `doc-${i}.pdf`, text: `[[doc:doc-${i} p:${i + 1}]]\nThe cooks met and voted. ${'Minutes. '.repeat(135)}\n` }));
  const points = Array.from({ length: 150 }, (_, i) => `   - (A) Point ${i} that the record shows. Proof: strong [doc:proof-${i % 7} p:1] note.`);
  return {
    question: 'When did the cooks vote?',
    chunks,
    citable: new Map(chunks.map((chunk) => [chunk.docId, doc(chunk.docId)])),
    brief: { text: ['Matter now: Example v. Example.', 'Filings counsel is preparing:', '   Points to prove:', ...points].join('\n'), citable: new Map(Array.from({ length: 7 }, (_, i) => [`proof-${i}`, doc(`proof-${i}`)])), filed: false },
  };
}

interface AiCall {
  model: string;
  input: { messages: { content: string }[] };
}

/** A Workers AI binding that answers, or throws what `fail` returns for each call. */
function fakeAi(fail?: (call: number) => unknown): { ai: AnswerDeps['ai']; calls: AiCall[] } {
  const calls: AiCall[] = [];
  return {
    calls,
    ai: {
      run: (async (model: string, input: AiCall['input']) => {
        calls.push({ model, input });
        const error = fail?.(calls.length);
        if (error) throw error;
        return modelSse('- READ: Workers AI answered [doc:D1 p:1].');
      }) as unknown as AnswerDeps['ai']['run'],
    },
  };
}

interface FetchCall {
  url: string;
  body: { model: string; messages: { content: string }[]; max_completion_tokens: number };
}

function fakeGroq(respond: (call: number) => Response): { fetcher: Fetcher; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  return {
    calls,
    fetcher: async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return respond(calls.length);
    },
  };
}

const groqOk = (answer = '- READ: The cooks voted on Tuesday [doc:D1 p:1].') => () => new Response(groqSse(answer), { status: 200 });
const neurons = () => new BudgetExhausted('neurons');
const noWait = async () => undefined;

function deps(overrides: Partial<AnswerDeps> = {}): AnswerDeps {
  return { ai: fakeAi().ai, model: PRIMARY, input: bigInput(), gate: OPEN, fetcher: fakeGroq(groqOk()).fetcher, wait: noWait, ...overrides };
}

/** Runs `body` with console.error captured; returns what was logged. */
async function logged<T>(body: () => Promise<T>): Promise<{ result: T | undefined; error: unknown; lines: unknown[][] }> {
  const original = console.error;
  const lines: unknown[][] = [];
  console.error = (...args: unknown[]) => lines.push(args);
  try {
    return { result: await body(), error: null, lines };
  } catch (error) {
    return { result: undefined, error, lines };
  } finally {
    console.error = original;
  }
}

async function answerText(start: () => Promise<ReadableStream<Uint8Array>>): Promise<string> {
  let text = '';
  for await (const piece of retryDegenerate(start)) text += piece;
  return text;
}

// --- The room config and the gate ---------------------------------------------------------------------------

test('ASK_GROQ is read strictly: only true is true, only run ids are eval runs, and anything malformed is all off', () => {
  assert.deepEqual(groqConfig(CONFIG_ON), CONFIG_ON);
  assert.deepEqual(groqConfig(JSON.stringify(CONFIG_ON)), CONFIG_ON, 'a JSON string, as a dashboard var would be');
  assert.deepEqual(groqConfig({ enabled: 'true', zdr_confirmed: 1, eval_runs: ['10000000001', 'abc', '12', 10000000002] }), {
    enabled: false,
    zdr_confirmed: false,
    eval_runs: ['10000000001', '10000000002'],
  });
  for (const bad of [undefined, null, '', 'yes', '{', [], 42, { eval_runs: 'x' }]) {
    assert.deepEqual(groqConfig(bad), { enabled: false, zdr_confirmed: false, eval_runs: [] }, String(bad));
  }
});

test('the ZDR gate: Groq opens only when enabled, zero data retention confirmed, an eval run named and a key set', () => {
  const key = { LEGALLAS_ASK_GROQ_API_KEY: 'groq-key' };
  assert.deepEqual(groqGate({ ...key }), { open: false, reason: 'off' });
  assert.deepEqual(groqGate({ ...key, ASK_GROQ: { ...CONFIG_ON, enabled: false } }), { open: false, reason: 'off' });
  assert.deepEqual(groqGate({ ...key, ASK_GROQ: { ...CONFIG_ON, zdr_confirmed: false } }), { open: false, reason: 'zdr_unconfirmed' });
  assert.deepEqual(groqGate({ ...key, ASK_GROQ: { enabled: true, eval_runs: ['10000000001'] } }), { open: false, reason: 'zdr_unconfirmed' });
  assert.deepEqual(groqGate({ ...key, ASK_GROQ: { ...CONFIG_ON, eval_runs: [] } }), { open: false, reason: 'no_eval' });
  assert.deepEqual(groqGate({ ASK_GROQ: CONFIG_ON }), { open: false, reason: 'no_key' });
  assert.deepEqual(groqGate({ ASK_GROQ: CONFIG_ON, LEGALLAS_ASK_GROQ_API_KEY: '  ' }), { open: false, reason: 'no_key' });
  assert.deepEqual(groqGate({ ...key, ASK_GROQ: CONFIG_ON }, { local: true }), { open: false, reason: 'local' });
  assert.deepEqual(groqGate({ LEGALLAS_ASK_GROQ_API_KEY: ' groq-key ', ASK_GROQ: CONFIG_ON }), { open: true, apiKey: 'groq-key' });
});

test('the config ships Groq off: closed until a room confirms ZDR, enables it and names eval runs', () => {
  const { raw, config, example } = readWranglerConfig('wrangler');
  // Off and with no eval runs in every config. A room's own file may record that it confirmed Zero Data Retention with
  // Groq (the replica eval reads that), which opens nothing while `enabled` is false; the example never does.
  const { zdr_confirmed: zdrConfirmed, ...groq } = config.vars.ASK_GROQ as { enabled: boolean; zdr_confirmed: boolean; eval_runs: unknown[] };
  assert.deepEqual(groq, { enabled: false, eval_runs: [] });
  if (example) assert.equal(zdrConfirmed, false);
  assert.equal(raw.includes('LEGALLAS_ASK_GROQ_API_KEY"'), false, 'the key is a secret, never a var');
  assert.deepEqual(groqGate({ ASK_GROQ: config.vars.ASK_GROQ, LEGALLAS_ASK_GROQ_API_KEY: 'k' }), { open: false, reason: 'off' });
});

// --- The fallback --------------------------------------------------------------------------------------------

test('Workers AI answers while it has neurons: Groq is never called and the turn is not trimmed', async () => {
  const groq = fakeGroq(groqOk());
  const workers = fakeAi();
  const input = bigInput();
  const answer = await answerWith(deps({ ai: workers.ai, fetcher: groq.fetcher, input }));
  assert.equal(answer.provider, 'workers-ai');
  assert.equal(groq.calls.length, 0);
  assert.equal(workers.calls.length, 1);
  assert.equal(answer.dropped, undefined);
  assert.equal(answer.turn.book.citable.size, 27, 'all 20 passages and the 7 proof documents');
  assert.equal(await answerText(answer.start), '- READ: Workers AI answered [doc:D1 p:1].');
});

test('when the neurons refuse at the hold, Groq answers with the fitted turn, once', async () => {
  const groq = fakeGroq(groqOk());
  const workers = fakeAi(neurons);
  const { result: answer, lines } = await logged(() => answerWith(deps({ ai: workers.ai, fetcher: groq.fetcher })));
  assert.equal(answer?.provider, 'groq');
  assert.equal(workers.calls.length, 1, 'a spend refusal is not retried or handed to the fallback model');
  assert.equal(groq.calls.length, 1);
  assert.equal(groq.calls[0]!.url, GROQ_CHAT_URL);
  assert.equal(groq.calls[0]!.body.model, 'openai/gpt-oss-120b');
  const sent = groq.calls[0]!.body.messages.reduce((n, m) => n + m.content.length, 0);
  assert.ok(sent <= GROQ_PROMPT_CHARS, `the prompt Groq got (${sent}) fits its budget`);
  assert.ok(answer!.dropped!.passages > 0);
  // The log line is counts only.
  const line = lines.find((l) => l[0] === 'ask_groq_answer')!;
  assert.ok(line.slice(1).every((value) => typeof value === 'number'));
});

test("when the route's pre-check found the neurons short, Workers AI is not asked at all", async () => {
  const groq = fakeGroq(groqOk());
  const workers = fakeAi();
  const { result: answer } = await logged(() => answerWith(deps({ ai: workers.ai, fetcher: groq.fetcher, neuronsShort: true })));
  assert.equal(answer?.provider, 'groq');
  assert.equal(workers.calls.length, 0);
  assert.equal(groq.calls.length, 1);
});

test('a closed gate sends nothing to Groq: the neurons refusal stands as the out-of-budget answer', async () => {
  for (const env of [{}, { ASK_GROQ: { ...CONFIG_ON, zdr_confirmed: false } }, { ASK_GROQ: { ...CONFIG_ON, eval_runs: [] } }, { ASK_GROQ: CONFIG_ON }]) {
    const groq = fakeGroq(groqOk());
    const gate = groqGate({ ...env });
    const { error, lines } = await logged(() => answerWith(deps({ ai: fakeAi(neurons).ai, fetcher: groq.fetcher, gate })));
    assert.ok(error instanceof BudgetExhausted && error.meter === 'neurons', JSON.stringify(env));
    assert.equal(groq.calls.length, 0, `nothing sent with ${JSON.stringify(env)}`);
    assert.ok(lines.some((l) => l[0] === 'ask_groq_closed'));
  }
});

test("Groq's 429 is the out-of-budget answer, after exactly one request: no retry loop", async () => {
  const groq = fakeGroq(() => new Response('{"error":{}}', { status: 429, headers: { 'retry-after': '20' } }));
  const { error, lines } = await logged(() => answerWith(deps({ ai: fakeAi(neurons).ai, fetcher: groq.fetcher })));
  assert.ok(error instanceof BudgetExhausted && error.meter === 'neurons');
  assert.equal(groq.calls.length, 1);
  assert.ok(lines.some((l) => l[0] === 'ask_groq_refused'));
});

test('Groq failing otherwise is model_unavailable, logged by status only', async () => {
  const groq = fakeGroq(() => new Response('the prompt said: secret case text', { status: 503 }));
  const { error, lines } = await logged(() => answerWith(deps({ ai: fakeAi(neurons).ai, fetcher: groq.fetcher })));
  assert.ok(error instanceof ModelUnavailable);
  assert.equal(groq.calls.length, 1);
  assert.deepEqual(lines.find((l) => l[0] === 'ask_groq_unavailable'), ['ask_groq_unavailable', 'groq_http_503']);
  assert.equal(JSON.stringify(lines).includes('secret'), false);
});

test('only a neurons refusal reaches Groq: an outage, local development and a search meter stay as they were', async () => {
  const cases: [string, () => unknown, (error: unknown) => boolean][] = [
    ['outage', () => new Error('503 Service Unavailable'), (error) => error instanceof ModelUnavailable],
    // runModel reports a local refusal as unavailable, as it did before Groq: either way it never reaches Groq.
    ['local', () => new LocalSpendOff(), (error) => error instanceof ModelUnavailable],
    ['search meter', () => new BudgetExhausted('search_semantic'), (error) => error instanceof BudgetExhausted && error.meter === 'search_semantic'],
  ];
  for (const [name, fail, expected] of cases) {
    const groq = fakeGroq(groqOk());
    const { error } = await logged(() => answerWith(deps({ ai: fakeAi(fail).ai, fetcher: groq.fetcher })));
    assert.ok(expected(error), name);
    assert.equal(groq.calls.length, 0, name);
  }
});

test('a blank Groq answer is asked once more through start(), as retryDegenerate does for Workers AI', async () => {
  const groq = fakeGroq((call) => new Response(groqSse(call === 1 ? '   ' : '- READ: Second try [doc:D1 p:1].'), { status: 200 }));
  const { result: answer } = await logged(() => answerWith(deps({ ai: fakeAi(neurons).ai, fetcher: groq.fetcher })));
  const { result: text } = await logged(() => answerText(answer!.start));
  assert.equal(text, '- READ: Second try [doc:D1 p:1].');
  assert.equal(groq.calls.length, 2);
});

test("Groq's answer is shaped and validated against the fitted turn: a kept passage validates, a dropped one does not", async () => {
  // D1 is the best-ranked passage (the case picture's tags come first only while they are kept); doc-19 was dropped.
  const groq = fakeGroq(groqOk('- CONFIRMED: The cooks voted [doc:D1 p:1].\n- READ: Later minutes [doc:doc-19 p:20].'));
  const { result: answer } = await logged(() => answerWith(deps({ ai: fakeAi(neurons).ai, fetcher: groq.fetcher })));
  const turn = answer!.turn;
  assert.equal(turn.book.citable.has('doc-19'), false);
  let text = '';
  for await (const piece of turn.shape(retryDegenerate(answer!.start))) text += piece;
  const { citations } = turn.finish(text);
  const d1 = turn.book.ids.get('D1')!;
  assert.ok(turn.book.citable.has(d1));
  assert.deepEqual(citations.map((c) => c.id), [d1]);
});

// --- The room's own host ---------------------------------------------------------------------------------------

const HOST_GATE = hostGate({ ASK_HOST: HOST_ON, LEGALLAS_ASK_HOST_API_KEY: HOST_KEY });

test("with the room's host open, it answers in place of Workers AI and Groq, with the whole turn, once", async () => {
  const workers = fakeAi();
  const host = fakeGroq(() => new Response(hostSse('- READ: The host answered [doc:D1 p:1].'), { status: 200 }));
  const answer = await answerWith(deps({ ai: workers.ai, fetcher: host.fetcher, host: HOST_GATE, neuronsShort: true }));
  assert.equal(answer.provider, 'host');
  assert.equal(workers.calls.length, 0);
  assert.equal(host.calls.length, 1);
  assert.equal(host.calls[0]!.url, HOST_CHAT_URL, 'never Groq, even with the neurons short and its gate open');
  assert.equal(host.calls[0]!.body.model, HOST_ON.model);
  assert.equal(answer.dropped, undefined, 'the turn is not trimmed');
  assert.equal(answer.turn.book.citable.size, 27);
  assert.equal(await answerText(answer.start), '- READ: The host answered [doc:D1 p:1].');
});

test("the room's host failing, a 429 included, is model_unavailable: never Groq, never Workers AI", async () => {
  for (const status of [429, 500]) {
    const workers = fakeAi();
    const host = fakeGroq(() => new Response('the prompt said: secret case text', { status }));
    const { error, lines } = await logged(() => answerWith(deps({ ai: workers.ai, fetcher: host.fetcher, host: HOST_GATE })));
    assert.ok(error instanceof ModelUnavailable, String(status));
    assert.equal(host.calls.length, 1);
    assert.equal(workers.calls.length, 0);
    assert.deepEqual(lines.find((l) => l[0] === 'ask_host_unavailable'), ['ask_host_unavailable', `host_http_${status}`]);
    assert.equal(JSON.stringify(lines).includes('secret'), false);
  }
});

test("a closed host gate changes nothing: Workers AI answers, and Groq still takes over for spent neurons", async () => {
  const closed = hostGate({ ASK_HOST: HOST_ON });
  assert.equal(closed.open, false);
  const workers = fakeAi();
  const net = fakeGroq(groqOk());
  assert.equal((await answerWith(deps({ ai: workers.ai, fetcher: net.fetcher, host: closed }))).provider, 'workers-ai');
  assert.equal(net.calls.length, 0);
  const { result } = await logged(() => answerWith(deps({ ai: fakeAi(neurons).ai, fetcher: net.fetcher, host: closed })));
  assert.equal(result?.provider, 'groq');
  assert.equal(net.calls[0]!.url, GROQ_CHAT_URL);
});
