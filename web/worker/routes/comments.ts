// SPDX-License-Identifier: Apache-2.0
// The collaboration routes: comment threads, resolve and reopen, and the owner's activity log.
// index.ts already authenticated the caller, loaded their member row and checked the write origin. Every
// query below takes the member's role, so a privileged document's thread reads as not found for a role that may
// not see the document (worker/comments.ts, plan D14).
//
//   GET   /api/documents/:id/comments   thread for a document (view)
//   POST  /api/documents/:id/comments   { body, parentId?, page? } body plain text, 1 to 10000 characters;
//                                       parentId a top-level comment on the same document (replies are one
//                                       level deep); page 1.. and at most the document's pages if known (comment)
//   GET   /api/comments                 recent comments across live documents (view);
//                                       ?open=1 open threads by latest activity, ?since=<ISO> newer than it,
//                                       ?limit=1..200 (50)
//   PATCH /api/comments/:id             { resolved: true | false } top-level comments only; covers the replies
//                                       (resolve, also for reopening)
//   GET   /api/activity                 audit rows, sign-ins and, while proposals are on, proposal steps, newest
//                                       first (viewActivity: owner)
//   GET   /api/activity/audit-log.jsonl the audit log as a chained copy (viewActivity: owner; worker/audit-chain.ts)
//   GET   /api/activity/notice          each member's last tick of the full notice (viewActivity: owner; worker/notice-gate.ts)
//
// Audit rows for comment, resolve and reopen record who, when and which document; never the text.
import { audit, auditStatement, FilterError, parseActivityFilter, readActivity } from '../audit.ts';
import { routes as auditCopyRoutes } from '../audit-chain.ts';
import { canPerform } from '../auth.ts';
import { checklistEnabled } from '../checklist.ts';
import {
  FeedFilterError,
  findComment,
  findLiveDocument,
  insertComment,
  listFeed,
  listThread,
  liveDocument,
  MAX_COMMENT_BYTES,
  parseAnchor,
  parseCommentBody,
  parseFeedFilter,
  readLimited,
  setResolved,
  validParent,
} from '../comments.ts';
import type { RequestContext } from '../env.ts';
import { proposalsEnabled } from '../proposals.ts';
import { errorJson, json } from '../http.ts';
import { routes as noticeRoutes } from '../notice-gate.ts';
import type { Route } from '../router.ts';

/** The JSON body of a write, or an error response. Requires a JSON content type and a bounded size. */
async function readJson(c: RequestContext): Promise<{ value: unknown } | Response> {
  const type = c.request.headers.get('Content-Type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type)) return errorJson('unsupported_media_type', 415);
  const text = await readLimited(c.request, MAX_COMMENT_BYTES);
  if (text === null) return errorJson('payload_too_large', 413);
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return errorJson('invalid_json', 400);
  }
}

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, name)
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

async function listComments(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'readComments')) return errorJson('forbidden', 403);
  const documentId = c.params.id!;
  if (!(await liveDocument(c.env.DB, documentId, c.member.role))) return errorJson('not_found', 404);
  return json({
    comments: await listThread(c.env.DB, documentId, c.member.role),
    can: { comment: canPerform(c.member.role, 'comment'), resolve: canPerform(c.member.role, 'resolve') },
  });
}

/** The comments feed for the Overview and the doc pages. Read-only: no audit row, and bodies only as excerpts. */
async function commentFeed(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'readComments')) return errorJson('forbidden', 403);
  let filter;
  try {
    filter = parseFeedFilter(c.url.searchParams);
  } catch (error) {
    if (!(error instanceof FeedFilterError)) throw error;
    return json({ error: 'invalid_filter', field: error.message }, 400);
  }
  return json({ comments: await listFeed(c.env.DB, filter, c.member.role) });
}

async function createComment(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'comment')) return errorJson('forbidden', 403);
  const input = await readJson(c);
  if (input instanceof Response) return input;
  const parsed = parseCommentBody(field(input.value, 'body'));
  if (!parsed.ok) return errorJson(parsed.error, 400);
  const anchor = parseAnchor(field(input.value, 'parentId'), field(input.value, 'page'));
  if (!anchor.ok) return errorJson(anchor.error, 400);

  const documentId = c.params.id!;
  const document = await findLiveDocument(c.env.DB, documentId, c.member.role);
  if (!document) return errorJson('not_found', 404);
  if (anchor.parentId !== null && !(await validParent(c.env.DB, anchor.parentId, documentId))) {
    return errorJson('invalid_parent', 400);
  }
  if (anchor.page !== null && document.pages !== null && anchor.page > document.pages) {
    return errorJson('invalid_page', 400);
  }

  // The comment and its audit row commit together. A parent is never deleted or re-parented, so the
  // check above still holds at the INSERT.
  const id = crypto.randomUUID();
  const { parentId, page } = anchor;
  await c.env.DB.batch([
    insertComment(c.env.DB, { id, documentId, email: c.member.email, body: parsed.body, parentId, page, inParentRoom: c.member.role === 'owner' && parentId !== null }),
    auditStatement(c, 'comment', documentId),
  ]);
  return json({ comment: await findComment(c.env.DB, id, c.member.role) }, 201);
}

async function updateComment(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'resolve')) return errorJson('forbidden', 403);
  const input = await readJson(c);
  if (input instanceof Response) return input;
  const resolved = field(input.value, 'resolved');
  if (typeof resolved !== 'boolean') return errorJson('invalid_request', 400);

  const id = c.params.id!;
  const existing = await findComment(c.env.DB, id, c.member.role);
  if (!existing) return errorJson('not_found', 404);
  if (existing.parent_id !== null) return errorJson('not_top_level', 400);

  if (await setResolved(c.env.DB, id, resolved, c.member.email)) {
    await audit(c, resolved ? 'resolve' : 'reopen', existing.document_id);
  }
  return json({ comment: await findComment(c.env.DB, id, c.member.role) });
}

async function listActivity(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'viewActivity')) return errorJson('forbidden', 403);
  let filter;
  try {
    filter = parseActivityFilter(c.url.searchParams);
  } catch (error) {
    if (!(error instanceof FilterError)) throw error;
    return json({ error: 'invalid_filter', field: error.message }, 400);
  }
  const page = await readActivity(c.env.DB, filter, proposalsEnabled(c.env), checklistEnabled(c.env));
  const people = await c.env.DB.prepare('SELECT email, name FROM members ORDER BY email').all<{ email: string; name: string | null }>();
  return json({ ...page, people: people.results });
}

export const routes: Route[] = [
  { method: 'GET', path: '/api/documents/:id/comments', handler: listComments },
  { method: 'POST', path: '/api/documents/:id/comments', handler: createComment },
  { method: 'GET', path: '/api/comments', handler: commentFeed },
  { method: 'PATCH', path: '/api/comments/:id', handler: updateComment },
  { method: 'GET', path: '/api/activity', handler: listActivity },
  ...auditCopyRoutes,
  ...noticeRoutes,
];
