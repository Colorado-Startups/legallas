// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whereItOpens } from './files-format.ts';

test('Apple\'s formats say where they open, because a Windows reader has no app for them; other files say nothing', () => {
  assert.equal(whereItOpens('Plan.pages'), 'Opens in Pages on a Mac, or at iCloud.com.');
  assert.equal(whereItOpens('Model.NUMBERS'), 'Opens in Numbers on a Mac, or at iCloud.com.');
  assert.equal(whereItOpens('Deck.key'), 'Opens in Keynote on a Mac, or at iCloud.com.');
  for (const name of ['Plan.docx', 'bundle.zip', 'notes', 'constructor', 'x.constructor']) assert.equal(whereItOpens(name), null, name);
});
