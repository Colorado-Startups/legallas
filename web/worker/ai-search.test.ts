// SPDX-License-Identifier: Apache-2.0
// worker/ai-search.ts on its own, then under retrieve() on real SQL, with a fake AI Search that answers each call with
// the next of a list of results (ai-search-fixtures.ts). Through POST /api/ask: ask-ai-search.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askAgain, distinctFirst, keywordOnly, withoutV2Header } from './ai-search.ts';
import { answering, HYBRID, KEYWORD, response } from './ai-search-fixtures.ts';
import { retrieve, searchRequest } from './retrieval.ts';
import { chunk, d1, schemaDb, seed } from './room-fixtures.ts';

test('keywordOnly: chunks with scoring details and no vector score', () => {
  assert.equal(keywordOnly(response([{ ...chunk('a', 1, 'x'), details: KEYWORD }])), true);
  assert.equal(keywordOnly(response([{ ...chunk('a', 1, 'x'), details: KEYWORD }, { ...chunk('b', 1, 'y'), details: HYBRID }])), false, 'one vector score is enough');
  assert.equal(keywordOnly(response([chunk('a', 1, 'x')])), false, 'no scoring details (the local mock) is never keyword-only');
  assert.equal(keywordOnly(response([])), false);
});

test('askAgain: empty, or a hybrid search answered from the keyword side alone', () => {
  const hybrid = searchRequest('q');
  const keyword: AiSearchSearchRequest = { query: 'q', ai_search_options: { retrieval: { retrieval_type: 'keyword' } } };
  const keywordAnswer = response([{ ...chunk('a', 1, 'x'), details: KEYWORD }]);
  assert.equal(askAgain(hybrid, response([])), true);
  assert.equal(askAgain(keyword, response([])), true);
  assert.equal(askAgain(hybrid, keywordAnswer), true);
  assert.equal(askAgain(keyword, keywordAnswer), false, 'a keyword search is meant to come back keyword-only');
  assert.equal(askAgain(hybrid, response([{ ...chunk('a', 1, 'x'), details: HYBRID }])), false);
});

test('distinctFirst: repeats move behind the distinct passages, markers and spacing ignored, nothing dropped', () => {
  const got = distinctFirst([
    { id: 1, text: '[[doc:a p:1]]\nMotion to join.' },
    { id: 2, text: '[[doc:b p:3]] Motion   to\njoin.' },
    { id: 3, text: 'Order granting.' },
    { id: 4, text: '' },
    { id: 5, text: '  ' },
  ]);
  assert.deepEqual(got.map((c) => c.id), [1, 3, 4, 5, 2]);
});

test('index v2: copies of one page in two files are repeats although their header lines differ', () => {
  const header = (control: string) => `${control} | Motion to compel, Roe | 2013-01-15 | motion to compel | pleading | 08-Court-Papers`;
  const got = distinctFirst([
    { id: 1, text: `${header('DOE-000001')}\n[[doc:a p:1]]\nMotion to join.` },
    { id: 2, text: `${header('DOE-000002')}\n[[doc:b p:1]]\nMotion to join.` },
    { id: 3, text: `${header('DOE-000003')}\n[[doc:c p:1]]\nOrder granting.` },
  ]);
  assert.deepEqual(got.map((c) => c.id), [1, 3, 2]);
  assert.equal(withoutV2Header(`${header('DOE-000001')}\n[[doc:a p:1]]\nText.`), '[[doc:a p:1]]\nText.');
  assert.equal(withoutV2Header('A first line of text | with one bar\n[[doc:a p:1]]\nText.'), 'A first line of text | with one bar\n[[doc:a p:1]]\nText.', 'a v1 line is kept');
  assert.equal(withoutV2Header(`${header('DOE-000001')}\nno marker next`), `${header('DOE-000001')}\nno marker next`);
});

test('retrieve asks a keyword-only hybrid answer once more, and the second answer stands', async () => {
  const db = schemaDb();
  seed(db);
  const keyword = { ...chunk('doc-live-b', 1, 'A long email thread.'), details: KEYWORD };
  const hybrid = { ...chunk('doc-live-a', 2, 'The agreement itself.'), details: HYBRID };

  const fixed = answering([[keyword], [hybrid, keyword]]);
  const { chunks } = await retrieve(fixed, d1(db), 'q', 'counsel');
  assert.equal(fixed.searches.length, 2);
  assert.deepEqual(fixed.searches[1], searchRequest('q'), 'the same request, unchanged');
  assert.deepEqual(chunks.map((c) => c.docId), ['doc-live-a', 'doc-live-b']);

  const twice = answering([[keyword], [keyword]]);
  assert.deepEqual((await retrieve(twice, d1(db), 'q', 'counsel')).chunks.map((c) => c.docId), ['doc-live-b']);
  assert.equal(twice.searches.length, 2, 'asked once more, not again and again');

  const whole = answering([[hybrid, keyword]]);
  await retrieve(whole, d1(db), 'q', 'counsel');
  assert.equal(whole.searches.length, 1, 'a hybrid answer is used as it comes');

  const emptyThenKeyword = answering([[], [keyword], [hybrid]]);
  assert.deepEqual((await retrieve(emptyThenKeyword, d1(db), 'q', 'counsel')).chunks.map((c) => c.docId), ['doc-live-b']);
  assert.equal(emptyThenKeyword.searches.length, 2, 'one more search in all, whatever the reason');
});

test('retrieve puts a repeated passage behind the distinct ones', async () => {
  const db = schemaDb();
  seed(db);
  const search = answering([[chunk('doc-live-a', 1, 'Motion to join.'), chunk('doc-live-b', 4, 'Motion to join.'), chunk('doc-live-a', 2, 'Order.')]]);
  const { chunks, citable } = await retrieve(search, d1(db), 'q', 'counsel');
  assert.deepEqual(chunks.map((c) => c.text.split('\n')[1]), ['Motion to join.', 'Order.', 'Motion to join.']);
  assert.deepEqual(chunks.map((c) => c.docId), ['doc-live-a', 'doc-live-a', 'doc-live-b']);
  assert.deepEqual([...citable.keys()].sort(), ['doc-live-a', 'doc-live-b'], 'a copy stays citable');
});

