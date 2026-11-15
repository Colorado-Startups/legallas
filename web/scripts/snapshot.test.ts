// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { guardWalk } from './guard.ts';
import { cloneWithCp, createSnapshot, MidSyncChange, removeSnapshot, snapshotName, verifyOriginals, type Cloner } from './snapshot.ts';

// Sync runs on macOS. CI runs on Linux, where `cp -c` does not exist, so tests that are not about cloning
// itself use a plain copy there; the APFS clone test runs on macOS only.
const MAC = process.platform === 'darwin';
const clone: Cloner = MAC ? cloneWithCp : (source, destination) => copyFile(source, destination);

async function fixture() {
  const parent = await mkdtemp(path.join(tmpdir(), 'legallas-snap-'));
  const root = path.join(parent, 'Shared');
  const cache = path.join(parent, 'cache');
  await mkdir(path.join(root, 'Folder'), { recursive: true });
  await writeFile(path.join(root, 'Folder', 'Delivery receipt.pdf'), 'first version');
  await writeFile(path.join(root, 'notes.md'), '# notes');
  const walk = await guardWalk(root, async () => null);
  return { parent, root, cache, walk, done: () => rm(parent, { recursive: true, force: true }) };
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

test('snapshot names are opaque: a sequence number and a short extension only', () => {
  assert.equal(snapshotName(7, 'Folder/Delivery receipt.PDF'), '000007.pdf');
  assert.equal(snapshotName(8, 'no extension'), '000008');
  assert.equal(snapshotName(9, 'weird.ext with space'), '000009');
});

test('createSnapshot clones with cp -c, hashes the clone and cleans up', { skip: !MAC && 'cp -c is macOS only' }, async () => {
  const f = await fixture();
  try {
    const snapshot = await createSnapshot(f.walk.files, f.cache, 'run1');
    assert.equal(snapshot.dir, path.join(f.cache, 'snapshot-run1'));
    assert.deepEqual(snapshot.files.map((file) => file.sha256), [sha('first version'), sha('# notes')]);
    assert.deepEqual((await readdir(snapshot.dir)).sort(), ['000000.pdf', '000001.md']);
    assert.equal((await stat(snapshot.dir)).mode & 0o777, 0o700);
    await verifyOriginals(snapshot);
    await removeSnapshot(snapshot);
    await assert.rejects(stat(snapshot.dir));
  } finally {
    await f.done();
  }
});

test('a file modified mid-sync aborts with its path', async () => {
  const f = await fixture();
  try {
    const snapshot = await createSnapshot(f.walk.files, f.cache, 'run2', clone);
    await appendFile(path.join(f.root, 'Folder', 'Delivery receipt.pdf'), ' edited');
    await assert.rejects(verifyOriginals(snapshot), (error: unknown) => {
      assert.ok(error instanceof MidSyncChange);
      assert.deepEqual(error.changed, ['Folder/Delivery receipt.pdf']);
      return true;
    });
  } finally {
    await f.done();
  }
});

test('a file replaced by an atomic save (new inode) mid-sync aborts', async () => {
  const f = await fixture();
  try {
    const snapshot = await createSnapshot(f.walk.files, f.cache, 'run3', clone);
    const target = path.join(f.root, 'notes.md');
    await writeFile(`${target}.tmp`, '# notes');
    await rename(`${target}.tmp`, target);
    await assert.rejects(verifyOriginals(snapshot), MidSyncChange);
  } finally {
    await f.done();
  }
});

test('a file swapped between the walk and the clone aborts before cloning it', async () => {
  const f = await fixture();
  try {
    const target = path.join(f.root, 'notes.md');
    // Moved aside rather than deleted, so the file system cannot hand the same inode to the replacement.
    await rename(target, path.join(f.parent, 'aside.md'));
    await writeFile(target, 'different file, different inode');
    await assert.rejects(createSnapshot(f.walk.files, f.cache, 'run4', clone), MidSyncChange);
  } finally {
    await f.done();
  }
});

test('a change during the clone itself is caught by the inode check', async () => {
  const f = await fixture();
  try {
    const sneaky: Cloner = async (source, destination) => {
      await copyFile(source, destination);
      await rename(source, `${destination}.aside`);
      await writeFile(source, 'replaced while cloning');
    };
    await assert.rejects(createSnapshot(f.walk.files, f.cache, 'run5', sneaky), MidSyncChange);
  } finally {
    await f.done();
  }
});
