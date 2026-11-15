// SPDX-License-Identifier: Apache-2.0
// The checklist_update kind (docs/design/propose-and-approve.md, "Next"): an AI proposes, by the item's id, that one item
// on the company checklist (docs/checklist/baseline.toml) does or doesn't apply, and the owner approves it, since it
// changes the company's checklist. The room writes the proposal's title and body from the item and the change, and
// approving reads the change back only from text the room wrote. Approving writes checklist_not_applicable (migration
// 0016) and who changed it (checklist_events, 0024) in the same batch as the decision, and only when that decision took effect.
import { BASELINE } from './checklist-baseline.ts';
import { createDraftProposal, type CreateResult, type Proposer } from './proposals.ts';

export interface ChecklistChange {
  itemId: string;
  applies: boolean;
}

/** The title and body the room stores for a change; null for an id the checklist doesn't have. */
export function checklistChangeText({ itemId, applies }: ChecklistChange): { title: string; body: string } | null {
  const item = BASELINE.items.find((candidate) => candidate.id === itemId);
  if (!item) return null;
  return {
    title: `Checklist: ${item.title}`.slice(0, 200),
    body: `Mark the checklist item "${item.title}" (${item.id}) as ${applies ? 'applying' : 'not applying'} to this company.`,
  };
}

/** The change a stored body describes: the one whose room-written text it is, exactly; else null. */
export function checklistChangeOf(body: string): ChecklistChange | null {
  for (const item of BASELINE.items) {
    for (const applies of [true, false]) {
      if (checklistChangeText({ itemId: item.id, applies })?.body === body) return { itemId: item.id, applies };
    }
  }
  return null;
}

/** Stores a pending checklist_update, as createDraftProposal does a draft. An unknown item id stores nothing. */
export async function createChecklistProposal(
  db: D1Database,
  proposer: Proposer,
  change: ChecklistChange,
  why: string,
  now: Date,
): Promise<CreateResult | { ok: false; error: 'item_not_found' }> {
  const text = checklistChangeText(change);
  if (!text) return { ok: false, error: 'item_not_found' };
  return createDraftProposal(db, proposer, { ...text, why, sources: [] }, now, 'checklist_update');
}

/**
 * The write approving a checklist_update makes, in the approving batch: it runs only when the proposal carries
 * `decision`, that is when this decision's UPDATE took effect. Null when the body is not one the room wrote.
 */
export function checklistApply(db: D1Database, body: string, approver: string, at: string, id: string, decision: string): D1PreparedStatement[] | null {
  const change = checklistChangeOf(body);
  if (!change) return null;
  const took = 'EXISTS (SELECT 1 FROM proposals WHERE id = ?2 AND decision_id = ?3)';
  // Who changed the checklist (migration 0024), written only when the decision took effect, as the change is.
  const event = (action: 'applies' | 'not_applicable', when: string) =>
    db
      .prepare(`INSERT INTO checklist_events (ts, email, action, item_id) SELECT ?5, ?4, '${action}', ?1 WHERE ${took}${when}`)
      .bind(change.itemId, id, decision, approver, at);
  return change.applies
    ? [
        event('applies', ' AND EXISTS (SELECT 1 FROM checklist_not_applicable WHERE item_id = ?1)'),
        db.prepare(`DELETE FROM checklist_not_applicable WHERE item_id = ?1 AND ${took}`).bind(change.itemId, id, decision),
      ]
    : [
        db
          .prepare(`INSERT OR REPLACE INTO checklist_not_applicable (item_id, decided_by, decided_at) SELECT ?1, ?4, ?5 WHERE ${took}`)
          .bind(change.itemId, id, decision, approver, at),
        event('not_applicable', ''),
      ];
}
