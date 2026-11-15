// SPDX-License-Identifier: Apache-2.0
// What retrieval makes of an AI Search answer before anyone reads it, shared by the room's Ask (worker/ask.ts
// retrieve) and legallas_search (mcp/tools/search.ts), which calls the same retrieve(): when an answer is asked
// once more, and the order its passages keep.
import { withoutV2Header } from './v2-header.ts';

// The v2 header rule lives in v2-header.ts (no Workers types there, so cite-book.ts can share it under Node).
export { withoutV2Header };

/** Page markers exactly as scripts/indexparts.ts writes them (worker/citations.ts INDEX_MARKER). */
const MARKER = /\[\[doc:[A-Za-z0-9_-]{1,64} p:[0-9]{1,6}\]\]/g;

/**
 * True when AI Search answered a hybrid search from its keyword side alone: chunks, but no vector score on any
 * of them. It does this now and then without an error (about 1 search in 10 in the replica runs of 2026-10-03),
 * and BM25 alone ranks long email threads and file copies above the document that answers. A result without
 * scoring details (the local mock) is never taken for one.
 */
export function keywordOnly(result: AiSearchSearchResponse): boolean {
  const chunks = result.chunks ?? [];
  return chunks.length > 0 && chunks.every((chunk) => chunk.scoring_details !== undefined && typeof chunk.scoring_details.vector_score !== 'number');
}

/**
 * True when an answer to `request` should be asked once more: no chunks at all (AI Search now and then returns
 * none and no error when its vector side drops out, eval of 2026-10-02), or a hybrid search answered from the
 * keyword side alone. The second answer stands either way.
 */
export function askAgain(request: AiSearchSearchRequest, result: AiSearchSearchResponse): boolean {
  if (!result.chunks?.length) return true;
  return request.ai_search_options?.retrieval?.retrieval_type !== 'keyword' && keywordOnly(result);
}

/** Passage text without its v2 header, index markers or spacing differences: the same page in two files compares equal. */
function textKey(text: string): string {
  return withoutV2Header(text).replace(MARKER, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Chunks in index order, except that a chunk repeating an earlier chunk's text moves behind every distinct one:
 * the filed and served copies of a motion, or an order that reproduces the motion it grants, would otherwise
 * fill the first passages with one text. Nothing is dropped, so a larger limit still returns the copies.
 */
export function distinctFirst<T extends { text: string }>(chunks: readonly T[]): T[] {
  const seen = new Set<string>();
  const distinct: T[] = [];
  const repeats: T[] = [];
  for (const chunk of chunks) {
    const key = textKey(chunk.text);
    if (key !== '' && seen.has(key)) repeats.push(chunk);
    else distinct.push(chunk);
    seen.add(key);
  }
  return [...distinct, ...repeats];
}
