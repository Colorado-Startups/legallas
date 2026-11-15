// SPDX-License-Identifier: Apache-2.0
// Pinpoint quotes from tables: a markdown row is scored on its cells and quoted by one cell; a PDF table laid out
// line by line (no sentence ends) gives runs of its lines. Fictional fixture text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinpointQuote, tableCells } from './citations.ts';
import { pageSegments } from './passages.ts';

test('a markdown table row is read as cells; separator rows and prose are not rows', () => {
  assert.deepEqual(tableCells('| East Gutter, Copper | Main roof | 61 feet |'), ['East Gutter, Copper', 'Main roof', '61 feet']);
  assert.equal(tableCells('|---|:---:|---|'), null);
  assert.equal(tableCells('Moe patched it | twice'), null);
  assert.equal(tableCells('A plain sentence with no pipes.'), null);
});

test('a claim drawn from a table row is quoted by the cell that carries it, pipes left out', () => {
  const page = [
    'Repair items still open at the site on May 14, 2012.',
    '',
    '| Item | Area | Length |',
    '|---|---|---|',
    '| East Gutter, Copper | Main roof | 61 feet |',
    '| North Drain Pipe | Rear wall | 37 feet |',
  ].join('\n');
  const segments = pageSegments([{ docId: 'd', text: `[[doc:d p:2]]\n${page}` }], 'd', 2);
  assert.equal(pinpointQuote(segments, 'The North Drain Pipe ran 37 feet along the rear wall'), 'North Drain Pipe');
  assert.equal(pinpointQuote(segments, 'East Gutter was on the main roof'), 'East Gutter, Copper', 'ties go to the first cell');
  assert.equal(pinpointQuote(segments, 'An unrelated claim about a menu reprint'), null);
});

test('a PDF table with no sentence ends gives runs of its lines, verbatim once whitespace is folded', () => {
  const header = ['Repair Schedule', 'Name of Item', 'Unit Quantity', 'Labor Cost', 'Date Done', 'Copper Flashing', '12 feet', '$1,240.50', 'May 9, 2012'];
  const table = [...header, ...Array.from({ length: 12 }, (_, i) => `Item ${i + 1}\n${i + 1} feet\n$${(i + 1) * 100}\nJune ${i + 1}, 2012`)].join('\n');
  const quote = pinpointQuote([table], 'Repair Schedule lists each item unit quantity and labor cost');
  assert.ok(quote !== null, 'a run of the header lines is a candidate');
  assert.ok(table.replace(/\s+/g, ' ').includes(quote!), 'the quote is a run of the page text');
  assert.match(quote!, /Unit Quantity Labor Cost/);
});
