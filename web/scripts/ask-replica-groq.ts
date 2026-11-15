// SPDX-License-Identifier: Apache-2.0
// The Ask replica on Groq (scripts/ask-replica.ts --provider groq): the same retrieval, turn and scoring, with each
// answer's turn fitted to Groq's prompt (worker/ask-fit.ts) and sent to Groq's OpenAI-compatible endpoint
// (worker/ask-groq.ts), as the room sends it once Workers AI's neurons are spent (worker/ask-provider.ts). The gate must
// pass on Groq before the room may use it: wrangler.jsonc's ASK_GROQ.eval_runs names the passing runs.
//
// Case content reaches Groq only under zero data retention (SECURITY.md), so a run refuses unless the evaluated
// commit's wrangler.jsonc says ASK_GROQ.zdr_confirmed: the owner's word that Zero Data Retention is on in console.groq.com >
// Settings > Data Controls (groqZdrConfirmed). The key comes from REPLICA_EVAL_GROQ_API_KEY (the replica-eval
// environment's secret), never an argument.
//
// Groq's free plan allows 30 requests and 8,000 tokens a minute, 1,000 requests and 200,000 tokens a day. GroqPacer
// keeps the run under them by counting each call's request tokens (worker/ask-groq.ts groqRequestTokens: its prompt
// estimate and whole completion ceiling) in a 60-second window. At about 7,500 tokens a call that is one answer a
// minute, so the 15-minute ubuntu-slim job runs a shard of the gate's items (--shard k/n, pickShard). Every hard gate
// is a perfect target met item by item, so the gate passes on the set exactly when it passes on every shard. A 429
// stops the run (GroqStop) and is never retried; the gate then reads INCOMPLETE.
//
// Every message here may print in the Replica eval workflow's log, so each matches SAFE_LINES in
// scripts/ask-eval-gate.ts (ask-eval-gate.test.ts checks them).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GROQ_LIMITS, groqChat, groqRequestTokens, GroqRefused, GroqUnavailable, type Fetcher, type GroqLimits, type groqInput } from '../worker/ask-groq.ts';
import type { EvalItem } from './ask-eval-score.ts';

/** The secret's name in the Replica eval workflow. */
export const GROQ_KEY_ENV = 'REPLICA_EVAL_GROQ_API_KEY';

/** One window of Groq's per-minute limits, and the slack added to a wait so a call never lands on its edge. */
export const WINDOW_MS = 60_000;
const SLACK_MS = 500;

/** The run stopped for Groq's limits: a 429, or a call that would pass the day's limits. Nothing more is sent. */
export class GroqStop extends Error {
  override name = 'GroqStop';
}

export const GROQ_STOP_429 = "Stopped by Groq's rate limit (HTTP 429): the free plan's minute or day is spent. Nothing more was sent.";
export const GROQ_STOP_DAY = `Stopped before Groq's daily limit: this run would pass ${GROQ_LIMITS.tokensPerDay.toLocaleString('en-US')} tokens or ${GROQ_LIMITS.requestsPerDay.toLocaleString('en-US')} requests. Nothing more was sent.`;

export interface PacerDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  limits?: Readonly<GroqLimits>;
}

/**
 * Holds the run under Groq's minute (requests and tokens in the last 60 seconds) and under its day (what this run has
 * sent; other use of the key that day is not seen, so a 429 can still stop it). Takes queue, so concurrent calls go
 * one at a time through the window.
 */
export class GroqPacer {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly limits: Readonly<GroqLimits>;
  private readonly window: { at: number; tokens: number }[] = [];
  private day = { requests: 0, tokens: 0 };
  private halted: GroqStop | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: PacerDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.limits = deps.limits ?? GROQ_LIMITS;
  }

  /** The GroqStop that ended this run, or null while it may go on. */
  stopped(): GroqStop | null {
    return this.halted;
  }

  /** Ends the run (a 429): every later take throws the same stop. */
  stop(message = GROQ_STOP_429): GroqStop {
    this.halted ??= new GroqStop(message);
    return this.halted;
  }

  /** What this run has sent to Groq. */
  sent(): { requests: number; tokens: number } {
    return { ...this.day };
  }

  /** Waits until one more call of `tokens` fits the last minute, then counts it. Throws GroqStop once stopped. */
  take(tokens: number): Promise<void> {
    const next = this.queue.then(() => this.takeNow(Math.max(0, Math.ceil(tokens))));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async takeNow(tokens: number): Promise<void> {
    if (this.halted) throw this.halted;
    if (this.day.requests + 1 > this.limits.requestsPerDay || this.day.tokens + tokens > this.limits.tokensPerDay) throw this.stop(GROQ_STOP_DAY);
    for (;;) {
      const now = this.now();
      while (this.window.length && now - this.window[0]!.at >= WINDOW_MS) this.window.shift(); // safe: length checked
      const used = this.window.reduce((sum, entry) => sum + entry.tokens, 0);
      // A call larger than the whole minute waits for an empty window: Groq may still refuse it, which stops the run.
      const fits = this.window.length === 0 || (this.window.length + 1 <= this.limits.requestsPerMinute && used + tokens <= this.limits.tokensPerMinute);
      if (fits) {
        this.window.push({ at: now, tokens });
        this.day = { requests: this.day.requests + 1, tokens: this.day.tokens + tokens };
        return;
      }
      await this.sleep(this.window[0]!.at + WINDOW_MS - now + SLACK_MS); // safe: not empty, or it would fit
    }
  }
}

/**
 * A Groq streaming call for the replica, shaped like ask-replica.ts restGenerate: the stream for the turn, and the raw
 * text/event-stream for the call's shape and usage. Each call is paced; a 429 stops the run; any other failure throws
 * its status word (groq_http_<n>), which scores as an errored answer and so makes the gate INCOMPLETE.
 */
export function groqGenerate(fetcher: Fetcher, apiKey: string, pacer: GroqPacer) {
  return async (input: Record<string, unknown>): Promise<{ stream: ReadableStream<Uint8Array>; sse: Promise<string> }> => {
    await pacer.take(groqRequestTokens(input));
    let body: ReadableStream<Uint8Array>;
    try {
      body = await groqChat(fetcher, apiKey, input as ReturnType<typeof groqInput>);
    } catch (error) {
      if (error instanceof GroqRefused) throw pacer.stop();
      throw new Error(error instanceof GroqUnavailable ? error.message : 'groq_failed');
    }
    const [stream, copy] = body.tee();
    return { stream, sse: new Response(copy).text().catch(() => '') };
  };
}

/** A shard of the run: the `index`th of `of` (1-based). */
export interface Shard {
  index: number;
  of: number;
}

/** "2/3" as a shard; null unless 1 <= index <= of <= 9. */
export function parseShard(value: string): Shard | null {
  const match = /^([1-9])\/([1-9])$/.exec(value);
  if (!match) return null;
  const shard = { index: Number(match[1]), of: Number(match[2]) };
  return shard.index <= shard.of ? shard : null;
}

/**
 * The items of one shard: within each category (each kind, for a v1 set), every `of`th item from the `index`th, in set
 * order. Shards are disjoint and together hold every item, and each holds some of every category with at least `of`
 * items, so every hard gate has answers to judge in every shard.
 */
export function pickShard(items: readonly EvalItem[], shard: Shard | undefined): EvalItem[] {
  if (!shard || shard.of === 1) return [...items];
  const seen = new Map<string, number>();
  const kept = items.filter((item) => {
    const group = item.category ?? item.kind;
    const i = seen.get(group) ?? 0;
    seen.set(group, i + 1);
    return i % shard.of === shard.index - 1;
  });
  if (kept.length === 0) throw new Error(`--shard ${shard.index}/${shard.of} matched no items in the set`);
  return kept;
}

export const GROQ_NO_ZDR = '--provider groq needs ASK_GROQ.zdr_confirmed true in wrangler.jsonc: the owner confirms Zero Data Retention in console.groq.com first';
export const GROQ_NO_KEY = `--provider groq needs ${GROQ_KEY_ENV} set`;

/** The room's own wrangler.jsonc: web/wrangler.jsonc in the evaluated commit. */
export const ROOM_CONFIG = path.resolve(import.meta.dirname, '..', 'wrangler.jsonc');

/**
 * One var of the commit's wrangler.jsonc (`file`, default ROOM_CONFIG), or undefined. Its comments are whole lines
 * (worker/config.test.ts reads it the same way); anything unreadable is undefined.
 */
export function roomVar(name: string, file = ROOM_CONFIG): unknown {
  try {
    const raw = readFileSync(file, 'utf8');
    const config = JSON.parse(
      raw
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//'))
        .join('\n')
        .replace(/,(\s*[}\]])/g, '$1'),
    ) as { vars?: Record<string, unknown> };
    return config.vars?.[name];
  } catch {
    return undefined;
  }
}

/** Whether the commit's wrangler.jsonc (`file`) records zero data retention confirmed for Groq; anything unreadable is false. */
export function groqZdrConfirmed(file = ROOM_CONFIG): boolean {
  const groq = roomVar('ASK_GROQ', file) as { zdr_confirmed?: unknown } | undefined;
  return groq?.zdr_confirmed === true;
}

/** The key for a Groq run, or an error with a fixed message: zero data retention unconfirmed, or no key. */
export function groqRunKey(env: Record<string, string | undefined> = process.env, zdr: () => boolean = groqZdrConfirmed): string {
  if (!zdr()) throw new Error(GROQ_NO_ZDR);
  const key = env[GROQ_KEY_ENV]?.trim() ?? '';
  if (!key) throw new Error(GROQ_NO_KEY);
  return key;
}
