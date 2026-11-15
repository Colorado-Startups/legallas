// SPDX-License-Identifier: Apache-2.0
// The one SQL file a sync applies with `wrangler d1 execute legallas --file`. Every value goes through
// sqlLiteral(). D1 rejects BEGIN TRANSACTION in files, so instead every statement is idempotent: the whole
// file can be applied again after a partial failure and ends in the same state.
//   numbers   UPDATE ... WHERE control_seq IS NULL (only rows a migration-era upload left unnumbered)
//   adds      INSERT ... ON CONFLICT DO NOTHING, numbered MAX(control_seq) + 1 inside the INSERT
//   changes   UPDATE by id (same values every time), after keeping an original version history keeps
//   renames   UPDATE by id
//   removals  UPDATE ... WHERE removed_at IS NULL (the row, comments and audit history stay)
//   audit     INSERT ... SELECT ... WHERE NOT EXISTS (same run timestamp, action and document)
// Every statement is scoped to source = 'mirror'. Counsel rows can only ever get pulled_at set.
import { NEXT_CONTROL_SEQ_SQL, NUMBER_UNNUMBERED_SQL } from '../worker/files-catalog.ts';
import { VERSION_KEPT_SQL } from '../worker/sync-rules.ts';
import { sqlLiteral } from '../worker/sql.ts';
import type { LocalFile, SyncPlan } from './diff.ts';

export const SYNC_EMAIL = 'sync@local';

type AuditAction = 'sync_added' | 'sync_changed' | 'sync_removed';

function audit(action: AuditAction, id: string, now: string): string {
  const [ts, email, act, doc] = [now, SYNC_EMAIL, action, id].map(sqlLiteral);
  return (
    `INSERT INTO audit_log (ts, email, action, document_id) SELECT ${ts}, ${email}, ${act}, ${doc} ` +
    `WHERE EXISTS (SELECT 1 FROM documents WHERE id = ${doc} AND source = 'mirror') ` +
    `AND NOT EXISTS (SELECT 1 FROM audit_log WHERE ts = ${ts} AND email = ${email} AND action = ${act} AND document_id = ${doc});`
  );
}

/**
 * Builds the sync SQL. `now` is the run's ISO timestamp (also the audit key that makes re-runs safe).
 * `pages` holds PDF page counts learned from extraction, for any live mirror document.
 */
export function syncSql(plan: SyncPlan<LocalFile>, now: string, pages: ReadonlyMap<string, number> = new Map()): string {
  const v = sqlLiteral;
  const pagesOf = (id: string) => v(pages.get(id) ?? null);
  const lines: string[] = [];

  for (const op of plan.removals) {
    lines.push(
      `UPDATE documents SET removed_at = ${v(now)}, updated_at = ${v(now)} WHERE id = ${v(op.id)} AND source = 'mirror' AND removed_at IS NULL;`,
      audit('sync_removed', op.id, now),
    );
  }
  for (const op of plan.renames) {
    lines.push(
      `UPDATE documents SET path = ${v(op.path)}, folder = ${v(op.folder)}, name = ${v(op.name)}, kind = ${v(op.kind)}, ` +
        `content_type = ${v(op.contentType)}, updated_at = ${v(now)} WHERE id = ${v(op.id)} AND source = 'mirror' AND removed_at IS NULL;`,
      audit('sync_changed', op.id, now),
    );
  }
  for (const op of plan.changes) {
    lines.push(
      // An original version history keeps goes to sync_retired, which apply.ts never deletes from (worker/sync-rules.ts).
      'INSERT INTO sync_retired (r2_key, document_id, retired_at) SELECT s.r2_key, s.document_id, ' +
        `${v(now)} FROM (SELECT r2_key, id AS document_id FROM documents WHERE id = ${v(op.id)} AND source = 'mirror' AND removed_at IS NULL ` +
        `AND r2_key <> ${v(op.r2Key)}) s WHERE ${VERSION_KEPT_SQL} ON CONFLICT DO NOTHING;`,
      `UPDATE documents SET size = ${v(op.size)}, sha256 = ${v(op.sha256)}, r2_key = ${v(op.r2Key)}, kind = ${v(op.kind)}, ` +
        `content_type = ${v(op.contentType)}, pages = ${pagesOf(op.id)}, etag = NULL, updated_at = ${v(now)} ` +
        `WHERE id = ${v(op.id)} AND source = 'mirror' AND removed_at IS NULL;`,
      audit('sync_changed', op.id, now),
    );
  }
  for (const op of plan.adds) {
    lines.push(
      'INSERT INTO documents (id, path, folder, name, kind, content_type, size, sha256, pages, r2_key, source, updated_at, control_seq) VALUES (' +
        [op.id, op.path, op.folder, op.name, op.kind, op.contentType, op.size, op.sha256].map(v).join(', ') +
        `, ${pagesOf(op.id)}, ${v(op.r2Key)}, 'mirror', ${v(now)}, ${NEXT_CONTROL_SEQ_SQL}) ON CONFLICT DO NOTHING;`,
      audit('sync_added', op.id, now),
    );
  }
  // Page counts for documents indexed this run that are not adds or changes (renamed or re-indexed).
  const written = new Set([...plan.adds, ...plan.changes].map((op) => op.id));
  for (const [id, count] of [...pages].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!written.has(id)) lines.push(`UPDATE documents SET pages = ${v(count)} WHERE id = ${v(id)} AND source = 'mirror';`);
  }
  // Rows still unnumbered are numbered first, so new adds come after them.
  return lines.length > 0 ? `${[NUMBER_UNNUMBERED_SQL, ...lines].join('\n')}\n` : '';
}

/**
 * Marks pulled counsel uploads. Scoped to source = 'counsel' and idempotent. It also numbers unnumbered
 * rows, because an upload made before the deploy that numbers uploads reaches the Mac through this file.
 */
export function pulledSql(ids: readonly string[], now: string): string {
  if (ids.length === 0) return '';
  const marks = ids.map(
    (id) => `UPDATE documents SET pulled_at = ${sqlLiteral(now)} WHERE id = ${sqlLiteral(id)} AND source = 'counsel' AND pulled_at IS NULL;\n`,
  );
  return `${NUMBER_UNNUMBERED_SQL}\n${marks.join('')}`;
}

/** The read the diff starts from. Only live mirror rows. */
export const MIRROR_ROWS_SQL =
  "SELECT id, path, sha256, size, kind, pages, r2_key, source, removed_at FROM documents WHERE source = 'mirror' AND removed_at IS NULL;";

/** Counsel uploads not yet on the Mac. */
export const PENDING_PULLS_SQL =
  "SELECT id, name, r2_key FROM documents WHERE source = 'counsel' AND pulled_at IS NULL AND removed_at IS NULL ORDER BY updated_at, id;";
