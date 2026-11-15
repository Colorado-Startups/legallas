// SPDX-License-Identifier: Apache-2.0
// The pure half of the coverage audit (scripts/coverage.ts): one row per file across the room folder, the case
// folder's own root, D1, both R2 buckets, the AI Search instance, the local index manifest and text cache, the
// document catalog, the audit log, the case picture and the replica retrievals, then a status for each row.
// Nothing here reads a disk or a network; coverage-sources.ts gathers the inputs.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { formatControl } from './counsel-pack-plan.ts';
import { kindOf, type Kind } from './diff.ts';
import { EXTRACTOR_VERSION, indexSource, isAgentFile, isDraft, isPrivilegedOffice, renderVersion, type ExtractedPage } from './extract.ts';
import type { IndexManifest } from './indexjob.ts';
import { isHiddenName } from '../worker/files-catalog.ts';
import { visualAiKey } from '../worker/visuals.ts';
import { STORED_NAME } from '../worker/stored-name.ts';

/** A file in the room folder (sourceRoot), as the guard walked it. */
export interface RoomFile {
  rel: string;
  size: number;
  sha256: string;
  md5: string;
}

/** A file at the case folder's own root, outside the room and outside every private folder. */
export interface OutsideFile {
  rel: string;
  sha256: string;
}

/** A documents row, live or removed (SELECT * FROM documents). */
export interface DocRow {
  id: string;
  path: string;
  name: string;
  sha256: string | null;
  size: number;
  kind: string;
  pages: number | null;
  r2_key: string;
  source: string;
  control_seq: number | null;
  removed_at: string | null;
}

export interface TextStats {
  /** EXTRACTOR_VERSION of a text cache entry; null for text read directly. */
  version: number | null;
  pages: number;
  blankPages: number;
  ocrPages: number;
  /** Characters per page, whitespace runs counted once. */
  chars: number[];
  /** sha256 prefix of the whitespace-normalized text, null when there is none. */
  textHash: string | null;
}

export interface CatalogEntry {
  md5: string;
  size: number | null;
  privileged: boolean;
  summary: string | null;
}

export interface AiItem {
  status: string;
  chunks: number;
}

export interface ProbeHit {
  query: string;
  /** 1-based position of the document's first passage in the order Ask reads them; null when absent. */
  rank: number | null;
  /** Position among distinct documents; null when absent. */
  docRank: number | null;
  /** Best position of a document with the same text or file (an identical copy), null when none came back. */
  twinRank: number | null;
  /** The first three documents returned, by id. */
  top: string[];
  error?: string;
}

export interface ProbeResult {
  summary: ProbeHit | null;
  passage: ProbeHit | null;
  unfindable: boolean;
  /** One word for an unfindable document: blank, twin, ocr, absent, buried or error. */
  reason: string | null;
}

export interface CoverageInputs {
  prefix: string;
  room: readonly RoomFile[];
  outside: readonly OutsideFile[];
  privateShas: ReadonlySet<string>;
  rows: readonly DocRow[];
  filesKeys: ReadonlySet<string>;
  indexKeys: readonly string[];
  /** AI Search items by R2 key. */
  aiItems: ReadonlyMap<string, AiItem>;
  manifest: IndexManifest;
  /** Text statistics by room path. */
  text: ReadonlyMap<string, TextStats>;
  catalog: ReadonlyMap<string, CatalogEntry>;
  audit: ReadonlyMap<string, Record<string, number>>;
  cites: ReadonlyMap<string, number>;
  retrieved: ReadonlyMap<string, number>;
  probe?: ReadonlyMap<string, ProbeResult>;
}

export type Zone = 'room' | 'case-root' | 'd1-only' | 'counsel';
export type Status = 'OK' | 'GAP';

export interface CoverageRow {
  zone: Zone;
  /** The top folder of the path ('(root)' for a file at the top). */
  tab: string;
  path: string;
  kind: Kind;
  id: string | null;
  control: string;
  sha256: string | null;
  /** D1's sha256 equals the file's; null when either side has none. */
  shaMatch: boolean | null;
  inD1: boolean;
  inFiles: boolean | null;
  /** true, or why the document is not indexed. */
  indexable: true | string;
  manifest: { parts: number; version: number | null; fresh: boolean } | null;
  indexParts: number;
  ai: { items: number; completed: number; chunks: number } | null;
  text: TextStats | null;
  /** Identical-text group ("T3"), null when the text is unique or absent. */
  textGroup: string | null;
  catalog: 'fresh' | 'stale' | 'missing' | null;
  privileged: boolean | null;
  privateCopy: boolean;
  /** Control numbers of other live documents holding the same file. */
  copies: string[];
  audit: Record<string, number>;
  cited: number;
  retrieved: number;
  probe: ProbeResult | null;
  status: Status;
  reasons: string[];
  notes: string[];
}

/** Exclusions by design: these files stay in the room but never reach the index. */
export const BY_DESIGN = new Set(['agent file', 'room data file', 'privileged office file', 'saved draft']);
const INDEX_KEY = /^text\/([0-9a-f-]{36})\.p([1-9][0-9]*)\.md$/;

/** Whether a document's text is indexed, or why not (the same rules as indexjob.ts indexWork). */
export function indexability(rel: string, kind: Kind): true | string {
  if (isAgentFile(rel)) return 'agent file';
  if (isHiddenName(path.posix.basename(rel))) return 'room data file';
  if (isPrivilegedOffice(rel)) return 'privileged office file';
  if (isDraft(rel)) return 'saved draft';
  if (indexSource(kind, rel)) return true;
  const ext = path.posix.extname(rel).toLowerCase();
  return `${ext || kind} not indexable`;
}

/** Page statistics and a text fingerprint for extracted or direct pages. */
export function textStats(pages: readonly ExtractedPage[], version: number | null): TextStats {
  const flat = pages.map((page) => page.text.replace(/\s+/g, ' ').trim());
  const all = flat.join('\n').trim();
  return {
    version,
    pages: pages.length,
    blankPages: flat.filter((text) => text === '').length,
    ocrPages: pages.filter((page) => page.ocr).length,
    chars: flat.map((text) => text.length),
    textHash: all ? createHash('sha256').update(all).digest('hex').slice(0, 16) : null,
  };
}

/** Part numbers per document id in legallas-index, and the count of keys that are not document parts. */
export function parseIndexKeys(keys: readonly string[]): { parts: Map<string, number[]>; other: number } {
  const parts = new Map<string, number[]>();
  let other = 0;
  for (const key of keys) {
    const match = INDEX_KEY.exec(key);
    if (!match) {
      other += 1;
      continue;
    }
    const id = match[1]!; // safe: the pattern has both groups
    parts.set(id, [...(parts.get(id) ?? []), Number(match[2])]);
  }
  return { parts, other };
}

function tabOf(rel: string): string {
  const slash = rel.indexOf('/');
  return slash < 0 ? '(root)' : rel.slice(0, slash);
}

interface Context {
  inputs: CoverageInputs;
  live: Map<string, DocRow>;
  parts: Map<string, number[]>;
  controlsBySha: Map<string, string[]>;
  groups: Map<string, string>;
}

function aiFor(ctx: Context, id: string, parts: readonly number[]): CoverageRow['ai'] {
  if (parts.length === 0) return null;
  const items = parts.map((n) => ctx.inputs.aiItems.get(`text/${id}.p${n}.md`)).filter((item): item is AiItem => item !== undefined);
  return { items: items.length, completed: items.filter((item) => item.status === 'completed').length, chunks: items.reduce((sum, item) => sum + item.chunks, 0) };
}

function manifestFor(ctx: Context, id: string, file: RoomFile, kind: Kind): CoverageRow['manifest'] {
  const entry = ctx.inputs.manifest[id];
  if (!entry) return null;
  const extracted = indexSource(kind, file.rel) === 'extractor';
  const version = extracted ? (entry.extractor ?? null) : (entry.render ?? null);
  const wanted = extracted ? EXTRACTOR_VERSION : renderVersion(path.posix.basename(file.rel));
  return { parts: entry.parts, version, fresh: entry.sha256 === file.sha256 && version === wanted };
}

/** Why an indexable document is not (fully) in the index, in the order sync would fix it. */
function indexGaps(row: CoverageRow, file: RoomFile, entry: IndexManifest[string] | undefined): string[] {
  const gaps: string[] = [];
  if (!row.manifest || !entry) gaps.push('not in index manifest');
  else if (entry.sha256 !== file.sha256) gaps.push('index manifest stale');
  else if (!row.manifest.fresh) gaps.push('indexed by an older extractor');
  if (row.indexParts === 0) gaps.push(`missing from ${STORED_NAME}-index`);
  else if (row.manifest && row.indexParts !== row.manifest.parts) gaps.push('index part count differs');
  if (row.ai && row.ai.items < row.indexParts) gaps.push('not in AI Search');
  else if (row.ai && row.ai.completed < row.ai.items) gaps.push('AI Search not completed');
  if (row.text && row.text.textHash === null) gaps.push('no text');
  return gaps;
}

function baseRow(zone: Zone, rel: string, kind: Kind): CoverageRow {
  return {
    zone, tab: tabOf(rel), path: rel, kind, id: null, control: '', sha256: null, shaMatch: null, inD1: false, inFiles: null,
    indexable: indexability(rel, kind), manifest: null, indexParts: 0, ai: null, text: null, textGroup: null, catalog: null,
    privileged: null, privateCopy: false, copies: [], audit: {}, cited: 0, retrieved: 0, probe: null, status: 'OK', reasons: [], notes: [],
  };
}

function withDoc(ctx: Context, row: CoverageRow, doc: DocRow): void {
  const { inputs } = ctx;
  const parts = ctx.parts.get(doc.id) ?? [];
  row.id = doc.id;
  row.control = formatControl(inputs.prefix, doc.control_seq);
  row.inD1 = true;
  row.inFiles = inputs.filesKeys.has(doc.r2_key);
  row.indexParts = parts.length;
  row.ai = aiFor(ctx, doc.id, parts);
  row.audit = inputs.audit.get(doc.id) ?? {};
  row.cited = inputs.cites.get(doc.id) ?? 0;
  row.retrieved = inputs.retrieved.get(doc.id) ?? 0;
  row.probe = inputs.probe?.get(doc.id) ?? null;
  if (!row.inFiles) row.reasons.push(`missing from ${STORED_NAME}-files`);
  const others = (ctx.controlsBySha.get(doc.sha256 ?? '') ?? []).filter((control) => control !== (row.control || doc.id));
  if (others.length > 0) {
    row.copies = others;
    row.notes.push(`same file as ${others.length} other${others.length === 1 ? '' : 's'}`);
  }
}

function hasVisualText(filesKeys: ReadonlySet<string>, sha256: string): boolean {
  return /^[0-9a-f]{64}$/.test(sha256) && filesKeys.has(visualAiKey(sha256, 'txt'));
}

function roomRow(ctx: Context, file: RoomFile): CoverageRow {
  const { inputs } = ctx;
  const kind = kindOf(path.posix.basename(file.rel)).kind;
  const row = baseRow('room', file.rel, kind);
  row.sha256 = file.sha256;
  row.text = inputs.text.get(file.rel) ?? null;
  row.textGroup = row.text?.textHash ? (ctx.groups.get(row.text.textHash) ?? null) : null;
  row.privateCopy = inputs.privateShas.has(file.sha256);
  const entry = inputs.catalog.get(file.rel);
  row.catalog = entry ? (entry.md5 === file.md5 && (entry.size === null || entry.size === file.size) ? 'fresh' : 'stale') : 'missing';
  row.privileged = entry?.privileged ?? null;
  const doc = ctx.live.get(file.rel);
  if (!doc) {
    row.reasons.push('not in D1');
  } else {
    row.shaMatch = doc.sha256 === file.sha256;
    if (!row.shaMatch) row.reasons.push('D1 sha differs (sync pending)');
    withDoc(ctx, row, doc);
    row.manifest = manifestFor(ctx, doc.id, file, kind);
    if (row.indexable === true) row.reasons.push(...indexGaps(row, file, inputs.manifest[doc.id]));
    else if (row.indexParts > 0) row.reasons.push('indexed but excluded');
    // A visual's text reaches AIs through its side file too (decision D8), not only through the index.
    if (row.indexable === true && kind === 'visual' && !hasVisualText(inputs.filesKeys, file.sha256)) row.reasons.push('visual text not in legallas-files');
    if (row.probe?.unfindable) row.reasons.push('unfindable');
  }
  if (typeof row.indexable === 'string' && !BY_DESIGN.has(row.indexable)) row.reasons.push(row.indexable);
  if (row.catalog !== 'fresh') row.notes.push(row.catalog === 'stale' ? 'catalog md5 stale' : 'no catalog row');
  if (row.privileged) row.notes.push('privileged');
  if (row.privateCopy) row.notes.push('private copy exists');
  if (row.textGroup) row.notes.push(`identical text (${row.textGroup})`);
  if (row.text && row.text.blankPages > 0 && row.text.textHash !== null) row.notes.push(`${row.text.blankPages} of ${row.text.pages} pages blank`);
  return row;
}

function docOnlyRow(ctx: Context, doc: DocRow): CoverageRow {
  const counsel = doc.source === 'counsel';
  const row = baseRow(counsel ? 'counsel' : 'd1-only', doc.path, kindOf(doc.name).kind);
  row.sha256 = doc.sha256;
  withDoc(ctx, row, doc);
  if (counsel) row.indexable = 'counsel upload';
  else row.reasons.push('not on disk (sync removes it)');
  return row;
}

function outsideRow(ctx: Context, file: OutsideFile): CoverageRow {
  const row = baseRow('case-root', file.rel, kindOf(path.posix.basename(file.rel)).kind);
  row.sha256 = file.sha256;
  row.copies = ctx.controlsBySha.get(file.sha256) ?? [];
  row.privateCopy = ctx.inputs.privateShas.has(file.sha256);
  if (row.indexable === 'agent file') row.notes.push('agent file');
  else if (row.copies.length === 0) row.reasons.push('no room copy');
  if (row.privateCopy) row.notes.push('private copy exists');
  return row;
}

/** Identical-text groups ("T1" largest first) over room files with text, keyed by text hash. */
export function textGroups(room: readonly RoomFile[], text: ReadonlyMap<string, TextStats>): Map<string, string> {
  const members = new Map<string, number>();
  for (const file of room) {
    const hash = text.get(file.rel)?.textHash;
    if (hash) members.set(hash, (members.get(hash) ?? 0) + 1);
  }
  const shared = [...members].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return new Map(shared.map(([hash], i) => [hash, `T${i + 1}`]));
}

/** Every row of the coverage table: room files, then live D1 rows with no file, counsel uploads and case-root files. */
export function buildCoverage(inputs: CoverageInputs): CoverageRow[] {
  const liveRows = inputs.rows.filter((row) => row.removed_at === null);
  const live = new Map(liveRows.filter((row) => row.source === 'mirror').map((row) => [row.path, row]));
  const controlsBySha = new Map<string, string[]>();
  for (const row of liveRows) {
    if (row.sha256) controlsBySha.set(row.sha256, [...(controlsBySha.get(row.sha256) ?? []), formatControl(inputs.prefix, row.control_seq) || row.id]);
  }
  const ctx: Context = { inputs, live, parts: parseIndexKeys(inputs.indexKeys).parts, controlsBySha, groups: textGroups(inputs.room, inputs.text) };
  const onDisk = new Set(inputs.room.map((file) => file.rel));
  const rows = [
    ...inputs.room.map((file) => roomRow(ctx, file)),
    ...liveRows.filter((doc) => doc.source !== 'mirror' || !onDisk.has(doc.path)).map((doc) => docOnlyRow(ctx, doc)),
    ...inputs.outside.map((file) => outsideRow(ctx, file)),
  ];
  for (const row of rows) row.status = row.reasons.length > 0 ? 'GAP' : 'OK';
  return rows;
}
