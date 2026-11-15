// SPDX-License-Identifier: Apache-2.0
// The law library for a request: the real bindings when it is on, a canned one under ASK_MOCK on localhost
// with LAW_LIBRARY=1 (.dev.vars), or null when it is off. The canned library speaks the real wire formats
// (law/<track>/<id>.md keys and a catalog object), so the real catalog checks, track checks and citation
// validation run. Its passages are placeholder text under real citations; one carries a key whose track
// disagrees with the catalog and must be dropped.
import { askMockEnabled } from './ask-mock.ts';
import type { Env } from './env.ts';
import { lawEnabled } from './law.ts';
import type { LawChunk } from './law-cite.ts';

export interface LawLibrary {
  search: Pick<AiSearchInstance, 'search'>;
  bucket: R2Bucket;
}

export const MOCK_LAW: readonly LawChunk[] = [
  {
    id: 'crs-7-80-714',
    cite: 'C.R.S. § 7-80-714(1)',
    title: 'Derivative proceeding - demand',
    url: 'https://content.leg.colorado.gov/sites/default/files/images/olls/crs2024-title-07.pdf',
    retrieved: '2026-10-03',
    track: 'civil',
    kind: 'statute',
    source: 'Local placeholder',
  },
  {
    id: 'cfr-17-230-506~1',
    cite: '17 C.F.R. § 230.506(a)',
    title: 'Exemption for limited offers and sales',
    url: 'https://www.ecfr.gov/current/title-17/section-230.506',
    retrieved: '2026-10-03',
    track: 'both',
    kind: 'regulation',
    source: 'Local placeholder',
  },
];

function mockSearch(): Pick<AiSearchInstance, 'search'> {
  return {
    async search(params) {
      const query = 'query' in params && typeof params.query === 'string' ? params.query : '';
      if (/unknown/i.test(query)) return { search_query: query, chunks: [] };
      const chunks = MOCK_LAW.map((entry, i) => ({
        id: `mock-law-${i}`,
        type: 'text',
        score: 0.7,
        text: `${entry.cite}. ${entry.title}\n\nPlaceholder text for the local law library.`,
        item: { key: `law/${entry.track}/${entry.id}.md` },
        // Scored like the real instance, so the relevance floor (law.ts ASK_LAW_MIN_VECTOR) runs on localhost too.
        scoring_details: { vector_score: 0.7 - i * 0.05, keyword_score: 1 },
      }));
      // A key on the wrong track: the catalog says civil, so retrieval must drop it.
      chunks.push({ id: 'mock-law-wrong', type: 'text', score: 0.6, text: 'Wrong track.', item: { key: 'law/regulator/crs-7-80-714.md' }, scoring_details: { vector_score: 0.6, keyword_score: 1 } });
      return { search_query: query, chunks };
    },
  };
}

function mockBucket(): R2Bucket {
  const body = JSON.stringify({ version: 1, built: '2026-10-03T00:00:00.000Z', chunks: MOCK_LAW });
  return {
    async get(key: string) {
      if (key !== 'catalog.json') return null;
      return { etag: 'mock-law', body: true, json: async () => JSON.parse(body) as unknown };
    },
  } as unknown as R2Bucket;
}

/** The law library this request should search, or null when it is off. */
export function lawLibrary(request: Request, env: Env): LawLibrary | null {
  if (askMockEnabled(request, env)) return env.LAW_LIBRARY === '1' ? { search: mockSearch(), bucket: mockBucket() } : null;
  return lawEnabled(env) ? { search: env.LAW_SEARCH, bucket: env.LAW } : null;
}
