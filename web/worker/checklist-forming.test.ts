// SPDX-License-Identifier: Apache-2.0
// The forming items the research found missing (docs/checklist/baseline.toml): each is on the list with a public source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASELINE } from './checklist-baseline.ts';

const byId = new Map(BASELINE.items.map((item) => [item.id, item]));
const item = (id: string) => {
  const found = byId.get(id);
  assert.ok(found, id);
  assert.ok(found.sources.length > 0, `${id} keeps a public source`);
  return found;
};

test('the new forming items, each with its deadline or consequence', () => {
  assert.match(item('formation.responsible-party-change').deadline ?? '', /60 days/);
  assert.match(item('intellectual-property.patent-assignment-recording').deadline ?? '', /3 months/);
  assert.match(item('formation.tax-classification-election').deadline ?? '', /75 days[^.]*12 months/);
  assert.match(item('formation.foreign-qualification').why, /\$5,000/);
  assert.match(item('intellectual-property.colorado-trade-name').note ?? '', /\$500/);
  // State tax registration: these two items, each closed by marking it not applicable once checked.
  for (const id of ['compliance-and-governance.colorado-sales-tax-license', 'people.withholding-setup']) item(id);
});

test('the incorporator and the first board sign apart', () => {
  const incorporator = item('formation.incorporator-action');
  const board = item('formation.organizational-consent');
  assert.deepEqual(incorporator.entity_types, ['delaware-c-corporation', 'colorado-corporation'], 'an LLC has no incorporator');
  assert.deepEqual(incorporator.templates?.map((t) => t.path), ['founders/incorporator-action.md']);
  assert.deepEqual(board.templates?.map((t) => t.path), ['founders/initial-board-consent.md', 'founders/llc-initial-consent.md']);
});

test('stock power, escrow and indemnification agreements are named in the evidence', () => {
  assert.match(item('founders.stock-purchase-agreement').evidence, /stock power[^.]*escrow/);
  assert.match(item('founders.indemnification').evidence, /director and officer/);
});
