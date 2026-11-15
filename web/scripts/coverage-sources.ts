// SPDX-License-Identifier: Apache-2.0
// The reading half of the coverage audit (scripts/coverage.ts): hashes of the room folder and of the case folder's
// own root and private folders, one SELECT each on `documents` and `audit_log`, paginated listings of both R2
// buckets and of the AI Search instance's items over the REST API, and the local caches (index manifest, text,
// built case picture, replica retrievals). Nothing here writes: the text cache is read directly, never through
// cachedExtractor, and nothing calls sync.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { kindOf } from './diff.ts';
import { directTextPages, indexSource, parseExtractorOutput, VisualTextMissing, type ExtractedPage } from './extract.ts';
import { isPrivateSegment, skipReason, type WalkedFile } from './guard.ts';
import type { RestGet } from './law/replica.ts';
import { normalizeCatalogPath, parseCatalog, parseCsv } from './matter/catalog.ts';
import { mapLimit } from './pool.ts';
import { sha256File } from './snapshot.ts';
import { visualTextSource } from './visual-ai.ts';
import type { AiItem, CatalogEntry, DocRow, OutsideFile, RoomFile } from './coverage-table.ts';

const HASH_CONCURRENCY = 6;
const R2_PAGE = 1000;
/** The AI Search items endpoint refuses more than 50 per page. */
const AI_PAGE = 50;
const MAX_PAGES = 1000;

/** Every documents row, live and removed: the probe's in-memory D1 needs the full rows. */
export const DOCUMENTS_SQL = 'SELECT * FROM documents;';
/** Views, downloads and AI reads per document. audit_log never holds text. */
export const AUDIT_COUNTS_SQL = 'SELECT document_id, action, COUNT(*) AS n FROM audit_log GROUP BY 1, 2;';

export function md5File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** sha256 (as sync computes it) and md5 (as the catalog records it) of every walked room file. */
export function hashRoom(files: readonly WalkedFile[]): Promise<RoomFile[]> {
  return mapLimit(files, HASH_CONCURRENCY, async (file) => {
    const [sha256, md5] = await Promise.all([sha256File(file.abs), md5File(file.abs)]);
    return { rel: file.rel, size: file.size, sha256, md5 };
  });
}

export interface CaseFolder {
  /** Regular files at the case folder's own root (not inside any folder). */
  outside: OutsideFile[];
  /** sha256 of every file under a private folder at the root. Names are never kept. */
  privateShas: Set<string>;
  privateFiles: number;
  /** Other folders at the root, which are not read at all. */
  foldersNotRead: number;
  unreadable: number;
}

async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (skipReason(entry.name) || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(full)));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

/**
 * The case folder outside the room: its top-level files are hashed and listed; every private folder at the top
 * (isPrivateSegment) is hashed file by file with no names kept; any other folder is left unread.
 */
export async function scanCaseFolder(caseRoot: string, sourceRoot: string): Promise<CaseFolder> {
  const result: CaseFolder = { outside: [], privateShas: new Set(), privateFiles: 0, foldersNotRead: 0, unreadable: 0 };
  const entries = await readdir(caseRoot, { withFileTypes: true });
  const privateFiles: string[] = [];
  const topFiles: string[] = [];
  for (const entry of entries) {
    const full = path.join(caseRoot, entry.name);
    if (skipReason(entry.name) || entry.isSymbolicLink() || path.resolve(full) === path.resolve(sourceRoot)) continue;
    if (entry.isFile()) topFiles.push(entry.name);
    else if (entry.isDirectory() && isPrivateSegment(entry.name)) privateFiles.push(...(await filesUnder(full)));
    else if (entry.isDirectory()) result.foldersNotRead += 1;
  }
  for (const name of topFiles.sort()) {
    const sha256 = await sha256File(path.join(caseRoot, name)).catch(() => null);
    if (sha256) result.outside.push({ rel: name.normalize('NFC'), sha256 });
    else result.unreadable += 1;
  }
  const shas = await mapLimit(privateFiles, HASH_CONCURRENCY, (file) => sha256File(file).catch(() => null));
  for (const sha of shas) {
    if (sha) result.privateShas.add(sha);
    else result.unreadable += 1;
  }
  result.privateFiles = privateFiles.length;
  return result;
}

/** A documents row from `wrangler d1 execute --json`, or null when it lacks the fields the audit needs. */
export function toDocRow(raw: Record<string, unknown>): DocRow | null {
  const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : null);
  const num = (key: string) => (typeof raw[key] === 'number' ? (raw[key] as number) : null);
  const id = text('id');
  const docPath = text('path');
  const key = text('r2_key');
  if (!id || !docPath || !key) return null;
  return {
    id, path: docPath, name: text('name') ?? path.posix.basename(docPath), sha256: text('sha256'), size: num('size') ?? 0,
    kind: text('kind') ?? 'file', pages: num('pages'), r2_key: key, source: text('source') ?? '', control_seq: num('control_seq'),
    removed_at: text('removed_at'),
  };
}

/** Audit counts by document id and action. */
export function auditCounts(rows: readonly Record<string, unknown>[]): Map<string, Record<string, number>> {
  const counts = new Map<string, Record<string, number>>();
  for (const row of rows) {
    if (typeof row.document_id !== 'string' || typeof row.action !== 'string') continue;
    const entry = counts.get(row.document_id) ?? {};
    entry[row.action] = Number(row.n ?? 0);
    counts.set(row.document_id, entry);
  }
  return counts;
}

/** Every key in an R2 bucket, one paginated listing. */
export async function listR2Keys(get: RestGet, bucket: string): Promise<string[]> {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket)) throw new Error('bad bucket name');
  const keys: string[] = [];
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = `per_page=${R2_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const body = await get(`r2/buckets/${bucket}/objects?${query}`);
    const result = Array.isArray(body.result) ? (body.result as { key?: unknown }[]) : [];
    for (const object of result) if (typeof object.key === 'string') keys.push(object.key);
    const info = (body.result_info ?? {}) as { cursor?: unknown; is_truncated?: unknown };
    if (info.is_truncated !== true || typeof info.cursor !== 'string' || info.cursor === '') return keys;
    cursor = info.cursor;
  }
  throw new Error('R2 listing did not end');
}

/** Every item of an AI Search instance by its R2 key: status and chunk count. */
export async function listAiItems(get: RestGet, instance: string): Promise<Map<string, AiItem>> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(instance)) throw new Error('bad instance name');
  const items = new Map<string, AiItem>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await get(`ai-search/instances/${instance}/items?per_page=${AI_PAGE}&page=${page}`);
    const result = Array.isArray(body.result) ? (body.result as { key?: unknown; status?: unknown; chunks_count?: unknown }[]) : [];
    for (const item of result) {
      if (typeof item.key === 'string') items.set(item.key, { status: typeof item.status === 'string' ? item.status : 'unknown', chunks: Number(item.chunks_count ?? 0) });
    }
    const total = Number((body.result_info as { total_count?: unknown } | undefined)?.total_count ?? 0);
    if (result.length < AI_PAGE || items.size >= total) return items;
  }
  throw new Error('AI Search item listing did not end');
}

/** A text cache entry (<cacheDir>/text/<sha>.json) read as it is, or null when there is none. */
export async function cachedPages(cacheDir: string, sha256: string): Promise<{ pages: ExtractedPage[]; version: number | null } | null> {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  const text = await readFile(path.join(cacheDir, 'text', `${sha256}.json`), 'utf8').catch(() => null);
  if (text === null) return null;
  try {
    const version = (JSON.parse(text) as { version?: unknown }).version;
    return { pages: parseExtractorOutput(text), version: typeof version === 'number' ? version : null };
  } catch {
    return null;
  }
}

/**
 * The text sync would index for a room file: the cache for extracted kinds, the file itself for direct ones, and a
 * visual's rendered text from the cache (null until `npm run visuals -- --ai` renders it).
 */
export async function roomText(file: { rel: string; abs: string; sha256: string }, cacheDir: string): Promise<{ pages: ExtractedPage[]; version: number | null } | null> {
  const name = path.posix.basename(file.rel);
  const source = indexSource(kindOf(name).kind, file.rel);
  if (source === 'extractor') return cachedPages(cacheDir, file.sha256);
  if (source !== 'direct') return null;
  try {
    return { pages: await directTextPages(file.abs, name, visualTextSource(cacheDir)), version: null };
  } catch (error) {
    if (error instanceof VisualTextMissing) return null;
    throw error;
  }
}

/** md5, size, privilege and summary per catalog path (documents.path spelling). */
export function catalogEntries(text: string, sourceRoot: string): Map<string, CatalogEntry> {
  const facts = parseCatalog(text, sourceRoot).docs;
  const rows = parseCsv(text);
  const header = (rows[0] ?? []).map((name) => name.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const entries = new Map<string, CatalogEntry>();
  for (const row of rows.slice(1)) {
    const docPath = normalizeCatalogPath(row[col('path')] ?? '', sourceRoot);
    if (!docPath) continue;
    const size = Number.parseInt((row[col('size_bytes')] ?? '').trim(), 10);
    const fact = facts.get(docPath);
    entries.set(docPath, {
      md5: (row[col('md5')] ?? '').trim().toLowerCase(),
      size: Number.isSafeInteger(size) ? size : null,
      privileged: fact?.privileged ?? false,
      summary: fact?.summary ?? null,
    });
  }
  return entries;
}

/** Cites per document id in a built case picture: every object with a `doc` id and a `page`, outside `docs`. */
export function citeCounts(matter: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (value: unknown, key: string | null): void => {
    if (key === 'docs' || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach((item) => visit(item, null));
    const record = value as Record<string, unknown>;
    if (typeof record.doc === 'string' && 'page' in record) counts.set(record.doc, (counts.get(record.doc) ?? 0) + 1);
    for (const [child, inner] of Object.entries(record)) visit(inner, child);
  };
  visit(matter, null);
  return counts;
}

/** Questions that retrieved each document, over replica retrieval caches ({ item: { chunks: [{ docId }] } }). */
export function retrievedCounts(caches: readonly unknown[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cache of caches) {
    if (!cache || typeof cache !== 'object') continue;
    for (const entry of Object.values(cache as Record<string, unknown>)) {
      const chunks = (entry as { chunks?: unknown } | null)?.chunks;
      if (!Array.isArray(chunks)) continue;
      const ids = new Set(chunks.map((chunk) => (chunk as { docId?: unknown }).docId).filter((id): id is string => typeof id === 'string'));
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/** The replica retrieval caches: <cacheDir>/ask-replica<anything>/retrieval.json and any under <cacheDir>/staging. */
export async function retrievalFiles(cacheDir: string): Promise<string[]> {
  const top = await readdir(cacheDir, { withFileTypes: true }).catch(() => []);
  const replicas = top.filter((entry) => entry.isDirectory() && entry.name.startsWith('ask-replica')).map((entry) => path.join(cacheDir, entry.name, 'retrieval.json'));
  const staging = await readdir(path.join(cacheDir, 'staging'), { recursive: true, withFileTypes: true }).catch(() => []);
  const staged = staging.filter((entry) => entry.isFile() && entry.name === 'retrieval.json').map((entry) => path.join(entry.parentPath, entry.name));
  const exists = await Promise.all(replicas.map((file) => stat(file).then((info) => info.isFile(), () => false)));
  return [...replicas.filter((_, i) => exists[i]), ...staged].sort();
}
