// SPDX-License-Identifier: Apache-2.0
// The room's one document type rule (doc-type.ts): fixture types only, never names from a matter.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { docTypeTitle } from './doc-titles.ts';
import { docTypeWords } from './doc-type.ts';

test('docTypeWords: a code joined by a hyphen or a space is part of the type', () => {
  assert.equal(docTypeWords('Invoice-INV'), 'Invoice INV');
  assert.equal(docTypeWords('Invoice INV'), 'Invoice INV');
  assert.equal(docTypeWords('Exhibit-B'), 'Exhibit B');
});

test('docTypeWords: a hyphen with a digit after it stays', () => {
  assert.equal(docTypeWords('W-9'), 'W-9');
  assert.equal(docTypeWords('W-2'), 'W-2');
  assert.equal(docTypeWords('Form-1099'), 'Form-1099');
});

test('docTypeWords: a code joined by "_" is the file Abbr and goes when it is only the file code', () => {
  assert.equal(docTypeWords('Operating_Agreement_OA'), 'Operating agreement');
  assert.equal(docTypeWords('Delivery_Schedule_XQZ'), 'Delivery schedule');
  assert.equal(docTypeWords('Order_MTD'), 'Order on the motion to dismiss', 'a code that carries meaning stays');
});

test('docTypeWords: filename Title Case reads as a sentence; written types and abbreviations', () => {
  assert.equal(docTypeWords('Operating-Agreement'), 'Operating agreement');
  assert.equal(docTypeWords('Repair-ticket'), 'Repair ticket');
  assert.equal(docTypeWords('Operating agreement'), 'Operating agreement');
  assert.equal(docTypeWords('Order Compel'), 'Order compelling discovery');
  assert.equal(docTypeWords('Claim Chart (work product)'), 'Claim chart (work product)');
  assert.equal(docTypeWords(''), '');
});

test('one rule: the file titles use the same function (the brief checks its own in brief/model.test.ts)', () => {
  assert.equal(docTypeTitle, docTypeWords);
});
