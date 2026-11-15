// SPDX-License-Identifier: Apache-2.0
// The scripts' side of Legallas's spend budget (worker/budget.ts). Every eval, law and index script that calls Workers
// AI or AI Search over REST, or uploads text AI Search will ingest, runs under a SpendLease:
//
//   - Each call takes its worst case first (lease.take, or lease.meter for searches). Before the run passes what it
//     holds, the lease reads today's account-wide neurons and this month's AI Search use from the GraphQL Analytics
//     API (everything on the account, a few minutes late) and the room's spend_counters in D1 (the Workers and other
//     scripts, at once), and reserves another step in D1 only while the larger of the two leaves room under the
//     scripts' limit (the budget less its headroom). The Workers see that reservation at once.
//   - Between steps the analytics are read again every RECHECK_MS. They lag a minute or two, so the account's use is
//     the larger of what they show and what they showed before the run's first call plus all the run has spent since:
//     the run's own spend counts once, and spend the counters cannot see (another tool on the account) still stops
//     the run once the analytics show it.
//   - A take that does not fit only because this run's own calls are in flight, each holding its worst case, waits
//     for one to settle (usually for far less) and looks again, so a pool near the limit slows down instead of
//     stopping.
//   - When a call ends it is settled to what it cost; close() gives back what the run held and did not spend.
//   - Out of room, the lease throws SpendStop, and every later take throws it too, so a run stops cleanly.
//   - The neurons' limit rises past the scripts' free 7,000 by what is left of their paid share ($3.00 of the paid
//     month's $9.00, everyone's spend counted; worker/budget.ts neuronLimit), read from the analytics' and D1's counts
//     of the month's earlier days. Each fresh analytics read also records those days, once ended, in D1
//     (spend_account_days), so the Workers can use the paid month too.
//
// lease.check() is for scripts whose calls the Workers count themselves (eval:ask against production): it refuses
// without reserving. The token is wrangler's (scripts/law/replica.ts TokenSource), held in memory, never printed or
// put on a command line. D1 statements carry fixed meter names and integers only.
import { stat } from 'node:fs/promises';
import {
  BUDGET,
  earlierDaysOfMonth,
  ingestTokensFor,
  limitOf,
  METERS,
  neuronLimit,
  PAID_MONTHLY_USD,
  PAID_SCRIPTS_USD,
  paidBefore,
  periodOf,
  scriptRoom,
  type Meter,
} from '../worker/budget.ts';
import { withFreshToken, type TokenSource } from './law/replica.ts';
import { DATABASE, parseD1Json, wrangler, type WranglerRun } from './wrangler.ts';

export type Plan = Partial<Record<Meter, number>>;
export type Totals = Record<Meter, number>;
/** A read of every meter, and the neurons of each earlier day of the month (YYYY-MM-DD) when the source has them. */
export type Reading = Totals & { neuronDays?: Record<string, number> };

/** How often a long run reads the analytics again between D1 steps. */
export const RECHECK_MS = 120_000;
/** How long a take blocked by this run's own calls in flight waits for one to settle before it stops the run. */
export const SETTLE_WAIT_MS = 300_000;
/** How long after a UTC day ends its analytics count as whole, to be recorded in spend_account_days. */
export const DAY_SETTLE_MS = 5 * 60_000;
/** How much more than the shortfall a step reserves in D1, so a run does not stop for every call. */
export const STEP: Readonly<Record<Meter, number>> = { neurons: 2_000, search_semantic: 50, search_fulltext: 50, search_ingest_tokens: 0 };

const zero = (): Totals => ({ neurons: 0, search_semantic: 0, search_fulltext: 0, search_ingest_tokens: 0 });

/** The budget refused a run. The message says what, how much was left and when it resets; never a secret. */
export class SpendStop extends Error {
  override name = 'SpendStop';
  readonly meter: Meter;
  constructor(meter: Meter, message: string) {
    super(message);
    this.meter = meter;
  }
}

export interface SpendDeps {
  /** Account-wide usage from the analytics: today's neurons, this month's AI Search use, the month's earlier days. */
  analytics(now: Date): Promise<Reading>;
  /** spend_counters for today and this month, and the neurons of the month's earlier days. */
  counters(now: Date): Promise<Reading>;
  /** Records the account's neurons for whole days in spend_account_days (keeping the larger count). */
  recordDays?(days: Record<string, number>, readAt: Date): Promise<void>;
  /** Adds `amount` within `limit` in one statement; true when it did. */
  reserve(meter: Meter, period: string, amount: number, limit: number): Promise<boolean>;
  adjust(meter: Meter, period: string, delta: number): Promise<void>;
  now?: () => Date;
  log?: (line: string) => void;
  /** SETTLE_WAIT_MS unless set (tests). */
  settleWaitMs?: number;
}

export interface Ticket {
  meter: Meter;
  period: string;
  worst: number;
}

interface MeterState {
  period: string;
  granted: number;
  spent: number;
  inflight: number;
  /** What the analytics showed at the run's first call in this period, before it had spent anything here. */
  base: number | null;
}

const UNITS: Record<Meter, string> = {
  neurons: 'neurons',
  search_semantic: 'AI Search queries',
  search_fulltext: 'AI Search full-text queries',
  search_ingest_tokens: 'AI Search ingestion tokens',
};

function resetWhen(meter: Meter): string {
  return BUDGET[meter].per === 'day' ? 'at midnight UTC' : 'on the 1st of next month (UTC)';
}

/**
 * The days of `days` (the analytics' earlier days of the month) whole at `now`: every day before today, and yesterday
 * only once it has been over DAY_SETTLE_MS, so its count has caught up.
 */
export function wholeDays(days: Readonly<Record<string, number>>, now: Date): Record<string, number> {
  const today = periodOf('neurons', now);
  const midnight = Date.parse(`${today}T00:00:00Z`);
  const yesterday = new Date(midnight - 86_400_000).toISOString().slice(0, 10);
  const settled = now.getTime() - midnight >= DAY_SETTLE_MS;
  return Object.fromEntries(Object.entries(days).filter(([day]) => day < today && (day !== yesterday || settled)));
}

export class SpendLease {
  private readonly deps: Required<Pick<SpendDeps, 'now' | 'log'>> & SpendDeps;
  private readonly what: string;
  private readonly states = new Map<Meter, MeterState>();
  /** Takes waiting for a call of this run to settle, and how many calls have settled (a take looks again after one). */
  private waiters: (() => void)[] = [];
  private settles = 0;
  private seen: Reading | null = null;
  /** The paid neurons of the month's earlier days (budget.ts paidBefore) at the last read, or null when unknown. */
  private paid: number | null = null;
  /** The last day this lease recorded in spend_account_days. */
  private recordedThrough = '';
  private seenAt = 0;
  private halted: SpendStop | null = null;
  /** Takes run one at a time: a take that awaits a read must not let another pass the hold before it counts. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: SpendDeps, what: string) {
    this.deps = { now: () => new Date(), log: (line) => console.log(line), ...deps };
    this.what = what;
  }

  /** The SpendStop that ended this run, or null while it may go on. A method, so a check never narrows it. */
  stopped(): SpendStop | null {
    return this.halted;
  }

  /** What the run has spent so far, by meter. */
  spentSoFar(): Totals {
    const totals = zero();
    for (const [meter, state] of this.states) totals[meter] += state.spent;
    return totals;
  }

  // The stop messages and summary() print in the Replica eval workflow's log only when they match SAFE_LINES
  // (scripts/ask-eval-gate.ts); ask-eval-gate.test.ts runs a real lease, so a reworded message fails there.
  private halt(meter: Meter, period: string, need: number, room: number): SpendStop {
    const rule = BUDGET[meter];
    if (meter === 'neurons' && this.paid !== null) {
      this.halted ??= new SpendStop(
        meter,
        `Stopped by the spend budget: ${this.what} needs ${need.toLocaleString('en-US')} more neurons, and the month's paid budget for scripts ` +
          `is used up ($${PAID_SCRIPTS_USD.toFixed(2)} of $${PAID_MONTHLY_USD.toFixed(2)} for ${period.slice(0, 7)}; the counsel room keeps the rest). ` +
          'Free neurons reset at midnight UTC, the paid month on the 1st (UTC). Limits change only in review (web/README.md, "Spend budget").',
      );
      return this.halted;
    }
    this.halted ??= new SpendStop(
      meter,
      `Stopped by the spend budget: ${this.what} needs ${need.toLocaleString('en-US')} more ${UNITS[meter]}, and scripts have ` +
        `${Math.max(0, room).toLocaleString('en-US')} left for ${period} (limit ${this.scriptLimit(meter, period).toLocaleString('en-US')}; ` +
        `${rule.scriptHeadroom.toLocaleString('en-US')} more stay for the counsel room). It resets ${resetWhen(meter)}. ` +
        'Limits change only in review (web/README.md, "Spend budget").',
    );
    return this.halted;
  }

  private failed(meter: Meter, what: string): SpendStop {
    this.halted ??= new SpendStop(meter, `Stopped by the spend budget: ${what}, so the run cannot be checked against it. Nothing more was sent.`);
    return this.halted;
  }

  /** What `meter` may reach in `period` for scripts: the neurons' with their paid share when known (neuronLimit). */
  private scriptLimit(meter: Meter, period: string): number {
    return meter === 'neurons' ? neuronLimit(period, 'script', this.paid) : limitOf(meter, period, 'script');
  }

  /**
   * Records the analytics' whole days (ended DAY_SETTLE_MS ago) that this lease has not recorded yet. A failure is
   * logged and the run goes on: the Workers then simply keep to the free neurons.
   */
  private async record(days: Record<string, number>, now: Date): Promise<void> {
    if (!this.deps.recordDays) return;
    const whole = wholeDays(days, now);
    const last = Object.keys(whole).sort().at(-1);
    if (!last || last <= this.recordedThrough) return;
    try {
      await this.deps.recordDays(whole, now);
      this.recordedThrough = last;
    } catch {
      this.deps.log(`spend: could not record the account's days in D1; the Workers keep to the free neurons until a later run does.`);
    }
  }

  /** The analytics (read again only when older than RECHECK_MS, if `reuse`) and the D1 counters. */
  private async readBoth(now: Date, reuse = false): Promise<{ analytics: Reading; counters: Reading }> {
    let analytics: Reading;
    let counters: Reading;
    try {
      analytics = reuse && this.seen && now.getTime() - this.seenAt <= RECHECK_MS ? this.seen : await this.deps.analytics(now);
    } catch (error) {
      throw this.failed('neurons', `the Cloudflare analytics did not answer (${error instanceof Error ? error.message.slice(0, 60) : 'error'})`);
    }
    try {
      counters = await this.deps.counters(now);
    } catch (error) {
      throw this.failed('neurons', `D1's spend_counters could not be read (${error instanceof Error ? error.message.slice(0, 80) : 'error'}; is migration 0007 applied?)`);
    }
    if (analytics !== this.seen) {
      this.seen = analytics;
      this.seenAt = now.getTime();
      if (analytics.neuronDays) await this.record(analytics.neuronDays, now);
    }
    this.paid = analytics.neuronDays ? paidBefore(periodOf('neurons', now), counters.neuronDays ?? {}, analytics.neuronDays) : null;
    return { analytics, counters };
  }

  /**
   * The account's use of a meter in the state's period: what the analytics show, or what they showed before this run's
   * first call there plus all the run has spent since, whichever is more. The run's spend is in both once the analytics
   * catch up, so it is never added to them twice.
   */
  private accountUse(state: MeterState, analytics: number): number {
    state.base ??= analytics;
    return Math.max(analytics, state.base + state.spent);
  }

  /** Resolves true when a call of this run settles, or false after settleWaitMs. */
  private settled(): Promise<boolean> {
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter !== wake);
        resolve(false);
      }, this.deps.settleWaitMs ?? SETTLE_WAIT_MS);
      timer.unref?.();
      this.waiters.push(wake);
    });
  }

  private async state(meter: Meter, period: string): Promise<MeterState> {
    const state = this.states.get(meter);
    if (state && state.period === period) return state;
    // A new UTC day or month: what the old period held and did not spend goes back first.
    if (state) await this.release(meter, state);
    const fresh = { period, granted: 0, spent: 0, inflight: 0, base: null };
    this.states.set(meter, fresh);
    return fresh;
  }

  /**
   * Takes `worst` of `meter` for one call, reserving another step in D1 when the run's hold is short. Throws SpendStop
   * when the budget has no room, now and for every later call; while this run's own calls are in flight it first waits
   * for them to settle. Concurrent takes (a pool of calls) queue, so each one checks the hold after the one before it
   * has counted.
   */
  take(meter: Meter, worst: number): Promise<Ticket> {
    const next = this.queue.then(() => this.takeNow(meter, worst));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async takeNow(meter: Meter, worst: number): Promise<Ticket> {
    const need = Math.max(0, Math.ceil(worst));
    for (;;) {
      if (this.halted) throw this.halted;
      const settles = this.settles;
      const now = this.deps.now();
      const period = periodOf(meter, now);
      const state = await this.state(meter, period);
      let short: { need: number; room: number } | null = null;
      if (state.spent + state.inflight + need > state.granted) {
        const { analytics, counters } = await this.readBoth(now);
        const limit = this.scriptLimit(meter, period);
        const shortfall = state.spent + state.inflight + need - state.granted;
        const room = scriptRoom(meter, period, this.accountUse(state, analytics[meter]), counters[meter], limit);
        if (room < shortfall) short = { need: shortfall, room };
        else {
          const grant = Math.min(room, shortfall + STEP[meter]);
          if (await this.deps.reserve(meter, period, grant, limit)) state.granted += grant;
          else short = { need: shortfall, room: 0 };
        }
      } else if (now.getTime() - this.seenAt > RECHECK_MS || this.seen === null) {
        await this.readBoth(now);
      }
      if (!short) {
        const limit = this.scriptLimit(meter, period);
        // Spend the counters cannot see: the account's use as far as the analytics and this run can tell, and calls
        // still running.
        const seen = this.accountUse(state, this.seen?.[meter] ?? 0) + state.inflight + need;
        if (seen <= limit) {
          state.inflight += need;
          return { meter, period, worst: need };
        }
        short = { need, room: limit - (seen - need) };
      }
      // This run's own calls in flight hold their worst case; once one settles (usually for far less), look again.
      if (state.inflight > 0 && (this.settles !== settles || (await this.settled()))) continue;
      throw this.halt(meter, period, short.need, short.room);
    }
  }

  /** A call is over: `actual` is what it cost, or null to keep its worst case (a cost that was not reported). */
  done(ticket: Ticket, actual: number | null): void {
    const state = this.states.get(ticket.meter);
    const cost = actual === null || !Number.isFinite(actual) ? ticket.worst : Math.max(0, Math.ceil(actual));
    if (state && state.period === ticket.period) {
      state.inflight = Math.max(0, state.inflight - ticket.worst);
      state.spent += cost;
    }
    this.settles += 1;
    for (const wake of this.waiters.splice(0)) wake();
  }

  /**
   * `fetcher` with every call taking `cost` of `meter` (AI Search queries over REST). A call Cloudflare refused (4xx)
   * costs nothing; anything else costs `cost`, a call that failed without an answer too (a timeout may still have run).
   */
  meter(fetcher: typeof fetch, meter: Meter = 'search_semantic', cost = 1): typeof fetch {
    return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const ticket = await this.take(meter, cost);
      let response: Response;
      try {
        response = await fetcher(input, init);
      } catch (error) {
        this.done(ticket, cost);
        throw error;
      }
      this.done(ticket, response.status >= 400 && response.status < 500 ? 0 : cost);
      return response;
    }) as typeof fetch;
  }

  /**
   * Refuses (SpendStop) unless `plan` fits under the scripts' limits now, reserving nothing: for calls the Workers
   * count themselves, like eval:ask's questions to production.
   */
  async check(plan: Plan): Promise<void> {
    if (this.halted) throw this.halted;
    const now = this.deps.now();
    // The counters are read every time (they hold the Workers' own counts); the analytics at most every RECHECK_MS.
    const { analytics, counters } = await this.readBoth(now, true);
    for (const meter of METERS) {
      const need = Math.ceil(plan[meter] ?? 0);
      if (need <= 0) continue;
      const period = periodOf(meter, now);
      const room = scriptRoom(meter, period, analytics[meter], counters[meter], this.scriptLimit(meter, period));
      if (need > room) throw this.halt(meter, period, need, room);
    }
  }

  private async release(meter: Meter, state: MeterState): Promise<void> {
    const unspent = state.granted - state.spent - state.inflight;
    if (unspent === 0) return;
    await this.deps.adjust(meter, state.period, -unspent);
    state.granted -= unspent;
  }

  /** Gives back, in D1, what the run held and did not spend (or adds what it spent past its hold). Safe to repeat. */
  async close(): Promise<void> {
    for (const [meter, state] of this.states) {
      try {
        await this.release(meter, state);
      } catch {
        this.deps.log(`spend: could not settle ${meter} for ${state.period} in D1; the counter stays high until it resets ${resetWhen(meter)}.`);
      }
    }
  }

  /** One line for a run's report: what it spent. */
  summary(): string {
    const spent = this.spentSoFar();
    return `Spend this run: ${spent.neurons.toLocaleString('en-US')} neurons, ${spent.search_semantic} AI Search queries, ${spent.search_ingest_tokens.toLocaleString('en-US')} ingestion tokens.`;
  }
}

// --- Cloudflare: GraphQL analytics and D1 ---------------------------------------------------------------------

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';

/**
 * One request for every meter: today's Workers AI neurons (UTC) and each earlier day's this month, and this month's AI
 * Search semantic and full-text queries and ingestion tokens (image processing tokens share that allotment),
 * account-wide.
 */
export const USAGE_QUERY = `query LegallasSpend($account: string!, $day: Date!, $from: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    neurons: aiInferenceAdaptiveGroups(limit: 1, filter: { date: $day }) { sum { totalNeurons } }
    days: aiInferenceAdaptiveGroups(limit: 31, filter: { date_geq: $from, date_lt: $day }, orderBy: [date_ASC]) { dimensions { date } sum { totalNeurons } }
    semantic: aiSearchSemanticQueriesAdaptiveGroups(limit: 1, filter: { date_geq: $from, date_leq: $day }) { count }
    fulltext: aiSearchFulltextQueriesAdaptiveGroups(limit: 1, filter: { date_geq: $from, date_leq: $day }) { count }
    ingest: aiSearchIngestionTokensAdaptiveGroups(limit: 1, filter: { date_geq: $from, date_leq: $day }) { sum { tokens } }
    image: aiSearchImageProcessingTokensAdaptiveGroups(limit: 1, filter: { date_geq: $from, date_leq: $day }) { sum { tokens } }
  } }
}`;

export function usageVariables(account: string, now: Date): { account: string; day: string; from: string } {
  const day = periodOf('neurons', now);
  return { account, day, from: `${day.slice(0, 7)}-01` };
}

const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * The meters from a USAGE_QUERY response, and with `today` each earlier day of its month (a day with no usage has no
 * row, so it is 0). The guard fails closed: an error, no account, a missing alias, or a row whose figure is not a finite
 * number throws, so a partial answer can never read as zero. An empty list (no usage) is zero.
 */
export function parseUsage(body: unknown, today?: string): Reading {
  const envelope = (body ?? {}) as { data?: { viewer?: { accounts?: Record<string, unknown>[] } }; errors?: unknown[] };
  if (Array.isArray(envelope.errors) && envelope.errors.length) throw new Error('analytics_error');
  const account = envelope.data?.viewer?.accounts?.[0];
  if (!account) throw new Error('analytics_no_account');
  for (const key of ['neurons', 'days', 'semantic', 'fulltext', 'ingest', 'image']) {
    if (!Array.isArray(account[key])) throw new Error('analytics_unreadable');
  }
  const figure = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('analytics_unreadable');
    return value;
  };
  const row = (key: string) => (account[key] as unknown[])[0] as Record<string, unknown> | undefined;
  const count = (key: string) => (row(key) === undefined ? 0 : figure(row(key)!.count)); // safe: checked just before
  const sum = (key: string, field: string) => {
    const found = row(key);
    if (found === undefined) return 0;
    const sums = found.sum;
    if (!sums || typeof sums !== 'object') throw new Error('analytics_unreadable');
    return figure((sums as Record<string, unknown>)[field]);
  };
  const reading: Reading = {
    neurons: Math.ceil(sum('neurons', 'totalNeurons')),
    search_semantic: count('semantic'),
    search_fulltext: count('fulltext'),
    search_ingest_tokens: sum('ingest', 'tokens') + sum('image', 'tokens'),
  };
  if (today === undefined) return reading;
  const days: Record<string, number> = Object.fromEntries(earlierDaysOfMonth(today).map((day) => [day, 0]));
  for (const entry of account.days as Record<string, unknown>[]) {
    const date = (entry?.dimensions as { date?: unknown } | undefined)?.date;
    const sums = entry?.sum as Record<string, unknown> | undefined;
    if (typeof date !== 'string' || !DAY.test(date) || !sums) throw new Error('analytics_unreadable');
    if (date in days) days[date] = Math.ceil(figure(sums.totalNeurons));
  }
  return { ...reading, neuronDays: days };
}

/** The analytics read on wrangler's token (renewed after a 401). Errors carry a status, never the token. */
export function graphqlAnalytics(account: string, tokens: TokenSource, fetcher: typeof fetch = fetch): (now: Date) => Promise<Reading> {
  return async (now) => {
    const response = await withFreshToken(tokens, (token) =>
      fetcher(GRAPHQL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: USAGE_QUERY, variables: usageVariables(account, now) }),
        signal: AbortSignal.timeout(30_000),
      }),
    );
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`analytics_http_${response.status}`);
    return parseUsage(body, periodOf('neurons', now));
  };
}

const PERIOD = /^[0-9]{4}-[0-9]{2}(?:-[0-9]{2})?$/;

function sqlMeter(meter: Meter): string {
  if (!METERS.includes(meter)) throw new Error('unknown meter');
  return `'${meter}'`;
}
function sqlPeriod(period: string): string {
  if (!PERIOD.test(period)) throw new Error('bad period');
  return `'${period}'`;
}
function sqlInt(n: number): string {
  if (!Number.isSafeInteger(n)) throw new Error('spend amounts are integers');
  return String(n);
}

/** spend_counters' reserve (worker/spend.ts reserve) as one literal statement: fixed names and integers only. */
export function reserveSql(meter: Meter, period: string, amount: number, limit: number): string {
  if (amount < 0) throw new Error('spend amounts are non-negative');
  const [m, p, n, l] = [sqlMeter(meter), sqlPeriod(period), sqlInt(amount), sqlInt(limit)];
  return (
    `INSERT INTO spend_counters (meter, period, used) VALUES (${m}, ${p}, ${n}) ` +
    `ON CONFLICT (meter, period) DO UPDATE SET used = used + ${n} WHERE used + ${n} <= ${l} RETURNING used`
  );
}

export function adjustSql(meter: Meter, period: string, delta: number): string {
  return `UPDATE spend_counters SET used = MAX(0, used + ${sqlInt(delta)}) WHERE meter = ${sqlMeter(meter)} AND period = ${sqlPeriod(period)}`;
}

export function countersSql(now: Date): string {
  const today = periodOf('neurons', now);
  return (
    `SELECT meter, period, used FROM spend_counters WHERE period IN (${sqlPeriod(today)}, ${sqlPeriod(periodOf('search_semantic', now))}) ` +
    `OR (meter = 'neurons' AND period >= ${sqlPeriod(`${today.slice(0, 8)}01`)} AND period < ${sqlPeriod(today)})`
  );
}

/** Totals from countersSql rows, each meter read for its own period, and the neurons of the month's earlier days. */
export function parseCounters(rows: readonly Record<string, unknown>[], now: Date): Reading {
  const totals = zero();
  const today = periodOf('neurons', now);
  const neuronDays: Record<string, number> = {};
  for (const row of rows) {
    const meter = row.meter as Meter;
    const period = String(row.period);
    if (METERS.includes(meter) && period === periodOf(meter, now)) totals[meter] = Number(row.used) || 0;
    else if (meter === 'neurons' && DAY.test(period) && period.slice(0, 7) === today.slice(0, 7) && period < today) neuronDays[period] = Number(row.used) || 0;
  }
  return { ...totals, neuronDays };
}

/**
 * The account's neurons for whole days as one literal statement: fixed columns, days and integers only. A day already
 * there keeps the larger count (the analytics only ever catch up).
 */
export function recordDaysSql(days: Record<string, number>, readAt: Date): string {
  const at = readAt.toISOString();
  const rows = Object.entries(days).map(([day, neurons]) => {
    if (!DAY.test(day)) throw new Error('bad day');
    return `(${sqlPeriod(day)}, ${sqlInt(neurons)}, '${at}')`;
  });
  if (rows.length === 0) throw new Error('no days');
  return (
    `INSERT INTO spend_account_days (day, neurons, read_at) VALUES ${rows.join(', ')} ` +
    'ON CONFLICT (day) DO UPDATE SET neurons = MAX(neurons, excluded.neurons), read_at = excluded.read_at'
  );
}

/** spend_account_days for the earlier days of `now`'s month. */
export function accountDaysSql(now: Date): string {
  const today = periodOf('neurons', now);
  return `SELECT day, neurons FROM spend_account_days WHERE day >= ${sqlPeriod(`${today.slice(0, 8)}01`)} AND day < ${sqlPeriod(today)}`;
}

/** The days accountDaysSql read, by day. */
export function parseAccountDays(rows: readonly Record<string, unknown>[]): Record<string, number> {
  return Object.fromEntries(rows.filter((row) => DAY.test(String(row.day))).map((row) => [String(row.day), Number(row.neurons) || 0]));
}

/** The month's recorded days in production D1 (scripts/spend-days.ts reads them back after recording). */
export function d1AccountDays(run: WranglerRun = wrangler): (now: Date) => Promise<Record<string, number>> {
  return async (now) => parseAccountDays(parseD1Json(await run(['d1', 'execute', DATABASE, '--remote', '--json', '--command', accountDaysSql(now)])));
}

/** spend_counters in production D1 through `wrangler d1 execute legallas --remote`. */
export function d1Counters(run: WranglerRun = wrangler): Pick<SpendDeps, 'counters' | 'reserve' | 'adjust'> & Required<Pick<SpendDeps, 'recordDays'>> {
  const execute = async (sql: string) => parseD1Json(await run(['d1', 'execute', DATABASE, '--remote', '--json', '--command', sql]));
  return {
    counters: async (now) => parseCounters(await execute(countersSql(now)), now),
    reserve: async (meter, period, amount, limit) => amount <= limit && (await execute(reserveSql(meter, period, amount, limit))).length > 0,
    adjust: async (meter, period, delta) => void (delta === 0 ? null : await execute(adjustSql(meter, period, Math.round(delta)))),
    recordDays: async (days, readAt) => void (await execute(recordDaysSql(days, readAt))),
  };
}

/**
 * The lease a script runs under, against production: the account's analytics and D1's spend_counters. `what` names
 * the script in a stop message. Interrupting the script (Ctrl-C) settles the lease before it exits.
 */
export function cloudflareLease(account: string, tokens: TokenSource, what: string, log?: (line: string) => void): SpendLease {
  const lease = new SpendLease({ analytics: graphqlAnalytics(account, tokens), ...d1Counters(), log }, what);
  const onSignal = (signal: NodeJS.Signals) => {
    void lease.close().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return lease;
}

// --- Ingestion ------------------------------------------------------------------------------------------------

/** Characters in the files at `paths`: their bytes, which is at least the character count of UTF-8 text. */
export async function fileChars(paths: readonly string[]): Promise<number> {
  let total = 0;
  for (const file of paths) total += (await stat(file)).size;
  return total;
}

/**
 * Holds, before an upload starts, what `chars` characters of new text can cost AI Search in ingestion this month
 * (budget.ts ingestTokensFor). Throws SpendStop unless this month's ingestion, from the analytics and D1, leaves room
 * for it, so an upload with nothing new still refuses once the month is spent. The hold stays in D1 after close:
 * AI Search ingests after the upload, and the analytics catch up hours later.
 */
export async function holdIngestion(lease: SpendLease, chars: number): Promise<number> {
  const tokens = ingestTokensFor(chars);
  const ticket = await lease.take('search_ingest_tokens', tokens);
  lease.done(ticket, tokens);
  return tokens;
}

// --- Usage in a Workers AI response ----------------------------------------------------------------------------

/** The last `usage` object in a raw text/event-stream, or null. */
export function sseUsage(raw: string): unknown {
  let usage: unknown = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:') || !line.includes('"usage"')) continue;
    try {
      const frame = JSON.parse(line.slice(5)) as { usage?: unknown } | null;
      if (frame?.usage && typeof frame.usage === 'object') usage = frame.usage;
    } catch {
      // Not JSON.
    }
  }
  return usage;
}
