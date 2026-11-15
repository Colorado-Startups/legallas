// SPDX-License-Identifier: Apache-2.0
// The checklist's rows (migration 0016). A match names a document its member can see: one they can't, a removed one or a room
// data file answers like a missing one. Each change also writes who made it, in the same batch (checklist_events, migration
// 0024): ids and codes only.
import { canSeeDocument, privilegeFilter } from './privilege.ts';
import type { Member, Role } from './env.ts';
import { NOT_HIDDEN_SQL } from './files-catalog.ts';
import type { MatchInput, MatchRow, NotApplicableRow } from './checklist.ts';

/** What checklist_events records (migration 0024). The owner's Activity feed shows each as `checklist_<action>`. */
export const CHECKLIST_EVENTS = ['matched', 'match_changed', 'unmatched', 'not_applicable', 'applies'] as const;
export type ChecklistEvent = (typeof CHECKLIST_EVENTS)[number];

/** The INSERT for one checklist event, batched with the change it records. */
export function checklistEvent(db: D1Database, email: string, action: ChecklistEvent, itemId: string, documentId: string | null, at: string): D1PreparedStatement {
  return db
    .prepare('INSERT INTO checklist_events (ts, email, action, item_id, document_id) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(at, email, action, itemId, documentId);
}

/** Every match on a document this role may see, the removed ones too. */
export async function readMatches(db: D1Database, role: Role): Promise<MatchRow[]> {
  const { results } = await db
    .prepare(
      'SELECT m.id, m.item_id, m.document_id, d.name, d.path, d.folder, d.source, d.control_seq, d.removed_at, ' +
        'm.signed, m.doc_date, m.next_date, m.parties, m.amount, m.matched_by ' +
        'FROM checklist_matches m JOIN documents d ON d.id = m.document_id ' +
        `WHERE d.${NOT_HIDDEN_SQL}${privilegeFilter(role, 'd.path')} ORDER BY m.matched_at, m.id`,
    )
    .all<MatchRow & { path: string }>();
  return results.filter((row) => canSeeDocument(role, row.path));
}

export async function readNotApplicable(db: D1Database): Promise<NotApplicableRow[]> {
  const { results } = await db.prepare('SELECT item_id, decided_by FROM checklist_not_applicable').all<NotApplicableRow>();
  return results;
}

/**
 * Matches a document to an item, or updates the match already there. A fact left out keeps what's on record, so picking a
 * document again never loses its date. False when the document can't be matched.
 */
export async function saveMatch(db: D1Database, member: Member, input: MatchInput, now: Date): Promise<boolean> {
  const document = await db
    .prepare(`SELECT path FROM documents WHERE id = ?1 AND removed_at IS NULL AND ${NOT_HIDDEN_SQL}${privilegeFilter(member.role)}`)
    .bind(input.documentId)
    .first<{ path: string }>();
  if (!document || !canSeeDocument(member.role, document.path)) return false;
  const existing = await db
    .prepare('SELECT signed, doc_date, next_date, parties, amount FROM checklist_matches WHERE item_id = ?1 AND document_id = ?2')
    .bind(input.itemId, input.documentId)
    .first<Pick<MatchRow, 'signed' | 'doc_date' | 'next_date' | 'parties' | 'amount'>>();
  const { signed, date, nextDate, parties, amount } = {
    signed: existing?.signed ?? null,
    date: existing?.doc_date ?? null,
    nextDate: existing?.next_date ?? null,
    parties: existing?.parties ?? null,
    amount: existing?.amount ?? null,
    ...input.facts,
  };
  const at = now.toISOString();
  await db.batch([
    db
      .prepare(
        'INSERT INTO checklist_matches (id, item_id, document_id, signed, doc_date, next_date, parties, amount, matched_by, matched_at) ' +
          'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ' +
          'ON CONFLICT (item_id, document_id) DO UPDATE SET signed = excluded.signed, doc_date = excluded.doc_date, ' +
          'next_date = excluded.next_date, parties = excluded.parties, amount = excluded.amount',
      )
      .bind(crypto.randomUUID(), input.itemId, input.documentId, signed, date, nextDate, parties, amount, member.email, at),
    checklistEvent(db, member.email, existing ? 'match_changed' : 'matched', input.itemId, input.documentId, at),
  ]);
  return true;
}

/**
 * Removes a match, never the document. The same rule as readMatches: a match on a document this role can't see answers
 * like a missing one, so false for both, and nothing is deleted.
 */
export async function removeMatch(db: D1Database, role: Role, id: string, email: string, now: Date): Promise<boolean> {
  const match = await db
    .prepare(
      'SELECT d.path, m.item_id, m.document_id FROM checklist_matches m JOIN documents d ON d.id = m.document_id ' +
        `WHERE m.id = ?1 AND d.${NOT_HIDDEN_SQL}${privilegeFilter(role, 'd.path')}`,
    )
    .bind(id)
    .first<{ path: string; item_id: string; document_id: string }>();
  if (!match || !canSeeDocument(role, match.path)) return false;
  // The delete carries the same filter, so it can only remove a match the role may see, whatever happened in between. The
  // event follows it in the batch and is written only once the match is gone.
  const [deleted] = await db.batch([
    db
      .prepare(
        'DELETE FROM checklist_matches WHERE id = ?1 AND EXISTS (SELECT 1 FROM documents d WHERE d.id = checklist_matches.document_id ' +
          `AND d.${NOT_HIDDEN_SQL}${privilegeFilter(role, 'd.path')})`,
      )
      .bind(id),
    db
      .prepare(
        "INSERT INTO checklist_events (ts, email, action, item_id, document_id) SELECT ?1, ?2, 'unmatched', ?3, ?4 " +
          'WHERE changes() > 0 AND NOT EXISTS (SELECT 1 FROM checklist_matches WHERE id = ?5)',
      )
      .bind(now.toISOString(), email, match.item_id, match.document_id, id),
  ]);
  return (deleted?.meta.changes ?? 0) > 0;
}

/** Records that an item doesn't apply, or takes that back. Taking back what was never said writes no event. */
export async function setApplies(db: D1Database, member: Member, itemId: string, applies: boolean, now: Date): Promise<void> {
  const at = now.toISOString();
  await db.batch(
    applies
      ? [
          db
            .prepare(
              "INSERT INTO checklist_events (ts, email, action, item_id) SELECT ?1, ?2, 'applies', ?3 WHERE EXISTS (SELECT 1 FROM checklist_not_applicable WHERE item_id = ?3)",
            )
            .bind(at, member.email, itemId),
          db.prepare('DELETE FROM checklist_not_applicable WHERE item_id = ?1').bind(itemId),
        ]
      : [
          db.prepare('INSERT OR REPLACE INTO checklist_not_applicable (item_id, decided_by, decided_at) VALUES (?1, ?2, ?3)').bind(itemId, member.email, at),
          checklistEvent(db, member.email, 'not_applicable', itemId, null, at),
        ],
  );
}
