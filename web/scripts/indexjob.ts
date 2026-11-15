// SPDX-License-Identifier: Apache-2.0
// Which documents need (re)indexing, building their parts locally, and keeping legallas-index in step.
// A local manifest (<cacheDir>/index-manifest.<target>.json, never committed) records the sha256 and part
// count indexed for each document id, for extracted documents (PDFs, images) the EXTRACTOR_VERSION that
// produced the text, and for rendered direct text (Form D XML, email, office documents) its renderer's version
// (renderVersion), and for text indexed as it is the reader's (PLAIN_TEXT_VERSION). A document whose manifest entry is
// missing or stale, or whose text came from an older extractor, renderer or reader, is indexed again, so a skipped or failed indexing step (for example before the
// extractor exists) heals on the next run and extractor and renderer improvements reach the index. An HTML visual is
// indexed from its rendered text (scripts/visual-ai.ts, decision D8); one that has not been rendered yet is skipped
// and retried, like a PDF before the extractor exists.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { kindOf, type DocumentRow, type Kind, type SyncPlan } from './diff.ts';
import { EXTRACTOR_VERSION, ExtractorUnavailable, indexSource, isAgentFile, isDraft, isPrivilegedOffice, PLAIN_TEXT_VERSION, renderVersion, VisualTextMissing, type ExtractedPage } from './extract.ts';
import { isHiddenName } from '../worker/files-catalog.ts';
import { buildParts, fallbackPartCount, PART_MAX_BYTES, partKey } from './indexparts.ts';
import type { KnownMatcher } from './pii.ts';
import { mapLimit } from './pool.ts';
import type { SnapshotFile } from './snapshot.ts';
import { INDEX_BUCKET, r2Concurrency, type Target, type Wrangler } from './wrangler.ts';

export type IndexManifest = Record<string, { sha256: string; parts: number; extractor?: number; render?: number; text?: number }>;

export interface IndexJob {
  id: string;
  kind: Kind;
  sha256: string;
  /** The snapshot clone to read (an opaque name). */
  file: string;
  /** The document's file name, for readers that need it (a Form D's accession number). */
  name: string;
  /** Parts that may exist from an earlier version and must go if the new text has fewer. */
  staleParts: number;
  /**
   * Same file, older extractor: the indexed text still matches the file, so if the new text cannot be built
   * this run the old parts and manifest entry stay (and the job is retried next run).
   */
  refresh?: boolean;
  /**
   * The text in the index no longer matches the file, so it leaves search if the new text can't be written. Not set when
   * this computer simply has no record of a document, as a new laptop has none for any: that text is still good. A laptop
   * whose record is behind may clear text another one refreshed, and missing is better than wrong in a legal room.
   */
  stale?: boolean;
}

export interface IndexDrop {
  id: string;
  parts: number;
}

export interface BuiltIndex {
  /** Local part files per document id, in part order. */
  parts: Map<string, string[]>;
  jobs: Map<string, IndexJob>;
  /** PDF page counts for documents.pages (PDFs only, as the schema says). */
  pages: Map<string, number>;
  skipped: number;
}

const EXTRACT_CONCURRENCY = 2;

export function manifestPath(cacheDir: string, target: Target): string {
  return path.join(cacheDir, `index-manifest.${target}.json`);
}

export async function loadManifest(cacheDir: string, target: Target): Promise<IndexManifest> {
  const text = await readFile(manifestPath(cacheDir, target), 'utf8').catch(() => null);
  return text ? (JSON.parse(text) as IndexManifest) : {};
}

/**
 * This computer's record, with the room's where the room knows more: a document this computer has no record of, such as
 * on a second computer's first sync (card 8.1), and text deleted since, which the room marks with an empty sha so it is
 * written again (#279). Elsewhere this computer's own record stands, so a run that failed here is still retried.
 */
export function withRoomRecord(local: IndexManifest, room: IndexManifest): IndexManifest {
  const merged = { ...local };
  for (const [id, entry] of Object.entries(room)) if (!merged[id] || entry.sha256 === '') merged[id] = entry;
  return merged;
}

/**
 * loadManifest, joined with the room's record when the sync goes through the room. `room` is that record, absent when
 * the room keeps none: indexWork then estimates parts no record knows.
 */
export async function loadManifestFor(w: Wrangler, cacheDir: string, target: Target): Promise<{ manifest: IndexManifest; room?: IndexManifest }> {
  const local = await loadManifest(cacheDir, target);
  if (!w.indexRecord) return { manifest: local };
  const room = await w.indexRecord();
  return { manifest: withRoomRecord(local, room), room };
}

export async function saveManifest(cacheDir: string, target: Target, manifest: IndexManifest): Promise<void> {
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  await writeFile(manifestPath(cacheDir, target), JSON.stringify(manifest, null, 1), { mode: 0o600 });
}

export { DRAFTS_FOLDER, isDraft } from './extract.ts';

/**
 * Documents to (re)index and documents whose parts must be deleted. Pure. With the room's record (`roomRecord`, #802), a
 * row neither record knows has no text, so it deletes nothing (#232). Without one, its size estimates its parts.
 */
export function indexWork(plan: SyncPlan<SnapshotFile>, manifest: IndexManifest, roomRecord?: IndexManifest): { jobs: IndexJob[]; drops: IndexDrop[] } {
  const estimate = (row: DocumentRow) =>
    !roomRecord && indexSource(row.kind as Kind, row.path) && !isPrivilegedOffice(row.path) && !isDraft(row.path) ? fallbackPartCount(row.size) : 0;
  const oldParts = (row: DocumentRow | null) => (!row ? 0 : (manifest[row.id]?.parts ?? roomRecord?.[row.id]?.parts ?? estimate(row)));
  const live = [
    ...plan.adds.map((op) => ({ id: op.id, kind: op.kind, file: op.file, old: null })),
    ...plan.changes.map((op) => ({ id: op.id, kind: op.kind, file: op.file, old: op.old })),
    ...plan.renames.map((op) => ({ id: op.id, kind: op.kind, file: op.file, old: null })),
    ...plan.unchanged.map((doc) => ({ id: doc.id, kind: kindOf(doc.file.rel).kind, file: doc.file, old: null })),
  ];
  const jobs: IndexJob[] = [];
  const liveIds = new Set([...live.map((doc) => doc.id), ...plan.held.map((row) => row.id)]);
  const drops: IndexDrop[] = plan.removals.map((row) => ({ id: row.id, parts: oldParts(row) }));
  // Manifest entries for documents that are no longer live: removals from this run or an earlier run
  // whose deletes failed. Deleting a missing key is harmless, so these are simply retried.
  const dropped = new Set(drops.map((drop) => drop.id));
  for (const [id, entry] of Object.entries(manifest)) {
    if (!liveIds.has(id) && !dropped.has(id)) drops.push({ id, parts: entry.parts });
  }
  for (const doc of live) {
    const known = manifest[doc.id];
    // Agent instruction files, room data files (isHiddenName, decision R6) and office files under a privileged
    // segment are never indexed; any parts they already have are dropped.
    const rel = doc.file.rel;
    const source = isAgentFile(rel) || isHiddenName(path.basename(rel)) || isPrivilegedOffice(rel) || isDraft(rel) ? null : indexSource(doc.kind, rel);
    if (!source) {
      if (known && known.parts > 0) drops.push({ id: doc.id, parts: known.parts });
      continue;
    }
    const name = path.posix.basename(doc.file.rel.normalize('NFC'));
    const sameFile = known?.sha256 === doc.file.sha256;
    const render = renderVersion(name);
    const sameText = source === 'extractor' ? known?.extractor === EXTRACTOR_VERSION : render === null ? known?.text === PLAIN_TEXT_VERSION : known?.render === render;
    if (sameFile && sameText) continue;
    const staleParts = known?.parts ?? oldParts(doc.old);
    jobs.push({ id: doc.id, kind: doc.kind, sha256: doc.file.sha256, file: doc.file.snapshot, name, staleParts, ...(sameFile ? { refresh: true } : {}), ...((known ? !sameFile : doc.old) ? { stale: true } : {}) });
  }
  return { jobs, drops: drops.filter((drop) => drop.parts > 0) };
}

export interface BuildDeps {
  extractPdf: (file: string, sha256: string) => Promise<ExtractedPage[]>;
  readText: (file: string, name: string) => Promise<ExtractedPage[]>;
  workDir: string;
  log: (line: string) => void;
  /** The SSN guard's known hashes and the sha256s acknowledged with --allow-pii, for the last check (indexparts.ts). */
  pii?: { known: KnownMatcher | null; acknowledged: ReadonlySet<string> };
}

/**
 * Extracts text and writes part files under <workDir>/parts/. Failures skip the document (retried next run), except
 * the index's last check (indexparts.ts PiiInPart): text that still holds an SSN means the file itself does, past the
 * sync's guard, so it rejects and the apply stops before D1 is written (apply.ts removes this run's uploads).
 */
export async function buildIndex(jobs: readonly IndexJob[], deps: BuildDeps): Promise<BuiltIndex> {
  const built: BuiltIndex = { parts: new Map(), jobs: new Map(), pages: new Map(), skipped: 0 };
  const dir = path.join(deps.workDir, 'parts');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let unavailable: string | null = null;
  let unrendered = 0;
  await mapLimit(jobs, EXTRACT_CONCURRENCY, async (job) => {
    const viaExtractor = indexSource(job.kind, job.file) === 'extractor';
    if (viaExtractor && unavailable) {
      built.skipped += 1;
      return;
    }
    let pages: ExtractedPage[];
    try {
      pages = viaExtractor ? await deps.extractPdf(job.file, job.sha256) : await deps.readText(job.file, job.name);
    } catch (error) {
      built.skipped += 1;
      if (error instanceof ExtractorUnavailable) unavailable ??= error.message;
      else if (error instanceof VisualTextMissing) unrendered += 1;
      else deps.log(`  warning: could not extract text for document ${job.id}; it will be retried next run`);
      return;
    }
    const acknowledged = deps.pii?.acknowledged.has(job.sha256) ?? false;
    const parts = buildParts(job.id, pages, PART_MAX_BYTES, { known: deps.pii?.known ?? null, acknowledged });
    const files: string[] = [];
    for (const [index, part] of parts.entries()) {
      const file = path.join(dir, `${job.id}.p${index + 1}.md`);
      await writeFile(file, part.body, { mode: 0o600 });
      files.push(file);
    }
    built.parts.set(job.id, files);
    built.jobs.set(job.id, job);
    if (job.kind === 'pdf') built.pages.set(job.id, pages.reduce((max, page) => Math.max(max, page.n), 0));
  });
  if (unavailable) deps.log(`  warning: ${unavailable}. PDF text was not indexed; sync will index it once the extractor is built.`);
  if (unrendered > 0) deps.log(`  ${unrendered} visuals have no rendered text yet: run npm run visuals -- --ai <folder>, and a later sync indexes them.`);
  return built;
}

function range(from: number, to: number): number[] {
  return to < from ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/**
 * Uploads built parts and deletes stale ones, deletes the parts of dropped documents and of documents
 * whose new text could not be built (old text must not outlive a change), and updates the manifest.
 * Returns the number of index objects touched.
 */
export async function syncIndex(
  w: Wrangler,
  jobs: readonly IndexJob[],
  built: BuiltIndex,
  drops: readonly IndexDrop[],
  manifest: IndexManifest,
  log: (line: string) => void,
): Promise<number> {
  let touched = 0;
  let failures = 0;
  const attempt = async (work: () => Promise<void>) => {
    try {
      await work();
      touched += 1;
      return true;
    } catch {
      failures += 1;
      return false;
    }
  };
  const deleteParts = async (id: string, from: number, to: number) => {
    const results = [];
    for (const n of range(from, to)) results.push(await attempt(() => w.r2Delete(INDEX_BUCKET, partKey(id, n))));
    return results.every(Boolean);
  };
  await mapLimit(jobs, r2Concurrency(w.target), async (job) => {
    const files = built.parts.get(job.id);
    if (!files) {
      // Not built this run: clear any old text now and index from scratch later. A refresh keeps its old text,
      // which still matches the file, and its stale manifest entry, so it is retried next run.
      if (job.staleParts === 0 || job.refresh) return;
      if (await deleteParts(job.id, 1, job.staleParts)) delete manifest[job.id];
      else manifest[job.id] = { sha256: '', parts: job.staleParts };
      return;
    }
    const render = renderVersion(job.name);
    const version = indexSource(job.kind, job.file) === 'extractor' ? { extractor: EXTRACTOR_VERSION } : render !== null ? { render } : { text: PLAIN_TEXT_VERSION };
    let ok = true;
    for (const [index, file] of files.entries()) {
      ok = (await attempt(() => w.r2Put(INDEX_BUCKET, partKey(job.id, index + 1), file, 'text/markdown; charset=utf-8', { sha256: job.sha256, stamp: version }))) && ok;
    }
    if (!ok) {
      // Not written, as in a month with search full. Text that still matches the file stays, with this computer's record as
      // it was, so the job comes back next run. Text that doesn't leaves search until the new text is written.
      if (!job.stale) return;
      const parts = Math.max(files.length, job.staleParts);
      if (await deleteParts(job.id, 1, parts)) delete manifest[job.id];
      else manifest[job.id] = { sha256: '', parts };
      return;
    }
    ok = (await deleteParts(job.id, files.length + 1, job.staleParts)) && ok;
    // On failure an empty sha forces a re-index next run, and the part count bounds what to clean up.
    manifest[job.id] = ok ? { sha256: job.sha256, parts: files.length, ...version } : { sha256: '', parts: Math.max(files.length, job.staleParts) };
  });
  await mapLimit(drops, r2Concurrency(w.target), async (drop) => {
    if (await deleteParts(drop.id, 1, drop.parts)) delete manifest[drop.id];
    else manifest[drop.id] = { sha256: '', parts: drop.parts };
  });
  if (failures > 0) log(`  warning: ${failures} index object operations failed; they will be retried next run`);
  return touched;
}
