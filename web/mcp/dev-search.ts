// SPDX-License-Identifier: Apache-2.0
// MCP_SEARCH_MOCK: a local stand-in for the AI Search binding under `npm run mcp:dev`. The real binding is
// remote-only (it fails under wrangler dev, and would read production if it did not), so local runs scan the
// local INDEX parts by keyword instead. Honoured only when MCP_SEARCH_MOCK=1 (.dev.vars) AND the request host is
// localhost, exactly like the room's ASK_MOCK; mcp/config.test.ts keeps it out of wrangler.mcp.jsonc.
//
// It returns the real wire shape (chunks keyed text/<id>.p<N>.md with page markers in their text), so the real
// retrieve(), live-document filter and citation handling all run.
//
// MCP_SEARCH_MOCK=keyword, on the same terms: AI Search answers as it does once the month's allowance is spent, so retrieve()
// falls back to the real keyword index (worker/fts.ts). The sample room's lab uses it, because the scan above ranks by a
// rule of its own and a lab score has to come from the search a room can really fall back to.
//
// The law library's search (LAW_SEARCH, also remote-only) gets the same stand-in while LAW_LIBRARY is "1" and LAW is
// bound: devLawSearch() reads the local legallas-law bucket that `npm run law -- --only <units> --local` fills, so the
// real catalog checks, track checks and citations run on localhost (the fixture room's law input).
import { LOCAL_HOSTS } from '../worker/auth.ts';
import { lawCatalog } from '../worker/law.ts';
import { citationsIn, lawKey, unitIdFor, unitOf, type LawChunk } from '../worker/law-cite.ts';
import { BudgetExhausted } from '../worker/spend.ts';
import type { McpEnv } from './contract.ts';

const MAX_PARTS = 200;
const CHUNK_CHARS = 1200;
const DEFAULT_RESULTS = 10;

const isLocal = (request: Request) => LOCAL_HOSTS.has(new URL(request.url).hostname);

export function devSearchEnabled(request: Request, env: Pick<McpEnv, 'MCP_SEARCH_MOCK'>): boolean {
  return env.MCP_SEARCH_MOCK === '1' && isLocal(request);
}

interface Chunk {
  id: string;
  type: 'text';
  score: number;
  text: string;
  item: { key: string };
}

/** Lower-case words of three or more letters; the scan scores a chunk by how many of them it contains. */
function terms(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])];
}

/** Splits a part's text into roughly CHUNK_CHARS pieces on paragraph boundaries, keeping page markers inline. */
export function splitChunks(text: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const paragraph of text.split(/\n{2,}/)) {
    if (current && current.length + paragraph.length > CHUNK_CHARS) {
      out.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current.trim()) out.push(current);
  return out;
}

async function listParts(index: R2Bucket): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await index.list({ prefix: 'text/', cursor, limit: 1000 });
    for (const object of page.objects) keys.push(object.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && keys.length < MAX_PARTS);
  return keys.slice(0, MAX_PARTS);
}

/** A keyword scan over the local index with AI Search's search() shape. */
export function devSearch(index: R2Bucket): Pick<AiSearchInstance, 'search'> {
  return {
    async search(params) {
      const query = 'query' in params && typeof params.query === 'string' ? params.query : '';
      const wanted = terms(query);
      const limit = params.ai_search_options?.retrieval?.max_num_results ?? DEFAULT_RESULTS;
      const scored: Chunk[] = [];
      for (const key of await listParts(index)) {
        const object = await index.get(key);
        if (!object) continue;
        splitChunks(await object.text()).forEach((text, i) => {
          const lower = text.toLowerCase();
          const score = wanted.filter((term) => lower.includes(term)).length;
          if (score > 0) scored.push({ id: `${key}#${i}`, type: 'text', score: score / wanted.length, text, item: { key } });
        });
      }
      scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { search_query: query, chunks: scored.slice(0, limit) } as unknown as AiSearchSearchResponse;
    },
  };
}

const SPENT_SEARCH: Pick<AiSearchInstance, 'search'> = { search: async () => Promise.reject(new BudgetExhausted('search_semantic')) };

/** The part number of a law chunk id (`<unit>~<n>`), 0 for a unit indexed whole. */
const partOf = (id: string) => Number(/~([0-9]+)$/.exec(id)?.[1] ?? 0);

/**
 * A scan of the local law bucket with AI Search's search() shape. A query that names statutes (C.R.S. 7-108-108,
 * 8 Del. C. § 141) returns those units' parts; any other query scores each unit by the words its citation and heading
 * share with it. Chunks are keyed law/<track>/<id>.md like the real instance, so retrieveLaw() checks them as it would.
 */
export function devLawSearch(law: R2Bucket): Pick<AiSearchInstance, 'search'> {
  return {
    async search(params) {
      const query = 'query' in params && typeof params.query === 'string' ? params.query : '';
      const limit = params.ai_search_options?.retrieval?.max_num_results ?? DEFAULT_RESULTS;
      const catalog = await lawCatalog(law);
      const named = new Set(citationsIn(query).flatMap(({ cite }) => unitIdFor(cite) ?? []));
      const wanted = terms(query);
      const score = (entry: LawChunk) => {
        if (named.size > 0) return named.has(unitOf(entry.id)) ? 1 : 0;
        const words = `${entry.cite} ${entry.title}`.toLowerCase();
        return wanted.length === 0 ? 0 : wanted.filter((term) => words.includes(term)).length / wanted.length;
      };
      const ranked = [...(catalog?.values() ?? [])]
        .map((entry) => ({ entry, score: score(entry) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || (unitOf(a.entry.id) < unitOf(b.entry.id) ? -1 : unitOf(a.entry.id) > unitOf(b.entry.id) ? 1 : 0) || partOf(a.entry.id) - partOf(b.entry.id))
        .slice(0, limit);
      const chunks: (Chunk & { scoring_details: { vector_score: number; keyword_score: number } })[] = [];
      for (const { entry, score } of ranked) {
        const key = lawKey(entry);
        const object = await law.get(key);
        const text = object ? await object.text() : '';
        if (text) chunks.push({ id: key, type: 'text', score, text, item: { key }, scoring_details: { vector_score: score, keyword_score: 1 } });
      }
      return { search_query: query, chunks } as unknown as AiSearchSearchResponse;
    },
  };
}

/**
 * env with SEARCH swapped for the local scan, or for a spent AI Search, when the mock is on for this request; with the
 * law library on and LAW bound, LAW_SEARCH swapped for the local law scan too. Otherwise env unchanged.
 */
export function withDevSearch(request: Request, env: McpEnv): McpEnv {
  if (env.MCP_SEARCH_MOCK === 'keyword' && isLocal(request)) return { ...env, SEARCH: SPENT_SEARCH as AiSearchInstance };
  if (!devSearchEnabled(request, env)) return env;
  const law = env.LAW_LIBRARY === '1' && env.LAW ? { LAW_SEARCH: devLawSearch(env.LAW) as AiSearchInstance } : {};
  return { ...env, SEARCH: devSearch(env.INDEX) as AiSearchInstance, ...law };
}
