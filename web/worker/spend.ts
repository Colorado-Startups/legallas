// SPDX-License-Identifier: Apache-2.0
// The Workers' side of the spend budget (worker/budget.ts): counters in D1 (migration 0007, spend_counters) and the
// AI and AI Search bindings wrapped so every call counts. A Workers AI call holds its worst case before it runs and
// is settled to what its usage frame reports when the stream ends; a search counts one semantic query. A hold that
// would pass the meter's limit is refused with BudgetExhausted, in one statement, so concurrent requests can never
// pass a limit together. The eval and index scripts reserve in the same table (scripts/spend-guard.ts).
//
// The day's neuron limit rises past the free 9,000 by what is left of the paid month's $9.00 (budget.ts neuronLimit),
// but only while spend_account_days (migration 0011) holds the account's analytics for every earlier day of the month;
// otherwise, or when it cannot be read, the paid month is unknown and the limit stays at the free 9,000.
//
// Logs carry the meter name and an error's name only, never a question, a query or text.
import { abandonedNeurons, limitOf, neuronLimit, paidBefore, periodOf, usageNeurons, worstCaseNeurons, type Meter } from './budget.ts';

/** A meter has no room left for this call. routes/ask.ts and mcp/server.ts turn it into a friendly refusal. */
export class BudgetExhausted extends Error {
  override name = 'BudgetExhausted';
  readonly meter: Meter;
  constructor(meter: Meter) {
    super(meter);
    this.meter = meter;
  }
}

function amountOf(n: number): number {
  if (!Number.isFinite(n) || n < 0) throw new RangeError('spend amounts are non-negative');
  return Math.ceil(n);
}

/**
 * Adds `amount` to `meter` for `period` only while the total stays within `limit`; true when it did. One upsert:
 * the UPDATE runs only under the limit and RETURNING yields a row only when something was added, like
 * ask.ts takeQuestion.
 */
export async function reserve(db: D1Database, meter: Meter, period: string, amount: number, limit: number): Promise<boolean> {
  const n = amountOf(amount);
  if (n > limit) return false;
  const row = await db
    .prepare(
      'INSERT INTO spend_counters (meter, period, used) VALUES (?1, ?2, ?3) ' +
        'ON CONFLICT (meter, period) DO UPDATE SET used = used + ?3 WHERE used + ?3 <= ?4 ' +
        'RETURNING used',
    )
    .bind(meter, period, n, limit)
    .first<{ used: number }>();
  return row !== null;
}

/** Moves a counter by `delta` (a hold settled to what was spent, or given back), never below zero. */
export async function adjust(db: D1Database, meter: Meter, period: string, delta: number): Promise<void> {
  if (!Number.isFinite(delta) || delta === 0) return;
  await db
    .prepare('UPDATE spend_counters SET used = MAX(0, used + ?3) WHERE meter = ?1 AND period = ?2')
    .bind(meter, period, Math.round(delta))
    .run();
}

/** What `meter` has counted for `period`. */
export async function used(db: D1Database, meter: Meter, period: string): Promise<number> {
  const row = await db.prepare('SELECT used FROM spend_counters WHERE meter = ?1 AND period = ?2').bind(meter, period).first<{ used: number }>();
  return row?.used ?? 0;
}

const logFailure = (where: string) => (error: unknown) => console.error(where, error instanceof Error ? error.name : typeof error);

/**
 * The paid neurons of `day`'s month before it (budget.ts paidBefore), from spend_counters and spend_account_days. Null
 * when the account's analytics are missing for an earlier day, or the tables cannot be read (migration 0011 not yet
 * applied): the paid month is then unknown.
 */
export async function monthPaid(db: D1Database, day: string): Promise<number | null> {
  const first = `${day.slice(0, 8)}01`;
  try {
    const [counted, account] = await Promise.all([
      db.prepare("SELECT period AS day, used AS n FROM spend_counters WHERE meter = 'neurons' AND period >= ?1 AND period < ?2").bind(first, day).all<{ day: string; n: number }>(),
      db.prepare('SELECT day, neurons AS n FROM spend_account_days WHERE day >= ?1 AND day < ?2').bind(first, day).all<{ day: string; n: number }>(),
    ]);
    const byDay = (rows: { day: string; n: number }[]) => Object.fromEntries(rows.map((row) => [row.day, Number(row.n)]));
    return paidBefore(day, byDay(counted.results), byDay(account.results));
  } catch (error) {
    logFailure('spend_paid_unknown')(error);
    return null;
  }
}

/** What `meter` may reach in `period` for the Workers: the neurons' limit with the paid month's room (neuronLimit). */
async function workerLimit(db: D1Database, meter: Meter, period: string): Promise<number> {
  return meter === 'neurons' ? neuronLimit(period, 'worker', await monthPaid(db, period)) : limitOf(meter, period);
}

/** The first meter in `needs` without that much room left now, or null when every one has it. Reads only. */
export async function shortMeter(db: D1Database, needs: Partial<Record<Meter, number>>, now: Date = new Date()): Promise<Meter | null> {
  for (const [meter, need] of Object.entries(needs) as [Meter, number][]) {
    const period = periodOf(meter, now);
    if ((await used(db, meter, period)) + amountOf(need) > (await workerLimit(db, meter, period))) return meter;
  }
  return null;
}

/** Hands a promise to the runtime so it may finish after the response (ExecutionContext.waitUntil). */
export type WaitUntil = (promise: Promise<unknown>) => void;

/** `ctx.waitUntil`, when the context has one (tests pass a bare object). */
export function waitUntilOf(ctx: Partial<Pick<ExecutionContext, 'waitUntil'>> | undefined): WaitUntil | undefined {
  return typeof ctx?.waitUntil === 'function' ? (promise) => ctx.waitUntil!(promise) : undefined; // safe: checked above
}

/** What a tapped stream carried before it ended or was cancelled. */
export interface StreamRead {
  /** The last `usage` object any frame carried, or null. */
  usage: unknown;
  /** Data frames read: each carries at least one token of answer or reasoning. */
  frames: number;
  /** Characters of answer and reasoning text in them (`content` and `reasoning_content`). */
  chars: number;
}

const DELTA_TEXT = /"(?:reasoning_)?content":"((?:[^"\\]|\\.)*)"/g;

/**
 * `stream` passed through unchanged, with what it carried handed to `onEnd` when it finishes. When the reader cancels
 * (a closed tab, a degenerate first answer), the stream is cancelled upstream at once, so the model stops writing, and
 * `onCancel` gets what was read; `waitUntil` lets that settle outlive the response. Only lines that mention "usage" are
 * parsed as JSON; the text is measured with one pattern.
 */
export function tapUsage(
  stream: ReadableStream<Uint8Array>,
  handlers: { onEnd: (read: StreamRead) => Promise<void>; onCancel: (read: StreamRead) => Promise<void> },
  waitUntil?: WaitUntil,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const read: StreamRead = { usage: null, frames: 0, chars: 0 };
  let buffer = '';
  const scan = (line: string) => {
    if (!line.startsWith('data:') || line.includes('[DONE]')) return;
    read.frames += 1;
    for (const match of line.matchAll(DELTA_TEXT)) read.chars += match[1]!.length; // safe: the group always matches
    if (!line.includes('"usage"')) return;
    try {
      const frame = JSON.parse(line.replace(/^data:\s*/, '')) as { usage?: unknown } | null;
      if (frame?.usage && typeof frame.usage === 'object') read.usage = frame.usage;
    } catch {
      // Not a JSON frame.
    }
  };
  /** Scans a chunk's complete lines; with no chunk, the stream ended and the rest of the buffer is the last line. */
  const take = (chunk?: Uint8Array) => {
    buffer += chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode();
    const lines = buffer.split('\n');
    buffer = chunk ? (lines.pop() ?? '') : '';
    for (const line of lines) scan(line);
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (!done) {
        take(value);
        controller.enqueue(value);
        return;
      }
      take();
      await handlers.onEnd(read);
      controller.close();
    },
    cancel(reason) {
      const settle = (async () => {
        await reader.cancel(reason).catch(() => undefined);
        await handlers.onCancel(read);
      })().catch(logFailure('spend_cancel_failed'));
      waitUntil?.(settle);
      return settle;
    },
  });
}

/**
 * True when a failed binding call was refused before any work, so it cost nothing: out of capacity or rate limited
 * (429, 3040), the free allocation used (3036), or a request refused for itself (a 4xx other than a timeout). Anything
 * else (a timeout, a 5xx, an unknown error) may have run and been billed, so its hold stays.
 */
export function refusedUnbilled(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /\b(?:3036|3040|400|401|403|404|405|409|413|415|422|429)\b|capacity|too many requests|rate.?limit/i.test(text);
}

/** A billed binding called from local development without LEGALLAS_DEV_REMOTE_AI=1: local D1 would count it, unseen. */
export class LocalSpendOff extends Error {
  override name = 'LocalSpendOff';
}

/** A call the metered binding will not make: a model outside Workers AI (@cf/), or an AI Gateway option. */
export class ModelRefused extends Error {
  override name = 'ModelRefused';
}

/**
 * The options a call may carry to the binding (plan D10): an abort signal and nothing else. Throws ModelRefused for a
 * model id that is not a Workers AI (@cf/) model, so case text never goes to another host through this binding (Groq has
 * its own client, ask-groq.ts, behind the room config's zero-data-retention gate), and for any defined
 * `gateway` value, since AI Gateway would log prompts. The tool steps reach it through worker/agent/model.ts, which
 * drops createAI's default gateway and passes only `{ signal }`; an undefined gateway is allowed. Undefined when there
 * is no signal: the call then keeps the plain `run(model, input)` shape that ask.test.ts pins.
 */
export function forwardedOptions(model: string, options?: unknown): { signal: AbortSignal } | undefined {
  if (typeof model !== 'string' || !model.startsWith('@cf/')) throw new ModelRefused('model');
  if (options !== undefined && options !== null && typeof options !== 'object') throw new ModelRefused('options');
  const record = (options ?? {}) as { gateway?: unknown; signal?: unknown };
  if (record.gateway !== undefined) throw new ModelRefused('gateway');
  return record.signal instanceof AbortSignal ? { signal: record.signal } : undefined;
}

/**
 * The Workers AI binding, metered on the `neurons` meter: each call holds worstCaseNeurons (budget.ts), refused with
 * BudgetExhausted when the day has no room, the paid month's included (workerLimit). A call refused before any work gives its hold back (refusedUnbilled);
 * any other failure keeps it. A finished call settles to the usage it reports (a stream's last usage frame); an
 * abandoned stream is cancelled and settles to abandonedNeurons (budget.ts). The hold and its settle share the day of
 * the hold, even across midnight UTC. Only @cf/ models run, a gateway option is refused, and only an abort signal is
 * forwarded (forwardedOptions); without one a call keeps its shape, `run(model, input)` with no options, so
 * ask.test.ts still sees no AI Gateway option.
 */
export function meteredAi(ai: Pick<Ai, 'run'>, db: D1Database, now: () => Date = () => new Date(), waitUntil?: WaitUntil): Pick<Ai, 'run'> {
  // The day's limit is read once per binding and day: withSpendGuards builds a binding per request, and the month's
  // earlier days do not change during one, so a research turn's steps share one read.
  let limit: { period: string; value: Promise<number> } | null = null;
  const limitFor = (period: string): Promise<number> => {
    if (limit?.period !== period) limit = { period, value: workerLimit(db, 'neurons', period) };
    return limit.value;
  };
  const run = async (model: string, input: unknown, options?: unknown): Promise<unknown> => {
    const forward = forwardedOptions(model, options);
    const period = periodOf('neurons', now());
    const hold = worstCaseNeurons(model, input);
    if (!(await reserve(db, 'neurons', period, hold, await limitFor(period)))) throw new BudgetExhausted('neurons');
    let result: unknown;
    try {
      result = forward ? await ai.run(model as keyof AiModels, input as never, forward) : await ai.run(model as keyof AiModels, input as never);
    } catch (error) {
      if (refusedUnbilled(error)) await adjust(db, 'neurons', period, -hold).catch(logFailure('spend_release_failed'));
      throw error;
    }
    const settleTo = async (spent: number | null) => {
      if (spent !== null) await adjust(db, 'neurons', period, spent - hold).catch(logFailure('spend_settle_failed'));
    };
    if (result instanceof ReadableStream) {
      return tapUsage(
        result as ReadableStream<Uint8Array>,
        {
          onEnd: (read) => settleTo(usageNeurons(model, read.usage)),
          onCancel: (read) => settleTo(usageNeurons(model, read.usage) ?? abandonedNeurons(model, input, read)),
        },
        waitUntil,
      );
    }
    await settleTo(usageNeurons(model, (result as { usage?: unknown } | null)?.usage ?? null));
    return result;
  };
  return { run } as unknown as Pick<Ai, 'run'>;
}

/**
 * An AI Search instance, metered on `search_semantic`: each search counts one query, refused with BudgetExhausted
 * when the month has no room. A failed search keeps its count (it may still have been billed).
 */
export function meteredSearch(search: Pick<AiSearchInstance, 'search'>, db: D1Database, now: () => Date = () => new Date()): Pick<AiSearchInstance, 'search'> {
  return {
    async search(request: AiSearchSearchRequest) {
      const period = periodOf('search_semantic', now());
      if (!(await reserve(db, 'search_semantic', period, 1, limitOf('search_semantic', period)))) throw new BudgetExhausted('search_semantic');
      return search.search(request);
    },
  };
}

interface Guardable {
  DB: D1Database;
  AI?: Ai;
  SEARCH?: AiSearchInstance;
  LAW_SEARCH?: AiSearchInstance;
  /** Local development only (.dev.vars): "1" lets the billed AI bindings run from localhost, counted in local D1. */
  LEGALLAS_DEV_REMOTE_AI?: string;
}

/** True when `request` came to a local development host (wrangler dev): the room's mocks and dev identity apply there. */
export function isLocalRequest(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

const refuseLocal = { run: async () => Promise.reject(new LocalSpendOff()), search: async () => Promise.reject(new LocalSpendOff()) };

/**
 * `env` with every billed AI binding metered (AI, SEARCH and LAW_SEARCH when present), for the Ask route and the MCP
 * tools. The local mocks (ask-mock.ts, law-mock.ts, mcp/dev-search.ts) replace these afterwards and are free. With
 * `local` (a request to localhost), the billed bindings refuse with LocalSpendOff unless LEGALLAS_DEV_REMOTE_AI is "1":
 * local D1 would count them, and production never sees that count. `waitUntil` (waitUntilOf(ctx)) lets an abandoned
 * answer's settle outlive the response.
 */
export function withSpendGuards<E extends Guardable>(env: E, options: { now?: () => Date; waitUntil?: WaitUntil; local?: boolean } = {}): E {
  const now = options.now ?? (() => new Date());
  if (options.local && env.LEGALLAS_DEV_REMOTE_AI !== '1') {
    return {
      ...env,
      ...(env.AI ? { AI: refuseLocal as unknown as Ai } : {}),
      ...(env.SEARCH ? { SEARCH: refuseLocal as unknown as AiSearchInstance } : {}),
      ...(env.LAW_SEARCH ? { LAW_SEARCH: refuseLocal as unknown as AiSearchInstance } : {}),
    };
  }
  return {
    ...env,
    ...(env.AI ? { AI: meteredAi(env.AI, env.DB, now, options.waitUntil) as Ai } : {}),
    ...(env.SEARCH ? { SEARCH: meteredSearch(env.SEARCH, env.DB, now) as AiSearchInstance } : {}),
    ...(env.LAW_SEARCH ? { LAW_SEARCH: meteredSearch(env.LAW_SEARCH, env.DB, now) as AiSearchInstance } : {}),
  };
}

/** The error code a refusal carries: the daily Workers AI allowance, or the monthly AI Search one. */
export function budgetCode(meter: Meter): 'ai_budget' | 'search_budget' {
  return meter === 'neurons' ? 'ai_budget' : 'search_budget';
}
