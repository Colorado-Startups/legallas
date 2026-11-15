// SPDX-License-Identifier: Apache-2.0
// Legallas's Cloudflare spend budget: the account stays on Workers Paid ($5 a
// month, flat) and AI Search never bills past what that plan includes, so its limits stay under the included amounts
// (budget.test.ts). Workers AI past the free daily neurons may bill up to a paid month (PAID_MONTHLY_USD below), $0 unless the room sets one. Workers Paid has no spend cap of its own (budget alerts only
// send email), so these limits are the stop. The Workers count against them in D1 (worker/spend.ts, table spend_counters); the eval, law and index scripts
// also read the account's analytics and count in the same table (scripts/spend-guard.ts), so each side sees the
// other's spend. Raising a limit is a reviewed change to this file (README "Spend budget").
//
// Pure, with no Workers types, so worker/, mcp/ and scripts/ all import it.
import { paidMonthlyUsd } from './room-settings.ts';

/**
 * Workers AI's free allocation: 10,000 neurons a day, account-wide, reset at 00:00 UTC; past it Workers Paid bills
 * $0.011 per 1,000 neurons. https://developers.cloudflare.com/workers-ai/platform/pricing/ (read 2026-10-19).
 */
export const WORKERS_AI_FREE_NEURONS = 10_000;
/** What Legallas lets itself spend in a UTC day: a 1,000-neuron margin under the free allocation. */
export const NEURON_DAILY_BUDGET = 9_000;

/**
 * Workers AI past the free daily neurons on Workers Paid: $0.011 per 1,000 neurons, that is $11 per million.
 * https://developers.cloudflare.com/workers-ai/platform/pricing/ (last updated 2026-10-20, read 2026-11-01). AI Search
 * bills on its own rates (its embedding and reranking calls are part of AI Search usage, not neurons).
 */
export const NEURON_PRICE_USD_PER_MILLION = 11;
/**
 * The room's paid budget for Workers AI past the free daily neurons, a UTC calendar month: the config's `paidMonthlyUsd`
 * (worker/room-settings.ts), $0 by default, so Ask stops at the free limit unless the owner chose to pay (#48).
 */
export const PAID_MONTHLY_USD = paidMonthlyUsd;
/** Legallas stops at 90% of it ($9.00 of a $10 month): the rest is the margin for counts that run behind the bill. */
export const PAID_STOP_SHARE = 0.9;
/** The scripts' share of the stop: a third, at most $3.00. */
export const PAID_SCRIPTS_SHARE = 1 / 3;
export const PAID_SCRIPTS_MAX_USD = 3;

/** The paid stops, in dollars, for a paid month of `monthlyUsd`. Ask comes first: the scripts only ever get a share. */
export function paidStops(monthlyUsd: number): { worker: number; script: number } {
  const worker = monthlyUsd * PAID_STOP_SHARE;
  return { worker, script: Math.min(PAID_SCRIPTS_MAX_USD, worker * PAID_SCRIPTS_SHARE) };
}

/**
 * The scripts (evals, law, index) may use paid neurons only while the month's paid spend, everyone's, stays under
 * this ($3.00 of a $10 month): Ask comes first, so the room always keeps the rest of the stop.
 */
export const PAID_SCRIPTS_USD = paidStops(PAID_MONTHLY_USD).script;

/** The neurons `usd` dollars buy past the free allocation, rounded down. */
export function neuronsForUsd(usd: number): number {
  return Math.floor((usd * 1_000_000) / NEURON_PRICE_USD_PER_MILLION + 1e-9);
}

/** What `neurons` paid neurons cost, in dollars. */
export function usdForNeurons(neurons: number): number {
  return (Math.max(0, neurons) * NEURON_PRICE_USD_PER_MILLION) / 1_000_000;
}

/** The paid neurons each side may bring a month of `monthlyUsd` to: for $10, the Workers 818,181 and the scripts 272,727. */
export function paidStopNeurons(monthlyUsd: number): Readonly<Record<'worker' | 'script', number>> {
  const stops = paidStops(monthlyUsd);
  return { worker: neuronsForUsd(stops.worker), script: neuronsForUsd(stops.script) };
}

/** This room's paid stops in neurons: both 0 unless the room sets a paid month. */
export const PAID_STOP_NEURONS = paidStopNeurons(PAID_MONTHLY_USD);

/** A UTC day's paid neurons: what it used past the free 10,000. */
export function paidNeuronsOfDay(neurons: number): number {
  return Math.max(0, Math.ceil(neurons) - WORKERS_AI_FREE_NEURONS);
}

/** The days of `today`'s UTC month before it (YYYY-MM-DD). */
export function earlierDaysOfMonth(today: string): string[] {
  const days: string[] = [];
  for (let day = 1; day < Number(today.slice(8, 10)); day += 1) days.push(`${today.slice(0, 8)}${String(day).padStart(2, '0')}`);
  return days;
}

/**
 * The paid neurons of `today`'s month before today: each earlier day past the free 10,000, by the larger of Legallas's
 * own count (`counted`, spend_counters) and the account's (`account`, the analytics read after that day ended). Null,
 * unknown, when the account's count is missing for any earlier day: then no paid neuron may be used.
 */
export function paidBefore(today: string, counted: Readonly<Record<string, number>>, account: Readonly<Record<string, number>>): number | null {
  let paid = 0;
  for (const day of earlierDaysOfMonth(today)) {
    const seen = account[day];
    if (seen === undefined || !Number.isFinite(seen)) return null;
    paid += paidNeuronsOfDay(Math.max(seen, counted[day] ?? 0));
  }
  return paid;
}

/**
 * What the neuron meter may reach on `today`: the free day's limit (the Workers' 9,000 or the scripts' 7,000), raised
 * by what is left of the side's paid stop this month when `paid` (paidBefore) is known. A day that reaches it uses at
 * most that much past the free 10,000, so the month never passes the stop.
 */
export function neuronLimit(today: string, side: 'worker' | 'script', paid: number | null, stops = PAID_STOP_NEURONS): number {
  const free = limitOf('neurons', today, side);
  return paid === null ? free : free + Math.max(0, stops[side] - paid);
}

/**
 * AI Search's included usage per account per month; billing begins 2026-11-01. A hybrid search bills as one semantic
 * query, not one of each kind: the pricing page has one row, "Semantic, vector, and hybrid queries", and account
 * analytics agree. Every Legallas search is hybrid, so the Workers count each one as one semantic query.
 * https://developers.cloudflare.com/ai-search/platform/limits-pricing/ (read 2026-10-20).
 */
export const AI_SEARCH_INCLUDED = { semantic: 1_000, fulltext: 1_000, ingestTokens: 5_000_000 } as const;
/** The share of AI Search's included usage Legallas lets itself use. */
export const AI_SEARCH_SHARE = 0.9;
/**
 * The meters count per calendar month, but Cloudflare aligns usage to the account's billing cycle, which starts on
 * the first purchase date ("Usage data is aligned to your billing cycle, not the calendar month",
 * https://developers.cloudflare.com/billing/manage/billable-usage/). A billing cycle overlaps at most two calendar months, so each month gets half of the
 * share until the first AI Search invoice confirms the cycle; then key the meters to it and drop this to 1.
 */
export const AI_SEARCH_WINDOWS_PER_CYCLE = 2;
/** The first billed month: before it, AI Search meters are counted but never refuse. */
export const AI_SEARCH_BILLED_FROM = '2026-11';

export type Meter = 'neurons' | 'search_semantic' | 'search_fulltext' | 'search_ingest_tokens';
export const METERS: readonly Meter[] = ['neurons', 'search_semantic', 'search_fulltext', 'search_ingest_tokens'];

interface MeterRule {
  /** A counter per UTC day (YYYY-MM-DD) or per UTC month (YYYY-MM). */
  per: 'day' | 'month';
  /** The Workers refuse past this. */
  limit: number;
  /**
   * Scripts stop this much sooner: analytics lag a few minutes, and production Ask keeps room for members after an
   * eval has run. At least 1,000 neurons by the task brief of 2026-10-19.
   */
  scriptHeadroom: number;
  billedFrom?: string;
}

const included = (n: number) => Math.floor((n * AI_SEARCH_SHARE) / AI_SEARCH_WINDOWS_PER_CYCLE);

export const BUDGET: Readonly<Record<Meter, MeterRule>> = {
  // 2,000 left for the Workers: about seven typical questions (260 neurons each) after an eval day.
  neurons: { per: 'day', limit: NEURON_DAILY_BUDGET, scriptHeadroom: 2_000 },
  // 450 a month while halved: 150 stay for Ask and legallas_search (1 to 4 searches a question); scripts get 300.
  search_semantic: { per: 'month', limit: included(AI_SEARCH_INCLUDED.semantic), scriptHeadroom: 150, billedFrom: AI_SEARCH_BILLED_FROM },
  search_fulltext: { per: 'month', limit: included(AI_SEARCH_INCLUDED.fulltext), scriptHeadroom: 150, billedFrom: AI_SEARCH_BILLED_FROM },
  // Only scripts ingest (sync, index:v2, law); the headroom covers the token estimate's error.
  search_ingest_tokens: { per: 'month', limit: included(AI_SEARCH_INCLUDED.ingestTokens), scriptHeadroom: 250_000, billedFrom: AI_SEARCH_BILLED_FROM },
};

/** The limit of a meter in a month before its billing starts: large enough never to refuse, and still a D1 integer. */
export const UNBILLED_LIMIT = Number.MAX_SAFE_INTEGER;

/** The counter's period for `meter` at `now`: the UTC day or the UTC month. */
export function periodOf(meter: Meter, now: Date): string {
  const iso = now.toISOString();
  return BUDGET[meter].per === 'day' ? iso.slice(0, 10) : iso.slice(0, 7);
}

/** What `meter` may reach in `period`: the Workers' limit, or the scripts' (headroom kept). */
export function limitOf(meter: Meter, period: string, side: 'worker' | 'script' = 'worker'): number {
  const rule = BUDGET[meter];
  if (rule.billedFrom && period.slice(0, 7) < rule.billedFrom) return UNBILLED_LIMIT;
  return side === 'script' ? rule.limit - rule.scriptHeadroom : rule.limit;
}

/**
 * What a script may still spend of `meter` now: its limit (`limit`, for the neurons' paid one) less the larger of the
 * account's analytics (everything, a few minutes late) and the D1 counter (Legallas's own Workers and scripts, at once).
 * Never negative.
 */
export function scriptRoom(meter: Meter, period: string, analytics: number, counter: number, limit = limitOf(meter, period, 'script')): number {
  return Math.max(0, limit - Math.max(analytics, counter));
}

/** Seconds until `meter`'s period ends: midnight UTC, or the first of next month (UTC). */
export function secondsToReset(meter: Meter, now: Date): number {
  const next =
    BUDGET[meter].per === 'day'
      ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
      : Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

// --- Neurons ------------------------------------------------------------------------------------------------

/** Neurons per million tokens. */
export interface NeuronRate {
  input: number;
  output: number;
}

/**
 * The models Legallas runs, from the Workers AI pricing page (read 2026-10-19). Ask's model and its fallback
 * (worker/ask-config.test.ts requires an entry for both) and the law replica's embeddings.
 */
export const NEURON_RATES: Readonly<Record<string, NeuronRate>> = {
  // Ask's model and its fallback since 2026-11-05: $0.35 and $0.75 per million tokens (its model page, read 2026-11-05).
  '@cf/openai/gpt-oss-120b': { input: 31_818, output: 68_182 },
  // Ask's model from 2026-10-04 to 2026-11-05. Workers AI retires it on 2026-11-15 (DEPRECATED_MODELS); kept so
  // a room not yet moved off it is costed exactly until then, and for the tests that name it.
  '@cf/zai-org/glm-5.3-flash': { input: 13_636, output: 45_455 },
  '@cf/qwen/qwen3-embedding-0.6b': { input: 1_075, output: 0 },
  // Not run: about ten times glm-5.3-flash per token, so its replica eval was dropped (the owner, 2026-10-20: no usage
  // billing). Listed so a switch to it is costed exactly; it has no REASONING_EFFORT entry until an eval picks one.
  '@cf/zai-org/glm-5.3': { input: 127_273, output: 400_000 },
  // Not run yet: a candidate for the research agent's tool steps ($0.0605 and $0.40 per million tokens; pricing page
  // read 2026-10-20, 131,072-token context, function calling). No model choice uses it.
  '@cf/zai-org/glm-4.7-flash': { input: 5_500, output: 36_400 },
};

/**
 * Workers AI models whose model page lists a planned deprecation, with that date. No default may name one: Ask's
 * model, its fallback, the vision models (worker/ask-config.test.ts) and the research replica's models
 * (scripts/research-replica.test.ts). A room still on one after the date gets FALLBACK_MODEL (ask-model.ts), since
 * Workers AI then refuses the retired model.
 */
export const DEPRECATED_MODELS: Readonly<Record<string, string>> = {
  // "Planned Deprecation 11/15/2026": https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/, read 2026-11-05.
  '@cf/zai-org/glm-5.3-flash': '2026-11-15',
};

/** A model with no entry is costed like the dearest text model on the page (glm-5.3), so it is never under-held. */
export const UNLISTED_MODEL_RATE: NeuronRate = { input: 127_273, output: 400_000 };

export function neuronRate(model: string): NeuronRate {
  return Object.hasOwn(NEURON_RATES, model) ? NEURON_RATES[model]! : UNLISTED_MODEL_RATE; // safe: hasOwn
}

/** Ask's max_tokens (worker/ask.ts MAX_TOKENS; budget.test.ts keeps them equal), for scripts that cannot load ask.ts. */
export const ASK_MAX_TOKENS = 16_384;
/** The most prompt one Ask question sends: 20 passages, the case picture, law passages and the instructions, with room. */
export const ASK_PROMPT_TOKENS_MAX = 30_000;
/** Searches one Ask question can make: the record and the law library, each asked once more at most (ai-search.ts askAgain). */
export const ASK_SEARCHES_MAX = 4;

/** What one Ask question can cost at most with `model`: for scripts that send questions to production (eval:ask). */
export function askQuestionWorst(model: string): { neurons: number; search_semantic: number } {
  return { neurons: neuronsFor(model, ASK_PROMPT_TOKENS_MAX, ASK_MAX_TOKENS), search_semantic: ASK_SEARCHES_MAX };
}

/** Characters per token for an estimate made before a call: low on purpose (English runs nearer 4), so it overcounts. */
export const CHARS_PER_TOKEN = 3;
/** The output a generation may write when its input sets no max_tokens. */
export const DEFAULT_OUTPUT_TOKENS = 16_384;

export function tokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);
}

export function neuronsFor(model: string, inputTokens: number, outputTokens: number): number {
  const rate = neuronRate(model);
  return Math.ceil((inputTokens * rate.input + outputTokens * rate.output) / 1_000_000);
}

/**
 * Characters of one message's content: a string, or an array of parts (OpenAI style). A part's text counts as itself;
 * any other part (an image, a file) counts as its whole JSON, which overcounts and so never under-holds.
 */
function contentChars(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const part of content) {
    if (typeof part === 'string') chars += part.length;
    else if (part && typeof part === 'object') {
      const text = (part as { text?: unknown }).text;
      chars += typeof text === 'string' ? text.length : JSON.stringify(part).length;
    }
  }
  return chars;
}

/**
 * Characters of text a Workers AI input sends: chat messages (their content, plus the JSON of anything else they
 * carry beside the role, such as an assistant's tool_calls or a tool result's id), the tool definitions, an
 * embedding's text (one or many) or a prompt. The model reads all of them as input tokens.
 */
export function inputChars(input: unknown): number {
  if (!input || typeof input !== 'object') return 0;
  const record = input as { messages?: unknown; tools?: unknown; text?: unknown; prompt?: unknown };
  let chars = 0;
  if (Array.isArray(record.messages)) {
    for (const message of record.messages) {
      if (!message || typeof message !== 'object') continue;
      const { content, role: _role, ...rest } = message as Record<string, unknown>;
      chars += contentChars(content);
      if (Object.keys(rest).length > 0) chars += JSON.stringify(rest).length;
    }
  }
  if (Array.isArray(record.tools) && record.tools.length > 0) chars += JSON.stringify(record.tools).length;
  if (typeof record.text === 'string') chars += record.text.length;
  if (Array.isArray(record.text)) for (const text of record.text) if (typeof text === 'string') chars += text.length;
  if (typeof record.prompt === 'string') chars += record.prompt.length;
  return chars;
}

/** The output ceiling an input sets: max_tokens or max_completion_tokens (the larger when both are there), or null. */
export function outputCeiling(input: unknown): number | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as { max_tokens?: unknown; max_completion_tokens?: unknown };
  const set = [record.max_tokens, record.max_completion_tokens].filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
  return set.length > 0 ? Math.max(...set) : null;
}

/**
 * The most one Workers AI call can cost: its input at CHARS_PER_TOKEN and its whole output ceiling (max_tokens or
 * max_completion_tokens; reasoning counts against it). At least 1, so every call holds something.
 */
export function worstCaseNeurons(model: string, input: unknown): number {
  const output = neuronRate(model).output === 0 ? 0 : (outputCeiling(input) ?? DEFAULT_OUTPUT_TOKENS);
  return Math.max(1, neuronsFor(model, tokensFromChars(inputChars(input)), output));
}

/**
 * Neurons one call cost, from the `usage` Workers AI returns: its own neuron count when it sends one, else its
 * token counts at the model's rate. Null when the usage says neither.
 */
export function usageNeurons(model: string, usage: unknown): number | null {
  if (!usage || typeof usage !== 'object') return null;
  const record = usage as { neurons?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown };
  const neurons = Number(record.neurons);
  if (record.neurons !== undefined && record.neurons !== null && Number.isFinite(neurons) && neurons >= 0) return Math.ceil(neurons);
  const prompt = Number(record.prompt_tokens);
  const completion = Number(record.completion_tokens ?? 0);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) return null;
  return neuronsFor(model, prompt, completion);
}

/** Output a stream may have made past what was read when a cancel reached Workers AI (buffered or in flight). */
export const CANCEL_MARGIN_TOKENS = 256;

/**
 * What an abandoned call is settled to once its stream is cancelled: its whole input (already processed), the output
 * read so far (frames, or characters at CHARS_PER_TOKEN, whichever is more) and CANCEL_MARGIN_TOKENS, never more than
 * its hold.
 */
export function abandonedNeurons(model: string, input: unknown, read: { frames: number; chars: number }): number {
  const output = Math.max(read.frames, tokensFromChars(read.chars)) + CANCEL_MARGIN_TOKENS;
  return Math.min(worstCaseNeurons(model, input), neuronsFor(model, tokensFromChars(inputChars(input)), output));
}

// --- AI Search ingestion ------------------------------------------------------------------------------------

/**
 * Ingestion tokens a set of parts may cost: AI Search counts cl100k_base tokens on its final chunks, overlap counted
 * twice; CHARS_PER_TOKEN (3, against about 4 for English) leaves room for both.
 */
export function ingestTokensFor(chars: number): number {
  return tokensFromChars(chars);
}
