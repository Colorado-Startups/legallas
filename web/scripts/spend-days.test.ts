// SPDX-License-Identifier: Apache-2.0
// npm run spend:days (scripts/spend-days.ts) on fake analytics and a real SQLite copy of the schema: the backfill of the
// month's whole days, what it prints, and its loud failures.
import '../worker/paid-month-ten.testkit.ts'; // first: a room with a $10 paid month
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { accountDaysSql, countersSql, parseAccountDays, parseCounters, recordDaysSql, type Reading } from './spend-guard.ts';
import { recordMonthDays, type DaysDeps } from './spend-days.ts';

function schema(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, file), 'utf8'));
  return db;
}

const zero = { neurons: 0, search_semantic: 0, search_fulltext: 0, search_ingest_tokens: 0 };

/** The script's deps over real SQL, with the analytics' days the test sets; `writes` counts the recording statements. */
function harness(days: Record<string, number> | undefined) {
  const db = schema();
  const state = { writes: 0, analyticsFail: false, writeFails: false };
  const deps: DaysDeps = {
    analytics: async (): Promise<Reading> => {
      if (state.analyticsFail) throw new Error('analytics_http_403');
      return days ? { ...zero, neuronDays: { ...days } } : { ...zero };
    },
    counters: async (now) => parseCounters(db.prepare(countersSql(now)).all() as Record<string, unknown>[], now),
    recorded: async (now) => parseAccountDays(db.prepare(accountDaysSql(now)).all() as Record<string, unknown>[]),
    recordDays: async (record, readAt) => {
      if (state.writeFails) throw new Error('wrangler d1 execute failed');
      state.writes += 1;
      db.prepare(recordDaysSql(record, readAt)).run();
    },
  };
  return { db, state, deps };
}

const NOV_5 = new Date('2026-11-05T00:40:00Z');
const FOUR_DAYS = { '2026-11-01': 0, '2026-11-02': 4_641, '2026-11-03': 25_000, '2026-11-04': 1_200 };

test('the backfill records every whole earlier day of the month, says how many were missing, and the paid spend', async () => {
  const h = harness(FOUR_DAYS);
  // A lease recorded 11-01 and 11-02 already; 11-03 and 11-04 had no script run.
  h.db.prepare(recordDaysSql({ '2026-11-01': 0, '2026-11-02': 4_641 }, new Date('2026-11-03T00:10:00Z'))).run();
  const first = await recordMonthDays(h.deps, NOV_5);
  assert.equal(first.complete, true);
  assert.deepEqual(first.lines, [
    'Spend days for 2026-11: recorded 4 whole days; 2 of 4 were missing before.',
    'Paid neurons this month before 2026-11-05: 15,000 ($0.17 of the $9.00 stop; scripts stop at $3.00).',
  ]);
  const rows = h.db.prepare('SELECT day, neurons FROM spend_account_days ORDER BY day').all().map((row) => ({ ...row }));
  assert.deepEqual(rows, Object.entries(FOUR_DAYS).map(([day, neurons]) => ({ day, neurons })));
  // Run again: nothing missing, the same rows.
  const again = await recordMonthDays(h.deps, NOV_5);
  assert.match(again.lines[0]!, /0 of 4 were missing before/);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM spend_account_days').get()!.n, 4);
});

test("D1's own count of a day beats a lower analytics count in the paid spend it prints", async () => {
  const h = harness(FOUR_DAYS);
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', '2026-11-04', 40000)").run();
  const result = await recordMonthDays(h.deps, NOV_5);
  assert.match(result.lines[1]!, /Paid neurons this month before 2026-11-05: 45,000 \(\$0\.50 of the \$9\.00 stop/);
});

test('before yesterday has been over five minutes it stays missing, and the run fails loudly', async () => {
  const h = harness(FOUR_DAYS);
  const early = await recordMonthDays(h.deps, new Date('2026-11-05T00:02:00Z'));
  assert.equal(early.complete, false);
  assert.match(early.lines.join('\n'), /recorded 3 whole days[^]*Still missing: 2026-11-04 \(a day counts once it has been over 5 minutes\)\. The Workers keep to the free neurons\./);
});

test('on the 1st there is nothing to record, and nothing is read', async () => {
  const h = harness(undefined);
  h.state.analyticsFail = true;
  assert.deepEqual(await recordMonthDays(h.deps, new Date('2026-12-01T00:40:00Z')), { complete: true, lines: ['Spend days for 2026-12: no earlier day of the month yet.'] });
  assert.equal(h.state.writes, 0);
});

test('a failed analytics read, analytics without the days, or a failed write throws: nothing is reported as recorded', async () => {
  const failing = harness(FOUR_DAYS);
  failing.state.analyticsFail = true;
  await assert.rejects(recordMonthDays(failing.deps, NOV_5), /analytics_http_403/);
  await assert.rejects(recordMonthDays(harness(undefined).deps, NOV_5), /analytics_unreadable/);
  const unwritable = harness(FOUR_DAYS);
  unwritable.state.writeFails = true;
  await assert.rejects(recordMonthDays(unwritable.deps, NOV_5), /wrangler d1 execute failed/);
  assert.equal(unwritable.db.prepare('SELECT count(*) AS n FROM spend_account_days').get()!.n, 0);
});

test('a recorded day keeps the larger count when the analytics read lower later', async () => {
  const h = harness({ ...FOUR_DAYS, '2026-11-02': 100 });
  h.db.prepare(recordDaysSql({ '2026-11-02': 4_641 }, new Date('2026-11-03T00:10:00Z'))).run();
  await recordMonthDays(h.deps, NOV_5);
  assert.equal(h.db.prepare("SELECT neurons FROM spend_account_days WHERE day = '2026-11-02'").get()!.neurons, 4_641);
});
