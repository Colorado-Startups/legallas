// SPDX-License-Identifier: Apache-2.0
// Test fixtures (imported only by *.test.ts): an AI Search binding that answers each call with the next of a list of
// results, as ai-search.ts askAgain sees them, keyword-only or hybrid by their scoring details.
import type { FakeChunk } from './room-fixtures.ts';

export type Details = { keyword_score?: number; vector_score?: number; fusion_method?: string };
export type Answer = (FakeChunk & { details?: Details })[];

export const KEYWORD: Details = { keyword_score: 23.7 };
export const HYBRID: Details = { keyword_score: 22.4, vector_score: 0.67, fusion_method: 'rrf' };

export function response(chunks: Answer): AiSearchSearchResponse {
  return {
    search_query: '',
    chunks: chunks.map((c, i) => ({ id: `c${i}`, type: 'text', score: 0.9, text: c.text, item: { key: c.key }, scoring_details: c.details })),
  } as AiSearchSearchResponse;
}

/** A SEARCH binding answering call n with answers[n] (the last one repeats), recording each request. */
export function answering(answers: Answer[]) {
  const searches: AiSearchSearchRequest[] = [];
  return {
    searches,
    async search(request: AiSearchSearchRequest) {
      searches.push(request);
      return response(answers[Math.min(searches.length, answers.length) - 1]!);
    },
  };
}
