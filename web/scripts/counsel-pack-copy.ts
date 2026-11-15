// SPDX-License-Identifier: Apache-2.0
// Puts one document into the counsel pack: a mirror file copied from the Mac, or a counsel upload read from
// legallas-files, each checked against the sha256 D1 holds (an upload from before the room hashed them, against its etag). Each copy goes to a temp name beside its target and
// is renamed into place only once verified. Every failure becomes an outcome, never a thrown error, so one
// bad file cannot cost the manifest the files that did land (see buildPack).
import { createHash, randomBytes } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, lstat, rename, rm } from 'node:fs/promises';
import type { Manifest, ManifestEntry, PackRow } from './counsel-pack-plan.ts';
import { ensureParent, outPath, untouched } from './counsel-pack-out.ts';
import type { WalkedFile } from './guard.ts';
import { sha256File } from './snapshot.ts';
import { assertReadKey, FILES_BUCKET } from './wrangler.ts';

/** What happened to one document. Only `copied` and `unchanged` end up in the pack and INDEX.csv. */
export type Outcome = 'copied' | 'unchanged' | 'missing' | 'changed' | 'conflict' | 'unavailable' | 'failed';

export interface Done {
  outcome: Outcome;
  sha256?: string;
  entry?: ManifestEntry;
  /** Unchanged in the pack although the Mac's copy is now missing or different. */
  staleLocal?: boolean;
  /** A pack file someone edited since the last run, replaced with the room's version. */
  replacedEdit?: boolean;
}

/** Copies a source file to a new destination path. Injectable so tests can fail a copy mid-run. */
export type Copier = (source: string, destination: string) => Promise<void>;

export interface CopyContext {
  out: string;
  manifest: Manifest;
  local: ReadonlyMap<string, WalkedFile>;
  r2Get(bucket: string, key: string, file: string): Promise<void>;
  copy: Copier;
  /** Dry run only: lowercased paths the first removal pass would clear, treated as already gone. */
  vacating?: ReadonlySet<string>;
  /**
   * Set when the run is interrupted. A row not yet started, or not yet renamed into place, then ends as
   * `failed` with its temp file removed; a row already renamed finishes and is recorded.
   */
  signal?: AbortSignal;
  /** Test seam: runs right after a copy is renamed into place, before it is recorded. */
  afterPlace?: () => void;
}

/** An APFS clone when the volumes match, a byte copy otherwise; never over an existing file. */
export const cloneOrCopy: Copier = (source, destination) => copyFile(source, destination, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);

// R2 gives a single-part upload the hex MD5 of its bytes as its etag; multipart etags carry a "-<parts>" suffix.
const MD5_ETAG = /^"?([0-9a-f]{32})"?$/;

function md5File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function tempBeside(file: string): string {
  return `${file}.counsel-pack-${randomBytes(4).toString('hex')}`;
}

/**
 * Moves a verified temp file into place and returns its manifest entry. The temp file is stat'ed first (a
 * rename keeps size and mtime), so nothing can fail once the file is in place, and the abort check sits
 * right before the rename: a placed file is always recorded, even when the run is being interrupted.
 */
async function place(ctx: CopyContext, temp: string, dest: string, id: string, sha256: string, etag?: string): Promise<ManifestEntry> {
  const stats = await lstat(temp);
  if (ctx.signal?.aborted) throw new Error('Interrupted before the copy was put in place');
  await rename(temp, dest);
  ctx.afterPlace?.();
  return { id, sha256, size: stats.size, mtimeMs: stats.mtimeMs, ...(etag ? { etag } : {}) };
}

/** Runs `fill` on a temp file beside `dest`; the temp file is always gone afterwards. */
async function viaTemp(ctx: CopyContext, dest: string, fill: (temp: string) => Promise<Done>): Promise<Done> {
  await ensureParent(ctx.out, dest);
  const temp = tempBeside(dest);
  try {
    return await fill(temp);
  } finally {
    await rm(temp, { force: true });
  }
}

/**
 * Where the pack stands for one path before copying: kept as is, refused (a file the pack did not write),
 * or due a copy, noting whether a pack file someone edited is about to be replaced.
 */
async function existing(ctx: CopyContext, row: PackRow, dest: string, same: (entry: ManifestEntry) => boolean): Promise<Done | { replacedEdit: boolean }> {
  const entry = ctx.manifest.files[row.rel];
  if (entry && same(entry) && (await untouched(dest, entry))) return { outcome: 'unchanged', sha256: entry.sha256, entry };
  const present = !ctx.vacating?.has(row.rel.toLowerCase()) && (await lstat(dest).catch(() => null)) !== null;
  if (!entry && present) return { outcome: 'conflict' };
  return { replacedEdit: !!entry && present && !(await untouched(dest, entry)) };
}

/** A mirror row that needs copying: the Mac's file, verified against D1, and whether an edit is replaced. */
interface MirrorPending {
  local: WalkedFile;
  replacedEdit: boolean;
}

/** Decides a mirror row without writing: kept, refused, skipped, or due a copy from the Mac. */
async function mirrorState(ctx: CopyContext, row: PackRow, dest: string): Promise<Done | MirrorPending> {
  const local = ctx.local.get(row.rel);
  const localOk = local ? (await sha256File(local.abs).catch(() => null)) === row.sha256 : false;
  const state = await existing(ctx, row, dest, (entry) => entry.sha256 === row.sha256);
  if ('outcome' in state) return state.outcome === 'unchanged' ? { ...state, staleLocal: !localOk } : state;
  if (!local || !localOk) return { outcome: local ? 'changed' : 'missing' };
  return { local, replacedEdit: state.replacedEdit };
}

const sameUpload = (row: PackRow) => (entry: ManifestEntry) => entry.id === row.id && !!row.etag && entry.etag === row.etag;

async function mirrorOnce(ctx: CopyContext, row: PackRow): Promise<Done> {
  const dest = outPath(ctx.out, row.rel);
  const state = await mirrorState(ctx, row, dest);
  if ('outcome' in state) return state;
  return viaTemp(ctx, dest, async (temp) => {
    await ctx.copy(state.local.abs, temp);
    // The copy is hashed, not the original, so an edit during the copy cannot slip into the pack.
    const copied = await sha256File(temp);
    if (copied !== row.sha256) return { outcome: 'changed' };
    return { outcome: 'copied', sha256: copied, entry: await place(ctx, temp, dest, row.id, copied), replacedEdit: state.replacedEdit };
  });
}

async function uploadOnce(ctx: CopyContext, row: PackRow): Promise<Done> {
  const dest = outPath(ctx.out, row.rel);
  const state = await existing(ctx, row, dest, sameUpload(row));
  if ('outcome' in state) return state;
  return viaTemp(ctx, dest, async (temp) => {
    try {
      await ctx.r2Get(FILES_BUCKET, assertReadKey(row.r2Key ?? ''), temp);
    } catch {
      return { outcome: 'unavailable' };
    }
    const stats = await lstat(temp);
    if (!stats.isFile() || stats.size !== row.size) return { outcome: 'changed' };
    const md5 = MD5_ETAG.exec(row.etag ?? '')?.[1];
    if (md5 && (await md5File(temp)) !== md5) return { outcome: 'changed' };
    const sha256 = await sha256File(temp);
    if (row.sha256 !== null && sha256 !== row.sha256) return { outcome: 'changed' };
    return { outcome: 'copied', sha256, entry: await place(ctx, temp, dest, row.id, sha256, row.etag ?? undefined), replacedEdit: state.replacedEdit };
  });
}

/**
 * Packs one row. Never throws: a file system error (a full disk, a planted link) or an interrupt is the
 * outcome `failed`, and the row's temp file is gone.
 */
export function packOne(ctx: CopyContext, row: PackRow): Promise<Done> {
  if (ctx.signal?.aborted) return Promise.resolve({ outcome: 'failed' });
  return (row.source === 'counsel' ? uploadOnce(ctx, row) : mirrorOnce(ctx, row)).catch((): Done => ({ outcome: 'failed' }));
}

/**
 * What packOne would do, without writing anything: `copied` means "would copy". A would-be copy has no
 * entry, so it is never recorded. Upload bytes are not read, so only their size from D1 is known.
 */
export async function planOne(ctx: CopyContext, row: PackRow): Promise<Done> {
  const dest = outPath(ctx.out, row.rel);
  const state = row.source === 'counsel' ? await existing(ctx, row, dest, sameUpload(row)) : await mirrorState(ctx, row, dest);
  return 'outcome' in state ? state : { outcome: 'copied', replacedEdit: state.replacedEdit };
}
