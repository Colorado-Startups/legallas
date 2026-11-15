// SPDX-License-Identifier: Apache-2.0
// Builds or refreshes a counsel pack. D1 decides what counsel may see; the local source folder supplies the
// bytes, walked by the same guard as sync (a _private folder, a link or an alias aborts the whole run), and
// every copy is hashed and compared with the sha256 D1 holds. A document missing or different on the Mac is
// reported and skipped, never guessed. Counsel uploads (--include-uploads) are read from legallas-files.
// Copying one document is counsel-pack-copy.ts; the --out folder and its manifest are counsel-pack-out.ts.
import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { cloneOrCopy, packOne, planOne, type Copier, type CopyContext, type Done, type Outcome } from './counsel-pack-copy.ts';
import { PACK_COMPANY_SQL, PACK_MATCHES_SQL, PACK_NOT_APPLICABLE_SQL, questionsText } from './counsel-pack-questions.ts';
import { checkOutDir, loadManifest, outPath, removeStale, saveManifest, sweepTemps, sweepZipPartials, writeAtomic } from './counsel-pack-out.ts';
import {
  INDEX_NAME, indexCsv, mirrorRow, PACK_MIRROR_SQL, PACK_UPLOADS_SQL, QUESTIONS_NAME, README_NAME, readmeText, UPLOADS_FOLDER, uploadRow,
  type IndexLine, type Manifest, type PackRow,
} from './counsel-pack-plan.ts';
import { listZip, writeZip, type ZipInput } from './counsel-pack-zip.ts';
import { guardWalk, readFinderInfo, type FinderInfoReader } from './guard.ts';
import { mapLimit } from './pool.ts';
import { sanitizeFilename } from './pull.ts';

export type { Outcome } from './counsel-pack-copy.ts';

export interface PackOptions {
  out: string;
  sourceRoot: string;
  prefix: string;
  banner: string;
  includeUploads: boolean;
  zip: boolean;
  /** Also write QUESTIONS_NAME, the checklist's questions for the firm. Off unless asked for. */
  questions?: boolean;
  /** Plan and count only: nothing in --out (or beside it) is created, changed or removed. */
  dryRun: boolean;
}

export interface PackDeps {
  d1Query(sql: string): Promise<Record<string, unknown>[]>;
  r2Get(bucket: string, key: string, file: string): Promise<void>;
  now: Date;
  finderInfo?: FinderInfoReader;
  repoRoot?: string;
  copy?: Copier;
  /**
   * Registers `stop` to run if the process is interrupted (the CLI uses SIGINT and SIGTERM). `stop` asks the
   * run to finish the copies in flight, waits for them to be recorded (at most INTERRUPT_WAIT_MS), then saves
   * the manifest, so it lists every file in --out. Returns the function that unregisters it.
   */
  onInterrupt?: (stop: () => Promise<void>) => () => void;
  /** Test seam: runs right after a copy is renamed into place, before it is recorded. */
  afterPlace?: () => void;
  /** How long an interrupt waits for in-flight work; INTERRUPT_WAIT_MS unless a test shortens it. */
  interruptWaitMs?: number;
}

export interface PackReport {
  /** Pages, Numbers and Keynote documents saved as folders, so a person relying on the pack can see what isn't current. */
  iworkPackages: string[];
  /** True for --dry-run: `copied` then means "would copy" and removals are what would be removed. */
  dryRun: boolean;
  outcomes: Record<Outcome, number>;
  /** Kept from an earlier run although the Mac's copy is now missing or different (the room still serves it). */
  staleLocal: number;
  /** Pack files someone edited since the last run, replaced with the room's version. */
  replacedEdits: number;
  /** D1 rows dropped before planning: hidden names, unsafe paths, malformed rows. */
  ignored: number;
  removed: number;
  removedBytes: number;
  /** Pack files no longer in the room that were edited (or moved behind a link) since; left in place. */
  left: number;
  packedBytes: number;
  copiedBytes: number;
  zip: { entries: number; bytes: number } | null;
  /** Temp files an interrupted earlier run left in --out, deleted at the start of this one. */
  sweptTemps: number;
  /** Per-document detail for --verbose. Never printed otherwise: paths are case data. */
  details: { outcome: Outcome | 'removed' | 'left'; rel: string }[];
}

const CONCURRENCY = 4;
/** How long an interrupt waits for in-flight copies (or the zip) to stop before saving anyway. */
export const INTERRUPT_WAIT_MS = 10_000;
export const INTERRUPTED = 'Interrupted. Every file written so far is in the manifest; run the pack again to finish.';
const ZIP_NOT_OURS = 'A zip beside --out already exists and this pack did not write it (or it was changed since); move it aside first';

/**
 * Gives each upload a stable place under from-counsel/: the one an earlier run used for the same id, or a
 * sanitized, de-duplicated version of the name counsel gave it.
 */
export function placeUploads(uploads: readonly PackRow[], manifest: Manifest, taken: Set<string>): PackRow[] {
  const byId = new Map(Object.entries(manifest.files).filter(([rel]) => rel.startsWith(`${UPLOADS_FOLDER}/`)).map(([rel, e]) => [e.id, rel]));
  const names = new Set([...taken].filter((rel) => rel.startsWith(`${UPLOADS_FOLDER}/`)).map((rel) => rel.slice(UPLOADS_FOLDER.length + 1)));
  const placed: PackRow[] = [];
  const pending: PackRow[] = [];
  for (const row of uploads) {
    const earlier = byId.get(row.id);
    if (earlier && !taken.has(earlier.toLowerCase())) {
      taken.add(earlier.toLowerCase());
      names.add(earlier.slice(UPLOADS_FOLDER.length + 1).toLowerCase());
      placed.push({ ...row, rel: earlier });
    } else pending.push(row);
  }
  for (const row of pending) {
    const rel = `${UPLOADS_FOLDER}/${sanitizeFilename(row.name, names)}`;
    taken.add(rel.toLowerCase());
    placed.push({ ...row, rel });
  }
  return placed;
}

/** Drops rows whose path collides case-insensitively with an earlier one (APFS would merge them). */
function dedupe(rows: readonly PackRow[], taken: Set<string>): { rows: PackRow[]; collisions: PackRow[] } {
  const kept: PackRow[] = [];
  const collisions: PackRow[] = [];
  for (const row of rows) {
    const key = row.rel.toLowerCase();
    if (taken.has(key)) collisions.push(row);
    else {
      taken.add(key);
      kept.push(row);
    }
  }
  return { rows: kept, collisions };
}

async function readRows(deps: PackDeps, includeUploads: boolean): Promise<{ mirror: PackRow[]; uploads: PackRow[]; ignored: number }> {
  const rawMirror = await deps.d1Query(PACK_MIRROR_SQL);
  const rawUploads = includeUploads ? await deps.d1Query(PACK_UPLOADS_SQL) : [];
  const mirror = rawMirror.map(mirrorRow).filter((row): row is PackRow => row !== null);
  const uploads = rawUploads.map(uploadRow).filter((row): row is PackRow => row !== null);
  return { mirror, uploads, ignored: rawMirror.length - mirror.length + rawUploads.length - uploads.length };
}

function emptyReport(ignored: number, dryRun: boolean, iworkPackages: string[]): PackReport {
  const outcomes = { copied: 0, unchanged: 0, missing: 0, changed: 0, conflict: 0, unavailable: 0, failed: 0 };
  return {
    iworkPackages, dryRun, outcomes, staleLocal: 0, replacedEdits: 0, ignored, removed: 0, removedBytes: 0, left: 0,
    packedBytes: 0, copiedBytes: 0, zip: null, sweptTemps: 0, details: [],
  };
}

/** Records one result in the report, the manifest and INDEX.csv. Returns true when the file is in the pack. */
function record(report: PackReport, manifest: Manifest, lines: IndexLine[], row: PackRow, done: Done): boolean {
  report.outcomes[done.outcome] += 1;
  report.details.push({ outcome: done.outcome, rel: row.rel });
  if (done.replacedEdit) report.replacedEdits += 1;
  if (!done.entry || !done.sha256) return false;
  manifest.files[row.rel] = done.entry;
  lines.push({ row, sha256: done.sha256 });
  report.packedBytes += done.entry.size;
  if (done.outcome === 'copied') report.copiedBytes += done.entry.size;
  if (done.staleLocal) report.staleLocal += 1;
  return true;
}

/** Removes manifest files not in `keep` and adds the result to the report. */
async function removeInto(
  report: PackReport,
  out: string,
  manifest: Manifest,
  keep: ReadonlySet<string>,
  options: { dryRun?: boolean; signal?: AbortSignal } = {},
): Promise<string[]> {
  const removal = await removeStale(out, manifest, keep, options);
  report.removed += removal.removed.length;
  report.removedBytes += removal.removedBytes;
  report.left += removal.left.length;
  for (const rel of removal.removed) report.details.push({ outcome: 'removed', rel });
  for (const rel of removal.left) report.details.push({ outcome: 'left', rel });
  return removal.removed;
}

/** True when nothing is at `target`, or it is the zip this pack recorded, unchanged since. */
async function zipIsOurs(target: string, manifest: Manifest): Promise<boolean> {
  const stats = await lstat(target).catch(() => null);
  if (!stats) return true;
  const zip = manifest.zip;
  return stats.isFile() && !stats.isSymbolicLink() && !!zip && stats.size === zip.size && stats.mtimeMs === zip.mtimeMs;
}

async function writeZipOf(out: string, manifest: Manifest, lines: readonly IndexLine[], now: Date, extra: readonly string[], signal?: AbortSignal): Promise<{ entries: number; bytes: number }> {
  const inputs: ZipInput[] = [INDEX_NAME, README_NAME, ...extra].map((name) => ({ name, file: path.join(out, name) }));
  for (const { row } of [...lines].sort((a, b) => (a.row.rel < b.row.rel ? -1 : 1))) inputs.push({ name: row.rel, file: outPath(out, row.rel) });
  const target = `${out}.zip`;
  if (!(await zipIsOurs(target, manifest))) throw new Error(ZIP_NOT_OURS);
  const written = await writeZip(target, inputs, now, signal);
  if ((await listZip(target)).length !== inputs.length) throw new Error('The zip did not list every file it should hold');
  const stats = await lstat(target);
  manifest.zip = { size: stats.size, mtimeMs: stats.mtimeMs };
  await saveManifest(out, manifest);
  return written;
}

/**
 * Copies every planned row. Each result is recorded as soon as it lands, and no job throws, so the manifest
 * saved afterwards always lists every file this run wrote.
 */
async function packAll(report: PackReport, ctx: CopyContext, rows: readonly PackRow[], lines: IndexLine[]): Promise<Set<string>> {
  const keep = new Set<string>();
  await mapLimit(rows, CONCURRENCY, async (row) => {
    if (record(report, ctx.manifest, lines, row, await packOne(ctx, row))) keep.add(row.rel);
  });
  return keep;
}

/**
 * --dry-run: decides every row as packAll would and counts removals, without touching the disk. Files the
 * first removal pass would clear are treated as gone, so a case-only rename is not counted as a conflict.
 */
async function planAll(report: PackReport, ctx: CopyContext, rows: readonly PackRow[]): Promise<PackReport> {
  const planned = new Set(rows.map((row) => row.rel));
  const vacating = new Set((await removeInto(report, ctx.out, ctx.manifest, planned, { dryRun: true })).map((rel) => rel.toLowerCase()));
  const keep = new Set<string>();
  await mapLimit(rows, CONCURRENCY, async (row) => {
    const done = await planOne({ ...ctx, vacating }, row).catch((): Done => ({ outcome: 'failed' }));
    record(report, ctx.manifest, [], row, done);
    if (done.outcome === 'copied') {
      report.copiedBytes += row.size;
      report.packedBytes += row.size;
    }
    if (done.outcome === 'copied' || done.outcome === 'unchanged') keep.add(row.rel);
  });
  // Planned rows that would not be packed lose their earlier copies too, as in a real run. The manifest is
  // unchanged in a dry run, so the files the first pass already counted are kept out of this one.
  const notPlanned = Object.keys(ctx.manifest.files).filter((rel) => !planned.has(rel));
  await removeInto(report, ctx.out, ctx.manifest, new Set([...keep, ...notPlanned]), { dryRun: true });
  return report;
}

/** Splits D1's rows into the plan: unique mirror paths, then uploads, with collisions recorded as conflicts. */
function planRows(report: PackReport, manifest: Manifest, mirror: readonly PackRow[], uploads: readonly PackRow[]): PackRow[] {
  const taken = new Set<string>();
  const unique = dedupe(mirror, taken);
  for (const row of unique.collisions) record(report, manifest, [], row, { outcome: 'conflict' });
  return [...unique.rows, ...placeUploads(uploads, manifest, taken)];
}

/** Resolves when `work` settles or `ms` passes, whichever comes first. */
function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([work.then(() => undefined, () => undefined), timeout]).finally(() => clearTimeout(timer));
}

/**
 * The writing half of a run: removals, copies, the manifest, INDEX.csv, README.txt and the zip. An aborted
 * signal stops it at the next safe point; the manifest is saved either way.
 */
async function writePack(report: PackReport, options: PackOptions, now: Date, ctx: CopyContext, planned: readonly PackRow[], questions: string | null): Promise<void> {
  const { out, manifest, signal } = ctx;
  const lines: IndexLine[] = [];
  try {
    // Files that left the plan go first, so a folder renamed only in case (one folder on APFS) is
    // cleared before its new spelling is written. Planned rows that fail to pack go after.
    await removeInto(report, out, manifest, new Set(planned.map((row) => row.rel)), { signal });
    await removeInto(report, out, manifest, await packAll(report, ctx, planned, lines), { signal });
  } finally {
    await saveManifest(out, manifest);
  }
  if (signal?.aborted) throw new Error(INTERRUPTED);
  await writeAtomic(path.join(out, INDEX_NAME), indexCsv(lines, options.prefix));
  await writeAtomic(path.join(out, README_NAME), readmeText(now.toISOString().slice(0, 10), lines.length, options.banner));
  if (questions !== null) await writeAtomic(path.join(out, QUESTIONS_NAME), questions);
  if (!options.zip) return;
  try {
    report.zip = await writeZipOf(out, manifest, lines, now, questions === null ? [] : [QUESTIONS_NAME], signal);
  } catch (error) {
    throw signal?.aborted ? new Error(INTERRUPTED) : error;
  }
}

/** Builds or refreshes the pack in `options.out`. Throws GuardAbort (nothing written) when the guard fails. */
export async function buildPack(options: PackOptions, deps: PackDeps): Promise<PackReport> {
  const out = await checkOutDir(options.out, options.sourceRoot, deps.repoRoot);
  const walk = await guardWalk(options.sourceRoot, deps.finderInfo ?? readFinderInfo);
  const { mirror, uploads, ignored } = await readRows(deps, options.includeUploads);
  const questions = options.questions && !options.dryRun
    ? questionsText(await deps.d1Query(PACK_MATCHES_SQL), await deps.d1Query(PACK_NOT_APPLICABLE_SQL), deps.now.toISOString().slice(0, 10), options.prefix, await deps.d1Query(PACK_COMPANY_SQL))
    : null;
  if (!options.dryRun) await mkdir(out, { recursive: true, mode: 0o700 });
  const manifest = await loadManifest(out);
  if (options.zip && !(await zipIsOurs(`${out}.zip`, manifest))) throw new Error(ZIP_NOT_OURS);
  const report = emptyReport(ignored, options.dryRun, walk.iworkPackages);
  const planned = planRows(report, manifest, mirror, uploads);
  // Temp files and partial zips an interrupted run left behind (only counted in a dry run).
  report.sweptTemps = (await sweepTemps(out, options.dryRun)) + (await sweepZipPartials(out, options.dryRun));
  const controller = new AbortController();
  const ctx: CopyContext = {
    out, manifest, local: new Map(walk.files.map((file) => [file.rel, file])), r2Get: deps.r2Get,
    copy: deps.copy ?? cloneOrCopy, signal: controller.signal, afterPlace: deps.afterPlace,
  };
  if (options.dryRun) return planAll(report, ctx, planned);
  let work: Promise<void> = Promise.resolve();
  const release = deps.onInterrupt?.(async () => {
    controller.abort();
    await settleWithin(work, deps.interruptWaitMs ?? INTERRUPT_WAIT_MS);
    await saveManifest(out, manifest);
  });
  try {
    work = writePack(report, options, deps.now, ctx, planned, questions);
    await work;
  } finally {
    release?.();
  }
  return report;
}
