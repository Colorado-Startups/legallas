// SPDX-License-Identifier: Apache-2.0
// Ask out of the box: a room copied from wrangler.example.jsonc, with only the fields a room must fill in, answers on
// gpt-oss-120b in its own Workers AI and needs no outside account. Nothing here reads the room's own wrangler.jsonc,
// so the test holds in any checkout. Every binding is a fake that records its calls; fetch is a trap, so any call
// outside the account (Groq, a model host) fails the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseParser } from '../src/scripts/chat-sse.ts';
import { MAX_TOKENS, REASONING_EFFORT } from './ask.ts';
import { askRequest, harness } from './ask-fixtures.ts';
import { groqGate } from './ask-provider.ts';
import { hostGate } from './ask-host.ts';
import { handle } from './index.ts';
import { chunk } from './room-fixtures.ts';
import { readWranglerConfig } from './wrangler-config.ts';

const ctx = {} as ExecutionContext;
const { config } = readWranglerConfig('wrangler', true);
/** The example's vars, as a fresh install deploys them: no secrets set (no CONTROL_PREFIX, no Groq or host key). */
const FRESH = config.vars as Record<string, unknown>;

/** Runs `body` with fetch as a trap: every outside call is recorded and refused. */
async function noOutsideCalls(body: () => Promise<Response>) {
  const original = globalThis.fetch;
  const originalError = console.error;
  const outside: string[] = [];
  const logs: unknown[][] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    outside.push(String(url instanceof Request ? url.url : url));
    throw new Error('no outside call in a fresh install');
  }) as typeof fetch;
  console.error = (...args: unknown[]) => logs.push(args);
  try {
    const res = await body();
    return { status: res.status, text: await res.text(), outside, logs };
  } finally {
    globalThis.fetch = original;
    console.error = originalError;
  }
}

const events = (text: string) => {
  const parser = sseParser();
  return [...parser.push(text), ...parser.end()];
};

test("a fresh install's settings: gpt-oss-120b on Workers AI, every outside backend closed, no secret needed", () => {
  assert.equal(FRESH.LEGALLAS_MODEL, '@cf/openai/gpt-oss-120b');
  assert.ok(Object.hasOwn(REASONING_EFFORT, FRESH.LEGALLAS_MODEL as string));
  assert.deepEqual(groqGate({ ASK_GROQ: FRESH.ASK_GROQ }), { open: false, reason: 'off' });
  assert.deepEqual(hostGate({ ASK_HOST: FRESH.ASK_HOST }), { open: false, reason: 'off' });
});

test('Ask answers from a fresh install on gpt-oss-120b in the account, with no outside call and no new log line', async () => {
  const h = harness({
    chunks: [chunk('doc-live-a', 2, 'The zebra meeting happened on Tuesday.')],
    answer: '- CONFIRMED: The meeting was on Tuesday [doc:D1 p:2].',
    // The example's vars over the harness's. LAW_LIBRARY "1" with no law bindings (none created yet) leaves law out.
    extraVars: FRESH,
  });
  const run = await noOutsideCalls(() => handle(askRequest({ question: 'What does the alpha memo say about the zebra meeting?' }), h.env, ctx));
  assert.equal(run.status, 200);
  assert.deepEqual(run.outside, [], 'nothing leaves the account');
  assert.equal(h.runs.length, 1);
  const [call] = h.runs;
  assert.equal(call!.model, '@cf/openai/gpt-oss-120b');
  assert.equal(call!.options, undefined, 'no gateway, no options: the plain run(model, input) call');
  assert.equal(call!.input.max_tokens, MAX_TOKENS);
  assert.equal(call!.input.reasoning_effort, REASONING_EFFORT['@cf/openai/gpt-oss-120b']);
  const answer = events(run.text).filter((e) => e.event === 'delta').map((e) => (e.data as { text: string }).text).join('');
  assert.equal(answer, '- CONFIRMED: The meeting was on Tuesday [doc:doc-live-a p:2].');
  const citations = (events(run.text).find((e) => e.event === 'citations')!.data as { citations: { id: string }[] }).citations;
  assert.deepEqual(citations.map((c) => c.id), ['doc-live-a']);
  // Off is silent: no ask_groq_closed or ask_host_closed line while Workers AI has neurons.
  assert.deepEqual(run.logs.filter((l) => /^ask_(?:groq|host)_/.test(String(l[0]))), []);
});

test('with nothing retrieved, a fresh install says it does not know without calling any model', async () => {
  const h = harness({ chunks: [], extraVars: FRESH });
  const run = await noOutsideCalls(() => handle(askRequest({ question: 'Who signed the lease?' }), h.env, ctx));
  assert.equal(run.status, 200);
  assert.equal(h.runs.length, 0);
  assert.deepEqual(run.outside, []);
  assert.ok(events(run.text).some((e) => e.event === 'done' && (e.data as { dontKnow: boolean }).dontKnow));
});
