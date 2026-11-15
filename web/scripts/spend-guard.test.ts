// SPDX-License-Identifier: Apache-2.0
// The scripts' spend lease (scripts/spend-guard.ts) on fake analytics and a real SQLite copy of the schema: steps
// reserved in D1, stops that name what was left, spend the counters cannot see, and the literal D1 statements.
import '../worker/paid-month-ten.testkit.ts'; // first: a room with a $10 paid month
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { limitOf, PAID_STOP_NEURONS } from '../worker/budget.ts';
import {
  adjustSql,
  countersSql,
  d1Counters,
  holdIngestion,
  parseCounters,
  parseUsage,
  RECHECK_MS,
  recordDaysSql,
  reserveSql,
  SpendLease,
  SpendStop,
  sseUsage,
  STEP,
  usageVariables,
  type Reading,
  type Totals,
} from './spend-guard.ts';

const NOV = new Date('2026-11-05T12:00:00Z');
const zero = (): Totals => ({ neurons: 0, search_semantic: 0, search_fulltext: 0, search_ingest_tokens: 0 });

function schema(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, file), 'utf8'));
  return db;
}

/** A lease over a real spend_counters table (the literal SQL runs on it) and analytics the test sets. */
function harness(start = NOV, settleWaitMs?: number) {
  const db = schema();
  const clock = { now: start };
  const analytics: { totals: Totals; days?: Record<string, number>; reads: number; fail: boolean; recordFails?: boolean } = { totals: zero(), reads: 0, fail: false };
  const lines: string[] = [];
  const deps = {
    analytics: async (): Promise<Reading> => {
      analytics.reads += 1;
      if (analytics.fail) throw new Error('analytics_http_429');
      return analytics.days ? { ...analytics.totals, neuronDays: { ...analytics.days } } : { ...analytics.totals };
    },
    counters: async (now: Date) => parseCounters(db.prepare(countersSql(now)).all() as Record<string, unknown>[], now),
    reserve: async (meter: never, period: string, amount: number, limit: number) => amount <= limit && db.prepare(reserveSql(meter, period, amount, limit)).all().length > 0,
    adjust: async (meter: never, period: string, delta: number) => void db.prepare(adjustSql(meter, period, delta)).run(),
    recordDays: async (days: Record<string, number>, readAt: Date) => {
      if (analytics.recordFails) throw new Error('wrangler d1 execute failed');
      db.prepare(recordDaysSql(days, readAt)).run();
    },
    now: () => clock.now,
    log: (line: string) => lines.push(line),
    settleWaitMs,
  };
  const used = (meter: string, period: string) => (db.prepare('SELECT used FROM spend_counters WHERE meter = ? AND period = ?').get(meter, period) as { used: number } | undefined)?.used ?? 0;
  return { db, clock, analytics, lines, lease: new SpendLease(deps, 'eval:test'), used };
}

const SCRIPT_LIMIT = limitOf('neurons', '2026-11-05', 'script');

test('a short hold reserves one step in D1, and later calls run on it without reading anything', async () => {
  const h = harness();
  const ticket = await h.lease.take('neurons', 1_000);
  assert.equal(h.used('neurons', '2026-11-05'), 1_000 + STEP.neurons);
  assert.equal(h.analytics.reads, 1);
  h.lease.done(ticket, 260);
  await h.lease.take('neurons', 1_000);
  assert.equal(h.analytics.reads, 1, 'within the hold and within RECHECK_MS: no new read');
  assert.equal(h.used('neurons', '2026-11-05'), 3_000);
});

test('close gives back what the run held and did not spend', async () => {
  const h = harness();
  const a = await h.lease.take('neurons', 1_000);
  h.lease.done(a, 260);
  await h.lease.close();
  assert.equal(h.used('neurons', '2026-11-05'), 260);
  await h.lease.close();
  assert.equal(h.used('neurons', '2026-11-05'), 260, 'safe to repeat');
  assert.equal(h.lease.spentSoFar().neurons, 260);
});

test('the run stops when the counters leave no room, says what was left, and every later call stops too', async () => {
  const h = harness();
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', '2026-11-05', ?)").run(SCRIPT_LIMIT - 500);
  await assert.rejects(h.lease.take('neurons', 1_000), (error: unknown) => {
    assert.ok(error instanceof SpendStop);
    assert.equal(error.meter, 'neurons');
    assert.match(error.message, /eval:test needs 1,000 more neurons, and scripts have 500 left for 2026-11-05/);
    assert.match(error.message, /resets at midnight UTC/);
    return true;
  });
  assert.ok(h.lease.stopped());
  await assert.rejects(h.lease.take('neurons', 1), SpendStop);
  assert.equal(h.used('neurons', '2026-11-05'), SCRIPT_LIMIT - 500, 'nothing reserved');
});

test('spend only the analytics show (another tool on the account) stops the run even when D1 has room', async () => {
  const h = harness();
  h.analytics.totals.neurons = SCRIPT_LIMIT - 200;
  await assert.rejects(h.lease.take('neurons', 1_000), SpendStop);
});

test("analytics are read again every RECHECK_MS, and the run's own spend counts once whether they show it yet or not", async () => {
  const h = harness();
  const first = await h.lease.take('neurons', 1_000);
  h.lease.done(first, 900);
  h.clock.now = new Date(NOV.getTime() + RECHECK_MS + 1);
  // The analytics have caught up: they show this run's 900 and another caller's spend. Counted once, 1,000 more fits.
  h.analytics.totals.neurons = 900 + (SCRIPT_LIMIT - 2_500);
  const second = await h.lease.take('neurons', 1_000);
  assert.equal(h.analytics.reads, 2);
  h.lease.done(second, 1_000);
  h.clock.now = new Date(NOV.getTime() + 2 * RECHECK_MS + 2);
  // They show the second call too: the account is at limit - 600, so another 1,000 is past it.
  h.analytics.totals.neurons = 1_900 + (SCRIPT_LIMIT - 2_500);
  await assert.rejects(h.lease.take('neurons', 1_000), SpendStop);
  assert.equal(h.analytics.reads, 3);
});

test('analytics that show part of the run do not count it twice (2026-11-01: 4,649 spent, stopped as if at the limit)', async () => {
  const h = harness();
  assert.equal(SCRIPT_LIMIT, 7_000);
  const spent = await h.lease.take('neurons', 4_649);
  h.lease.done(spent, 4_649);
  h.clock.now = new Date(NOV.getTime() + RECHECK_MS + 1);
  // Two of the run's three minutes are in the analytics; the account's use is the run's 4,649, not 2,417 + 4,649.
  h.analytics.totals.neurons = 2_417;
  h.lease.done(await h.lease.take('neurons', 1_000), 1_000);
  assert.equal(h.lease.stopped(), null);
  // The run's 5,649 leaves 1,351: its whole spend counts while the analytics lag, and only once.
  await assert.rejects(h.lease.take('neurons', 1_352), /needs 352 more neurons, and scripts have 351 left/);
});

test("a new UTC day starts the account's use from that day's analytics, not the old day's", async () => {
  const h = harness(new Date('2026-11-05T23:59:00Z'));
  h.analytics.totals.neurons = SCRIPT_LIMIT - 1_500;
  h.lease.done(await h.lease.take('neurons', 1_000), 1_000);
  h.clock.now = new Date('2026-11-06T00:01:00Z');
  // The new day's analytics show nothing yet. Carried over, the old day's base (limit - 1,500) would refuse this.
  h.analytics.totals.neurons = 0;
  await h.lease.take('neurons', SCRIPT_LIMIT - 1_000);
  assert.equal(h.lease.stopped(), null);
  assert.equal(h.used('neurons', '2026-11-05'), 1_000, 'the old day settled to what it spent');
});

test("a take blocked only by the run's own calls in flight waits for one to settle, then goes on", async () => {
  const h = harness();
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', '2026-11-05', ?)").run(SCRIPT_LIMIT - 3_000);
  const a = await h.lease.take('neurons', 1_500);
  await h.lease.take('neurons', 1_000);
  // 1,500 + 1,000 held of the 3,000 reserved: a third worst case does not fit while both run.
  const third = h.lease.take('neurons', 1_000);
  h.lease.done(a, 300);
  await third;
  assert.equal(h.lease.stopped(), null);
  assert.equal(h.used('neurons', '2026-11-05'), SCRIPT_LIMIT, 'nothing reserved past the limit');
});

test('a take waits at most settleWaitMs for a call that never settles, then stops the run', async () => {
  const h = harness(NOV, 20);
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', '2026-11-05', ?)").run(SCRIPT_LIMIT - 2_000);
  await h.lease.take('neurons', 1_500);
  await assert.rejects(h.lease.take('neurons', 1_000), /needs 500 more neurons, and scripts have 0 left/);
  assert.ok(h.lease.stopped());
});

test('a failed analytics read stops the run: the guard fails closed', async () => {
  const h = harness();
  h.analytics.fail = true;
  await assert.rejects(h.lease.take('neurons', 10), /the Cloudflare analytics did not answer \(analytics_http_429\)/);
});

test('a new UTC day settles the old one and starts a fresh hold', async () => {
  const h = harness(new Date('2026-11-05T23:59:00Z'));
  const late = await h.lease.take('neurons', 1_000);
  h.lease.done(late, 100);
  h.clock.now = new Date('2026-11-06T00:01:00Z');
  await h.lease.take('neurons', 1_000);
  assert.equal(h.used('neurons', '2026-11-05'), 100, 'what the old day did not spend went back');
  assert.equal(h.used('neurons', '2026-11-06'), 1_000 + STEP.neurons);
});

test('metered fetch counts each search; a refused one (4xx) costs nothing, one that failed without an answer still counts', async () => {
  const h = harness();
  const statuses = [200, 200, 403];
  const fetcher = h.lease.meter((async () => new Response('{}', { status: statuses.shift() })) as unknown as typeof fetch);
  await fetcher('https://example.test');
  await fetcher('https://example.test');
  await fetcher('https://example.test');
  const failing = h.lease.meter((async () => Promise.reject(new Error('network'))) as unknown as typeof fetch);
  await assert.rejects(failing('https://example.test'), /network/);
  assert.equal(h.lease.spentSoFar().search_semantic, 3, 'two answered, one refused (403), one timed out (it may have run)');
});

test('AI Search is unbilled in October 2026: a script may search freely, and from November it may not past its limit', async () => {
  const oct = harness(new Date('2026-10-20T12:00:00Z'));
  oct.analytics.totals.search_semantic = 7_816;
  await oct.lease.take('search_semantic', 1);
  const nov = harness();
  nov.analytics.totals.search_semantic = limitOf('search_semantic', '2026-11', 'script');
  await assert.rejects(nov.lease.take('search_semantic', 1), /on the 1st of next month/);
});

test('check() refuses without reserving, reads the counters every time and the analytics at most every RECHECK_MS', async () => {
  const h = harness();
  await h.lease.check({ neurons: 1_200, search_semantic: 4 });
  assert.equal(h.used('neurons', '2026-11-05'), 0);
  // The room's own Ask counted 6,000 since: the counters show it at once.
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', '2026-11-05', ?)").run(SCRIPT_LIMIT - 1_000);
  await assert.rejects(h.lease.check({ neurons: 1_200 }), SpendStop);
  assert.equal(h.analytics.reads, 1);
});

test('ingestion: the hold is the estimate, it stays in D1, and a spent month refuses even an upload of nothing new', async () => {
  const h = harness();
  const tokens = await holdIngestion(h.lease, 30_000);
  assert.equal(tokens, 10_000);
  await h.lease.close();
  assert.equal(h.used('search_ingest_tokens', '2026-11'), 10_000);
  const spent = harness();
  spent.analytics.totals.search_ingest_tokens = limitOf('search_ingest_tokens', '2026-11', 'script') + 1;
  await assert.rejects(holdIngestion(spent.lease, 0), SpendStop);
});

// --- Cloudflare pieces --------------------------------------------------------------------------------------

test('the analytics query asks for today and this month, and parsing fails closed on an error', () => {
  assert.deepEqual(usageVariables('a'.repeat(32), NOV), { account: 'a'.repeat(32), day: '2026-11-05', from: '2026-11-01' });
  const body = {
    data: {
      viewer: {
        accounts: [
          {
            neurons: [{ sum: { totalNeurons: 254.2 } }],
            days: [
              { dimensions: { date: '2026-11-02' }, sum: { totalNeurons: 4_641.3 } },
              { dimensions: { date: '2026-11-04' }, sum: { totalNeurons: 12_500 } },
            ],
            semantic: [{ count: 7816 }],
            fulltext: [],
            ingest: [{ sum: { tokens: 26_801_247 } }],
            image: [{ sum: { tokens: 3 } }],
          },
        ],
      },
    },
  };
  assert.deepEqual(parseUsage(body), { neurons: 255, search_semantic: 7816, search_fulltext: 0, search_ingest_tokens: 26_801_250 });
  // With today, every earlier day of the month: one with no usage has no row, so it is 0.
  assert.deepEqual(parseUsage(body, '2026-11-05').neuronDays, { '2026-11-01': 0, '2026-11-02': 4_642, '2026-11-03': 0, '2026-11-04': 12_500 });
  assert.deepEqual(parseUsage(body, '2026-11-01').neuronDays, {}, 'the 1st has no earlier days');
  const badDay = structuredClone(body);
  (badDay.data.viewer.accounts[0] as Record<string, unknown>).days = [{ dimensions: { date: 'yesterday' }, sum: { totalNeurons: 1 } }];
  assert.throws(() => parseUsage(badDay, '2026-11-05'), /analytics_unreadable/, 'a day that is not a date');
  assert.throws(() => parseUsage({ errors: [{ message: 'rate limited' }] }), /analytics_error/);
  // A partial answer never reads as zero.
  assert.throws(() => parseUsage({ data: { viewer: { accounts: [{}] } } }), /analytics_unreadable/);
  const partial = structuredClone(body);
  delete (partial.data.viewer.accounts[0] as Record<string, unknown>).image;
  assert.throws(() => parseUsage(partial), /analytics_unreadable/, 'a missing alias');
  const noDays = structuredClone(body);
  delete (noDays.data.viewer.accounts[0] as Record<string, unknown>).days;
  assert.throws(() => parseUsage(noDays), /analytics_unreadable/, 'the days alias missing');
  const nullSum = structuredClone(body);
  (nullSum.data.viewer.accounts[0] as Record<string, unknown>).neurons = [{ sum: null }];
  assert.throws(() => parseUsage(nullSum), /analytics_unreadable/, 'sum: null');
  const text = structuredClone(body);
  (text.data.viewer.accounts[0] as Record<string, unknown>).semantic = [{ count: '7816' }];
  assert.throws(() => parseUsage(text), /analytics_unreadable/, 'a figure that is not a number');
  const none = { data: { viewer: { accounts: [{ neurons: [], days: [], semantic: [], fulltext: [], ingest: [], image: [] }] } } };
  assert.deepEqual(parseUsage(none), { neurons: 0, search_semantic: 0, search_fulltext: 0, search_ingest_tokens: 0 }, 'no rows is no usage');
  assert.throws(() => parseUsage({ data: { viewer: { accounts: [] } } }), /analytics_no_account/);
});

test('D1 statements carry fixed meter names and integers only', () => {
  assert.equal(
    reserveSql('neurons', '2026-11-05', 2_500, 7_000),
    "INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', '2026-11-05', 2500) ON CONFLICT (meter, period) DO UPDATE SET used = used + 2500 WHERE used + 2500 <= 7000 RETURNING used",
  );
  assert.throws(() => reserveSql("neurons'; DROP TABLE members; --" as never, '2026-11-05', 1, 2), /unknown meter/);
  assert.throws(() => reserveSql('neurons', "2026-11-05' OR 1", 1, 2), /bad period/);
  assert.throws(() => reserveSql('neurons', '2026-11-05', 1.5, 2), /integers/);
  assert.throws(() => reserveSql('neurons', '2026-11-05', -1, 2), /non-negative/);
  assert.match(adjustSql('search_semantic', '2026-11', -40), /SET used = MAX\(0, used \+ -40\) WHERE meter = 'search_semantic' AND period = '2026-11'$/);
  assert.equal(
    recordDaysSql({ '2026-11-01': 0, '2026-11-02': 4_641 }, new Date('2026-11-05T00:10:00Z')),
    "INSERT INTO spend_account_days (day, neurons, read_at) VALUES ('2026-11-01', 0, '2026-11-05T00:10:00.000Z'), ('2026-11-02', 4641, '2026-11-05T00:10:00.000Z') " +
      'ON CONFLICT (day) DO UPDATE SET neurons = MAX(neurons, excluded.neurons), read_at = excluded.read_at',
  );
  assert.throws(() => recordDaysSql({ "2026-11-01'); DROP TABLE members; --": 1 }, new Date()), /bad day/);
  assert.throws(() => recordDaysSql({ '2026-11-01': 1.5 }, new Date()), /integers/);
  assert.match(countersSql(NOV), /OR \(meter = 'neurons' AND period >= '2026-11-01' AND period < '2026-11-05'\)$/);
});

test('d1Counters runs wrangler d1 execute against production with the statement as its one argument', async () => {
  const calls: string[][] = [];
  let rows: unknown[] = [{ used: 3 }];
  const run = async (args: string[]) => {
    calls.push(args);
    return JSON.stringify([{ success: true, results: rows }]);
  };
  const d1 = d1Counters(run);
  assert.equal(await d1.reserve('neurons', '2026-11-05', 3, 10), true);
  rows = [];
  assert.equal(await d1.reserve('neurons', '2026-11-05', 30, 40), false, 'no row returned: past the limit');
  assert.equal(await d1.reserve('neurons', '2026-11-05', 50, 40), false);
  assert.equal(calls.length, 2, 'an amount past the limit never reaches D1');
  assert.deepEqual(calls[0]!.slice(0, 6), ['d1', 'execute', 'legallas', '--remote', '--json', '--command']);
  assert.equal(calls[0]!.length, 7);
});

test('parseCounters reads each meter for its own period only', () => {
  const rows = [
    { meter: 'neurons', period: '2026-11-05', used: 120 },
    { meter: 'neurons', period: '2026-11', used: 99_999 },
    { meter: 'search_semantic', period: '2026-11', used: 40 },
    { meter: 'search_semantic', period: '2026-11-05', used: 77 },
    { meter: 'neurons', period: '2026-11-02', used: 4_649 },
    { meter: 'neurons', period: '2026-10-31', used: 4_674 },
  ];
  assert.deepEqual(parseCounters(rows, NOV), {
    neurons: 120,
    search_semantic: 40,
    search_fulltext: 0,
    search_ingest_tokens: 0,
    neuronDays: { '2026-11-02': 4_649 },
  });
});

test('sseUsage finds the last usage frame of a Workers AI stream', () => {
  const raw = [
    'data: {"choices":[{"delta":{"content":"Hi"}}],"usage":null}',
    'data: {"response":"","usage":{"prompt_tokens":10,"completion_tokens":5,"neurons":1.5}}',
    'data: [DONE]',
  ].join('\n\n');
  assert.deepEqual(sseUsage(raw), { prompt_tokens: 10, completion_tokens: 5, neurons: 1.5 });
  assert.equal(sseUsage('data: {"choices":[]}'), null);
});

test("the month's paid neurons raise the scripts' limit by what is left of their $3.00 share", async () => {
  const h = harness();
  // 11-02 used 20,000 (10,000 paid); the other earlier days stayed free.
  h.analytics.days = { '2026-11-01': 0, '2026-11-02': 20_000, '2026-11-03': 9_000, '2026-11-04': 0 };
  h.lease.done(await h.lease.take('neurons', 100_000), 100_000);
  assert.equal(h.lease.stopped(), null);
  // Room to 7,000 + 272,727 - 10,000 = 269,727 today.
  await assert.rejects(h.lease.take('neurons', 169_728), /needs [\d,]+ more neurons, and the month's paid budget for scripts is used up \(\$3\.00 of \$10\.00 for 2026-11; the counsel room keeps the rest\)/);
});

test("once the month's paid spend reaches $3.00, everyone's, scripts keep to the free 7,000", async () => {
  const h = harness();
  // Ask spent 280,000 past the free neurons on 11-03: over the scripts' share, under the Workers' $9.00.
  h.analytics.days = { '2026-11-01': 0, '2026-11-02': 0, '2026-11-03': 290_000, '2026-11-04': 0 };
  await assert.rejects(h.lease.take('neurons', SCRIPT_LIMIT + 1), /the month's paid budget for scripts is used up/);
  const fresh = harness();
  fresh.analytics.days = h.analytics.days;
  fresh.lease.done(await fresh.lease.take('neurons', SCRIPT_LIMIT), SCRIPT_LIMIT);
});

test('D1 counts an earlier day higher than the analytics: the larger one is what the day used', async () => {
  const h = harness();
  h.analytics.days = { '2026-11-01': 0, '2026-11-02': 0, '2026-11-03': 0, '2026-11-04': 0 };
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', '2026-11-03', ?)").run(10_000 + PAID_STOP_NEURONS.script);
  await assert.rejects(h.lease.take('neurons', SCRIPT_LIMIT + 1), /paid budget for scripts is used up/);
});

test('without the earlier days in the analytics the paid month is unknown, and scripts keep to the free 7,000', async () => {
  const h = harness();
  await assert.rejects(h.lease.take('neurons', SCRIPT_LIMIT + 1), /scripts have 7,000 left for 2026-11-05 \(limit 7,000; 2,000 more stay for the counsel room\)/);
});

test("a new month starts the scripts' paid share again", async () => {
  const h = harness(new Date('2026-12-01T03:00:00Z'));
  h.analytics.days = {};
  // November's spend is not December's: on the 1st there are no earlier days, so nothing paid yet.
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', '2026-11-30', ?)").run(900_000);
  h.lease.done(await h.lease.take('neurons', 200_000), 200_000);
  assert.equal(h.lease.stopped(), null);
});

test('each fresh analytics read records the whole earlier days once; yesterday waits until it has settled', async () => {
  const h = harness(new Date('2026-11-05T00:02:00Z'));
  const recorded = () => h.db.prepare('SELECT day, neurons FROM spend_account_days ORDER BY day').all() as { day: string; neurons: number }[];
  h.analytics.days = { '2026-11-01': 0, '2026-11-02': 4_641, '2026-11-03': 0, '2026-11-04': 1_000 };
  h.lease.done(await h.lease.take('neurons', 100), 100);
  assert.deepEqual(recorded().map((r) => r.day), ['2026-11-01', '2026-11-02', '2026-11-03'], 'two minutes after midnight, 11-04 is not whole yet');
  h.clock.now = new Date('2026-11-05T00:10:00Z');
  h.analytics.days['2026-11-04'] = 1_200;
  h.lease.done(await h.lease.take('neurons', 100), 100);
  assert.deepEqual({ ...recorded().at(-1) }, { day: '2026-11-04', neurons: 1_200 });
  // A day already there keeps the larger count.
  h.db.prepare(recordDaysSql({ '2026-11-02': 10 }, new Date('2026-11-05T00:20:00Z'))).run();
  assert.equal(recorded()[1]!.neurons, 4_641);
});

test('a failed record is logged and the run goes on', async () => {
  const h = harness();
  h.analytics.days = { '2026-11-01': 0, '2026-11-02': 0, '2026-11-03': 0, '2026-11-04': 0 };
  h.analytics.recordFails = true;
  h.lease.done(await h.lease.take('neurons', 100), 100);
  assert.equal(h.lease.stopped(), null);
  assert.match(h.lines.join('\n'), /could not record the account's days in D1; the Workers keep to the free neurons/);
});

test('concurrent takes queue: a pool can never hold more than its D1 reservation', async () => {
  const h = harness();
  // Room for 3,000: the first take reserves 1,500 plus a 2,000 step, capped at the room.
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', '2026-11-05', ?)").run(SCRIPT_LIMIT - 3_000);
  const first = await h.lease.take('neurons', 1_500);
  h.lease.done(first, 1_500);
  // Past RECHECK_MS each take re-reads the analytics; slow reads widen the window a race would need.
  h.clock.now = new Date(NOV.getTime() + RECHECK_MS + 1);
  const takes = [h.lease.take('neurons', 1_000), h.lease.take('neurons', 1_000), h.lease.take('neurons', 1_000)];
  // The second waits for the first, which settles at its whole worst case, so neither of the others fits.
  h.lease.done(await takes[0]!, 1_000);
  const results = await Promise.allSettled(takes);
  const taken = results.filter((r) => r.status === 'fulfilled').length;
  assert.equal(taken, 1, 'only one more fits in the 3,000 reserved');
  assert.equal(h.used('neurons', '2026-11-05'), SCRIPT_LIMIT, 'nothing reserved past the limit');
  assert.ok(h.lease.stopped());
});
