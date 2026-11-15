// SPDX-License-Identifier: Apache-2.0
// npm run spend:days: records the account's Workers AI neurons for every whole UTC day of this month in D1's
// spend_account_days (migration 0011), so the Workers can use the paid month (worker/budget.ts paidBefore; web/README.md
// "Spend budget"). The spend lease records them too, but only when a script runs; a room on the paid month runs this
// every day from a scheduled job of its own, so no day of the month goes unrecorded.
//
// It reads the GraphQL analytics and D1 and writes one statement: no model call, nothing spent. It prints days and
// counts only, and exits 1 when any earlier day of the month is still missing from D1 afterwards, or a read or the
// write fails. The token is wrangler's (CLOUDFLARE_API_TOKEN in the workflow: Account Analytics Read and D1 Edit).
import { earlierDaysOfMonth, paidBefore, PAID_SCRIPTS_USD, PAID_STOP_NEURONS, periodOf, usdForNeurons } from '../worker/budget.ts';
import { accountId } from './wrangler.ts';
import { wranglerTokens } from './law/replica.ts';
import { d1AccountDays, d1Counters, graphqlAnalytics, wholeDays, type Reading } from './spend-guard.ts';

export interface DaysDeps {
  /** The analytics: the month's earlier days among them. */
  analytics(now: Date): Promise<Reading>;
  /** spend_counters: Legallas's own count of the month's earlier days. */
  counters(now: Date): Promise<Reading>;
  /** spend_account_days for the month's earlier days. */
  recorded(now: Date): Promise<Record<string, number>>;
  recordDays(days: Record<string, number>, readAt: Date): Promise<void>;
}

/** What a run did, as lines of days and counts, and whether every earlier day of the month is now recorded. */
export interface DaysResult {
  complete: boolean;
  lines: string[];
}

const count = (n: number) => n.toLocaleString('en-US');
/** Dollars for `neurons` paid neurons, rounded up to the cent: spend is never shown smaller than it was. */
const dollars = (neurons: number) => (Math.ceil(usdForNeurons(neurons) * 100 - 1e-9) / 100).toFixed(2);

/** Records every whole earlier day of `now`'s month, then reads them back. Throws when a read or the write fails. */
export async function recordMonthDays(deps: DaysDeps, now: Date): Promise<DaysResult> {
  const today = periodOf('neurons', now);
  const month = today.slice(0, 7);
  const earlier = earlierDaysOfMonth(today);
  if (earlier.length === 0) return { complete: true, lines: [`Spend days for ${month}: no earlier day of the month yet.`] };
  const reading = await deps.analytics(now);
  if (!reading.neuronDays) throw new Error('analytics_unreadable');
  const whole = wholeDays(reading.neuronDays, now);
  const before = await deps.recorded(now);
  const missing = earlier.filter((day) => !(day in before));
  if (Object.keys(whole).length > 0) await deps.recordDays(whole, now);
  const after = await deps.recorded(now);
  const absent = earlier.filter((day) => !(day in after));
  const lines = [`Spend days for ${month}: recorded ${Object.keys(whole).length} whole days; ${missing.length} of ${earlier.length} were missing before.`];
  if (absent.length > 0) {
    lines.push(`Still missing: ${absent.join(', ')} (a day counts once it has been over 5 minutes). The Workers keep to the free neurons.`);
    return { complete: false, lines };
  }
  const paid = paidBefore(today, (await deps.counters(now)).neuronDays ?? {}, after);
  lines.push(
    paid === null
      ? 'Paid neurons this month: unknown.'
      : `Paid neurons this month before ${today}: ${count(paid)} ($${dollars(paid)} of the $${dollars(PAID_STOP_NEURONS.worker)} stop; scripts stop at $${PAID_SCRIPTS_USD.toFixed(2)}).`,
  );
  return { complete: true, lines };
}

async function main(): Promise<void> {
  const tokens = wranglerTokens();
  const account = await accountId();
  const result = await recordMonthDays({ analytics: graphqlAnalytics(account, tokens), ...d1Counters(), recorded: d1AccountDays() }, new Date());
  for (const line of result.lines) console.log(line);
  if (!result.complete) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`Spend days failed: ${error instanceof Error ? error.message.slice(0, 120) : 'error'}`);
    process.exitCode = 1;
  });
}
