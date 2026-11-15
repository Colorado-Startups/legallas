// SPDX-License-Identifier: Apache-2.0
// One question to /api/ask (card P7), shared by the Ask page and the drawer. The question travels only in the
// POST body. The stream is read with chat-sse.ts; the caller hears every step through `hooks` so it can draw
// the answer and drive the companion from real state only.
import { sseParser, type SseEvent } from './chat-sse.ts';
import { glyphWhile, headerGlyph, type GlyphHost } from './glyph.ts';
import type { Turn } from './chat-store.ts';
import type { ValidCitation, ValidLaw } from './sanitize.ts';
import { assistantName } from './room-names.ts';
import { ownerName } from '../../worker/room-settings.ts';

/** The longest question the box accepts, in characters. */
export const MAX_CHARS = 2000;

/** One sentence each, saying what happened and what to do (DESIGN.md section 9). */
export const ERRORS: Record<string, string> = {
  daily_limit: "You have reached today's question limit, which resets at midnight UTC.",
  rate_limited: 'That is a lot of questions in one minute; wait a minute, then ask again.',
  question_too_long: `Questions can be at most ${MAX_CHARS} characters.`,
  empty_question: 'Type a question first.',
  forbidden: 'Your role in this room cannot ask questions.',
  search_unavailable: 'The document index did not respond; try again in a minute.',
  model_unavailable: 'The answer service did not respond; try again in a minute.',
  answer_failed: 'The answer was cut off. Ask again.',
  // The room's spend budget (worker/budget.ts): Workers AI per UTC day, AI Search per UTC month.
  ai_budget: `${assistantName()} has used today's AI allowance, which resets at midnight UTC; ask again then.`,
  search_budget: "The document search has used this month's allowance, which resets on the 1st (UTC); ask again then.",
};
/** The error shown when a failed question has no more specific message. */
export const FALLBACK_ERROR = `The question did not go through; try again, and tell ${ownerName} if it keeps happening.`;

/** Callbacks the ask call fires as the server reads documents and streams an answer. */
export interface AskHooks {
  /** The server retrieved this many documents and pages (counts only). */
  reading?(documents: number, pages: number): void;
  /** More answer text arrived; `turn.answer` holds all of it so far. */
  delta?(turn: Turn): void;
  /** The request failed before or during the answer; `message` is ready to show. */
  error?(message: string): void;
}

/** Said politely while a question is answered; the streamed text itself stays silent (aria-live off). */
export const READING_STATUS = 'Reading the record.';

/**
 * The one polite announcement when an answer finishes (WCAG 4.1.3), so a screen reader hears that it arrived
 * without hearing every streamed word. Empty for a failed turn, whose error message is announced instead.
 */
export function answerStatus(turn: Pick<Turn, 'answer' | 'citations' | 'dontKnow' | 'truncated' | 'failed'>): string {
  if (turn.failed || !turn.answer) return '';
  if (turn.dontKnow) return 'Answer ready: not in the record.';
  const n = turn.citations.length;
  return `${turn.truncated ? 'Answer cut off' : 'Answer ready'}, ${n === 1 ? '1 cite' : `${n} cites`}.`;
}

/**
 * What goes back in the question box after a turn that produced no answer at all (a 503, a 429 or a dropped
 * request): the question, so the reader can press Ask again instead of retyping it. Null when the turn has an
 * answer, did not fail, or the reader has already typed something new.
 */
export function questionToRestore(turn: Pick<Turn, 'question' | 'answer' | 'failed'>, current: string): string | null {
  if (!turn.failed || turn.answer || current.trim()) return null;
  return turn.question;
}

/** Starts a chat turn for a question, with an empty answer and the current time. */
export function newTurn(question: string): Turn {
  return { question, answer: '', citations: [], dontKnow: false, failed: false, at: new Date().toISOString() };
}

async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : '';
  } catch {
    return '';
  }
}

/** Applies one SSE event to `turn`; true when the answer is done. Exported for tests. */
export function applyEvent(e: SseEvent, turn: Turn, hooks: AskHooks): boolean {
  const data = (e.data ?? {}) as Record<string, unknown>;
  if (e.event === 'reading' && typeof data.documents === 'number' && typeof data.pages === 'number') {
    // The law library reached this answer: an empty law list puts the view in law mode while it streams.
    if (data.law === true) turn.law = [];
    hooks.reading?.(data.documents, data.pages);
  } else if (e.event === 'delta' && typeof data.text === 'string') {
    turn.answer += data.text;
    hooks.delta?.(turn);
  } else if (e.event === 'citations' && Array.isArray(data.citations)) {
    turn.citations = data.citations as ValidCitation[];
    if (Array.isArray(data.law)) turn.law = data.law as ValidLaw[];
  } else if (e.event === 'done') {
    turn.dontKnow = data.dontKnow === true;
    // The model stopped at max_tokens: the text so far stands, with a note that it was cut off.
    if (data.truncated === true) turn.truncated = true;
    return true;
  } else if (e.event === 'error') {
    turn.failed = true;
    hooks.error?.(ERRORS[String(data.error)] ?? FALLBACK_ERROR);
  }
  return false;
}

async function read(response: Response, turn: Turn, hooks: AskHooks): Promise<void> {
  const reader = response.body!.getReader(); // safe: the caller checked response.body
  const decoder = new TextDecoder();
  const parser = sseParser();
  let completed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const events = done ? parser.end() : parser.push(decoder.decode(value, { stream: true }));
      for (const e of events) completed = applyEvent(e, turn, hooks) || completed;
      if (done) break;
    }
  } catch {
    // A dropped connection is reported below, once.
  }
  if (!completed && !turn.failed) {
    turn.failed = true;
    hooks.error?.(ERRORS.answer_failed!);
  }
}

/**
 * askQuestion with the header glyph (and any `extra` glyph, such as the drawer's) showing working while the
 * request runs, then done, or error when the turn failed (R55).
 */
export async function askTracked(question: string, hooks: AskHooks = {}, extra: GlyphHost | null = null): Promise<Turn> {
  const request = askQuestion(question, hooks).then((turn) => (turn.failed ? Promise.reject(turn) : turn));
  for (const glyph of [headerGlyph(), extra]) if (glyph) void glyphWhile(glyph, request).catch(() => undefined);
  return request.catch((turn: Turn) => turn);
}

/**
 * Asks one question and resolves with the finished turn. A refused request resolves with `failed` set and
 * an empty answer; a stream that breaks keeps the text that arrived.
 */
export async function askQuestion(question: string, hooks: AskHooks = {}): Promise<Turn> {
  const turn = newTurn(question);
  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ question }),
    });
    if (!response.ok || !response.body) {
      turn.failed = true;
      hooks.error?.(ERRORS[await errorCode(response)] ?? FALLBACK_ERROR);
      return turn;
    }
    await read(response, turn, hooks);
  } catch {
    turn.failed = true;
    hooks.error?.(FALLBACK_ERROR);
  }
  return turn;
}
