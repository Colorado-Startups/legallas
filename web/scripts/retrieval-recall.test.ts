// SPDX-License-Identifier: Apache-2.0
// Retrieval recall (scripts/retrieval-recall.ts and its scoring) on fictional items and passages only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approxChunks, localSearch } from './index-replica.ts';
import { cachingSearch, flips, parseRecallArgs, PLANS, recallItems, type SearchStats } from './retrieval-recall.ts';
import { controlSeq, passagePages, scoreItem, summarize, type ItemRecall } from './retrieval-recall-score.ts';

const item = { id: 'fact-cancel-date', category: 'facts', question: 'When was the supply agreement cancelled?', docs: [{ control: 'DOE-000412', pages: [3] }, { control: 'DOE-000007', pages: [1] }] };
const seqOf = new Map<string, number | null>([
  ['doc-a', 412],
  ['doc-b', 7],
  ['doc-c', 99],
]);
const passage = (docId: string, ...pages: number[]) => ({ docId, text: pages.map((p) => `[[doc:${docId} p:${p}]]\ntext`).join('\n') || 'no marker' });

test('pages come only from the passage\'s own markers; control numbers parse to sequences', () => {
  assert.deepEqual([...passagePages({ docId: 'doc-a', text: '[[doc:doc-a p:2]] x [[doc:doc-b p:9]] [[doc:doc-a p:3]]' })], [2, 3]);
  assert.equal(controlSeq('DOE-000412'), 412);
  assert.equal(controlSeq('not a control'), null);
});

test('scoreItem: first ranks of an expected document and page, coverage and size', () => {
  const got = scoreItem(item, [passage('doc-c', 1), passage('doc-a', 2), passage('doc-a', 3), passage('doc-c'), passage('doc-c', 4)], seqOf);
  assert.deepEqual(got, {
    id: 'fact-cancel-date',
    category: 'facts',
    docRank: 2,
    pageRank: 3,
    docsCovered: 0.5,
    passages: 5,
    documents: 2,
    maxPerDocument: 3,
    chars: got.chars,
    unpaged: 1,
  });
  assert.equal(scoreItem(item, [passage('doc-c', 3)], seqOf).docRank, null, 'the right page of the wrong document is no hit');
});

test('summarize: shares within 5, 10 and anywhere', () => {
  const rows = [
    { docRank: 1, pageRank: 1 },
    { docRank: 7, pageRank: 12 },
    { docRank: null, pageRank: null },
    { docRank: 15, pageRank: null },
  ].map((r, i): ItemRecall => ({ id: `i${i}`, category: 'facts', docsCovered: r.docRank ? 1 : 0, passages: 20, documents: 5, maxPerDocument: 4, chars: 1000 * (i + 1), unpaged: 0, ...r }));
  const s = summarize(rows);
  assert.deepEqual([s.doc5, s.doc10, s.doc, s.page5, s.page10, s.page], [0.25, 0.5, 0.75, 0.25, 0.25, 0.5]);
  assert.equal(s.charsP50, 2000);
  assert.equal(summarize([]).n, 0);
});

test('flips name the items a plan gained or lost at page level', () => {
  const r = (id: string, pageRank: number | null) => ({ id, pageRank }) as ItemRecall;
  assert.deepEqual(flips([r('a', 1), r('b', null), r('c', 2)], [r('a', null), r('b', 4), r('c', 9)]), { gained: ['b'], lost: ['a'] });
});

test('args: known plans only, instance names checked, a local index format', () => {
  assert.deepEqual(parseRecallArgs([]).plans, ['main']);
  assert.throws(() => parseRecallArgs(['--plans', 'main,nope']), /unknown plan nope/);
  assert.throws(() => parseRecallArgs(['--instance', '../legallas']));
  assert.equal(parseRecallArgs(['--instance', 'legallas-v2']).instance, 'legallas-v2');
  assert.equal(parseRecallArgs(['--local', 'v2']).local, 'v2');
  assert.deepEqual(PLANS.main, {});
});

test('recallItems keeps items that expect documents, as their controls and pages', () => {
  const raw = [
    { id: 'a', category: 'facts', question: 'q', expect: { docs: [{ control: 'DOE-000001', pages: [1, 'x'] }] } },
    { id: 'b', category: 'law', question: 'q', expect: { lawCites: ['crs'] } },
    { id: 'c', question: 'q', expect: { docs: [] } },
  ];
  assert.deepEqual(recallItems(raw), [{ id: 'a', category: 'facts', question: 'q', docs: [{ control: 'DOE-000001', pages: [1] }] }]);
  assert.throws(() => recallItems({}), /array/);
});

test('the search cache answers repeats, but a retried request in one retrieval is a fresh sample', async () => {
  let n = 0;
  const inner = { search: async () => ({ search_query: '', chunks: [{ id: `c${++n}`, type: 'text', score: 1, text: 't', item: { key: 'text/a.p1.md' } }] }) };
  const stats: SearchStats = { calls: 0, cached: 0, keywordOnly: 0 };
  const scope = cachingSearch(inner, new Map(), stats);
  const first = scope();
  const a = await first.search({ query: 'q' });
  const b = await first.search({ query: 'q' });
  assert.notEqual(a.chunks[0]!.id, b.chunks[0]!.id, 'the second ask in one retrieval is asked again');
  const again = scope();
  assert.equal((await again.search({ query: 'q' })).chunks[0]!.id, a.chunks[0]!.id, 'another plan reads the same first answer');
  assert.deepEqual(stats, { calls: 2, cached: 1, keywordOnly: 0 });
});

test('the local index: v1 chunking overlaps and covers the text; search fuses vector and keyword ranks', async () => {
  const body = Array.from({ length: 40 }, (_, i) => `Line ${i} of a fictional part.`).join('\n');
  const chunks = approxChunks(body, 300, 45);
  assert.ok(chunks.length > 3 && chunks.every((c) => c.length <= 300));
  assert.ok(chunks.join('\n').includes('Line 39 of a fictional part.'));
  const parts = [
    { key: 'text/a.p1.md', text: 'Roe cancelled the supply agreement.' },
    { key: 'text/b.p1.md', text: 'Doe sent the invoice for the spring order.' },
  ];
  const embed = async (texts: string[]) => texts.map((t) => (/roe|agreement/i.test(t) ? [1, 0] : [0, 1]));
  const search = localSearch(parts, [Float32Array.from([1, 0]), Float32Array.from([0, 1])], embed);
  const got = await search.search({ query: 'Roe agreement', ai_search_options: { retrieval: { max_num_results: 5 } } });
  assert.deepEqual(got.chunks.map((c) => c.item.key), ['text/a.p1.md']);
  assert.equal(typeof got.chunks[0]!.scoring_details.vector_score, 'number');
  const keywordOnly = await search.search({ query: 'invoice', ai_search_options: { retrieval: { retrieval_type: 'keyword' } } });
  assert.deepEqual(keywordOnly.chunks.map((c) => c.item.key), ['text/b.p1.md']);
});
