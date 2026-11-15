// SPDX-License-Identifier: Apache-2.0
// Research mode's wire, read in one place (plan D11). The research agent (`LegallasResearch`, an AIChatAgent)
// streams AI SDK UI message chunks, over its WebSocket or through `toUIMessageStreamResponse` on the HTTP
// fallback; saved threads come back as UIMessage lists. This file turns both into what research-client.ts
// reads: quick Ask's events (`delta`, `citations`, `done`, `error`) plus `progress`, `thread` and `records`.
//
// The data part names are worker/agent/protocol.ts ResearchDataParts, and the error codes its RESEARCH_ERRORS.
// Everything here is untrusted input: unknown chunks are ignored, shapes are checked, and error text from the wire is
// never shown, only a known code.
import { RESEARCH_CLOSE, RESEARCH_ERRORS, type ResearchDataParts } from '../../worker/agent/protocol.ts';
import type { SseEvent } from './chat-sse.ts';
import { cleanTitle, stepsOf, THREAD_ID, type ResearchTurn, type ThreadSummary } from './research-client.ts';

/** The data parts the agent adds to its UI message stream (protocol.ts ResearchDataParts as `data-<name>` chunks). */
export const PARTS = {
  progress: 'data-progress',
  citations: 'data-citations',
  verdict: 'data-verdict',
  thread: 'data-thread',
  records: 'data-records',
} as const satisfies { [K in keyof ResearchDataParts]: `data-${K}` };

/** The codes the room may send (protocol.ts); any other error text reads as `research_unavailable`. */
const CODES: ReadonlySet<string> = new Set(RESEARCH_ERRORS);

type Chunk = Record<string, unknown>;

function record(value: unknown): Chunk | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Chunk) : null;
}

/** The error code an `error` chunk carries, if it is one the UI knows. */
export function errorCode(text: unknown): string {
  return typeof text === 'string' && CODES.has(text.trim()) ? text.trim() : 'research_unavailable';
}

/**
 * The error code for a research socket's close, or null for an ordinary close (the socket may reconnect). The room's
 * own codes (protocol.ts RESEARCH_CLOSE) are final: a sign-in that ended, a member who may no longer ask, research off.
 */
export function closeCode(code: number): string | null {
  if (code === RESEARCH_CLOSE.sessionEnded) return 'session_ended';
  if (code === RESEARCH_CLOSE.forbidden) return 'forbidden';
  if (code === RESEARCH_CLOSE.off) return 'research_off';
  return code >= 4000 && code <= 4999 ? 'research_unavailable' : null;
}

/** quick Ask's `done` flags from a verdict part. */
function verdict(data: Chunk | null): { dontKnow: boolean; truncated?: true } {
  return { dontKnow: data?.dontKnow === true, ...(data?.truncated === true ? { truncated: true as const } : {}) };
}

/**
 * The events one UI message chunk carries: none for chunks the UI does not read (tool steps, reasoning, starts
 * and ends). `finish` becomes `done` only when no verdict came first (`verdictSeen`), so every turn ends once.
 */
export function chunkEvents(raw: unknown, verdictSeen = false): SseEvent[] {
  const chunk = record(raw);
  if (!chunk || typeof chunk.type !== 'string') return [];
  const data = record(chunk.data);
  switch (chunk.type) {
    case 'text-delta':
      return typeof chunk.delta === 'string' ? [{ event: 'delta', data: { text: chunk.delta } }] : [];
    case PARTS.progress:
      return [{ event: 'progress', data: chunk.data }];
    case PARTS.citations:
      return Array.isArray(data?.citations) ? [{ event: 'citations', data: { citations: data.citations, ...(Array.isArray(data.law) ? { law: data.law } : {}) } }] : [];
    case PARTS.verdict:
      return [{ event: 'done', data: verdict(data) }];
    case PARTS.thread:
      return [{ event: 'thread', data: chunk.data }];
    case PARTS.records:
      return Array.isArray(data?.checks) ? [{ event: 'records', data: { checks: data.checks } }] : [];
    case 'error':
      return [{ event: 'error', data: { error: errorCode(chunk.errorText) } }];
    case 'finish':
      return verdictSeen ? [] : [{ event: 'done', data: { dontKnow: false } }];
    default:
      return [];
  }
}

/** A chunk reader for one turn: it remembers whether the verdict came, so `finish` never ends a turn twice. */
export function chunkReader(onEvent: (event: SseEvent) => void): (raw: unknown) => void {
  let verdictSeen = false;
  return (raw) => {
    for (const e of chunkEvents(raw, verdictSeen)) {
      if (e.event === 'done') verdictSeen = true;
      onEvent(e);
    }
  };
}

/** The saved threads from the wire, malformed rows dropped, newest first. */
export function threadsFrom(raw: unknown): ThreadSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: ThreadSummary[] = [];
  for (const row of raw) {
    const r = record(row);
    if (!r || typeof r.id !== 'string' || !THREAD_ID.test(r.id) || typeof r.updatedAt !== 'string') continue;
    if (Number.isNaN(Date.parse(r.updatedAt))) continue;
    const expires = typeof r.expiresAt === 'string' && !Number.isNaN(Date.parse(r.expiresAt)) ? { expiresAt: r.expiresAt } : {};
    out.push({ id: r.id, title: cleanTitle(r.title), updatedAt: r.updatedAt, ...expires });
  }
  return out.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/** The text of a message's text parts, joined. */
function textOf(parts: readonly unknown[]): string {
  return parts.map((p) => record(p)).filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p!.text as string).join('');
}

/** An assistant message's parts applied to its turn: text, cites, verdict and step counts. */
function fillAnswer(turn: ResearchTurn, parts: readonly unknown[]): void {
  turn.answer = textOf(parts);
  let done = false;
  for (const part of parts.map(record)) {
    if (!part) continue;
    const data = record(part.data);
    if (part.type === PARTS.citations && Array.isArray(data?.citations)) {
      turn.citations = data.citations as ResearchTurn['citations'];
      if (Array.isArray(data.law)) turn.law = data.law as ResearchTurn['law'];
    } else if (part.type === PARTS.verdict) {
      done = true;
      Object.assign(turn, verdict(data));
    } else if (part.type === PARTS.progress) {
      turn.steps = stepsOf(part.data) ?? turn.steps;
    } else if (part.type === PARTS.records && Array.isArray(data?.checks)) {
      turn.records = data.checks;
    }
  }
  // An answer saved without its verdict (the stream broke) shows as cut off, never as complete.
  if (!done && turn.answer) turn.truncated = true;
}

/**
 * A saved thread's UIMessage list as turns, oldest first: each user message opens a turn and the assistant
 * message after it answers it. A question with no answer (it failed) is kept as a failed turn.
 */
export function turnsFrom(raw: unknown): ResearchTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ResearchTurn[] = [];
  for (const message of raw.map(record)) {
    if (!message || !Array.isArray(message.parts)) continue;
    const at = typeof message.createdAt === 'string' && !Number.isNaN(Date.parse(message.createdAt)) ? message.createdAt : '';
    if (message.role === 'user') {
      turns.push({ question: textOf(message.parts), answer: '', citations: [], dontKnow: false, failed: true, at });
    } else if (message.role === 'assistant') {
      const turn = turns.at(-1);
      if (!turn || turn.answer) continue;
      fillAnswer(turn, message.parts);
      turn.failed = !turn.answer;
    }
  }
  return turns.filter((t) => t.question);
}
