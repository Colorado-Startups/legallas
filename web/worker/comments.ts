// SPDX-License-Identifier: Apache-2.0
// Comment threads: input rules and queries. Comments are plain text. The server stores exactly what
// passed these rules and returns it as JSON; the page renders it with textContent, so nothing a
// member types is ever treated as HTML or Markdown.
//
// Every query that reads a comment or its document takes the caller's role and keeps privilegeFilter
// (worker/privilege.ts): a thread on a privileged document is hidden, like the document, from a role that may
// not see it. Today only owner and counsel read comments, and both see privileged folders, so the filter adds
// nothing to their SQL; it is the second wall behind canPerform(role, 'readComments') (plan D14).
import { holdsPrintedNumber } from './printed-number.ts';
import type { Role } from './env.ts';
import { NOT_HIDDEN_SQL } from './files-catalog.ts';
import { privilegeFilter } from './privilege.ts';

export { readLimited } from './http.ts';

/** Length limits count code points, matching SQLite's length() in the comments table CHECK. */
export const MAX_COMMENT = 10_000;
/** Request body cap: the longest comment as JSON, with room for escapes. */
export const MAX_COMMENT_BYTES = 64 * 1024;
/** Newest comments returned per document. */
export const MAX_THREAD = 1000;

export type CommentError = 'empty_comment' | 'comment_too_long' | 'invalid_comment' | 'pii_in_comment';

// Control characters other than tab and newline, and lone surrogates (not valid UTF-8 in D1).
const FORBIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F]|\p{Cs}/u;

/** Normalizes a submitted body (line endings, NFC, outer whitespace) or names what is wrong with it. */
export function parseCommentBody(value: unknown): { ok: true; body: string } | { ok: false; error: CommentError } {
  if (typeof value !== 'string') return { ok: false, error: 'invalid_comment' };
  const body = value.replace(/\r\n?/g, '\n').normalize('NFC').trim();
  if (FORBIDDEN.test(body)) return { ok: false, error: 'invalid_comment' };
  const length = [...body].length;
  if (length === 0) return { ok: false, error: 'empty_comment' };
  if (length > MAX_COMMENT) return { ok: false, error: 'comment_too_long' };
  if (holdsPrintedNumber(body)) return { ok: false, error: 'pii_in_comment' };
  return { ok: true, body };
}

/**
 * A comment as the API returns it. Names come from members, so a removed member shows their email.
 * parent_id is null for a top-level comment. A reply's resolved_* are its thread's: resolving the
 * top-level comment covers its replies.
 */
export interface Comment {
  id: string;
  document_id: string;
  parent_id: string | null;
  page: number | null;
  author_email: string;
  author_name: string | null;
  body: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_by_name: string | null;
}

// t is the thread's top-level comment: the comment itself, or its parent for a reply.
const COMMENT_COLUMNS = `
  c.id, c.document_id, c.parent_id, c.page, c.author_email, a.name AS author_name, c.body, c.created_at,
  t.resolved_at, t.resolved_by, r.name AS resolved_by_name
  FROM comments c
  JOIN comments t ON t.id = COALESCE(c.parent_id, c.id)
  LEFT JOIN members a ON a.email = c.author_email
  LEFT JOIN members r ON r.email = t.resolved_by`;

/** The comment's document, joined only while it is live and `role` may see it. */
function visibleDocument(role: Role): string {
  return `JOIN documents d ON d.id = c.document_id AND d.removed_at IS NULL${privilegeFilter(role, 'd.path')}`;
}

/**
 * Whether a document exists, is not removed and `role` may see it. Removed files keep their threads, hidden
 * with them, and a privileged one reads exactly like a missing one.
 */
export async function liveDocument(db: D1Database, id: string, role: Role): Promise<boolean> {
  return (await findLiveDocument(db, id, role)) !== null;
}

/**
 * A live document's page count (null when unknown: not a PDF, or not counted yet), or null if it is not live or
 * `role` may not see it.
 */
export async function findLiveDocument(db: D1Database, id: string, role: Role): Promise<{ pages: number | null } | null> {
  return db
    .prepare(`SELECT pages FROM documents WHERE id = ?1 AND removed_at IS NULL${privilegeFilter(role)}`)
    .bind(id)
    .first<{ pages: number | null }>();
}

export type AnchorError = 'invalid_parent' | 'invalid_page';

/** The optional parentId and page of a new comment, checked for shape only. Absent and null both mean none. */
export function parseAnchor(
  parentId: unknown,
  page: unknown,
): { ok: true; parentId: string | null; page: number | null } | { ok: false; error: AnchorError } {
  const parent = parentId ?? null;
  if (parent !== null && (typeof parent !== 'string' || parent.length === 0 || parent.length > 64)) {
    return { ok: false, error: 'invalid_parent' };
  }
  const pageNumber = page ?? null;
  if (pageNumber !== null && (typeof pageNumber !== 'number' || !Number.isSafeInteger(pageNumber) || pageNumber < 1)) {
    return { ok: false, error: 'invalid_page' };
  }
  return { ok: true, parentId: parent, page: pageNumber };
}

/** Whether parentId is a top-level comment on this document, so a reply to it stays one level deep. */
export async function validParent(db: D1Database, parentId: string, documentId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM comments WHERE id = ?1 AND document_id = ?2 AND parent_id IS NULL')
    .bind(parentId, documentId)
    .first();
  return row !== null;
}

/**
 * The newest MAX_THREAD comments on a document, oldest first; none when the document is removed or `role` may
 * not see it. Comments posted in the same millisecond tie on created_at, so rowid (insertion order) breaks the
 * tie; the id is a random UUID and would shuffle them.
 */
export async function listThread(db: D1Database, documentId: string, role: Role): Promise<Comment[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COMMENT_COLUMNS} ${visibleDocument(role)} WHERE c.document_id = ?1 ` +
        'ORDER BY c.created_at DESC, c.rowid DESC LIMIT ?2',
    )
    .bind(documentId, MAX_THREAD)
    .all<Comment>();
  return results.reverse();
}

/** One comment, if its document is still live and `role` may see it. */
export async function findComment(db: D1Database, id: string, role: Role): Promise<Comment | null> {
  return db.prepare(`SELECT ${COMMENT_COLUMNS} ${visibleDocument(role)} WHERE c.id = ?1`).bind(id).first<Comment>();
}

export interface NewComment {
  id: string;
  documentId: string;
  email: string;
  body: string;
  parentId: string | null;
  page: number | null;
  /**
   * The owner answering a deal-room guest: the reply takes its question's room, so it reaches that guest's thread
   * (rooms.ts listGuestThreads) and no one else's. Counsel's replies never do: their advice may be privileged.
   */
  inParentRoom?: boolean;
}

export function insertComment(db: D1Database, comment: NewComment): D1PreparedStatement {
  const { id, documentId, email, body, parentId, page, inParentRoom = false } = comment;
  return db
    .prepare(
      'INSERT INTO comments (id, document_id, author_email, body, parent_id, page, room_id) ' +
        'VALUES (?1, ?2, ?3, ?4, ?5, ?6, CASE WHEN ?7 = 1 THEN (SELECT room_id FROM comments WHERE id = ?5) END)',
    )
    .bind(id, documentId, email, body, parentId, page, inParentRoom ? 1 : 0);
}

/**
 * Resolves or reopens a top-level comment, and with it the thread's replies. Changes nothing (and returns
 * false) if the comment is already in that state, or is a reply, so a double click writes one audit row.
 */
export async function setResolved(db: D1Database, id: string, resolved: boolean, email: string): Promise<boolean> {
  const statement = resolved
    ? db
        .prepare(
          "UPDATE comments SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), resolved_by = ?2 " +
            'WHERE id = ?1 AND parent_id IS NULL AND resolved_at IS NULL',
        )
        .bind(id, email)
    : db
        .prepare('UPDATE comments SET resolved_at = NULL, resolved_by = NULL WHERE id = ?1 AND parent_id IS NULL AND resolved_at IS NOT NULL')
        .bind(id);
  const result = await statement.run();
  return result.meta.changes === 1;
}

// ---- The comments feed (GET /api/comments): recent comments across every live document. ----

/** Feed page size: the default and the most a caller may ask for. */
export const FEED_DEFAULT = 50;
export const FEED_MAX = 200;
/** Characters of the body in a feed excerpt, after whitespace is collapsed. */
export const EXCERPT_LENGTH = 140;
// Bodies are read only this far for an excerpt, so a page of 200 long comments stays small.
const EXCERPT_SOURCE = 1000;

/**
 * One feed row. control_seq is null until sync has numbered the document (migration 0003). As in a thread,
 * a reply's resolved_at is its thread's, and so are last_activity_at (the newest created_at of the top-level
 * comment and its replies) and reply_count.
 */
export interface FeedComment {
  id: string;
  document_id: string;
  parent_id: string | null;
  page: number | null;
  document_name: string;
  control_seq: number | null;
  author_name: string;
  created_at: string;
  resolved_at: string | null;
  last_activity_at: string;
  reply_count: number;
  excerpt: string;
}

export interface FeedFilter {
  /** Only open threads: unresolved top-level comments, one row per thread, by latest activity. */
  open: boolean;
  /**
   * Only rows newer than this instant (strictly after; a canonical ISO string): comments created after it,
   * or with open, threads whose latest activity is after it, so a new reply brings its thread back.
   */
  since: string | null;
  limit: number;
}

/** A bad query parameter; the message names it. */
export class FeedFilterError extends Error {
  override name = 'FeedFilterError';
}

// A date, optionally with a time and then a zone (Z or an offset), so no instant depends on the server clock's zone.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/** The instant as created_at stores it (YYYY-MM-DDTHH:MM:SS.sssZ, UTC), or null if it is not an ISO timestamp. */
export function canonicalInstant(value: string): string | null {
  if (!ISO_INSTANT.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const day = value.slice(0, 10);
  const asUtc = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(asUtc.getTime()) || !asUtc.toISOString().startsWith(day)) return null;
  return date.toISOString();
}

/** Reads open, since and limit from the query string. Throws FeedFilterError naming the bad parameter. */
export function parseFeedFilter(params: URLSearchParams): FeedFilter {
  const text = (name: string) => params.get(name)?.trim() || null;
  const open = text('open');
  if (open !== null && open !== '0' && open !== '1') throw new FeedFilterError('open');
  const rawSince = text('since');
  const since = rawSince === null ? null : canonicalInstant(rawSince);
  if (rawSince !== null && since === null) throw new FeedFilterError('since');
  const rawLimit = text('limit');
  const limit = rawLimit === null ? FEED_DEFAULT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > FEED_MAX) throw new FeedFilterError('limit');
  return { open: open === '1', since, limit };
}

/** The first EXCERPT_LENGTH characters (code points, never half a surrogate pair) with whitespace collapsed. */
export function excerpt(body: string): string {
  return [...body.replace(/\s+/g, ' ').trim()].slice(0, EXCERPT_LENGTH).join('');
}

/**
 * The feed, newest first: every comment by created_at, or with open, open threads by last_activity_at. Ties
 * go by insertion order, as in listThread. Skips removed documents, the binder manifests (NOT_HIDDEN_SQL,
 * case-sensitive GLOB) and documents `role` may not see. A member with no name (or one since removed) appears
 * by email. Bodies are never logged or audited.
 */
export async function listFeed(db: D1Database, filter: FeedFilter, role: Role): Promise<FeedComment[]> {
  const newest = filter.open ? 's.last_activity_at' : 'c.created_at';
  const where = ['d.removed_at IS NULL', `d.${NOT_HIDDEN_SQL}`];
  if (filter.open) where.push('c.parent_id IS NULL', 'c.resolved_at IS NULL');
  if (filter.since !== null) where.push(`${newest} > ?2`);
  const { results } = await db
    .prepare(
      `WITH s AS (
         SELECT COALESCE(parent_id, id) AS thread_id, MAX(created_at) AS last_activity_at,
           SUM(parent_id IS NOT NULL) AS reply_count
         FROM comments GROUP BY thread_id
       )
       SELECT c.id, c.document_id, c.parent_id, c.page, d.name AS document_name, d.control_seq,
         COALESCE(a.name, c.author_email) AS author_name, c.created_at, t.resolved_at,
         s.last_activity_at, s.reply_count, substr(c.body, 1, ${EXCERPT_SOURCE}) AS body
       FROM comments c
       JOIN comments t ON t.id = COALESCE(c.parent_id, c.id)
       JOIN s ON s.thread_id = t.id
       JOIN documents d ON d.id = c.document_id
       LEFT JOIN members a ON a.email = c.author_email
       WHERE ${where.join(' AND ')}${privilegeFilter(role, 'd.path')}
       ORDER BY ${newest} DESC, c.rowid DESC
       LIMIT ?1`,
    )
    .bind(...(filter.since === null ? [filter.limit] : [filter.limit, filter.since]))
    .all<Omit<FeedComment, 'excerpt'> & { body: string }>();
  return results.map(({ body, ...row }) => ({ ...row, excerpt: excerpt(body) }));
}
