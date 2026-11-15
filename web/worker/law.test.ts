// SPDX-License-Identifier: Apache-2.0
// The law library in the Worker (T21): catalog authority, track checks and citation validation. Ask's prompt and
// /api/ask with the library on and off are in ask-law.test.ts. Fixture law text is placeholder text under public
// citations; no case content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASK_LAW_MIN_VECTOR, LAW_PARTS_PER_UNIT, lawCatalog, relevantEnough, lawEnabled, resetLawCatalog, retrieveLaw, unitsFirst, validateLawCitations, validEntry } from './law.ts';
import { bucket, CATALOG, ENTRY, search } from './law-fixtures.ts';

test('off unless the flag is "1" and both bindings exist', () => {
  const b = bucket().r2;
  const s = search([]).search;
  assert.equal(lawEnabled({}), false);
  assert.equal(lawEnabled({ LAW_LIBRARY: '1', LAW: b }), false);
  assert.equal(lawEnabled({ LAW_LIBRARY: '0', LAW: b, LAW_SEARCH: s }), false);
  assert.equal(lawEnabled({ LAW_LIBRARY: '1', LAW: b, LAW_SEARCH: s }), true);
});

test('only well-formed catalog entries with official links are citable', () => {
  assert.ok(validEntry(ENTRY('crs-7-80-714', 'civil')));
  assert.equal(validEntry(ENTRY('crs-7-80-714', 'civil', { url: 'https://evil.example/' })), null);
  assert.equal(validEntry(ENTRY('../etc', 'civil')), null);
  assert.equal(validEntry({ ...ENTRY('crs-7-80-714', 'civil'), track: 'record' }), null);
  assert.equal(validEntry(ENTRY('crs-7-80-714', 'civil', { retrieved: 'yesterday' })), null);
});

test('an opinion part names its writing, and only a writing the room knows is citable', () => {
  const part = (extra: Record<string, unknown>) => ({ ...ENTRY('case-9-p2d-1~3', 'civil', { kind: 'case' }), ...extra });
  assert.equal(validEntry(part({ opinion: 'dissent', author: 'Fable, J.' }))?.opinion, 'dissent');
  assert.ok(validEntry(part({})), 'a catalog built before writings were marked still works');
  assert.equal(validEntry(part({ opinion: 'plurality' })), null);
  assert.equal(validEntry(part({ opinion: 'majority', author: 'x'.repeat(81) })), null);
  assert.equal(validEntry(part({ opinion: 1 })), null);
});

test('the catalog is cached by etag', async () => {
  resetLawCatalog();
  const b = bucket();
  assert.equal((await lawCatalog(b.r2))?.size, 3);
  assert.equal((await lawCatalog(b.r2))?.size, 3);
  assert.equal(b.gets(), 2, 'the second read is a conditional get that returns no body');
});

test('retrieval keeps catalog chunks whose key track agrees, on the requested tracks, repeats last', async () => {
  resetLawCatalog();
  const s = search([
    ['law/civil/crs-7-80-714.md', 'C.R.S. text one.'],
    ['law/regulator/crs-7-80-714.md', 'Wrong folder for a civil chunk.'],
    ['law/civil/crs-7-80-999.md', 'Not in the catalog.'],
    ['text/doc-a.p1.md', 'A record part in the wrong index.'],
    ['law/both/cfr-17-230-506~1.md', 'Rule text.'],
    ['law/regulator/ccr-704-1-r51-4-1.md', 'Regulator rule text.'],
  ]);
  const all = await retrieveLaw(s.search, bucket().r2, 'what does the rule require');
  assert.deepEqual(all.passages.map((p) => p.id), ['crs-7-80-714', 'cfr-17-230-506~1', 'ccr-704-1-r51-4-1']);
  assert.equal(all.passages[0]!.track, 'civil');
  const civil = await retrieveLaw(s.search, bucket().r2, 'q', { tracks: ['civil', 'both'] });
  assert.deepEqual(civil.passages.map((p) => p.id), ['crs-7-80-714', 'cfr-17-230-506~1'], 'regulator-only material never comes back as civil');
  const request = s.requests[0] as AiSearchSearchRequest;
  assert.equal(request.ai_search_options?.retrieval?.retrieval_type, 'hybrid');
  assert.equal(request.ai_search_options?.query_rewrite?.enabled, false);
  assert.equal(request.ai_search_options?.cache?.enabled, false);
});

test('one unit\'s parts past the per-unit cap come after every other unit, so one long opinion cannot fill the passages', async () => {
  const ids = ['case-1~1', 'case-1~2', 'case-1~3', 'case-1~4', 'cji-30-10', 'crs-1~5', 'case-1~5', 'crs-2'];
  assert.equal(LAW_PARTS_PER_UNIT, 2);
  assert.deepEqual(unitsFirst(ids.map((id) => ({ id })), 5).map((p) => p.id), ['case-1~1', 'case-1~2', 'cji-30-10', 'crs-1~5', 'crs-2']);
  assert.deepEqual(unitsFirst(ids.map((id) => ({ id })), 20).map((p) => p.id), ['case-1~1', 'case-1~2', 'cji-30-10', 'crs-1~5', 'crs-2', 'case-1~3', 'case-1~4', 'case-1~5'], 'nothing is dropped, only moved');
  resetLawCatalog();
  const catalog = [...['1', '2', '3', '4'].map((n) => ENTRY(`case-9-p2d-1~${n}`, 'civil', { kind: 'case' })), ENTRY('cji-30-10', 'civil')];
  const s = search([...['1', '2', '3', '4'].map((n): [string, string] => [`law/civil/case-9-p2d-1~${n}.md`, `Opinion part ${n}.`]), ['law/civil/cji-30-10.md', 'Instruction.']]);
  const got = await retrieveLaw(s.search, bucket(catalog).r2, 'q', { limit: 3 });
  assert.deepEqual(got.passages.map((p) => p.id), ['case-9-p2d-1~1', 'case-9-p2d-1~2', 'cji-30-10']);
});

test('no catalog means nothing is citable', async () => {
  resetLawCatalog();
  const none = { async get() { return null; } } as unknown as R2Bucket;
  const got = await retrieveLaw(search([['law/civil/crs-7-80-714.md', 'x']]).search, none, 'q');
  assert.deepEqual(got.passages, []);
});

test('law citations survive only for chunks retrieved for this question', () => {
  const citable = new Map(CATALOG.slice(0, 2).map((e) => [e.id, e]));
  const got = validateLawCitations('A [law:crs-7-80-714], B 【law:cfr-17-230-506~1】, again [law:crs-7-80-714], C [law:ccr-704-1-r51-4-1].', citable);
  assert.deepEqual(got.map((c) => c.id), ['crs-7-80-714', 'cfr-17-230-506~1']);
});

test('Ask sends law only when the best passage is relevant enough, and then every catalog passage', async () => {
  resetLawCatalog();
  const scoredSearch = (top: number) =>
    ({
      async search() {
        return {
          search_query: '',
          chunks: [
            { id: 'a', type: 'text', score: 0.9, text: 'Best.', item: { key: 'law/civil/crs-7-80-714.md' }, scoring_details: { vector_score: top, keyword_score: 3 } },
            { id: 'b', type: 'text', score: 0.5, text: 'Weaker.', item: { key: 'law/both/cfr-17-230-506~1.md' }, scoring_details: { vector_score: 0.45, keyword_score: 9 } },
          ],
        };
      },
    }) as unknown as AiSearchInstance;
  const legal = await retrieveLaw(scoredSearch(0.71), bucket().r2, 'q', { minVector: ASK_LAW_MIN_VECTOR });
  assert.deepEqual(legal.passages.map((p) => p.id), ['crs-7-80-714', 'cfr-17-230-506~1'], 'a weaker passage still goes along');
  const factual = await retrieveLaw(scoredSearch(0.5), bucket().r2, 'q', { minVector: ASK_LAW_MIN_VECTOR });
  assert.deepEqual(factual.passages, [], 'a question about the record gets no law');
  assert.equal((await retrieveLaw(scoredSearch(0.5), bucket().r2, 'q')).passages.length, 2, 'without a floor (the MCP tool) law comes back');
  assert.equal(relevantEnough([{}, {}], ASK_LAW_MIN_VECTOR), false, 'results without scores fail closed');
  assert.ok(ASK_LAW_MIN_VECTOR > 0.4 && ASK_LAW_MIN_VECTOR < 0.7);
});

test('chunks outside law/ (an indexed catalog.json) never open the gate and are never returned', async () => {
  resetLawCatalog();
  const mixed = {
    async search() {
      return {
        search_query: '',
        chunks: [
          { id: 'c', type: 'text', score: 0.95, text: '{"chunks": [...]}', item: { key: 'catalog.json' }, scoring_details: { vector_score: 0.9, keyword_score: 20 } },
          { id: 'a', type: 'text', score: 0.5, text: 'Statute.', item: { key: 'law/civil/crs-7-80-714.md' }, scoring_details: { vector_score: 0.5, keyword_score: 1 } },
        ],
      };
    },
  } as unknown as AiSearchInstance;
  assert.deepEqual((await retrieveLaw(mixed, bucket().r2, 'q', { minVector: ASK_LAW_MIN_VECTOR })).passages, [], 'the catalog\'s 0.9 does not open the gate');
  assert.deepEqual((await retrieveLaw(mixed, bucket().r2, 'q')).passages.map((p) => p.id), ['crs-7-80-714']);
});
