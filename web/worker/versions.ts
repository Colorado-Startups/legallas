// SPDX-License-Identifier: Apache-2.0
// Version history and a deal room's contents on a past date, from document_history (migration 0020), for the owner only.
//
// What keeps the bytes: worker/sync-rules.ts.
import { isAgentFile } from './agent-files.ts';
import { isHiddenName } from './files-catalog.ts';
import { isPrivilegedPath } from './privilege.ts';
import { covers } from './sync-rules.ts';
import { canGuest, privilegedMarks, servedRole } from './rooms.ts';

export interface Version {
  n: number;
  sha256: string | null;
  size: number;
  /** When this version came in. */
  date: string;
  /** When the next version replaced it; null for the current one. */
  replaced_at: string | null;
  current: boolean;
  /** The room still holds its bytes. */
  stored: boolean;
}

/** A document's versions, and each one's key in legallas-files (never returned to a client). */
export interface VersionList {
  name: string;
  contentType: string;
  rows: Version[];
  keys: string[];
}

interface VersionRow {
  r2_key: string;
  sha256: string | null;
  size: number;
  date: string;
  replaced_at: string | null;
  current: number;
  stored: number;
}

/** Each version of a live document, oldest first, numbered from 1. A rename is not a new version: versions are keys. */
export async function listVersions(db: D1Database, documentId: string, privilege: string): Promise<VersionList | null> {
  const doc = await db
    .prepare(`SELECT name, content_type, r2_key FROM documents WHERE id = ?1 AND removed_at IS NULL${privilege}`)
    .bind(documentId)
    .first<{ name: string; content_type: string; r2_key: string }>();
  if (!doc) return null;
  const { results } = await db
    .prepare(
      'SELECT h.r2_key, h.sha256, h.size, MIN(h.valid_from) AS date, ' +
        "CASE WHEN h.r2_key = ?2 THEN NULL ELSE MAX(COALESCE(h.valid_to, '')) END AS replaced_at, h.r2_key = ?2 AS current, " +
        '(h.r2_key = ?2 OR EXISTS (SELECT 1 FROM sync_retired s WHERE s.r2_key = h.r2_key)) AS stored ' +
        'FROM document_history h WHERE h.document_id = ?1 GROUP BY h.r2_key ORDER BY MIN(h.id)',
    )
    .bind(documentId, doc.r2_key)
    .all<VersionRow>();
  const rows = results.map((row, i) => ({
    n: i + 1,
    sha256: row.sha256,
    size: row.size,
    date: row.date,
    replaced_at: row.replaced_at || null,
    current: row.current === 1,
    stored: row.stored === 1,
  }));
  return { name: doc.name, contentType: doc.content_type, rows, keys: results.map((row) => row.r2_key) };
}

/** A document as the room showed it on a past date: the path and the bytes it had then. */
export interface ShownDocument {
  id: string;
  name: string;
  folder: string;
  sha256: string | null;
  size: number;
  /** When this version came in. */
  since: string;
}

/** The end of a plain date (UTC), an exact instant as given, or null. */
export function asOfInstant(value: string | null): string | null {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const end = `${value}T23:59:59.999Z`;
    return Number.isNaN(Date.parse(end)) || new Date(end).toISOString() !== end ? null : end;
  }
  if (value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value))) return value;
  return null;
}

/** When this database took a rule (migration 0029). A rule with no row was never taken, so it applies to no instant. */
async function ruleSince(db: D1Database, name: string): Promise<string | null> {
  const row = await db.prepare('SELECT at FROM rule_changes WHERE name = ?1').bind(name).first<{ at: string }>();
  return row?.at ?? null;
}

/**
 * What room `roomId` showed a guest at `at`: the room existed and was not archived, the folder was in it, and the
 * document was there with that path and those bytes. The guest rules of the role the room's kind serves apply to the
 * path it had then: counsel in a matter room saw privileged documents too (rooms.ts), from the instant this database took
 * that rule (migration 0029, #884), and before it what an investor sees. Privilege marks are today's, the
 * only ones kept: a document marked since `at` is hidden, and one unmarked since then shows as visible then. Owner only
 * (routes/versions.ts); marks that cannot be read throw, so nothing shows. Before migration 0020 only each document's
 * state since its last update is known.
 */
export async function roomAsOf(env: { DB: D1Database; FILES?: R2Bucket }, roomId: string, at: string, now: Date): Promise<ShownDocument[] | null> {
  const room = await env.DB.prepare('SELECT kind FROM rooms WHERE id = ?1').bind(roomId).first<{ kind: string }>();
  if (!room) return null;
  const role = servedRole(room.kind);
  const since = role !== null && canGuest(room.kind, role, 'viewPrivileged') ? await ruleSince(env.DB, 'counsel_sees_privileged') : null;
  const privileged = since !== null && since <= at;
  const marks = privileged ? new Set<string>() : await privilegedMarks(env as { FILES: R2Bucket }, now);
  const { results } = await env.DB.prepare(
    'SELECT DISTINCT h.document_id AS id, h.path, h.sha256, h.size, h.valid_from AS since FROM document_history h ' +
      "JOIN documents d ON d.id = h.document_id AND d.source = 'mirror' " +
      'JOIN room_folders f ON ' + covers('h.path') + ' JOIN rooms r ON r.id = f.room_id ' +
      'WHERE f.room_id = ?1 AND h.valid_from <= ?2 AND (h.valid_to IS NULL OR h.valid_to > ?2) ' +
      'AND f.added_at <= ?2 AND (f.removed_at IS NULL OR f.removed_at > ?2) AND r.created_at <= ?2 AND (r.archived_at IS NULL OR r.archived_at > ?2) ' +
      `${privileged ? '' : "AND h.path NOT LIKE '%privileged%' "}ORDER BY h.path`,
  )
    .bind(roomId, at)
    .all<{ id: string; path: string; sha256: string | null; size: number; since: string }>();
  return results
    .filter((row) => (privileged || !isPrivilegedPath(row.path)) && !isAgentFile(row.path) && !marks.has(row.id.toLowerCase()))
    .map((row) => {
      const slash = row.path.lastIndexOf('/');
      return { id: row.id, name: row.path.slice(slash + 1), folder: row.path.slice(0, Math.max(slash, 0)), sha256: row.sha256, size: row.size, since: row.since };
    })
    .filter((row) => !isHiddenName(row.name));
}
