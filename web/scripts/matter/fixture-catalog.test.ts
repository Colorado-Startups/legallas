// SPDX-License-Identifier: Apache-2.0
// parseCatalog over the matter fixture's own catalog (fixtures/source), which the matter build tests share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CATALOG_REL, parseCatalog } from './catalog.ts';
import { SOURCE_ROOT } from './testkit.ts';

test('parseCatalog: the fixture catalog', async () => {
  const text = await readFile(path.join(SOURCE_ROOT, CATALOG_REL), 'utf8');
  const result = parseCatalog(text, SOURCE_ROOT);
  assert.equal(result.rows, 8);
  assert.equal(result.skipped, 1);
  assert.equal(result.docs.size, 7);
  const email = result.docs.get('04-Letters/Email_EML__20120507__Mark-Moe__Meeting-Plan.pdf');
  assert.deepEqual(email, {
    date: '2012-05-07', type: 'Email', from: [], to: [],
    summary: 'Meeting plan email; mentions an offer to buy back the shares,\nand a second line.', privileged: false,
  });
  const letter = result.docs.get('04-Letters/Letter_LTR.pdf');
  assert.equal(letter?.date, '2012-05-15');
  assert.equal(letter?.type, null);
  assert.equal(result.docs.get('07-Lawyer-Notes-PRIVILEGED/Memo_MEM__20120528__Lisa-Low__Removal-Summary.pdf')?.privileged, true);
  assert.equal(result.docs.get('10-Lawyer-Analysis/Claim_Chart__WP__20130312.xlsx')?.privileged, true);
});

test('parseCatalog: the fixture catalog carries no internal notes', async () => {
  const text = await readFile(path.join(SOURCE_ROOT, CATALOG_REL), 'utf8');
  assert.deepEqual(parseCatalog(text, SOURCE_ROOT).notes, []);
});
