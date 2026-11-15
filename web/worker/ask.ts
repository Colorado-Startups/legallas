// SPDX-License-Identifier: Apache-2.0
// The pieces of /api/ask around retrieval: input checks, the daily cap and the model call's input. Retrieval
// filtered to live documents is the room's own (retrieval.ts). routes/ask.ts strings them together and writes the
// audit row through audit.ts.
//
// Privacy: the question travels only in the POST body and in the calls to AI Search and Workers AI.
// It is never logged, never stored in D1 and never put in a URL.
import { readLimited } from './comments.ts';
import type { Env } from './env.ts';

export const MAX_QUESTION_CHARS = 2000;
/** The body is JSON around the question; anything far larger is not a question. */
const MAX_BODY_BYTES = 16_384;
const DEFAULT_CAP = 100;

export type QuestionResult = { ok: true; question: string } | { ok: false; error: 'bad_request' | 'question_too_long' | 'empty_question' };

/** Reads { question } from a JSON body. Never looks at the URL. */
export async function readQuestion(request: Request): Promise<QuestionResult> {
  // Stops reading past MAX_BODY_BYTES, so a huge body never sits in memory.
  const raw = await readLimited(request, MAX_BODY_BYTES);
  if (raw === null) return { ok: false, error: 'question_too_long' };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'bad_request' };
  }
  if (!body || typeof body !== 'object' || typeof (body as { question?: unknown }).question !== 'string') {
    return { ok: false, error: 'bad_request' };
  }
  // Control characters other than newline and tab carry no meaning in a question.
  const question = (body as { question: string }).question.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  if (!question) return { ok: false, error: 'empty_question' };
  if ([...question].length > MAX_QUESTION_CHARS) return { ok: false, error: 'question_too_long' };
  return { ok: true, question };
}

/** DAILY_QUESTION_CAP as a number. Unparseable falls back to the default; 0 or less turns asking off. */
export function dailyCap(value: string | undefined): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : DEFAULT_CAP;
}

function questionAmount(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new RangeError('a question costs a whole number, at least 1');
  return amount;
}

/**
 * Counts `amount` questions against today's cap, atomically: a single upsert adds only while the count stays within
 * the cap, and RETURNING yields a row only when it did. Two racing requests near the cap cannot both pass, because
 * SQLite applies the conditional update to one of them at a time. Quick Ask costs 1; a research question costs 3
 * (plan D10), all or nothing.
 */
export async function takeQuestion(db: D1Database, email: string, cap: number, day: string, amount = 1): Promise<boolean> {
  const n = questionAmount(amount);
  if (cap <= 0 || n > cap) return false;
  const row = await db
    .prepare(
      'INSERT INTO usage (email, day, questions) VALUES (?1, ?2, ?4) ' +
        'ON CONFLICT (email, day) DO UPDATE SET questions = questions + ?4 WHERE questions + ?4 <= ?3 ' +
        'RETURNING questions',
    )
    .bind(email, day, cap, n)
    .first<{ questions: number }>();
  return row !== null;
}

/**
 * Gives back `amount` questions takeQuestion counted, for one that failed before an answer could start (search or
 * model unavailable, or an answer that failed in the stream): a failure on our side never costs a question. One
 * conditional update, never below zero.
 */
export async function refundQuestion(db: D1Database, email: string, day: string, amount = 1): Promise<void> {
  const n = questionAmount(amount);
  await db.prepare('UPDATE usage SET questions = MAX(0, questions - ?3) WHERE email = ?1 AND day = ?2 AND questions > 0').bind(email, day, n).run();
}

/** Quick Ask's includeVisuals: off unless ASK_VISUALS is "1", set once a replica eval shows no loss (plan D8). */
export function askVisuals(env: { ASK_VISUALS?: string }): boolean {
  return env.ASK_VISUALS === '1';
}

export type ReasoningEffort = 'low' | 'medium' | 'high';

/**
 * reasoning_effort for each model Ask may run (LEGALLAS_MODEL). Models name their levels differently and remap the
 * ones they lack: glm-5.3-flash turned "medium" into "max" and deepseek-v4 turns it into "high", so a level that
 * suits one model can run another unbounded. Each entry is the level the replica eval chose
 * (scripts/ask-replica.ts); worker/ask-config.test.ts requires an entry for the configured model, and refuses any
 * entry in DEPRECATED_MODELS (budget.ts).
 */
export const REASONING_EFFORT: Readonly<Record<string, ReasoningEffort>> = {
  // Ask's model since 2026-11-05, and before 2026-10-04 (the owner, 2026-10-01). Replica, 2026-10-04, 4 reps: 18 to 19
  // of 22, against 20 to 21 for glm-5.3-flash, which Workers AI retires on 2026-11-15 (budget.ts DEPRECATED_MODELS).
  '@cf/openai/gpt-oss-120b': 'medium',
};

/**
 * Completion tokens for one answer. Reasoning counts against it, and a broad list question at glm-5.3-flash's high
 * effort could reason past 4096 and stream no answer at all. Replica, 2026-10-04, six broad list questions x 3: at
 * 4096, 16 of 23 calls stopped at the limit (7 of them blank, 2 answers failed after the retry); at 8192, 3 of 18;
 * at 16384, none (the longest used 12,912). The 22-question eval set never passed 2,612 at either ceiling and scored
 * the same (20 and 21 not failing per rep). gpt-oss-120b's output costs $0.75 per million tokens, so an answer that
 * uses all of it costs at most about $0.012 of output.
 */
export const MAX_TOKENS = 16_384;

/**
 * The model call's input. No gateway option, so prompts and answers are not logged by AI Gateway. A model with no
 * REASONING_EFFORT entry gets none (its own default).
 */
export function generationInput(messages: { role: 'system' | 'user'; content: string }[], model: string) {
  const effort = Object.hasOwn(REASONING_EFFORT, model) ? REASONING_EFFORT[model] : undefined;
  return { messages, stream: true as const, max_tokens: MAX_TOKENS, ...(effort ? { reasoning_effort: effort } : {}) };
}

export type AskBindings = Pick<Env, 'AI' | 'SEARCH'>;
