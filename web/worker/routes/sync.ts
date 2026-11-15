// SPDX-License-Identifier: Apache-2.0
// The room's sync endpoints, for a laptop's Access service token and nothing else (docs/design/sync-endpoints.md). They
// have their own gate, in handleSync, because a service token has no email and so never passes the people's gate
// (auth.ts). room.ts checks the token (auth.ts verifySyncToken) and sends only /api/sync/ here, only while the room's
// SYNC_ENDPOINTS is "1". A person's token, or any browser request, is refused; a service token reaches nothing else.
//
//   GET    /api/sync/state                     the live mirror rows and the counsel uploads waiting (no R2 keys)
//   POST   /api/sync/lease                     { device, takeover? }: take the lease, or 409 with who holds it
//   PUT    /api/sync/lease                     renew it
//   DELETE /api/sync/lease                     give it back, and remove originals kept past their time
//   PUT    /api/sync/files/:key                one original up to 95 MB, at a new UUID key, checked against its sha256
//   DELETE /api/sync/files/:key                an upload no document uses yet (a stopped run's)
//   POST   /api/sync/files/:key/uploads        { contentType }: start a large file; the answer gives the part size
//   PUT    /api/sync/files/:key/uploads/:upload/parts/:n         one part
//   POST   /api/sync/files/:key/uploads/:upload/complete         { size, parts: [{ partNumber, etag }] }
//   DELETE /api/sync/files/:key/uploads/:upload                  give up
//   POST   /api/sync/record                    one batch of a run's adds, changes, renames, removals and page counts
//   PUT    /api/sync/index/:id/:part           one index part of a mirror document, counted against this month's ingestion
//   DELETE /api/sync/index/:id/:part
//   PUT    /api/sync/side/:name                one visual's side file (worker/side-files.ts)
//   DELETE /api/sync/side/:name
//   POST   /api/sync/reindex                   start an AI Search job
//   GET    /api/sync/pulls/:id                 a counsel upload not pulled yet, and only that
//   POST   /api/sync/pulls                     { run, ids }: mark them pulled
//   GET    /api/sync/drafts/:id                an approved draft not saved to the folder yet, and only that
//   POST   /api/sync/drafts                    { ids }: mark them saved to the folder
//
// The drafts routes, and `drafts` in the state, exist only while proposals are on and SAVE_BACK_SINCE is set (#65).
// Every route but state needs the lease, named in X-Sync-Lease. Errors are short codes, never a path or a name.
import { clientInfo } from '../audit.ts';
import { ingestTokensFor, limitOf, periodOf } from '../budget.ts';
import type { Env } from '../env.ts';
import { MAX_UPLOAD_BYTES } from '../files-upload.ts';
import { errorJson, json, readLimited } from '../http.ts';
import { matchRoute, type Route } from '../router.ts';
import { isVisualAiKey, VISUAL_AI_PREFIX, VISUAL_PNG_MAX_BYTES } from '../side-files.ts';
import { adjust, reserve } from '../spend.ts';
import {
  acquireLease,
  countLandedPart,
  countUpload,
  draftsEnabled,
  holdsLease,
  isDocId,
  isRecord,
  isSha256,
  isSyncKey,
  keyIsFor,
  keyIsUnused,
  LEASE_HEADER,
  leavesPrivilege,
  monthlyUploadBytes,
  MAX_PARTS,
  MAX_RECORD_BYTES,
  MAX_RECORD_OPS,
  parseSyncRecord,
  pulledStatements,
  purgeRetired,
  recordStatements,
  recordCounted,
  refundDeleted,
  refundAborted,
  refundUpload,
  releaseLease,
  renewLease,
  saveBackSince,
  savedStatements,
  SYNC_EMAIL,
  SYNC_PART_BYTES,
  syncState,
  syncTokenOwner,
  unsavedDrafts,
  unsavedDraftText,
  validDevice,
  validRun,
} from '../sync.ts';

const MAX_SMALL_BODY = 4096;
/** An index part (scripts/indexparts.ts PART_MAX_BYTES is 3.5 MB) or a visual's text, with room to spare. */
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
/** R2 upload ids are opaque and long. */
const MAX_UPLOAD_ID = 2048;
const CONTENT_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:; ?charset=[A-Za-z0-9_-]+)?$/;
/** scripts/indexparts.ts partKey. */
const PART_KEY = (id: string, part: number) => `text/${id}.p${part}.md`;

interface SyncContext {
  request: Request;
  env: Env;
  params: Record<string, string>;
  /** The room owner's email, whom the token maps to. */
  owner: string;
  lease: string;
}

interface SyncRoute extends Pick<Route, 'method' | 'path'> {
  /** State is a read a dry run makes; taking the lease needs no lease. Everything else names one. */
  lease?: false;
  /** Served only while proposals are on; otherwise the path answers like any unknown path. */
  drafts?: true;
  handler: (c: SyncContext) => Promise<Response>;
}

/** A JSON object body, or null for anything else. */
async function readObject(request: Request, max = MAX_SMALL_BODY): Promise<Record<string, unknown> | null> {
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get('Content-Type') ?? '')) return null;
  const text = await readLimited(request, max);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The request body as a stream of exactly its declared length, for R2. Fails the write if the body is not exactly that
 * long, so Content-Length cannot understate a larger upload (routes/files.ts putExactly). `piped` must be awaited after
 * the write.
 */
function exactBody(request: Request, size: number): { body: ReadableStream<Uint8Array> | Uint8Array; piped: Promise<void> } {
  if (size === 0 || !request.body) return { body: new Uint8Array(0), piped: Promise.resolve() };
  const { readable, writable } = new FixedLengthStream(size);
  const piped = request.body.pipeTo(writable);
  piped.catch(() => undefined);
  return { body: readable, piped };
}

/** A declared Content-Length within `max`; zero is allowed (an empty file is a file). */
function declaredSize(request: Request, max: number): number | null {
  const raw = request.headers.get('Content-Length');
  if (raw === null || !/^\d{1,15}$/.test(raw.trim())) return null;
  const size = Number(raw.trim());
  return size <= max ? size : null;
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

// --- The lease -------------------------------------------------------------------------------------------------

async function takeLease(c: SyncContext): Promise<Response> {
  const body = await readObject(c.request);
  const device = body?.device;
  const takeover = body?.takeover;
  if (!validDevice(device) || (takeover !== undefined && typeof takeover !== 'boolean')) return errorJson('invalid_request', 400);
  const result = await acquireLease(c.env.DB, device, takeover === true, new Date());
  if (result.ok) return json({ lease: result.lease, expires_at: result.expires_at }, 201);
  return json({ error: 'lease_held', device: result.holder?.device ?? null, expires_at: result.holder?.expires_at ?? null }, 409);
}

async function extendLease(c: SyncContext): Promise<Response> {
  return (await renewLease(c.env.DB, c.lease, new Date())) ? json({ ok: true }) : errorJson('lease_lost', 409);
}

async function giveBackLease(c: SyncContext): Promise<Response> {
  await releaseLease(c.env.DB, c.lease);
  // At the end of a run, so a stolen token can't speed it up: this removes only what has already waited out its time.
  const removed = await purgeRetired(c.env, new Date());
  return json({ ok: true, removed });
}

// --- Originals -------------------------------------------------------------------------------------------------

function contentTypeOf(request: Request): string | null {
  const value = request.headers.get('Content-Type');
  return value !== null && value.length <= 128 && CONTENT_TYPE.test(value) ? value : null;
}

async function putFile(c: SyncContext): Promise<Response> {
  const key = c.params.key!;
  if (!isSyncKey(key)) return errorJson('bad_key', 400);
  const sha256 = c.request.headers.get('X-Sync-Sha256');
  if (sha256 === null || !isSha256(sha256)) return errorJson('bad_checksum', 400);
  const contentType = contentTypeOf(c.request);
  if (!contentType) return errorJson('bad_type', 400);
  const size = declaredSize(c.request, MAX_UPLOAD_BYTES);
  if (size === null) return errorJson('bad_length', 411);

  if (!(await keyIsUnused(c.env.DB, key))) return errorJson('key_taken', 409);
  const existing = await c.env.FILES.head(key);
  if (existing) {
    // The same bytes again, after a lost response, are done already; anything else never overwrites.
    const same = existing.size === size && existing.checksums.sha256 !== undefined && hex(existing.checksums.sha256) === sha256;
    return same ? json({ key, size }, 200) : errorJson('key_taken', 409);
  }
  // One clock for the count and its refund: a body still arriving at midnight belongs to the month it started in.
  const now = new Date();
  if (!(await countUpload(c.env, size, now))) return errorJson('upload_budget', 429);
  const { body, piped } = exactBody(c.request, size);
  let written = false;
  try {
    // Create-once, in R2 itself, so two requests racing past the check above can't both write.
    const stored = await c.env.FILES.put(key, body, { httpMetadata: { contentType }, sha256, onlyIf: new Headers({ 'If-None-Match': '*' }) });
    if (!stored) {
      await refundUpload(c.env.DB, size, now);
      return errorJson('key_taken', 409);
    }
    written = true;
    await piped;
  } catch {
    // The body ended early, ran long, or does not match its checksum, so R2 stored nothing for this request. Nothing is
    // deleted: what is at this key now is another request's. A retry shouldn't spend the month, unless the bytes are stored.
    if (!written) await refundUpload(c.env.DB, size, now);
    return errorJson('incomplete_body', 400);
  }
  await recordCounted(c.env.DB, key, size, now);
  return json({ key, size }, 201);
}

async function deleteFile(c: SyncContext): Promise<Response> {
  const key = c.params.key!;
  if (!isSyncKey(key)) return errorJson('bad_key', 400);
  // Only a stopped run's own upload: what a document uses, or a sync replaced, is out of a token's reach.
  if (!(await keyIsUnused(c.env.DB, key))) return errorJson('key_taken', 409);
  await deleteCounted(c, key);
  return json({ ok: true });
}

/** Removes what a sync stored and gives back its bytes, so a run that stops doesn't spend the month it needs to finish. */
async function deleteCounted(c: SyncContext, key: string): Promise<void> {
  await c.env.FILES.delete(key);
  // Only what an upload recorded as counted comes back (sync.ts refundDeleted), never the size R2 reports.
  await refundDeleted(c.env.DB, key, new Date());
}

function uploadIdOf(c: SyncContext): string | null {
  const id = c.params.upload!;
  return id.length <= MAX_UPLOAD_ID ? id : null;
}

async function startUpload(c: SyncContext): Promise<Response> {
  const key = c.params.key!;
  if (!isSyncKey(key)) return errorJson('bad_key', 400);
  const body = await readObject(c.request);
  const contentType = typeof body?.contentType === 'string' && body.contentType.length <= 128 && CONTENT_TYPE.test(body.contentType) ? body.contentType : null;
  if (!contentType) return errorJson('bad_type', 400);
  if (!(await keyIsUnused(c.env.DB, key)) || (await c.env.FILES.head(key))) return errorJson('key_taken', 409);
  const upload = await c.env.FILES.createMultipartUpload(key, { httpMetadata: { contentType } });
  // One upload a key (#280): a second one would race the first to complete.
  const claimed = await c.env.DB.prepare('INSERT INTO sync_uploads (r2_key, upload) VALUES (?1, ?2) ON CONFLICT DO NOTHING RETURNING upload').bind(key, upload.uploadId).first();
  if (!claimed) {
    await upload.abort().catch(() => undefined);
    return errorJson('key_taken', 409);
  }
  return json({ upload: upload.uploadId, part_bytes: SYNC_PART_BYTES }, 201);
}

async function putPart(c: SyncContext): Promise<Response> {
  const key = c.params.key!;
  const uploadId = uploadIdOf(c);
  const part = Number(c.params.n);
  if (!isSyncKey(key) || !uploadId) return errorJson('bad_key', 400);
  if (!Number.isSafeInteger(part) || part < 1 || part > MAX_PARTS) return errorJson('bad_part', 400);
  const size = declaredSize(c.request, SYNC_PART_BYTES);
  if (!size) return errorJson('bad_length', 411);
  const now = new Date();
  if (!(await countUpload(c.env, size, now))) return errorJson('upload_budget', 429);
  const { body, piped } = exactBody(c.request, size);
  let written = false;
  try {
    const uploaded = await c.env.FILES.resumeMultipartUpload(key, uploadId).uploadPart(part, body);
    written = true;
    await piped;
    await countLandedPart(c.env.DB, key, uploadId, part, size, now);
    return json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
  } catch {
    // A short part, or an upload that no longer exists. The client sends the part again or starts over.
    if (!written) await refundUpload(c.env.DB, size, now);
    return errorJson('incomplete_body', 400);
  }
}

function validParts(value: unknown): R2UploadedPart[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PARTS) return null;
  const parts: R2UploadedPart[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !Number.isSafeInteger(entry.partNumber) || typeof entry.etag !== 'string' || entry.etag.length > 256) return null;
    parts.push({ partNumber: entry.partNumber as number, etag: entry.etag });
  }
  return parts;
}

/**
 * R2 can't make a multipart complete conditional, as it can a single put, so this looks first. A key that already holds an
 * object, or that a document or a kept original uses, is never completed over, so finishing an upload can't replace or
 * delete an original a document points at. Nothing here deletes anything: an upload of the wrong size stays unused, the
 * record refuses it, and a stopped run removes it.
 */
async function completeUpload(c: SyncContext): Promise<Response> {
  const key = c.params.key!;
  const uploadId = uploadIdOf(c);
  if (!isSyncKey(key) || !uploadId) return errorJson('bad_key', 400);
  // About 60 bytes a part, at R2's limit on parts.
  const body = await readObject(c.request, MAX_RECORD_BYTES * 2);
  const parts = validParts(body?.parts);
  const size = body?.size;
  if (!parts || !Number.isSafeInteger(size) || (size as number) < 0) return errorJson('invalid_request', 400);
  const existing = await c.env.FILES.head(key);
  // The same size again is a lost response: this upload already finished.
  if (existing) return existing.size === size ? json({ key, size }) : errorJson('key_taken', 409);
  if (!(await keyIsUnused(c.env.DB, key))) return errorJson('key_taken', 409);
  const owns = await c.env.DB.prepare('SELECT 1 AS found FROM sync_uploads WHERE r2_key = ?1 AND upload = ?2').bind(key, uploadId).first();
  if (!owns) return errorJson('key_taken', 409);
  try {
    const stored = await c.env.FILES.resumeMultipartUpload(key, uploadId).complete(parts);
    return stored.size === size ? json({ key, size }) : errorJson('size_mismatch', 409);
  } catch {
    return errorJson('incomplete_upload', 409);
  }
}

async function abortUpload(c: SyncContext): Promise<Response> {
  const key = c.params.key!;
  const uploadId = uploadIdOf(c);
  if (!isSyncKey(key) || !uploadId) return errorJson('bad_key', 400);
  // Best effort: R2 aborts an unfinished upload by itself after 7 days.
  await c.env.FILES.resumeMultipartUpload(key, uploadId).abort().catch(() => undefined);
  // What it counted comes back (#283), unless the key already holds a finished object: that stays spent.
  if (!(await c.env.FILES.head(key))) await refundAborted(c.env.DB, key, uploadId, new Date());
  await c.env.DB.prepare('DELETE FROM sync_uploads WHERE r2_key = ?1 AND upload = ?2').bind(key, uploadId).run();
  return json({ ok: true });
}

// --- The record ------------------------------------------------------------------------------------------------

/** Every new key names an object already in R2, of the size the record says, so a row can't point at nothing. */
async function objectsMatch(c: SyncContext, ops: readonly { r2_key: string; size: number; sha256: string }[]): Promise<boolean> {
  const checks = await Promise.all(
    ops.map(async (op) => {
      const stored = await c.env.FILES.head(op.r2_key);
      if (!stored || stored.size !== op.size) return false;
      // Present for a single put, absent for a multipart object (whose parts R2 checked by size).
      return stored.checksums.sha256 === undefined || hex(stored.checksums.sha256) === op.sha256;
    }),
  );
  return checks.every(Boolean);
}

async function writeRecord(c: SyncContext): Promise<Response> {
  const received = new Date();
  const record = parseSyncRecord(await readObject(c.request, MAX_RECORD_BYTES), received);
  if (!record) return errorJson('invalid_request', 400);
  // A privileged document stays privileged: moved out, it could land in a folder a deal room's guests see.
  const moves = await Promise.all(
    record.renames.map(async (op) => {
      const row = await c.env.DB.prepare('SELECT path FROM documents WHERE id = ?1').bind(op.id).first<{ path: string }>();
      return row !== null && leavesPrivilege(row.path, op.path);
    }),
  );
  if (moves.some(Boolean)) return errorJson('privileged_move', 409);
  const ops = [...record.changes, ...record.adds];
  // A row takes only a new key: never another document's original, and never one a sync replaced and the room is keeping.
  const free = await Promise.all(ops.map((op) => keyIsFor(c.env.DB, op.r2_key, op.id)));
  if (!free.every(Boolean)) return errorJson('key_taken', 409);
  if (!(await objectsMatch(c, ops))) return errorJson('object_mismatch', 409);
  await c.env.DB.batch(recordStatements(c.env.DB, record, c.request, received));
  return json({ ok: true });
}

// --- The index and the visuals' side files ----------------------------------------------------------------------

function partOf(c: SyncContext): string | null {
  const id = c.params.id!;
  const part = Number(c.params.part);
  return isDocId(id) && Number.isSafeInteger(part) && part >= 1 ? PART_KEY(id, part) : null;
}

async function putIndexPart(c: SyncContext): Promise<Response> {
  const key = partOf(c);
  if (!key) return errorJson('bad_key', 400);
  const size = declaredSize(c.request, MAX_TEXT_BYTES);
  if (!size) return errorJson('bad_length', 411);
  // Text belongs to a mirror document the record already holds. Counsel's uploads are never indexed through here.
  const doc = await c.env.DB.prepare("SELECT 1 AS found FROM documents WHERE id = ?1 AND source = 'mirror' AND removed_at IS NULL").bind(c.params.id).first();
  if (!doc) return errorJson('not_found', 404);
  // New text costs AI Search ingestion, so it counts here, where no client can skip it. The meter's limit is the stop.
  const meter = 'search_ingest_tokens';
  const period = periodOf(meter, new Date());
  const tokens = ingestTokensFor(size);
  if (!(await reserve(c.env.DB, meter, period, tokens, limitOf(meter, period, 'script')))) return errorJson('ingest_budget', 429);
  const { body, piped } = exactBody(c.request, size);
  let written = false;
  try {
    await c.env.INDEX.put(key, body, { httpMetadata: { contentType: 'text/markdown; charset=utf-8' } });
    written = true;
    await piped;
  } catch {
    // A retry shouldn't spend the month, unless the text was written.
    if (!written) await adjust(c.env.DB, meter, period, -tokens);
    return errorJson('incomplete_body', 400);
  }
  const text = indexTextOf(c.request);
  if (text) await c.env.DB.prepare(RECORD_PART_SQL).bind(c.params.id, text.sha256, Number(c.params.part), text.stamp).run();
  return json({ key }, 201);
}

/** The text a part belongs to, from the client's headers: its file's sha256 and the reader's version. Null when absent or odd. */
function indexTextOf(request: Request): { sha256: string; stamp: string } | null {
  const sha256 = request.headers.get('X-Index-Sha256') ?? '';
  const raw = request.headers.get('X-Index-Stamp') ?? '';
  if (!/^[0-9a-f]{64}$/.test(sha256) || raw.length > 200) return null;
  try {
    const stamp = JSON.parse(raw) as unknown;
    const fair = typeof stamp === 'object' && stamp !== null && !Array.isArray(stamp) &&
      Object.entries(stamp).every(([key, value]) => ['extractor', 'render', 'text'].includes(key) && Number.isSafeInteger(value));
    return fair ? { sha256, stamp: JSON.stringify(stamp) } : null;
  } catch {
    return null;
  }
}

/** Part n of the same text raises the count; part n of new text starts it again. */
const RECORD_PART_SQL =
  'INSERT INTO index_text (document_id, sha256, parts, stamp) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (document_id) DO UPDATE SET ' +
  'parts = CASE WHEN index_text.sha256 = excluded.sha256 AND index_text.stamp = excluded.stamp THEN max(index_text.parts, excluded.parts) ELSE excluded.parts END, ' +
  'sha256 = excluded.sha256, stamp = excluded.stamp';

/** Deleting a part the text holds blanks its sha, so the next sync writes it again (#279); past its end, clean-up changes nothing. */
const DELETE_PART_SQL = "UPDATE index_text SET sha256 = '', parts = ?2 - 1 WHERE document_id = ?1 AND ?2 <= parts";

async function deleteIndexPart(c: SyncContext): Promise<Response> {
  const key = partOf(c);
  if (!key) return errorJson('bad_key', 400);
  // Text is derived from the document, and the original is untouched. The room's record says it went, so the next sync writes it again.
  await c.env.INDEX.delete(key);
  await c.env.DB.prepare(DELETE_PART_SQL).bind(c.params.id, Number(c.params.part)).run();
  return json({ ok: true });
}

function sideKeyOf(c: SyncContext): string | null {
  const key = `${VISUAL_AI_PREFIX}${c.params.name!}`;
  return isVisualAiKey(key) ? key : null;
}

async function putSideFile(c: SyncContext): Promise<Response> {
  const key = sideKeyOf(c);
  if (!key) return errorJson('bad_key', 400);
  const png = key.endsWith('.png');
  const size = declaredSize(c.request, png ? VISUAL_PNG_MAX_BYTES : MAX_TEXT_BYTES);
  if (size === null) return errorJson('bad_length', 411);
  const now = new Date();
  if (!(await countUpload(c.env, size, now))) return errorJson('upload_budget', 429);
  const { body, piped } = exactBody(c.request, size);
  let written = false;
  try {
    await c.env.FILES.put(key, body, { httpMetadata: { contentType: png ? 'image/png' : 'text/plain; charset=utf-8' } });
    written = true;
    await piped;
  } catch {
    if (!written) await refundUpload(c.env.DB, size, now);
    return errorJson('incomplete_body', 400);
  }
  await recordCounted(c.env.DB, key, size, now);
  return json({ key }, 201);
}

async function deleteSideFile(c: SyncContext): Promise<Response> {
  const key = sideKeyOf(c);
  if (!key) return errorJson('bad_key', 400);
  await deleteCounted(c, key);
  return json({ ok: true });
}

// --- The search index ------------------------------------------------------------------------------------------

async function reindex(c: SyncContext): Promise<Response> {
  try {
    await c.env.SEARCH.jobs.create({ description: 'sync' });
    return json({ ok: true });
  } catch {
    // The text is in legallas-index either way, and the instance's own schedule picks it up.
    return errorJson('reindex_failed', 502);
  }
}

// --- Counsel's uploads, coming down -----------------------------------------------------------------------------

async function pullFile(c: SyncContext): Promise<Response> {
  const id = c.params.id!;
  // Waiting uploads only: a token can't read the mirror, and can't read an upload again once it is pulled.
  const row = await c.env.DB.prepare("SELECT r2_key FROM documents WHERE id = ?1 AND source = 'counsel' AND pulled_at IS NULL AND removed_at IS NULL")
    .bind(id)
    .first<{ r2_key: string }>();
  const stored = row ? await c.env.FILES.get(row.r2_key) : null;
  if (!stored) return errorJson('not_found', 404);
  const { ip, userAgent } = clientInfo(c.request);
  await c.env.DB.prepare("INSERT INTO audit_log (email, action, document_id, ip, user_agent) VALUES (?1, 'download', ?2, ?3, ?4)").bind(SYNC_EMAIL, id, ip, userAgent).run();
  return new Response(stored.body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(stored.size) } });
}

async function markPulled(c: SyncContext): Promise<Response> {
  const body = await readObject(c.request, MAX_RECORD_BYTES);
  const ids = body?.ids;
  const run = body?.run;
  if (!Array.isArray(ids) || ids.length > MAX_RECORD_OPS || !validRun(run, new Date())) return errorJson('invalid_request', 400);
  if (!ids.every((id): id is string => typeof id === 'string' && isDocId(id))) return errorJson('invalid_request', 400);
  await c.env.DB.batch(pulledStatements(c.env.DB, ids, run));
  return json({ ok: true });
}

// --- Approved drafts, going back to the folder (#65) ------------------------------------------------------------

async function state(c: SyncContext): Promise<Response> {
  const current = await syncState(c.env.DB);
  const since = saveBackSince(c.env);
  return json(since ? { ...current, drafts: await unsavedDrafts(c.env.DB, c.owner, since) } : current);
}

async function draftFile(c: SyncContext): Promise<Response> {
  const id = c.params.id!;
  // Unsaved ones only: a token can't read a draft again once it is in the folder, nor anyone else's.
  const since = saveBackSince(c.env);
  const text = since && isDocId(id) ? await unsavedDraftText(c.env.DB, c.owner, since, id, c.request) : null;
  if (text === null) return errorJson('not_found', 404);
  return new Response(text, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
}

async function markSaved(c: SyncContext): Promise<Response> {
  const ids = (await readObject(c.request, MAX_RECORD_BYTES))?.ids;
  if (!Array.isArray(ids) || ids.length > MAX_RECORD_OPS) return errorJson('invalid_request', 400);
  if (!ids.every((id): id is string => typeof id === 'string' && isDocId(id))) return errorJson('invalid_request', 400);
  const since = saveBackSince(c.env);
  if (since && ids.length > 0) await c.env.DB.batch(savedStatements(c.env.DB, c.owner, since, ids, c.request));
  return json({ ok: true });
}

// --- The gate ---------------------------------------------------------------------------------------------------

export const SYNC_ROUTES: readonly SyncRoute[] = [
  { method: 'GET', path: '/api/sync/state', lease: false, handler: state },
  { method: 'POST', path: '/api/sync/lease', lease: false, handler: takeLease },
  { method: 'PUT', path: '/api/sync/lease', handler: extendLease },
  { method: 'DELETE', path: '/api/sync/lease', handler: giveBackLease },
  { method: 'PUT', path: '/api/sync/files/:key', handler: putFile },
  { method: 'DELETE', path: '/api/sync/files/:key', handler: deleteFile },
  { method: 'POST', path: '/api/sync/files/:key/uploads', handler: startUpload },
  { method: 'PUT', path: '/api/sync/files/:key/uploads/:upload/parts/:n', handler: putPart },
  { method: 'POST', path: '/api/sync/files/:key/uploads/:upload/complete', handler: completeUpload },
  { method: 'DELETE', path: '/api/sync/files/:key/uploads/:upload', handler: abortUpload },
  { method: 'POST', path: '/api/sync/record', handler: writeRecord },
  { method: 'PUT', path: '/api/sync/index/:id/:part', handler: putIndexPart },
  { method: 'DELETE', path: '/api/sync/index/:id/:part', handler: deleteIndexPart },
  { method: 'PUT', path: '/api/sync/side/:name', handler: putSideFile },
  { method: 'DELETE', path: '/api/sync/side/:name', handler: deleteSideFile },
  { method: 'POST', path: '/api/sync/reindex', handler: reindex },
  { method: 'GET', path: '/api/sync/pulls/:id', handler: pullFile },
  { method: 'POST', path: '/api/sync/pulls', handler: markPulled },
  { method: 'GET', path: '/api/sync/drafts/:id', drafts: true, handler: draftFile },
  { method: 'POST', path: '/api/sync/drafts', drafts: true, handler: markSaved },
];

/**
 * Everything behind a verified service token. `clientId` is what auth.ts verifySyncToken returned; null is refused here
 * so room.ts has one thing to call. A browser always says where a request comes from, and sync is never a page's
 * business, so a request carrying either header is refused however it is signed in.
 */
export async function handleSync(request: Request, env: Env, url: URL, clientId: string | null): Promise<Response> {
  if (!clientId) return errorJson('forbidden', 403);
  if (request.headers.get('Origin') !== null || request.headers.get('Sec-Fetch-Site') !== null) return errorJson('forbidden', 403);
  const owner = await syncTokenOwner(env.DB, clientId);
  if (!owner) return errorJson('forbidden', 403);
  if (monthlyUploadBytes(env) === null) return errorJson('bad_setting', 500);

  const routes = draftsEnabled(env) ? SYNC_ROUTES : SYNC_ROUTES.filter((route) => !route.drafts);
  const match = matchRoute(routes, request.method, url.pathname);
  if (match.kind === 'none') return errorJson('not_found', 404);
  if (match.kind === 'wrong-method') {
    const response = errorJson('method_not_allowed', 405);
    response.headers.set('Allow', match.allow.join(', '));
    return response;
  }
  const lease = request.headers.get(LEASE_HEADER);
  if (match.route.lease !== false && !(await holdsLease(env.DB, lease))) return errorJson('lease_lost', 409);
  return match.route.handler({ request, env, params: match.params, owner, lease: lease ?? '' });
}
