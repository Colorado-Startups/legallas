// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MatterClaim, ProofItem } from '../../../worker/matter-types.ts';
import { buildMatrix, nextCell, strongestOf } from './matrix.ts';

const proof = (doc: string, page: number, strength: ProofItem['strength']): ProofItem => ({ cite: { doc, page }, strength, note: null });
const claims: MatterClaim[] = [
  {
    id: 'count-2', count: 2, type: 'unjustEnrichment', label: 'Unjust enrichment', against: ['p-roe'], cites: [],
    elements: [
      { id: 'c2-e1', text: 'A benefit was conferred', authority: 'Restatement (Second) of Contracts § 90', proof: [proof('d-agree', 4, 'direct')] },
      { id: 'c2-e2', text: 'The benefit was kept unpaid', authority: '', proof: [] },
    ],
  },
  {
    id: 'count-1', count: 1, type: 'breachContract', label: 'Breach of contract', against: ['o-harbor-labs'], cites: [],
    elements: [
      { id: 'c1-e1', text: 'A supply agreement existed', authority: '', proof: [proof('d-agree', 1, 'direct'), proof('d-email', 2, 'corroborating')] },
      { id: 'c1-e2', text: 'Defendant did not pay', authority: '', proof: [proof('d-email', 5, 'circumstantial'), proof('d-email', 7, 'corroborating'), proof('d-memo', 1, 'gap')] },
    ],
  },
];

test('the strongest proof wins, and no proof is a gap', () => {
  assert.equal(strongestOf([]), 'gap');
  assert.equal(strongestOf([proof('a', 1, 'circumstantial'), proof('a', 2, 'direct')]), 'direct');
  assert.equal(strongestOf([proof('a', 1, 'gap')]), 'gap');
});

test('counts run in pleaded order; documents most used first; each cell links its strongest page', () => {
  const m = buildMatrix(claims);
  assert.deepEqual(m.groups.map((g) => g.claim.count), [1, 2]);
  assert.deepEqual(m.docs, ['d-agree', 'd-email', 'd-memo']);
  const breach = m.groups[0].rows[1];
  assert.equal(breach.strongest, 'corroborating');
  assert.equal(breach.cells[0], null, 'no proof from that document');
  assert.deepEqual(breach.cells[1]?.cite, { doc: 'd-email', page: 7 }, 'the cell cites the corroborating page, not the weaker one');
  assert.equal(breach.cells[1]?.items.length, 2);
  assert.equal(breach.cells[2]?.strongest, 'gap');
  assert.equal(m.groups[1].rows[1].strongest, 'gap', 'an element with nothing behind it reads as a gap');
});

test('a caller order sorts the document columns', () => {
  const m = buildMatrix(claims, (a, b) => a.localeCompare(b));
  assert.deepEqual(m.docs, ['d-agree', 'd-email', 'd-memo']);
});

test('grid arrows move within a row and to the nearest column in the next row that has a cell', () => {
  const cells = [{ row: 0, col: 0 }, { row: 0, col: 3 }, { row: 2, col: 2 }, { row: 3, col: 0 }];
  assert.equal(nextCell(cells, 0, 'ArrowRight'), 1);
  assert.equal(nextCell(cells, 1, 'ArrowRight'), -1);
  assert.equal(nextCell(cells, 1, 'ArrowLeft'), 0);
  assert.equal(nextCell(cells, 1, 'ArrowDown'), 2, 'skips the empty row');
  assert.equal(nextCell(cells, 2, 'ArrowDown'), 3);
  assert.equal(nextCell(cells, 3, 'ArrowUp'), 2);
  assert.equal(nextCell(cells, 0, 'ArrowUp'), -1);
});
