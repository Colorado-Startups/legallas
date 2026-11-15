// SPDX-License-Identifier: Apache-2.0
// The research chat's contract (D10, D11) between the Worker (worker/index.ts and worker/agent/, PR 5b) and the browser
// (src/scripts/research-*.ts, session 6). Transport-agnostic: one research turn and the same AI SDK UI message chunks
// travel over a WebSocket by default or, when RESEARCH_ENABLED is "http", over an HTTP stream. Only the transport
// differs, never what the reader sees.
//
// Pure: type-only imports and no Workers or Node APIs, so browser code imports it too (like worker/law-cite.ts).
//
// Browser client (spike, worker/agent/SPIKE.md): no React. AgentClient from 'agents/client' with
// `basePath: threadPath('socket', id).slice(1)` opens the socket on our own path (never /agents/*), and
// WebSocketChatTransport from 'agents/chat/transport' turns it into the AI SDK ChatTransport whose sendMessages()
// returns a ReadableStream of UIMessageChunk. The HTTP fallback is a plain fetch of `turn`, read with the AI SDK's
// readUIMessageStream. Both modules load with a dynamic import, so the room's eager bundle stays within budget.
import type { UIMessage } from 'ai';
import type { Citation } from '../citations.ts';
import type { LawChunk } from '../law-cite.ts';
import type { RecordsView } from '../../mcp/tools/public-records.ts';

/** Bumped when a shape below changes in a way an older page cannot read. */
export const RESEARCH_PROTOCOL = 1;

/**
 * Every research path. All sit under /api/, so worker/index.ts verifies Access and the members row first, and a
 * thread is always the signed-in member's own (the Durable Object is chosen from the verified email, never from the
 * URL). Never routeAgentRequest's public /agents/* routes.
 */
/** The paths of the research API. */
export const RESEARCH_PATHS = {
  /** GET: ResearchStatus. */
  status: '/api/research',
  /** GET: ThreadSummary[], newest first. POST with an empty JSON object: a new empty thread, `{ id }` (201). */
  threads: '/api/research/threads',
  /** GET: the thread as the server holds it, ResearchUIMessage[]. DELETE: removes it (204). */
  thread: '/api/research/threads/:id',
  /** GET with `Upgrade: websocket`: the Agents SDK chat protocol for one thread (agents/chat/transport). */
  socket: '/api/research/threads/:id/socket',
  /** POST ResearchTurnRequest: the same turn as a UI message stream (toUIMessageStreamResponse), the HTTP fallback. */
  turn: '/api/research/threads/:id/turn',
  /** GET with `Upgrade: websocket`, owner only: the Wave 1 echo probe (worker/agent/probe.ts). `?via=do` reaches the Durable Object. */
  probe: '/api/research/probe',
  /**
   * POST, no body: closes every research socket the member holds (close code 4401), in every tab. The page sends it
   * (navigator.sendBeacon) when Sign out is clicked, before Access ends the session; 204 either way.
   */
  signout: '/api/research/signout',
} as const;

/** Thread ids are minted by the server; a client only echoes one back. */
export const THREAD_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** A path with its thread id filled in. Throws on an id the server would never mint, so no path is built from junk. */
export function threadPath(path: 'thread' | 'socket' | 'turn', id: string): string {
  if (!THREAD_ID.test(id)) throw new RangeError('bad thread id');
  return RESEARCH_PATHS[path].replace(':id', id);
}

/** How the research chat reaches the browser. */
export type ResearchTransport = 'websocket' | 'http';

/**
 * RESEARCH_ENABLED read as a transport: "1" is the WebSocket, "http" the HTTP stream (the fallback if the Wave 1 probe
 * shows Access refusing WebSockets). Anything else, or unset, is off: the kill switch fails closed.
 */
export function researchTransport(value: string | undefined): ResearchTransport | null {
  if (value === '1') return 'websocket';
  if (value === 'http') return 'http';
  return null;
}

/** One research question counts this many against the member's daily question cap (DAILY_QUESTION_CAP; D10). */
export const RESEARCH_QUESTION_COST = 3;
/** The longest question, in characters; the same as quick Ask's (worker/ask.ts MAX_QUESTION_CHARS). */
export const RESEARCH_MAX_QUESTION_CHARS = 2000;
/** A thread is deleted this many days after its last turn (D12). */
export const THREAD_TTL_DAYS = 90;

/** GET status: whether this member sees the Research toggle, and over which transport. */
export interface ResearchStatus {
  protocol: typeof RESEARCH_PROTOCOL;
  /** True only when RESEARCH_ENABLED is on and the member's role may ask. */
  enabled: boolean;
  transport: ResearchTransport | null;
  questionCost: number;
  maxQuestionChars: number;
}

/** One row of the thread list. Dates are ISO 8601 (UTC). */
export interface ThreadSummary {
  id: string;
  /** Plain text, at most 80 characters, from the thread's first question. */
  title: string;
  updatedAt: string;
  /** When the thread will be deleted unless another turn comes first. */
  expiresAt: string;
}

/** POST threads: the new thread's id. */
export interface ThreadCreated {
  id: string;
}

/** POST turn (HTTP fallback): the new question only. The thread's history is the server's, never the client's. */
export interface ResearchTurnRequest {
  question: string;
}

/**
 * Running totals for one turn, sent after every tool step: counts only, never a query, a name, a document id or text
 * (D10). The browser shows them as "Searched 3 times, read 12 pages".
 */
export interface ResearchProgress {
  /** Tool steps finished. */
  steps: number;
  /** Searches of the record or the law library. */
  searches: number;
  /** Distinct documents opened or listed. */
  documents: number;
  /** Pages read. */
  pages: number;
}

/** The citations of the final answer: exactly quick Ask's `citations` event payload (worker/ask-stream.ts). */
export interface ResearchCitations {
  citations: Citation[];
  law?: LawChunk[];
}

/** The verdict after the answer: quick Ask's `done` flags. */
export interface ResearchVerdict {
  dontKnow: boolean;
  /** The final answer stopped at its token limit. */
  truncated?: boolean;
}

/**
 * What legallas_check_public_records returned in a turn (mcp/tools/public-records.ts RecordsView): an approval link, a
 * decline, or a check with its sources, findings and notices. The page draws each as a card beside the answer.
 */
export interface ResearchRecords {
  checks: RecordsView[];
}

/** Sent once, on a thread's first turn, with the title the list will show. */
export interface ResearchThreadTitle {
  id: string;
  title: string;
}

/**
 * The data parts a research answer carries, as AI SDK typed data parts: each arrives as a `data-<name>` chunk and stays
 * on the stored assistant message. Tool parts may also appear in the stream and in history; the browser ignores them
 * and reads progress only from `data-progress`, so no query text needs to reach the page.
 */
export type ResearchDataParts = {
  progress: ResearchProgress;
  citations: ResearchCitations;
  verdict: ResearchVerdict;
  thread: ResearchThreadTitle;
  records: ResearchRecords;
};

/** A message of the research chat. */
export type ResearchUIMessage = UIMessage<unknown, ResearchDataParts>;

/**
 * The error codes a page may see, as `{ error }` JSON before a stream starts or as an `error` chunk's `errorText` inside
 * one: quick Ask's codes plus the research ones. The page shows its own sentence for each and never raw text.
 */
export const RESEARCH_ERRORS = [
  // Research only.
  'research_off',
  'research_busy',
  'thread_missing',
  'thread_limit',
  // The same as quick Ask (worker/routes/ask.ts, worker/ask-stream.ts).
  'bad_request',
  'empty_question',
  'question_too_long',
  'forbidden',
  'rate_limited',
  'daily_limit',
  'ai_budget',
  'search_budget',
  'budget_unavailable',
  'search_unavailable',
  'model_unavailable',
  'answer_failed',
] as const;

/** The name of an error that the research API can return. */
export type ResearchError = (typeof RESEARCH_ERRORS)[number];

/**
 * Close codes the server ends a research socket with. All are 4000 to 4999, which AgentClient treats as final, so the
 * page does not reconnect into a refusal.
 */
export const RESEARCH_CLOSE = {
  /** The Access session expired (its JWT `exp`) or the member signed out: reload to sign in again. */
  sessionEnded: 4401,
  /** No longer a member, or the role may not ask. */
  forbidden: 4403,
  /** RESEARCH_ENABLED was turned off. */
  off: 4503,
} as const;

/**
 * The question of a turn that arrived as AI SDK messages (the WebSocket transport sends the page's whole message
 * list): the text of the last message, and only when it is the member's own. Everything earlier, every assistant or
 * tool part and every data part a client sends is ignored, so client history can never add a citable page or a fake
 * tool result (D10). Null when the last message is not a user message with text.
 */
export function questionOf(messages: readonly UIMessage[]): string | null {
  const last = messages.at(-1);
  if (!last || last.role !== 'user') return null;
  const text = last.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof (part as { text?: unknown }).text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
  return text === '' ? null : text;
}

/** The echo probe's frames (probe.ts): a hello naming the path it reached, then one numbered pong per message. */
export type ProbeFrame = { type: 'hello'; via: 'worker' | 'do' } | { type: 'pong'; n: number };
