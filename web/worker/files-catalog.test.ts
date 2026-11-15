// SPDX-License-Identifier: Apache-2.0
// The folder tree behind /api/documents and the viewer choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, isHiddenName, toListed, viewerFor, type CatalogRow, type FolderNode } from './files-catalog.ts';

function row(path: string, extra: Partial<CatalogRow> & Record<string, unknown> = {}): CatalogRow {
  const slash = path.lastIndexOf('/');
  return {
    id: `id-${path}`,
    path,
    folder: slash === -1 ? '' : path.slice(0, slash),
    name: path.slice(slash + 1),
    kind: 'pdf',
    size: 10,
    pages: 2,
    updated_at: '2026-10-01T00:00:00.000Z',
    source: 'mirror',
    ...extra,
  };
}

function find(node: FolderNode, path: string): FolderNode | undefined {
  if (node.path === path) return node;
  for (const child of node.folders) {
    const hit = find(child, path);
    if (hit) return hit;
  }
  return undefined;
}

test('folders nest, intermediate folders appear, and order is natural', () => {
  const root = buildTree([
    row('10-Later/a.pdf'),
    row('02-Second/deep/inner/x.pdf'),
    row('01-First/file 10.pdf'),
    row('01-First/file 2.pdf'),
    row('top.pdf'),
  ]);
  assert.deepEqual(root.folders.map((f) => f.name), ['01-First', '02-Second', '10-Later']);
  assert.deepEqual(find(root, '01-First')!.files.map((f) => f.name), ['file 2.pdf', 'file 10.pdf']);
  assert.deepEqual(find(root, '02-Second')!.files, []);
  assert.equal(find(root, '02-Second/deep/inner')!.files[0]!.name, 'x.pdf');
  assert.deepEqual(root.files.map((f) => f.name), ['top.pdf']);
});

test('counts and sizes roll up the tree', () => {
  const root = buildTree([row('a/one.pdf', { size: 5 }), row('a/b/two.pdf', { size: 7 }), row('c/three.pdf', { size: 1 })]);
  assert.equal(root.count, 3);
  assert.equal(root.size, 13);
  assert.equal(find(root, 'a')!.count, 2);
  assert.equal(find(root, 'a')!.size, 12);
});

test("each folder's CLAUDE.md is its guide, not a file", () => {
  const root = buildTree([row('a/CLAUDE.md', { kind: 'markdown', pages: null }), row('a/doc.pdf')]);
  const a = find(root, 'a')!;
  assert.equal(a.guide?.name, 'CLAUDE.md');
  assert.deepEqual(a.files.map((f) => f.name), ['doc.pdf']);
  assert.equal(a.count, 2);
});

test('a counsel upload named CLAUDE.md stays a file', () => {
  const root = buildTree([row('from-counsel/u1/CLAUDE.md', { source: 'counsel', kind: 'markdown' })]);
  const inbox = find(root, 'from-counsel')!;
  assert.equal(inbox.guide, null);
  assert.equal(inbox.files.length, 1);
});

test('counsel uploads are listed together in from-counsel, not one folder per upload', () => {
  const root = buildTree([
    row('from-counsel/u1/memo.pdf', { source: 'counsel' }),
    row('from-counsel/u2/notes.txt', { source: 'counsel', kind: 'text' }),
  ]);
  const inbox = find(root, 'from-counsel')!;
  assert.deepEqual(inbox.files.map((f) => f.name), ['memo.pdf', 'notes.txt']);
  assert.deepEqual(inbox.folders, []);
});

test('the listing never carries storage details or removed rows', () => {
  const root = buildTree([
    row('a/live.pdf', { r2_key: 'secret-key', sha256: 'abc', etag: 'e', uploaded_by: 'x@example.test' }),
    row('a/gone.pdf', { removed_at: '2026-09-30T00:00:00.000Z' }),
  ]);
  const json = JSON.stringify(root);
  assert.doesNotMatch(json, /r2_key|secret-key|sha256|etag|uploaded_by|removed/);
  assert.deepEqual(find(root, 'a')!.files.map((f) => f.name), ['live.pdf']);
  assert.deepEqual(Object.keys(find(root, 'a')!.files[0]!).sort(), ['control_seq', 'id', 'key_at', 'key_by', 'kind', 'name', 'pages', 'size', 'source', 'updated_at']);
});

test('an empty room is an empty root', () => {
  assert.deepEqual(buildTree([]), { path: '', name: '', guide: null, files: [], folders: [], count: 0, size: 0 });
});

test('viewers: known kinds view inline; only mirrored HTML runs; the rest download', () => {
  for (const kind of ['pdf', 'image', 'markdown', 'csv', 'text'] as const) assert.equal(viewerFor(kind, 'counsel'), kind);
  assert.equal(viewerFor('visual', 'mirror'), 'visual');
  assert.equal(viewerFor('visual', 'counsel'), 'download');
  assert.equal(viewerFor('file', 'mirror'), 'download');
  assert.equal(viewerFor('constructor', 'mirror'), 'download');
});

test('control_seq and Key pass through; rows read before migration 0003 give nulls', () => {
  const keyed = toListed(row('a/x.pdf', { control_seq: 12, key_at: '2026-10-01T00:00:00.000Z', key_by: 'ada@firm.example' }));
  assert.deepEqual([keyed.control_seq, keyed.key_at, keyed.key_by], [12, '2026-10-01T00:00:00.000Z', 'ada@firm.example']);
  const old = toListed(row('a/y.pdf'));
  assert.deepEqual([old.control_seq, old.key_at, old.key_by], [null, null, null]);
});

test('room data files (legallas-*.json) are never listed, wherever they sit', () => {
  const root = buildTree([row('Visuals/legallas-visuals.json', { kind: 'file' }), row('a/legallas-matter.json', { kind: 'file' }), row('a/keep.pdf')]);
  assert.deepEqual(find(root, 'a')!.files.map((f) => f.name), ['keep.pdf']);
  assert.equal(find(root, 'Visuals'), undefined);
  assert.equal(root.count, 1);
  assert.deepEqual(['legallas-visuals.json', 'legallas-.json', 'Legallas-visuals.json', 'legallas-visuals.json.pdf', 'my-legallas-x.json', 'legallas.json'].map(isHiddenName), [
    true,
    true,
    false,
    false,
    false,
    false,
  ]);
});
