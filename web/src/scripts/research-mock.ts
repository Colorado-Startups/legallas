// SPDX-License-Identifier: Apache-2.0
// A stand-in research agent for tests (and for building the UI before 5a's client existed). It keeps threads
// in memory as UIMessage lists and answers with UI message chunks, so everything the UI reads passes through
// research-wire.ts exactly as the real agent's would. Fictional DOE fixture only; never loaded in production
// (research-transport.ts loads the real client).
import type { SseEvent } from './chat-sse.ts';
import { ResearchError, THREAD_ID, type ResearchTransport, type ResearchTurn, type ThreadSummary } from './research-client.ts';
import { chunkReader, PARTS, threadsFrom, turnsFrom } from './research-wire.ts';

type Message = { id: string; role: 'user' | 'assistant'; createdAt: string; parts: Record<string, unknown>[] };

interface MockThread {
  id: string;
  title: string;
  updatedAt: string;
  messages: Message[];
}

/** Options for the mock research backend: the chunks to stream, and an error code to refuse with. */
export interface MockOptions {
  /** The chunks one answer streams; the default searches twice, reads 7 pages and cites DOE fixture pages. */
  script?: (question: string) => Record<string, unknown>[];
  /** Refuse every call with this error code (for example `research_off`). */
  refuse?: string;
  /** Milliseconds between chunks; 0 yields to the event loop only. */
  delayMs?: number;
  /** The clock, for stable dates in tests. */
  now?: () => Date;
}

/** The fixture's cited documents (quick Ask's test fixture: DOE control numbers, fictional names). */
export const MOCK_CITATIONS = [
  { id: 'doc-a', page: 1, name: 'Repair-Ticket.pdf', control_seq: 231, quote: 'Signed by R. Roe.' },
  { id: 'doc-b', page: 2, name: 'Email.pdf', control_seq: 232, quote: null },
];

/** The default answer: two searches, seven pages read, a Fact and a Read with cites, then the verdict. */
export function defaultScript(): Record<string, unknown>[] {
  return [
    { type: 'start' },
    { type: 'tool-input-available', toolCallId: 't1', toolName: 'legallas_search', input: {} },
    { type: PARTS.progress, data: { searches: 1, pages: 0 }, transient: true },
    { type: PARTS.progress, data: { searches: 1, pages: 4 }, transient: true },
    { type: PARTS.progress, data: { searches: 2, pages: 7 }, transient: true },
    { type: 'text-start', id: 'x' },
    { type: 'text-delta', id: 'x', delta: '- CONFIRMED: Roe signed the repair ticket [doc:doc-a p.1].\n' },
    { type: 'text-delta', id: 'x', delta: '- READ: The email asks for a signature [doc:doc-b p.2].' },
    { type: 'text-end', id: 'x' },
    { type: PARTS.citations, data: { citations: MOCK_CITATIONS } },
    { type: PARTS.verdict, data: { dontKnow: false } },
    { type: 'finish' },
  ];
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The parts an answer leaves in the saved thread: its text and the data parts that are not transient. */
function savedParts(chunks: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const text = chunks.filter((c) => c.type === 'text-delta').map((c) => String(c.delta)).join('');
  const last = [...chunks].reverse().find((c) => c.type === PARTS.progress);
  const data = chunks.filter((c) => typeof c.type === 'string' && c.type.startsWith('data-') && !c.transient);
  return [...(text ? [{ type: 'text', text }] : []), ...data, ...(last ? [{ type: last.type, data: last.data }] : [])];
}

/** A mock transport with its own in-memory threads. */
export function mockTransport(options: MockOptions = {}): ResearchTransport & { calls: string[] } {
  const threads = new Map<string, MockThread>();
  const calls: string[] = [];
  const now = options.now ?? (() => new Date());
  let seq = 0;
  const guard = (call: string) => {
    calls.push(call);
    if (options.refuse) throw new ResearchError(options.refuse);
  };
  const find = (id: string): MockThread => {
    const thread = THREAD_ID.test(id) ? threads.get(id) : undefined;
    if (!thread) throw new ResearchError('thread_missing');
    return thread;
  };
  return {
    calls,
    async threads(): Promise<ThreadSummary[]> {
      guard('threads');
      return threadsFrom([...threads.values()].map(({ id, title, updatedAt }) => ({ id, title, updatedAt })));
    },
    async open(id: string): Promise<ResearchTurn[]> {
      guard(`open ${id}`);
      return turnsFrom(find(id).messages);
    },
    async remove(id: string): Promise<void> {
      guard(`remove ${id}`);
      find(id);
      threads.delete(id);
    },
    async ask(threadId: string | null, question: string, onEvent: (event: SseEvent) => void): Promise<void> {
      guard(`ask ${threadId ?? 'new'}`);
      const at = now().toISOString();
      const thread = threadId === null ? { id: `t${++seq}`, title: question.slice(0, 80), updatedAt: at, messages: [] } : find(threadId);
      const read = chunkReader(onEvent);
      if (threadId === null) {
        threads.set(thread.id, thread);
        read({ type: PARTS.thread, data: { id: thread.id, title: thread.title }, transient: true });
      }
      thread.messages.push({ id: `m${++seq}`, role: 'user', createdAt: at, parts: [{ type: 'text', text: question }] });
      thread.updatedAt = at;
      const chunks = (options.script ?? defaultScript)(question);
      for (const chunk of chunks) {
        await pause(options.delayMs ?? 0);
        read(chunk);
      }
      const parts = savedParts(chunks);
      if (parts.length) thread.messages.push({ id: `m${++seq}`, role: 'assistant', createdAt: at, parts });
    },
    close() {
      calls.push('close');
    },
  };
}
