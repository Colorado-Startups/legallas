// SPDX-License-Identifier: Apache-2.0
// Card F5b (Charts viz). The claims and proof grid: for each count, its elements down the side and the cited
// documents across; a cell is the target-ring glyph of that document's strongest proof for that element, linking
// to the cited page. The strongest strength is repeated as a word, and an element with nothing behind it shows a
// dashed ring and "Gap". Strength is never a color scale or a number. This file holds the model and its glyphs:
// `buildMatrix`, `strongestOf` and `nextCell` are pure (matrix.test.ts); claims-matrix.ts draws the grid.

import type { Cite, ClaimElement, MatterClaim, ProofItem, ProofStrength } from '../../../worker/matter-types.ts';
import { ringSvg } from './ring.ts';

/** The word shown for each strength of proof. */
export const STRENGTH_WORDS: Record<ProofStrength, string> = {
  direct: 'Direct', corroborating: 'Corroborating', circumstantial: 'Circumstantial', gap: 'Gap',
};
const RANK: Record<ProofStrength, number> = { direct: 3, corroborating: 2, circumstantial: 1, gap: 0 };

/** The strongest strength among `items`; `gap` when there are none. */
export function strongestOf(items: ProofItem[]): ProofStrength {
  return items.reduce<ProofStrength>((best, p) => (RANK[p.strength] > RANK[best] ? p.strength : best), 'gap');
}

/** One matrix cell: the proof items from one document for one element, and the strongest. */
export interface MatrixCell {
  /** Every proof item from this document for this element, strongest first. */
  items: ProofItem[];
  strongest: ProofStrength;
  /** The cite of the strongest item: where the cell links. */
  cite: Cite;
}

/** One matrix row: a claim element, its strongest proof and its cell for each document. */
export interface MatrixRow { claim: MatterClaim; element: ClaimElement; strongest: ProofStrength; cells: Array<MatrixCell | null> }
/** The claims matrix: its document columns and its rows grouped by claim. */
export interface Matrix { docs: string[]; groups: Array<{ claim: MatterClaim; rows: MatrixRow[] }> }

/**
 * Columns are the cited documents, most-used first (ties keep first appearance), unless `order` sorts them;
 * counts keep their pleaded order.
 */
export function buildMatrix(claims: MatterClaim[], order?: (a: string, b: string) => number): Matrix {
  const uses = new Map<string, number>();
  const sorted = [...claims].sort((a, b) => a.count - b.count);
  for (const c of sorted) {
    for (const el of c.elements) for (const doc of new Set(el.proof.map((p) => p.cite.doc))) uses.set(doc, (uses.get(doc) ?? 0) + 1);
  }
  const first = [...uses.keys()];
  const docs = order ? [...first].sort(order) : [...first].sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0) || first.indexOf(a) - first.indexOf(b));
  const groups = sorted.map((claim) => ({
    claim,
    rows: claim.elements.map((element) => ({
      claim, element, strongest: strongestOf(element.proof),
      cells: docs.map((doc) => {
        const items = element.proof.filter((p) => p.cite.doc === doc).sort((a, b) => RANK[b.strength] - RANK[a.strength]);
        return items.length ? { items, strongest: items[0].strength, cite: items[0].cite } : null;
      }),
    })),
  }));
  return { docs, groups };
}

/** Grid movement among focusable cells by (row, col): Left/Right in the row, Up/Down to the nearest column. */
export function nextCell(cells: Array<{ row: number; col: number }>, from: number, key: string): number {
  const here = cells[from];
  if (!here) return -1;
  const sameRow = cells.map((c, i) => ({ c, i })).filter(({ c }) => c.row === here.row);
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    const step = key === 'ArrowRight' ? 1 : -1;
    const pick = sameRow.filter(({ c }) => (c.col - here.col) * step > 0).sort((a, b) => (a.c.col - b.c.col) * step)[0];
    return pick ? pick.i : -1;
  }
  const dir = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
  if (!dir) return -1;
  const rows = [...new Set(cells.map((c) => c.row))].filter((r) => (r - here.row) * dir > 0).sort((a, b) => (a - b) * dir);
  for (const r of rows) {
    const pick = cells.map((c, i) => ({ c, i })).filter(({ c }) => c.row === r)
      .sort((a, b) => Math.abs(a.c.col - here.col) - Math.abs(b.c.col - here.col) || a.c.col - b.c.col)[0];
    if (pick) return pick.i;
  }
  return -1;
}

export { ringSvg };

