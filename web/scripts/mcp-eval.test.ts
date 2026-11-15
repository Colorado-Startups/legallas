// SPDX-License-Identifier: Apache-2.0
// The legallas-mcp retrieval eval: scoring, the item loop, the local path through a fake server, and the
// replica's parts (REST response shapes, the in-memory documents copy, wrangler output). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEvalSet, type EvalItem } from './ask-eval-score.ts';
import { evaluate, localSearch, OVERVIEW_SECTIONS, parseMcpEvalArgs, probeSizes, resultBytes, searchVia, type SearchCall, type ToolCall } from './mcp-eval.ts';
import { firstHit, formatOutcome, passagesFrom, retrievalItems, scoreItem, summarize } from './mcp-eval-score.ts';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createReplica, documentsDb, memoryFiles, normalizeSearchResponse, publishedMatter, restSearch, type ToolHandler } from './mcp-replica.ts';
import { fakeServer } from './mcp-testkit.ts';

const EXAMPLE = parseEvalSet(JSON.parse(readFileSync(join(import.meta.dirname, 'ask-eval.example.json'), 'utf8')));
const item = (id: string, citesAnyOf?: string[]): EvalItem => ({ id, kind: 'known', question: `Secret question ${id}?`, expect: citesAnyOf ? { citesAnyOf } : {} });
const passage = (id: string, name: string) => ({ id, name, page: 1 });
/** A documents row with every NOT NULL column, as the remote SELECT * returns it. */
const docRow = (id: string, name: string) => ({ id, name, path: `01-Contracts/${name}`, folder: '01-Contracts', kind: 'pdf', content_type: 'application/pdf', size: 1, r2_key: `${id}-key`, source: 'mirror', updated_at: '2026-10-01T00:00:00Z' });
const searchResult = (rows: { id: string; name: string }[]) => ({ content: [{ type: 'text', text: 'x' }], structuredContent: { results: rows.map((r) => ({ ...r, page: 2, text: 'Case text' })) } });

test('arguments: local by default, replica by flag, --top bounded, example local only', () => {
  assert.deepEqual(parseMcpEvalArgs([]), { mode: 'local', base: 'http://localhost:8790', set: null, example: false, top: 10, matter: null });
  assert.match(parseMcpEvalArgs(['--replica', '--matter', 'build/matter.json']).matter!, /build\/matter\.json$/);
  assert.throws(() => parseMcpEvalArgs(['--matter', 'm.json']), /--matter is for --replica/);
  assert.equal(parseMcpEvalArgs(['--replica', '--top', '20']).mode, 'replica');
  assert.throws(() => parseMcpEvalArgs(['--top', '21']), /--top/);
  assert.throws(() => parseMcpEvalArgs(['--top', '0']), /--top/);
  assert.throws(() => parseMcpEvalArgs(['--replica', '--example']), /local dev only/);
  assert.throws(() => parseMcpEvalArgs(['--base', 'https://mcp.room.example.com']), /localhost/);
});

test('only items naming expected documents are scored (the example set has one)', () => {
  assert.deepEqual(retrievalItems(EXAMPLE).map((i) => i.id), ['dummy-known-event']);
  assert.deepEqual(retrievalItems([item('a', ['  ']), item('b')]), []);
});

test('a hit is an id match or a case-insensitive name match within the top N; rank is 1-based', () => {
  const want = item('k', ['ALPHA-timeline', 'doc-9']);
  const ranked = [passage('d1', 'Bravo.pdf'), passage('d2', 'Notes alpha-Timeline v2.pdf'), passage('doc-9', 'Other.pdf')];
  assert.equal(firstHit(want, ranked, 10), 2);
  assert.equal(firstHit(want, ranked, 1), null);
  assert.equal(firstHit(item('k', ['doc-9']), ranked, 3), 3);
  assert.deepEqual(scoreItem(want, ranked, 1), { id: 'k', status: 'miss', rank: null, passages: 1, error: null });
});

test('summary: recall and MRR over scored items; lines carry ids and numbers, never questions', () => {
  const s = summarize([
    { id: 'a', status: 'hit', rank: 1, passages: 10, error: null },
    { id: 'b', status: 'hit', rank: 4, passages: 10, error: null },
    { id: 'c', status: 'miss', rank: null, passages: 10, error: null },
    { id: 'd', status: 'error', rank: null, passages: 0, error: 'daily_limit' },
  ]);
  assert.deepEqual(s, { scored: 4, hits: 2, misses: 1, errors: 1, recall: 0.5, mrr: (1 + 0.25) / 4 });
  assert.equal(formatOutcome({ id: 'b', status: 'hit', rank: 4, passages: 10, error: null }, 10).replace(/\s+/g, ' '), 'HIT b rank 4 (10 of top 10)');
  assert.equal(summarize([]).recall, 0);
});

test('passages are read from structuredContent, or from the JSON text block when it is absent', () => {
  const rows = [{ id: 'd1', title: 'Alpha', page: 3 }, { id: 'd2', name: 'Bravo' }];
  assert.deepEqual(passagesFrom({ structuredContent: { query: 'q', total: 2, results: rows } }), [{ id: 'd1', name: 'Alpha', page: 3 }, { id: 'd2', name: 'Bravo', page: null }]);
  assert.deepEqual(passagesFrom({ content: [{ type: 'text', text: JSON.stringify({ passages: rows }) }] }).map((p) => p.id), ['d1', 'd2']);
  assert.deepEqual(passagesFrom({ content: [{ type: 'text', text: 'not json' }] }), []);
  assert.deepEqual(passagesFrom(null), []);
  assert.equal(passagesFrom({ structuredContent: { results: [{ id: 'd', title: 'Document name', name: 'Other' }] } })[0]!.name, 'Document name', 'title (the D1 name) wins');
});

test('evaluate: scores each item, prints no question, and stops on a code that dooms the rest', async () => {
  const lines: string[] = [];
  const asked: string[] = [];
  const call: SearchCall = async (query) => {
    asked.push(query);
    if (asked.length === 3) return { result: { isError: true, content: [{ type: 'text', text: 'daily_limit: reached' }] }, error: null };
    return { result: searchResult([{ id: 'd1', name: 'Alpha memo.pdf' }]), error: null };
  };
  const items = [item('a', ['alpha']), item('b', ['bravo']), item('c', ['alpha']), item('d', ['alpha']), item('skip')];
  const outcomes = await evaluate(items, call, 10, (line) => lines.push(line));
  assert.deepEqual(outcomes.map((o) => `${o.id}:${o.status}:${o.error ?? ''}`), ['a:hit:', 'b:miss:', 'c:error:daily_limit']);
  assert.equal(asked.length, 3);
  assert.doesNotMatch(lines.join('\n'), /Secret question|Case text/);
});

test('evaluate: a thrown error or a transport failure is an error outcome with a code', async () => {
  const outcomes = await evaluate([item('a', ['x']), item('b', ['x'])], async (q) => {
    if (q.includes(' a?')) throw new Error('search_http_500');
    return { result: null, error: 'http_502' };
  }, 5);
  assert.deepEqual(outcomes.map((o) => o.error), ['search_http_500', 'http_502']);
});

test('local: a token from the no-browser flow, then legallas_search through MCP', async () => {
  const fake = fakeServer({ tools: { legallas_search: searchResult([{ id: 'd7', name: 'alpha-timeline.pdf' }]) } });
  const { call, report } = await localSearch(fake.fetcher, 'http://localhost:8790');
  assert.ok(call, JSON.stringify(report.checks));
  const outcomes = await evaluate(EXAMPLE, searchVia(call), 10);
  assert.deepEqual(outcomes.map((o) => [o.id, o.status, o.rank]), [['dummy-known-event', 'hit', 1]]);
});

test('replica: REST results in either shape become the binding shape; failures carry a code only', () => {
  const chunk = { id: 'c1', type: 'text', score: 0.9, text: 'Case text', item: { key: 'text/d1.p2.md' } };
  assert.deepEqual(normalizeSearchResponse({ success: true, result: { search_query: 'q', chunks: [chunk] } }).chunks, [chunk]);
  const legacy = normalizeSearchResponse({ success: true, result: { data: [{ file_id: 'f', filename: 'text/d2.p1.md', score: 0.5, content: [{ text: 'a' }, { text: 'b' }] }] } });
  assert.deepEqual(legacy.chunks, [{ id: 'f', type: 'text', score: 0.5, text: 'a\nb', item: { key: 'text/d2.p1.md' } }]);
  assert.throws(() => normalizeSearchResponse({ success: false, errors: [{ code: 7003, message: 'Secret' }] }), (e: Error) => e.message === 'search_failed_7003');
});

test('replica: the REST call goes to the account instance with the bearer token and the tool request body', async () => {
  const seen: { url: string; auth: string | null; body: unknown }[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), auth: new Headers(init?.headers).get('Authorization'), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ success: true, result: { chunks: [] } }));
  };
  const account = 'a'.repeat(32);
  await restSearch(fetcher, account, 'tok').search({ query: 'q' });
  assert.deepEqual(seen, [{ url: `https://api.cloudflare.com/client/v4/accounts/${account}/ai-search/namespaces/default/instances/legallas/search`, auth: 'Bearer tok', body: { query: 'q' } }]);
  assert.throws(() => restSearch(fetcher, '../x', 'tok'), /32 hex/);
  const denied = async () => new Response('{}', { status: 403 });
  await assert.rejects(restSearch(denied, account, 'tok').search({}), /search_http_403/);
});

test('replica: the documents copy keeps known columns and answers the tool queries', async () => {
  const db = (await documentsDb([{ ...docRow('d1', 'Alpha.pdf'), not_a_column: 'x' }])) as D1Like;
  const row = await db.prepare('SELECT id, name FROM documents WHERE id = ?1').bind('d1').first<{ id: string; name: string }>();
  assert.deepEqual(row, { id: 'd1', name: 'Alpha.pdf' });
});

interface D1Like {
  prepare(sql: string): { bind(...args: unknown[]): { first<T>(): Promise<T | null> } };
}

test('replica: the tool handler gets SEARCH, the documents copy and the prefix, and its result is returned', async () => {
  const requests: unknown[] = [];
  const search = { search: async (request: unknown) => (requests.push(request), { search_query: '', chunks: [] }) };
  const tool: ToolHandler = {
    async handler(args, ctx) {
      const env = (ctx as { env: { DB: D1Like; SEARCH: typeof search; CONTROL_PREFIX?: string } }).env;
      await env.SEARCH.search({ query: args.query });
      assert.equal(await (ctx as { env: { FILES: ReturnType<typeof memoryFiles> } }).env.FILES.get('meta/matter.json'), null, 'nothing published');
      const doc = await env.DB.prepare('SELECT id, name FROM documents WHERE id = ?1').bind('d1').first<{ id: string; name: string }>();
      return searchResult([{ id: doc!.id, name: `${env.CONTROL_PREFIX} ${doc!.name}` }]);
    },
  };
  const replica = await createReplica({ search, rows: [docRow('d1', 'Alpha.pdf')], controlPrefix: 'ABC', tools: { legallas_search: tool } });
  const result = await replica.search('q', 5);
  assert.deepEqual(passagesFrom(result).map((p) => p.name), ['ABC Alpha.pdf']);
  assert.deepEqual(requests, [{ query: 'q' }]);
});

test('replica: the real search and overview tools load and return tool results', async () => {
  const replica = await createReplica({ search: { search: async () => ({ search_query: '', chunks: [] }) }, rows: [], controlPrefix: undefined, matter: null });
  assert.ok(Array.isArray((await replica.search('anything', 3)).content));
  assert.ok(Array.isArray((await replica.callTool('legallas_case_overview', { section: 'summary' })).content));
});

test('replica: FILES serves only the published manifest, read from memory', async () => {
  const files = memoryFiles('meta/matter.json', '{"a":1}');
  assert.equal(await (await files.get('meta/matter.json'))!.text(), '{"a":1}');
  assert.equal(await files.get('other'), null);
  assert.equal(await memoryFiles('meta/matter.json', null).get('meta/matter.json'), null);
});

test('replica: the published manifest is read through a temp directory that is gone afterwards', async () => {
  let where = '';
  const text = await publishedMatter(async (file) => {
    where = file;
    await writeFile(file, '{"matter":true}');
  });
  assert.equal(text, '{"matter":true}');
  assert.equal(existsSync(dirname(where)), false);
  await assert.rejects(publishedMatter(async () => { throw new Error('wrangler r2 object failed'); }), /wrangler/);
});

test('sizes: each overview section and one 20-passage search, as bytes only', async () => {
  const seen: string[] = [];
  const call: ToolCall = async (name, args) => {
    seen.push(`${name}:${String(args.section ?? args.limit)}`);
    if (args.section === 'money') return { result: { isError: true, content: [{ type: 'text', text: 'overview_unavailable: Secret' }] }, error: null };
    return { result: name === 'legallas_search' ? searchResult([{ id: 'd1', name: 'Case text' }]) : { content: [{ type: 'text', text: 'Case text é' }] }, error: null };
  };
  const lines = await probeSizes(call, 'Secret question?');
  assert.deepEqual(seen, [...OVERVIEW_SECTIONS.map((s) => `legallas_case_overview:${s}`), 'legallas_search:20']);
  assert.equal(lines.length, OVERVIEW_SECTIONS.length + 1);
  assert.match(lines[0]!, /^SIZE  legallas_case_overview summary\s+\d+ bytes$/);
  assert.match(lines[OVERVIEW_SECTIONS.indexOf('money')]!, /code overview_unavailable$/);
  assert.match(lines.at(-1)!, /legallas_search limit 20\s+\d+ bytes, 1 passages$/);
  assert.doesNotMatch(lines.join('\n'), /Secret|Case text/);
  assert.equal(resultBytes({ t: 'é' }), 10, 'UTF-8 bytes, not characters');
  assert.equal((await probeSizes(call, null)).length, OVERVIEW_SECTIONS.length, 'no search probe without a question');
});
