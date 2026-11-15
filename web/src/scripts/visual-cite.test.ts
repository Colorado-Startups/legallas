// SPDX-License-Identifier: Apache-2.0
// Cites posted from a binder visual: only this room's control numbers parse, and they resolve to ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FolderNode, ListedDocument } from './files-api.ts';
import { controlIndex, parseVisualCite } from './visual-cite.ts';

test('parseVisualCite reads a control number with or without a page', () => {
  assert.deepEqual(parseVisualCite('DOE-000412@3', 'DOE'), { seq: 412, page: 3 });
  assert.deepEqual(parseVisualCite('DOE-000412', 'DOE'), { seq: 412, page: null });
  assert.deepEqual(parseVisualCite(' DOE-000001@21 ', 'DOE'), { seq: 1, page: 21 });
});

test('parseVisualCite refuses another prefix, zeroes and anything that is not a cite', () => {
  assert.equal(parseVisualCite('ABC-000412@3', 'DOE'), null);
  assert.equal(parseVisualCite('DOE-000000@3', 'DOE'), null);
  assert.equal(parseVisualCite('DOE-000412@0', 'DOE'), null);
  assert.equal(parseVisualCite('DOE-412@3', 'DOE'), null);
  assert.equal(parseVisualCite('DOE-000412@3#x', 'DOE'), null);
  assert.equal(parseVisualCite('javascript:alert(1)', 'DOE'), null);
  assert.equal(parseVisualCite(412, 'DOE'), null);
  assert.equal(parseVisualCite(`DOE-000412@${'9'.repeat(40)}`, 'DOE'), null);
});

function doc(id: string, seq: number | null): ListedDocument {
  return { id, name: `${id}.pdf`, kind: 'pdf', size: 1, pages: 1, updated_at: '2026-10-04', source: 'mirror', control_seq: seq };
}

function folder(path: string, files: ListedDocument[], folders: FolderNode[] = [], guide: ListedDocument | null = null): FolderNode {
  return { path, name: path, guide, files, folders, count: files.length, size: files.length };
}

test('controlIndex maps every numbered document, guides and nested folders included', () => {
  const tree = folder('', [doc('a', 1)], [folder('05', [doc('b', 2), doc('unnumbered', null)], [folder('05/x', [doc('c', 9)])], doc('guide', 3))]);
  const index = controlIndex(tree);
  assert.deepEqual([...index.entries()].sort((x, y) => x[0] - y[0]), [[1, 'a'], [2, 'b'], [3, 'guide'], [9, 'c']]);
});
