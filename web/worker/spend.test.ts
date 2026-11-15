// SPDX-License-Identifier: Apache-2.0
// The Workers' spend guards (worker/spend.ts) on real SQL (migration 0007): atomic holds, settling to the usage a
// stream reports, refusals that never cost a member's question, and the MCP search tool's refusal. Ask's refusals
// through POST /api/ask are in ask-spend.test.ts.
import './paid-month-ten.testkit.ts'; // first: a room with a $10 paid month
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abandonedNeurons, ASK_MAX_TOKENS, limitOf, neuronsFor, PAID_STOP_NEURONS, worstCaseNeurons } from './budget.ts';
import { modelSse } from './room-fixtures.ts';
import { adjust, BudgetExhausted, isLocalRequest, LocalSpendOff, meteredAi, meteredSearch, monthPaid, refusedUnbilled, reserve, shortMeter, tapUsage, used, withSpendGuards, type StreamRead } from './spend.ts';
import { testDb } from './sqlite-d1.ts';
import { runTool } from '../mcp/server.ts';
import { searchTool } from '../mcp/tools/search.ts';
import type { McpEnv, Props } from '../mcp/contract.ts';

const GLM = '@cf/zai-org/glm-5.3-flash';
const NOV = new Date('2026-11-05T12:00:00Z');

test('reserve adds only within the limit, in one statement; adjust never goes below zero', async () => {
  const { db } = testDb();
  assert.equal(await reserve(db, 'neurons', '2026-11-05', 6_000, 9_000), true);
  assert.equal(await reserve(db, 'neurons', '2026-11-05', 3_001, 9_000), false, 'would pass the limit');
  assert.equal(await reserve(db, 'neurons', '2026-11-05', 3_000, 9_000), true, 'exactly the limit is allowed');
  assert.equal(await used(db, 'neurons', '2026-11-05'), 9_000);
  assert.equal(await reserve(db, 'neurons', '2026-11-06', 9_001, 9_000), false, 'a first hold past the limit is refused too');
  assert.equal(await used(db, 'neurons', '2026-11-06'), 0);
  await adjust(db, 'neurons', '2026-11-05', -20_000);
  assert.equal(await used(db, 'neurons', '2026-11-05'), 0);
  await assert.rejects(reserve(db, 'neurons', '2026-11-05', -1, 9_000), RangeError);
});

test('concurrent holds can never pass the limit together', async () => {
  const { db } = testDb();
  const limit = limitOf('search_semantic', '2026-11');
  const results = await Promise.all(Array.from({ length: 20 }, () => reserve(db, 'search_semantic', '2026-11', 50, limit)));
  assert.equal(results.filter(Boolean).length, Math.floor(limit / 50));
  assert.equal(await used(db, 'search_semantic', '2026-11'), Math.floor(limit / 50) * 50);
});

/** A model stream that records whether it was read to the end or cancelled. */
function watched(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const state = { cancelled: false, ended: false };
  const out = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        state.ended = true;
        controller.close();
      } else controller.enqueue(value);
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { out, state };
}

test('tapUsage passes the stream through and reports its last usage frame when it ends', async () => {
  let seen: StreamRead | null = null;
  const out = tapUsage(modelSse('Hello there.', 3, 'stop'), { onEnd: async (read) => void (seen = read), onCancel: async () => assert.fail('not cancelled') });
  const text = await new Response(out).text();
  assert.match(text, /Hello/);
  assert.deepEqual(seen!.usage, { prompt_tokens: 41, completion_tokens: 300, total_tokens: 341 });
  assert.ok(seen!.frames > 3 && seen!.chars >= 'Hello there.'.length + 'hidden reasoning'.length, 'answer and reasoning both counted');
  let none: unknown = 'not called';
  await new Response(tapUsage(modelSse('No usage.'), { onEnd: async (read) => void (none = read.usage), onCancel: async () => undefined })).text();
  assert.equal(none, null);
});

test('a reader that cancels mid-stream cancels the model stream at once and reports only what was read', async () => {
  const later: Promise<unknown>[] = [];
  const model = watched(modelSse('A long answer the reader abandons, '.repeat(20), 4, 'stop'));
  let read: StreamRead | null = null;
  const out = tapUsage(model.out, { onEnd: async () => assert.fail('never read to the end'), onCancel: async (r) => void (read = r) }, (promise) => later.push(promise));
  const reader = out.getReader();
  await reader.read();
  await reader.cancel();
  await Promise.all(later);
  assert.equal(model.state.cancelled, true, 'cancelled upstream, so the model stops writing');
  assert.equal(model.state.ended, false, 'not drained');
  assert.equal(later.length, 1, 'the settle is handed to waitUntil');
  assert.ok(read!.frames <= 1 && read!.usage === null);
});

function fakeAi(result: () => unknown) {
  const calls: { model: string; input: unknown; args: number }[] = [];
  return {
    calls,
    ai: {
      async run(model: string, input: unknown, ...rest: unknown[]) {
        calls.push({ model, input, args: 2 + rest.length });
        return result();
      },
    } as unknown as Ai,
  };
}

test('a metered model call holds its worst case, then settles to the usage its stream reports', async () => {
  const { db } = testDb();
  const { ai, calls } = fakeAi(() => modelSse('Answer.', 5, 'stop'));
  const input = { messages: [{ role: 'user', content: 'q'.repeat(3_000) }], max_tokens: ASK_MAX_TOKENS, stream: true };
  const stream = (await meteredAi(ai, db, () => NOV).run(GLM as keyof AiModels, input as never)) as ReadableStream<Uint8Array>;
  assert.equal(await used(db, 'neurons', '2026-11-05'), worstCaseNeurons(GLM, input), 'held while the answer streams');
  await new Response(stream).text();
  assert.equal(await used(db, 'neurons', '2026-11-05'), neuronsFor(GLM, 41, 300), 'settled to the usage frame');
  assert.equal(calls[0]!.args, 2, 'run(model, input): no options object, so no AI Gateway');
});

test('an abandoned answer is cancelled upstream and settles to its input, the output read and a margin', async () => {
  const { db } = testDb();
  const later: Promise<unknown>[] = [];
  const model = watched(modelSse('Abandoned half way. '.repeat(30), 3, 'stop'));
  const { ai } = fakeAi(() => model.out);
  const input = { messages: [{ role: 'user', content: 'q'.repeat(3_000) }], max_tokens: ASK_MAX_TOKENS, stream: true };
  const stream = (await meteredAi(ai, db, () => NOV, (promise) => later.push(promise)).run(GLM as keyof AiModels, input as never)) as ReadableStream<Uint8Array>;
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel();
  await Promise.all(later);
  assert.equal(model.state.cancelled, true);
  const settled = await used(db, 'neurons', '2026-11-05');
  assert.equal(settled, abandonedNeurons(GLM, input, { frames: 1, chars: 'hidden reasoning'.length }), 'one frame read: the reasoning delta');
  assert.ok(settled < worstCaseNeurons(GLM, input), 'well under the hold');
});

test('a model call that failed after it may have run (a timeout, a 5xx) keeps its hold', async () => {
  const { db } = testDb();
  for (const message of ['InferenceUpstreamError: 504 Gateway Timeout', 'network connection lost']) {
    const failing = meteredAi({ run: async () => Promise.reject(new Error(message)) } as unknown as Ai, db, () => NOV);
    await assert.rejects(failing.run(GLM as keyof AiModels, { messages: [] } as never));
  }
  assert.equal(await used(db, 'neurons', '2026-11-05'), 2 * worstCaseNeurons(GLM, { messages: [] }));
  assert.equal(refusedUnbilled(new Error('AiError: 3040: Capacity temporarily exceeded')), true);
  assert.equal(refusedUnbilled(new Error('400 Bad Request: invalid input')), true);
  assert.equal(refusedUnbilled(new Error('408 Request Timeout')), false);
});

test('a hold and its settle stay on the day of the hold, across midnight UTC', async () => {
  const { db } = testDb();
  let clock = new Date('2026-11-05T23:59:59Z');
  const { ai } = fakeAi(() => modelSse('Late answer.', 5, 'stop'));
  const stream = (await meteredAi(ai, db, () => clock).run(GLM as keyof AiModels, { messages: [], max_tokens: 100 } as never)) as ReadableStream<Uint8Array>;
  clock = new Date('2026-11-06T00:00:30Z');
  await new Response(stream).text();
  assert.equal(await used(db, 'neurons', '2026-11-05'), neuronsFor(GLM, 41, 300));
  assert.equal(await used(db, 'neurons', '2026-11-06'), 0);
});

test('a refused model call gives its hold back; a stream with no usage keeps the worst case', async () => {
  const { db } = testDb();
  const refused = meteredAi(
    { run: async () => Promise.reject(new Error('3040 capacity')) } as unknown as Ai,
    db,
    () => NOV,
  );
  await assert.rejects(refused.run(GLM as keyof AiModels, { messages: [] } as never), /capacity/);
  assert.equal(await used(db, 'neurons', '2026-11-05'), 0);
  const { ai } = fakeAi(() => modelSse('No usage frame.'));
  await new Response((await meteredAi(ai, db, () => NOV).run(GLM as keyof AiModels, { messages: [] } as never)) as ReadableStream).text();
  assert.equal(await used(db, 'neurons', '2026-11-05'), worstCaseNeurons(GLM, { messages: [] }));
});

test('a model call with no room left is refused before it reaches Workers AI', async () => {
  const { db } = testDb();
  await reserve(db, 'neurons', '2026-11-05', limitOf('neurons', '2026-11-05') - 10, 9_000);
  const { ai, calls } = fakeAi(() => modelSse('never'));
  await assert.rejects(meteredAi(ai, db, () => NOV).run(GLM as keyof AiModels, { messages: [] } as never), (error: unknown) => error instanceof BudgetExhausted && error.meter === 'neurons');
  assert.equal(calls.length, 0);
});

/** The account's analytics for the earlier days of November in spend_account_days (migration 0011). */
function accountDays(db: D1Database, days: Record<string, number>): Promise<unknown> {
  return db.batch(Object.entries(days).map(([day, n]) => db.prepare('INSERT INTO spend_account_days (day, neurons, read_at) VALUES (?1, ?2, ?3)').bind(day, n, '2026-11-05T00:10:00Z')));
}

test("with every earlier day of the month in the analytics, the Workers' day runs past 9,000 on the paid month", async () => {
  const { db } = testDb();
  await reserve(db, 'neurons', '2026-11-05', 9_000, 9_000);
  const { ai, calls } = fakeAi(() => ({ data: [[0.1]], usage: { neurons: 3 } }));
  // 11-03 is missing: the paid month is unknown, and the free day is spent.
  await accountDays(db, { '2026-11-01': 0, '2026-11-02': 0, '2026-11-04': 0 });
  assert.equal(await monthPaid(db, '2026-11-05'), null);
  await assert.rejects(meteredAi(ai, db, () => NOV).run('@cf/qwen/qwen3-embedding-0.6b' as keyof AiModels, { text: ['x'] } as never), BudgetExhausted);
  assert.equal(calls.length, 0);
  await accountDays(db, { '2026-11-03': 4_641 });
  assert.equal(await monthPaid(db, '2026-11-05'), 0);
  await meteredAi(ai, db, () => NOV).run('@cf/qwen/qwen3-embedding-0.6b' as keyof AiModels, { text: ['x'] } as never);
  assert.equal(calls.length, 1);
  assert.equal(await used(db, 'neurons', '2026-11-05'), 9_003);
  assert.equal(await shortMeter(db, { neurons: 745 }, NOV), null);
});

test("the Workers stop at the paid month's $9.00: what is left of it is all the day may use past 9,000", async () => {
  const { db } = testDb();
  // D1 counted 11-02 higher than the analytics: the larger count is what the day used.
  await accountDays(db, { '2026-11-01': 0, '2026-11-02': 10_000, '2026-11-03': 0, '2026-11-04': 0 });
  await reserve(db, 'neurons', '2026-11-02', 10_000 + PAID_STOP_NEURONS.worker - 500, Number.MAX_SAFE_INTEGER);
  assert.equal(await monthPaid(db, '2026-11-05'), PAID_STOP_NEURONS.worker - 500);
  await reserve(db, 'neurons', '2026-11-05', 9_000, 9_000);
  assert.equal(await shortMeter(db, { neurons: 500 }, NOV), null);
  assert.equal(await shortMeter(db, { neurons: 501 }, NOV), 'neurons');
});

test("a metered binding reads the paid month once per day, so a turn's many calls share one read", async () => {
  const { db } = testDb();
  await accountDays(db, { '2026-11-01': 0, '2026-11-02': 0, '2026-11-03': 0, '2026-11-04': 0 });
  let reads = 0;
  const counting = new Proxy(db, {
    get: (target, key) => (key === 'prepare' ? (sql: string) => (sql.includes('spend_account_days') && (reads += 1), target.prepare(sql)) : Reflect.get(target, key)),
  });
  const { ai } = fakeAi(() => ({ data: [[0.1]], usage: { neurons: 3 } }));
  let clock = NOV;
  const metered = meteredAi(ai, counting, () => clock);
  for (let call = 0; call < 3; call += 1) await metered.run('@cf/qwen/qwen3-embedding-0.6b' as keyof AiModels, { text: ['x'] } as never);
  assert.equal(reads, 1, 'three calls, one read');
  clock = new Date('2026-11-06T00:01:00Z');
  await metered.run('@cf/qwen/qwen3-embedding-0.6b' as keyof AiModels, { text: ['x'] } as never);
  assert.equal(reads, 2, 'a new day reads again');
  await meteredAi(ai, counting, () => clock).run('@cf/qwen/qwen3-embedding-0.6b' as keyof AiModels, { text: ['x'] } as never);
  assert.equal(reads, 3, 'and so does the next request\'s binding');
});

test('without spend_account_days (migration 0011 not applied) the paid month is unknown and the free 9,000 stands', async () => {
  const { db } = testDb();
  await db.prepare('DROP TABLE spend_account_days').run();
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    assert.equal(await monthPaid(db, '2026-11-05'), null);
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, [['spend_paid_unknown', 'Error']]);
  await reserve(db, 'neurons', '2026-11-05', 8_500, 9_000);
  assert.equal(await shortMeter(db, { neurons: 501 }, NOV), 'neurons');
});

test('a non-streamed result settles from its usage too', async () => {
  const { db } = testDb();
  const { ai } = fakeAi(() => ({ data: [[0.1]], usage: { neurons: 3.2 } }));
  await meteredAi(ai, db, () => NOV).run('@cf/qwen/qwen3-embedding-0.6b' as keyof AiModels, { text: ['x'] } as never);
  assert.equal(await used(db, 'neurons', '2026-11-05'), 4);
});

test('each search counts one semantic query and is refused once the month has none left', async () => {
  const { db } = testDb();
  let searches = 0;
  const search = meteredSearch({ search: async () => ((searches += 1), { search_query: '', chunks: [] }) } as never, db, () => NOV);
  await search.search({ query: 'a' });
  await search.search({ query: 'b' });
  assert.equal(await used(db, 'search_semantic', '2026-11'), 2);
  const limit = limitOf('search_semantic', '2026-11');
  await reserve(db, 'search_semantic', '2026-11', limit - 2, limit);
  await assert.rejects(search.search({ query: 'c' }), BudgetExhausted);
  assert.equal(searches, 2, 'the refused search never ran');
});

test('in October 2026 AI Search is not billed yet: searches are counted and never refused', async () => {
  const { db } = testDb();
  const oct = new Date('2026-10-20T00:00:00Z');
  await reserve(db, 'search_semantic', '2026-10', 5_000, limitOf('search_semantic', '2026-10'));
  const search = meteredSearch({ search: async () => ({ search_query: '', chunks: [] }) } as never, db, () => oct);
  await search.search({ query: 'a' });
  assert.equal(await used(db, 'search_semantic', '2026-10'), 5_001);
});

test('shortMeter names the first meter without room, reading only', async () => {
  const { db } = testDb();
  assert.equal(await shortMeter(db, { neurons: 745, search_semantic: 1 }, NOV), null);
  await reserve(db, 'neurons', '2026-11-05', 8_300, 9_000);
  assert.equal(await shortMeter(db, { neurons: 745, search_semantic: 1 }, NOV), 'neurons');
  assert.equal(await used(db, 'neurons', '2026-11-05'), 8_300);
});

test('withSpendGuards meters only the billed bindings that are there', () => {
  const { db } = testDb();
  const env = { DB: db, AI: { run: async () => null }, SEARCH: { search: async () => null }, FILES: 'files' };
  const guarded = withSpendGuards(env as never) as Record<string, unknown>;
  assert.notEqual(guarded.AI, env.AI);
  assert.notEqual(guarded.SEARCH, env.SEARCH);
  assert.equal(guarded.FILES, 'files');
  assert.equal('LAW_SEARCH' in guarded, false);
});

test('withSpendGuards refuses billed bindings on a local host only when not opted in', async () => {
  const { db } = testDb();
  const env = { DB: db, AI: { run: async () => null }, SEARCH: { search: async () => ({ chunks: [] }) } };
  const off = withSpendGuards(env as never, { local: true }) as unknown as typeof env;
  await assert.rejects(off.SEARCH.search(), LocalSpendOff);
  await assert.rejects(off.AI.run(), LocalSpendOff);
  const on = withSpendGuards({ ...env, LEGALLAS_DEV_REMOTE_AI: '1' } as never, { local: true, now: () => NOV }) as unknown as typeof env;
  await on.SEARCH.search();
  assert.equal(await used(db, 'search_semantic', '2026-11'), 1);
  assert.equal(isLocalRequest(new Request('http://localhost:8789/api/ask')), true);
  assert.equal(isLocalRequest(new Request('https://room.example.com/api/ask')), false);
});

test('legallas_search answers search_budget when the month has no searches left', async () => {
  const { db, sqlite } = testDb();
  const props: Props = { email: 'counsel@example.test', role: 'counsel', clientId: 'c', clientName: 'Claude' };
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', 'Counsel')").run(props.email);
  sqlite.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('search_semantic', '2026-11', ?)").run(limitOf('search_semantic', '2026-11'));
  let searched = false;
  const env = { DB: db, SEARCH: { search: async () => ((searched = true), { chunks: [] }) } } as unknown as McpEnv;
  const result = await runTool(searchTool, { query: 'zebra', limit: 5 }, withSpendGuards(env, { now: () => NOV }), props, undefined, NOV);
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /search_budget: The counsel room has used this month's search allowance/);
  assert.equal(searched, false);
});

test('without its counters, legallas_search fails closed with internal_error and never searches', async () => {
  const { db, sqlite } = testDb();
  const props: Props = { email: 'counsel@example.test', role: 'counsel', clientId: 'c', clientName: 'Claude' };
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', 'Counsel')").run(props.email);
  sqlite.exec('DROP TABLE spend_counters');
  let searched = false;
  const env = { DB: db, SEARCH: { search: async () => ((searched = true), { chunks: [] }) } } as unknown as McpEnv;
  const result = await runTool(searchTool, { query: 'zebra', limit: 5 }, withSpendGuards(env, { now: () => NOV }), props, undefined, NOV);
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /internal_error/);
  assert.equal(searched, false);
});

test('from localhost without the opt-in, legallas_search answers dev_remote_ai_off and never searches', async () => {
  const { db, sqlite } = testDb();
  const props: Props = { email: 'counsel@example.test', role: 'counsel', clientId: 'c', clientName: 'Claude' };
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', 'Counsel')").run(props.email);
  let searched = false;
  const env = { DB: db, SEARCH: { search: async () => ((searched = true), { chunks: [] }) } } as unknown as McpEnv;
  const result = await runTool(searchTool, { query: 'zebra', limit: 5 }, withSpendGuards(env, { local: true }), props, undefined, NOV);
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /dev_remote_ai_off/);
  assert.equal(searched, false);
});
