// SPDX-License-Identifier: Apache-2.0
// The --out folder of the counsel pack: where it may be, the manifest of files the pack wrote there, and
// the only deletions the pack ever makes (files it wrote, unchanged since, that left the room).
import { randomBytes } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { emptyManifest, isInside, MANIFEST_NAME, parseManifest, serializeManifest, type Manifest, type ManifestEntry } from './counsel-pack-plan.ts';

/** The repository this script lives in. The pack never writes inside it. */
export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** Resolves symlinks in the longest existing prefix of `target`, so a link cannot hide where it points. */
export async function resolveReal(target: string): Promise<string> {
  const absolute = path.resolve(target);
  const rest: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      return path.join(await realpath(current), ...rest.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

async function exists(file: string): Promise<boolean> {
  return (await lstat(file).catch(() => null)) !== null;
}

/** True when `dir` or any folder above it holds a `.git` entry (a repository or a worktree). */
async function insideGitWorkTree(dir: string): Promise<boolean> {
  for (let current = dir; ; current = path.dirname(current)) {
    if (await exists(path.join(current, '.git'))) return true;
    if (path.dirname(current) === current) return false;
  }
}

/**
 * Refuses an --out that is inside (or contains) the source folder, sits inside this repository or any git
 * work tree, is a symlink or a file, or is a non-empty folder that is not a previous pack. Returns the
 * resolved folder. Nothing is created or changed here.
 */
export async function checkOutDir(out: string, sourceRoot: string, repoRoot = REPO_ROOT): Promise<string> {
  const real = await resolveReal(out);
  const source = await resolveReal(sourceRoot);
  if (isInside(real, source) || isInside(source, real)) throw new Error('--out must be outside the source folder (and must not contain it)');
  if (isInside(real, await resolveReal(repoRoot)) || (await insideGitWorkTree(real))) throw new Error('--out must be outside every git repository');
  const stats = await lstat(path.resolve(out)).catch(() => null);
  if (stats && (stats.isSymbolicLink() || !stats.isDirectory())) throw new Error('--out must be a folder, not a file or a link');
  if (stats) {
    const names = await readdir(real);
    if (names.length > 0 && !names.includes(MANIFEST_NAME)) throw new Error(`--out is not empty and holds no ${MANIFEST_NAME}; choose an empty folder`);
  }
  return real;
}

/** The manifest of a previous run, or an empty one for a new pack. */
export async function loadManifest(out: string): Promise<Manifest> {
  const text = await readFile(path.join(out, MANIFEST_NAME), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  return text === null ? emptyManifest() : parseManifest(text);
}

/** Writes a file in `out` under a temporary name, then renames it into place. */
export async function writeAtomic(file: string, content: string): Promise<void> {
  const temp = `${file}.counsel-pack-${randomBytes(4).toString('hex')}`;
  await writeFile(temp, content, { mode: 0o600, flag: 'wx' });
  await rename(temp, file);
}

export async function saveManifest(out: string, manifest: Manifest): Promise<void> {
  await writeAtomic(path.join(out, MANIFEST_NAME), serializeManifest(manifest));
}

/** The absolute path of a pack-relative path. Callers validate `rel` with isSafeRel first. */
export function outPath(out: string, rel: string): string {
  return path.join(out, ...rel.split('/'));
}

/** True when the file at `file` is still exactly what the manifest says the pack wrote. */
export async function untouched(file: string, entry: ManifestEntry): Promise<boolean> {
  const stats = await lstat(file).catch(() => null);
  return !!stats && stats.isFile() && !stats.isSymbolicLink() && stats.size === entry.size && stats.mtimeMs === entry.mtimeMs;
}

/** Creates the parent folder of `file` and checks that it still resolves inside `out` (no planted links). */
export async function ensureParent(out: string, file: string): Promise<void> {
  const parent = path.dirname(file);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if (!isInside(await realpath(parent), out)) throw new Error('A folder inside --out resolves outside it; nothing more was written');
}

/** Removes empty folders from `dir` up to, but never including, `out`. */
async function pruneEmpty(out: string, dir: string): Promise<void> {
  for (let current = dir; current !== out && isInside(current, out); current = path.dirname(current)) {
    if ((await readdir(current).catch(() => ['?'])).length > 0) return;
    await rmdir(current).catch(() => undefined);
  }
}

export interface RemovalResult {
  removed: string[];
  removedBytes: number;
  /** Manifest files that were edited or replaced since the pack wrote them; left in place. */
  left: string[];
}

/** True when the folder holding `file` really is inside `out` (no link planted in its path since). */
async function parentInside(out: string, file: string): Promise<boolean> {
  const parent = await realpath(path.dirname(file)).catch(() => null);
  return parent !== null && isInside(parent, out);
}

/**
 * Removes manifest files whose path is not in `keep`, but only when each is still the file the pack wrote
 * and its folder still resolves inside --out. Everything else in --out is left alone. The manifest is
 * updated in place, each entry only once its file is dealt with, so a manifest saved by an interrupt
 * never forgets a file that is still there. `dryRun` counts what would go and changes nothing; an aborted
 * `signal` stops before the next file.
 */
export async function removeStale(
  out: string,
  manifest: Manifest,
  keep: ReadonlySet<string>,
  options: { dryRun?: boolean; signal?: AbortSignal } = {},
): Promise<RemovalResult> {
  const result: RemovalResult = { removed: [], removedBytes: 0, left: [] };
  const dryRun = options.dryRun ?? false;
  for (const [rel, entry] of Object.entries(manifest.files)) {
    if (options.signal?.aborted) break;
    if (keep.has(rel)) continue;
    const file = outPath(out, rel);
    if ((await parentInside(out, file)) && (await untouched(file, entry))) {
      if (!dryRun) {
        await rm(file);
        await pruneEmpty(out, path.dirname(file));
      }
      result.removed.push(rel);
      result.removedBytes += entry.size;
    } else if (await exists(file)) {
      result.left.push(rel);
    }
    if (!dryRun) delete manifest.files[rel];
  }
  return result;
}

/** The temp names the pack writes beside a target (copies, INDEX.csv, README.txt, the manifest). */
export const TEMP_NAME = /\.counsel-pack-[0-9a-f]{8}$/;
/** The temp name writeZip uses beside the zip: `<out>.zip.partial-` and eight hex digits. */
const ZIP_PARTIAL = /^\.zip\.partial-[0-9a-f]{8}$/;

/** readdir that treats a folder that vanished (or became a file) mid-sweep as empty. */
async function entriesOf(dir: string): Promise<Dirent[]> {
  return readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  });
}

/** Removes (or, in a dry run, only counts) a temp file that is still a regular file in a folder inside `root`. */
async function clearTemp(root: string, file: string, dryRun: boolean): Promise<number> {
  if (!(await parentInside(root, file))) return 0;
  const stats = await lstat(file).catch(() => null);
  if (!stats?.isFile()) return 0;
  if (!dryRun) await rm(file, { force: true });
  return 1;
}

/**
 * Deletes temp files an interrupted run left in --out: regular files whose name ends in `.counsel-pack-`
 * and eight hex digits, nothing else. A folder is entered only when it is a real folder that resolves
 * inside --out, so links are never followed, and entries that vanish mid-sweep are skipped. `dryRun` only
 * counts. Returns the count.
 */
export async function sweepTemps(out: string, dryRun = false, dir = out): Promise<number> {
  let swept = 0;
  for (const entry of await entriesOf(dir)) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const stats = await lstat(file).catch(() => null);
      const real = stats?.isDirectory() ? await realpath(file).catch(() => null) : null;
      if (real !== null && isInside(real, out)) swept += await sweepTemps(out, dryRun, file);
    } else if (entry.isFile() && TEMP_NAME.test(entry.name)) {
      swept += await clearTemp(out, file, dryRun);
    }
  }
  return swept;
}

/** Deletes (or counts) partial zips an interrupted run left beside --out: `<out>.zip.partial-<8 hex>` only. */
export async function sweepZipPartials(out: string, dryRun = false): Promise<number> {
  const parent = path.dirname(out);
  const base = path.basename(out);
  let swept = 0;
  for (const entry of await entriesOf(parent)) {
    if (entry.isFile() && entry.name.startsWith(base) && ZIP_PARTIAL.test(entry.name.slice(base.length))) {
      swept += await clearTemp(parent, path.join(parent, entry.name), dryRun);
    }
  }
  return swept;
}
