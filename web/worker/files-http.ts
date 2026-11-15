// SPDX-License-Identifier: Apache-2.0
// The HTTP side of /files/:id: byte ranges (PDF.js reads large PDFs in pieces), a Content-Disposition
// that hostile filenames cannot break, and the rule for whether a file is shown inline, run as a
// visual, or forced to download.
import type { Action } from './auth.ts';

export type ByteRange =
  | { kind: 'full' }
  | { kind: 'partial'; offset: number; length: number }
  | { kind: 'unsatisfiable' };

const FULL: ByteRange = { kind: 'full' };
const UNSATISFIABLE: ByteRange = { kind: 'unsatisfiable' };
const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/i;

/**
 * Reads a single-range `Range` header against a file of `size` bytes (RFC 9110, section 14). A missing,
 * malformed or multi-range header is ignored, so the whole file is sent with 200, as the RFC allows.
 * A well-formed range that starts at or past the end cannot be satisfied (416).
 */
export function parseRange(header: string | null, size: number): ByteRange {
  if (!header) return FULL;
  const match = SINGLE_RANGE.exec(header.trim());
  if (!match) return FULL;
  const [, startText = '', endText = ''] = match;
  if (startText === '' && endText === '') return FULL;

  if (startText === '') {
    // Suffix range: the last N bytes.
    const suffix = Number(endText);
    if (suffix === 0 || size === 0) return UNSATISFIABLE;
    const length = Math.min(suffix, size);
    return { kind: 'partial', offset: size - length, length };
  }

  const start = Number(startText);
  if (endText !== '' && Number(endText) < start) return FULL;
  if (start >= size) return UNSATISFIABLE;
  const last = endText === '' ? size - 1 : Math.min(Number(endText), size - 1);
  return { kind: 'partial', offset: start, length: last - start + 1 };
}

/** The Content-Range value for a 206 response. */
export function contentRange(offset: number, length: number, size: number): string {
  return `bytes ${offset}-${offset + length - 1}/${size}`;
}

// Control and format characters (newlines, NUL, bidi overrides, zero-width joiners) and line separators.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const MAX_FILENAME = 200;

/** A display filename safe to hand to a browser: NFC, no invisible characters, no path separators. */
export function cleanFilename(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/[/\\]/g, '_')
    .trim()
    .replace(/^\.+/, '');
  const capped = Array.from(cleaned).slice(0, MAX_FILENAME).join('').trim();
  return capped || 'download';
}

// RFC 5987 attr-char allows a few marks that encodeURIComponent leaves alone; the quote and parentheses
// would end or confuse the parameter, so they are percent-encoded too.
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * `attachment` with a plain ASCII fallback and an RFC 5987 `filename*`, so quotes, semicolons, CRLF
 * and non-ASCII names can neither break the header nor inject parameters.
 */
export function attachment(name: string): string {
  const clean = cleanFilename(name);
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${rfc5987(clean)}`;
}

/** How one /files response is delivered, which permission it needs, and what (if anything) to audit. */
export interface Delivery {
  /** visual: runs in the script-only sandbox. inline: bytes for a viewer. attachment: a download. */
  mode: 'visual' | 'inline' | 'attachment';
  action: Action;
  audit: 'view' | 'download' | null;
}

// Requests a viewer makes for itself: fetch() and XHR (PDF.js, text viewers) and <img>.
// A missing header (non-browser clients, older browsers) is also treated as a viewer read.
const VIEWER_DESTINATIONS = new Set(['', 'empty', 'image']);

/**
 * The single rule for /files/:id.
 * - Mirrored HTML visuals run under the `visual` CSP ONLY when the room frames them (Sec-Fetch-Dest:
 *   iframe). Opened any other way, in its own tab above all, a visual is a download: outside the room's
 *   frame-src a page could navigate itself to a tracker. Counsel-uploaded HTML never runs.
 * - `?download` is an explicit download: attachment and a `download` row.
 * - A top-level open (Sec-Fetch-Dest: document) or a frame, embed or object is also an attachment, so
 *   the browser never renders a document itself.
 * - Reads by the room's own viewers are inline and audited as `view`. Every read is audited so a script
 *   pulling files straight from /files still leaves a trail; routes/files.ts deduplicates per member,
 *   document and action, because PDF.js makes many range requests for one document.
 */
export function deliveryFor(doc: { kind: string; source: string }, dest: string | null, download: boolean): Delivery {
  const destination = (dest ?? '').toLowerCase();
  const isHtml = doc.kind === 'visual';
  if (isHtml && doc.source === 'mirror' && !download && destination === 'iframe') {
    return { mode: 'visual', action: 'view', audit: 'view' };
  }
  if (isHtml || download || !VIEWER_DESTINATIONS.has(destination)) {
    return { mode: 'attachment', action: 'download', audit: 'download' };
  }
  return { mode: 'inline', action: 'view', audit: 'view' };
}

/**
 * The Content-Type for an inline viewer read. PDFs and images keep their type (an <img> needs it);
 * text-like kinds are plain text, so nothing a viewer fetches can be treated as markup.
 */
export function inlineContentType(kind: string, stored: string): string {
  if (kind === 'pdf' || kind === 'image') return stored;
  if (kind === 'markdown' || kind === 'csv' || kind === 'text') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}
