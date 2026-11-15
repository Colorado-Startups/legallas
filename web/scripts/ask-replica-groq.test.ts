// SPDX-License-Identifier: Apache-2.0
// The replica's Groq lane (ask-replica-groq.ts) with a fake clock and a fake fetch: never a live call. Pacing under
// Groq's minute and day, a 429 that stops the run, shards that split each category, and the zero-data-retention check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EvalItem } from './ask-eval-score.ts';
import { GROQ_NO_KEY, GROQ_NO_ZDR, GROQ_STOP_429, GROQ_STOP_DAY, GroqPacer, GroqStop, groqGenerate, groqRunKey, groqZdrConfirmed, parseShard, pickShard, WINDOW_MS } from './ask-replica-groq.ts';
import { callShape, groqEffort, parseReplicaArgs, replicaNeed, runLabel, streamUsage, TYPICAL_ANSWER_NEURONS } from './ask-replica.ts';
import { groqSse } from '../worker/ask-groq-fixtures.ts';
import { GROQ_LIMITS, GROQ_MAX_COMPLETION_TOKENS, GROQ_MODEL, GROQ_PROMPT_TOKENS, groqInput, groqRequestTokens, type Fetcher } from '../worker/ask-groq.ts';

/** A clock that only moves when the pacer sleeps. */
function clock(start = 0) {
  let now = start;
  const sleeps: number[] = [];
  return { now: () => now, sleep: async (ms: number) => void (sleeps.push(ms), (now += ms)), sleeps, at: () => now };
}

const FULL_CALL = GROQ_PROMPT_TOKENS + GROQ_MAX_COMPLETION_TOKENS;

test('a full-size call holds most of the minute, so the next one waits for the first to leave the window', async () => {
  const c = clock();
  const pacer = new GroqPacer(c);
  await pacer.take(FULL_CALL);
  assert.equal(c.at(), 0);
  await pacer.take(FULL_CALL);
  assert.ok(c.at() >= WINDOW_MS, `waited ${c.at()} ms`);
  assert.deepEqual(pacer.sent(), { requests: 2, tokens: 2 * FULL_CALL });
});

test('small calls go at once until the 30 requests of a minute are used', async () => {
  const c = clock();
  const pacer = new GroqPacer(c);
  for (let i = 0; i < GROQ_LIMITS.requestsPerMinute; i++) await pacer.take(10);
  assert.equal(c.at(), 0);
  await pacer.take(10);
  assert.ok(c.at() >= WINDOW_MS);
});

test("a shard of the gate set fits the replica step's 10 minutes at one full call a minute", async () => {
  const c = clock();
  const pacer = new GroqPacer(c);
  for (let i = 0; i < 8; i++) await pacer.take(FULL_CALL);
  assert.ok(c.at() < 8 * 60_000, `8 calls started within ${(c.at() / 60_000).toFixed(1)} minutes`);
});

test('concurrent takes queue: never more than the minute holds, whatever the pool size', async () => {
  const c = clock();
  const pacer = new GroqPacer(c);
  const starts: number[] = [];
  await Promise.all(Array.from({ length: 4 }, async () => {
    await pacer.take(FULL_CALL);
    starts.push(c.at());
  }));
  starts.sort((a, b) => a - b);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i]! - starts[i - 1]! >= WINDOW_MS, `call ${i} waited a window`);
});

test("the run stops before it would pass Groq's day, and a stop holds for every later call", async () => {
  const pacer = new GroqPacer({ ...clock(), limits: { ...GROQ_LIMITS, tokensPerDay: 3 * FULL_CALL } });
  for (let i = 0; i < 3; i++) await pacer.take(FULL_CALL);
  await assert.rejects(pacer.take(FULL_CALL), (error: unknown) => error instanceof GroqStop && error.message === GROQ_STOP_DAY);
  assert.equal(pacer.stopped()?.message, GROQ_STOP_DAY);
  await assert.rejects(pacer.take(1), (error: unknown) => error instanceof GroqStop);
});

function fakeFetch(respond: () => Response): { fetcher: Fetcher; calls: number } {
  const state: { fetcher: Fetcher; calls: number } = { fetcher: async () => (state.calls++, respond()), calls: 0 };
  return state;
}

const INPUT = groqInput([{ role: 'user', content: 'Question from counsel:\nWhen?' }]) as unknown as Record<string, unknown>;

test('a paced call returns the stream for the turn and the raw stream for its shape and usage', async () => {
  const c = clock();
  const pacer = new GroqPacer(c);
  const groq = fakeFetch(() => new Response(groqSse('- READ: Tuesday [doc:D1 p:1].'), { status: 200 }));
  const { stream, sse } = await groqGenerate(groq.fetcher, 'key', pacer)(INPUT);
  assert.equal(await new Response(stream).text(), groqSse('- READ: Tuesday [doc:D1 p:1].'));
  assert.deepEqual(callShape(await sse), { tokens: 600, blank: false, cut: false });
  assert.deepEqual(pacer.sent(), { requests: 1, tokens: groqRequestTokens(INPUT) });
});

test('a 429 stops the run at once: no retry, and no later call is sent', async () => {
  const pacer = new GroqPacer(clock());
  const groq = fakeFetch(() => new Response('{}', { status: 429, headers: { 'retry-after': '30' } }));
  const generate = groqGenerate(groq.fetcher, 'key', pacer);
  await assert.rejects(generate(INPUT), (error: unknown) => error instanceof GroqStop && error.message === GROQ_STOP_429);
  await assert.rejects(generate(INPUT), (error: unknown) => error instanceof GroqStop);
  assert.equal(groq.calls, 1);
});

test('any other failure is an errored answer with its status word, and the run goes on', async () => {
  const pacer = new GroqPacer(clock());
  const groq = fakeFetch(() => new Response('the prompt said: secret', { status: 503 }));
  await assert.rejects(groqGenerate(groq.fetcher, 'key', pacer)(INPUT), (error: unknown) => !(error instanceof GroqStop) && (error as Error).message === 'groq_http_503');
  assert.equal(pacer.stopped(), null);
});

test("Groq's usage frame is read for tokens, and a cut answer shows as cut", () => {
  assert.deepEqual(streamUsage(groqSse('x')), { neurons: 0, promptTokens: 5000, completionTokens: 600 });
  assert.deepEqual(callShape(groqSse('partial', 'length')), { tokens: 600, blank: false, cut: true });
});

// --- Shards --------------------------------------------------------------------------------------------------

const items = (spec: Record<string, number>): EvalItem[] =>
  Object.entries(spec).flatMap(([category, n]) =>
    Array.from({ length: n }, (_, i) => ({ id: `doe-${category}-${i}`, question: 'q', kind: category === 'injection' ? 'injection' : 'control', category }) as EvalItem),
  );

test('shards split every category: disjoint, complete, and each with answers for every hard gate', () => {
  const set = items({ unknown: 12, injection: 10 });
  const shards = [1, 2, 3].map((index) => pickShard(set, { index, of: 3 }));
  const ids = shards.flat().map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, 'disjoint');
  assert.deepEqual(new Set(ids), new Set(set.map((item) => item.id)), 'complete');
  for (const shard of shards) {
    assert.ok(shard.some((item) => item.category === 'unknown'));
    assert.ok(shard.some((item) => item.category === 'injection'));
    assert.ok(shard.length <= 8);
  }
  assert.deepEqual(pickShard(set, undefined).length, 22);
  assert.deepEqual(pickShard(set, { index: 1, of: 1 }).length, 22);
  assert.throws(() => pickShard(items({ unknown: 1 }), { index: 2, of: 2 }), /^Error: --shard 2\/2 matched no items in the set$/);
});

test('a shard is k/n with 1 <= k <= n <= 9', () => {
  assert.deepEqual(parseShard('2/3'), { index: 2, of: 3 });
  assert.deepEqual(parseShard('6/6'), { index: 6, of: 6 });
  for (const bad of ['0/3', '4/3', '1/10', '7/6', '1', '1/3/3', ' 1/3', 'a/b']) assert.equal(parseShard(bad), null, bad);
});

// --- Zero data retention and the key ---------------------------------------------------------------------------

async function withConfig(jsonc: string, body: (file: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'groq-zdr-'));
  try {
    const file = path.join(dir, 'wrangler.jsonc');
    await writeFile(file, jsonc);
    await body(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a Groq run needs wrangler.jsonc's zdr_confirmed true, read strictly", async () => {
  const jsonc = (value: string) => `{\n  // comment\n  "vars": {\n    "LEGALLAS_MODEL": "@cf/x/y",\n    "ASK_GROQ": ${value},\n  },\n}\n`;
  await withConfig(jsonc('{ "enabled": false, "zdr_confirmed": true, "eval_runs": [] }'), (file) => assert.equal(groqZdrConfirmed(file), true));
  await withConfig(jsonc('{ "enabled": true, "zdr_confirmed": "true" }'), (file) => assert.equal(groqZdrConfirmed(file), false));
  await withConfig(jsonc('{ "enabled": true }'), (file) => assert.equal(groqZdrConfirmed(file), false));
  await withConfig('{ not json', (file) => assert.equal(groqZdrConfirmed(file), false));
  assert.equal(groqZdrConfirmed(path.join(tmpdir(), 'no-such-dir', 'wrangler.jsonc')), false);
  const web = path.resolve(import.meta.dirname, '..');
  assert.equal(groqZdrConfirmed(path.join(web, 'wrangler.example.jsonc')), false, 'the example ships with it off: a new room refuses Groq until its owner records it');
  assert.equal(groqZdrConfirmed(), groqZdrConfirmed(path.join(web, 'wrangler.jsonc')), "with no argument it reads the room's own wrangler.jsonc, whatever that says");
});

test('the key is read only after zero data retention is confirmed, and only from REPLICA_EVAL_GROQ_API_KEY', () => {
  assert.throws(() => groqRunKey({ REPLICA_EVAL_GROQ_API_KEY: 'k' }, () => false), (error: unknown) => (error as Error).message === GROQ_NO_ZDR);
  assert.throws(() => groqRunKey({}, () => true), (error: unknown) => (error as Error).message === GROQ_NO_KEY);
  assert.throws(() => groqRunKey({ REPLICA_EVAL_GROQ_API_KEY: '  ' }, () => true), (error: unknown) => (error as Error).message === GROQ_NO_KEY);
  assert.equal(groqRunKey({ REPLICA_EVAL_GROQ_API_KEY: ' k ' }, () => true), 'k');
});

// --- Arguments ---------------------------------------------------------------------------------------------------

test('--provider groq runs Groq\'s one model; --shard and the label say what was measured', () => {
  const args = parseReplicaArgs(['--provider', 'groq', '--plant', '--category', 'unknown,injection', '--shard', '2/3', '--preflight']);
  assert.equal(args.provider, 'groq');
  assert.equal(args.model, GROQ_MODEL);
  assert.deepEqual(args.shard, { index: 2, of: 3 });
  assert.deepEqual(runLabel(args), { label: 'groq:openai/gpt-oss-120b effort=worker +plant shard=2/3', slug: 'groq-openai-gpt-oss-120b-worker-plant-shard2of3' });
  assert.equal(parseReplicaArgs(['--provider', 'groq', '--model', GROQ_MODEL]).model, GROQ_MODEL);
  assert.throws(() => parseReplicaArgs(['--provider', 'groq', '--model', '@cf/zai-org/glm-5.3-flash']), /runs openai\/gpt-oss-120b only/);
  assert.throws(() => parseReplicaArgs(['--provider', 'groq', '--effort', 'max']), /low, medium, high or omit/);
  assert.throws(() => parseReplicaArgs(['--provider', 'other', '--model', '@cf/a/b']), /usage/);
  assert.throws(() => parseReplicaArgs(['--model', '@cf/a/b', '--shard', '4/3']), /usage/);
  // Workers AI is the default, named or not, and its label is as before.
  const workers = parseReplicaArgs(['--provider', 'workers-ai', '--model', '@cf/zai-org/glm-5.3-flash', '--plant']);
  assert.equal(workers.provider, undefined);
  assert.deepEqual(runLabel(workers), { label: '@cf/zai-org/glm-5.3-flash effort=worker +plant', slug: '-cf-zai-org-glm-5-3-flash-worker-plant' });
  assert.throws(() => parseReplicaArgs(['--provider', 'workers-ai']), /@cf\//);
});

test('on Groq the preflight asks for searches only, and --effort maps to what Groq takes', () => {
  const set = items({ unknown: 2 });
  assert.deepEqual(replicaNeed(set, 1, '@cf/openai/gpt-oss-120b', 'groq'), { neurons: 0, search_semantic: 4 });
  assert.equal((replicaNeed(set, 1, '@cf/openai/gpt-oss-120b').neurons ?? 0) > 2 * TYPICAL_ANSWER_NEURONS, true);
  assert.equal(groqEffort(null), undefined);
  assert.equal(groqEffort('omit'), null);
  assert.equal(groqEffort('low'), 'low');
});
