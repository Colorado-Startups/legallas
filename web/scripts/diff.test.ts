// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSync, kindOf, planIsEmpty, splitPath, type DocumentRow, type LocalFile } from './diff.ts';

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

const file = (rel: string, sha256: string, size = 10): LocalFile => ({ rel, sha256, size });

function row(id: string, path: string, sha256: string | null, extra: Partial<DocumentRow> = {}): DocumentRow {
  return { id, path, sha256, size: 10, kind: kindOf(path).kind, pages: null, r2_key: `key-${id}`, source: 'mirror', removed_at: null, ...extra };
}

test('kinds and content types by extension', () => {
  assert.deepEqual(kindOf('a/Brief.PDF'), { kind: 'pdf', contentType: 'application/pdf' });
  for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']) assert.equal(kindOf(`x.${ext}`).kind, 'image');
  assert.equal(kindOf('CLAUDE.md').kind, 'markdown');
  assert.equal(kindOf('t.csv').kind, 'csv');
  assert.equal(kindOf('chart.html').kind, 'visual');
  assert.equal(kindOf('chart.htm').kind, 'visual');
  for (const ext of ['txt', 'xml', 'jsx', 'json', 'eml']) assert.equal(kindOf(`x.${ext}`).kind, 'text');
  assert.deepEqual(kindOf('memo.docx'), { kind: 'file', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  assert.deepEqual(kindOf('archive.7z'), { kind: 'file', contentType: 'application/octet-stream' });
  assert.deepEqual(kindOf('.md'), { kind: 'file', contentType: 'application/octet-stream' });
  assert.deepEqual(splitPath('A/B/c.pdf'), { folder: 'A/B', name: 'c.pdf' });
  assert.deepEqual(splitPath('c.pdf'), { folder: '', name: 'c.pdf' });
});

test('adds get random ids and opaque r2 keys, never derived from the filename', () => {
  const plan = diffSync([file('Folder/Secret Name.pdf', 'aa')], []);
  const [add] = plan.adds;
  assert.match(add.id, /^[0-9a-f-]{36}$/);
  assert.match(add.r2Key, /^[0-9a-f-]{36}$/);
  assert.notEqual(add.id, add.r2Key);
  assert.ok(!add.r2Key.includes('Secret'));
  assert.deepEqual([add.folder, add.name, add.kind], ['Folder', 'Secret Name.pdf', 'pdf']);
});

test('adds, changes, removals and unchanged are classified by path and hash', () => {
  const rows = [row('1', 'same.pdf', 's1'), row('2', 'edited.md', 'old'), row('3', 'gone.txt', 'g1')];
  const plan = diffSync([file('same.pdf', 's1'), file('edited.md', 'new'), file('fresh.csv', 'f1')], rows, ids());
  assert.deepEqual(plan.unchanged.map((doc) => doc.id), ['1']);
  assert.equal(plan.changes.length, 1);
  assert.deepEqual([plan.changes[0].id, plan.changes[0].oldR2Key, plan.changes[0].sha256], ['2', 'key-2', 'new']);
  assert.equal(plan.changes[0].r2Key, 'id-1');
  assert.deepEqual(plan.adds.map((op) => op.path), ['fresh.csv']);
  assert.deepEqual(plan.removals.map((r) => r.id), ['3']);
  assert.deepEqual(plan.renames, []);
});

test('a one-to-one move with the same hash is a rename that keeps the id', () => {
  const plan = diffSync([file('New Folder/moved.pdf', 'm1')], [row('7', 'Old/moved.pdf', 'm1')], ids());
  assert.equal(plan.renames.length, 1);
  assert.deepEqual([plan.renames[0].id, plan.renames[0].fromPath, plan.renames[0].path, plan.renames[0].folder], ['7', 'Old/moved.pdf', 'New Folder/moved.pdf', 'New Folder']);
  assert.equal(plan.adds.length + plan.removals.length, 0);
});

test('duplicate hashes are not renames: two adds, or two removals, sharing content', () => {
  const twoAdds = diffSync([file('a.pdf', 'dup'), file('b.pdf', 'dup')], [row('1', 'old.pdf', 'dup')], ids());
  assert.equal(twoAdds.renames.length, 0);
  assert.equal(twoAdds.adds.length, 2);
  assert.equal(twoAdds.removals.length, 1);

  const twoRemovals = diffSync([file('c.pdf', 'dup')], [row('1', 'a.pdf', 'dup'), row('2', 'b.pdf', 'dup')], ids());
  assert.equal(twoRemovals.renames.length, 0);
  assert.equal(twoRemovals.adds.length, 1);
  assert.equal(twoRemovals.removals.length, 2);
});

test('a rename alongside an unrelated duplicate still pairs one-to-one only', () => {
  const plan = diffSync([file('x/new.md', 'h1'), file('keep.md', 'h1')], [row('1', 'keep.md', 'h1'), row('2', 'old.md', 'h1')], ids());
  assert.deepEqual(plan.renames.map((op) => [op.id, op.path]), [['2', 'x/new.md']]);
});

test('counsel rows are never touched: not removed, renamed or changed, even at a colliding path', () => {
  const counsel = [
    row('c1', 'from-counsel/c1/upload.pdf', null, { source: 'counsel' }),
    row('c2', 'shared.pdf', 'same', { source: 'counsel' }),
    row('c3', 'gone.pdf', 'zz', { source: 'counsel' }),
  ];
  const plan = diffSync([file('shared.pdf', 'other'), file('copy.pdf', 'zz')], counsel, ids());
  const touched = [...plan.changes, ...plan.renames, ...plan.removals, ...plan.unchanged].map((op) => op.id);
  assert.deepEqual(touched, []);
  assert.deepEqual(plan.adds.map((op) => op.path), ['shared.pdf', 'copy.pdf']);
});

test('removed mirror rows are ignored and NFD paths match NFC rows', () => {
  const rows = [row('1', 'gone.pdf', 'g', { removed_at: '2026-01-01T00:00:00Z' }), row('2', 'Résumé.pdf', 'r')];
  const plan = diffSync([file('Résumé.pdf', 'r')], rows, ids());
  assert.deepEqual(plan.unchanged.map((doc) => doc.id), ['2']);
  assert.equal(plan.removals.length, 0);
  assert.equal(planIsEmpty(plan), true);
});
