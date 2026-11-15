// SPDX-License-Identifier: Apache-2.0
// Files and viewers: the catalog, one document's metadata, the file bytes, and counsel uploads.
// room.ts already authenticated the caller, loaded their member row and checked the write origin;
// every handler here still checks canPerform() for its own action, and every query keeps privilegeFilter(): a
// role without viewPrivileged never lists, opens or downloads a document under a privileged folder
// (worker/privilege.ts).
//
//   GET /api/documents    live documents as a folder tree, with folder guides
//   GET /api/doc/:id      one document's metadata and a `view` row (a mirrored visual's comes from /files/:id)
//   GET /files/:id        the bytes, with Range support; see deliveryFor() for inline vs attachment and its audit row
//   GET /api/uploads      counsel uploads, newest first
//   PUT /api/uploads      a counsel upload: raw streamed body, filename in the X-Upload-Name header; 422 if it can run code
//   POST /api/documents/:id/key  { key: true | false } marks or clears Key (flag: any member)
//   GET /api/documents/index.csv  the data-room index as CSV, one `download` row (worker/export.ts)
//   POST /api/seen        records a page load and answers the member's visit (worker/seen.ts)
import { holdsPrintedNumber, printedNumberGuard } from '../printed-number.ts';
import { activeContentGuard, scanKindOf } from '../active-content.ts';
import { audit, auditOnce } from '../audit.ts';
import { canPerform } from '../auth.ts';
import { readLimited } from '../comments.ts';
import type { RequestContext } from '../env.ts';
import { routes as exportRoutes } from '../export.ts';
import { buildTree, displayFolder, NEXT_CONTROL_SEQ_SQL, NOT_HIDDEN_SQL, viewerFor, type CatalogRow } from '../files-catalog.ts';
import { attachment, contentRange, deliveryFor, inlineContentType, parseRange } from '../files-http.ts';
import { checkContentLength, HEAD_BYTES, matchesMagic, peekStream, sanitizeUploadName, uploadTypeOf } from '../files-upload.ts';
import { withSecurityHeaders } from '../headers.ts';
import { errorJson, isAllowedDocumentRead, json } from '../http.ts';
import { canSeeDocument, privilegeFilter } from '../privilege.ts';
import type { Route } from '../router.ts';
import { routes as seenRoutes } from '../seen.ts';

export { attachment } from '../files-http.ts';

const MAX_UPLOADS_LISTED = 500;
const MAX_KEY_BODY_BYTES = 1024;

interface FileRow {
  id: string;
  name: string;
  kind: string;
  content_type: string;
  source: string;
  size: number;
  r2_key: string;
}

interface DocRow extends CatalogRow {
  content_type: string;
  uploaded_by: string | null;
  uploader_name: string | null;
}

interface UploadRow {
  id: string;
  name: string;
  kind: string;
  size: number;
  updated_at: string;
  uploaded_by: string | null;
  uploader_name: string | null;
  pulled_at: string | null;
}

/** The whole room in one response (800 files is about 150 KB of JSON); the page filters it locally. */
async function listDocuments(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'view')) return errorJson('forbidden', 403);
  const { results } = await c.env.DB.prepare(
    'SELECT id, path, folder, name, kind, size, pages, updated_at, source, control_seq, key_at, key_by FROM documents ' +
      `WHERE removed_at IS NULL AND ${NOT_HIDDEN_SQL}${privilegeFilter(c.member.role)} ORDER BY path`,
  ).all<CatalogRow>();
  // The SQL already left out what the role may not see; the folder tree is built only from what passes again.
  return json({ root: buildTree(results.filter((row) => canSeeDocument(c.member.role, row.path))) });
}

async function getDoc(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'view')) return errorJson('forbidden', 403);
  if (!isAllowedDocumentRead(c.request)) return errorJson('forbidden', 403);
  const doc = await c.env.DB.prepare(
    'SELECT d.id, d.path, d.folder, d.name, d.kind, d.content_type, d.size, d.pages, d.updated_at, d.source, ' +
      'd.control_seq, d.key_at, d.key_by, ' +
      'd.uploaded_by, m.name AS uploader_name FROM documents d LEFT JOIN members m ON m.email = d.uploaded_by ' +
      `WHERE d.id = ?1 AND d.removed_at IS NULL${privilegeFilter(c.member.role, 'd.path')}`,
  )
    .bind(c.params.id)
    .first<DocRow>();
  if (!doc) return errorJson('not_found', 404);

  const viewer = viewerFor(doc.kind, doc.source);
  // A mirrored visual is audited by /files/:id when its frame loads (the binder's rule), so not twice.
  if (viewer !== 'visual') await auditOnce(c, 'view', doc.id);
  return json({
    id: doc.id,
    name: doc.name,
    folder: displayFolder(doc),
    kind: doc.kind,
    content_type: doc.content_type,
    size: doc.size,
    pages: doc.pages ?? null,
    updated_at: doc.updated_at,
    source: doc.source,
    uploaded_by: doc.source === 'counsel' ? doc.uploaded_by : null,
    uploader_name: doc.source === 'counsel' ? doc.uploader_name : null,
    control_seq: doc.control_seq ?? null,
    key_at: doc.key_at ?? null,
    key_by: doc.key_by ?? null,
    viewer,
  });
}

async function serveFile(c: RequestContext): Promise<Response> {
  if (!isAllowedDocumentRead(c.request)) return errorJson('forbidden', 403);
  // A privileged document is not found for a member who may not see it, exactly like a missing one.
  const doc = await c.env.DB.prepare(
    `SELECT id, name, kind, content_type, source, size, r2_key FROM documents WHERE id = ?1 AND removed_at IS NULL${privilegeFilter(c.member.role)}`,
  )
    .bind(c.params.id)
    .first<FileRow>();
  if (!doc) return errorJson('not_found', 404);

  const delivery = deliveryFor(doc, c.request.headers.get('Sec-Fetch-Dest'), c.url.searchParams.has('download'));
  if (!canPerform(c.member.role, delivery.action)) return errorJson('forbidden', 403);

  // Visuals are small pages framed whole; everything else supports single byte ranges.
  const range = delivery.mode === 'visual' ? ({ kind: 'full' } as const) : parseRange(c.request.headers.get('Range'), doc.size);
  if (range.kind === 'unsatisfiable') {
    const headers = { 'Content-Range': `bytes */${doc.size}`, 'Accept-Ranges': 'bytes' };
    return withSecurityHeaders(new Response(null, { status: 416, headers }), 'file');
  }

  const object = await c.env.FILES.get(doc.r2_key, range.kind === 'partial' ? { range: { offset: range.offset, length: range.length } } : undefined);
  if (!object) return errorJson('not_found', 404);

  // Every read is audited, deduplicated per member, document and action (range requests, resumed downloads).
  if (delivery.audit) await auditOnce(c, delivery.audit, doc.id);

  const headers = new Headers();
  if (delivery.mode === 'visual') {
    headers.set('Content-Type', 'text/html; charset=utf-8');
    return withSecurityHeaders(new Response(object.body, { headers }), 'visual');
  }

  headers.set('Accept-Ranges', 'bytes');
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

async function listUploads(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'view')) return errorJson('forbidden', 403);
  const { results } = await c.env.DB.prepare(
    'SELECT d.id, d.name, d.kind, d.size, d.updated_at, d.uploaded_by, m.name AS uploader_name, d.pulled_at ' +
      "FROM documents d LEFT JOIN members m ON m.email = d.uploaded_by WHERE d.source = 'counsel' AND d.removed_at IS NULL" +
      `${privilegeFilter(c.member.role, 'd.path')} ORDER BY d.updated_at DESC LIMIT ?1`,
  )
    .bind(MAX_UPLOADS_LISTED)
    .all<UploadRow>();
  const uploads = results.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    size: row.size,
    uploaded_at: row.updated_at,
    uploaded_by: row.uploaded_by,
    uploader_name: row.uploader_name,
    pulled: row.pulled_at !== null,
  }));
  return json({ uploads });
}

/**
 * Streams `stream` into R2 under `key`, hashing it on the way: the SHA-256 at intake, which every export is checked
 * against (research A3). R2 needs a body of known length, and the peeked stream has lost the request's, so
 * FixedLengthStream restores it; it also fails the put if the body is not exactly `size` bytes, so Content-Length
 * cannot understate a larger upload. Each chunk is hashed before it is passed on, so nothing is buffered.
 */
async function putExactly(
  c: RequestContext,
  key: string,
  stream: ReadableStream<Uint8Array>,
  size: number,
  contentType: string,
): Promise<{ etag: string; sha256: string }> {
  const digest = new crypto.DigestStream('SHA-256');
  const hasher = digest.getWriter();
  const hashing = new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      await hasher.write(chunk.slice());
      controller.enqueue(chunk);
    },
    flush: () => hasher.close(),
  });
  const { readable, writable } = new FixedLengthStream(size);
  const piped = stream.pipeThrough(hashing).pipeTo(writable);
  // A broken pipe also fails put() below, which is the error reported; this only keeps it from being unhandled.
  piped.catch(() => undefined);
  const stored = await c.env.FILES.put(key, readable, { httpMetadata: { contentType } });
  await piped;
  const sha256 = Array.from(new Uint8Array(await digest.digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return { etag: stored.etag, sha256 };
}

/** The percent-encoded X-Upload-Name header, decoded; null when missing or malformed. Never the URL. */
function uploadNameHeader(request: Request): string | null {
  const raw = request.headers.get('X-Upload-Name');
  if (raw === null) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

const PLAIN_KINDS = new Set(['markdown', 'csv', 'text']);

async function upload(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'upload')) return errorJson('forbidden', 403);

  const name = sanitizeUploadName(uploadNameHeader(c.request));
  if (!name) return errorJson('bad_name', 400);
  if (holdsPrintedNumber(name)) return errorJson('pii_in_name', 422);
  const type = uploadTypeOf(name);
  if (!type) return errorJson('type_not_allowed', 415);

  const length = checkContentLength(c.request.headers.get('Content-Length'));
  if (!length.ok) return errorJson(length.error, length.status);
  if (!c.request.body) return errorJson('empty_file', 400);

  const { head, stream } = await peekStream(c.request.body, HEAD_BYTES);
  if (!matchesMagic(type, head)) {
    await stream.cancel();
    return errorJson('content_mismatch', 415);
  }

  const id = crypto.randomUUID();
  const r2Key = crypto.randomUUID();
  // Checked on its way to R2 (worker/active-content.ts).
  const scan = activeContentGuard(scanKindOf(head));
  // Plain text is read for a printed SSN on its way in; other formats are read by the guard once synced down (#267).
  const pii = printedNumberGuard(PLAIN_KINDS.has(type.kind));
  let stored: { etag: string; sha256: string } | null = null;
  try {
    stored = await putExactly(c, r2Key, stream.pipeThrough(scan.stream).pipeThrough(pii.stream), length.size, type.contentType);
  } catch {
    // Short, long or refused: nothing usable was stored.
  }
  const refused = scan.finding();
  if (!stored || refused) {
    await c.env.FILES.delete(r2Key);
    if (!refused) return errorJson('incomplete_body', 400);
    console.warn('upload_active_content', refused);
    return errorJson('active_content', 422);
  }
  if (pii.found()) {
    await c.env.FILES.delete(r2Key);
    return errorJson('pii_in_file', 422);
  }

  const now = new Date().toISOString();
  try {
    await c.env.DB.prepare(
      'INSERT INTO documents (id, path, folder, name, kind, content_type, size, sha256, etag, pages, r2_key, source, uploaded_by, updated_at, control_seq) ' +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?12, ?8, NULL, ?9, 'counsel', ?10, ?11, ${NEXT_CONTROL_SEQ_SQL})`,
    )
      .bind(id, `from-counsel/${id}/${name}`, `from-counsel/${id}`, name, type.kind, type.contentType, length.size, stored.etag, r2Key, c.member.email, now, stored.sha256)
      .run();
  } catch (error) {
    await c.env.FILES.delete(r2Key);
    throw error;
  }
  await audit(c, 'upload', id);
  return json({ id, name, kind: type.kind, size: length.size }, 201);
}

interface KeyRow {
  id: string;
  key_at: string | null;
  key_by: string | null;
}

/** `{ key: true | false }`, or null for anything else (wrong type, bad JSON, too large). */
async function readKeyBody(request: Request): Promise<boolean | null> {
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get('Content-Type') ?? '')) return null;
  const text = await readLimited(request, MAX_KEY_BODY_BYTES);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, 'key')) return null;
    const key = (value as Record<string, unknown>).key;
    return typeof key === 'boolean' ? key : null;
  } catch {
    return null;
  }
}

/**
 * Sets (`{key: true}`) or clears (`{key: false}`) a live document's Key flag. Only a real change is
 * audited, so a second click or a retry leaves one row; setting keeps the first member's mark.
 */
async function setKey(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'flag')) return errorJson('forbidden', 403);
  const on = await readKeyBody(c.request);
  if (on === null) return errorJson('invalid_request', 400);
  const id = c.params.id!;
  const live = `id = ?1 AND removed_at IS NULL AND ${NOT_HIDDEN_SQL}`;
  const result = on
    ? await c.env.DB.prepare(`UPDATE documents SET key_at = ?2, key_by = ?3 WHERE ${live} AND key_at IS NULL`)
        .bind(id, new Date().toISOString(), c.member.email)
        .run()
    : await c.env.DB.prepare(`UPDATE documents SET key_at = NULL, key_by = NULL WHERE ${live} AND key_at IS NOT NULL`).bind(id).run();
  if (result.meta.changes > 0) await audit(c, on ? 'key' : 'unkey', id);
  const row = await c.env.DB.prepare(`SELECT id, key_at, key_by FROM documents WHERE ${live}`).bind(id).first<KeyRow>();
  if (!row) return errorJson('not_found', 404);
  return json({ id: row.id, key: row.key_at !== null, key_at: row.key_at, key_by: row.key_by });
}

export const routes: Route[] = [
  { method: 'GET', path: '/api/documents', handler: listDocuments },
  { method: 'GET', path: '/api/doc/:id', handler: getDoc },
  { method: 'GET', path: '/files/:id', handler: serveFile },
  { method: 'GET', path: '/api/uploads', handler: listUploads },
  { method: 'PUT', path: '/api/uploads', handler: upload },
  { method: 'POST', path: '/api/documents/:id/key', handler: setKey },
  ...exportRoutes,
  ...seenRoutes,
];
