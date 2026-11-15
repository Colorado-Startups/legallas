// SPDX-License-Identifier: Apache-2.0
// The spend budget's rules (worker/budget.ts): limits under Cloudflare's included amounts, the paid month for neurons
// past the free day, periods in UTC, the scripts' headroom, AI Search unbilled before November 2026, and neuron
// estimates that never under-hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  abandonedNeurons,
  AI_SEARCH_INCLUDED,
  AI_SEARCH_WINDOWS_PER_CYCLE,
  CANCEL_MARGIN_TOKENS,
  ASK_MAX_TOKENS,
  BUDGET,
  earlierDaysOfMonth,
  inputChars,
  limitOf,
  NEURON_PRICE_USD_PER_MILLION,
  neuronLimit,
  neuronsForUsd,
  PAID_MONTHLY_USD,
  PAID_SCRIPTS_USD,
  PAID_STOP_NEURONS,
  PAID_STOP_SHARE,
  paidStopNeurons,
  paidStops,
  paidBefore,
  paidNeuronsOfDay,
  usdForNeurons,
  NEURON_RATES,
  METERS,
  NEURON_DAILY_BUDGET,
  neuronsFor,
  outputCeiling,
  periodOf,
  scriptRoom,
  secondsToReset,
  UNBILLED_LIMIT,
  UNLISTED_MODEL_RATE,
  usageNeurons,
  WORKERS_AI_FREE_NEURONS,
  worstCaseNeurons,
  type Meter,
} from './budget.ts';
import { paidMonthlyOf } from './room-settings.ts';

/** A room that set a $10 paid month, as one customer did (2026-10-31). */
const TEN = paidStopNeurons(10);

const GLM = '@cf/zai-org/glm-5.3-flash';

test('every limit sits under what Workers Paid includes, and scripts stop sooner', () => {
  assert.equal(NEURON_DAILY_BUDGET, 9_000);
  assert.ok(NEURON_DAILY_BUDGET < WORKERS_AI_FREE_NEURONS);
  assert.ok(BUDGET.search_semantic.limit < AI_SEARCH_INCLUDED.semantic);
  assert.ok(BUDGET.search_fulltext.limit < AI_SEARCH_INCLUDED.fulltext);
  assert.ok(BUDGET.search_ingest_tokens.limit < AI_SEARCH_INCLUDED.ingestTokens);
  assert.equal(BUDGET.search_semantic.limit, 450, 'about 90% of the 1,000 included queries, halved while a billing cycle may span two months');
  assert.ok(BUDGET.search_semantic.limit * AI_SEARCH_WINDOWS_PER_CYCLE < AI_SEARCH_INCLUDED.semantic, 'two calendar months in one billing cycle stay under it');
  assert.ok(BUDGET.search_ingest_tokens.limit * AI_SEARCH_WINDOWS_PER_CYCLE < AI_SEARCH_INCLUDED.ingestTokens);
  for (const meter of METERS) {
    assert.ok(BUDGET[meter].scriptHeadroom >= 0 && BUDGET[meter].scriptHeadroom < BUDGET[meter].limit, meter);
  }
  assert.ok(BUDGET.neurons.scriptHeadroom >= 1_000, 'analytics lag a few minutes: at least 1,000 neurons of headroom');
});

test("no meter's own limit can bill: each, in every window one billing cycle holds, stays under what is included (paid neurons come only from the paid month)", () => {
  const included: Record<Meter, number> = {
    neurons: WORKERS_AI_FREE_NEURONS,
    search_semantic: AI_SEARCH_INCLUDED.semantic,
    search_fulltext: AI_SEARCH_INCLUDED.fulltext,
    search_ingest_tokens: AI_SEARCH_INCLUDED.ingestTokens,
  };
  for (const meter of METERS) {
    // Free neurons are per UTC day; AI Search's included amounts are per billing cycle, which can overlap two of the
    // calendar months the meters count.
    const windows = BUDGET[meter].per === 'day' ? 1 : AI_SEARCH_WINDOWS_PER_CYCLE;
    const limit = limitOf(meter, periodOf(meter, new Date('2026-12-15T12:00:00Z')));
    assert.equal(limit, BUDGET[meter].limit, `${meter}: a billed period has the budget's limit`);
    assert.ok(limit * windows < included[meter], `${meter}: ${limit} x ${windows} stays under ${included[meter]}`);
  }
});

test('a new room pays nothing past the free neurons: Ask stops at the free limit unless the owner sets a paid month (#48)', () => {
  assert.equal(PAID_MONTHLY_USD, 0, 'node --test sets no room config: the default');
  assert.deepEqual(PAID_STOP_NEURONS, { worker: 0, script: 0 });
  assert.equal(PAID_SCRIPTS_USD, 0);
  assert.equal(neuronLimit('2026-11-05', 'worker', 0), NEURON_DAILY_BUDGET, 'a known month of $0 adds nothing to the free day');
  assert.equal(neuronLimit('2026-11-05', 'script', 0), NEURON_DAILY_BUDGET - BUDGET.neurons.scriptHeadroom);
  for (const [raw, usd] of [['10', 10], [' 7.5 ', 7.5], ['0', 0], ['50', 50], ['51', 0], ['-1', 0], ['ten', 0], ['1e3', 0], ['', 0], [undefined, 0], [10, 0]] as const) {
    assert.equal(paidMonthlyOf(raw), usd, String(raw));
  }
});

test("a $10 paid month: $0.011 per 1,000 neurons past the free 10,000 a day, stopped at 90%, scripts a third", () => {
  assert.equal(NEURON_PRICE_USD_PER_MILLION, 11, '$0.011 per 1,000 neurons (Workers AI pricing page, 2026-10-20)');
  assert.equal(PAID_STOP_SHARE, 0.9);
  assert.deepEqual(paidStops(10), { worker: 9, script: 3 });
  assert.deepEqual(paidStops(45), { worker: 40.5, script: 3 }, 'scripts never pass $3.00');
  assert.equal(TEN.worker, 818_181, '$9.00 of neurons, rounded down');
  assert.equal(TEN.script, 272_727, '$3.00 of neurons, rounded down');
  assert.ok(usdForNeurons(TEN.worker) <= 9 && usdForNeurons(TEN.worker + 1) > 9);
  for (const usd of [1, 10, 50]) assert.ok(paidStops(usd).script < paidStops(usd).worker, 'scripts get a share of the stop, never all of it');
  assert.equal(neuronsForUsd(0.011), 1_000);
  assert.equal(paidNeuronsOfDay(9_999), 0);
  assert.equal(paidNeuronsOfDay(10_000), 0);
  assert.equal(paidNeuronsOfDay(12_345.2), 2_346);
});

test("a month's paid spend sums each earlier day past the free 10,000, by the larger of D1's count and the account's", () => {
  assert.deepEqual(earlierDaysOfMonth('2026-11-04'), ['2026-11-01', '2026-11-02', '2026-11-03']);
  const account = { '2026-11-01': 4_641, '2026-11-02': 25_000, '2026-11-03': 11_000 };
  const counted = { '2026-11-01': 4_649, '2026-11-03': 12_000, '2026-11-04': 99_999 };
  // 0 + 15,000 + 2,000 (D1's 12,000 beats the analytics' 11,000); today (11-04) is not an earlier day.
  assert.equal(paidBefore('2026-11-04', counted, account), 17_000);
  assert.equal(paidBefore('2026-11-01', counted, account), 0, 'the 1st has no earlier days: nothing paid yet');
});

test("unknown analytics for any earlier day leave the paid month unknown: the free limits stand", () => {
  assert.equal(paidBefore('2026-11-04', { '2026-11-02': 3_000 }, { '2026-11-01': 0, '2026-11-03': 0 }), null, '11-02 is missing from the analytics');
  assert.equal(paidBefore('2026-11-04', {}, { '2026-11-01': 0, '2026-11-02': Number.NaN, '2026-11-03': 0 }), null);
  assert.equal(neuronLimit('2026-11-04', 'worker', null), NEURON_DAILY_BUDGET);
  assert.equal(neuronLimit('2026-11-04', 'script', null), NEURON_DAILY_BUDGET - BUDGET.neurons.scriptHeadroom);
});

test('the 90% stop: a month whose every day spends to its limit pays at most $9.00, and nearly all of it', () => {
  const counted: Record<string, number> = {};
  const account: Record<string, number> = {};
  for (let day = 1; day <= 30; day += 1) {
    const today = `2026-11-${String(day).padStart(2, '0')}`;
    const limit = neuronLimit(today, 'worker', paidBefore(today, counted, account), TEN);
    counted[today] = account[today] = limit;
  }
  const paid = Object.values(account).reduce((sum, n) => sum + paidNeuronsOfDay(n), 0);
  assert.ok(paid <= TEN.worker, `${paid} paid neurons`);
  assert.ok(usdForNeurons(paid) <= 9 && usdForNeurons(paid) > 8.98, `$${usdForNeurons(paid).toFixed(2)}`);
  assert.equal(neuronLimit('2026-11-30', 'worker', TEN.worker, TEN), NEURON_DAILY_BUDGET, 'spent: back to the free day');
});

test("scripts may bring the month's paid spend, everyone's, to $3.00 at most, so the room keeps the rest", () => {
  const free = NEURON_DAILY_BUDGET - BUDGET.neurons.scriptHeadroom;
  assert.equal(neuronLimit('2026-11-05', 'script', 0, TEN), free + TEN.script);
  assert.equal(neuronLimit('2026-11-05', 'script', 100_000, TEN), free + TEN.script - 100_000);
  // Ask spent past the scripts' share: they keep to the free 7,000, while Ask still has room to $9.00.
  assert.equal(neuronLimit('2026-11-05', 'script', 300_000, TEN), free);
  assert.equal(neuronLimit('2026-11-05', 'worker', 300_000, TEN), NEURON_DAILY_BUDGET + TEN.worker - 300_000);
  // A script that spends to its limit every day, Ask idle, leaves the month under $3.00.
  const days: Record<string, number> = {};
  for (let day = 1; day <= 30; day += 1) {
    const today = `2026-11-${String(day).padStart(2, '0')}`;
    days[today] = neuronLimit(today, 'script', paidBefore(today, days, days), TEN);
  }
  assert.ok(usdForNeurons(Object.values(days).reduce((sum, n) => sum + paidNeuronsOfDay(n), 0)) <= paidStops(10).script);
});

test("a new month starts the paid spend again: November's days are not December's", () => {
  const november = { '2026-11-29': 900_000, '2026-11-30': 900_000 };
  assert.equal(paidBefore('2026-12-01', november, november), 0);
  assert.equal(neuronLimit('2026-12-01', 'worker', paidBefore('2026-12-01', november, november)), NEURON_DAILY_BUDGET + PAID_STOP_NEURONS.worker);
  assert.equal(paidBefore('2026-12-02', november, november), null, "12-01 is not in the analytics yet");
});

test('periods are the UTC day for neurons and the UTC month for AI Search', () => {
  const late = new Date('2026-11-30T23:59:59Z');
  assert.equal(periodOf('neurons', late), '2026-11-30');
  assert.equal(periodOf('search_semantic', late), '2026-11');
  assert.equal(periodOf('search_ingest_tokens', new Date('2026-12-01T00:00:00Z')), '2026-12');
});

test('AI Search meters never refuse before November 2026, and do from then on; neurons always do', () => {
  assert.equal(limitOf('search_semantic', '2026-10'), UNBILLED_LIMIT);
  assert.equal(limitOf('search_ingest_tokens', '2026-10', 'script'), UNBILLED_LIMIT);
  assert.equal(limitOf('search_semantic', '2026-11'), 450);
  assert.equal(limitOf('search_semantic', '2027-01', 'script'), 450 - BUDGET.search_semantic.scriptHeadroom);
  assert.equal(limitOf('neurons', '2026-10-19'), 9_000);
  assert.equal(limitOf('neurons', '2026-10-19', 'script'), 9_000 - BUDGET.neurons.scriptHeadroom);
  assert.ok(Number.isSafeInteger(UNBILLED_LIMIT), 'D1 binds it as an integer');
});

test("a script's room is its limit less the larger of the analytics and the D1 counter, never negative", () => {
  const limit = limitOf('neurons', '2026-11-02', 'script');
  assert.equal(scriptRoom('neurons', '2026-11-02', 1_000, 0), limit - 1_000);
  assert.equal(scriptRoom('neurons', '2026-11-02', 1_000, 3_000), limit - 3_000, 'the counter sees spend analytics have not caught up with');
  assert.equal(scriptRoom('neurons', '2026-11-02', 50_000, 0), 0);
});

test('a period resets at midnight UTC or on the first of the next month', () => {
  assert.equal(secondsToReset('neurons', new Date('2026-11-02T23:59:00Z')), 60);
  assert.equal(secondsToReset('search_semantic', new Date('2026-11-30T23:00:00Z')), 3_600);
  assert.equal(secondsToReset('search_semantic', new Date('2026-12-31T23:59:59Z')), 1, 'December rolls into the next year');
});

test("Ask's worst case holds its whole max_tokens of output, so a single answer can never pass the hold", () => {
  const messages = [{ role: 'user', content: 'x'.repeat(30_000) }];
  // 30,000 characters at 3 a token is 10,000 input tokens; 16,384 output tokens.
  assert.equal(worstCaseNeurons(GLM, { messages, max_tokens: ASK_MAX_TOKENS }), neuronsFor(GLM, 10_000, ASK_MAX_TOKENS));
  assert.ok(worstCaseNeurons(GLM, { messages, max_tokens: ASK_MAX_TOKENS }) > 260 * 3, 'far above a typical question');
  assert.equal(worstCaseNeurons(GLM, { messages }), worstCaseNeurons(GLM, { messages, max_tokens: 16_384 }), 'no max_tokens means the default ceiling');
});

test('embeddings hold their input only, and an unlisted model is costed like the dearest one', () => {
  const texts = ['a'.repeat(3_000), 'b'.repeat(3_000)];
  assert.equal(worstCaseNeurons('@cf/qwen/qwen3-embedding-0.6b', { text: texts }), Math.max(1, neuronsFor('@cf/qwen/qwen3-embedding-0.6b', 2_000, 0)));
  const input = { messages: [{ role: 'user', content: 'hi' }], max_tokens: 1_000 };
  assert.equal(worstCaseNeurons('@cf/example/unlisted', input), Math.ceil((1 * UNLISTED_MODEL_RATE.input + 1_000 * UNLISTED_MODEL_RATE.output) / 1e6));
  assert.equal(worstCaseNeurons('@cf/qwen/qwen3-embedding-0.6b', null), 1, 'every call holds something');
  assert.equal(worstCaseNeurons(GLM, null), neuronsFor(GLM, 0, 16_384), 'a generation with no input still holds its output ceiling');
});

test("usage: Workers AI's own neuron count wins, else tokens at the model's rate, else nothing", () => {
  assert.equal(usageNeurons(GLM, { neurons: 254.2, prompt_tokens: 1, completion_tokens: 1 }), 255);
  assert.equal(usageNeurons(GLM, { prompt_tokens: 41, completion_tokens: 300 }), neuronsFor(GLM, 41, 300));
  assert.equal(usageNeurons(GLM, { total_tokens: 10 }), null);
  assert.equal(usageNeurons(GLM, null), null);
  assert.equal(usageNeurons(GLM, { neurons: -1, prompt_tokens: 'x' }), null);
});

test('an abandoned call settles to its input, the output read and a margin, never past its hold', () => {
  const input = { messages: [{ role: 'user', content: 'x'.repeat(30_000) }], max_tokens: ASK_MAX_TOKENS };
  assert.equal(abandonedNeurons(GLM, input, { frames: 40, chars: 90 }), neuronsFor(GLM, 10_000, 40 + CANCEL_MARGIN_TOKENS));
  assert.equal(abandonedNeurons(GLM, input, { frames: 10, chars: 3_000 }), neuronsFor(GLM, 10_000, 1_000 + CANCEL_MARGIN_TOKENS), 'characters win when they say more');
  assert.equal(abandonedNeurons(GLM, input, { frames: 100_000, chars: 0 }), worstCaseNeurons(GLM, input), 'capped at the hold');
});

test('the output ceiling is max_tokens or max_completion_tokens, the larger when both are set', () => {
  const messages = [{ role: 'user', content: 'x'.repeat(3_000) }];
  assert.equal(worstCaseNeurons(GLM, { messages, max_completion_tokens: 1_000 }), worstCaseNeurons(GLM, { messages, max_tokens: 1_000 }));
  assert.equal(worstCaseNeurons(GLM, { messages, max_completion_tokens: 1_000 }), neuronsFor(GLM, 1_000, 1_000), 'not the 16,384 default');
  assert.equal(worstCaseNeurons(GLM, { messages, max_tokens: 500, max_completion_tokens: 4_000 }), neuronsFor(GLM, 1_000, 4_000));
  assert.equal(outputCeiling({ max_tokens: 0, max_completion_tokens: -1 }), null, 'no usable ceiling means the default');
  assert.equal(outputCeiling({ max_completion_tokens: Infinity }), null);
  assert.equal(outputCeiling(null), null);
});

test('input counts array content, tool calls and tool definitions, never less than the text the model reads', () => {
  assert.equal(inputChars({ messages: [{ role: 'user', content: 'abc' }] }), 3, 'a plain message is its content: the role is not counted');
  assert.equal(inputChars({ messages: [{ role: 'user', content: [{ type: 'text', text: 'abc' }, { type: 'text', text: 'de' }, 'f'] }] }), 6);
  const image = { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } };
  assert.equal(inputChars({ messages: [{ role: 'user', content: [image] }] }), JSON.stringify(image).length, 'a non-text part counts as its JSON');
  const calls = [{ id: 'call-1', type: 'function', function: { name: 'legallas_search', arguments: '{"query":"zebra"}' } }];
  assert.equal(inputChars({ messages: [{ role: 'assistant', content: null, tool_calls: calls }] }), JSON.stringify({ tool_calls: calls }).length);
  assert.equal(inputChars({ messages: [{ role: 'tool', tool_call_id: 'call-1', content: 'result' }] }), 'result'.length + JSON.stringify({ tool_call_id: 'call-1' }).length);
  const tools = [{ type: 'function', function: { name: 'legallas_search', description: 'Search the room.', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }];
  assert.equal(inputChars({ messages: [], tools }), JSON.stringify(tools).length);
  assert.ok(worstCaseNeurons(GLM, { messages: [], tools, max_tokens: 100 }) > worstCaseNeurons(GLM, { messages: [], max_tokens: 100 }), 'tools raise the hold');
  assert.equal(inputChars({ messages: [null, 7, { role: 'user' }] }), 0, 'malformed messages count nothing and never throw');
});

test('glm-5.3 is costed exactly, at the rate unlisted models are held at', () => {
  assert.deepEqual(NEURON_RATES['@cf/zai-org/glm-5.3'], UNLISTED_MODEL_RATE);
});

test('glm-4.7-flash has its pricing-page rate (2026-10-20), cheaper than the flash Ask runs', () => {
  assert.deepEqual(NEURON_RATES['@cf/zai-org/glm-4.7-flash'], { input: 5_500, output: 36_400 });
  assert.ok(neuronsFor('@cf/zai-org/glm-4.7-flash', 10_000, 1_000) < neuronsFor(GLM, 10_000, 1_000));
});
