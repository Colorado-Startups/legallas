// SPDX-License-Identifier: Apache-2.0
// Research mode's client logic (plan D10 to D12), shared by the Ask page and the drawer. Pure: no DOM, so it
// is tested in node against the mock transport (research-mock.ts).
//
// A research answer is a quick Ask turn plus step counts: the same answer text, the same validated
// `citations` payload and the same done flags, so chat-render.ts draws it and its cites open the exhibit pane
// exactly as quick Ask's do. The shared events go through chat-client.ts applyEvent; research adds two of
// its own, `progress` (running counts) and `thread` (the new thread's id and title).
//
// The wire itself (worker/agent/protocol.ts: AI SDK UI message chunks over the Agents SDK socket or the HTTP
// fallback) is research-wire.ts's and research-transport.ts's business; this file sees only the transport below.
import { RESEARCH_QUESTION_COST, THREAD_ID } from '../../worker/agent/protocol.ts';
import { applyEvent, ERRORS, FALLBACK_ERROR, newTurn } from './chat-client.ts';
import type { SseEvent } from './chat-sse.ts';
import type { Turn } from './chat-store.ts';

/** Running counts of the agent's steps. Counts only: the browser never hears a query or a page's text. */
export interface ResearchSteps {
  searches: number;
  pages: number;
}

/**
 * A research answer: a quick Ask turn plus the steps that led to it (absent on a thread saved without them), and any
 * public-records checks the turn ran, as the wire gave them (records-card-model.ts checks them again before drawing).
 */
export type ResearchTurn = Turn & { steps?: ResearchSteps; records?: unknown[] };

/** One saved thread, as the list shows it. */
export interface ThreadSummary {
  id: string;
  title: string;
  /** ISO time of the thread's last question. */
  updatedAt: string;
  /** ISO time the room deletes the thread unless another question comes first. */
  expiresAt?: string;
}

/**
 * The research agent, as the UI sees it (research-transport.ts loads the real one; research-mock.ts stands in
 * for tests). Failures reject with a ResearchError, or arrive as an `error` event during `ask`.
 */
export interface ResearchTransport {
  /** The member's saved threads, newest first. */
  threads(): Promise<ThreadSummary[]>;
  /** Every turn of one thread, oldest first. */
  open(id: string): Promise<ResearchTurn[]>;
  /** Deletes one thread in the room. */
  remove(id: string): Promise<void>;
  /** Asks in `threadId` (null starts a thread) and calls `onEvent` for each event until the turn ends. */
  ask(threadId: string | null, question: string, onEvent: (event: SseEvent) => void): Promise<void>;
  /** Closes the connection; the next call opens a new one. */
  close(): void;
  /** True while research is off: threads can be listed, read and deleted, and `ask` refuses with research_off. */
  readOnly?: boolean;
}

/** A refusal with one of the error codes below or quick Ask's. */
export class ResearchError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** Research's own refusals, one sentence each (DESIGN.md section 9); quick Ask's ERRORS cover the rest. */
export const RESEARCH_ERRORS: Record<string, string> = {
  research_off: 'Research is off in this room; saved threads can still be opened and deleted, and quick answers still work.',
  answer_failed: 'The research stopped before its answer was finished; ask again in a minute.',
  research_busy: 'This thread is still answering; wait for it to finish, then ask again.',
  thread_missing: 'That thread has expired or was deleted.',
  connection_lost: 'The connection to the room dropped; ask again.',
  session_ended: 'Your session ended; reload the page to sign in, then ask again.',
  thread_limit: 'You have as many saved threads as the room keeps; delete one, then ask again.',
  budget_unavailable: "The room could not check today's AI allowance; try again in a minute.",
  research_unavailable: 'Research did not respond; try again in a minute.',
};

/** The one-sentence message for an error code. Unknown codes get the general fallback, never raw server text. */
export function researchMessage(code: string): string {
  return RESEARCH_ERRORS[code] ?? ERRORS[code] ?? FALLBACK_ERROR;
}

/** Said once when a research question starts; the counts line shows the steps as they happen. */
export const RESEARCH_STATUS = 'Researching the record.';

/** What one research question costs from the daily question cap (plan D10). */
export const RESEARCH_COST = RESEARCH_QUESTION_COST;

/**
 * The counts line: "Searched 3 times, read 12 pages", "Searched once", "Read 2 pages". Empty before the first
 * step, so a pending turn shows nothing rather than "Searched 0 times".
 */
export function progressText(steps: ResearchSteps | undefined): string {
  if (!steps) return '';
  const { searches, pages } = steps;
  const searched = searches === 1 ? 'Searched once' : searches > 1 ? `Searched ${searches} times` : '';
  const read = pages === 1 ? '1 page' : pages > 1 ? `${pages} pages` : '';
  if (searched && read) return `${searched}, read ${read}`;
  if (searched) return searched;
  return read ? `Read ${read}` : '';
}

/** A count from the wire: a whole number from 0 to 10,000, or null. */
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : null;
}

/** Running totals from a `progress` event; null for a malformed one, which is ignored. */
export function stepsOf(data: unknown): ResearchSteps | null {
  const d = (data ?? {}) as Record<string, unknown>;
  const searches = count(d.searches);
  const pages = count(d.pages);
  return searches === null || pages === null ? null : { searches, pages };
}

/** A thread id as the room issues it (protocol.ts); anything else is never sent back or put in a path. */
export { THREAD_ID };
const MAX_TITLE = 200;

/** A thread's title cleaned for the list: control characters gone, trimmed, at most 200 code points. */
export function cleanTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return [...raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, MAX_TITLE).join('');
}

/** The thread's date for the list: ISO `2026-10-20` in the reader's own time zone (DESIGN.md section 9). */
export function threadDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Callbacks for a research run: running totals, and the name of a new thread. */
export interface ResearchHooks {
  /** New running totals arrived. */
  progress?(steps: ResearchSteps): void;
  /** The room named the new thread (first question of a thread). */
  thread?(summary: Pick<ThreadSummary, 'id' | 'title'>): void;
  /** More answer text arrived; `turn.answer` holds all of it so far. */
  delta?(turn: ResearchTurn): void;
  /** The question failed before or during the answer; `message` is ready to show. */
  error?(message: string): void;
}

/** The outcome of a research run: its turn and the thread it belongs to. */
export interface ResearchResult {
  turn: ResearchTurn;
  /** The thread the turn belongs to; null when a new thread failed before the room named it. */
  threadId: string | null;
}

/** Applies one event to the turn; true once the answer is complete. */
function step(e: SseEvent, turn: ResearchTurn, hooks: ResearchHooks, named: (id: string) => void): boolean {
  const data = (e.data ?? {}) as Record<string, unknown>;
  if (e.event === 'progress') {
    const steps = stepsOf(data);
    if (!steps) return false;
    // Assigned on its own line: an optional call skips its arguments when there is no hook.
    turn.steps = steps;
    hooks.progress?.(steps);
    return false;
  }
  if (e.event === 'thread') {
    const id = typeof data.id === 'string' && THREAD_ID.test(data.id) ? data.id : null;
    if (id) {
      named(id);
      hooks.thread?.({ id, title: cleanTitle(data.title) });
    }
    return false;
  }
  if (e.event === 'records') {
    if (Array.isArray(data.checks)) turn.records = data.checks;
    return false;
  }
  if (e.event === 'error') {
    if (!turn.failed) hooks.error?.(researchMessage(String(data.error)));
    turn.failed = true;
    return false;
  }
  return applyEvent(e, turn, { delta: (t) => hooks.delta?.(t as ResearchTurn) });
}

/**
 * Asks one research question and resolves with the finished turn. A refused question resolves with `failed`
 * set and an empty answer; a stream that breaks keeps the text that arrived, as quick Ask does.
 */
export async function askResearch(transport: ResearchTransport, threadId: string | null, question: string, hooks: ResearchHooks = {}): Promise<ResearchResult> {
  const turn: ResearchTurn = { ...newTurn(question), steps: { searches: 0, pages: 0 } };
  let thread = threadId;
  let completed = false;
  try {
    await transport.ask(threadId, question, (e) => {
      completed = step(e, turn, hooks, (id) => (thread = id)) || completed;
    });
  } catch (err) {
    if (!turn.failed) hooks.error?.(researchMessage(err instanceof ResearchError ? err.code : 'connection_lost'));
    turn.failed = true;
  }
  if (!completed && !turn.failed) {
    turn.failed = true;
    hooks.error?.(ERRORS.answer_failed!);
  }
  return { turn, threadId: thread };
}

/** The list after a question: the thread moves to the top with its title and time (new threads are added). */
export function touchThread(list: readonly ThreadSummary[], summary: ThreadSummary): ThreadSummary[] {
  const old = list.find((t) => t.id === summary.id);
  const title = summary.title || old?.title || '';
  return [{ ...summary, title }, ...list.filter((t) => t.id !== summary.id)];
}
