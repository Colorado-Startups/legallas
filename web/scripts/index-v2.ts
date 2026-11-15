// SPDX-License-Identifier: Apache-2.0
// Index v2 for a staging AI Search instance (W5 E4). Builds the page-bounded parts of scripts/indexparts-v2.ts for
// every live, indexable document from the local text (the sync's extracted-text cache for PDFs and images, the
// mirrored file itself for direct text), writes them under <cacheDir>/index-v2 (mode 700) and prints the upload
// plan and its fingerprint. Reads one `documents` SELECT from D1; writes nothing remote without --apply.
//
//   npm run index:v2                                  # build and plan (dry run)
//   npm run index:v2 -- --apply --expect <fingerprint> # upload to legallas-index-v2, then start an indexing job
//
// An apply writes only to the staging bucket INDEX_V2_BUCKET, never to legallas-index, and only the exact plan a
// dry run printed (the fingerprint covers every key and its sha256). Uploads go through `wrangler r2 bulk put`,
// in batches, and state/uploaded.json is saved after each one, so a failed apply resumes where it stopped.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isHiddenName } from '../worker/files-catalog.ts';
import { controlPrefixOf, DEFAULT_CONFIG_PATH, loadSyncConfig } from './config.ts';
import type { Kind } from './diff.ts';
import { directTextPages, EXTRACTOR_VERSION, indexSource, isAgentFile, isDraft, isPrivilegedOffice, parseExtractorOutput, VisualTextMissing } from './extract.ts';
import { buildPageParts, nineDigitScan, ssnShaped, type DocFacts, type IndexPartV2, type PageTextV2 } from './indexparts-v2.ts';
import { hasSsnForm, nineDigitRuns, type KnownMatcher } from './pii.ts';
import { wranglerTokens } from './law/replica.ts';
import { loadKnownHashes } from './pii-hash.ts';
import { cloudflareLease, fileChars, holdIngestion } from './spend-guard.ts';
import { accountId, cliWrangler, INDEX_BUCKET, wrangler, type WranglerRun } from './wrangler.ts';
import { visualTextSource } from './visual-ai.ts';
import { STORED_NAME } from '../worker/stored-name.ts';

/** The staging bucket and instance. Never the room's legallas-index / legallas. */
export const INDEX_V2_BUCKET = `${STORED_NAME}-index-v2`;
export const INDEX_V2_INSTANCE = `${STORED_NAME}-v2`;
const BATCH = 500;

export interface V2Row {
  id: string;
  path: string;
  folder: string;
  name: string;
  kind: string;
  sha256: string | null;
  control_seq: number | null;
}

export interface V2Plan {
  put: string[];
  remove: string[];
  unchanged: number;
  fingerprint: string;
}

const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

/** "DOE-000412", the room's control number (src/scripts/matter-api.ts formatControl), or null before numbering. */
export function controlOf(prefix: string, seq: number | null): string | null {
  return typeof seq === 'number' && Number.isInteger(seq) && seq > 0 ? `${prefix}-${String(seq).padStart(6, '0')}` : null;
}

/** Why a live document gets no v2 parts, or null when it is indexed. The same rules as sync's indexWork. */
export function skipReason(row: Pick<V2Row, 'path' | 'name' | 'kind'>): string | null {
  if (isAgentFile(row.path)) return 'agent file';
  if (isHiddenName(row.name)) return 'room data file';
  if (!indexSource(row.kind as Kind, row.path)) return 'not indexed (kind)';
  if (isPrivilegedOffice(row.path)) return 'privileged office file';
  if (isDraft(row.path)) return 'saved draft';
  return null;
}

/** What an apply does to move the staging bucket from `uploaded` to `built`, sorted so the fingerprint is stable. */
export function planV2(built: Record<string, string>, uploaded: Record<string, string>): V2Plan {
  const put = Object.keys(built)
    .filter((key) => uploaded[key] !== built[key])
    .sort();
  const remove = Object.keys(uploaded)
    .filter((key) => !(key in built))
    .sort();
  const lines = [`bucket ${INDEX_V2_BUCKET}`, ...put.map((key) => `put ${key} ${built[key]}`), ...remove.map((key) => `delete ${key}`)];
  return { put, remove, unchanged: Object.keys(built).length - put.length, fingerprint: sha256(lines.join('\n')).slice(0, 12) };
}

/** Keys an apply may write: v1-shaped index part keys only (text/<uuid-like id>.p<N>.md). */
export function assertV2Key(key: string): string {
  if (/^text\/[A-Za-z0-9_-]{1,64}\.p[1-9][0-9]{0,5}\.md$/.test(key)) return key;
  throw new Error('Refusing an R2 key the v2 build did not generate');
}

/** wrangler arguments for one batch upload to the staging bucket (remote only; the bucket is fixed here). */
export function bulkPutArgs(listFile: string): string[] {
  if ((INDEX_V2_BUCKET as string) === INDEX_BUCKET) throw new Error('Refusing to write the room index');
  return ['r2', 'bulk', 'put', INDEX_V2_BUCKET, '--filename', listFile, '--content-type', 'text/markdown; charset=utf-8', '--concurrency', '10', '--remote'];
}

export function deleteArgs(key: string): string[] {
  return ['r2', 'object', 'delete', `${INDEX_V2_BUCKET}/${assertV2Key(key)}`, '--remote'];
}

interface Sources {
  cacheDir: string;
  sourceRoot: string;
}

/**
 * A document's pages, or why it has none: the sync's extracted-text cache for PDFs and images (written by the
 * current extractor only), and the mirrored file itself for direct text (Markdown, CSV, text, email, Form D XML,
 * office documents), read the way sync reads it; a visual's rendered text from the sync cache (scripts/visual-ai.ts).
 * `changed` is set when the local file no longer matches D1.
 */
export async function pagesOf(row: V2Row, from: Sources): Promise<{ pages: PageTextV2[]; changed: boolean } | { skip: string }> {
  if (indexSource(row.kind as Kind, row.path) === 'extractor') {
    if (!row.sha256 || !/^[0-9a-f]{64}$/.test(row.sha256)) return { skip: 'no sha256' };
    const hit = await readFile(path.join(from.cacheDir, 'text', `${row.sha256}.json`), 'utf8').catch(() => null);
    if (hit === null) return { skip: 'no cached text' };
    const version = (JSON.parse(hit) as { version?: unknown }).version;
    if (version !== EXTRACTOR_VERSION) return { skip: 'cached text from another extractor version' };
    return { pages: parseExtractorOutput(hit), changed: false };
  }
  const file = path.join(from.sourceRoot, row.path);
  if (!path.resolve(file).startsWith(path.resolve(from.sourceRoot) + path.sep)) return { skip: 'path outside the source folder' };
  const bytes = await readFile(file).catch(() => null);
  if (bytes === null) return { skip: 'file missing locally' };
  let pages: PageTextV2[];
  try {
    pages = await directTextPages(file, row.name, visualTextSource(from.cacheDir));
  } catch (error) {
    if (error instanceof VisualTextMissing) return { skip: 'no rendered visual text' };
    throw error;
  }
  return { pages, changed: row.sha256 !== null && sha256(bytes) !== row.sha256 };
}

export interface V2Build {
  built: Record<string, string>;
  metadata: Record<string, Record<string, string>>;
  documents: number;
  changed: number;
  skipped: Record<string, number>;
  longest: number;
  /**
   * Documents whose text still holds a Social Security number (holdsSsn): none of their parts is written, and while
   * any is listed the build prints no plan, so nothing of it can be uploaded.
   */
  refused: string[];
  /** The three nine-digit forms over every part written, for the review before an upload (counts only). */
  scan: { dashed: number; spaced: number; plain: number };
}

/**
 * The index's last check, as for v1 (indexparts.ts): a printed SSN (pii.ts rule ssn-form, in any of its printed
 * forms) or nine digits whose hash is a known SSN (rule known-hash, `known` from legallas.config.json piiHashes), plus
 * the v2 builder's own ddd-dd-dddd rule (indexparts-v2.ts ssnShaped, which also counts ITIN areas). Nothing is
 * acknowledged here: a document the sync let through with --allow-pii still gets no v2 part.
 */
export function holdsSsn(text: string, known: KnownMatcher | null = null): boolean {
  if (ssnShaped(text) > 0 || hasSsnForm(text)) return true;
  return !!known && nineDigitRuns(text).some((run) => known.matchesSync(run.digits));
}

/** Builds every live document's parts into <out>/parts (wiped first). */
export async function buildV2(
  rows: readonly V2Row[],
  from: Sources,
  prefix: string,
  out: string,
  log: (line: string) => void,
  known: KnownMatcher | null = null,
): Promise<V2Build> {
  const dir = path.join(out, 'parts');
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, 'text'), { recursive: true, mode: 0o700 });
  const result: V2Build = { built: {}, metadata: {}, documents: 0, changed: 0, skipped: {}, longest: 0, refused: [], scan: { dashed: 0, spaced: 0, plain: 0 } };
  const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1);
  for (const row of [...rows].sort((a, b) => (a.control_seq ?? 0) - (b.control_seq ?? 0))) {
    const reason = skipReason(row);
    if (reason) {
      skip(reason);
      continue;
    }
    const got = await pagesOf(row, from).catch(() => ({ skip: 'text could not be read' }));
    if ('skip' in got) {
      skip(got.skip);
      continue;
    }
    const facts: DocFacts = { id: row.id, control: controlOf(prefix, row.control_seq), name: row.name, folder: row.folder, kind: row.kind };
    const parts: IndexPartV2[] = buildPageParts(facts, got.pages);
    if (parts.length === 0) {
      skip('no text');
      continue;
    }
    // A Social Security number never reaches a part file: the whole document waits for its redaction.
    if (got.pages.some((page) => holdsSsn(page.text, known)) || parts.some((part) => holdsSsn(part.body, known))) {
      result.refused.push(facts.control ?? row.id);
      continue;
    }
    result.documents += 1;
    if (got.changed) result.changed += 1;
    for (const part of parts) {
      await writeFile(path.join(dir, assertV2Key(part.key)), part.body, { mode: 0o600 });
      result.built[part.key] = sha256(part.body);
      result.metadata[part.key] = part.metadata;
      result.longest = Math.max(result.longest, part.body.length);
      const scan = nineDigitScan(part.body);
      for (const form of ['dashed', 'spaced', 'plain'] as const) result.scan[form] += scan[form];
    }
    if (result.documents % 100 === 0) log(`  ${result.documents} documents built`);
  }
  return result;
}

const uploadedPath = (out: string) => path.join(out, 'state', 'uploaded.json');

async function loadUploaded(out: string): Promise<Record<string, string>> {
  const text = await readFile(uploadedPath(out), 'utf8').catch(() => null);
  return text ? (JSON.parse(text) as Record<string, string>) : {};
}

async function saveUploaded(out: string, uploaded: Record<string, string>): Promise<void> {
  await mkdir(path.dirname(uploadedPath(out)), { recursive: true, mode: 0o700 });
  await writeFile(uploadedPath(out), JSON.stringify(uploaded, null, 1), { mode: 0o600 });
}

/** Uploads a plan in batches (state saved after each), deletes what the build no longer has, then indexes once. */
export async function applyV2(out: string, plan: V2Plan, built: Record<string, string>, run: WranglerRun, log: (line: string) => void): Promise<void> {
  const uploaded = await loadUploaded(out);
  const list = path.join(out, 'state', 'batch.json');
  for (let i = 0; i < plan.put.length; i += BATCH) {
    const batch = plan.put.slice(i, i + BATCH);
    await mkdir(path.dirname(list), { recursive: true, mode: 0o700 });
    await writeFile(list, JSON.stringify(batch.map((key) => ({ key: assertV2Key(key), file: path.join(out, 'parts', key) }))), { mode: 0o600 });
    await run(bulkPutArgs(list));
    for (const key of batch) uploaded[key] = built[key]!; // safe: plan keys come from built
    await saveUploaded(out, uploaded);
    log(`  ${Math.min(i + BATCH, plan.put.length)} of ${plan.put.length} parts uploaded`);
  }
  for (const key of plan.remove) {
    await run(deleteArgs(key));
    delete uploaded[key];
  }
  await saveUploaded(out, uploaded);
  if (plan.put.length || plan.remove.length) await run(['ai-search', 'jobs', 'create', INDEX_V2_INSTANCE]);
}

/**
 * The staging instance's sync state from `wrangler ai-search get --json`. legallas-v2 is a staging resource whose sync
 * is kept paused between runs; a paused instance would still ingest
 * what an apply uploads once someone resumes it, so --apply refuses while it is paused.
 */
export function instanceState(stdout: string): { paused: boolean; status: string } {
  const start = stdout.indexOf('{');
  const body = JSON.parse(start >= 0 ? stdout.slice(start) : 'null') as { result?: Record<string, unknown> } & Record<string, unknown>;
  const instance = (body?.result ?? body ?? {}) as { paused?: unknown; status?: unknown };
  const status = typeof instance.status === 'string' ? instance.status : 'unknown';
  return { paused: instance.paused === true || status.startsWith('paused'), status };
}

export function parseV2Args(argv: readonly string[]): { apply: boolean; expect: string | null; out: string | null } {
  const args = { apply: false, expect: null as string | null, out: null as string | null };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--expect' && value && /^[0-9a-f]{12}$/.test(value)) (args.expect = value), i++;
    else if (argv[i] === '--out' && value) (args.out = path.resolve(value)), i++;
    else throw new Error('usage: index:v2 [--out <dir>] [--apply --expect <fingerprint>]');
  }
  if (args.apply && !args.expect) throw new Error('--apply needs --expect <fingerprint> from a dry run');
  return args;
}

export const toRow = (r: Record<string, unknown>): V2Row => ({
  id: String(r.id),
  path: String(r.path),
  folder: String(r.folder ?? ''),
  name: String(r.name),
  kind: String(r.kind),
  sha256: typeof r.sha256 === 'string' ? r.sha256 : null,
  control_seq: typeof r.control_seq === 'number' ? r.control_seq : null,
});

async function main(): Promise<void> {
  const args = parseV2Args(process.argv.slice(2));
  const config = await loadSyncConfig();
  const prefix = controlPrefixOf(JSON.parse(await readFile(DEFAULT_CONFIG_PATH, 'utf8')));
  const out = args.out ?? path.join(config.cacheDir, 'index-v2');
  await mkdir(out, { recursive: true, mode: 0o700 });
  const rows = (await cliWrangler('remote').d1Query('SELECT id, path, folder, name, kind, sha256, control_seq FROM documents WHERE removed_at IS NULL')).map(toRow);
  console.log(`Building index v2 for ${rows.length} live documents into ${out}`);
  const known = await loadKnownHashes(DEFAULT_CONFIG_PATH);
  const build = await buildV2(rows, config, prefix, out, (line) => console.log(line), known);
  if (build.refused.length > 0) {
    await rm(path.join(out, 'parts'), { recursive: true, force: true });
    throw new Error(
      `${build.refused.length} documents still hold a Social Security number and were refused: ${build.refused.join(' ')}. ` +
        'No plan: redact them and sync first (the built parts were deleted).',
    );
  }
  console.log(`Nine-digit scan of the built parts: ${build.scan.dashed} in ddd-dd-dddd form, ${build.scan.spaced} as ddd dd dddd, ${build.scan.plain} as nine digits`);
  await writeFile(path.join(out, 'plan.json'), JSON.stringify({ built: build.built, metadata: build.metadata }), { mode: 0o600 });
  const plan = planV2(build.built, await loadUploaded(out));
  const bytes = Object.keys(build.built).length;
  console.log(`${build.documents} documents, ${bytes} parts (longest ${build.longest} characters), ${build.changed} direct-text files changed since the last sync`);
  console.log(`Not indexed: ${Object.entries(build.skipped).map(([why, n]) => `${n} ${why}`).join('; ') || 'none'}`);
  console.log(`Plan for ${INDEX_V2_BUCKET}: put ${plan.put.length}, delete ${plan.remove.length}, unchanged ${plan.unchanged}. Fingerprint ${plan.fingerprint}`);
  const state = instanceState(await wrangler(['ai-search', 'get', INDEX_V2_INSTANCE, '--json']));
  console.log(`${INDEX_V2_INSTANCE}: ${state.status}${state.paused ? ' (sync paused)' : ''}`);
  if (!args.apply) {
    console.log(`Dry run. To upload exactly this: npm run index:v2 -- --apply --expect ${plan.fingerprint}`);
    return;
  }
  if (args.expect !== plan.fingerprint) throw new Error(`The plan changed since the dry run (fingerprint ${plan.fingerprint}, expected ${args.expect}); review it again.`);
  if (state.paused) {
    throw new Error(
      `${INDEX_V2_INSTANCE} is paused. Nothing was uploaded. ` +
        `Resume it first, with the owner's OK: npx wrangler ai-search update ${INDEX_V2_INSTANCE} --paused=false`,
    );
  }
  // AI Search ingests what is uploaded: the parts' tokens are held against this month's budget first, or nothing goes.
  const lease = cloudflareLease(await accountId(), wranglerTokens(), 'index:v2 --apply');
  try {
    const tokens = await holdIngestion(lease, await fileChars(plan.put.map((key) => path.join(out, 'parts', key))));
    console.log(`Spend: holding about ${tokens.toLocaleString('en-US')} AI Search ingestion tokens for this upload.`);
  } finally {
    await lease.close();
  }
  await applyV2(out, plan, build.built, wrangler, (line) => console.log(line));
  console.log(`Applied. Watch: npx wrangler ai-search stats ${INDEX_V2_INSTANCE}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
