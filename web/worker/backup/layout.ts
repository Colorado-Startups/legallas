// SPDX-License-Identifier: Apache-2.0
// Where the room backup (worker/backup/) keeps things in the backup bucket, what a run records, and the guards on cost.
// Everything stays in the room owner's own Cloudflare account. What a run returns, and so what `npm run backup` prints,
// is counts, byte totals and SHA-256 hashes: never a key, file name, member email or byte of a document.
//
// Backup bucket layout:
//   objects/<source>/<etag>/<key>              one copy of each version of each object, never overwritten
//   runs/<run>/objects/<source>/<page>.jsonl   the run's manifest: key, etag, size and SHA-256 of every object it saw
//   runs/<run>/d1/schema.json                  the database's tables, indexes, triggers and views, and each table's plan
//   runs/<run>/d1/<table>/<page>.jsonl         the table's rows, 1,000 per page, in rowid order
//   runs/<run>/summary.json                    counts and hashes; a run without one did not finish
//   drills/<when>.json                         each drill's result, dated: counts, hashes, seconds, pass or fail
// The scratch bucket holds only drill/<source>/<key>, and only while a drill runs.

/** The room's R2 buckets, by the name the backup uses for each. */
export const SOURCES = ['files', 'index', 'law'] as const;
/** A bucket that is backed up. */
export type Source = (typeof SOURCES)[number];
/** What a restore can bring back: a bucket, or the database. */
export const PARTS = [...SOURCES, 'd1'] as const;
/** A part that a restore can bring back. */
export type Part = (typeof PARTS)[number];

/** The key prefix of backed-up objects. */
export const OBJECTS = 'objects/';
/** The key prefix of backup runs. */
export const RUNS = 'runs/';
/** The key prefix of drill copies. */
export const DRILL = 'drill/';
/** The key prefix of drill records. */
export const DRILLS = 'drills/';
/** Custom metadata on each backup copy: the SHA-256 R2 checked when it stored the copy. Stripped on restore. */
export const SHA_META = 'legallas-backup-sha256';

/** Objects per list page and rows per database page. */
export const PAGE = 1000;
/** R2 stores 10 GB a month free (R2 pricing page, read 2026-11-06). A run stops before the buckets it sees pass 90% of it. */
export const STORAGE_CAP_BYTES = 9_000_000_000;
/** R2's free tier includes 1 million Class A operations a month (R2 pricing page, read 2026-11-06); one run uses at most 10%. */
export const MAX_WRITES_PER_RUN = 100_000;
/** Run folders (manifests and database copies) older than this are pruned; the newest KEEP_RUNS finished runs never are. */
export const KEEP_DAYS = 35;
/** How many backup runs are kept. */
export const KEEP_RUNS = 3;
/** R2's longest key. */
const MAX_KEY_BYTES = 1024;
const MAX_PAGES = 9000;

/** Every failure the backup names itself. `npm run backup` prints a failed run's message only when it starts with one. */
export const BACKUP_ERROR_CODES = [
  'backup-bucket-not-ours',
  'bad-etag',
  'bad-manifest',
  'bad-params',
  'bad-row',
  'bad-run',
  'copy-without-hash',
  'derived-table',
  'key-too-long',
  'manifest-missing',
  'no-run',
  'rows-missing',
  'schema-missing',
  'scratch-bucket-not-ours',
  'scratch-database-not-ours',
  'size-mismatch',
  'storage-cap',
  'target-not-empty',
  'too-many-columns',
  'too-many-pages',
  'unknown-value',
  'unknown-virtual-table',
  'without-rowid',
  'write-cap',
] as const;
/** The code of a failure that the backup names itself. */
export type BackupCode = (typeof BACKUP_ERROR_CODES)[number];

/** A failure the backup names itself. Its message carries counts only, so the owner's terminal can show it. */
export class BackupError extends Error {
  readonly code: BackupCode;
  constructor(code: BackupCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'BackupError';
    this.code = code;
  }
}

/** Matches the shape of a run id. */
export const RUN_ID = /^\d{8}T\d{6}Z(?:-[a-z0-9]{1,8})?$/;

/** A run's id: when it started, in UTC, then the start of the Workflow instance id, so two runs in one second differ. */
export function runIdAt(when: Date, instanceId: string): string {
  const stamp = when.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
  const suffix = instanceId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return suffix ? `${stamp}-${suffix}` : stamp;
}

/** When a run started, from its id. */
export function runStarted(run: string): Date {
  if (!RUN_ID.test(run)) throw new BackupError('bad-run', 'not a run id');
  const s = run.slice(0, 16);
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);
}

const ETAG = /^[0-9A-Za-z-]{1,64}$/;
const encoder = new TextEncoder();

function keyed(key: string): string {
  if (encoder.encode(key).length > MAX_KEY_BYTES) throw new BackupError('key-too-long', 'an object key with its backup prefix passes 1,024 bytes');
  return key;
}

/** The backup copy of one version of one object. The etag never holds "/", so the key after it is the object's own. */
export function blobKey(source: Source, etag: string, key: string): string {
  if (!ETAG.test(etag)) throw new BackupError('bad-etag', 'an object has an etag R2 never gives');
  return keyed(`${OBJECTS}${source}/${etag}/${key}`);
}

/** The key of a drill copy of one object. */
export function drillKey(source: Source, key: string): string {
  return keyed(`${DRILL}${source}/${key}`);
}

function pad(page: number): string {
  if (!Number.isInteger(page) || page < 0 || page >= MAX_PAGES) throw new BackupError('too-many-pages', `page ${page} is past the ${MAX_PAGES}-page limit`);
  return String(page).padStart(4, '0');
}

/** The key prefix of one run. */
export const runPrefix = (run: string): string => `${RUNS}${run}/`;
/** The key of one page of a run's object manifest. */
export const manifestKey = (run: string, source: Source, page: number): string => `${runPrefix(run)}objects/${source}/${pad(page)}.jsonl`;
/** The key of a run's database schema. */
export const schemaKey = (run: string): string => `${runPrefix(run)}d1/schema.json`;
/** The key of one page of a table's rows in a run. */
export const tablePageKey = (run: string, table: string, page: number): string => `${runPrefix(run)}d1/${table}/${pad(page)}.jsonl`;
/** The key of a run's summary. */
export const summaryKey = (run: string): string => `${runPrefix(run)}summary.json`;
/** A drill's dated record, named for when it finished, in UTC. */
export const drillRecordKey = (finished: number): string => `${DRILLS}${runIdAt(new Date(finished), '')}.json`;

/** One object in a run's manifest: key, etag, size in bytes, SHA-256. */
export interface ManifestLine {
  k: string;
  e: string;
  n: number;
  s: string;
}

const SHA256 = /^[0-9a-f]{64}$/;

/** A page of lines, one JSON value per line. Hashed as written, so the drill hashes the same bytes. */
export function linesText(lines: readonly unknown[]): string {
  return lines.map((line) => `${JSON.stringify(line)}\n`).join('');
}

/** Parses a manifest page's text into its lines. */
export function parseManifest(text: string): ManifestLine[] {
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const value = JSON.parse(line) as Partial<ManifestLine>;
      if (typeof value.k !== 'string' || typeof value.e !== 'string' || !Number.isInteger(value.n) || typeof value.s !== 'string' || !SHA256.test(value.s)) {
        throw new BackupError('bad-manifest', 'a manifest line is not key, etag, size and SHA-256');
      }
      return { k: value.k, e: value.e, n: value.n!, s: value.s };
    });
}

/** Encodes bytes as lowercase hex. */
export function hex(bytes: ArrayBuffer | ArrayBufferView): string {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from(view, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The SHA-256 of text as lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/** One hash over many: a source's page hashes, a table's page hashes, or every table's hash. */
export function rollUp(hashes: readonly string[]): Promise<string> {
  return sha256Hex(hashes.join('\n'));
}

/** What a finished run recorded for one bucket. */
export interface SourceRecord {
  objects: number;
  bytes: number;
  pages: number;
  hash: string;
}

/** What a finished run recorded for one table. */
export interface TableRecord {
  name: string;
  rows: number;
  pages: number;
  hash: string;
}

/** summary.json: a finished run. */
export interface RunSummary {
  version: 1;
  run: string;
  sources: Record<Source, SourceRecord>;
  tables: TableRecord[];
}

/** Runs `fn` over `items`, at most `limit` at once, results in input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
