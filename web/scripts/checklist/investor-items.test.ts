// SPDX-License-Identifier: Apache-2.0
// The investor half of the list: the business set investors ask for before a term sheet (research/investors.md SEED-2 to
// SEED-6, gaps G-1 to G-3 in quality-speed/pages/data-room/), next to the legal documents of every financing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseBaseline } from './baseline.ts';

const { items, folders } = parseBaseline(readFileSync(fileURLToPath(new URL('../../../docs/checklist/baseline.toml', import.meta.url)), 'utf8'));
const BUSINESS = ['financing.pitch-deck', 'financing.company-summary', 'financing.financial-model', 'financing.use-of-funds', 'financing.metrics'];

test('the room opens with 10 numbered investor folders', () => {
  assert.deepEqual(folders.map((folder) => folder.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('investors see 23 financing items, each with a reason and a public source', () => {
  const financing = items.filter((item) => item.category === 'financing' && item.room_roles.includes('investors'));
  assert.equal(financing.length, 23);
  for (const item of financing) {
    assert.ok(item.why.length > 20, item.id);
    assert.ok(item.sources.length > 0 && item.sources.every(({ url }) => url.startsWith('https://')), item.id);
  }
});

test('the business set sits first in the raise folder, ahead of the legal documents', () => {
  const raise = folders.find((folder) => folder.number === 4);
  assert.deepEqual(raise?.items.slice(0, BUSINESS.length), BUSINESS);
  for (const id of BUSINESS) {
    const item = items.find((each) => each.id === id);
    assert.ok(item?.applies_when, `${id} applies only when the company raises`);
    assert.deepEqual(item?.provided_by, ['founder'], id);
  }
});
