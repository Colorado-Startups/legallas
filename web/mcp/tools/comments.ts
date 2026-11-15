// SPDX-License-Identifier: Apache-2.0
// legallas_get_comments: a document's comment threads with their replies, pages, authors and resolved state
// (owner: session 3, plan D3 and D5). Owner and counsel only (readComments); any other role cannot connect at all,
// and would be refused here too. The document is found through documents.ts findLiveDocument (NOT_HIDDEN_SQL,
// removed_at IS NULL, privilegeFilter) and its thread through worker/comments.ts listThread, which keeps
// privilegeFilter again (D14). Comment text is wrapped with caseData like document text: members write it, but it
// quotes and argues about a record that includes the other side's documents. A comment that addresses an AI is fenced
// as untrusted, with its page but no link, under Ask's reminder (mcp/untrusted.ts, worker/quarantine.ts).
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { canPerform } from '../../worker/auth.ts';
import { listThread, type Comment } from '../../worker/comments.ts';
import { MAX_CHARS_PER_READ, type ResultLimits, type ToolContext, type ToolDefinition } from '../contract.ts';
import { caseData, decodeCursor, docLink, encodeCursor, fitToProfile, jsonResult, limitsFor, retrievedOn, toolError } from '../format.ts';
import { DOC_ID, documentFields, documentNotFound, findLiveDocument } from './documents.ts';
import { withToolPrefix } from '../tool-prefix.ts';
import { markUntrusted, noted, untrustedIn, untrustedReason, type Untrusted } from '../untrusted.ts';
import { COMMENTS_OUTPUT } from './output.ts';

/**
 * Threads and characters per result for the standard profile: as much text as legallas_read_pages returns. format.ts
 * limitsFor narrows them to COMPACT_LIMITS for Microsoft and unknown clients (plan D6).
 */
export const COMMENT_LIMITS: ResultLimits = { maxItems: 100, maxChars: MAX_CHARS_PER_READ };

/** One comment as returned. A reply's page is its own; resolved state belongs to the thread. */
export interface CommentEntry {
  id: string;
  author: string;
  created: string;
  page: number | null;
  /** Absent on an untrusted comment: it is not offered as a cite. */
  link?: string;
  text: string;
  /** Present when the text was cut to fit the result; the room link shows it whole. */
  truncated?: true;
  untrusted?: Untrusted;
}

/** A comment thread entry: a comment with its resolved state. */
export interface ThreadEntry extends CommentEntry {
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  replies: CommentEntry[];
  /** Replies left out because the thread alone was longer than one result. */
  replies_omitted?: number;
}

/** A top-level comment and its replies, oldest first. */
export interface Thread {
  head: Comment;
  replies: Comment[];
}

/**
 * The thread's comments grouped under their top-level comment, in the order the threads were started. `orphans`
 * counts replies whose top-level comment fell outside listThread's newest MAX_THREAD.
 */
export function groupThreads(comments: readonly Comment[]): { threads: Thread[]; orphans: number } {
  const threads = new Map<string, Thread>();
  for (const comment of comments) if (comment.parent_id === null) threads.set(comment.id, { head: comment, replies: [] });
  let orphans = 0;
  for (const comment of comments) {
    if (comment.parent_id === null) continue;
    const thread = threads.get(comment.parent_id);
    if (thread) thread.replies.push(comment);
    else orphans += 1;
  }
  return { threads: [...threads.values()], orphans };
}

/** Whether the thread is about `page`: its top-level comment or any reply names that page. */
export function onPage(thread: Thread, page: number): boolean {
  return thread.head.page === page || thread.replies.some((reply) => reply.page === page);
}

/** Cuts text to at most max UTF-16 units without splitting a surrogate pair. */
function cut(text: string, max: number): string {
  const head = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
}

/** One comment, judged on its whole text however much is sent, by its words alone: a comment is not a document. */
function entry(documentId: string, comment: Comment, maxText: number): CommentEntry {
  const short = comment.body.length > maxText;
  const body = short ? cut(comment.body, maxText) : comment.body;
  const out: CommentEntry = {
    id: comment.id,
    author: comment.author_name ?? comment.author_email,
    created: comment.created_at,
    page: comment.page,
    link: docLink(documentId, comment.page),
    text: body === '' ? '' : caseData(body, untrustedReason(comment.body)),
  };
  if (short) out.truncated = true;
  return markUntrusted(out, ['page']);
}

/** A thread as returned, each comment's text cut to maxText and only its first `replies` replies kept. */
export function renderThread(documentId: string, thread: Thread, maxText = Infinity, replies = thread.replies.length): ThreadEntry {
  const { head } = thread;
  const out: ThreadEntry = {
    ...entry(documentId, head, maxText),
    resolved: head.resolved_at !== null,
    resolved_at: head.resolved_at,
    resolved_by: head.resolved_at === null ? null : (head.resolved_by_name ?? head.resolved_by),
    replies: thread.replies.slice(0, replies).map((reply) => entry(documentId, reply, maxText)),
  };
  if (replies < thread.replies.length) out.replies_omitted = thread.replies.length - replies;
  return out;
}

/**
 * The first thread alone, made to fit `chars`: replies are halved until the thread without text fits, then
 * every comment is cut to an equal share of what is left, smaller each round until the whole result fits.
 */
function shrinkThread(documentId: string, thread: Thread, chars: number, measure: (shown: ThreadEntry[]) => number): ThreadEntry {
  let replies = thread.replies.length;
  while (replies > 0 && measure([renderThread(documentId, thread, 0, replies)]) > chars) replies = Math.floor(replies / 2);
  const bare = measure([renderThread(documentId, thread, 0, replies)]);
  let share = Math.max(0, Math.floor((chars - bare) / (replies + 1)));
  let shown = renderThread(documentId, thread, share, replies);
  while (share > 0 && measure([shown]) > chars) {
    share = Math.floor(share * 0.8);
    shown = renderThread(documentId, thread, share, replies);
  }
  return shown;
}

/**
 * Characters `entry` adds inside the result's `threads` array: jsonResult indents with two spaces, so each line of a
 * thread sits four spaces deeper than on its own, plus the newline, indent and comma before it.
 */
function threadCost(entry: ThreadEntry): number {
  const text = JSON.stringify(entry, null, 2);
  return text.length + 4 * text.split('\n').length + 2;
}

/** The longest cursor a result can carry (a thread id is a UUID, at most 64 characters), so sizes leave room for it. */
const CURSOR_ROOM = encodeCursor(['x'.repeat(64)]);

/**
 * Threads from `start` that fit the caller's limits, whole threads only (format.ts fitToProfile). A first thread
 * longer than the limit alone is cut and marked, so every call moves on. `next` is the index to resume from.
 */
function pageThreads(documentId: string, threads: readonly Thread[], start: number, limits: ResultLimits, base: Record<string, unknown>) {
  const measure = (shown: ThreadEntry[]) => JSON.stringify({ ...base, threads: shown, next_cursor: CURSOR_ROOM }, null, 2).length;
  // An empty array prints as "[]"; a filled one adds a newline and indent before its "]".
  const room: ResultLimits = { maxItems: limits.maxItems, maxChars: limits.maxChars - measure([]) - 3 };
  const rendered = new Map<Thread, ThreadEntry>();
  const render = (thread: Thread) => {
    let entry = rendered.get(thread);
    if (!entry) {
      entry = renderThread(documentId, thread);
      rendered.set(thread, entry);
    }
    return entry;
  };
  const fitted = fitToProfile(threads, room, (thread) => threadCost(render(thread)), start);
  const shown = fitted.items.map(render);
  if (shown.length === 1 && threadCost(shown[0]) > room.maxChars) shown[0] = shrinkThread(documentId, fitted.items[0], limits.maxChars, measure);
  return { shown, next: fitted.next };
}

/** The index of the thread a cursor names, or -1 when it is not a cursor this tool made for these threads. */
function cursorStart(threads: readonly Thread[], cursor: string): number {
  const parts = decodeCursor(cursor);
  const id = parts && parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : null;
  return id === null ? -1 : threads.findIndex((thread) => thread.head.id === id);
}

const inputSchema = z.object({
  id: DOC_ID,
  page: z.number().int().min(1).max(100_000).optional().describe('Only the threads on this page: the first comment or a reply names it. Omit for all.'),
  cursor: z.string().max(512).optional().describe('From a previous call, to fetch the next threads.'),
});

type Args = z.infer<typeof inputSchema>;

/** The threads of a visible document, paged for the caller's profile. Audited by the caller. */
export function threadsResult(ctx: ToolContext, fields: Record<string, unknown>, documentId: string, comments: readonly Comment[], args: Args): CallToolResult {
  const grouped = groupThreads(comments);
  const { page } = args;
  const threads = page === undefined ? grouped.threads : grouped.threads.filter((thread) => onPage(thread, page));
  const start = args.cursor === undefined ? 0 : cursorStart(threads, args.cursor);
  if (start < 0) {
    return toolError('bad_cursor', withToolPrefix('Call legallas_get_comments again without a cursor, with the same page, to start from the first thread.', ctx.toolPrefix));
  }
  const base: Record<string, unknown> = markUntrusted({
    retrieved: retrievedOn(ctx.now),
    ...fields,
    page: page ?? null,
    total_threads: threads.length,
    open_threads: threads.filter((thread) => thread.head.resolved_at === null).length,
  }, ['page']);
  if (threads.length === 0) {
    base.note = page === undefined ? 'No comments on this document.' : 'No comment threads about that page.';
  } else if (grouped.orphans > 0) {
    base.note = 'Some older comments on this document are not shown here; the room link shows the whole thread.';
  }
  // Sized with the note any of these threads would bring; the result then carries the note its own threads need.
  const marks = untrustedIn(threads.map((thread) => renderThread(documentId, thread)));
  const { shown, next } = pageThreads(documentId, threads, start, limitsFor(ctx.profile, COMMENT_LIMITS), noted(base, marks));
  const result: Record<string, unknown> = { ...base, threads: shown };
  if (next !== null) result.next_cursor = encodeCursor([threads[next].head.id]);
  return jsonResult(noted(result));
}

/** The legallas_get_comments tool, which reads comment threads. */
export const getCommentsTool: ToolDefinition<typeof inputSchema> = {
  name: 'legallas_get_comments',
  title: 'Read comment threads',
  description:
    "Comment threads on one document from the counsel room's members: each thread's first comment and its " +
    'replies, with author, time, page, whether the thread is resolved, and room links. Pass page for only the ' +
    'threads about one page. When more remain, the result gives a cursor for the next threads.',
  inputSchema,
  outputSchema: COMMENTS_OUTPUT,
  async handler(args, ctx) {
    if (!canPerform(ctx.member.role, 'readComments')) {
      return toolError('forbidden', 'This connection may not read comment threads. Ask the room owner.');
    }
    const row = await findLiveDocument(ctx.env.DB, args.id, ctx.member.role);
    if (!row) return documentNotFound(ctx.toolPrefix);
    const comments = await listThread(ctx.env.DB, row.id, ctx.member.role);
    await ctx.audit('ai_read', row.id);
    return threadsResult(ctx, documentFields(row, ctx.env.CONTROL_PREFIX), row.id, comments, args);
  },
};
