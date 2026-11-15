// SPDX-License-Identifier: Apache-2.0
// worker/retrieval.ts retrieve() options, on real SQL (node:sqlite): visuals left out unless asked for (plan D8), and the
// free keyword search (worker/fts.ts) answering when AI Search's month is spent or (opted in) AI Search fails, through
// the same live-document and role filter; then through POST /api/ask. A separate file keeps ask.test.ts under 400 lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { indexStatements } from '../scripts/fts-rows.ts';
import { sseParser } from '../src/scripts/chat-sse.ts';
import { askVisuals } from './ask.ts';
import type { FoundPassage } from './passages.ts';
import { KEYWORD_FALLBACK, KEYWORD_FALLBACK_WITH_VISUALS, keywordFallbackFor, keywordFallbackReady, RETRIEVAL, retrieve, type KeywordSearch } from './retrieval.ts';
import { askRequest, harness } from './ask-fixtures.ts';
import { chunk, d1, schemaDb, seed, type FakeChunk } from './room-fixtures.ts';
import { limitOf, periodOf } from './budget.ts';
import { ftsSearch } from './fts.ts';
import { handle } from './index.ts';
import { BudgetExhausted, LocalSpendOff } from './spend.ts';

function addVisual(db: DatabaseSync): void {
  db.prepare(
    "INSERT INTO documents (id, path, folder, name, kind, content_type, size, pages, r2_key, source, updated_at) VALUES ('doc-visual', 'Visuals/board.html', 'Visuals', 'board.html', 'visual', 'text/html; charset=utf-8', 1, 1, 'k-visual', 'mirror', 'now')",
  ).run();
}

function room() {
  const db = schemaDb();
  seed(db);
  addVisual(db);
  return d1(db);
}

/** A document's pages in the keyword index, written exactly as scripts/fts-index.ts writes them. */
function indexPages(db: DatabaseSync, docId: string, pages: readonly string[]): void {
  db.exec(indexStatements(docId, `fp-${docId}`, pages.map((text, i) => ({ n: i + 1, text })), '2026-10-20T00:00:00Z').statements.join('\n'));
}

/** An AI Search binding answering `chunks` each time, or throwing `error`; it records how often it was asked. */
function fakeSearch(answer: FakeChunk[] | Error) {
  const calls: unknown[] = [];
  const search = {
    async search(request: unknown) {
      calls.push(request);
      if (answer instanceof Error) throw answer;
      return { search_query: '', chunks: answer.map((c, i) => ({ id: String(i), type: 'text', score: 1, text: c.text, item: { key: c.key } })) };
    },
  } as unknown as AiSearchInstance;
  return { search, calls };
}

/** A keyword search answering `passages`, recording its arguments. */
function fakeKeyword(passages: FoundPassage[]) {
  const calls: unknown[][] = [];
  const keyword: KeywordSearch = async (...args) => (calls.push(args), passages);
  return { keyword, calls };
}

test('visuals stay out of retrieval unless asked for; quick Ask asks only when ASK_VISUALS is "1"', async () => {
  const db = room();
  const { search } = fakeSearch([chunk('doc-live-a', 1, 'memo'), { key: 'text/doc-visual.p1.md', text: '[[doc:doc-visual p:1]]\nboard text' }]);
  const plain = await retrieve(search, db, 'q', 'counsel');
  assert.deepEqual(plain.chunks.map((c) => c.docId), ['doc-live-a']);
  assert.deepEqual([...plain.citable.keys()], ['doc-live-a'], 'a visual is not citable either');
  const withVisuals = await retrieve(search, db, 'q', 'counsel', RETRIEVAL, { includeVisuals: true });
  assert.deepEqual(withVisuals.chunks.map((c) => c.docId).sort(), ['doc-live-a', 'doc-visual']);
  assert.equal(askVisuals({ ASK_VISUALS: '1' }), true);
  for (const value of ['0', 'true', '', undefined]) assert.equal(askVisuals({ ASK_VISUALS: value }), false, String(value));
});

test("with the month's searches spent, the keyword search answers through the same live-document filter", async () => {
  const db = room();
  const { search } = fakeSearch(new BudgetExhausted('search_semantic'));
  const { keyword, calls } = fakeKeyword([
    { docId: 'doc-live-a', text: '[[doc:doc-live-a p:2]]\nzebra meeting' },
    { docId: 'doc-gone', text: '[[doc:doc-gone p:1]]\nremoved' },
    { docId: 'doc-visual', text: '[[doc:doc-visual p:1]]\nboard' },
    { docId: 'doc-live-b', text: '   ' },
  ]);
  const got = await retrieve(search, db, 'zebra', 'counsel', RETRIEVAL, { keywordFallback: keyword });
  assert.deepEqual(got.chunks.map((c) => c.docId), ['doc-live-a']);
  assert.equal(got.viaKeyword, true);
  assert.deepEqual(calls, [[db, 'zebra', 'counsel', RETRIEVAL.candidates]], 'the question, the role and the candidate count');
});

test('a refusal after a weak first answer falls back too; anything other than a spent budget still fails loudly', async () => {
  const db = room();
  let asked = 0;
  const emptyThenSpent = {
    async search() {
      asked += 1;
      if (asked === 1) return { search_query: '', chunks: [] };
      throw new BudgetExhausted('search_semantic');
    },
  } as unknown as AiSearchInstance;
  const { keyword } = fakeKeyword([{ docId: 'doc-live-a', text: '[[doc:doc-live-a p:1]]\nmemo' }]);
  assert.equal((await retrieve(emptyThenSpent, db, 'q', 'counsel', RETRIEVAL, { keywordFallback: keyword })).viaKeyword, true);
  const outage = fakeKeyword([]);
  await assert.rejects(retrieve(fakeSearch(new Error('503')).search, db, 'q', 'counsel', RETRIEVAL, { keywordFallback: outage.keyword }), /503/);
  assert.equal(outage.calls.length, 0, 'an outage is not "no budget"');
  const plain = await retrieve(fakeSearch([chunk('doc-live-a', 1, 'memo')]).search, db, 'q', 'counsel', RETRIEVAL, { keywordFallback: outage.keyword });
  assert.equal('viaKeyword' in plain, false);
});

test('the default keyword search is the D1 index; unbuilt, or turned off with null, the budget refusal stands', async () => {
  const db = room();
  assert.equal(KEYWORD_FALLBACK, ftsSearch);
  await assert.rejects(retrieve(fakeSearch(new BudgetExhausted('search_semantic')).search, db, 'q', 'counsel'), BudgetExhausted);
  await assert.rejects(retrieve(fakeSearch(new BudgetExhausted('search_semantic')).search, db, 'q', 'counsel', RETRIEVAL, { keywordFallback: null }), BudgetExhausted, 'null turns it off');
});

// --- 7c: why keyword search answered, outages, and the visuals choice ------------------------------------------

test('a keyword answer for a spent month says why: keywordReason "budget"', async () => {
  const db = room();
  const { keyword } = fakeKeyword([{ docId: 'doc-live-a', text: '[[doc:doc-live-a p:2]]\nzebra meeting' }]);
  const got = await retrieve(fakeSearch(new BudgetExhausted('search_semantic')).search, db, 'zebra', 'counsel', RETRIEVAL, { keywordFallback: keyword });
  assert.equal(got.keywordReason, 'budget');
  const plain = await retrieve(fakeSearch([chunk('doc-live-a', 1, 'memo')]).search, db, 'q', 'counsel', RETRIEVAL, { keywordFallback: keyword });
  assert.equal('keywordReason' in plain, false);
});

test('with keywordOnOutage (Ask, the MCP), an outage falls back too, and fails loudly when keyword search finds nothing', async () => {
  const db = room();
  const { keyword } = fakeKeyword([{ docId: 'doc-live-a', text: '[[doc:doc-live-a p:1]]\nmemo' }]);
  const covered = await retrieve(fakeSearch(new Error('503')).search, db, 'q', 'counsel', RETRIEVAL, { keywordFallback: keyword, keywordOnOutage: true });
  assert.deepEqual([covered.chunks.map((c) => c.docId), covered.viaKeyword, covered.keywordReason], [['doc-live-a'], true, 'unavailable']);
  const empty = fakeKeyword([]);
  await assert.rejects(retrieve(fakeSearch(new Error('503')).search, db, 'q', 'counsel', RETRIEVAL, { keywordFallback: empty.keyword, keywordOnOutage: true }), /503/);
  assert.equal(empty.calls.length, 1, 'tried by keyword; with nothing found it is still an outage, never "the documents do not say"');
});

test("localhost's refusal never falls back, and a failing fallback leaves the original error standing", async () => {
  const db = room();
  const local = fakeKeyword([{ docId: 'doc-live-a', text: '[[doc:doc-live-a p:1]]\nmemo' }]);
  await assert.rejects(retrieve(fakeSearch(new LocalSpendOff()).search, db, 'q', 'counsel', RETRIEVAL, { keywordFallback: local.keyword, keywordOnOutage: true }), LocalSpendOff);
  assert.equal(local.calls.length, 0, 'local development keeps its dev_remote_ai_off answer');
  const broken: KeywordSearch = async () => Promise.reject(new Error('no such table: page_fts'));
  const original = console.error;
  console.error = () => undefined;
  try {
    await assert.rejects(retrieve(fakeSearch(new BudgetExhausted('search_semantic')).search, db, 'q', 'counsel', RETRIEVAL, { keywordFallback: broken }), BudgetExhausted);
    await assert.rejects(retrieve(fakeSearch(new Error('503')).search, db, 'q', 'counsel', RETRIEVAL, { keywordFallback: broken, keywordOnOutage: true }), /503/);
  } finally {
    console.error = original;
  }
});

test('a fallback is logged once, with the reason word and the error name only, never the question', async () => {
  const db = room();
  const { keyword } = fakeKeyword([{ docId: 'doc-live-a', text: '[[doc:doc-live-a p:1]]\nmemo' }]);
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    await retrieve(fakeSearch(new TypeError('binding misconfigured')).search, db, 'zebra secret question', 'counsel', RETRIEVAL, { keywordFallback: keyword, keywordOnOutage: true });
    await retrieve(fakeSearch(new BudgetExhausted('search_semantic')).search, db, 'zebra secret question', 'counsel', RETRIEVAL, { keywordFallback: keyword });
    await retrieve(fakeSearch([chunk('doc-live-a', 1, 'memo')]).search, db, 'zebra secret question', 'counsel', RETRIEVAL, { keywordFallback: keyword });
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, [['search_keyword_fallback', 'unavailable', 'TypeError'], ['search_keyword_fallback', 'budget', 'BudgetExhausted']]);
  assert.equal(JSON.stringify(logged).includes('secret'), false);
});

test('keywordFallbackReady: only with a fallback and a built index; a missing table reads as not ready', async () => {
  const sql = schemaDb();
  const db = d1(sql);
  assert.equal(await keywordFallbackReady(db), false, 'migration 0009 applied, nothing indexed');
  indexPages(sql, 'doc-live-a', ['The zebra meeting happened in March.']);
  assert.equal(await keywordFallbackReady(db), true);
  sql.exec('DROP TABLE page_fts_docs');
  const original = console.error;
  console.error = () => undefined;
  try {
    assert.equal(await keywordFallbackReady(db), false);
  } finally {
    console.error = original;
  }
});

test('keywordFallbackFor picks the index without visuals, or with them for callers that include visuals', () => {
  assert.equal(keywordFallbackFor(false), KEYWORD_FALLBACK);
  assert.equal(keywordFallbackFor(true), KEYWORD_FALLBACK_WITH_VISUALS);
  assert.notEqual(KEYWORD_FALLBACK_WITH_VISUALS, ftsSearch);
});

// --- Through POST /api/ask ------------------------------------------------------------------------------------------

const ctx = {} as ExecutionContext;
const QUESTION = 'What does the alpha memo say about the zebra meeting?';
const NOV = new Date('2026-11-05T12:00:00Z');

async function events(res: Response) {
  const parser = sseParser();
  return [...parser.push(await res.text()), ...parser.end()];
}

const citedPages = (got: { event: string; data: unknown }[]) =>
  (got.find((e) => e.event === 'citations')!.data as { citations: { id: string; page: number }[] }).citations.map((c) => `${c.id} p${c.page}`);
const promptOf = (h: ReturnType<typeof harness>) => h.runs[0]!.input.messages.map((m) => m.content).join('\n');

/** Runs `body` with console.error silenced: the route logs reason words on these paths. */
async function quietly<T>(body: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await body();
  } finally {
    console.error = original;
  }
}

test('an exhausted AI Search month: Ask still answers, from keyword search, and its cites resolve', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOV });
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'never read')], answer: 'READ: The zebra meeting was in March [doc:doc-live-a p:2].' });
  indexPages(h.db, 'doc-live-a', ['Cover page.', 'The zebra meeting happened in March.']);
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('search_semantic', '2026-11', ?)").run(limitOf('search_semantic', '2026-11'));
  const res = await quietly(() => handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(res.status, 200, 'the search pre-check no longer refuses while keyword search can answer');
  const got = await events(res);
  assert.equal(h.searches.length, 0, 'AI Search was never called');
  assert.match(promptOf(h), /The zebra meeting happened in March\./);
  assert.deepEqual(citedPages(got), ['doc-live-a p2']);
});

test('an AI Search failure: Ask answers from keyword search; with nothing found by keyword it stays a 503', async () => {
  const h = harness({ searchFails: true, answer: 'READ: It was in March [doc:doc-live-a p:2].' });
  indexPages(h.db, 'doc-live-a', ['Cover page.', 'The zebra meeting happened in March.']);
  const res = await quietly(() => handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(res.status, 200);
  assert.deepEqual(citedPages(await events(res)), ['doc-live-a p2']);
  const miss = harness({ searchFails: true });
  indexPages(miss.db, 'doc-live-a', ['A lease about equipment.']);
  const down = await quietly(() => handle(askRequest({ question: QUESTION }), miss.env, ctx));
  assert.equal(down.status, 503);
  assert.deepEqual(await down.json(), { error: 'search_unavailable' });
  assert.equal(miss.runs.length, 0);
});

test("the neuron cap still refuses first, whatever the searches' state", async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOV });
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')] });
  indexPages(h.db, 'doc-live-a', ['The zebra meeting happened in March.']);
  const day = periodOf('neurons', NOV);
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', ?, ?), ('search_semantic', '2026-11', ?)").run(day, limitOf('neurons', day), limitOf('search_semantic', '2026-11'));
  const res = await quietly(() => handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'ai_budget' });
  assert.equal(h.searches.length + h.runs.length, 0);
  assert.equal((h.db.prepare('SELECT COALESCE(SUM(questions), 0) AS n FROM usage').get() as { n: number }).n, 0, 'no question spent');
});

test('ASK_VISUALS "0" (the default) keeps visual chunks out of Ask; "1" lets them in', async () => {
  const visual: FakeChunk = { key: 'text/doc-visual.p1.md', text: '[[doc:doc-visual p:1]]\nBOARD-VISUAL-TEXT' };
  for (const [flag, shown] of [[undefined, false], ['0', false], ['1', true]] as const) {
    const h = harness({ chunks: [chunk('doc-live-a', 1, 'memo text'), visual], extraVars: flag === undefined ? {} : { ASK_VISUALS: flag } });
    addVisual(h.db);
    await (await handle(askRequest({ question: QUESTION }), h.env, ctx)).text();
    assert.equal(promptOf(h).includes('BOARD-VISUAL-TEXT'), shown, `ASK_VISUALS ${flag}`);
    assert.match(promptOf(h), /memo text/);
  }
});

/** A harness with the law library on, its searches counted, and `left` AI Search queries left in November. */
function lawHarness(left: number, opts: Parameters<typeof harness>[0] = {}) {
  const law = { searches: 0 };
  const vars = { LAW_LIBRARY: '1', LAW: { get: async () => null }, LAW_SEARCH: { search: async () => ((law.searches += 1), { search_query: '', chunks: [] }) } };
  const h = harness({ ...opts, extraVars: vars as never });
  h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('search_semantic', '2026-11', ?)").run(limitOf('search_semantic', '2026-11') - left);
  const searchesUsed = () => (h.db.prepare("SELECT used FROM spend_counters WHERE meter = 'search_semantic'").get() as { used: number }).used;
  return { h, law, searchesUsed };
}

test('with the law library on and exactly enough queries left for both, both AI Search queries run', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOV });
  const { h, law, searchesUsed } = lawHarness(2, { chunks: [chunk('doc-live-a', 1, 'The zebra meeting happened.')] });
  const res = await handle(askRequest({ question: QUESTION }), h.env, ctx);
  assert.equal(res.status, 200);
  await res.text();
  assert.deepEqual([h.searches.length, law.searches], [1, 1], 'the record and the law library');
  assert.equal(searchesUsed(), limitOf('search_semantic', '2026-11'), 'exactly the limit, never past it');
});

test('with the law library on and one query left, no AI Search query runs and the record is answered by keyword', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOV });
  const { h, law, searchesUsed } = lawHarness(1, { chunks: [chunk('doc-live-a', 1, 'never read')], answer: 'READ: It was in March [doc:doc-live-a p:2].' });
  indexPages(h.db, 'doc-live-a', ['Cover page.', 'The zebra meeting happened in March.']);
  const res = await quietly(() => handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(res.status, 200);
  assert.deepEqual(citedPages(await events(res)), ['doc-live-a p2'], 'valid cites from the keyword passage');
  assert.deepEqual([h.searches.length, law.searches], [0, 0], 'no AI Search query, record or law');
  assert.match(promptOf(h), /The zebra meeting happened in March\./);
  assert.equal(searchesUsed(), limitOf('search_semantic', '2026-11') - 1, 'the last query is left untouched');
  assert.equal((h.db.prepare('SELECT COALESCE(SUM(questions), 0) AS n FROM usage').get() as { n: number }).n, 1, 'the question was answered');
});

test('while the keyword index is unbuilt, a spent month is refused at the pre-check: no cap taken, no audit row', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOV });
  for (const dropTable of [false, true]) {
    const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')] });
    if (dropTable) h.db.exec('DROP TABLE page_fts_docs');
    h.db.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('search_semantic', '2026-11', ?)").run(limitOf('search_semantic', '2026-11'));
    const res = await quietly(() => handle(askRequest({ question: QUESTION }), h.env, ctx));
    assert.equal(res.status, 429, `table dropped: ${dropTable}`);
    assert.deepEqual(await res.json(), { error: 'search_budget' });
    assert.equal((h.db.prepare('SELECT COUNT(*) AS n FROM usage').get() as { n: number }).n, 0, 'the daily cap was never touched');
    assert.equal((h.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ai_question'").get() as { n: number }).n, 0, 'no audit row');
    assert.equal(h.searches.length + h.runs.length, 0);
  }
});
