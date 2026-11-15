// SPDX-License-Identifier: Apache-2.0
// Card P4 (Claims & Proof): the page model, run against the fictional Doe v. Harbor Labs fixture matter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ServedMatter } from './matter-api.ts';
import {
  authoritiesOf, authorityPlacement, buildClaimsModel, byStrength, columnOrder, elementLabel, partiesAgainst, roman,
  strengthsOf,
} from './claims-model.ts';

/** The fixture as served: each document numbered in the order it is first listed. */
function servedFixture(): ServedMatter {
  const raw = JSON.parse(readFileSync(new URL('../../fixtures/matter.example.json', import.meta.url), 'utf8'));
  const ids = Object.keys(raw.docs);
  const control = (doc: string) => ids.indexOf(doc) + 101;
  const serve = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(serve);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = serve(v);
      if (typeof out.doc === 'string' && 'page' in out) out.control = control(out.doc);
      return out;
    }
    return value;
  };
  const matter = serve(raw) as ServedMatter;
  for (const id of ids) matter.docs[id].control = control(id);
  return matter;
}

test('roman numbers counts as pleaded and leaves odd values as digits', () => {
  assert.deepEqual([1, 3, 4, 9, 14, 40, 2024].map(roman), ['I', 'III', 'IV', 'IX', 'XIV', 'XL', 'MMXXIV']);
  for (const odd of [0, -2, 1.5, 4000]) assert.equal(roman(odd), String(odd));
  assert.equal(elementLabel({ count: 3 }, 0), 'III.1');
});

test('counts keep their pleaded order and every element is counted', () => {
  const matter = servedFixture();
  matter.claims.reverse();
  const model = buildClaimsModel(matter);
  assert.deepEqual(model.claims.map((c) => c.count), [1, 2, 3, 4, 5]);
  assert.equal(model.elementCount, 15);
  assert.equal(model.matrix.groups.length, 5);
});

test('columns are the proving documents in control-number order, never a gap-only document', () => {
  const matter = servedFixture();
  const model = buildClaimsModel(matter);
  const controls = model.columns.map((c) => c.control);
  assert.deepEqual(controls, [...controls].sort((a, b) => (a ?? 0) - (b ?? 0)));
  const gapOnly = new Set<string>();
  const proving = new Set<string>();
  for (const c of matter.claims) for (const el of c.elements) for (const p of el.proof) (p.strength === 'gap' ? gapOnly : proving).add(p.cite.doc);
  for (const doc of gapOnly) if (!proving.has(doc)) assert.ok(!model.matrix.docs.includes(doc), 'gap-only doc has no column');
  for (const doc of proving) assert.ok(model.matrix.docs.includes(doc));
  assert.equal(model.columns[0].type !== undefined, true);
});

test('unnumbered documents sort after numbered ones, by id', () => {
  const order = columnOrder({
    claims: [{ elements: [{ proof: [
      { cite: { doc: 'b', page: 1, control: null } }, { cite: { doc: 'a', page: 1, control: null } },
      { cite: { doc: 'z', page: 1, control: 7 } },
    ] }] }] as unknown as ServedMatter['claims'],
    docs: {},
  });
  assert.deepEqual(['b', 'a', 'z'].sort(order), ['z', 'a', 'b']);
});

test('gaps and circumstantial-only elements are found by their strongest proof', () => {
  const model = buildClaimsModel(servedFixture());
  assert.deepEqual(model.gaps.map((g) => g.label), ['I.3', 'II.4']);
  assert.deepEqual(model.circumstantialOnly.map((g) => g.label), ['III.3', 'IV.2', 'V.2']);
  const row = model.matrix.groups[0].rows[2];
  assert.equal(row.strongest, 'gap');
  assert.ok(row.cells.every((cell) => cell === null), 'a gap row has no rings');
});

test('byStrength leads with the strongest proof', () => {
  const items = [
    { strength: 'circumstantial' }, { strength: 'direct' }, { strength: 'gap' }, { strength: 'corroborating' },
  ] as unknown as Parameters<typeof byStrength>[0];
  assert.deepEqual(byStrength(items).map((p) => p.strength), ['direct', 'corroborating', 'circumstantial', 'gap']);
});

test('authority sits on the count row only when one authority covers every element', () => {
  const matter = servedFixture();
  const [c1, c2] = matter.claims;
  assert.deepEqual(authoritiesOf(c1), ['Example Rev. Stat. 7-108-401']);
  assert.equal(authorityPlacement(c1), 'count');
  assert.equal(authoritiesOf(c2).length, 2);
  assert.equal(authorityPlacement(c2), 'element');
});

test('parties against a count carry their names and sides; an unknown id stays visible', () => {
  const matter = servedFixture();
  assert.deepEqual(partiesAgainst(matter.claims[0], matter).map((p) => [p.name, p.side]), [
    ['Mark Moe', 'defendant'], ['Alder Peak Ventures, L.P.', 'defendant'],
  ]);
  assert.deepEqual(partiesAgainst({ against: ['p-nobody'] }, matter), [{ id: 'p-nobody', name: 'p-nobody', side: null }]);
});

test('strengthsOf gives one mark per element, in order', () => {
  assert.deepEqual(strengthsOf(servedFixture().claims[2]), ['direct', 'direct', 'circumstantial']);
});
