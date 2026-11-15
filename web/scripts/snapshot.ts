// SPDX-License-Identifier: Apache-2.0
// Point-in-time snapshot of the walked files. On macOS each file is APFS-cloned (`cp -c`, instant and free on the same
// volume) into <cacheDir>/snapshot-<run id>/ under an opaque name, then hashed. Where a clone isn't free, as on NTFS, each
// original is hashed in place, and only the files a run will read are copied in, once the plan is known (fillSnapshot):
// copying a whole folder for every run would be most of the work. Extraction and uploads read only the snapshot. After uploading, the originals are re-hashed: if anything changed mid-sync the run
// aborts before D1 is touched. The snapshot directory is removed at the end of every run.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { WalkedFile } from './guard.ts';
import { mapLimit } from './pool.ts';

export interface SnapshotFile extends WalkedFile {
  /** The clone inside the snapshot directory. Its name never contains the original filename. */
  snapshot: string;
  sha256: string;
}

export interface Snapshot {
  dir: string;
  files: SnapshotFile[];
}

export type Cloner = (source: string, destination: string) => Promise<void>;

export class MidSyncChange extends Error {
  readonly changed: string[];
  constructor(changed: string[]) {
    super(`${changed.length} file${changed.length === 1 ? '' : 's'} changed while syncing. Nothing was written to D1; run sync again.`);
    this.changed = changed;
  }
}

const HASH_CONCURRENCY = 8;
const SAFE_EXTENSION = /^\.[a-z0-9]{1,10}$/;

/** `cp -c` clones on APFS and fails rather than falling back to a byte copy. */
export const cloneWithCp: Cloner = (source, destination) =>
  new Promise((resolve, reject) => {
    execFile('/bin/cp', ['-c', '--', source, destination], (error) => (error ? reject(new Error('cp -c failed: is cacheDir on the same APFS volume as sourceRoot?')) : resolve()));
  });

/**
 * This computer's way to take a snapshot. GNU `cp -c` means something else, and Windows has no `cp`. Reading a file
 * OneDrive holds only in the cloud downloads it first.
 */
export const platformClone: Cloner = process.platform === 'darwin' ? cloneWithCp : (source, destination) => copyFile(source, destination, constants.COPYFILE_FICLONE);

/** Whether the first step can hold every file for nothing. If not, sync copies in only what the plan needs. */
export const CLONES_ARE_FREE = process.platform === 'darwin';

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Opaque snapshot name: a sequence number plus a short lowercase extension (the extractor may need it). */
export function snapshotName(index: number, rel: string): string {
  const ext = path.extname(rel).toLowerCase();
  return `${String(index).padStart(6, '0')}${SAFE_EXTENSION.test(ext) ? ext : ''}`;
}

/** The original must still be the same regular, singly-linked file the guard approved. */
async function assertSameFile(file: WalkedFile): Promise<boolean> {
  const stats = await lstat(file.abs).catch(() => null);
  return !!stats && stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1 && stats.ino === file.ino && stats.dev === file.dev;
}

export function snapshotDir(cacheDir: string, runId: string): string {
  return path.join(cacheDir, `snapshot-${runId}`);
}

/**
 * With `later`, nothing is copied yet: each file is hashed where it is, and no file is at its `snapshot` path until
 * fillSnapshot, which a run must call for every file it will read.
 */
export async function createSnapshot(files: readonly WalkedFile[], cacheDir: string, runId: string, clone: Cloner = platformClone, later = false): Promise<Snapshot> {
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  await chmod(cacheDir, 0o700);
  const dir = snapshotDir(cacheDir, runId);
  await mkdir(dir, { mode: 0o700 });
  const snapshotFiles = await mapLimit(files, HASH_CONCURRENCY, async (file, index) => {
    const destination = path.join(dir, snapshotName(index, file.rel));
    if (!(await assertSameFile(file))) throw new MidSyncChange([file.rel]);
    if (later) {
      const sha256 = await sha256File(file.abs);
      if (!(await assertSameFile(file))) throw new MidSyncChange([file.rel]);
      return { ...file, snapshot: destination, size: (await lstat(file.abs)).size, sha256 };
    }
    await clone(file.abs, destination);
    if (!(await assertSameFile(file))) throw new MidSyncChange([file.rel]);
    const cloned = await lstat(destination);
    if (!cloned.isFile() || cloned.isSymbolicLink()) throw new Error('Snapshot produced something other than a regular file');
    return { ...file, snapshot: destination, size: cloned.size, sha256: await sha256File(destination) };
  });
  return { dir, files: snapshotFiles };
}

/**
 * Copies in the files a deferred snapshot left out, by their snapshot paths. Throws MidSyncChange when an original no
 * longer matches its hash, because the plan was made from that hash. A file already there is left alone.
 */
export async function fillSnapshot(snapshot: Snapshot, wanted: Iterable<string>, clone: Cloner = platformClone): Promise<void> {
  const paths = new Set(wanted);
  const files = snapshot.files.filter((file) => paths.has(file.snapshot));
  await mapLimit(files, HASH_CONCURRENCY, async (file) => {
    if (await lstat(file.snapshot).catch(() => null)) return;
    if (!(await assertSameFile(file))) throw new MidSyncChange([file.rel]);
    await clone(file.abs, file.snapshot);
    if ((await sha256File(file.snapshot)) !== file.sha256) throw new MidSyncChange([file.rel]);
  });
}

/** Re-hashes every original. Throws MidSyncChange listing the paths that differ from the snapshot. */
export async function verifyOriginals(snapshot: Snapshot): Promise<void> {
  const changed: string[] = [];
  await mapLimit(snapshot.files, HASH_CONCURRENCY, async (file) => {
    const same = (await assertSameFile(file)) && (await sha256File(file.abs).catch(() => '')) === file.sha256;
    if (!same) changed.push(file.rel);
  });
  if (changed.length > 0) throw new MidSyncChange(changed.sort());
}

export async function removeSnapshot(snapshot: Pick<Snapshot, 'dir'>): Promise<void> {
  await rm(snapshot.dir, { recursive: true, force: true });
}
