// SPDX-License-Identifier: Apache-2.0
// The proof checklist (track pages), the pure half: one row per point to prove, its strongest proof, its
// authority and the cites behind it, strongest first. A point with no proof is a gap, shown as "Not yet in the
// record". No DOM, so proof-list-model.test.ts runs it under node --test.
import type { ProofStrength, ServedCite } from './matter-api.ts';
import { strongestProof } from './overview-case-model.ts';

/** A point the proof list asks to prove: its id, text and authority. */
export interface ProofPoint {
  id: string;
  text: string;
  authority: string | null;
  proof: { cite: ServedCite; strength: ProofStrength; note: string | null }[];
}

/** A cite for a point, with its strength and what the document shows. */
export interface ProofCite {
  cite: ServedCite;
  strength: ProofStrength;
  /** What the document shows for the point, as the chip's title. */
  note: string | null;
}

/** One row of the proof list: a point, its text and its authority. */
export interface ProofRow {
  id: string;
  text: string;
  authority: string | null;
  strength: ProofStrength;
  gap: boolean;
  /** Proof cites, strongest first, each document page once. Empty for a gap. */
  cites: ProofCite[];
}

const RANK: Record<ProofStrength, number> = { direct: 3, corroborating: 2, circumstantial: 1, gap: 0 };

/** The words shown for a point that has no proof yet. */
export const GAP_TEXT = 'Not yet in the record';

/** The words a row's ring stands for, for its accessible name and the visible word beside it. */
export const PROOF_WORDS: Record<ProofStrength, string> = {
  direct: 'Direct proof', corroborating: 'Corroborating proof', circumstantial: 'Circumstantial proof', gap: GAP_TEXT,
};

/** One row per point, in order. */
export function proofRows(points: readonly ProofPoint[]): ProofRow[] {
  return points.map((point) => {
    const { strength } = strongestProof(point);
    const seen = new Set<string>();
    const cites = point.proof
      .filter((item) => item.strength !== 'gap')
      .map((item, i) => ({ item, i }))
      .sort((a, b) => RANK[b.item.strength] - RANK[a.item.strength] || a.i - b.i)
      .flatMap(({ item }) => {
        const key = `${item.cite.doc}#${item.cite.page ?? ''}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ cite: item.cite, strength: item.strength, note: item.note ?? item.cite.note ?? null }];
      });
    return { id: point.id, text: point.text, authority: point.authority, strength, gap: strength === 'gap', cites };
  });
}

/** "3 points, 1 gap" for the checklist heading. */
export function proofTally(rows: readonly Pick<ProofRow, 'gap'>[]): string {
  const gaps = rows.filter((row) => row.gap).length;
  const points = `${rows.length} ${rows.length === 1 ? 'point' : 'points'}`;
  return gaps === 0 ? points : `${points}, ${gaps} ${gaps === 1 ? 'gap' : 'gaps'}`;
}
