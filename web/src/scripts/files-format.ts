// SPDX-License-Identifier: Apache-2.0
// Plain-language formatting shared by the case files, document and inbox pages and the exhibit pane, plus the
// passage matching behind every highlight (card F7).
import { formatPartialDate } from './doc-facts.ts';

const UNITS = ['KB', 'MB', 'GB'] as const;

/** 0 bytes, 912 bytes, 14 KB, 3.2 MB: one decimal below 10, whole numbers above. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1000) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  let value = bytes;
  let unit: (typeof UNITS)[number] = 'KB';
  for (const next of UNITS) {
    value /= 1000;
    unit = next;
    if (value < 1000) break;
  }
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value)} ${unit}`;
}

/** Counts a noun with thousands separators, so 1 reads "1 file" and 1200 reads "1,200 files". */
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? word : many}`;
}

/** "Oct. 6, 2026" (DESIGN.md prose dates) on the reader's calendar; '' for anything unparseable. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return formatPartialDate(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
}

/** "Oct. 6, 2026, 3:05 PM": the prose date and the reader's local time; '' for anything unparseable. */
export function formatDateTime(iso: string): string {
  const day = formatDate(iso);
  if (!day) return '';
  const time = new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time.replace(/\s+/gu, ' ')}`;
}

const EXTENSION_LABELS: Record<string, string> = {
  pdf: 'PDF',
  png: 'PNG image',
  jpg: 'JPEG image',
  jpeg: 'JPEG image',
  gif: 'GIF image',
  webp: 'WebP image',
  svg: 'SVG image',
  md: 'Markdown',
  csv: 'CSV table',
  txt: 'Text',
  xml: 'XML',
  json: 'JSON',
  jsx: 'Source code',
  eml: 'Email',
  html: 'Visual',
  htm: 'Visual',
  docx: 'Word document',
  doc: 'Word document',
  xlsx: 'Excel workbook',
  xls: 'Excel workbook',
  pptx: 'PowerPoint deck',
  ppt: 'PowerPoint deck',
  key: 'Keynote deck',
  pages: 'Pages document',
  numbers: 'Numbers sheet',
  zip: 'ZIP archive',
};

/** The lowercase file extension of a name, or an empty string when it has none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** A human label for a file's type, from its extension. */
export function typeLabel(name: string): string {
  const ext = extensionOf(name);
  return Object.hasOwn(EXTENSION_LABELS, ext) ? EXTENSION_LABELS[ext]! : ext ? `${ext.toUpperCase()} file` : 'File';
}

const APPLE_APPS: Record<string, string> = { pages: 'Pages', numbers: 'Numbers', key: 'Keynote' };

/** Where a file the room cannot show opens, when its own app may not be at hand: Apple makes no Windows app for these. */
export function whereItOpens(name: string): string | null {
  const ext = extensionOf(name);
  return Object.hasOwn(APPLE_APPS, ext) ? `Opens in ${APPLE_APPS[ext]} on a Mac, or at iCloud.com.` : null;
}

/** Lowercase, accent-free text for matching, so "resume" finds "Résumé". */
export function foldForSearch(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Every whitespace-separated term of `query` appears in `haystack` (already folded). */
export function matchesQuery(haystack: string, query: string): boolean {
  const terms = foldForSearch(query).split(/\s+/).filter(Boolean);
  return terms.every((term) => haystack.includes(term));
}

/** The longest passage the room highlights (R10 caps quotes at 200 characters). */
export const QUOTE_MAX = 200;

/**
 * A quoted passage as the room carries it: soft hyphens dropped, whitespace collapsed, trimmed, and cut to
 * QUOTE_MAX at a word boundary. '' for nothing.
 */
export function normalizeQuote(raw: string | null | undefined): string {
  const text = (raw ?? '').replace(/­/g, '').replace(/\s+/g, ' ').trim();
  if (text.length <= QUOTE_MAX) return text;
  const cut = text.slice(0, QUOTE_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > QUOTE_MAX / 2 ? cut.slice(0, space) : cut).trim();
}

/**
 * The quote as a PDF.js find query. PDF.js joins a word broken across lines ("deliv-\nery" reads "delivery"), so
 * a quote taken from extracted text ("deliv- ery") is joined the same way; a non-breaking hyphen is a hyphen.
 */
export function pdfFindQuery(quote: string): string {
  return normalizeQuote(quote)
    .replace(/‑/g, '-')
    .replace(/(\p{Ll})-\s+(?=\p{Ll})/gu, '$1');
}

const SINGLE_QUOTES = new Set(['‘', '’', '‚', '‛']);
const DOUBLE_QUOTES = new Set(['“', '”', '„', '‟']);

/** One character as matching sees it: lower case, straight quotes, one hyphen, any whitespace as a space. */
function foldChar(ch: string): string {
  if (ch === '­') return '';
  if (/\s/u.test(ch)) return ' ';
  if (ch === '‐' || ch === '‑') return '-';
  if (SINGLE_QUOTES.has(ch)) return "'";
  if (DOUBLE_QUOTES.has(ch)) return '"';
  return ch.toLowerCase();
}

interface Folded {
  text: string;
  /** For each UTF-16 unit of `text`, the source range [start, end) it came from. */
  start: number[];
  end: number[];
}

function foldForMatch(source: string): Folded {
  const out: Folded = { text: '', start: [], end: [] };
  for (let i = 0; i < source.length; ) {
    const ch = String.fromCodePoint(source.codePointAt(i)!); // safe: i < length
    const folded = foldChar(ch);
    if (!(folded === ' ' && out.text.endsWith(' '))) {
      for (let k = 0; k < folded.length; k += 1) {
        out.start.push(i);
        out.end.push(i + ch.length);
      }
      out.text += folded;
    }
    i += ch.length;
  }
  return out;
}

/**
 * Where `quote` first appears in `text`, ignoring case, curly quotes, soft hyphens and runs of whitespace.
 * Offsets are into `text` (end exclusive), so the caller can wrap exactly that span. Null when it is absent.
 */
export function locateQuote(text: string, quote: string): { start: number; end: number } | null {
  const needle = foldForMatch(normalizeQuote(quote)).text;
  if (!needle) return null;
  const hay = foldForMatch(text);
  const at = hay.text.indexOf(needle);
  if (at < 0) return null;
  return { start: hay.start[at]!, end: hay.end[at + needle.length - 1]! };
}

/** "Page 3 of 14"; "14 pages" with no current page; '' when the count is unknown. */
export function pageLabel(page: number | null, total: number | null): string {
  if (!total) return page ? `Page ${page}` : '';
  return page ? `Page ${Math.min(page, total)} of ${total}` : plural(total, 'page');
}

/** "Acme Bank, N.A. → Harbor Labs, Inc." for the pane's meta line; one side alone reads "From …" or "To …". */
export function partyLine(from: readonly string[], to: readonly string[]): string {
  const a = from.join(', ');
  const b = to.join(', ');
  if (a && b) return `${a} → ${b}`;
  if (a) return `From ${a}`;
  return b ? `To ${b}` : '';
}
