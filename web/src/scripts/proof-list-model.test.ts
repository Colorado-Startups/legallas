// SPDX-License-Identifier: Apache-2.0
// The proof checklist's pure helpers (proof-list-model.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAP_TEXT, PROOF_WORDS, proofRows, proofTally } from './proof-list-model.ts';

const cite = (doc: string, page: number | null) => ({ doc, page, control: 7 });

test('proofRows puts the strongest cite first, drops repeats and keeps gaps uncited', () => {
  const rows = proofRows([
    {
      id: 'pt-1', text: 'Harbor Labs signed the supply agreement.', authority: 'Example Rev. Stat. 5-1-501',
      proof: [
        { cite: cite('a', 1), strength: 'circumstantial', note: null },
        { cite: cite('b', 2), strength: 'direct', note: 'The agreement' },
        { cite: cite('a', 1), strength: 'corroborating', note: null },
        { cite: cite('c', null), strength: 'corroborating', note: null },
      ],
    },
    { id: 'pt-2', text: 'Harbor Labs cancelled the supply agreement.', authority: null, proof: [{ cite: cite('d', 4), strength: 'gap', note: null }] },
    { id: 'pt-3', text: 'Nothing yet.', authority: null, proof: [] },
  ]);
  assert.equal(rows[0].strength, 'direct');
  assert.equal(rows[0].gap, false);
  assert.deepEqual(rows[0].cites.map((c) => [c.cite.doc, c.strength]), [['b', 'direct'], ['a', 'corroborating'], ['c', 'corroborating']]);
  assert.equal(rows[0].cites[0].note, 'The agreement');
  assert.equal(rows[0].authority, 'Example Rev. Stat. 5-1-501');
  assert.deepEqual([rows[1].gap, rows[1].strength, rows[1].cites], [true, 'gap', []], 'a gap shows no proof chips');
  assert.equal(rows[2].gap, true);
  assert.equal(PROOF_WORDS.gap, GAP_TEXT);
  assert.equal(GAP_TEXT, 'Not yet in the record');
});

test('proofTally counts points and gaps', () => {
  assert.equal(proofTally([]), '0 points');
  assert.equal(proofTally([{ gap: false }]), '1 point');
  assert.equal(proofTally([{ gap: true }, { gap: false }, { gap: true }]), '3 points, 2 gaps');
  assert.equal(proofTally([{ gap: true }]), '1 point, 1 gap');
});
