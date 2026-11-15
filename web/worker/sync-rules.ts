// SPDX-License-Identifier: Apache-2.0
// What the room's sync endpoints accept, in one place with no Cloudflare types, so the sync engine on the laptop
// (scripts/room-sync.ts, scripts/sync.ts) can refuse in a dry run what the room would refuse during a run.

/** The header that names the writer's lease. */
export const LEASE_HEADER = 'X-Sync-Lease';

/**
 * Gigabytes a sync token may add to legallas-files in a month. R2 bills storage, and nothing sweeps an object no document
 * uses (a crashed run's, a thief's), so this is what bounds that cost: at R2's USD 0.015 per GB-month, a month's worth
 * costs about USD 3.75 a month to keep, and each full month adds that again.
 */
export const MONTHLY_UPLOAD_GB = 250;

const MAX_PATH_BYTES = 1024;
const MAX_DEVICE = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DOC_ID = /^[0-9a-f-]{36}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const encoder = new TextEncoder();

/** A key sync may write in legallas-files: a random UUID and nothing else. */
export function isSyncKey(key: string): boolean {
  return UUID.test(key);
}

export function isDocId(id: string): boolean {
  return DOC_ID.test(id);
}

export function isSha256(value: string): boolean {
  return SHA256.test(value);
}

/** A device's self-chosen name: what another device is told when the lease is held. */
export function validDevice(device: unknown): device is string {
  return typeof device === 'string' && device.length > 0 && device.length <= MAX_DEVICE && !CONTROL.test(device);
}

/**
 * True when a move takes a document out of a privileged path, by the reading worker/privilege.ts has: any segment holding
 * "privileged", ASCII case aside. The room refuses it, and the engine sends it as a removal and a new file instead.
 */
export function leavesPrivilege(from: string, to: string): boolean {
  return /privileged/i.test(from) && !/privileged/i.test(to);
}

/**
 * A path a sync may give a document: relative, '/'-separated, NFC, with no empty, "." or ".." segment, no backslash or
 * control character, within the length limit, with no private segment (scripts/guard.ts isPrivateSegment says why
 * "contains" and both normal forms), and not under from-counsel/, which belongs to counsel's uploads.
 */
export function validSyncPath(path: unknown): path is string {
  if (typeof path !== 'string' || path === '' || path.normalize('NFC') !== path) return false;
  if (encoder.encode(path).length > MAX_PATH_BYTES || CONTROL.test(path) || path.includes('\\')) return false;
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  if (segments.some((segment) => ['NFC', 'NFKC'].some((form) => segment.normalize(form).toLowerCase().includes('_private')))) return false;
  return segments[0]!.toLowerCase() !== 'from-counsel'; // safe: split always yields a first segment
}

// --- How long a replaced original stays -----------------------------------------------------------------------
// sync_retired (migrations 0015, 0020), read by worker/sync.ts purgeRetired and by `npm run sync` (scripts/apply.ts), so
// both paths keep the same rule. A replaced original is kept only while its document is in a room whose owner turned
// version history on (npm run room -- versions <room> on), and never longer than that room: off, archived, the folder
// removed or the document moved out, and RETAIN_DAYS runs from when it was replaced.

/** How long an original a sync replaced or removed stays in R2, so the owner can notice a stolen laptop in time. */
export const RETAIN_DAYS = 30;

/** A folder f covers the document path `path` (worker/rooms.ts VISIBLE_SQL: exact prefix and a slash, never LIKE). */
export const covers = (path: string) => `substr(${path}, 1, length(f.folder) + 1) = f.folder || '/'`;

/**
 * True for a sync_retired row s that version history keeps: its document is live, mirrored, not under a privileged path,
 * and shown by a live folder of a room that is not archived and has version history on.
 */
export const VERSION_KEPT_SQL =
  'EXISTS (SELECT 1 FROM documents kd JOIN room_folders f ON ' + covers('kd.path') + ' JOIN rooms r ON r.id = f.room_id ' +
  "WHERE kd.id = s.document_id AND kd.removed_at IS NULL AND kd.source = 'mirror' AND kd.path NOT LIKE '%privileged%' " +
  'AND f.removed_at IS NULL AND r.archived_at IS NULL AND r.version_history_at IS NOT NULL)';

/**
 * True while no legal hold is on (worker/hold.ts, migration 0017). Every purge puts it in its own WHERE clause, so a hold
 * blocks it even if one starts between a check and the delete: this purge, the retention sweep (worker/data-retention.ts)
 * and `npm run close-out` (scripts/close-out.ts).
 */
export const NO_HOLD_SQL = 'NOT EXISTS (SELECT 1 FROM legal_holds WHERE released_at IS NULL)';

/** Kept originals retired before ?1 that version history doesn't keep, oldest first, at most ?2. None while a hold is on. */
export const PURGEABLE_SQL = `SELECT r2_key FROM sync_retired s WHERE retired_at < ?1 AND NOT ${VERSION_KEPT_SQL} AND ${NO_HOLD_SQL} ORDER BY retired_at LIMIT ?2`;
