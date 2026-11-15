// SPDX-License-Identifier: Apache-2.0
// Everything a guest (worker/rooms.ts) can reach, and nothing else. room.ts calls handleGuest only after Access
// verified the email, findMember found no member, ROOMS_ENABLED is "1" and the guest holds an active invitation. No
// member route, no static page and no MCP tool is reachable from here. A room the guest is not in answers exactly like
// a missing one (404), and so does a document outside the room, removed, a room data file, or privileged for a role
// that may not see it (every role but counsel in a matter room).
//
//   GET  /                                          the guest's page: the confidentiality notice (deal rooms), Connect
//                                                   your AI (a role that may connect), then
//                                                   each room's last update, deck and summary first, every shared
//                                                   folder with its date and documents, and the room's contact
//   GET  /rooms/:room/view/:id                      a document's view page: a PDF drawn by the guest viewer, an image
//   GET  /guest/viewer.js, pdf.min.mjs, pdf.worker.min.mjs   the viewer (GUEST_ASSETS), the only assets a guest gets
//   GET  /api/rooms                                 who the room thinks the guest is: rooms, roles, end dates
//   GET  /api/rooms/:room/documents                 the documents the room shows (view)
//   GET  /api/rooms/:room/files/:id                 a document's bytes: inline for a viewer (view), or a download where
//                                                   the role allows it (download: counsel in a matter room); never run
//                                                   as a framed visual, though counsel may download its file, as members can
//   GET  /api/rooms/:room/documents/:id/comments    the guest's own threads on a document (readComments)
//   POST /api/rooms/:room/documents/:id/comments    { body, parentId?, page? } as the member route takes it (comment)
//
// Every read of a document and every comment writes an audit row with the room, never the text.
import { clientInfo, READ_DEDUPE_MINUTES } from '../audit.ts';
import { MAX_COMMENT_BYTES, parseAnchor, parseCommentBody, readLimited } from '../comments.ts';
import { canPerform } from '../auth.ts';
import type { Env, RequestContext } from '../env.ts';
import { roomMark } from '../extensions.ts';
import { attachment, contentRange, deliveryFor, inlineContentType, parseRange } from '../files-http.ts';
import { GUEST_NOTICE } from '../guest-notice.ts';
import { withSecurityHeaders } from '../headers.ts';
import { aiList, connectLink, readerOfRole } from '../invite.ts';
import { errorJson, isAllowedDocumentRead, isSameOriginWrite, isWrite, json } from '../http.ts';
import { roomNamesOf } from '../room-names.ts';
import { contactEmail } from '../room-settings.ts';
import { matchRoute, type Route } from '../router.ts';
import {
  actionsOf,
  canGuest,
  findRoomDocument,
  listGuestThreads,
  listRoomDocuments,
  listRoomFolders,
  markJoined,
  PrivilegeMarksUnavailable,
  roomsEnabled,
  servedRole,
  validGuestParent,
  type GuestRole,
  type GuestRoom,
  type RoomAction,
  type RoomDocumentRow,
  type RoomGuest,
} from '../rooms.ts';

/** What a guest route gets. Never a Member: the member routes cannot be handed one. */
export interface GuestContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  url: URL;
  guest: RoomGuest;
  params: Record<string, string>;
  now: Date;
}

export interface GuestRoute extends Pick<Route, 'method' | 'path'> {
  handler: (c: GuestContext) => Promise<Response>;
}

/** The guest's room named by :room, if they may do `action` in it; else the response to send. */
function roomFor(c: GuestContext, action: RoomAction): GuestRoom | Response {
  const room = c.guest.rooms.find((r) => r.id === c.params.room);
  if (!room) return errorJson('not_found', 404);
  return canGuest(room.kind, room.role, action) ? room : errorJson('forbidden', 403);
}

/** The audit INSERT for a guest's row, with its room. */
function auditStatement(c: GuestContext, roomId: string, action: 'view' | 'download' | 'comment', documentId: string, onlyOnce: boolean): D1PreparedStatement {
  const { ip, userAgent } = clientInfo(c.request);
  const insert = 'INSERT INTO audit_log (email, action, document_id, ip, user_agent, room_id) SELECT ?1, ?2, ?3, ?4, ?5, ?6';
  // As audit.ts auditOnce: one row per guest, room, document and action within READ_DEDUPE_MINUTES (PDF.js ranges).
  const once =
    ' WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE email = ?1 AND action = ?2 AND document_id = ?3 AND room_id = ?6 ' +
    "AND ts > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?7))";
  const statement = c.env.DB.prepare(onlyOnce ? insert + once : insert);
  const values = [c.guest.email, action, documentId, ip, userAgent, roomId];
  return onlyOnce ? statement.bind(...values, `-${READ_DEDUPE_MINUTES} minutes`) : statement.bind(...values);
}

/** A document as a guest's list shows it: never its path's hidden parts, its key in R2 or who uploaded it. */
function listed(row: RoomDocumentRow) {
  return { id: row.id, name: row.name, folder: row.folder, kind: row.kind, size: row.size, pages: row.pages ?? null, updated_at: row.updated_at };
}

async function getRooms(c: GuestContext): Promise<Response> {
  return json({
    email: c.guest.email,
    rooms: c.guest.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      role: room.role,
      expires_at: room.expiresAt,
      can: Object.fromEntries(actionsOf(room.kind, room.role).map((action) => [action, true])),
    })),
  });
}

async function listDocuments(c: GuestContext): Promise<Response> {
  const room = roomFor(c, 'view');
  if (room instanceof Response) return room;
  const rows = await listRoomDocuments(c.env, room, c.now);
  return json({ room: { id: room.id, name: room.name }, documents: rows.map(listed) });
}

/**
 * As the member route /files/:id, with the guest's matrix: a download (?download, a top-level open, a frame) needs a role
 * that may download, and a visual is never run in a sandboxed frame for a guest (counsel may download its file, as members can).
 */
async function serveFile(c: GuestContext): Promise<Response> {
  if (!isAllowedDocumentRead(c.request)) return errorJson('forbidden', 403);
  const room = roomFor(c, 'view');
  if (room instanceof Response) return room;
  const doc = await findRoomDocument(c.env, room, c.params.id!, c.now);
  if (!doc) return errorJson('not_found', 404);

  const delivery = deliveryFor(doc, c.request.headers.get('Sec-Fetch-Dest'), c.url.searchParams.has('download'));
  if (delivery.mode === 'visual' || !canGuest(room.kind, room.role, delivery.action)) return errorJson('forbidden', 403);

  const range = parseRange(c.request.headers.get('Range'), doc.size);
  if (range.kind === 'unsatisfiable') {
    const headers = { 'Content-Range': `bytes */${doc.size}`, 'Accept-Ranges': 'bytes' };
    return withSecurityHeaders(new Response(null, { status: 416, headers }), 'file');
  }
  const object = await c.env.FILES.get(doc.r2_key, range.kind === 'partial' ? { range: { offset: range.offset, length: range.length } } : undefined);
  if (!object) return errorJson('not_found', 404);
  await auditStatement(c, room.id, delivery.mode === 'attachment' ? 'download' : 'view', doc.id, true).run();

  const headers = new Headers({ 'Accept-Ranges': 'bytes' });
  if (delivery.mode === 'attachment') {
    headers.set('Content-Type', doc.content_type);
    headers.set('Content-Disposition', attachment(doc.name));
  } else {
    headers.set('Content-Type', inlineContentType(doc.kind, doc.content_type));
  }
  if (range.kind === 'partial') {
    headers.set('Content-Range', contentRange(range.offset, range.length, object.size));
    headers.set('Content-Length', String(range.length));
    return withSecurityHeaders(new Response(object.body, { status: 206, headers }), 'file');
  }
  if (Number.isFinite(object.size)) headers.set('Content-Length', String(object.size));
  return withSecurityHeaders(new Response(object.body, { headers }), 'file');
}

async function listComments(c: GuestContext): Promise<Response> {
  const room = roomFor(c, 'readComments');
  if (room instanceof Response) return room;
  const doc = await findRoomDocument(c.env, room, c.params.id!, c.now);
  if (!doc) return errorJson('not_found', 404);
  return json({ comments: await listGuestThreads(c.env.DB, room.id, doc.id, c.guest.email), can: { comment: canGuest(room.kind, room.role, 'comment') } });
}

/** The JSON body of a write, or the error to send, as the member comment route reads it. */
async function readJson(request: Request): Promise<{ value: unknown } | Response> {
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get('Content-Type') ?? '')) return errorJson('unsupported_media_type', 415);
  const text = await readLimited(request, MAX_COMMENT_BYTES);
  if (text === null) return errorJson('payload_too_large', 413);
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return errorJson('invalid_json', 400);
  }
}

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, name) ? (value as Record<string, unknown>)[name] : undefined;
}

async function createComment(c: GuestContext): Promise<Response> {
  const room = roomFor(c, 'comment');
  if (room instanceof Response) return room;
  const input = await readJson(c.request);
  if (input instanceof Response) return input;
  const parsed = parseCommentBody(field(input.value, 'body'));
  if (!parsed.ok) return errorJson(parsed.error, 400);
  const anchor = parseAnchor(field(input.value, 'parentId'), field(input.value, 'page'));
  if (!anchor.ok) return errorJson(anchor.error, 400);

  const doc = await findRoomDocument(c.env, room, c.params.id!, c.now);
  if (!doc) return errorJson('not_found', 404);
  // A reply goes only under the guest's own top-level comment in this room, never a member's or another guest's.
  if (anchor.parentId !== null && !(await validGuestParent(c.env.DB, room.id, doc.id, c.guest.email, anchor.parentId))) {
    return errorJson('invalid_parent', 400);
  }
  if (anchor.page !== null && doc.pages !== null && anchor.page > doc.pages) return errorJson('invalid_page', 400);

  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO comments (id, document_id, author_email, body, parent_id, page, room_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)').bind(
      id,
      doc.id,
      c.guest.email,
      parsed.body,
      anchor.parentId,
      anchor.page,
      room.id,
    ),
    auditStatement(c, room.id, 'comment', doc.id, false),
  ]);
  const comment = (await listGuestThreads(c.env.DB, room.id, doc.id, c.guest.email)).find((row) => row.id === id) ?? null;
  return json({ comment }, 201);
}

/** Text for HTML: every character that could open markup or an attribute is escaped. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** The guest viewer's files (integrations/guest-viewer.mjs), the only ones a guest is served from env.ASSETS. */
export const GUEST_ASSETS: readonly string[] = ['/guest/viewer.js', '/guest/pdf.min.mjs', '/guest/pdf.worker.min.mjs'];

/** One viewer file. Anything but a 200 is a plain 404: the assets' own 404 page is the room's build, with its settings. */
async function guestAsset(c: GuestContext): Promise<Response> {
  const response = await c.env.ASSETS.fetch(new Request(new URL(c.url.pathname, c.url.origin)));
  return response.status === 200 ? response : errorJson('not_found', 404);
}

/** What an investor opens first (YC, a16z, White Star; research SEED-2): the deck, then the summary, by file name. */
const START_HERE = [/\b(?:pitch[ _-]?)?deck\b/i, /\b(?:executive[ _-]?)?summary\b|\bone[ _-]?pager\b/i];

/** The room's deck and summary, wherever they sit in its folders: each rule's matches, in path order. */
export function startHere(rows: readonly RoomDocumentRow[]): RoomDocumentRow[] {
  const picked: RoomDocumentRow[] = [];
  for (const rule of START_HERE) for (const row of rows) if (rule.test(row.name) && !picked.includes(row)) picked.push(row);
  return picked;
}

const viewHref = (room: GuestRoom, row: RoomDocumentRow) => `/rooms/${encodeURIComponent(room.id)}/view/${encodeURIComponent(row.id)}`;

/** A page in the front door's style, built here with no inline script or style. */
function guestPage(title: string, main: string): Response {
  const body =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex"><meta name="color-scheme" content="light">' +
    '<link rel="icon" href="/welcome/favicon.svg" type="image/svg+xml">' +
    `<link rel="stylesheet" href="/welcome/door.css"><title>${escapeHtml(title)}</title></head>` +
    `<body><main class="door door-compact">${main}</main></body></html>`;
  return withSecurityHeaders(new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }), 'page');
}

/**
 * One document's view page: a PDF drawn page by page by the guest viewer (no download button), an image inline, and
 * any other kind named with the note that it opens in the viewer later. Bytes still come only through the file route.
 */
async function viewDocument(c: GuestContext): Promise<Response> {
  const room = roomFor(c, 'view');
  if (room instanceof Response) return room;
  const doc = await findRoomDocument(c.env, room, c.params.id!, c.now);
  if (!doc) return errorJson('not_found', 404);
  const src = `/api/rooms/${encodeURIComponent(room.id)}/files/${encodeURIComponent(doc.id)}`;
  const content =
    doc.kind === 'pdf'
      ? `<div id="pages" class="guest-pages" data-src="${escapeHtml(src)}">Loading the document.</div><script type="module" src="/guest/viewer.js"></script>`
      : doc.kind === 'image'
        ? `<img class="guest-image" src="${escapeHtml(src)}" alt="${escapeHtml(doc.name)}">`
        : '<p class="door-lede">This kind of file opens here soon.</p>';
  return guestPage(
    doc.name,
    `<p class="door-help"><a href="/">${escapeHtml(room.name)}</a></p><h1 class="door-title door-title-small">${escapeHtml(doc.name)}</h1>` +
      `<p class="door-help">Updated ${escapeHtml(doc.updated_at.slice(0, 10))}.</p>${content}`,
  );
}

/** How the guest's page names each role. */
const ROLE_WORDS: Readonly<Record<GuestRole, string>> = { investor: 'an investor', counsel: 'counsel' };

/** One document on the guest's page: a plain download link where the role may download, else a link to its view. */
function item(room: GuestRoom, row: RoomDocumentRow): string {
  const href = canGuest(room.kind, room.role, 'download')
    ? `/api/rooms/${encodeURIComponent(room.id)}/files/${encodeURIComponent(row.id)}?download`
    : viewHref(room, row);
  return `<li><a href="${escapeHtml(href)}">${escapeHtml(row.name)}</a></li>`;
}

/** The newest date among `rows`, as YYYY-MM-DD, or null with none. */
const newest = (rows: readonly RoomDocumentRow[]): string | null => rows.reduce<string | null>((max, row) => (max && max >= row.updated_at ? max : row.updated_at), null)?.slice(0, 10) ?? null;

/**
 * Every folder the owner shared, by its own name (never the path above it), its newest date and its documents
 * (UK Space Agency checklist; Klehr). A document sits once, under the longest shared folder its path starts with.
 */
export function folderIndex(room: GuestRoom, folders: readonly string[], rows: readonly RoomDocumentRow[]): string {
  const home = (row: RoomDocumentRow) => folders.filter((f) => row.path.startsWith(`${f}/`)).reduce((a, b) => (b.length > a.length ? b : a), '');
  return folders
    .map((folder) => {
      const inside = rows.filter((row) => home(row) === folder);
      const date = newest(inside);
      const head = `<p class="door-help" data-folder><strong>${escapeHtml(folder.split('/').pop()!)}</strong>, ${date ? `updated ${date}` : 'no documents yet'}</p>`;
      return inside.length ? `${head}<ul class="door-steps">${inside.map((row) => item(room, row)).join('')}</ul>` : head;
    })
    .join('');
}

/**
 * The guest's page, built here and never from the room's static build (which carries the room's settings). It uses
 * only the front door's public stylesheet and runs no script. It names the guest's rooms and the documents each shows.
 */
async function home(c: GuestContext): Promise<Response> {
  const { instanceName } = roomNamesOf(c.env);
  const sections: string[] = [];
  for (const room of c.guest.rooms) {
    let items: string;
    try {
      const rows = canGuest(room.kind, room.role, 'view') ? await listRoomDocuments(c.env, room, c.now) : [];
      const folders = rows.length ? await listRoomFolders(c.env.DB, room.id) : [];
      const first = startHere(rows);
      const start = first.length ? `<p class="door-help">Start here</p><ul class="door-steps" data-start-here>${first.map((row) => item(room, row)).join('')}</ul>` : '';
      items = rows.length ? `<p class="door-help" data-updated>Last updated ${newest(rows)}.</p>${start}${folderIndex(room, folders, rows)}` : '<p class="door-lede">No documents yet.</p>';
    } catch (error) {
      if (!(error instanceof PrivilegeMarksUnavailable)) throw error;
      items = '<p class="door-lede">This room is unavailable for now.</p>';
    }
    sections.push(
      `<h2 class="door-title door-title-small">${escapeHtml(room.name)}</h2>` +
        `<p class="door-help">Invited as ${ROLE_WORDS[room.role]} until ${escapeHtml(room.expiresAt.slice(0, 10))}.</p>${items}`,
    );
  }
  // Investors are told first; counsel in a matter room work under their own duty of confidence.
  const notice = c.guest.rooms.some((room) => room.kind === 'deal') ? `<p class="door-help" data-notice>${escapeHtml(GUEST_NOTICE)}</p>` : '';
  // Then their own AI, before any document: few guests browse (worker/invite.ts). Only a role that may connect sees it.
  const connecting = c.guest.rooms.find((room) => canGuest(room.kind, room.role, 'connect'));
  const reader = connecting ? readerOfRole(connecting.role) : null;
  const connect = reader
    ? `<a class="door-button" href="${escapeHtml(connectLink(reader))}" data-connect>Connect your AI</a>` +
      `<p class="door-help">Ask about the room from ${aiList(reader)}: read-only, signed in as you.</p><hr class="door-rule">`
    : '';
  const body =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex"><meta name="color-scheme" content="light">' +
    '<link rel="icon" href="/welcome/favicon.svg" type="image/svg+xml">' +
    `<link rel="stylesheet" href="/welcome/door.css"><title>${escapeHtml(instanceName)}</title></head>` +
    `<body><main class="door door-compact">${roomMark()(false)}${notice}${connect}` +
    `${sections.join('<hr class="door-rule">')}<hr class="door-rule">` +
    `<p class="door-help" data-contact>Questions about this room: <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a></p>` +
    '<hr class="door-rule"><a class="door-button" href="/cdn-cgi/access/logout">Sign out</a></main></body></html>';
  return withSecurityHeaders(new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }), 'page');
}

/**
 * The owner's preview of a room (a member route, worker/room.ts CORE_ROUTES): the very list a guest of that room is
 * served (listRoomDocuments, as the one role its kind serves), so it can never show more or less. Owner only, and only
 * while ROOMS_ENABLED is "1".
 */
async function previewRoom(c: RequestContext): Promise<Response> {
  if (!roomsEnabled(c.env)) return errorJson('not_found', 404);
  if (!canPerform(c.member.role, 'viewActivity')) return errorJson('forbidden', 403);
  const room = await c.env.DB.prepare("SELECT id, name, kind FROM rooms WHERE id = ?1 AND archived_at IS NULL AND kind IN ('deal', 'matter')")
    .bind(c.params.room!)
    .first<{ id: string; name: string; kind: string }>();
  const role = room ? servedRole(room.kind) : null;
  if (!room || !role) return errorJson('not_found', 404);
  try {
    const rows = await listRoomDocuments(c.env, { id: room.id, kind: room.kind, role }, new Date());
    return json({ room: { id: room.id, name: room.name }, documents: rows.map(listed) });
  } catch (error) {
    // As the guest routes: marks that cannot be read show nothing, as a 503 (handleGuest).
    if (!(error instanceof PrivilegeMarksUnavailable)) throw error;
    return errorJson('unavailable', 503);
  }
}

/** The owner's room routes, among the member routes. */
export const OWNER_ROOM_ROUTES: readonly Route[] = [{ method: 'GET', path: '/api/rooms/:room/preview', handler: previewRoom }];

/** The guest routes, the only ones a guest can reach. */
export const GUEST_ROUTES: readonly GuestRoute[] = [
  { method: 'GET', path: '/', handler: home },
  ...GUEST_ASSETS.map((path) => ({ method: 'GET' as const, path, handler: guestAsset })),
  { method: 'GET', path: '/rooms/:room/view/:id', handler: viewDocument },
  { method: 'GET', path: '/api/rooms', handler: getRooms },
  { method: 'GET', path: '/api/rooms/:room/documents', handler: listDocuments },
  { method: 'GET', path: '/api/rooms/:room/files/:id', handler: serveFile },
  { method: 'GET', path: '/api/rooms/:room/documents/:id/comments', handler: listComments },
  { method: 'POST', path: '/api/rooms/:room/documents/:id/comments', handler: createComment },
];

/**
 * Serves one guest request. Writes need the exact Origin, as for members. Anything that is not a guest route is a 404,
 * so a guest never reaches the room's assets (env.ASSETS) or a member route.
 */
export async function handleGuest(request: Request, env: Env, ctx: ExecutionContext, url: URL, guest: RoomGuest, now: Date): Promise<Response> {
  if (isWrite(request.method) && !isSameOriginWrite(request)) return withSecurityHeaders(errorJson('forbidden', 403), 'api');
  if (guest.rooms.some((room) => !room.joined)) await markJoined(env.DB, guest, now);

  const match = matchRoute(GUEST_ROUTES, request.method, url.pathname);
  if (match.kind === 'wrong-method') {
    const response = errorJson('method_not_allowed', 405);
    response.headers.set('Allow', match.allow.join(', '));
    return withSecurityHeaders(response, 'api');
  }
  if (match.kind === 'none') return withSecurityHeaders(errorJson('not_found', 404), 'api');
  try {
    return withSecurityHeaders(await match.route.handler({ request, env, ctx, url, guest, params: match.params, now }), 'api');
  } catch (error) {
    if (!(error instanceof PrivilegeMarksUnavailable)) throw error;
    return withSecurityHeaders(errorJson('unavailable', 503), 'api');
  }
}
