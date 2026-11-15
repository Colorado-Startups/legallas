// SPDX-License-Identifier: Apache-2.0
// Test fixtures for the law library (imported only by *.test.ts): catalog entries under public citations, a catalog
// bucket that answers by etag, and a law search whose chunks carry a vector score like the real instance.
import type { LawChunk } from './law-cite.ts';

export const ENTRY = (id: string, track: LawChunk['track'], extra: Partial<LawChunk> = {}): LawChunk => ({
  id,
  cite: `Cite of ${id}`,
  title: `Heading of ${id}`,
  url: 'https://www.ecfr.gov/current/title-17/section-230.506',
  retrieved: '2026-10-03',
  track,
  kind: 'statute',
  source: 'Fixture',
  ...extra,
});

export const CATALOG: LawChunk[] = [ENTRY('crs-7-80-714', 'civil'), ENTRY('cfr-17-230-506~1', 'both'), ENTRY('ccr-704-1-r51-4-1', 'regulator')];

export function bucket(chunks: unknown[] = CATALOG, etag = 'e1') {
  let gets = 0;
  const r2 = {
    async get(key: string, options?: { onlyIf?: { etagDoesNotMatch?: string } }) {
      gets++;
      if (key !== 'catalog.json') return null;
      if (options?.onlyIf?.etagDoesNotMatch === etag) return { etag };
      return { etag, body: true, json: async () => ({ version: 1, built: 'x', chunks }) };
    },
  };
  return { r2: r2 as unknown as R2Bucket, gets: () => gets };
}

/** A fake law search; every chunk carries `vector` as its vector score, like the real instance. */
export function search(keys: [string, string][], vector = 0.8) {
  const requests: unknown[] = [];
  return {
    requests,
    search: {
      async search(request: unknown) {
        requests.push(request);
        return {
          search_query: '',
          chunks: keys.map(([key, text], i) => ({ id: `l${i}`, type: 'text', score: 0.8, text, item: { key }, scoring_details: { vector_score: vector, keyword_score: 1 } })),
        };
      },
    } as unknown as AiSearchInstance,
  };
}
