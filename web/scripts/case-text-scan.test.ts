// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkRead, draftTexts, editedNodes, flatten, matches, revisions, type Item } from './case-text-scan.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'case-text-test-'));
const patterns = path.join(dir, 'patterns.txt');
writeFileSync(patterns, 'plantedword\nother[0-9]+\n');
const list = <T>(nodes: T[], totalCount = nodes.length) => ({ totalCount, nodes });

const item: Item = {
  id: 'I7', number: 7, title: 'a PlantedWord title', body: 'clean now', lastEditedAt: '2026-11-02T05:00:14Z',
  comments: list([{ id: 'C1', body: 'other42 here' }, { id: 'C2', body: 'fine' }]),
  reviews: list([{ id: 'R1', body: '' }]),
};

test('every title, body, comment, review and edit revision is read, and only labels come back', () => {
  const { texts, edited } = flatten(item);
  assert.deepEqual([...edited], [['I7', '#7']]);
  const all = [...texts, ...revisions([{ id: 'I7', userContentEdits: list([{ diff: 'an old PlantedWord revision' }]) }], edited)];
  assert.equal(all.length, 6);
  assert.deepEqual(matches(all, patterns).sort(), ['#7 comment C1', '#7 revision 1', '#7 title']);
});

test('a list or history GitHub cut short, an empty input or empty patterns fail instead of reading clean', () => {
  assert.throws(() => flatten({ ...item, comments: list([], 3) }), /comments has 3, read 0/);
  assert.throws(() => revisions([{ id: 'I7', userContentEdits: list([], 25) }], new Map()), /cut short/);
  assert.throws(() => matches([], patterns), /nothing was read/);
  const empty = path.join(dir, 'empty.txt');
  writeFileSync(empty, '\n');
  assert.throws(() => matches([{ label: 'x', body: 'y' }], empty), /empty/);
});

test('a draft must hold text, the repo read must find both kinds, and every edit history must come back', () => {
  const blank = path.join(dir, 'blank.md');
  writeFileSync(blank, '  \n');
  assert.throws(() => draftTexts([blank]), /blank\.md is empty/);
  assert.throws(() => draftTexts([]), /nothing was read/);
  const draft = path.join(dir, 'draft.md');
  writeFileSync(draft, 'A fix.');
  assert.deepEqual(draftTexts([draft]), [{ label: draft, body: 'A fix.' }]);
  assert.throws(() => checkRead({ issues: 0, pullRequests: 9 }), /nothing was read: issues/);
  assert.doesNotThrow(() => checkRead({ issues: 3, pullRequests: 9 }));
  const node = { id: 'I7', userContentEdits: list([{ diff: 'x' }]) };
  assert.throws(() => editedNodes([node, null], ['I7', 'C9']), /read 1 of 2/);
  assert.throws(() => editedNodes([node], ['I7', 'C9']), /read 1 of 2/);
  assert.deepEqual(editedNodes([node], ['I7']), [node]);
});
