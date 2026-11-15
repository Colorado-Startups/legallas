// SPDX-License-Identifier: Apache-2.0
// The sync page's collector (PLAN.md). On a hosted Mac or Windows machine it builds an invented company folder, runs
// the sync engine's own dry run on it (the calls sync.ts makes before --apply), lands each sample as a new file and
// then as an edit, and writes one record per metric of that computer's group. The engine failing is a reading of 0;
// this script failing writes nothing, which reads as missing. Last, it reads this lane's own job minutes so far
// (core/lane/collect.ts) as <computer>_lane_minutes, so the whole run is timed.
//
//   node quality-speed/pages/sync/collect.ts --out <file>     (core/collect.ts runs it so, from lanes.json)
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';
import { laneRecord } from '../../core/lane/collect.ts';
import { CLUTTER, filler, planted, samples, type FileType, type Planted } from './samples.ts';

// The engine. web/scripts is type-checked by web's own, looser settings, so it is loaded by URL and left untyped here.
const load = (name: string) => import(new URL(`../../../web/scripts/${name}.ts`, import.meta.url).href);
const [{ diffSync, kindOf }, { cachedExtractor, directTextPages }, { platformExtractor }, { guardWalk }, { buildParts }, pii, snap, { filesToRead }] = await Promise.all(
  ['diff', 'extract', 'extract-windows', 'guard', 'indexparts', 'pii-scan', 'snapshot', 'sync'].map(load),
);
const { loadCleared, piiTargets, saveCleared, scanForPii, unreadTargets } = pii;
const { CLONES_ARE_FREE, createSnapshot, fillSnapshot, platformClone, removeSnapshot, verifyOriginals } = snap;

interface Page {
  n: number;
  text: string;
  ocr: boolean;
}
interface SnapshotFile {
  rel: string;
  snapshot: string;
  sha256: string;
  size: number;
}
type DocumentRow = Record<string, unknown>;

export type Computer = 'mac' | 'windows';

export const TYPES: Record<Computer, FileType[]> = {
  mac: ['pages', 'numbers', 'keynote', 'word', 'excel', 'powerpoint', 'pdf'],
  windows: ['word', 'excel', 'powerpoint', 'pdf'],
};

/** The engine's own clone step and PDF reader. A test swaps them for portable ones. */
export interface Engine {
  clone?: (source: string, destination: string) => Promise<void>;
  extract: (file: string) => Promise<Page[]>;
}

interface Run {
  files: SnapshotFile[];
  /** Paths the dry run names as not scanned. */
  unscanned: Set<string>;
  /** Pages, Numbers and Keynote packages the guard lists rather than syncing. */
  packages: Set<string>;
  /** Each read file's index parts, joined. */
  text: Map<string, string>;
}

class EngineFailed extends Error {}

/**
 * The dry run sync.ts makes before --apply, against `rows` as the room would hold them, in its order: walk, snapshot
 * (copied only as needed where a clone isn't free), plan, fill, the SSN guard's reads (guardTexts), re-hash. It then
 * records what the guard cleared, as an approved --apply does, so the next run reads only what changed.
 */
async function dryRun(root: string, cache: string, rows: DocumentRow[], engine: Engine, id: string): Promise<Run> {
  const clone = engine.clone ?? platformClone;
  const walk = await guardWalk(root);
  const snapshot = await createSnapshot(walk.files, cache, id, clone, !CLONES_ARE_FREE);
  try {
    const plan = diffSync(snapshot.files, rows, undefined, undefined, walk.iworkPackages);
    await fillSnapshot(snapshot, filesToRead(plan, []), clone);
    const sent = piiTargets(plan, []);
    const targets = [...sent, ...unreadTargets(plan, sent, await loadCleared(cache, 'lab', null))];
    await fillSnapshot(snapshot, targets.map((doc: { file: string }) => doc.file), clone);
    const pages = new Map<string, Page[]>();
    const keep = (file: string) => (read: Page[]) => (pages.set(file, read), read);
    const extractPdf = cachedExtractor(engine.extract, cache);
    const scan = await scanForPii(targets, {
      extractPdf: (file: string, sha256: string) => extractPdf(file, sha256).then(keep(file)),
      readText: (file: string, name: string) => directTextPages(file, name).then(keep(file)),
      known: null,
    });
    await verifyOriginals(snapshot);
    await saveCleared(cache, 'lab', null, plan);
    const text = new Map<string, string>();
    for (const file of snapshot.files as SnapshotFile[]) {
      const read = pages.get(file.snapshot);
      if (read) text.set(file.rel, buildParts(file.rel, read).map((part: { body: string }) => part.body).join('\n'));
    }
    const unscanned = new Set<string>(scan.unscanned.map((doc: { path: string }) => doc.path));
    return { files: snapshot.files, unscanned, packages: new Set(walk.iworkPackages), text };
  } finally {
    await removeSnapshot(snapshot);
  }
}

/** The room's rows after a run: every file it saw, live and unchanged. */
const rowsOf = (files: SnapshotFile[]): DocumentRow[] =>
  files.map((f) => ({ id: f.rel, path: f.rel, sha256: f.sha256, size: f.size, kind: kindOf(f.rel).kind, pages: null, r2_key: f.rel, source: 'mirror' }));

/**
 * `root` itself and every entry under it, dotfiles and package insides too: its kind, mode, size, modified and changed times, and
 * SHA-256. The changed time moves on a chmod, an owner change or an extended attribute written, which leave the rest alone.
 * A folder's modified time moves when a name in it is added or removed, so a file written and removed again shows.
 */
export async function fingerprint(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const entries = (await readdir(root, { recursive: true, withFileTypes: true })).map((e) => path.join(e.parentPath, e.name));
  for (const abs of [root, ...entries]) {
    const info = await lstat(abs);
    const sha = info.isFile() ? createHash('sha256').update(await readFile(abs)).digest('hex') : '';
    out.set(path.relative(root, abs).split(path.sep).join('/'), `${info.isFile() ? 'file' : info.isDirectory() ? 'dir' : 'other'} ${info.mode} ${info.size} ${info.mtimeMs} ${info.ctimeMs} ${sha}`);
  }
  return out;
}

export const sameTree = (a: Map<string, string>, b: Map<string, string>) => a.size === b.size && [...a].every(([rel, print]) => b.get(rel) === print);

async function put(dir: string, rel: string, bytes: Buffer): Promise<void> {
  const abs = path.join(dir, ...rel.split('/'));
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
}

const found = (run: Run, rel: string, words: string[]) => words.length > 0 && words.every((word) => run.text.get(rel)?.includes(word));
const shown = (run: Run, p: Planted) => run.unscanned.has(p.rel) || run.packages.has(p.rel) || found(run, p.rel, p.words);
const percent = (passes: boolean[]) => Math.round((1000 * passes.filter(Boolean).length) / passes.length) / 10;

export interface Options {
  /** Each of the four recordings; real runs use 50 MB. */
  recordingBytes?: number;
  sourceUrl?: string | null;
}

export async function collect(computer: Computer, engine: Engine, options: Options = {}): Promise<MetricRecord[]> {
  const work = await mkdtemp(path.join(tmpdir(), 'qs-sync-'));
  const root = path.join(work, 'Company');
  const cache = path.join(work, 'cache');
  const all = samples();
  const broken = planted(computer);
  const loose = broken.filter((p) => p.bytes);
  /** One entry per sample and per planted file: read, or for a file the engine can't read, named. */
  const handled: boolean[] = [];
  const seconds: number[] = [];
  /** Runs that finished, which is what the gate's minimum counts. */
  let runs = 0;
  let started = 0;
  let unchanged = true;
  let failed = false;

  /** One fingerprinted dry run; the clock covers the engine only. */
  const run = async (dir: string, rows: DocumentRow[]) => {
    const before = await fingerprint(dir);
    const start = performance.now();
    try {
      const result = await dryRun(dir, cache, rows, engine, `run-${started++}`);
      runs += 1;
      return { result, seconds: (performance.now() - start) / 1000 };
    } catch (error) {
      throw new EngineFailed(error instanceof Error ? error.message : 'engine failed');
    } finally {
      if (!sameTree(before, await fingerprint(dir))) unchanged = false;
    }
  };

  try {
    for (const [rel, bytes] of Object.entries({ ...filler(options.recordingBytes ?? 50 * 1024 * 1024), ...CLUTTER })) await put(root, rel, bytes);
    for (const p of loose) await put(root, p.rel, p.bytes as Buffer);
    try {
      let last = (await run(root, [])).result;
      for (const p of loose) handled.push(shown(last, p));
      for (const type of TYPES[computer]) {
        for (const sample of all[type] ?? []) {
          const rows = rowsOf(last.files);
          await put(root, sample.rel, sample.bytes);
          const timed = await run(root, rows);
          last = timed.result;
          const ok = found(last, sample.rel, sample.words);
          handled.push(ok);
          if (ok) seconds.push(timed.seconds);
        }
      }
      for (const p of broken.filter((b) => b.entries)) {
        // A package in a folder of its own: a stopped run counts against `shown` only, never the gate.
        const dir = path.join(work, 'Package');
        for (const [rel, bytes] of Object.entries(p.entries ?? {})) await put(dir, `${p.rel}/${rel}`, bytes);
        await put(dir, 'Notes.md', Buffer.from('# Notes\n'));
        const before = await fingerprint(dir);
        handled.push(await dryRun(dir, cache, [], engine, 'package').then((r) => shown(r, p), () => false));
        if (!sameTree(before, await fingerprint(dir))) unchanged = false;
      }
    } catch (error) {
      if (!(error instanceof EngineFailed)) throw error;
      // Safe to log: the folder holds invented files only.
      console.error(`The sync engine stopped: ${error.message}`);
      failed = true;
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  const at = new Date().toISOString();
  const record = (id: string, value: number | null, sampleSize: number): MetricRecord =>
    value === null
      ? { id: `${computer}_${id}`, page: 'sync', value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null }
      : { id: `${computer}_${id}`, page: 'sync', value, status: 'ok', stage: 'lab', measured_at: at, source_url: options.sourceUrl ?? null, sample_size: sampleSize };
  // A type with no invented samples yet (iWork until #66) counts as two files not read, so the reading can't reach goal without it.
  const unsampled = TYPES[computer].filter((type) => !all[type]?.length).flatMap(() => [false, false]);
  const slots = TYPES[computer].reduce((n, type) => n + (all[type]?.length || 2), 0) + broken.length;
  return [
    record('files_read', failed ? 0 : percent([...handled, ...unsampled]), slots),
    // Fail means a fingerprint changed. A stopped run doesn't count, so the runs fall short of the minimum, which scores 0 too.
    // With no run finished there is nothing to judge: missing, never a pass.
    record('folder_unchanged', runs === 0 ? null : unchanged ? 1 : 0, runs),
    record('change_to_index_text_max', failed || seconds.length === 0 ? null : Math.round(Math.max(...seconds) * 100) / 100, seconds.length),
  ];
}

if (import.meta.main) {
  const { out } = parseArgs({ options: { out: { type: 'string' } } }).values;
  const computer = ({ darwin: 'mac', win32: 'windows' } as Record<string, Computer>)[process.platform];
  if (!out || !computer) throw new Error('usage: collect.ts --out <file>, on macOS or Windows');
  const env = process.env;
  const sourceUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null;
  const records = await collect(computer, { extract: platformExtractor() }, { sourceUrl });
  // After every dry run, so it times the whole lane. The lane is named for its computer, so this is the job it reads.
  records.push({ ...(await laneRecord('sync')), id: `${computer}_lane_minutes` });
  await writeFile(out, `${JSON.stringify(records, null, 1)}\n`);
}
