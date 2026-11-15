// SPDX-License-Identifier: Apache-2.0
// The research agent's client (plan D11, worker/agent/protocol.ts). Reached only through research-panel.ts, which the
// Ask page and the drawer import dynamically, so no page pays for it up front (the 60 KB eager budget,
// scripts/bundle-budget.ts). Same origin only: every request goes to this room's /api/research paths (CSP 'self').
//
// The thread list, a thread's messages, delete and new threads are plain room requests. A turn goes over the transport
// GET /api/research names: the Agents SDK WebSocket (research-socket.ts, imported only then, since it carries the
// agents client) or the HTTP fallback, a POST whose response is the same UI message stream as SSE. Either way the
// chunks go through research-wire.ts, so the reader sees the same thing.
import { RESEARCH_PATHS, threadPath, THREAD_ID } from '../../worker/agent/protocol.ts';
import type { SseEvent } from './chat-sse.ts';
import { sseParser } from './chat-sse.ts';
import { ResearchError, type ResearchTransport } from './research-client.ts';
import { researchStatus } from './research-mode.ts';
import { chunkReader, errorCode, threadsFrom, turnsFrom } from './research-wire.ts';
import { ROOM_FETCH_HEADERS, showSessionEnded } from './session-ended.ts';

/** How long a list, thread, delete or create request may take; streamed turns have no limit. */
const FETCH_TIMEOUT_MS = 30_000;

/** Sends one turn's question on thread `id`; `read` takes each UI message chunk as it arrives. */
export type TurnSender = (id: string, question: string, read: (chunk: unknown) => void) => Promise<void>;

/** The code a refused room request carries: its `{ error }`, or what its status means. */
async function refusal(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const code = errorCode(body?.error);
  return code === 'research_unavailable' && response.status === 404 ? 'thread_missing' : code;
}

/** A same-origin room request. A refusal throws a ResearchError with its code; a 401 also shows the notice. */
async function room(path: string, init: RequestInit = {}, timeout = true): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: { ...ROOM_FETCH_HEADERS, ...(init.headers as Record<string, string> | undefined) },
      ...(timeout ? { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) } : {}),
    });
  } catch {
    throw new ResearchError('connection_lost');
  }
  if (response.status === 401) {
    showSessionEnded();
    throw new ResearchError('session_ended');
  }
  if (!response.ok) throw new ResearchError(await refusal(response));
  return response;
}

const JSON_BODY = { 'Content-Type': 'application/json' };

/** A thread's messages as the room holds them (protocol.ts ResearchUIMessage[]), unread. */
export async function threadMessages(id: string): Promise<unknown[]> {
  const raw: unknown = await (await room(threadPath('thread', id))).json();
  return Array.isArray(raw) ? raw : [];
}

/** A new empty thread's id (POST threads, 201). */
async function createThread(): Promise<string> {
  const raw = (await (await room(RESEARCH_PATHS.threads, { method: 'POST', headers: JSON_BODY, body: '{}' })).json()) as { id?: unknown };
  if (typeof raw?.id !== 'string' || !THREAD_ID.test(raw.id)) throw new ResearchError('research_unavailable');
  return raw.id;
}

/** The HTTP fallback's turn: the response is the UI message stream as SSE, one JSON chunk per `data:` line. */
export const httpTurn: TurnSender = async (id, question, read) => {
  const response = await room(threadPath('turn', id), {
    method: 'POST',
    headers: { ...JSON_BODY, Accept: 'text/event-stream' },
    body: JSON.stringify({ question }),
  }, false);
  if (!response.body) throw new ResearchError('research_unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = sseParser();
  const take = (events: SseEvent[]) => events.forEach((e) => read(e.data));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      take(done ? parser.end() : parser.push(decoder.decode(value, { stream: true })));
      if (done) return;
    }
  } catch {
    throw new ResearchError('connection_lost');
  }
};

/** While research is off a question is refused here, before any request: listing, reading and deleting stay open. */
export const offTurn: TurnSender = async () => {
  throw new ResearchError('research_off');
};

/** The room's transport over one turn sender. A question with no thread first makes one and names it. */
export function roomTransport(turn: TurnSender, close: () => void = () => undefined): ResearchTransport {
  return {
    ...(turn === offTurn ? { readOnly: true } : {}),
    async threads() {
      return threadsFrom(await (await room(RESEARCH_PATHS.threads)).json());
    },
    async open(id) {
      return turnsFrom(await threadMessages(id));
    },
    async remove(id) {
      await room(threadPath('thread', id), { method: 'DELETE' });
    },
    async ask(threadId, question, onEvent) {
      if (turn === offTurn) return offTurn('', question, () => undefined);
      let id = threadId;
      if (id === null) {
        id = await createThread();
        onEvent({ event: 'thread', data: { id, title: '' } });
      }
      await turn(id, question, chunkReader(onEvent));
    },
    close,
  };
}

/**
 * The research agent's transport for this page: read-only while research is off (the switch shows then only for a
 * member with saved threads), or null when the room's status is unknown.
 */
export async function loadTransport(): Promise<ResearchTransport | null> {
  const status = await researchStatus();
  if (!status) return null;
  if (!status.enabled || status.transport === null) return roomTransport(offTurn);
  if (status.transport === 'http') return roomTransport(httpTurn);
  const { socketTurns } = await import('./research-socket.ts');
  const sockets = socketTurns(threadMessages);
  return roomTransport(sockets.turn, sockets.close);
}
