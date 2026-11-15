// SPDX-License-Identifier: Apache-2.0
// Card P4 (Claims & Proof). The pure model behind the page: counts in their pleaded order, the documents that
// carry proof (columns, by control number), each element's strongest proof, the gaps, the elements that rest on
// circumstantial proof alone, and who each count is pleaded against. No DOM here (claims-model.test.ts).

import type { ProofStrength, RoomClaim, ServedMatter, Side } from './matter-api.ts';
import { buildMatrix, strongestOf, type Matrix } from './viz/matrix.ts';

export type { RoomClaim };
/** One element of a claim. */
export type RoomElement = RoomClaim['elements'][number];
/** One piece of proof for a claim element. */
export type RoomProof = RoomElement['proof'][number];

const ROMAN: ReadonlyArray<[number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** Counts are numbered as pleaded: 3 is "III". Anything that is not a positive integer stays as digits. */
export function roman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
  let left = n;
  let out = '';
  for (const [value, numeral] of ROMAN) {
    while (left >= value) {
      out += numeral;
      left -= value;
    }
  }
  return out;
}

/** "III.1": the count numeral and the element's 1-based place in that count. */
export function elementLabel(claim: Pick<RoomClaim, 'count'>, index: number): string {
  return `${roman(claim.count)}.${index + 1}`;
}

/** Strongest first, so a cell, a card and a list all lead with the best proof. */
const RANK: Record<ProofStrength, number> = { direct: 3, corroborating: 2, circumstantial: 1, gap: 0 };

/** Returns a copy of the proofs sorted strongest first. */
export function byStrength(items: readonly RoomProof[]): RoomProof[] {
  return [...items].sort((a, b) => RANK[b.strength] - RANK[a.strength]);
}

export { strongestOf };

/** One document column of the claims matrix. */
export interface DocColumn {
  id: string;
  control: number | null;
  /** The document's type from the matter ("Operating agreement"), or null. */
  type: string | null;
}

/** Columns read in control-number order; unnumbered documents follow, by id, so the order never shifts. */
export function columnOrder(matter: Pick<ServedMatter, 'claims' | 'docs'>): (a: string, b: string) => number {
  const control = new Map<string, number | null>();
  for (const claim of matter.claims) {
    for (const el of claim.elements) for (const p of el.proof) control.set(p.cite.doc, p.cite.control);
  }
  for (const [id, facts] of Object.entries(matter.docs)) if (!control.get(id)) control.set(id, facts.control);
  return (a, b) => {
    const ca = control.get(a) ?? null;
    const cb = control.get(b) ?? null;
    if (ca !== null && cb !== null) return ca - cb;
    if (ca !== null) return -1;
    if (cb !== null) return 1;
    return a.localeCompare(b);
  };
}

/** The claims view model: the claims, their matrix and the document columns. */
export interface ClaimsModel {
  claims: RoomClaim[];
  matrix: Matrix;
  columns: DocColumn[];
  elementCount: number;
  gaps: ElementRef[];
  circumstantialOnly: ElementRef[];
}

/** A claim element together with its claim and its display number. */
export interface ElementRef {
  claim: RoomClaim;
  element: RoomElement;
  /** "III.4" */
  label: string;
  strongest: ProofStrength;
}

/** The whole page model. Counts keep their pleaded order; elements keep the pleading's order. */
export function buildClaimsModel(matter: Pick<ServedMatter, 'claims' | 'docs'>): ClaimsModel {
  const claims = [...matter.claims].sort((a, b) => a.count - b.count);
  const order = columnOrder(matter);
  const proving = { ...matter, claims: claims.map((c) => ({ ...c, elements: c.elements.map(provingOnly) })) };
  const matrix = buildMatrix(proving.claims, order);
  const controlOf = new Map<string, number | null>();
  for (const c of claims) for (const el of c.elements) for (const p of el.proof) controlOf.set(p.cite.doc, p.cite.control);
  const columns = matrix.docs.map((id) => ({
    id, control: controlOf.get(id) ?? matter.docs[id]?.control ?? null, type: matter.docs[id]?.type ?? null,
  }));
  const refs = claims.flatMap((claim) => claim.elements.map((element, i) => ({
    claim, element, label: elementLabel(claim, i), strongest: strongestOf(element.proof),
  })));
  return {
    claims, matrix, columns, elementCount: refs.length,
    gaps: refs.filter((r) => r.strongest === 'gap'),
    circumstantialOnly: refs.filter((r) => r.strongest === 'circumstantial'),
  };
}

/**
 * The grid shows documents that prove something. A `gap` item names the nearest document but proves nothing, so
 * it lives in the gap list and the By count card, not as a column of dashed rings.
 */
function provingOnly(element: RoomElement): RoomElement {
  return { ...element, proof: element.proof.filter((p) => p.strength !== 'gap') };
}

/** Authorities as written, first use first, without repeats. */
export function authoritiesOf(claim: Pick<RoomClaim, 'elements'>): string[] {
  return [...new Set(claim.elements.map((el) => el.authority.trim()).filter(Boolean))];
}

/** When every element rests on one authority the count row carries it; otherwise each element shows its own. */
export function authorityPlacement(claim: Pick<RoomClaim, 'elements'>): 'count' | 'element' {
  return authoritiesOf(claim).length <= 1 ? 'count' : 'element';
}

/** A person or org in the claims view, with its side. */
export interface Party {
  id: string;
  name: string;
  side: Side | null;
}

/** The parties a count is pleaded against, named from the matter's people and organizations. */
export function partiesAgainst(claim: Pick<RoomClaim, 'against'>, matter: Pick<ServedMatter, 'people' | 'orgs'>): Party[] {
  const known = new Map<string, Party>();
  for (const p of matter.people) known.set(p.id, { id: p.id, name: p.name, side: p.side });
  for (const o of matter.orgs) known.set(o.id, { id: o.id, name: o.name, side: o.side });
  return claim.against.map((id) => known.get(id) ?? { id, name: id, side: null });
}

/** Each element's strongest proof in order: the marks a collapsed count shows on the By count view. */
export function strengthsOf(claim: Pick<RoomClaim, 'elements'>): ProofStrength[] {
  return claim.elements.map((el) => strongestOf(el.proof));
}
