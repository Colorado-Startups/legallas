// SPDX-License-Identifier: Apache-2.0
// The Ask model replica's pure parts: arguments, effort override, usage frames, cite validity and the summary. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callShape, citeValidity, garbledIds, parseReplicaArgs, percentile, pickCategories, plannedAnswers, recommendOf, replicaNeed, restGenerate, runLabel, streamAnswer, streamUsage, summarize, TYPICAL_ANSWER_NEURONS, USD_PER_NEURON, withEffort, withMaxTokens, type Run } from './ask-replica.ts';
import type { EvalItem } from './ask-eval-score.ts';
import { ASK_MAX_TOKENS, neuronsFor } from '../worker/budget.ts';
import type { SpendLease } from './spend-guard.ts';

test('arguments: an @cf/ model is required, the rest has defaults', () => {
  assert.deepEqual(parseReplicaArgs(['--model', '@cf/openai/gpt-oss-120b']), {
    model: '@cf/openai/gpt-oss-120b', effort: null, reps: 1, set: null, out: null, budget: 1, fresh: false,
  });
  const args = parseReplicaArgs(['--model', '@cf/zai-org/glm-5.3-flash', '--effort', 'omit', '--reps', '2', '--budget', '0.4', '--fresh']);
  assert.equal(args.effort, 'omit');
  assert.equal(args.reps, 2);
  assert.equal(args.budget, 0.4);
  assert.equal(args.fresh, true);
});

test('arguments: only Workers AI models, known efforts and small rep counts', () => {
  assert.throws(() => parseReplicaArgs([]), /@cf\//);
  for (const model of ['openai/gpt-5', '@hf/thebloke/model', 'https://example.test/v1', '@cf/openai/../x y']) {
    assert.throws(() => parseReplicaArgs(['--model', model]), /@cf\//, model);
  }
  assert.throws(() => parseReplicaArgs(['--model', '@cf/a/b', '--effort', 'xhigh']), /usage/);
  assert.throws(() => parseReplicaArgs(['--model', '@cf/a/b', '--reps', '9']), /usage/);
  assert.throws(() => parseReplicaArgs(['--model', '@cf/a/b', '--budget', '0']), /usage/);
});

test('--category keeps eval v2 categories only; --preflight is a switch', () => {
  const args = parseReplicaArgs(['--model', '@cf/a/b', '--category', 'unknown,injection,unknown', '--preflight']);
  assert.deepEqual(args.categories, ['unknown', 'injection']);
  assert.equal(args.preflight, true);
  assert.equal(parseReplicaArgs(['--model', '@cf/a/b']).preflight, undefined);
  for (const bad of ['', 'secrets', 'unknown,', 'Unknown']) assert.throws(() => parseReplicaArgs(['--model', '@cf/a/b', '--category', bad]), /usage/, bad);
});

test("--recommend 0 or 1 replaces the room's RECOMMEND for one run; the label and slug say which", () => {
  const on = parseReplicaArgs(['--model', '@cf/a/b', '--recommend', '1', '--plant']);
  assert.equal(on.recommend, '1');
  assert.equal(parseReplicaArgs(['--model', '@cf/a/b', '--recommend', '0']).recommend, '0');
  assert.equal(parseReplicaArgs(['--model', '@cf/a/b']).recommend, undefined);
  for (const bad of ['', '2', 'on', 'true']) assert.throws(() => parseReplicaArgs(['--model', '@cf/a/b', '--recommend', bad]), /usage/, bad);
  assert.deepEqual(runLabel(on), { label: '@cf/a/b effort=worker +plant recommend=1', slug: '-cf-a-b-worker-plant-recommend1' });
  assert.deepEqual(runLabel({ ...on, recommend: '0' }).slug, '-cf-a-b-worker-plant-recommend0', 'on and off write apart');
  assert.equal(recommendOf({ recommend: '0' }, '1'), '0', 'the flag wins over the room');
  assert.equal(recommendOf({}, '1'), '1', "without it, the room's own");
});

test('the release gate set: categories picked, blocked items left out of the plan, a typical cost asked for', () => {
  const item = (id: string, category: EvalItem['category'], blockedUntil?: string): EvalItem => ({
    id, kind: category === 'injection' ? 'injection' : 'known', question: 'q', expect: {}, category, ...(blockedUntil ? { blockedUntil } : {}),
  });
  const items = [item('doe-f', 'facts'), item('doe-u', 'unknown'), item('doe-i', 'injection'), item('doe-u2', 'unknown', 'W9')];
  assert.equal(pickCategories(items, undefined).length, 4);
  assert.deepEqual(pickCategories(items, ['unknown', 'injection']).map((i) => i.id), ['doe-u', 'doe-i', 'doe-u2']);
  assert.throws(() => pickCategories(items, ['law']), /matched no items/);
  assert.equal(plannedAnswers(pickCategories(items, ['unknown', 'injection']), 2), 4, 'the blocked item is reported apart');
  const model = '@cf/openai/gpt-oss-120b';
  const ceiling = neuronsFor(model, 0, ASK_MAX_TOKENS);
  assert.deepEqual(replicaNeed(items.slice(0, 2), 3, model), { neurons: 6 * TYPICAL_ANSWER_NEURONS + ceiling, search_semantic: 4 });
  assert.equal(replicaNeed(items.slice(0, 2), 3, model, undefined, 1_000).neurons, 6 * TYPICAL_ANSWER_NEURONS + neuronsFor(model, 0, 1_000), '--max-tokens sets the tail');
  assert.equal(replicaNeed([], 3, model).neurons, 0, 'no answers, no tail');
});

test('the model call is Workers AI alone: the /ai/run path form, no AI Gateway header, nothing but auth and JSON', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string> });
    return new Response('data: [DONE]\n', { status: 200 });
  }) as unknown as typeof fetch;
  const lease = { take: async () => ({ meter: 'neurons', period: '2026-11-05', worst: 1 }), done: () => undefined } as unknown as SpendLease;
  const tokens = { get: async () => 'token-1', renew: async () => 'token-2' };
  const { sse } = await restGenerate(fetcher, '0123456789abcdef0123456789abcdef', tokens, '@cf/zai-org/glm-5.3-flash', lease)({ messages: [], stream: true });
  await sse;
  assert.deepEqual(seen, [{
    url: 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/zai-org/glm-5.3-flash',
    headers: { Authorization: 'Bearer token-1', 'Content-Type': 'application/json' },
  }]);
});

test('effort: none keeps the worker input, a level replaces it, omit removes it', () => {
  const input = { messages: [], stream: true, max_tokens: 4096, reasoning_effort: 'medium' };
  assert.equal(withEffort(input, null), input);
  assert.equal(withEffort(input, 'low').reasoning_effort, 'low');
  assert.equal('reasoning_effort' in withEffort(input, 'omit'), false);
  assert.equal(withEffort(input, 'omit').max_tokens, 4096);
});

test('--max-tokens replaces the worker budget only when given, and only with a plausible number', () => {
  assert.equal(parseReplicaArgs(['--model', '@cf/a/b']).maxTokens, undefined);
  assert.equal(parseReplicaArgs(['--model', '@cf/a/b', '--max-tokens', '8192']).maxTokens, 8192);
  for (const bad of ['0', '64', '08192', '9999999', 'lots']) assert.throws(() => parseReplicaArgs(['--model', '@cf/a/b', '--max-tokens', bad]), /usage/, bad);
  const input = { messages: [], stream: true, max_tokens: 4096, reasoning_effort: 'high' };
  assert.equal(withMaxTokens(input, undefined), input);
  assert.deepEqual(withMaxTokens(input, 8192), { ...input, max_tokens: 8192 });
});

test('a call that reasoned until max_tokens is blank and cut; a normal one is neither', () => {
  // The shape glm-5.3-flash streams when reasoning uses the whole budget (probe, 2026-10-04): no content, "length".
  const cut = [
    'data: {"choices":[{"delta":{"content":"","reasoning_content":null,"role":"assistant"},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"content":null,"reasoning_content":"Let me list"},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"content":"\u200b \\n"},"finish_reason":"length"}]}',
    'data: {"response":"","usage":{"prompt_tokens":31,"completion_tokens":64,"neurons":3.3}}',
    'data: [DONE]',
  ].join('\n');
  assert.equal(streamAnswer(cut).finish, 'length');
  assert.deepEqual(callShape(cut), { tokens: 64, blank: true, cut: true });
  const fine = 'data: {"choices":[{"delta":{"content":"READ: x [doc:a p:1]."},"finish_reason":"stop"}]}\ndata: {"response":"","usage":{"completion_tokens":900,"neurons":1}}\n';
  assert.deepEqual(streamAnswer(fine), { text: 'READ: x [doc:a p:1].', finish: 'stop' });
  assert.deepEqual(callShape(fine), { tokens: 900, blank: false, cut: false });
});

test('usage: the closing response frame carries the totals; deltas and [DONE] do not count', () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"Hi"}}],"usage":{"prompt_tokens":0,"completion_tokens":1,"neurons":0.4}}',
    'data: {"choices":[],"usage":{"prompt_tokens":0,"completion_tokens":0,"neurons":0}}',
    'data: {"response":"","usage":{"prompt_tokens":125,"completion_tokens":75,"total_tokens":200,"neurons":9.09}}',
    'data: [DONE]',
    '',
  ].join('\n');
  assert.deepEqual(streamUsage(sse), { neurons: 9.09, promptTokens: 125, completionTokens: 75 });
  assert.equal(streamUsage('data: [DONE]\n'), null);
});

test('cite validity: distinct written cites against the validated ones, both bracket forms', () => {
  const answer = 'CONFIRMED: a [doc:d1 p:2]. READ: b 【doc:d1 p:2】. READ: c [doc:gone p:1]. INFERENCE: d [doc:d2 p:9].';
  assert.deepEqual(citeValidity(answer, [{ id: 'd1', page: 2 }]), { written: 3, valid: 1 });
  assert.deepEqual(citeValidity("I don't know.", []), { written: 0, valid: 0 });
});

test('garbled ids: a real id cut short or a few characters off counts; a forged or real id does not', () => {
  const real = '0f8e2c1a-5b7d-4e3f-9a6b-1c2d3e4f5a6b';
  const ids = [real, 'b7c1d2e3-0000-4000-8000-000000000000'];
  assert.equal(garbledIds(`CONFIRMED: a [doc:${real} p:1].`, ids), 0);
  assert.equal(garbledIds('CONFIRMED: a [doc:0f8e2c1a p:1].', ids), 1, 'truncated');
  assert.equal(garbledIds('CONFIRMED: a [doc:0f8e2c1a-5b7d-4e3f-9a6b-1c2d3e4f5a7c p:1].', ids), 1, 'two characters off');
  assert.equal(garbledIds('READ: b [doc:not-a-real-id p:1]. READ: c [doc:0f8e2c1a p:2].', ids), 1, 'forged id is not garbled; one id counts once');
});

test('percentile: nearest rank', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5], 95), 5);
  assert.equal(percentile([4, 1, 3, 2], 50), 2);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 95), 19);
});

test('summary: verdicts per rep, controls, injections, latency and cost', () => {
  const run = (over: Partial<Run>): Run => ({
    id: 'x', kind: 'known', rep: 1, verdict: 'pass', failed: [], firstMs: 1000, doneMs: 5000,
    neurons: 100, promptTokens: 0, completionTokens: 0, cites: { written: 2, valid: 2, garbled: 0 }, calls: [{ tokens: 1000, blank: false, cut: false }], truncated: false,
    result: { status: 200, answer: '', citations: [], dontKnow: false, error: null }, ...over,
  });
  const s = summarize([
    run({}),
    run({ rep: 2, verdict: 'fail', failed: ['cites_expected_document'], cites: { written: 2, valid: 1, garbled: 1 } }),
    run({ kind: 'control', failed: [], truncated: true }),
    run({ kind: 'control', rep: 2, verdict: 'fail', failed: ['dont_know_verdict'] }),
    run({ kind: 'injection', verdict: 'review', failed: ['model_resisted (review)'], calls: [{ tokens: 4096, blank: true, cut: true }, { tokens: 2000, blank: false, cut: false }] }),
    run({ rep: 2, verdict: 'fail', failed: ['stream_complete'], doneMs: 99_000, result: { status: 200, answer: '', citations: [], dontKnow: null, error: 'model_http_500' } }),
  ]);
  assert.equal(s.runs, 6);
  assert.deepEqual([s.pass, s.review, s.fail, s.errors], [2, 1, 3, 1]);
  assert.deepEqual(s.notFailByRep, [3, 0]);
  assert.deepEqual([s.citesValid, s.citesWritten, s.garbledIds], [11, 12, 1]);
  assert.equal(s.controlsRight, '1/2');
  assert.equal(s.injectionsResisted, '0/1');
  assert.equal(s.doneP95, 5000, 'an errored run does not count toward latency');
  assert.ok(Math.abs(s.usd - 600 * USD_PER_NEURON) < 1e-12);
  assert.deepEqual([s.modelCalls, s.blankCalls, s.cutCalls], [7, 1, 1], 'a retried answer counts both calls');
  assert.equal(s.truncatedAnswers, 1, 'answers the worker marks truncated, counted apart from cut calls');
  assert.deepEqual([s.callTokensP50, s.callTokensP95, s.callTokensMax], [1000, 4096, 4096]);
});

test('--law turns on the law library run (T21); law cites count valid only when retrieved for the question', async () => {
  const { lawCiteValidity, parseReplicaArgs: parse } = await import('./ask-replica.ts');
  assert.equal(parse(['--model', '@cf/zai-org/glm-5.3-flash']).law, undefined);
  assert.equal(parse(['--model', '@cf/zai-org/glm-5.3-flash', '--law']).law, true);
  const passages = [{ id: 'crs-7-80-714', cite: 'C.R.S. § 7-80-714', title: 't', url: 'https://www.ecfr.gov/x', retrieved: '2026-10-03', track: 'civil' as const, kind: 'statute' as const, source: 's' }];
  const validate = (answer: string, citable: Map<string, (typeof passages)[number]>) =>
    [...new Set([...answer.matchAll(/\[law:([a-z0-9~-]+)\]/g)].map((m) => m[1]!))].flatMap((id) => (citable.has(id) ? [citable.get(id)!] : []));
  assert.deepEqual(lawCiteValidity('A [law:crs-7-80-714], B 【law:crs-7-80-999】, A again [law:crs-7-80-714].', passages, validate), { written: 2, valid: 1 });
});

test('a 429 is retried after a wait; any other status returns at once (T21)', async () => {
  const { withRateRetry } = await import('./ask-replica.ts');
  const statuses = [429, 429, 200];
  let calls = 0;
  const got = await withRateRetry(async () => new Response('x', { status: statuses[calls++]! }), [1, 1, 1]);
  assert.equal(got.status, 200);
  assert.equal(calls, 3);
  calls = 0;
  assert.equal((await withRateRetry(async () => (calls++, new Response('x', { status: 500 })), [1])).status, 500);
  assert.equal(calls, 1);
  calls = 0;
  assert.equal((await withRateRetry(async () => (calls++, new Response('x', { status: 429 })), [1, 1])).status, 429);
  assert.equal(calls, 3);
});
