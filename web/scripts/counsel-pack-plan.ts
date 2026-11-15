// SPDX-License-Identifier: Apache-2.0
// The pure half of the counsel pack: which D1 rows counsel may see, where each lands in the pack, and the
// INDEX.csv, README.txt and manifest the pack writes next to the documents. No filesystem access here.
import path from 'node:path';
import { isHiddenName, NOT_HIDDEN_SQL } from '../worker/files-catalog.ts';
import { isPrivateSegment } from './guard.ts';
import { roomHost } from '../worker/room-settings.ts';

/** The room's origin; matches ROOM_ORIGIN in mcp/contract.ts. */
export const ROOM_ORIGIN = `https://${roomHost}`;
export const INDEX_NAME = 'INDEX.csv';
export const README_NAME = 'README.txt';
export const MANIFEST_NAME = '.counsel-pack-manifest.json';
/** Written only with --questions: the checklist's open points for counsel (worker/checklist-questions.ts). */
export const QUESTIONS_NAME = 'QUESTIONS-FOR-YOUR-LAWYER.md';
/** Counsel uploads land in this folder of the pack, as the room shows them. */
export const UPLOADS_FOLDER = 'from-counsel';

const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const MANIFEST_VERSION = 1;

/** Live mirror rows counsel can see in the room. The same filter as MIRROR_ROWS_SQL plus the hidden names. */
export const PACK_MIRROR_SQL =
  'SELECT id, path, name, sha256, size, pages, control_seq FROM documents ' +
  `WHERE source = 'mirror' AND removed_at IS NULL AND ${NOT_HIDDEN_SQL} ORDER BY path;`;

/** Live counsel uploads, only read with --include-uploads. */
export const PACK_UPLOADS_SQL =
  'SELECT id, name, size, pages, control_seq, etag, r2_key, sha256 FROM documents ' +
  `WHERE source = 'counsel' AND removed_at IS NULL AND ${NOT_HIDDEN_SQL} ORDER BY control_seq, id;`;

/** One document the pack should hold. */
export interface PackRow {
  id: string;
  /** Path inside the pack ('/'-separated, NFC). For mirror rows this is documents.path. */
  rel: string;
  name: string;
  size: number;
  pages: number | null;
  controlSeq: number | null;
  source: 'mirror' | 'counsel';
  /** The hex sha256 D1 holds: the sync helper's for mirror rows, the room's at intake for uploads (null for older ones). */
  sha256: string | null;
  /** Counsel rows only: the R2 key and etag. */
  r2Key: string | null;
  etag: string | null;
}

/** One file the pack wrote, as the manifest records it. */
export interface ManifestEntry {
  id: string;
  sha256: string;
  size: number;
  mtimeMs: number;
  /** Counsel uploads: the etag downloaded, so an unchanged upload is not fetched again. */
  etag?: string;
}

/** The zip beside --out that the pack wrote, so a later run overwrites only its own zip. */
export interface ZipRecord {
  size: number;
  mtimeMs: number;
}

export interface Manifest {
  version: number;
  files: Record<string, ManifestEntry>;
  zip?: ZipRecord;
}

/** "<PREFIX>-000123" like the room, or '' before a document is numbered. */
export function formatControl(prefix: string, seq: number | null): string {
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return '';
  return `${prefix}-${String(seq).padStart(6, '0')}`;
}

/** The room page for a document, as mcp/format.ts docLink builds it. */
export function roomLink(id: string): string {
  return `${ROOM_ORIGIN}/doc/?id=${encodeURIComponent(id)}`;
}

/**
 * True when `rel` is a plain relative path the pack may write: no empty, '.' or '..' segments, no leading
 * slash, no backslash, no control characters and no private segment.
 */
export function isSafeRel(rel: string): boolean {
  if (rel === '' || rel.startsWith('/') || rel.includes('\\') || CONTROL.test(rel)) return false;
  return rel.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..' && !isPrivateSegment(segment));
}

/** True when `rel` is one of the files the pack itself writes at its root. */
export function isReservedRel(rel: string): boolean {
  const lower = rel.toLowerCase();
  return [INDEX_NAME, README_NAME, MANIFEST_NAME, QUESTIONS_NAME].some((name) => name.toLowerCase() === lower);
}

function text(raw: Record<string, unknown>, key: string): string | null {
  return typeof raw[key] === 'string' ? (raw[key] as string) : null;
}

function int(raw: Record<string, unknown>, key: string): number | null {
  const value = raw[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** A D1 mirror row, or null when it is hidden, malformed or points somewhere the pack must not write. */
export function mirrorRow(raw: Record<string, unknown>): PackRow | null {
  const id = text(raw, 'id');
  const rel = text(raw, 'path')?.normalize('NFC') ?? null;
  const name = text(raw, 'name');
  const sha256 = text(raw, 'sha256');
  const size = int(raw, 'size');
  if (!id || !rel || !name || size === null || !sha256 || !SHA256.test(sha256)) return null;
  if (isHiddenName(name) || isHiddenName(path.posix.basename(rel)) || !isSafeRel(rel) || isReservedRel(rel)) return null;
  return { id, rel, name, size, pages: int(raw, 'pages'), controlSeq: int(raw, 'control_seq'), source: 'mirror', sha256, r2Key: null, etag: null };
}

/** A D1 counsel-upload row; `rel` is filled in later (the name comes from counsel and is sanitized). */
export function uploadRow(raw: Record<string, unknown>): PackRow | null {
  const id = text(raw, 'id');
  const name = text(raw, 'name');
  const size = int(raw, 'size');
  const r2Key = text(raw, 'r2_key');
  if (!id || !name || size === null || !r2Key || isHiddenName(name)) return null;
  const stored = text(raw, 'sha256');
  const sha256 = stored && SHA256.test(stored) ? stored : null;
  return { id, rel: '', name, size, pages: int(raw, 'pages'), controlSeq: int(raw, 'control_seq'), source: 'counsel', sha256, r2Key, etag: text(raw, 'etag') };
}

/** One CSV field: quoted when needed, and a leading formula character neutralized for spreadsheets. */
export function csvField(value: string | number | null): string {
  let field = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(field)) field = `'${field}`;
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/** One line of INDEX.csv per packed document. */
export interface IndexLine {
  row: PackRow;
  sha256: string;
}

/**
 * INDEX.csv: control number, title, path, pages, sha256 and room link, sorted by control number then path.
 * It starts with a UTF-8 byte order mark so Excel reads accented titles as UTF-8.
 */
export function indexCsv(lines: readonly IndexLine[], prefix: string): string {
  const sorted = [...lines].sort((a, b) => (a.row.controlSeq ?? Infinity) - (b.row.controlSeq ?? Infinity) || (a.row.rel < b.row.rel ? -1 : 1));
  const header = ['control_number', 'title', 'path', 'pages', 'sha256', 'room_link'];
  const body = sorted.map(({ row, sha256 }) =>
    [formatControl(prefix, row.controlSeq), row.name, row.rel, row.pages, sha256, roomLink(row.id)].map(csvField).join(','),
  );
  return `\uFEFF${[header.join(','), ...body].join('\r\n')}\r\n`;
}

/** README.txt: what the pack is, that it is confidential, when it was taken and how to load it. */
export function readmeText(asOf: string, count: number, banner: string): string {
  return [
    'LEGALLAS COUNSEL PACK',
    '',
    `CONFIDENTIAL. ${banner}`.trim(),
    'Keep it inside the firm, on systems the matter team controls.',
    '',
    `This folder is a snapshot of the ${count} documents in the Legallas counsel room as of ${asOf}.`,
    `The counsel room at ${ROOM_ORIGIN} is the live source: documents added, changed or removed`,
    'after that date are only there. When the two disagree, the room is right.',
    '',
    `${INDEX_NAME} lists every document with its control number, title, path in this folder, page count,`,
    'SHA-256 checksum and a link that opens it in the room. Cite documents by control number.',
    '',
    'Loading it into Harvey',
    '  Create a Vault project for the matter and upload this whole folder, keeping its structure.',
    `  Include ${INDEX_NAME}, so answers can be matched to control numbers.`,
    '',
    'Loading it into SharePoint for Microsoft Copilot',
    '  Create a document library on a site that only the matter team can open, then upload this',
    '  folder into it (drag it into the library in a browser, or copy it in through OneDrive sync).',
    '  Copilot reads the documents for the people who can open that site.',
    '',
    `${MANIFEST_NAME} is bookkeeping for the next refresh; it does not need to be uploaded.`,
    'This folder is a snapshot of the room, not a working copy: edit copies elsewhere. A refresh',
    'replaces these files with the room\'s version and removes ones taken out of the room. Files',
    'added to this folder by anyone else are never touched.',
    '',
  ].join('\r\n');
}

/** An empty manifest for a new pack. */
export function emptyManifest(): Manifest {
  return { version: MANIFEST_VERSION, files: {} };
}

function validEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.sha256 === 'string' &&
    SHA256.test(entry.sha256) &&
    typeof entry.size === 'number' &&
    typeof entry.mtimeMs === 'number' &&
    (entry.etag === undefined || typeof entry.etag === 'string')
  );
}

/** Parses a manifest. Entries with an unsafe path or an unexpected shape are dropped, never acted on. */
export function parseManifest(json: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    // JSON.parse quotes the input around the error, which could be a path: never pass it on.
    throw new Error(`${MANIFEST_NAME} is damaged; move it and the pack aside and build a new pack`);
  }
  const files = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).files : null;
  if (typeof files !== 'object' || files === null || (raw as Record<string, unknown>).version !== MANIFEST_VERSION) {
    throw new Error(`${MANIFEST_NAME} is not a counsel pack manifest this version understands`);
  }
  const manifest = emptyManifest();
  for (const [rel, entry] of Object.entries(files)) {
    if (isSafeRel(rel) && !isReservedRel(rel) && validEntry(entry)) manifest.files[rel] = entry;
  }
  const zip = (raw as Record<string, unknown>).zip as Record<string, unknown> | undefined;
  if (zip && typeof zip.size === 'number' && typeof zip.mtimeMs === 'number') manifest.zip = { size: zip.size, mtimeMs: zip.mtimeMs };
  return manifest;
}

export function serializeManifest(manifest: Manifest): string {
  const files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => (a < b ? -1 : 1)));
  return `${JSON.stringify({ version: manifest.version, files, ...(manifest.zip ? { zip: manifest.zip } : {}) }, null, 2)}\n`;
}

/** True when `child` is `parent` or inside it. Both must be absolute and already resolved. */
export function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
