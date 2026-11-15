// SPDX-License-Identifier: Apache-2.0
// The litigation room's register: one state for every control number from the room's first to its last, so a
// production can say what happened to each (card #126; research N2 and N3). A produced number went out, whole or
// redacted; a withheld one is on the privilege log (privilege-log.ts); every other number carries one reason from a
// closed list, never free text. Removed documents keep their numbers (migration 0003), so a removed number with no
// decision is listed as removed, and a number no document took is listed as never assigned. Accounting for every
// number is a practice standard drawn from SEC and DOJ production specifications, not a rule, and the room says so.
// Pure: the caller reads the documents from D1 and counsel's decisions from wherever they are kept.

export const STATES = ['produced', 'redacted', 'withheld', 'other'] as const;
export type NumberState = (typeof STATES)[number];

/** Why a number is neither produced nor withheld. A closed list: anything else is refused. */
export const OTHER_REASONS = ['not_responsive', 'duplicate_suppressed', 'withheld_on_objection', 'reserved', 'removed', 'never_assigned'] as const;
export type OtherReason = (typeof OTHER_REASONS)[number];

/** Counsel's decision for one number. `reason` is set exactly when the state is 'other'. */
export interface Decision {
  state: NumberState;
  reason?: OtherReason | null;
}

/** One number's line in the register. */
export interface RegisterRow {
  seq: number;
  state: NumberState;
  reason: OtherReason | null;
}

/** A documents row as the register reads it. */
export interface NumberedDocument {
  control_seq: number | null;
  removed_at: string | null;
}

export type NumberProblem =
  /** A live document's number with no decision. */
  | { problem: 'unaccounted'; seq: number }
  /** A decision for a number no document holds. */
  | { problem: 'unknown_number'; seq: number }
  /** A state outside STATES, an 'other' with no reason from OTHER_REASONS, or a reason on another state. */
  | { problem: 'bad_reason'; seq: number };

const isSeq = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function decisionProblem(decision: Decision): boolean {
  if (!(STATES as readonly string[]).includes(decision.state)) return true;
  const reason = decision.reason ?? null;
  if (decision.state !== 'other') return reason !== null;
  return !(OTHER_REASONS as readonly string[]).includes(reason as string);
}

/**
 * The register from the room's numbered documents (removed ones included) and counsel's decisions by number. Rows run
 * from the first number to the last with none skipped; a number that can't be accounted for gets no row and a problem
 * instead, so a register with no problems accounts for every number.
 */
export function accountNumbers(
  documents: readonly NumberedDocument[],
  decisions: ReadonlyMap<number, Decision>,
): { rows: RegisterRow[]; problems: NumberProblem[] } {
  const held = new Map<number, NumberedDocument>();
  for (const doc of documents) if (isSeq(doc.control_seq)) held.set(doc.control_seq, doc);
  const problems: NumberProblem[] = [];
  for (const seq of decisions.keys()) if (!held.has(seq)) problems.push({ problem: 'unknown_number', seq });
  const rows: RegisterRow[] = [];
  if (held.size === 0) return { rows, problems };
  const numbers = [...held.keys()];
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);
  for (let seq = first; seq <= last; seq++) {
    const doc = held.get(seq);
    const decision = decisions.get(seq);
    if (decision) {
      if (decisionProblem(decision)) problems.push({ problem: 'bad_reason', seq });
      else rows.push({ seq, state: decision.state, reason: decision.reason ?? null });
    } else if (!doc) rows.push({ seq, state: 'other', reason: 'never_assigned' });
    else if (doc.removed_at !== null) rows.push({ seq, state: 'other', reason: 'removed' });
    else problems.push({ problem: 'unaccounted', seq });
  }
  problems.sort((a, b) => a.seq - b.seq);
  return { rows, problems };
}
