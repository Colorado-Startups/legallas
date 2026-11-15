// SPDX-License-Identifier: Apache-2.0
// Page-tagged text for the AI Search index (bucket legallas-index). Every ~150 words the text carries a
// `[[doc:<id> p:<n>]]` marker, so any chunk AI Search retrieves still says which document and page it
// came from. Text is split into parts under 3.5 MB, keyed text/<doc_id>.p<N>.md (N counts from 1).
//
// The last check before the index (W2d): no part is ever built from text that still holds a printed SSN (pii.ts
// rule ssn-form) or a known SSN (rule known-hash); buildParts throws PiiInPart and the document gets no part at
// all. The sync's guard (pii-scan.ts) stops such text first, so this fires only if that guard was bypassed.
import { hasSsnForm, nineDigitRuns, type KnownMatcher } from './pii.ts';

export const PART_MAX_BYTES = 3_500_000;
export const WORDS_PER_MARKER = 150;

export interface PageText {
  n: number;
  text: string;
}

export interface IndexPart {
  key: string;
  body: string;
}

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).length;

export function marker(docId: string, page: number): string {
  return `[[doc:${docId} p:${page}]]`;
}

export function partKey(docId: string, part: number): string {
  return `text/${docId}.p${part}.md`;
}

/**
 * The Latin ligatures (U+FB00 to U+FB06: ff, fi, fl, ffi, ffl, long s t, st) as their plain letters. PDF text layers keep
 * them, and neither NFC nor the keyword index folds them, so a search for "coffee" missed "co\uFB00ee" (#226). Only these
 * seven: full NFKC would also rewrite superscripts, fractions and full-width forms the reader should see as written.
 */
export function plainLetters(text: string): string {
  return text.replace(/[\uFB00-\uFB06]/g, (ligature) => ligature.normalize('NFKC'));
}

/** Document text is data: "[[" inside it is broken up so a file cannot forge a citation marker. Ligatures are plain letters. */
export function neutralizeMarkers(text: string): string {
  return plainLetters(text).replace(/\[(?=\[)/g, '[ ');
}

/** Splits a string into pieces of at most maxBytes UTF-8 bytes without cutting a code point. */
function hardSplit(text: string, maxBytes: number): string[] {
  const pieces: string[] = [];
  let current = '';
  let size = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const charBytes = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (size + charBytes > maxBytes && current) {
      pieces.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += charBytes;
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Marker-led segments of about WORDS_PER_MARKER words each. Whitespace (and so markdown tables) is kept. */
export function buildSegments(docId: string, pages: readonly PageText[]): string[] {
  const segments: string[] = [];
  for (const page of pages) {
    const text = neutralizeMarkers(page.text).trim();
    if (!text) continue;
    const head = `${marker(docId, page.n)}\n`;
    let words = 0;
    let current = '';
    for (const token of text.split(/(\s+)/)) {
      const isWord = token !== '' && !/^\s+$/.test(token);
      if (isWord && words === WORDS_PER_MARKER) {
        segments.push(head + current.trim() + '\n\n');
        current = '';
        words = 0;
      }
      current += token;
      if (isWord) words += 1;
    }
    if (current.trim()) segments.push(head + current.trim() + '\n\n');
  }
  return segments;
}

/** What the last check knows beyond the text: the known SSN hashes, and whether the owner acknowledged this document. */
export interface PartGuard {
  known?: KnownMatcher | null;
  /** --allow-pii <sha256> covers this document: rule ssn-form is not applied. A known SSN is never acknowledged. */
  acknowledged?: boolean;
}

/** A document whose text still holds an SSN: no part of it is built. Says the document id, never the number. */
export class PiiInPart extends Error {
  readonly docId: string;
  constructor(docId: string) {
    super(`Document ${docId} still holds a Social Security number; no index part was built from it.`);
    this.docId = docId;
  }
}

function holdsSsn(text: string, guard: PartGuard): boolean {
  if (!guard.acknowledged && hasSsnForm(text)) return true;
  const known = guard.known;
  return !!known && nineDigitRuns(text).some((run) => known.matchesSync(run.digits));
}

/**
 * Packs segments into parts under PART_MAX_BYTES. A segment too big on its own is cut, re-marked per piece.
 * Throws PiiInPart when a page, or a part built from it, still holds an SSN (see the header).
 */
export function buildParts(docId: string, pages: readonly PageText[], maxBytes = PART_MAX_BYTES, guard: PartGuard = {}): IndexPart[] {
  if (pages.some((page) => holdsSsn(page.text, guard))) throw new PiiInPart(docId);
  const bodies: string[] = [];
  let current = '';
  let size = 0;
  const push = (segment: string) => {
    const segmentBytes = bytes(segment);
    if (size + segmentBytes >= maxBytes && current) {
      bodies.push(current);
      current = '';
      size = 0;
    }
    current += segment;
    size += segmentBytes;
  };
  for (const segment of buildSegments(docId, pages)) {
    if (bytes(segment) < maxBytes) {
      push(segment);
      continue;
    }
    const newline = segment.indexOf('\n');
    const head = segment.slice(0, newline + 1);
    const room = maxBytes - bytes(head) - 4;
    for (const piece of hardSplit(segment.slice(newline + 1), room)) push(head + piece + '\n');
  }
  if (current) bodies.push(current);
  if (bodies.some((body) => holdsSsn(body, guard))) throw new PiiInPart(docId);
  return bodies.map((body, index) => ({ key: partKey(docId, index + 1), body }));
}

/**
 * How many old parts to delete when the index manifest does not know a document (for example after the
 * cache was cleared). A generous upper bound from the file size: deleting a key that does not exist is a no-op.
 */
export function fallbackPartCount(size: number): number {
  return Math.ceil((size * 3) / PART_MAX_BYTES) + 1;
}
