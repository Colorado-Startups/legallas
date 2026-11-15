// SPDX-License-Identifier: Apache-2.0
// What the room's sync endpoints (routes/sync.ts) may do to the record, and the checks behind them. A laptop keeps a
// room in step with its folder through these with an Access service token, so a lost laptop can add to the room, change
// what it mirrors and, while proposals are on, read the owner's approved drafts not yet saved to the folder, and nothing
// else: no SQL, no deploys, no other bucket, and it never destroys a stored original.
//
//   - The token must map to the room's owner on every request (syncTokenOwner).
//   - One uploader at a time, held by a lease row. A takeover changes the lease id, which fences the old device out.
//   - The room works out a document's folder, name, kind and content type from its path, and refuses a path the sync
//     guard would never send, so a request can't place a file where a person would mistake it for counsel's.
//   - Every statement is scoped to source = 'mirror', like scripts/sqlplan.ts, and every one is idempotent, so a batch
//     can be sent again after a lost response. D1 runs a batch as one transaction.
//   - An original a sync replaces or removes is kept for RETAIN_DAYS (migration 0015, sync_retired), and longer while
//     version history keeps it (sync-rules.ts).
import { clientInfo } from './audit.ts';
import { splitPath, kindOf } from './doc-kinds.ts';
import { draftText, type DraftRow } from './draft-text.ts';
import { NEXT_CONTROL_SEQ_SQL, NUMBER_UNNUMBERED_SQL } from './files-catalog.ts';
import { isDocId, isSha256, isSyncKey, MONTHLY_UPLOAD_GB, PURGEABLE_SQL, RETAIN_DAYS, validSyncPath } from './sync-rules.ts';

export { isDocId, isSha256, isSyncKey, LEASE_HEADER, leavesPrivilege, validDevice, validSyncPath } from './sync-rules.ts';
export { RETAIN_DAYS } from './sync-rules.ts';

/** Not in wrangler.example.jsonc, so a room turns the endpoints on deliberately: it also needs SYNC_ACCESS_AUD. */
export interface SyncSetting {
  SYNC_ENDPOINTS?: string;
  /** When save-back starts (#65): an ISO time. Unset, nothing is saved back; drafts approved before it never are. */
  SAVE_BACK_SINCE?: string;
}

/** True only when the room has turned the endpoints on. Off, their paths answer like any unknown path. */
export function syncEnabled(env: SyncSetting): boolean {
  return env.SYNC_ENDPOINTS === '1';
}

const SYNC_PATH = '/api/sync/';

export function isSyncPath(pathname: string): boolean {
  return pathname.startsWith(SYNC_PATH);
}

/** How long a lease lasts without a renewal, before another device may take it without asking. */
export const LEASE_TTL_MS = 5 * 60_000;
/** Size of every part but the last of a large file: R2 needs them equal, and a Worker request carries under 100 MB. */
export const SYNC_PART_BYTES = 50 * 1024 * 1024;
/** R2's limit on parts in one upload. */
export const MAX_PARTS = 10_000;
const RETAIN_MS = RETAIN_DAYS * 86_400_000;
/** At most this many retired originals are removed in one go; the next run removes the rest. */
const PURGE_BATCH = 100;
/** Adds, changes, renames, removals and page counts in one record request. The client sends more in several. */
export const MAX_RECORD_OPS = 100;
/** A record body at MAX_RECORD_OPS with long paths. */
export const MAX_RECORD_BYTES = 512 * 1024;
/** Accepted distance of a run's timestamp from the room's clock: a long upload is fine, a forged history is not. */
const MAX_RUN_SKEW_MS = 7 * 86_400_000;

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// --- The token -------------------------------------------------------------------------------------------------

/**
 * The owner's email when `clientId` is a live sync token that maps to the room's owner, else null. Read on every
 * request, so revoking the token, or removing the owner, ends it at once.
 */
export async function syncTokenOwner(db: D1Database, clientId: string): Promise<string | null> {
  const row = await db
    .prepare(
      'SELECT t.owner_email AS email FROM sync_tokens t JOIN members m ON m.email = t.owner_email ' +
        "WHERE t.client_id = ?1 AND t.revoked_at IS NULL AND m.role = 'owner'",
    )
    .bind(clientId)
    .first<{ email: string }>();
  return row?.email ?? null;
}

// --- The lease -------------------------------------------------------------------------------------------------

export interface LeaseHolder {
  device: string;
  expires_at: string;
}

export type LeaseResult = { ok: true; lease: string; expires_at: string } | { ok: false; holder: LeaseHolder | null };

/**
 * Takes the lease when it is free, expired or already this device's, or with `takeover`. One upsert, so two devices can
 * never both win. Every grant has a new lease id, so even the same device's crashed run is fenced out.
 */
export async function acquireLease(db: D1Database, device: string, takeover: boolean, now: Date, leaseId: string = crypto.randomUUID()): Promise<LeaseResult> {
  const at = now.toISOString();
  const expires = new Date(now.getTime() + LEASE_TTL_MS).toISOString();
  const row = await db
    .prepare(
      'INSERT INTO sync_lease (id, lease_id, device, expires_at) VALUES (1, ?1, ?2, ?3) ' +
        'ON CONFLICT (id) DO UPDATE SET lease_id = excluded.lease_id, device = excluded.device, expires_at = excluded.expires_at ' +
        'WHERE sync_lease.expires_at <= ?4 OR sync_lease.device = ?2 OR ?5 = 1 RETURNING lease_id',
    )
    .bind(leaseId, device, expires, at, takeover ? 1 : 0)
    .first<{ lease_id: string }>();
  if (row) return { ok: true, lease: row.lease_id, expires_at: expires };
  const holder = await db.prepare('SELECT device, expires_at FROM sync_lease WHERE id = 1').first<LeaseHolder>();
  return { ok: false, holder };
}

/** Extends the lease; false when another device has taken it since. */
export async function renewLease(db: D1Database, leaseId: string, now: Date): Promise<boolean> {
  const { meta } = await db
    .prepare('UPDATE sync_lease SET expires_at = ?2 WHERE id = 1 AND lease_id = ?1')
    .bind(leaseId, new Date(now.getTime() + LEASE_TTL_MS).toISOString())
    .run();
  return (meta.changes ?? 0) > 0;
}

export async function releaseLease(db: D1Database, leaseId: string): Promise<void> {
  await db.prepare('DELETE FROM sync_lease WHERE id = 1 AND lease_id = ?1').bind(leaseId).run();
}

/** True while `leaseId` is the lease. An expired one still counts until another device takes it. */
export async function holdsLease(db: D1Database, leaseId: string | null): Promise<boolean> {
  if (!leaseId) return false;
  const row = await db.prepare('SELECT 1 AS held FROM sync_lease WHERE id = 1 AND lease_id = ?1').bind(leaseId).first<{ held: number }>();
  return row !== null;
}

// --- What a token can add ---------------------------------------------------------------------------------------

/**
 * The month's cap in bytes, or null when SYNC_MONTHLY_GB isn't above 0 and within the documented cap: a room refuses to sync
 * then. The setting can only lower the cap, because raising what a stolen token can store is a billing decision.
 */
export function monthlyUploadBytes(env: { SYNC_MONTHLY_GB?: string }): number | null {
  if (env.SYNC_MONTHLY_GB === undefined) return MONTHLY_UPLOAD_GB * 1024 ** 3;
  const gb = Number(env.SYNC_MONTHLY_GB);
  return gb > 0 && gb <= MONTHLY_UPLOAD_GB ? gb * 1024 ** 3 : null;
}

/** Counts `bytes` against this month's cap, in one statement; false when they don't fit. */
export async function countUpload(env: { DB: D1Database; SYNC_MONTHLY_GB?: string }, bytes: number, now: Date): Promise<boolean> {
  const cap = monthlyUploadBytes(env);
  if (cap === null) return false;
  const row = await env.DB
    .prepare('INSERT INTO sync_upload_bytes (period, used) SELECT ?1, ?2 WHERE ?2 <= ?3 ON CONFLICT (period) DO UPDATE SET used = used + ?2 WHERE used + ?2 <= ?3 RETURNING used')
    .bind(now.toISOString().slice(0, 7), bytes, cap)
    .first<{ used: number }>();
  return row !== null;
}

/** Gives back what an upload counted and didn't store. */
export async function refundUpload(db: D1Database, bytes: number, now: Date): Promise<void> {
  await db.prepare('UPDATE sync_upload_bytes SET used = MAX(used - ?2, 0) WHERE period = ?1').bind(now.toISOString().slice(0, 7), bytes).run();
}

/**
 * Records that `bytes` stored at `key` counted against this month, so a delete can give back only what counted. A side file
 * written again under its key replaces the row: the earlier write's bytes stay spent.
 */
export async function recordCounted(db: D1Database, key: string, bytes: number, now: Date): Promise<void> {
  await db
    .prepare('INSERT INTO sync_counted (r2_key, period, bytes) VALUES (?1, ?2, ?3) ON CONFLICT (r2_key) DO UPDATE SET period = ?2, bytes = ?3')
    .bind(key, now.toISOString().slice(0, 7), bytes)
    .run();
}

/** Adds one part's counted bytes to its key, this month: a part sent in an earlier month stays spent there. */
export async function addCountedPart(db: D1Database, key: string, bytes: number, now: Date): Promise<void> {
  await db
    .prepare('INSERT INTO sync_counted (r2_key, period, bytes) VALUES (?1, ?2, ?3) ON CONFLICT (r2_key) DO UPDATE SET bytes = CASE WHEN period = ?2 THEN bytes + ?3 ELSE ?3 END, period = ?2')
    .bind(key, now.toISOString().slice(0, 7), bytes)
    .run();
}

/** The row that remembers what one part of one upload counted, so the same part sent again counts once (#283). */
const partMarker = (key: string, upload: string, part: number) => `${key}/parts/${upload}/${part}`;

/**
 * Counts a part that landed: added to its key, and remembered on its own. A part sent again gives back what its
 * earlier try counted this month, so a flaky link can't spend the month twice.
 */
export async function countLandedPart(db: D1Database, key: string, upload: string, part: number, bytes: number, now: Date): Promise<void> {
  const period = now.toISOString().slice(0, 7);
  const earlier = await db
    .prepare('DELETE FROM sync_counted WHERE r2_key = ?1 RETURNING period, bytes')
    .bind(partMarker(key, upload, part))
    .first<{ period: string; bytes: number }>();
  const again = earlier && earlier.period === period ? earlier.bytes : 0;
  if (again > 0) await refundUpload(db, again, now);
  await addCountedPart(db, key, bytes - again, now);
  await db.prepare('INSERT INTO sync_counted (r2_key, period, bytes) VALUES (?1, ?2, ?3)').bind(partMarker(key, upload, part), period, bytes).run();
}

/** An upload given up: what it counted this month comes back, and its parts' rows go. */
export async function refundAborted(db: D1Database, key: string, upload: string, now: Date): Promise<void> {
  await db.prepare("DELETE FROM sync_counted WHERE r2_key LIKE ?1 ESCAPE '\\'").bind(`${partMarker(key, upload, 0).slice(0, -1).replace(/[\\%_]/g, '\\$&')}%`).run();
  await refundDeleted(db, key, now);
}

/**
 * Gives back what `key` counted this month, once. The first delete takes the row, so a second at the same time finds none.
 * A key with no row (a side file stored before counting began) or last month's row gives nothing back.
 */
export async function refundDeleted(db: D1Database, key: string, now: Date): Promise<void> {
  const row = await db.prepare('DELETE FROM sync_counted WHERE r2_key = ?1 RETURNING period, bytes').bind(key).first<{ period: string; bytes: number }>();
  if (row && row.period === now.toISOString().slice(0, 7)) await refundUpload(db, row.bytes, now);
}

// --- What a run reads ------------------------------------------------------------------------------------------

export interface SyncStateRow {
  id: string;
  path: string;
  sha256: string | null;
  size: number;
  kind: string;
  pages: number | null;
}

export interface SyncPending {
  id: string;
  name: string;
}

/** The live mirror rows (scripts/sqlplan.ts MIRROR_ROWS_SQL) and the counsel uploads not pulled yet. No R2 keys. */
/** The room's record of a live document's search text, as a sync's index manifest holds it (scripts/indexjob.ts). */
export type IndexRecord = Record<string, { sha256: string; parts: number; extractor?: number; render?: number; text?: number }>;

export async function syncState(db: D1Database): Promise<{ rows: SyncStateRow[]; pending: SyncPending[]; index: IndexRecord }> {
  const [rows, pending, texts] = await Promise.all([
    db.prepare("SELECT id, path, sha256, size, kind, pages FROM documents WHERE source = 'mirror' AND removed_at IS NULL").all<SyncStateRow>(),
    db.prepare("SELECT id, name FROM documents WHERE source = 'counsel' AND pulled_at IS NULL AND removed_at IS NULL ORDER BY updated_at, id").all<SyncPending>(),
    db.prepare("SELECT t.document_id AS id, t.sha256, t.parts, t.stamp FROM index_text t JOIN documents d ON d.id = t.document_id WHERE d.source = 'mirror' AND d.removed_at IS NULL")
      .all<{ id: string; sha256: string; parts: number; stamp: string }>(),
  ]);
  const index: IndexRecord = {};
  for (const text of texts.results) index[text.id] = { sha256: text.sha256, parts: text.parts, ...(JSON.parse(text.stamp) as object) };
  return { rows: rows.results, pending: pending.results, index };
}

// --- What a run writes -----------------------------------------------------------------------------------------

export interface SyncFileOp {
  id: string;
  path: string;
  size: number;
  sha256: string;
  r2_key: string;
}

export interface SyncRename {
  id: string;
  path: string;
}

/** One request's worth of a sync's record: the same four groups as scripts/diff.ts SyncPlan, and page counts. */
export interface SyncRecord {
  run: string;
  removals: string[];
  renames: SyncRename[];
  changes: SyncFileOp[];
  adds: SyncFileOp[];
  pages: Record<string, number>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validFileOp(value: unknown): value is SyncFileOp {
  if (!isRecord(value)) return false;
  const { id, path, size, sha256, r2_key: key } = value;
  return (
    typeof id === 'string' && isDocId(id) &&
    validSyncPath(path) &&
    Number.isSafeInteger(size) && (size as number) >= 0 &&
    typeof sha256 === 'string' && isSha256(sha256) &&
    typeof key === 'string' && isSyncKey(key)
  );
}

function validRename(value: unknown): value is SyncRename {
  return isRecord(value) && typeof value.id === 'string' && isDocId(value.id) && validSyncPath(value.path);
}

/** A run's timestamp: the exact form the sync writes, and not far from the room's clock. */
export function validRun(run: unknown, now: Date): run is string {
  return typeof run === 'string' && ISO_MS.test(run) && Math.abs(Date.parse(run) - now.getTime()) <= MAX_RUN_SKEW_MS;
}

/** The body of a record request, or null for anything malformed. Unknown fields are ignored. */
export function parseSyncRecord(raw: unknown, now: Date): SyncRecord | null {
  if (!isRecord(raw)) return null;
  const { run, removals, renames, changes, adds, pages } = raw;
  if (!validRun(run, now)) return null;
  if (!Array.isArray(removals) || !Array.isArray(renames) || !Array.isArray(changes) || !Array.isArray(adds) || !isRecord(pages)) return null;
  if (!removals.every((id) => typeof id === 'string' && isDocId(id))) return null;
  if (!renames.every(validRename) || !changes.every(validFileOp) || !adds.every(validFileOp)) return null;
  const pageEntries = Object.entries(pages);
  if (!pageEntries.every(([id, count]) => isDocId(id) && Number.isSafeInteger(count) && (count as number) >= 0)) return null;
  if (removals.length + renames.length + changes.length + adds.length + pageEntries.length > MAX_RECORD_OPS) return null;
  return { run, removals, renames, changes, adds, pages: pages as Record<string, number> };
}

const RETIRE_LIVE =
  "INSERT INTO sync_retired (r2_key, document_id, retired_at) SELECT r2_key, id, ?2 FROM documents WHERE id = ?1 AND source = 'mirror' AND removed_at IS NULL";
const WRITE_AUDIT =
  'INSERT INTO audit_log (ts, email, action, document_id, ip, user_agent) SELECT ?1, ?2, ?3, ?4, ?5, ?6 ' +
  "WHERE EXISTS (SELECT 1 FROM documents WHERE id = ?4 AND source = 'mirror') " +
  'AND NOT EXISTS (SELECT 1 FROM audit_log WHERE ts = ?1 AND email = ?2 AND action = ?3 AND document_id = ?4)';

/** The email a sync's audit rows carry, as scripts/sqlplan.ts SYNC_EMAIL: the activity page already shows these. */
export const SYNC_EMAIL = 'sync@local';

type SyncAuditAction = 'sync_added' | 'sync_changed' | 'sync_removed';

/**
 * The statements of one record request, in the order scripts/sqlplan.ts syncSql writes them, so a removal frees a path
 * before an add takes it. The audit rows also carry the request's IP, so the owner can see where a sync came from.
 */
export function recordStatements(db: D1Database, record: SyncRecord, request: Request, received: Date): D1PreparedStatement[] {
  const { ip, userAgent } = clientInfo(request);
  const now = record.run;
  // The keep period runs on the room's clock: the run's time is the client's word, up to a week off.
  const retiredAt = received.toISOString();
  const audit = (action: SyncAuditAction, id: string) => db.prepare(WRITE_AUDIT).bind(now, SYNC_EMAIL, action, id, ip, userAgent);
  const pagesOf = (id: string) => record.pages[id] ?? null;
  const statements: D1PreparedStatement[] = [db.prepare(NUMBER_UNNUMBERED_SQL)];

  for (const id of record.removals) {
    statements.push(
      db.prepare(`${RETIRE_LIVE} ON CONFLICT DO NOTHING`).bind(id, retiredAt),
      db.prepare("UPDATE documents SET removed_at = ?2, updated_at = ?2 WHERE id = ?1 AND source = 'mirror' AND removed_at IS NULL").bind(id, now),
      audit('sync_removed', id),
    );
  }
  for (const op of record.renames) {
    const { folder, name } = splitPath(op.path);
    const { kind, contentType } = kindOf(op.path);
    statements.push(
      db
        .prepare(
          'UPDATE documents SET path = ?2, folder = ?3, name = ?4, kind = ?5, content_type = ?6, updated_at = ?7 ' +
            "WHERE id = ?1 AND source = 'mirror' AND removed_at IS NULL",
        )
        .bind(op.id, op.path, folder, name, kind, contentType, now),
      audit('sync_changed', op.id),
    );
  }
  for (const op of record.changes) {
    const { kind, contentType } = kindOf(op.path);
    statements.push(
      // The old original is kept; on a re-send the row already holds the new key, so nothing is retired twice.
      db.prepare(`${RETIRE_LIVE} AND path = ?3 AND r2_key <> ?4 ON CONFLICT DO NOTHING`).bind(op.id, retiredAt, op.path, op.r2_key),
      db
        .prepare(
          'UPDATE documents SET size = ?2, sha256 = ?3, r2_key = ?4, kind = ?5, content_type = ?6, pages = ?7, etag = NULL, updated_at = ?8 ' +
            "WHERE id = ?1 AND path = ?9 AND source = 'mirror' AND removed_at IS NULL",
        )
        .bind(op.id, op.size, op.sha256, op.r2_key, kind, contentType, pagesOf(op.id), now, op.path),
      audit('sync_changed', op.id),
    );
  }
  for (const op of record.adds) {
    const { folder, name } = splitPath(op.path);
    const { kind, contentType } = kindOf(op.path);
    statements.push(
      db
        .prepare(
          'INSERT INTO documents (id, path, folder, name, kind, content_type, size, sha256, pages, r2_key, source, updated_at, control_seq) ' +
            `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'mirror', ?11, ${NEXT_CONTROL_SEQ_SQL}) ON CONFLICT DO NOTHING`,
        )
        .bind(op.id, op.path, folder, name, kind, contentType, op.size, op.sha256, pagesOf(op.id), op.r2_key, now),
      audit('sync_added', op.id),
    );
  }
  const written = new Set([...record.adds, ...record.changes].map((op) => op.id));
  for (const [id, count] of Object.entries(record.pages)) {
    if (!written.has(id)) statements.push(db.prepare("UPDATE documents SET pages = ?2 WHERE id = ?1 AND source = 'mirror'").bind(id, count));
  }
  return statements;
}

/** Marks pulled counsel uploads: source = 'counsel' only, and idempotent, like scripts/sqlplan.ts pulledSql. */
export function pulledStatements(db: D1Database, ids: readonly string[], now: string): D1PreparedStatement[] {
  const marks = ids.map((id) =>
    db.prepare("UPDATE documents SET pulled_at = ?2 WHERE id = ?1 AND source = 'counsel' AND pulled_at IS NULL").bind(id, now),
  );
  return [db.prepare(NUMBER_UNNUMBERED_SQL), ...marks];
}

// --- Approved drafts, going back to the folder (#65) ------------------------------------------------------------

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/;

/**
 * When save-back starts, as the room stores times, or null while it is off: it needs proposals on (proposals.ts
 * proposalsEnabled, the same rule, here because that module imports jose and these routes don't) and a valid
 * SAVE_BACK_SINCE, so a room turns it on deliberately and nothing approved before then is ever written out.
 */
export function saveBackSince(env: SyncSetting & { PROPOSALS_ENABLED?: string }): string | null {
  const since = env.SAVE_BACK_SINCE;
  if (env.PROPOSALS_ENABLED !== '1' || since === undefined || !ISO_TIME.test(since) || !Number.isFinite(Date.parse(since))) return null;
  return new Date(since).toISOString();
}

export function draftsEnabled(env: SyncSetting & { PROPOSALS_ENABLED?: string }): boolean {
  return saveBackSince(env) !== null;
}

/**
 * Drafts the owner's own AI proposed and the owner approved since save-back started, that no sync has saved to the
 * folder yet. The owner sees every document, so proposal-review.ts's privilege rule takes nothing away here. ?1 is the
 * owner's email, ?2 when save-back started.
 */
const UNSAVED_DRAFTS =
  "FROM proposals p WHERE p.proposed_by = ?1 AND p.status = 'approved' AND p.kind = 'draft_document' AND p.decided_at >= ?2 " +
  "AND NOT EXISTS (SELECT 1 FROM proposal_events e WHERE e.proposal_id = p.id AND e.action = 'applied') " +
  // A visual lands in the binder (proposal-visual.ts), never in Drafts/.
  'AND NOT EXISTS (SELECT 1 FROM proposal_visuals v WHERE v.proposal_id = p.id)';

export interface SyncDraft {
  id: string;
  /** The approved title as a file name. The laptop makes it safe and unique, as it does counsel's names. */
  name: string;
}

export async function unsavedDrafts(db: D1Database, owner: string, since: string): Promise<SyncDraft[]> {
  const { results } = await db
    .prepare(`SELECT p.id, coalesce(p.final_title, p.title) AS title ${UNSAVED_DRAFTS} ORDER BY p.decided_at, p.id LIMIT ${MAX_RECORD_OPS}`)
    .bind(owner, since)
    .all<{ id: string; title: string }>();
  return results.map((row) => ({ id: row.id, name: `${row.title}.md` }));
}

/** One unsaved draft's file, exactly as the room's download serves it, and a `downloaded` event; null for anything else. */
export async function unsavedDraftText(db: D1Database, owner: string, since: string, id: string, request: Request): Promise<string | null> {
  const row = await db.prepare(`SELECT p.* ${UNSAVED_DRAFTS} AND p.id = ?3`).bind(owner, since, id).first<DraftRow>();
  if (!row) return null;
  const { ip, userAgent } = clientInfo(request);
  await db
    .prepare("INSERT INTO proposal_events (proposal_id, action, actor_email, detail_code, ip, user_agent) VALUES (?1, 'downloaded', ?2, 'sync', ?3, ?4)")
    .bind(id, SYNC_EMAIL, ip, userAgent)
    .run();
  return draftText(row);
}

/** One `applied` event per draft now in the folder. Idempotent: a draft already saved, or not the owner's, writes nothing. */
export function savedStatements(db: D1Database, owner: string, since: string, ids: readonly string[], request: Request): D1PreparedStatement[] {
  const { ip, userAgent } = clientInfo(request);
  return ids.map((id) =>
    db
      .prepare(`INSERT INTO proposal_events (proposal_id, action, actor_email, detail_code, ip, user_agent) SELECT p.id, 'applied', ?4, 'saved_to_folder', ?5, ?6 ${UNSAVED_DRAFTS} AND p.id = ?3`)
      .bind(owner, since, id, SYNC_EMAIL, ip, userAgent),
  );
}

// --- Keeping what a sync replaced -------------------------------------------------------------------------------

/** True when no document, live or removed, and no kept original uses `key`: only then may a request write or delete it. */
export async function keyIsUnused(db: D1Database, key: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS used FROM documents WHERE r2_key = ?1 UNION ALL SELECT 1 AS used FROM sync_retired WHERE r2_key = ?1 LIMIT 1')
    .bind(key)
    .first<{ used: number }>();
  return row === null;
}

/**
 * True when document `id` may point at `key`: no other document uses it and it is not a kept original. A re-send finds
 * its own key here, so it passes.
 */
export async function keyIsFor(db: D1Database, key: string, id: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS used FROM documents WHERE r2_key = ?1 AND id <> ?2 UNION ALL SELECT 1 AS used FROM sync_retired WHERE r2_key = ?1 LIMIT 1')
    .bind(key, id)
    .first<{ used: number }>();
  return row === null;
}

/**
 * Removes originals kept past RETAIN_DAYS, a batch at a time, except those version history keeps. Returns how many went.
 * Only this, and the same rule in scripts/apply.ts for `npm run sync`, ever deletes them.
 */
export async function purgeRetired(env: { DB: D1Database; FILES: Pick<R2Bucket, 'delete'> }, now: Date): Promise<number> {
  await env.DB.prepare('DELETE FROM sync_counted WHERE period < ?1').bind(now.toISOString().slice(0, 7)).run();
  const cutoff = new Date(now.getTime() - RETAIN_MS).toISOString();
  const { results } = await env.DB.prepare(PURGEABLE_SQL).bind(cutoff, PURGE_BATCH).all<{ r2_key: string }>();
  if (results.length === 0) return 0;
  const keys = results.map((row) => row.r2_key);
  // A key a live row uses again can't happen through sync (keys are new each time); this keeps a mistake harmless.
  const live = await env.DB.prepare(`SELECT r2_key FROM documents WHERE removed_at IS NULL AND r2_key IN (${keys.map((_, i) => `?${i + 1}`).join(', ')})`).bind(...keys).all<{ r2_key: string }>();
  const inUse = new Set(live.results.map((row) => row.r2_key));
  const gone = keys.filter((key) => !inUse.has(key));
  if (gone.length > 0) await env.FILES.delete(gone);
  await env.DB.batch(keys.map((key) => env.DB.prepare('DELETE FROM sync_retired WHERE r2_key = ?1').bind(key)));
  return gone.length;
}
