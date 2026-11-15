// SPDX-License-Identifier: Apache-2.0
// The local search stand-ins: localhost and the flag only, real chunk shape, keyword scoring, result limit, and the
// law library's scan of the local legallas-law bucket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetExhausted } from '../worker/spend.ts';
import type { McpEnv } from './contract.ts';
import { resetLawCatalog } from '../worker/law.ts';
import { lawKey, type LawChunk } from '../worker/law-cite.ts';
import { ENTRY } from '../worker/law-fixtures.ts';
import { devLawSearch, devSearch, devSearchEnabled, splitChunks, withDevSearch } from './dev-search.ts';

function fakeIndex(parts: Record<string, string>): R2Bucket {
  return {
    async list({ prefix }: { prefix: string }) {
      return { objects: Object.keys(parts).filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
    },
    async get(key: string) {
      return key in parts ? { text: async () => parts[key] } : null;
    },
  } as unknown as R2Bucket;
}

test('only on localhost with MCP_SEARCH_MOCK=1', () => {
  const on = { MCP_SEARCH_MOCK: '1' } as McpEnv;
  assert.equal(devSearchEnabled(new Request('http://localhost:8790/mcp'), on), true);
  assert.equal(devSearchEnabled(new Request('https://mcp.room.example.com/mcp'), on), false);
  assert.equal(devSearchEnabled(new Request('http://localhost:8790/mcp'), {} as McpEnv), false);
  const real = { MCP_SEARCH_MOCK: '1', SEARCH: 'real' } as unknown as McpEnv;
  assert.equal(withDevSearch(new Request('https://mcp.room.example.com/mcp'), real).SEARCH, 'real');
});

test('MCP_SEARCH_MOCK=keyword refuses as a spent month does, on localhost only', async () => {
  const real = { MCP_SEARCH_MOCK: 'keyword', SEARCH: 'real' } as unknown as McpEnv;
  assert.equal(withDevSearch(new Request('https://mcp.room.example.com/mcp'), real).SEARCH, 'real');
  const local = withDevSearch(new Request('http://localhost:8790/mcp'), real).SEARCH as unknown as Pick<AiSearchInstance, 'search'>;
  await assert.rejects(local.search({ query: 'x' } as never), (error: unknown) => error instanceof BudgetExhausted);
});

test('splits on paragraphs and keeps page markers inline', () => {
  const text = `[[doc:a p:1]]\n${'word '.repeat(200)}\n\n[[doc:a p:2]]\n${'more '.repeat(200)}`;
  const chunks = splitChunks(text);
  assert.equal(chunks.length, 2);
  assert.match(chunks[1], /^\[\[doc:a p:2\]\]/);
});

test('scores by matching terms, keys chunks like AI Search and respects the limit', async () => {
  const search = devSearch(
    fakeIndex({
      'text/a.p1.md': '[[doc:a p:1]]\nThe supply agreement was signed in April.',
      'text/b.p1.md': '[[doc:b p:1]]\nNothing relevant here.',
      'text/c.p1.md': '[[doc:c p:1]]\nThe agreement terms.',
    }),
  );
  const result = (await search.search({ query: 'agreement signed', ai_search_options: { retrieval: { max_num_results: 1 } } } as never)) as unknown as {
    chunks: { text: string; item: { key: string } }[];
  };
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].item.key, 'text/a.p1.md');
  const none = (await search.search({ query: 'zebra' } as never)) as unknown as { chunks: unknown[] };
  assert.equal(none.chunks.length, 0);
});

/** A local legallas-law bucket: catalog.json and each part's text under law/<track>/<id>.md. */
function fakeLaw(entries: LawChunk[], etag: string): R2Bucket {
  return {
    async get(key: string) {
      if (key === 'catalog.json') return { etag, body: true, json: async () => ({ version: 1, built: '2026-11-07', chunks: entries }) };
      const entry = entries.find((e) => lawKey(e) === key);
      return entry ? { text: async () => `${entry.cite}. ${entry.title}\n\nText of ${entry.id}.` } : null;
    },
  } as unknown as R2Bucket;
}

const LAW_ENTRIES = [
  ENTRY('crs-7-108-108', 'civil', { cite: 'C.R.S. § 7-108-108', title: 'Removal of directors by shareholders' }),
  ENTRY('del-8-141~2', 'civil', { cite: '8 Del. C. § 141', title: 'Board of directors; powers; number, qualifications, terms and quorum' }),
  ENTRY('del-8-141~1', 'civil', { cite: '8 Del. C. § 141', title: 'Board of directors; powers; number, qualifications, terms and quorum' }),
  ENTRY('usc-26-1202', 'both', { cite: '26 U.S.C. § 1202', title: 'Partial exclusion for gain from certain small business stock' }),
];

test('the law scan answers a named statute with its parts in order, and other queries by heading words', async () => {
  resetLawCatalog();
  const search = devLawSearch(fakeLaw(LAW_ENTRIES, 'law-1'));
  const keys = async (query: string) =>
    ((await search.search({ query } as never)) as unknown as { chunks: { item: { key: string }; scoring_details: { vector_score: number } }[] }).chunks.map((c) => c.item.key);
  assert.deepEqual(await keys('8 Del. C. 141'), ['law/civil/del-8-141~1.md', 'law/civil/del-8-141~2.md']);
  assert.deepEqual(await keys('C.R.S. § 7-108-108'), ['law/civil/crs-7-108-108.md']);
  assert.deepEqual(await keys('small business stock'), ['law/both/usc-26-1202.md']);
  assert.deepEqual(await keys('C.R.S. § 7-90-801'), []);
});

test('the law scan stands in for LAW_SEARCH only on localhost, with the library on and LAW bound', () => {
  const law = fakeLaw(LAW_ENTRIES, 'law-2');
  const env = { MCP_SEARCH_MOCK: '1', LAW_LIBRARY: '1', LAW: law, LAW_SEARCH: 'real' } as unknown as McpEnv;
  assert.notEqual(withDevSearch(new Request('http://localhost:8790/mcp'), env).LAW_SEARCH, 'real');
  assert.equal(withDevSearch(new Request('https://mcp.room.example.com/mcp'), env).LAW_SEARCH, 'real');
  assert.equal(withDevSearch(new Request('http://localhost:8790/mcp'), { ...env, LAW_LIBRARY: '0' }).LAW_SEARCH, 'real');
  assert.equal(withDevSearch(new Request('http://localhost:8790/mcp'), { ...env, LAW: undefined }).LAW_SEARCH, 'real');
});
