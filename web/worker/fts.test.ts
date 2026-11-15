// SPDX-License-Identifier: Apache-2.0
// worker/fts.ts on real SQLite with every migration applied (sqlite-d1.ts), searching rows written by the indexer's own
// statements (scripts/fts-rows.ts), on its own and as retrieve()'s keyword fallback (retrieval.ts KeywordSearch). The
// room is fts-fixtures.ts; Ask over the same fallback is in ask-fts.test.ts. Fictional DOE text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from './env.ts';
import {
  FtsNotBuilt,
  ftsSearch,
  hitOffsets,
  matchExpression,
  MAX_TERMS,
  MAX_WINDOW_CHARS,
  passageWindow,
  queryTerms,
  type FtsChunk,
  type FtsOptions,
} from './fts.ts';
import { addDoc, ids, index, NOTICE, REPAIR, room, roomWithEdgeCases, spent, TYPED } from './fts-fixtures.ts';
import { KEYWORD_FALLBACK_WITH_VISUALS, RETRIEVAL, retrieve, type KeywordSearch } from './retrieval.ts';
import { BudgetExhausted, budgetCode } from './spend.ts';
import { testDb } from './sqlite-d1.ts';

test('queryTerms: words without stopwords, quoted phrases, and split words kept as phrases', () => {
  assert.deepEqual(queryTerms('When did Mark Moe patch the gutter?'), [['Mark'], ['Moe'], ['patch'], ['gutter']]);
  assert.deepEqual(queryTerms('"notice of entry" Roe'), [['notice', 'of', 'entry'], ['Roe']]);
  for (const curly of ['\u201Cnotice of entry\u201D Roe', '\u201Enotice of entry\u201C Roe', '\u201Fnotice of entry\u201D Roe']) {
    assert.deepEqual(queryTerms(curly), [['notice', 'of', 'entry'], ['Roe']], 'curly quotes quote a phrase too');
  }
  assert.deepEqual(queryTerms("plaintiff's DOE-000012 1,000"), [['plaintiff', 's'], ['DOE', '000012'], ['1', '000']]);
  assert.deepEqual(queryTerms('who was there'), [['who'], ['was'], ['there']], 'all stopwords: kept rather than nothing');
  assert.deepEqual(queryTerms('Gutter gutter GUTTER'), [['Gutter']], 'duplicates go, whatever the case');
  assert.deepEqual(queryTerms('!!! ... ???'), []);
  assert.equal(queryTerms(Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')).length, MAX_TERMS);
  assert.deepEqual(queryTerms(`${'x'.repeat(65)} gutter`), [['gutter']], 'a run longer than any word is dropped');
  assert.equal(queryTerms(`gutter ${'a '.repeat(3000)}notice`).some((t) => t[0] === 'notice'), false, 'only the first 2,000 characters are read');
});

test('matchExpression: only quoted strings joined by OR, whatever FTS5 syntax the query holds', () => {
  const attempts = [
    'gutter) OR doc_id:"doc-minutes',
    'text:gutter NOT notice',
    'NEAR(gutter notice, 2)',
    'gutter* ^notice',
    '{text doc_id}: gutter',
    '"unbalanced gutter',
    "gutter'); DROP TABLE documents; --",
    'gutter AND (notice OR',
  ];
  for (const query of attempts) assert.match(matchExpression(queryTerms(query)) ?? '', /^"[^"]+"(?: OR "[^"]+")*$/, query);
  assert.equal(matchExpression([]), null);
});

test('ftsSearch: injection attempts are plain words, never errors, and never reach other columns', async () => {
  const t = room();
  for (const query of ['doc_id:doc-minutes', 'gutter) OR (budget', 'NOT gutter', '"', 'text : * ^', 'NEAR(gutter, budget)', "'; DELETE FROM page_fts; --"]) {
    await assert.doesNotReject(ftsSearch(t.db, query, 'owner'), query);
  }
  assert.deepEqual(ids(await ftsSearch(t.db, 'doc_id:doc-minutes', 'owner')), [], 'doc_id is not searchable text');
  assert.deepEqual(ids(await ftsSearch(t.db, 'NOT gutter', 'owner')).sort(), ['doc-gutter', 'doc-minutes'], 'NOT is a word here');
  assert.equal(t.sqlite.prepare('SELECT COUNT(*) AS n FROM page_fts').get()!.n, 4, 'nothing was deleted');
});

test('ftsSearch: the page that matches best comes first, with bm25 scores falling', async () => {
  const t = room();
  const got = await ftsSearch(t.db, 'Mark Moe copper gutter Harbor Labs', 'owner');
  assert.deepEqual(ids(got), ['doc-gutter', 'doc-notice', 'doc-minutes']);
  assert.deepEqual([got[0]!.page, got[0]!.name], [2, 'Gutter.pdf']);
  const scores = got.map((chunk) => chunk.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.ok(scores.every((score) => score > 0));
  assert.deepEqual(ids(await ftsSearch(t.db, 'patching gutters', 'owner'))[0], 'doc-gutter', 'porter: patching finds patched, gutters finds gutter');
  assert.equal((await ftsSearch(t.db, 'gutter', 'owner', 1)).length, 1, 'limit');
});

// The retired family role: no member holds it, but a role without viewPrivileged must still be filtered.
const RETIRED = 'family' as Role;

test('ftsSearch: privileged, removed and hidden documents stay out; visuals only when asked for', async () => {
  const t = roomWithEdgeCases();
  const seen = async (role: Role, options?: FtsOptions) => ids(await ftsSearch(t.db, 'copper gutter escalation', role, 50, options)).sort();
  assert.deepEqual(await seen(RETIRED), ['doc-gutter', 'doc-minutes'], 'by default, as retrieve(): no visuals');
  for (const role of ['owner', 'counsel'] as const) assert.deepEqual(await seen(role), ['doc-gutter', 'doc-minutes', 'doc-priv', 'doc-priv-name'], role);
  assert.deepEqual(await seen('owner', { withoutVisuals: false }), ['doc-gutter', 'doc-minutes', 'doc-priv', 'doc-priv-name', 'doc-visual']);
  assert.deepEqual(await seen(RETIRED, { withoutVisuals: false }), ['doc-gutter', 'doc-minutes', 'doc-visual']);
  assert.deepEqual(await seen('owner', { withoutVisuals: true }), await seen('owner'));
});

test('ftsSearch: visuals are left out before LIMIT, so a visual never takes a passage slot', async () => {
  const t = roomWithEdgeCases();
  const best = async (options?: FtsOptions) => ids(await ftsSearch(t.db, 'escalation visual', 'owner', 1, options));
  assert.deepEqual(await best({ withoutVisuals: false }), ['doc-visual'], 'the visual matches best');
  const [only] = await best();
  assert.ok(only && only !== 'doc-visual', 'by default the one slot goes to the best other page');
});

test('retrieve() with the fallback: visuals follow includeVisuals once the seam passes it on (7c)', async () => {
  const t = roomWithEdgeCases();
  const passing: KeywordSearch = (db, query, role, limit) => TYPED(db, query, role, limit, { withoutVisuals: false });
  const viaRetrieve = async (role: Role, includeVisuals: boolean, keywordFallback: KeywordSearch) =>
    ids((await retrieve(spent, t.db, 'copper gutter escalation', role, RETRIEVAL, { includeVisuals, keywordFallback })).chunks).sort();
  assert.deepEqual(await viaRetrieve(RETIRED, false, ftsSearch), ['doc-gutter', 'doc-minutes'], 'quick Ask: no visuals, nothing privileged');
  assert.deepEqual(await viaRetrieve(RETIRED, false, passing), ['doc-gutter', 'doc-minutes'], "retrieve()'s own filter holds too");
  assert.deepEqual(await viaRetrieve('counsel', true, passing), ['doc-gutter', 'doc-minutes', 'doc-priv', 'doc-priv-name', 'doc-visual'], 'MCP search');
  assert.deepEqual(await viaRetrieve('counsel', true, ftsSearch), ['doc-gutter', 'doc-minutes', 'doc-priv', 'doc-priv-name'], 'a call with no options leaves visuals out');
});

test('the MCP keeps visuals in keyword search too: KEYWORD_FALLBACK_WITH_VISUALS through retrieve() (7c)', async () => {
  const t = roomWithEdgeCases();
  const mcp = await retrieve(spent, t.db, 'copper gutter escalation', RETIRED, RETRIEVAL, { includeVisuals: true, keywordFallback: KEYWORD_FALLBACK_WITH_VISUALS });
  assert.deepEqual(ids(mcp.chunks).sort(), ['doc-gutter', 'doc-minutes', 'doc-visual'], 'visuals in, privileged still out for the retired role');
});

test('ftsSearch: a long page returns a window around its hits, not the whole page', async () => {
  const t = room();
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `filler${i % 50}`).join(' ');
  index(t, 'doc-gutter', [`${filler(800)} The freezer deposit was returned. ${filler(800)}`]);
  const [chunk] = await ftsSearch(t.db, 'freezer deposit', 'owner');
  assert.ok(chunk);
  assert.match(chunk.text, /^\[\[doc:doc-gutter p:1\]\]\n\.\.\. .*freezer deposit was returned.* \.\.\.$/s);
  assert.ok(chunk.text.length < 1500 + 60);
  const wide = (await ftsSearch(t.db, 'freezer deposit', 'owner', 5, { windowChars: 99_999 }))[0]!;
  assert.ok(wide.text.length <= MAX_WINDOW_CHARS + 60 && wide.text.length > 2000, 'windowChars is capped at MAX_WINDOW_CHARS');
});

test('passageWindow and hitOffsets: the window with the most hits, whole words, no split characters', () => {
  assert.deepEqual(hitOffsets('a \u0002gutter\u0003 and \u0002notice\u0003'), { text: 'a gutter and notice', hits: [2, 13] });
  assert.equal(passageWindow('  short page  ', [0], 300), 'short page');
  const text = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ');
  const hits = [text.indexOf('w10 '), text.indexOf('w300'), text.indexOf('w305'), text.indexOf('w310')];
  const window = passageWindow(text, hits, 300);
  assert.match(window, /w300 .*w305 .*w310/, 'the cluster wins over the lone hit');
  assert.doesNotMatch(window, /\bw10\b/);
  assert.match(window, /^\.\.\. w\d+ .* w\d+ \.\.\.$/, 'cut at word boundaries, marked on both sides');
  const cut = passageWindow('\u{1F600}'.repeat(400), [300], 201);
  assert.doesNotMatch(cut.replace(/^\.\.\. | \.\.\.$/g, ''), /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, 'no lone surrogate');
});

test('the search runs the MATCH once, sorted by FTS5 itself, and finds each document by primary key', async () => {
  const t = room();
  const queries: string[] = [];
  const spy = { prepare: (sql: string) => (queries.push(sql), t.db.prepare(sql)) } as unknown as D1Database;
  await ftsSearch(spy, 'gutter', RETIRED); // with the privilege filter in the SQL
  const plan = t.sqlite.prepare(`EXPLAIN QUERY PLAN ${queries[0]!.replace('?1', `'"gutter"'`).replace('?2', '20')}`).all() as { detail: string }[];
  const details = plan.map((row) => row.detail);
  assert.match(details[0]!, /^SCAN page_fts VIRTUAL TABLE INDEX (\d+):/, 'page_fts is the outer loop');
  assert.ok(Number(/INDEX (\d+):/.exec(details[0]!)![1]) & 32, 'FTS5 orders by rank itself (FTS5_BI_ORDER_RANK)');
  assert.match(details[1]!, /^SEARCH d USING INDEX sqlite_autoindex_documents_1 \(id=\?\)/);
  assert.equal(details.some((detail) => /TEMP B-TREE/.test(detail)), false, 'no sort of every match');
});

test('an empty index is the refusal there would be without a fallback; a built one with no match returns nothing', async () => {
  const t = testDb();
  addDoc(t, 'doc-gutter', '01-Contracts/Gutter.pdf');
  await assert.rejects(ftsSearch(t.db, 'gutter', 'owner'), FtsNotBuilt);
  await assert.rejects(retrieve(spent, t.db, 'gutter', 'owner', RETRIEVAL, { keywordFallback: ftsSearch }), (error: unknown) => {
    assert.ok(error instanceof BudgetExhausted);
    assert.equal(budgetCode(error.meter), 'search_budget');
    return true;
  });
  assert.deepEqual(await ftsSearch(t.db, '???', 'owner'), [], 'no terms: no query at all');
  index(t, 'doc-gutter', [REPAIR]);
  assert.deepEqual(await ftsSearch(t.db, 'mortgage', 'owner'), []);
});

test('retrieve() with the fallback: a repeated passage (a filed and a served copy) comes after distinct ones', async () => {
  const t = room();
  addDoc(t, 'doc-copy', '04-Letters/Notice-served.pdf');
  index(t, 'doc-copy', [NOTICE]);
  const query = 'notice entry Mark gutter';
  const got: FtsChunk[] = await ftsSearch(t.db, query, 'owner');
  assert.deepEqual(ids(got).slice(0, 2).sort(), ['doc-copy', 'doc-notice'], 'ftsSearch ranks both copies first');
  assert.equal(got.length, 4);
  const { chunks } = await retrieve(spent, t.db, query, 'owner', RETRIEVAL, { keywordFallback: ftsSearch });
  assert.equal(ids(chunks)[0], ids(got)[0]);
  assert.deepEqual(ids(chunks).slice(1, 3).sort(), ['doc-gutter', 'doc-minutes']);
  assert.equal(ids(chunks).at(-1), ids(got)[1], 'the second copy is last');
});
