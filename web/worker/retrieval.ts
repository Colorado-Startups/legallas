// SPDX-License-Identifier: Apache-2.0
// Retrieval over the room's index, for Ask, the research agent and the MCP's legallas_search: AI Search, the free
// keyword search (fts.ts) when AI Search's month is spent or it fails, and the filter to live documents a member may
// see. Ask's own pieces (input checks, the daily cap, the model call) stay in ask.ts.
//
// Privacy: the question travels only in the calls to AI Search and D1. It is never logged, never stored in D1 and
// never put in a URL.
import { askAgain, distinctFirst } from './ai-search.ts';
import type { Role } from './env.ts';
import { NOT_HIDDEN_SQL } from './files-catalog.ts';
import { ftsSearch } from './fts.ts';
import { docIdFromKey, type CitableDoc, type FoundPassage, type Passage } from './passages.ts';
import { privilegeFilter } from './privilege.ts';
import { BudgetExhausted, LocalSpendOff } from './spend.ts';

// 20, not 10: in the eval of 2026-10-02 the cited document ranked 11th to 15th for some known questions.
export const MAX_RESULTS = 20;

/**
 * How many passages Ask retrieves. scripts/retrieval-recall.ts measures other plans (more candidates than
 * passages, more passages) through this same retrieve() before a default changes.
 */
export interface RetrievalPlan {
  /** Passages handed to the model. */
  k: number;
  /** Results asked of AI Search (1 to 50); passages beyond k are dropped after the repeats move last. */
  candidates: number;
}

export const RETRIEVAL: RetrievalPlan = { k: MAX_RESULTS, candidates: MAX_RESULTS };

/** Retrieval only: no query rewriting, reranking or similarity cache, so the question is not stored or changed. */
export function searchRequest(question: string, plan: RetrievalPlan = RETRIEVAL): AiSearchSearchRequest {
  return {
    query: question,
    ai_search_options: {
      retrieval: {
        retrieval_type: 'hybrid',
        // "and" needs every word of a question in one chunk, so keyword search matched nothing for natural
        // questions and hybrid ran as vector only. "or" lets BM25 find names, dates and exhibit numbers.
        keyword_match_mode: 'or',
        max_num_results: plan.candidates,
        match_threshold: 0.4,
        // Fail loudly: an outage must not look like "the documents do not say".
        return_on_failure: false,
      },
      query_rewrite: { enabled: false },
      reranking: { enabled: false },
      cache: { enabled: false },
    },
  };
}

export interface Retrieved {
  chunks: Passage[];
  /** Live documents in the retrieved set: the only ids a citation may name. */
  citable: Map<string, CitableDoc>;
  /** Set when the free keyword search answered instead of AI Search. */
  viaKeyword?: true;
  /** Why it did: the month's AI Search queries were spent ('budget'), or AI Search failed ('unavailable'). */
  keywordReason?: KeywordReason;
}

export type KeywordReason = 'budget' | 'unavailable';

/**
 * The free keyword search over D1 that retrieve() falls back to when AI Search refuses (or, with keywordOnOutage,
 * fails): worker/fts.ts ftsSearch (session 13). Its passages carry the index's page markers.
 */
export type KeywordSearch = (db: D1Database, query: string, role: Role, limit: number) => Promise<readonly FoundPassage[]>;

/**
 * retrieve()'s fallback by default: the D1 FTS5 page index (migration 0009), which Workers Paid includes. Called with
 * no options, ftsSearch leaves visuals out before its LIMIT, so they never take a passage's place.
 */
export const KEYWORD_FALLBACK: KeywordSearch | null = ftsSearch;

/** The same index with visuals kept, for callers that include them (the MCP, and Ask once ASK_VISUALS is "1"). */
export const KEYWORD_FALLBACK_WITH_VISUALS: KeywordSearch = (db, query, role, limit) => ftsSearch(db, query, role, limit, { withoutVisuals: false });

/**
 * True when the keyword fallback can answer: there is one, and the D1 index has rows (scripts/fts-index.ts has run;
 * the same check ftsSearch makes before FtsNotBuilt). One cheap read. A missing table (migration 0009 not applied) or
 * any other error reads as false, logged by name, so the caller refuses as it did before the fallback existed.
 */
export async function keywordFallbackReady(db: D1Database): Promise<boolean> {
  if (!KEYWORD_FALLBACK) return false;
  try {
    return (await db.prepare('SELECT 1 AS one FROM page_fts_docs LIMIT 1').first()) !== null;
  } catch (error) {
    console.error('keyword_index_unreadable', error instanceof Error ? error.name : typeof error);
    return false;
  }
}

/** The keyword fallback for a caller that does or does not include visuals; null while there is no fallback at all. */
export function keywordFallbackFor(includeVisuals: boolean): KeywordSearch | null {
  if (!KEYWORD_FALLBACK) return null;
  return includeVisuals ? KEYWORD_FALLBACK_WITH_VISUALS : KEYWORD_FALLBACK;
}

export interface RetrieveOptions {
  /** Keep documents of kind 'visual' (their AI text, plan D8). Quick Ask: ask.ts askVisuals(env); the MCP: always. */
  includeVisuals?: boolean;
  /** Replaces KEYWORD_FALLBACK (keywordFallbackFor, tests and scripts); null turns the fallback off. */
  keywordFallback?: KeywordSearch | null;
  /**
   * Fall back on any AI Search failure too, not only a spent month (Ask and the MCP). Off by default, so scripts and
   * evals that measure AI Search never score keyword answers in its place.
   */
  keywordOnOutage?: boolean;
}

/**
 * Live documents among `ids` that a member with `role` may see, read with bound parameters. Room data files (R6) are
 * never citable, and for a role without viewPrivileged nothing under a privileged folder is (privilege.ts). The folder
 * rides along for the source kind (source-kind.ts), which keeps a party's filing or a letter from standing behind a
 * Fact. With `withoutVisuals`, documents of kind 'visual' are left out too.
 */
export async function liveDocuments(
  db: D1Database,
  ids: readonly string[],
  role: Role,
  options: { withoutVisuals?: boolean } = {},
): Promise<Map<string, CitableDoc>> {
  const live = new Map<string, CitableDoc>();
  if (ids.length === 0) return live;
  const marks = ids.map((_, i) => `?${i + 1}`).join(', ');
  const kinds = options.withoutVisuals ? " AND kind <> 'visual'" : '';
  const visible = `removed_at IS NULL AND ${NOT_HIDDEN_SQL}${privilegeFilter(role)}${kinds}`;
  const { results } = await db
    .prepare(`SELECT id, name, pages, control_seq, folder FROM documents WHERE ${visible} AND id IN (${marks})`)
    .bind(...ids)
    .all<CitableDoc>();
  for (const row of results) {
    live.set(row.id, { id: row.id, name: row.name, pages: row.pages ?? null, control_seq: row.control_seq ?? null, folder: row.folder ?? null });
  }
  return live;
}

/** The index's passages for `question`, with their document ids from the part keys. */
async function indexPassages(search: Pick<AiSearchInstance, 'search'>, question: string, plan: RetrievalPlan): Promise<FoundPassage[]> {
  const request = searchRequest(question, plan);
  let result = await search.search(request);
  // Asked once more when empty (it would read as "the documents do not say") or answered from the keyword
  // side alone (BM25 alone buries the document that answers); ai-search.ts askAgain. The second answer stands.
  if (askAgain(request, result)) result = await search.search(request);
  return (result.chunks ?? [])
    .map((chunk) => ({ docId: docIdFromKey(chunk.item?.key ?? ''), text: typeof chunk.text === 'string' ? chunk.text : '' }))
    .filter((chunk): chunk is FoundPassage => chunk.docId !== null && chunk.text.trim() !== '');
}

/**
 * Searches the index, then keeps only chunks from documents that are live in D1 right now and that a member with
 * `role` may see. Index text can lag a removal (sync deletes it, AI Search re-indexes later), so D1 is the authority
 * on what may be quoted; the index holds privileged folders too, so the same privilegeFilter applies to it.
 * Visuals are left out unless `options.includeVisuals`. When AI Search refuses because the month's queries are spent
 * (BudgetExhausted), or with `keywordOnOutage` fails in any other way, the free keyword search answers instead,
 * through the same filter. The original error stands when there is no fallback, when the fallback fails (an unbuilt
 * index, fts.ts FtsNotBuilt), on localhost's refusal (LocalSpendOff), and when an outage leaves keyword search with
 * nothing to show: an outage must never read as "the documents do not say". Passages that repeat an earlier passage's
 * text come last (ai-search.ts distinctFirst).
 */
export async function retrieve(
  search: Pick<AiSearchInstance, 'search'>,
  db: D1Database,
  question: string,
  role: Role,
  plan: RetrievalPlan = RETRIEVAL,
  options: RetrieveOptions = {},
): Promise<Retrieved> {
  const fallback = options.keywordFallback === undefined ? KEYWORD_FALLBACK : options.keywordFallback;
  const withoutVisuals = !options.includeVisuals;
  let found: FoundPassage[];
  let reason: KeywordReason | null = null;
  let failure: unknown = null;
  try {
    found = await indexPassages(search, question, plan);
  } catch (error) {
    const spent = error instanceof BudgetExhausted;
    if (!fallback || error instanceof LocalSpendOff || (!spent && !options.keywordOnOutage)) throw error;
    failure = error;
    reason = spent ? 'budget' : 'unavailable';
    // Once per fallback, for Ask, the MCP and the research agent alike: the reason word and the error's name, never
    // the question. A misconfigured binding shows up here rather than quietly answering by keyword.
    console.error('search_keyword_fallback', reason, error instanceof Error ? error.name : typeof error);
    found = await keywordPassages(fallback, db, question, role, plan.candidates).catch((fallbackError: unknown) => {
      console.error('keyword_fallback_failed', fallbackError instanceof Error ? fallbackError.name : typeof fallbackError);
      throw error;
    });
  }
  const citable = await liveDocuments(db, [...new Set(found.map((chunk) => chunk.docId))], role, { withoutVisuals });
  const chunks = distinctFirst(
    found
      .filter((chunk) => citable.has(chunk.docId))
      .map((chunk) => ({ docId: chunk.docId, name: citable.get(chunk.docId)!.name, text: chunk.text })), // safe: filtered on has()
  ).slice(0, plan.k);
  // A document whose chunks were all dropped is not citable either.
  for (const id of [...citable.keys()]) if (!chunks.some((chunk) => chunk.docId === id)) citable.delete(id);
  if (reason === null) return { chunks, citable };
  if (reason === 'unavailable' && chunks.length === 0) throw failure;
  return { chunks, citable, viaKeyword: true, keywordReason: reason };
}

/** The fallback's passages with a document id and some text; anything else is dropped. */
async function keywordPassages(fallback: KeywordSearch, db: D1Database, question: string, role: Role, limit: number): Promise<FoundPassage[]> {
  const passages = await fallback(db, question, role, limit);
  return passages.filter((passage) => typeof passage.docId === 'string' && typeof passage.text === 'string' && passage.text.trim() !== '');
}
