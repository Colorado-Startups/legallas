// SPDX-License-Identifier: Apache-2.0
// Page text from legallas-index for legallas_read_pages. The index stores each document as size-based parts
// (`text/<id>.p<N>.md`, N from 1), not pages: every ~150 words a `[[doc:<id> p:<n>]]` marker says which page
// the following text is on (scripts/indexparts.ts). A page can span two parts and a part holds many pages, so
// this lists the parts, reads them in order and regroups the text by marker, stopping once it is past the range.

/** The two R2 calls this module makes. Production passes env.INDEX; tests pass a fake. */
export type IndexReader = Pick<R2Bucket, 'list' | 'get'>;

/** What the index holds for a page range. */
export interface PageRangeText {
  /** False when the document has no parts at all (nothing was extracted). */
  hasText: boolean;
  /** Text per page within the range, in page order. Pages without text are absent. */
  pages: Map<number, string>;
  /** True when every part was read, so `lastPage` is the document's last page with text. */
  complete: boolean;
  /** The highest page number seen in the parts that were read (0 if none). */
  lastPage: number;
  /**
   * The last page whose text is known in full. Pages up to it that are absent from `pages` are blank; pages
   * after it were not read. `to` when reading stopped at a marker past the range, `lastPage` when every part
   * was read, and `lastPage - 1` when it stopped early (the last page seen may continue in the next part).
   */
  readThrough: number;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** This document's markers only: another id's marker (never written by the sync) stays as text. */
function markerFor(id: string): RegExp {
  return new RegExp(`\\[\\[doc:${id} p:([0-9]{1,6})\\]\\]\\n?`, 'g');
}

/** The part keys for a document, in part order. Follows list cursors, so any number of parts is found. */
export async function listParts(index: IndexReader, id: string): Promise<string[]> {
  if (!SAFE_ID.test(id)) return []; // The id goes into a key prefix and a pattern; tools validate it already.
  const prefix = `text/${id}.p`;
  const exact = new RegExp(`^text/${id}\\.p([0-9]+)\\.md$`);
  const found: { key: string; n: number }[] = [];
  let cursor: string | undefined;
  do {
    const listed = await index.list(cursor ? { prefix, cursor } : { prefix });
    for (const object of listed.objects) {
      const match = exact.exec(object.key);
      if (match) found.push({ key: object.key, n: Number(match[1]) });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return found.sort((a, b) => a.n - b.n).map((part) => part.key);
}

/**
 * One part body as (page, text) segments in order. Text before the first marker, if any, is dropped. Any "[["
 * left in the text is broken up, as the sync does (neutralizeMarkers), so it cannot pass for a citation.
 */
export function splitSegments(body: string, id: string): { page: number; text: string }[] {
  const segments: { page: number; text: string }[] = [];
  if (!SAFE_ID.test(id)) return segments;
  const markers = [...body.matchAll(markerFor(id))];
  markers.forEach((match, i) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < markers.length ? (markers[i + 1].index ?? body.length) : body.length;
    const text = body.slice(start, end).trim().replace(/\[(?=\[)/g, '[ ');
    if (text) segments.push({ page: Number(match[1]), text });
  });
  return segments;
}

/**
 * Text for pages `from` to `to` (inclusive). Segments of one page are joined with a space: the index cut
 * them every ~150 words, mid-paragraph, so a line break there would invent one. Characters are counted as
 * the joined text is long. Reading stops at the first marker past `to`, after a part once more than
 * `maxChars` are collected (the caller cannot return more), or at a part that vanished since the listing.
 */
export async function readPageRange(index: IndexReader, id: string, from: number, to: number, maxChars: number): Promise<PageRangeText> {
  const keys = await listParts(index, id);
  const pieces = new Map<number, string[]>();
  const result: PageRangeText = { hasText: keys.length > 0, pages: new Map(), complete: true, lastPage: 0, readThrough: 0 };
  let chars = 0;
  let past = false;
  for (const [i, key] of keys.entries()) {
    const object = await index.get(key);
    if (!object) {
      result.complete = false; // Removed by a concurrent sync: what follows cannot be trusted to line up.
      break;
    }
    for (const segment of splitSegments(await object.text(), id)) {
      result.lastPage = Math.max(result.lastPage, segment.page);
      if (segment.page > to) {
        past = true;
        break;
      }
      if (segment.page < from) continue;
      const list = pieces.get(segment.page) ?? [];
      chars += segment.text.length + (list.length > 0 ? 1 : 0);
      list.push(segment.text);
      pieces.set(segment.page, list);
    }
    if (past || (chars > maxChars && i + 1 < keys.length)) {
      result.complete = false;
      break;
    }
  }
  result.readThrough = past ? to : result.complete ? result.lastPage : result.lastPage - 1;
  for (const page of [...pieces.keys()].sort((a, b) => a - b)) result.pages.set(page, (pieces.get(page) ?? []).join(' '));
  return result;
}
