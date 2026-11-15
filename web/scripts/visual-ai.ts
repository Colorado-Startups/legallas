// SPDX-License-Identifier: Apache-2.0
// The local half of the visuals' AI side files (worker/side-files.ts has the key format). `npm run visuals` renders each
// page (visual-render.ts) and keeps its text in <cacheDir>/visual-ai/<html sha256>.json (mode 600), with the PNG next
// to it when one fits. `npm run sync` then plans the side files from that cache: each live visual's text, and its
// PNG, go to legallas-files at meta/visual-ai/<html sha256>.{txt,png}; side files of visuals that are no longer live
// are deleted. A local manifest (<cacheDir>/visual-ai.<target>.json) records what was uploaded, by content hash, and
// the plan's puts and deletes are part of the sync's plan fingerprint, so --expect covers them.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isHiddenName } from '../worker/files-catalog.ts';
import { isVisualAiKey, sidePngFits, visualAiKey } from '../worker/side-files.ts';
import { kindOf, type SyncPlan } from './diff.ts';
import { isAgentFile, VISUAL_RENDER_VERSION, type VisualTextSource } from './extract.ts';
import { buildParts, PiiInPart, PART_MAX_BYTES, type PartGuard } from './indexparts.ts';
import { mapLimit } from './pool.ts';
import type { SnapshotFile } from './snapshot.ts';
import { FILES_BUCKET, r2Concurrency, wrangler, type Target, type WranglerRun } from './wrangler.ts';

const SHA256 = /^[0-9a-f]{64}$/;

/** One rendered visual in the cache. A PNG, when `png` is true, sits next to it as <sha256>.png. */
export interface VisualEntry {
  version: number;
  sha256: string;
  text: string;
  png: boolean;
}

function entryPath(cacheDir: string, sha256: string, ext: 'json' | 'png'): string {
  if (!SHA256.test(sha256)) throw new Error('visual cache: bad sha256');
  return path.join(cacheDir, 'visual-ai', `${sha256}.${ext}`);
}

/** The cached text of a visual by its HTML sha256, or null when there is none from the current renderer. */
export async function readVisualEntry(cacheDir: string, sha256: string): Promise<VisualEntry | null> {
  if (!SHA256.test(sha256)) return null;
  const raw = await readFile(entryPath(cacheDir, sha256, 'json'), 'utf8').catch(() => null);
  if (raw === null) return null;
  try {
    const entry = JSON.parse(raw) as Partial<VisualEntry>;
    if (entry.version !== VISUAL_RENDER_VERSION || entry.sha256 !== sha256 || typeof entry.text !== 'string') return null;
    return { version: entry.version, sha256, text: entry.text, png: entry.png === true };
  } catch {
    return null;
  }
}

/** Keeps a rendered visual's text, and its PNG when one fits, in the cache (files mode 600). */
export async function writeVisualEntry(cacheDir: string, sha256: string, text: string, png: Uint8Array | null): Promise<void> {
  await mkdir(path.join(cacheDir, 'visual-ai'), { recursive: true, mode: 0o700 });
  const keep = png !== null && sidePngFits(png);
  if (keep) await writeFile(entryPath(cacheDir, sha256, 'png'), png, { mode: 0o600 });
  const entry: VisualEntry = { version: VISUAL_RENDER_VERSION, sha256, text, png: keep };
  await writeFile(entryPath(cacheDir, sha256, 'json'), JSON.stringify(entry), { mode: 0o600 });
}

/** extract.ts's reader of a visual's text, from this cache. */
export function visualTextSource(cacheDir: string): VisualTextSource {
  return async (sha256) => (await readVisualEntry(cacheDir, sha256))?.text ?? null;
}

/** R2 key of an uploaded side file to the sha256 of the bytes uploaded. */
export type SideManifest = Record<string, string>;

export function sideManifestPath(cacheDir: string, target: Target): string {
  return path.join(cacheDir, `visual-ai.${target}.json`);
}

export async function loadSideManifest(cacheDir: string, target: Target): Promise<SideManifest> {
  const text = await readFile(sideManifestPath(cacheDir, target), 'utf8').catch(() => null);
  if (text === null) return {};
  const parsed = JSON.parse(text) as SideManifest;
  return Object.fromEntries(Object.entries(parsed).filter(([key, hash]) => isVisualAiKey(key) && typeof hash === 'string'));
}

export async function saveSideManifest(cacheDir: string, target: Target, manifest: SideManifest): Promise<void> {
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  await writeFile(sideManifestPath(cacheDir, target), JSON.stringify(manifest, null, 1), { mode: 0o600 });
}

export interface SidePut {
  key: string;
  /** sha256 of the bytes uploaded. */
  hash: string;
  contentType: string;
  /** The text to upload, or the cached PNG file. */
  body: { text: string } | { file: string };
}

export interface SidePlan {
  puts: SidePut[];
  deletes: string[];
  /** Live visuals counted once per distinct HTML. */
  visuals: number;
  /** Live visuals with no text from the current renderer in the cache: run npm run visuals -- --ai. */
  missing: number;
  /**
   * HTML sha256s of live visuals whose rendered text still holds a Social Security number: never uploaded, and the
   * index refuses the text too, so sync refuses --apply until the page is redacted (or its raw-HTML flag acknowledged).
   */
  heldBack: string[];
}

const hashOf = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The HTML sha256 of every live visual the index would read (indexjob.ts's rules: no agent or room data files). */
export function liveVisualShas(plan: SyncPlan<SnapshotFile>): string[] {
  const files = [...plan.adds, ...plan.changes, ...plan.renames, ...plan.unchanged].map((op) => op.file);
  const shas = files
    .filter((file) => kindOf(file.rel).kind === 'visual' && !isAgentFile(file.rel) && !isHiddenName(path.posix.basename(file.rel)))
    .map((file) => file.sha256);
  return [...new Set(shas)].sort();
}

/** The text holds an SSN by the index's own last check (indexparts.ts), so it is never uploaded. */
function holdsSsn(text: string, guard: PartGuard): boolean {
  try {
    buildParts('visual-ai', [{ n: 1, text }], PART_MAX_BYTES, guard);
    return false;
  } catch (error) {
    if (error instanceof PiiInPart) return true;
    throw error;
  }
}

/**
 * What a run uploads and deletes. A live visual with cached text gets its text (and PNG) uploaded when the uploaded
 * bytes differ; a side file whose visual is no longer live is deleted. A live visual missing from the cache keeps
 * whatever was uploaded before (a cleared cache never deletes side files). Only a text this run uploads is checked for
 * an SSN, with `pii` (the SSN guard's known hashes and the sha256s acknowledged with --allow-pii, as for index parts):
 * a text already uploaded passed that check or was acknowledged in its own run, and an acknowledgement covers only the
 * run that sends the page.
 */
export async function planSideFiles(
  shas: readonly string[],
  cacheDir: string,
  manifest: SideManifest,
  pii: { known: PartGuard['known']; acknowledged: ReadonlySet<string> } = { known: null, acknowledged: new Set() },
): Promise<SidePlan> {
  const plan: SidePlan = { puts: [], deletes: [], visuals: shas.length, missing: 0, heldBack: [] };
  const keep = new Set<string>();
  for (const sha of shas) {
    const entry = await readVisualEntry(cacheDir, sha);
    if (!entry) {
      plan.missing += 1;
      for (const ext of ['txt', 'png'] as const) keep.add(visualAiKey(sha, ext));
      continue;
    }
    const text: SidePut = { key: visualAiKey(sha, 'txt'), hash: hashOf(entry.text), contentType: 'text/plain; charset=utf-8', body: { text: entry.text } };
    const uploading = manifest[text.key] !== text.hash;
    if (uploading && holdsSsn(entry.text, { known: pii.known ?? null, acknowledged: pii.acknowledged.has(sha) })) {
      plan.heldBack.push(sha);
      continue;
    }
    const wanted: SidePut[] = [text];
    const png = entry.png ? await readFile(entryPath(cacheDir, sha, 'png')).catch(() => null) : null;
    if (png) wanted.push({ key: visualAiKey(sha, 'png'), hash: hashOf(png), contentType: 'image/png', body: { file: entryPath(cacheDir, sha, 'png') } });
    for (const put of wanted) {
      keep.add(put.key);
      if (manifest[put.key] !== put.hash) plan.puts.push(put);
    }
  }
  plan.deletes = Object.keys(manifest).filter((key) => !keep.has(key)).sort();
  plan.puts.sort((a, b) => (a.key < b.key ? -1 : 1));
  return plan;
}

/** Plan fingerprint entries (report.ts planFingerprint `extra`): every put with its content hash, every delete. */
export function sideFingerprintEntries(plan: SidePlan): string[] {
  return [...plan.puts.map((put) => `visual-ai\0put\0${put.key}\0${put.hash}`), ...plan.deletes.map((key) => `visual-ai\0delete\0${key}`)];
}

/** The dry run's line about side files: counts only. */
export function formatSidePlan(plan: SidePlan): string[] {
  const lines = [
    `  Visual text: ${plan.visuals} visuals; ${plan.puts.length} side files to upload, ${plan.deletes.length} to delete`,
  ];
  if (plan.missing > 0) lines.push(`  Visuals with no rendered text yet: ${plan.missing} (run npm run visuals -- --ai <folder>; they are indexed once rendered)`);
  if (plan.heldBack.length > 0) {
    lines.push(`  Visual texts held back by the SSN check: ${plan.heldBack.length} (--apply refuses until those pages are redacted):`);
    for (const sha of plan.heldBack) lines.push(`    ${sha}`);
  }
  return lines;
}

/** Why --apply must stop, or null: a rendered text that still holds an SSN would stop the index mid-apply. */
export function sideRefusal(plan: SidePlan): string | null {
  return plan.heldBack.length === 0
    ? null
    : `${plan.heldBack.length} visual pages show a Social Security number once rendered (sha256s above). Redact them, run npm run visuals again, and dry-run sync again. Nothing was changed.`;
}

/** Writes and deletes side files: legallas-files, meta/visual-ai/ keys only. */
export interface SideFileStore {
  put(key: string, file: string, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

function assertSideKey(key: string): string {
  if (!isVisualAiKey(key)) throw new Error('Refusing a side-file key that sync did not generate');
  return key;
}

/** wrangler arguments for one side-file write or delete. The bucket is fixed here, and the key must be a side file's. */
export function sideFileArgs(target: Target, action: 'put' | 'delete', key: string, file = '', contentType = ''): string[] {
  if (target !== 'local' && target !== 'remote') throw new Error('Refusing an unknown wrangler target');
  const object = `${FILES_BUCKET}/${assertSideKey(key)}`;
  return action === 'put'
    ? ['r2', 'object', 'put', object, '--file', file, '--content-type', contentType, `--${target}`]
    : ['r2', 'object', 'delete', object, `--${target}`];
}

/** The side-file store sync uses: `npx wrangler r2 object put|delete`. `run` is injectable for tests. */
export function cliSideFiles(target: Target, run: WranglerRun = wrangler): SideFileStore {
  return {
    async put(key, file, contentType) {
      await run(sideFileArgs(target, 'put', key, file, contentType));
    },
    async delete(key) {
      await run(sideFileArgs(target, 'delete', key));
    },
  };
}

/**
 * Applies a side-file plan after the index parts (apply.ts step 5): puts, then deletes, updating `manifest` as each
 * succeeds. Texts are written to <workDir>/visual-ai/ first (removed with the snapshot). A failure is counted, logged
 * without a key and retried next run. Returns the number of objects written or removed.
 */
export async function applySideFiles(plan: SidePlan, store: SideFileStore, manifest: SideManifest, target: Target, workDir: string, log: (line: string) => void): Promise<number> {
  const dir = path.join(workDir, 'visual-ai');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let done = 0;
  let failures = 0;
  await mapLimit(plan.puts, r2Concurrency(target), async (put) => {
    try {
      let file: string;
      if ('text' in put.body) {
        file = path.join(dir, path.posix.basename(put.key));
        await writeFile(file, put.body.text, { mode: 0o600 });
      } else file = put.body.file;
      await store.put(put.key, file, put.contentType);
      manifest[put.key] = put.hash;
      done += 1;
    } catch {
      failures += 1;
    }
  });
  await mapLimit(plan.deletes, r2Concurrency(target), async (key) => {
    try {
      await store.delete(key);
      delete manifest[key];
      done += 1;
    } catch {
      failures += 1;
    }
  });
  if (failures > 0) log(`  warning: ${failures} visual side-file operations failed; they will be retried next run`);
  return done;
}
