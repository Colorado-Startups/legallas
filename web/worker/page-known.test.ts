// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageIsKnown } from './page-known.ts';

test('only paged formats cite a page: office, text, CSV and email files cite the document (#142, #225)', () => {
  const known = ['Doe v. Harbor Labs.pdf', 'scan.PNG', 'routes.html', 'deck.key', 'ledger.numbers'];
  const block = ['Harbor Labs Side Letter.docx', 'old.doc', 'memo.rtf', 'memo.odt', 'board.pptx', 'cap table.xlsx', 'plan.pages', 'notes.md', 'log.txt', 'rows.csv', 'thread.eml'];
  assert.deepEqual(known.filter((name) => !pageIsKnown(name)), []);
  assert.deepEqual(block.filter(pageIsKnown), []);
});
