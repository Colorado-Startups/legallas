// SPDX-License-Identifier: Apache-2.0
// Keeps the keyword index (migration 0009, searched by worker/fts.ts) in step with legallas-index, the page text AI
// Search reads. Free: D1 rows written within Workers Paid's included amount, R2 reads within its included operations,
// no AI calls.
//
//   node scripts/fts-index.ts                          dry run against production: prints the plan, changes nothing
//   node scripts/fts-index.ts --apply --expect <fp>    write exactly the plan of an approved dry run (production D1:
//                                                      the owner runs it)
//   node scripts/fts-index.ts --local [--apply]        the local room (wrangler dev state, filled by dev:seed)
//   --manifest <file>  local only: sync's index manifest for that room, so each document's parts are read by count, not
//                    until one is missing, which saves one wrangler call per document
//   --max-docs <n>   rewrite at most n changed documents this run (the rest wait for the next run): a first, small run
//
// What changed: a document's parts (text/<id>.p<N>.md) are fingerprinted by key and R2 etag, and page_fts_docs keeps
// the fingerprint last written. Only documents whose fingerprint differs are rewritten, and documents whose parts are
// gone are dropped. Remote lists legallas-index over the REST API (etags included) and reads parts the same way. Local
// has no listing, so it reads parts p1, p2, ... of every live document until one is missing and hashes them (md5, as
// R2's etag of a single upload).
//
// Writes go through `wrangler d1 execute --file` as SQL files built by fts-rows.ts, each statement under D1's
// 100,000-byte limit. Per document: mark it pending, clear its rowid block, insert its pages, record its fingerprint,
// in that order, so a run that stops halfway leaves pending documents (fingerprint '') that the next run rewrites.
// Case text goes only to private temp files, removed after. Logs carry counts, never text.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DOC_ID } from '../worker/passages.ts';
import { batches, dropStatements, indexStatements, pagesOf } from './fts-rows.ts';
import { restGetter, withFreshToken, withRateRetry, wranglerTokens, type RestGet, type TokenSource } from './law/replica.ts';
import { mapLimit } from './pool.ts';
import { localWrangler } from './local-r2.ts';
import { accountId, cliWrangler, INDEX_BUCKET, type Target, type Wrangler } from './wrangler.ts';

/** Rows written one run may cause, by the plan's estimate: 4% of the 50 million a month Workers Paid includes. */
export const MAX_ROWS_WRITTEN = 2_000_000;
/** Estimated rows written per KB of part text: each page's content and docsize rows, FTS5 segment rows and merges. */
const ROWS_PER_KB = 7;
const LOCAL_MAX_PARTS = 200;
const REMOTE_CONCURRENCY = 6;
const MAX_LIST_PAGES = 1000;
const API = 'https://api.cloudflare.com/client/v4';
const KEY = /^text\/([A-Za-z0-9_-]{1,64})\.p([1-9][0-9]{0,5})\.md$/;
/**
 * How `wrangler r2 object get` reports a key that is not there ("The specified key does not exist.", local and remote),
 * as wrangler.ts errorTail passes it on. Narrower than scripts/matter/cli.ts NOT_FOUND on purpose: "command not found"
 * from a broken npx must stop the run, not read as a missing part.
 */
const MISSING_OBJECT = /specified key does not exist|NoSuchKey/i;

/** One index part in legallas-index. */
export interface PartRef {
  docId: string;
  part: number;
  key: string;
  etag: string;
  size: number;
}

export interface PartSource {
  list(): Promise<PartRef[]>;
  read(ref: PartRef): Promise<string>;
}

export interface IndexedDoc {
  fingerprint: string;
  rows: number;
}

export interface FtsJob {
  docId: string;
  fingerprint: string;
  parts: PartRef[];
}

export interface FtsPlan {
  index: FtsJob[];
  drop: string[];
  unchanged: number;
  /** Changed documents left for a later run by --max-docs. */
  deferred: number;
}

export function partRef(key: unknown, etag: unknown, size: unknown): PartRef | null {
  const match = typeof key === 'string' ? KEY.exec(key) : null;
  if (!match || typeof etag !== 'string' || etag === '') return null;
  return { docId: match[1]!, part: Number(match[2]), key: match[0], etag, size: Number(size) || 0 };
}

export function docFingerprint(parts: readonly PartRef[]): string {
  return createHash('sha256')
    .update(parts.map((part) => `${part.key}\0${part.etag}`).join('\n'))
    .digest('hex')
    .slice(0, 32);
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Documents to rewrite (fingerprint differs or never written) and to drop (no parts left). Pure. */
export function ftsPlan(refs: readonly PartRef[], indexed: ReadonlyMap<string, IndexedDoc>, maxDocs = Number.POSITIVE_INFINITY): FtsPlan {
  const byDoc = new Map<string, PartRef[]>();
  for (const ref of refs) {
    const parts = byDoc.get(ref.docId);
    if (parts) parts.push(ref);
    else byDoc.set(ref.docId, [ref]);
  }
  const changed: FtsJob[] = [];
  let unchanged = 0;
  for (const docId of [...byDoc.keys()].sort(byText)) {
    const parts = byDoc.get(docId)!.sort((a, b) => a.part - b.part);
    const fingerprint = docFingerprint(parts);
    if (indexed.get(docId)?.fingerprint === fingerprint) unchanged += 1;
    else changed.push({ docId, fingerprint, parts });
  }
  const index = changed.slice(0, maxDocs);
  const drop = [...indexed.keys()].filter((id) => !byDoc.has(id)).sort(byText);
  return { index, drop, unchanged, deferred: changed.length - index.length };
}

/** What --expect must name: every rewrite (with its parts' fingerprint) and every drop. */
export function planFingerprint(plan: FtsPlan): string {
  const entries = [...plan.index.map((job) => `index\0${job.docId}\0${job.fingerprint}`), ...plan.drop.map((id) => `drop\0${id}`)].sort(byText);
  return createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 12);
}

/** A generous estimate of D1 rows written: new text by size, plus every old row cleared. */
export function estimateRowsWritten(plan: FtsPlan, indexed: ReadonlyMap<string, IndexedDoc>): number {
  const oldRows = (id: string) => indexed.get(id)?.rows ?? 0;
  const writes = plan.index.reduce((sum, job) => sum + 3 + Math.ceil((job.parts.reduce((s, part) => s + part.size, 0) / 1024) * ROWS_PER_KB) + 2 * oldRows(job.docId), 0);
  return writes + plan.drop.reduce((sum, id) => sum + 1 + 2 * oldRows(id), 0);
}

export type RestText = (resource: string) => Promise<string>;

/** Raw GETs (an object's body) on wrangler's OAuth token, renewed on a 401 and retried on a 429. */
export function restText(account: string, tokens: TokenSource, fetcher: typeof fetch = fetch): RestText {
  if (!/^[0-9a-f]{32}$/.test(account)) throw new Error('account id must be 32 hex characters');
  return async (resource) => {
    const response = await withRateRetry(() =>
      withFreshToken(tokens, (token) => fetcher(`${API}/accounts/${account}/${resource}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) })),
    );
    if (!response.ok) throw new Error(`cloudflare_get_${response.status}`);
    return response.text();
  };
}

/** legallas-index over the REST API: one paginated listing with etags, then each part read as it is needed. */
export function remoteSource(get: RestGet, getText: RestText): PartSource {
  return {
    async list() {
      const refs: PartRef[] = [];
      let cursor = '';
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const body = await get(`r2/buckets/${INDEX_BUCKET}/objects?prefix=text%2F&per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        const objects = Array.isArray(body.result) ? (body.result as { key?: unknown; etag?: unknown; size?: unknown }[]) : [];
        for (const object of objects) {
          const ref = partRef(object.key, object.etag, object.size);
          if (ref) refs.push(ref);
        }
        const info = (body.result_info ?? {}) as { cursor?: unknown; is_truncated?: unknown };
        if (info.is_truncated !== true || typeof info.cursor !== 'string' || info.cursor === '') return refs;
        cursor = info.cursor;
      }
      throw new Error('R2 listing did not end');
    },
    read: (ref) => getText(`r2/buckets/${INDEX_BUCKET}/objects/${ref.key}`),
  };
}

/**
 * The local room's legallas-index: parts read one by one (r2Concurrency local is 1) and kept for the build. `known` gives a
 * document's part count where the caller knows it. A part that is missing still ends the document, known or not.
 */
export function localSource(w: Pick<Wrangler, 'd1Query' | 'r2Get'>, workDir: string, known: Readonly<Record<string, { parts: number }>> = {}): PartSource {
  const bodies = new Map<string, string>();
  const readPart = async (key: string): Promise<string | null> => {
    const file = path.join(workDir, 'part.md');
    try {
      await w.r2Get(INDEX_BUCKET, key, file);
      return await readFile(file, 'utf8');
    } catch (error) {
      // Only a missing part ends a document's parts. Any other failure stops the run: read as "no parts", it would
      // drop the document from the index.
      if (error instanceof Error && MISSING_OBJECT.test(error.message)) return null;
      throw error;
    } finally {
      await rm(file, { force: true });
    }
  };
  return {
    async list() {
      const rows = await w.d1Query('SELECT id FROM documents WHERE removed_at IS NULL UNION SELECT doc_id FROM page_fts_docs');
      const refs: PartRef[] = [];
      for (const docId of rows.map((row) => String(row.id ?? '')).filter((id) => DOC_ID.test(id))) {
        for (let part = 1; part <= (known[docId]?.parts ?? LOCAL_MAX_PARTS); part += 1) {
          const key = `text/${docId}.p${part}.md`;
          const body = await readPart(key);
          if (body === null) break;
          bodies.set(key, body);
          refs.push({ docId, part, key, etag: createHash('md5').update(body).digest('hex'), size: Buffer.byteLength(body) });
        }
      }
      return refs;
    },
    async read(ref) {
      const body = bodies.get(ref.key);
      if (body === undefined) throw new Error(`Part ${ref.key} was not listed`);
      return body;
    },
  };
}

export interface FtsIndexOptions {
  apply: boolean;
  target: Target;
  expect: string | null;
  maxDocs: number;
  manifest?: string;
}

const USAGE = 'usage: node scripts/fts-index.ts [--local] [--apply] [--expect <fingerprint>] [--max-docs <n>] [--manifest <file>]';

export function parseFtsArgs(args: readonly string[]): FtsIndexOptions {
  const options: FtsIndexOptions = { apply: false, target: 'remote', expect: null, maxDocs: Number.POSITIVE_INFINITY };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--local') options.target = 'local';
    else if (arg === '--expect' && /^[0-9a-f]{12}$/.test(args[i + 1] ?? '')) options.expect = args[++i]!;
    else if (arg === '--max-docs' && /^[1-9][0-9]{0,5}$/.test(args[i + 1] ?? '')) options.maxDocs = Number(args[++i]);
    else if (arg === '--manifest' && args[i + 1]) options.manifest = path.resolve(args[++i]!);
    else throw new Error(USAGE);
  }
  if (options.expect && !options.apply) throw new Error(`--expect only makes sense with --apply\n${USAGE}`);
  if (options.manifest && options.target !== 'local') throw new Error(`--manifest is for --local\n${USAGE}`);
  if (options.apply && options.target === 'remote' && !options.expect) throw new Error(`A remote --apply needs --expect <fingerprint> from an approved dry run\n${USAGE}`);
  return options;
}

export interface RunDeps {
  w: Pick<Wrangler, 'target' | 'd1Query' | 'd1File'>;
  source: PartSource;
  workDir: string;
  now: string;
  log: (line: string) => void;
}

export interface FtsSummary {
  indexed: number;
  dropped: number;
  rows: number;
}

async function readIndexed(w: RunDeps['w']): Promise<Map<string, IndexedDoc>> {
  const rows = await w.d1Query('SELECT doc_id, fingerprint, rows FROM page_fts_docs').catch(() => {
    throw new Error(`Could not read page_fts_docs in the ${w.target} database. Apply migration 0009 there first.`);
  });
  const indexed = new Map<string, IndexedDoc>();
  for (const row of rows) {
    if (typeof row.doc_id === 'string' && DOC_ID.test(row.doc_id)) indexed.set(row.doc_id, { fingerprint: String(row.fingerprint ?? ''), rows: Number(row.rows ?? 0) });
  }
  return indexed;
}

function formatPlan(plan: FtsPlan, parts: number, estimate: number, fingerprint: string, target: Target): string {
  return [
    `Keyword index (${target}): ${parts} index parts in ${INDEX_BUCKET}.`,
    `  rewrite  ${plan.index.length} documents (${plan.index.reduce((sum, job) => sum + job.parts.length, 0)} parts)`,
    `  drop     ${plan.drop.length} documents`,
    `  same     ${plan.unchanged} documents`,
    ...(plan.deferred > 0 ? [`  later    ${plan.deferred} changed documents (--max-docs)`] : []),
    `  D1 rows written, estimated: ${estimate.toLocaleString('en-US')} (a run refuses past ${MAX_ROWS_WRITTEN.toLocaleString('en-US')})`,
    '',
    `Plan fingerprint: ${fingerprint}`,
  ].join('\n');
}

/** Builds every statement of an approved plan: drops first, then each document's rewrite. */
async function planStatements(plan: FtsPlan, deps: RunDeps): Promise<{ statements: string[]; rows: number }> {
  const built = await mapLimit(plan.index, REMOTE_CONCURRENCY, async (job) => {
    const bodies = await mapLimit(job.parts, 1, (part) => deps.source.read(part));
    return indexStatements(job.docId, job.fingerprint, pagesOf(job.docId, bodies), deps.now);
  });
  return { statements: [...plan.drop.flatMap(dropStatements), ...built.flatMap((doc) => doc.statements)], rows: built.reduce((sum, doc) => sum + doc.rows, 0) };
}

/** One run: read what is indexed, list the parts, print the plan, and with --apply write exactly that plan. */
export async function runFtsIndex(options: FtsIndexOptions, deps: RunDeps): Promise<FtsSummary | null> {
  const indexed = await readIndexed(deps.w);
  const refs = await deps.source.list();
  const plan = ftsPlan(refs, indexed, options.maxDocs);
  const fingerprint = planFingerprint(plan);
  const estimate = estimateRowsWritten(plan, indexed);
  deps.log(formatPlan(plan, refs.length, estimate, fingerprint, deps.w.target));
  if (!options.apply) {
    deps.log('\nDry run only. Nothing was changed.');
    return null;
  }
  if (options.expect && options.expect !== fingerprint) {
    throw new Error(`The plan changed since the approved dry run (expected ${options.expect}, now ${fingerprint}). Nothing was changed.`);
  }
  if (estimate > MAX_ROWS_WRITTEN) throw new Error('The plan would write more D1 rows than one run may. Use --max-docs. Nothing was changed.');
  if (plan.index.length + plan.drop.length === 0) {
    deps.log('\nNothing to do.');
    return { indexed: 0, dropped: 0, rows: 0 };
  }
  const { statements, rows } = await planStatements(plan, deps);
  const files = batches(statements);
  for (const [i, sql] of files.entries()) {
    const file = path.join(deps.workDir, `fts-${i + 1}.sql`);
    await writeFile(file, sql, { mode: 0o600 });
    try {
      await deps.w.d1File(file);
    } finally {
      await rm(file, { force: true });
    }
    deps.log(`  wrote batch ${i + 1} of ${files.length}`);
  }
  deps.log(`\nDone: ${plan.index.length} documents rewritten (${rows} rows), ${plan.drop.length} dropped.`);
  return { indexed: plan.index.length, dropped: plan.drop.length, rows };
}

async function main(): Promise<void> {
  const options = parseFtsArgs(process.argv.slice(2));
  const w = options.target === 'local' ? await localWrangler() : cliWrangler(options.target);
  const workDir = await mkdtemp(path.join(tmpdir(), 'legallas-fts-'));
  try {
    let source: PartSource;
    if (options.target === 'local') source = localSource(w, workDir, options.manifest ? (JSON.parse(await readFile(options.manifest, 'utf8')) as Record<string, { parts: number }>) : {});
    else {
      const [account, tokens] = [await accountId(), wranglerTokens()];
      source = remoteSource(restGetter(account, tokens), restText(account, tokens));
    }
    await runFtsIndex(options, { w, source, workDir, now: new Date().toISOString(), log: (line) => process.stdout.write(`${line}\n`) });
  } finally {
    await w.close?.();
    await rm(workDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
