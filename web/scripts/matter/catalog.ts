// SPDX-License-Identifier: Apache-2.0
// Card F4. Reads 00-Orientation/Document_Catalog.csv into per-path document facts: the date (the filename
// convention first, then key_dates), the type (the convention's DocType), the summary and the privilege flag.
// Summaries that still carry a note about the owner's filing work are flagged for the report (INTERNAL_NOTES, plus
// the room config's internalNotes).
// The catalog's path column may be relative to sourceRoot, absolute under it, or start with sourceRoot's own
// folder name; every form becomes the documents.path spelling (NFC, '/'-separated, relative to sourceRoot).
import path from 'node:path';
import type { DocFacts, PartialDate } from '../../worker/matter-types.ts';

/** The path of the document catalog inside the source folder. */
export const CATALOG_REL = '00-Orientation/Document_Catalog.csv';
/** The columns of the document catalog CSV. */
export const CATALOG_COLUMNS = [
  'path', 'bucket', 'filename', 'ext', 'size_bytes', 'md5', 'dup_status', 'privilege', 'content_summary', 'key_dates', 'key_parties', 'reviewed',
] as const;

/** Parses RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('Document catalog: unterminated quoted field');
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function validDate(y: number, m: number, d: number | null): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12) return false;
  if (d === null) return true;
  return d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The first date in free text, as a partial ISO date: 2012-10-17, 2012-10, 20121017 or 10/17/2012. */
export function firstDate(text: string): PartialDate | null {
  const patterns: [RegExp, (m: RegExpMatchArray) => [number, number, number | null]][] = [
    [/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => [+m[1], +m[2], +m[3]]],
    [/\b(\d{4})(\d{2})(\d{2})\b/, (m) => [+m[1], +m[2], +m[3]]],
    [/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/, (m) => [+m[3], +m[1], +m[2]]],
    [/\b(\d{4})-(\d{2})\b(?!-\d)/, (m) => [+m[1], +m[2], null]],
  ];
  let best: { at: number; value: PartialDate } | null = null;
  for (const [pattern, parts] of patterns) {
    const match = pattern.exec(text);
    if (!match || match.index === undefined) continue;
    const [y, m, d] = parts(match);
    if (!validDate(y, m, d)) continue;
    const value = d === null ? `${y}-${pad(m)}` : `${y}-${pad(m)}-${pad(d)}`;
    if (!best || match.index < best.at) best = { at: match.index, value };
  }
  return best?.value ?? null;
}

/** Facts read from a file name: its type and date. */
export interface FilenameFacts {
  type: string | null;
  date: PartialDate | null;
}

/**
 * The convention DocType_Abbr__YYYYMMDD__Party__Qualifier: segments split on "__". The type is the first
 * segment without its Abbr, underscores read as spaces; the date is the first segment that is a valid YYYYMMDD,
 * or the last day of a YYYYMMDD-YYYYMMDD range.
 * A name without "__" follows no convention and yields nothing.
 */
export function parseFilename(name: string): FilenameFacts {
  const base = path.posix.basename(name).replace(/\.[^.]*$/, '');
  const segments = base.split('__');
  if (segments.length < 2) return { type: null, date: null };
  // "Supply_Agreement_SA": a trailing all-caps part is the Abbr, not part of the type.
  const words = segments[0].split('_').filter(Boolean);
  if (words.length > 1 && /^[A-Z0-9]{2,6}$/.test(words.at(-1) ?? '')) words.pop();
  const head = words.join(' ').trim();
  // A work-product marker ("Claim_Chart__WP__...") stays visible in the type, where worker/matter.ts
  // isWorkProductType sees it and refuses money taken from the file.
  const marked = segments.slice(1).some((segment) => /^(?:A?WP|AC-?WP)$/i.test(segment));
  const type = head ? clip(marked ? `${head} (work product)` : head, MAX_TYPE) : null;
  // A date segment is YYYYMMDD or a range YYYYMMDD-YYYYMMDD; a range dates the file by its last day.
  for (const segment of segments.slice(1)) {
    const match = /^(\d{4})(\d{2})(\d{2})(?:-(\d{4})(\d{2})(\d{2}))?$/.exec(segment);
    if (!match) continue;
    const [y, m, d] = match[4] ? [match[4], match[5], match[6]] : [match[1], match[2], match[3]];
    const startOk = validDate(+match[1], +match[2], +match[3]);
    if (startOk && validDate(+y, +m, +d)) return { type, date: `${y}-${m}-${d}` };
  }
  return { type, date: null };
}

const NOT_PRIVILEGED = /^\s*(?:|none|no|n\/a|na|-|false|public|not privileged|non[- ]?privileged)\s*$/i;
const PRIVILEGE_WORDS = /privileg|attorney|work[- ]?product|\bAC\b|\bWP\b|\bAEO\b|\byes\b|\btrue\b/i;

/** True when the privilege column claims a privilege, or any folder segment of the path says PRIVILEGED. */
export function isPrivileged(privilege: string, docPath: string): boolean {
  const folders = docPath.split('/').slice(0, -1);
  if (folders.some((segment) => /privileged/i.test(segment) && !/\bnon[- ]?privileged|not[- ]privileged/i.test(segment))) return true;
  if (NOT_PRIVILEGED.test(privilege)) return false;
  return PRIVILEGE_WORDS.test(privilege) && !/\b(?:not|non)[- ]?privileg/i.test(privilege);
}

/** The documents.path spelling of a catalog path, or null when it points outside sourceRoot. */
export function normalizeCatalogPath(raw: string, sourceRoot: string): string | null {
  let value = raw.trim().replace(/\\/g, '/').normalize('NFC');
  if (value === '') return null;
  const root = sourceRoot.replace(/\\/g, '/').replace(/\/+$/, '').normalize('NFC');
  const rootName = path.posix.basename(root);
  if (value.startsWith(`${root}/`)) value = value.slice(root.length + 1);
  else if (value.startsWith('/')) return null;
  else if (value.startsWith(`${rootName}/`)) value = value.slice(rootName.length + 1);
  value = value.replace(/^\.\//, '');
  const clean = path.posix.normalize(value);
  if (clean.startsWith('../') || clean === '..' || clean === '.') return null;
  return clean;
}

/** The longest summary and type worker/matter.ts accepts. */
export const MAX_SUMMARY = 1200;
/** The longest document type kept, in characters. */
export const MAX_TYPE = 80;

/** A catalog summary within MAX_SUMMARY, cut at a word boundary with an ellipsis; null when empty. */
export function clip(text: string, max = MAX_SUMMARY): string | null {
  const trimmed = text.normalize('NFC').trim();
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}\u2026`;
}

/** An internal-note rule: the note and the pattern that triggers it. */
export interface InternalNote {
  note: string;
  pattern: RegExp;
}

/**
 * Notes about the owner's own filing work that should never reach a summary counsel reads: a row nobody has
 * summarized yet, and a sentence about a file being renamed or moved. A rename or move counts only at the start of a
 * sentence, so a sentence about a tenant who moved from another town stays a fact. A room adds the notes its own
 * catalog uses with internalNotes in the room config (scripts/config.ts). The build lists them in the report and never
 * refuses a catalog for them.
 */
export const INTERNAL_NOTES: readonly InternalNote[] = [
  { note: 'not yet summarized', pattern: /\bnot yet summari[sz]ed\b/i },
  { note: 'rename or move', pattern: /(?:^|[.;:]\s+)(?:renamed|moved from)\b/i },
];

/** The internal notes a summary carries: the room's own in their order, then INTERNAL_NOTES in theirs. */
export function internalNotes(summary: string, roomNotes: readonly InternalNote[] = []): string[] {
  return [...roomNotes, ...INTERNAL_NOTES].filter(({ pattern }) => pattern.test(summary)).map(({ note }) => note);
}

/** A note attached to a catalog row. */
export interface CatalogNote {
  note: string;
  /** documents.path of the catalog row. */
  path: string;
}

/** What reading the catalog yields, including the facts of each document by path. */
export interface CatalogResult {
  /** Facts by documents.path. */
  docs: Map<string, DocFacts>;
  rows: number;
  /** Rows whose path was empty or outside sourceRoot. */
  skipped: number;
  /** One per internal note per row, in catalog order. Flags only: they never fail a build or `check`. */
  notes: CatalogNote[];
}

function header(rows: string[][]): Map<string, number> {
  const names = (rows[0] ?? []).map((name) => name.trim().toLowerCase());
  const missing = CATALOG_COLUMNS.filter((column) => !names.includes(column));
  if (missing.length > 0) throw new Error(`Document catalog: missing column(s) ${missing.join(', ')}`);
  return new Map(names.map((name, index) => [name, index]));
}

/** Parses the catalog. Facts from the filename convention win for the date; key_dates fill in when it has none. */
export function parseCatalog(text: string, sourceRoot: string, roomNotes: readonly InternalNote[] = []): CatalogResult {
  const rows = parseCsv(text);
  const col = header(rows);
  const get = (row: string[], name: string) => (row[col.get(name) ?? -1] ?? '').trim();
  const docs = new Map<string, DocFacts>();
  const notes: CatalogNote[] = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const docPath = normalizeCatalogPath(get(row, 'path'), sourceRoot);
    if (!docPath) { skipped += 1; continue; }
    const name = get(row, 'filename') || docPath;
    const fromName = parseFilename(name);
    const summary = get(row, 'content_summary');
    for (const note of internalNotes(summary, roomNotes)) notes.push({ note, path: docPath });
    docs.set(docPath, {
      date: fromName.date ?? firstDate(get(row, 'key_dates')),
      type: fromName.type,
      from: [],
      to: [],
      summary: clip(summary),
      privileged: isPrivileged(get(row, 'privilege'), docPath),
    });
  }
  return { docs, rows: rows.length - 1, skipped, notes };
}
