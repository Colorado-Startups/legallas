// SPDX-License-Identifier: Apache-2.0
// Free keyword search over every page of document text: D1 FTS5 (migration 0009), filled by scripts/fts-index.ts from
// the index parts AI Search reads. retrieval.ts retrieve() falls back to it when the AI Search monthly allowance is spent
// (spend.ts BudgetExhausted), and for quick Ask and legallas_search also when AI Search fails (keywordOnOutage).
// ftsSearch is a KeywordSearch, the seam's type, called with no options: visuals stay out. Callers that include visuals
// (the MCP; Ask once ASK_VISUALS is "1") get retrieval.ts KEYWORD_FALLBACK_WITH_VISUALS, which passes { withoutVisuals: false }.
// retrieve() then applies its own live-document and visuals filter (plan D8) and orders repeats last, as for AI Search
// passages. A search costs D1 rows read only, which Workers Paid includes, so it has no meter and no monthly limit.
//
// The query never reaches MATCH as typed. queryTerms() keeps word characters only and matchExpression() rebuilds an
// FTS5 expression of double-quoted strings joined by OR, so operators (AND, NOT, NEAR), column filters, prefix stars,
// carets and parentheses in the input end up as plain words or are dropped. Results keep the room's rules on their
// own too: live documents (removed_at IS NULL), never room data files (NOT_HIDDEN_SQL), privilegeFilter for the role,
// and visuals left out unless asked for, in the SQL before LIMIT so they never take a passage's place.
//
// Privacy: the query and page text are never logged, stored or put in a URL; this file logs nothing.
import type { Role } from './env.ts';
import { NOT_HIDDEN_SQL } from './files-catalog.ts';
import { DOC_ID, type FoundPassage } from './passages.ts';
import { privilegeFilter } from './privilege.ts';
import { BudgetExhausted } from './spend.ts';

/** Characters of the query read, like Ask's MAX_QUESTION_CHARS and the MCP's MAX_QUERY_CHARS. */
export const MAX_FTS_QUERY_CHARS = 2000;
/** Terms and phrases in one MATCH expression; more only widen an OR that already ranks by the rarest words. */
export const MAX_TERMS = 24;
/** Words kept from one phrase (its leading words, which still have to be adjacent). */
export const MAX_PHRASE_WORDS = 12;
/** A longer run of letters is not a word anyone types; it is dropped. */
const MAX_WORD_CHARS = 64;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
/** Passage length when the caller does not say: about one AI Search chunk, so Ask's prompt stays its usual size. */
export const DEFAULT_WINDOW_CHARS = 1500;
/** The longest passage: with its marker it stays under mcp/tools/search.ts MAX_PASSAGE_CHARS (3,000). */
export const MAX_WINDOW_CHARS = 2800;
/** Context kept before the first hit of a window. */
const LEAD_CHARS = 200;

/** Word characters as FTS5's unicode61 tokenizer reads them: letters, numbers, marks and private-use characters. */
const WORD = /[\p{L}\p{N}\p{M}\p{Co}]+/gu;
/** Typographic double quotes: left, right, low-9 and reversed-9 (U+201C to U+201F). */
const CURLY_QUOTES = /[\u201C-\u201F]/g;

/** Words that weigh nothing alone. They stay inside a phrase, and stay when a query has nothing else. */
const STOPWORDS = new Set(
  (
    'a about after all also an and any are as at be been before but by can could did do does for from had has have he her ' +
    'his how i if in into is it its may me my no not of on or our she should so than that the their them then there these ' +
    'they this to was we were what when where which who whom why will with would you your'
  ).split(' '),
);

export interface FtsOptions {
  /**
   * Leave out kind 'visual' documents, in the SQL before LIMIT. Default true, as retrieve() leaves them out unless
   * includeVisuals (plan D8): the MCP passes false.
   */
  withoutVisuals?: boolean;
  /** Passage characters around the hits, 200 to MAX_WINDOW_CHARS. Default DEFAULT_WINDOW_CHARS. */
  windowChars?: number;
}

/** A passage as retrieve()'s fallback takes it (text led by its [[doc:<id> p:<n>]] marker), plus its source and score. */
export interface FtsChunk extends FoundPassage {
  name: string;
  page: number;
  /** -bm25: higher is better. */
  score: number;
}

/**
 * ftsSearch's signature: retrieval.ts KeywordSearch plus FtsOptions. retrieve() makes the plain KeywordSearch call (no
 * options), which leaves visuals out; retrieval.ts KEYWORD_FALLBACK_WITH_VISUALS passes { withoutVisuals: false }.
 */
export type FtsSearch = (db: D1Database, query: string, role: Role, limit: number, options?: FtsOptions) => Promise<FtsChunk[]>;

/**
 * The keyword index has no rows yet (the indexer has not run), so it cannot stand in for AI Search: not the same
 * answer as "nothing matched". It is the semantic meter's BudgetExhausted, so through retrieve() the member gets the
 * refusal they would have had with no fallback (routes/ask.ts budgetRefusal, the MCP's search_budget).
 */
export class FtsNotBuilt extends BudgetExhausted {
  override name = 'FtsNotBuilt';
  constructor() {
    super('search_semantic');
  }
}

function wordsOf(text: string): string[] | null {
  const words = text.match(WORD) ?? [];
  return words.some((word) => word.length > MAX_WORD_CHARS) ? null : words;
}

/**
 * The terms of a query, each a list of words that must appear together: one word, a "quoted phrase" (its words in
 * order), or a word FTS5 splits (plaintiff's, DOE-000012, 1,000) kept as the phrase it is in the text. Curly double
 * quotes (as word processors and phones type them) quote a phrase too. Stopwords alone are dropped unless nothing else
 * is left; duplicates go; at most MAX_TERMS.
 */
export function queryTerms(query: string): string[][] {
  const text = [...query.normalize('NFC').replace(CURLY_QUOTES, '"')].slice(0, MAX_FTS_QUERY_CHARS).join('');
  const terms: { words: string[]; quoted: boolean }[] = [];
  const unquoted = text.replace(/"([^"]*)"/g, (_, inner: string) => {
    terms.push({ words: wordsOf(inner)?.slice(0, MAX_PHRASE_WORDS) ?? [], quoted: true });
    return ' ';
  });
  for (const chunk of unquoted.split(/\s+/)) terms.push({ words: wordsOf(chunk)?.slice(0, MAX_PHRASE_WORDS) ?? [], quoted: false });
  const usable = terms.filter((term) => term.words.length > 0);
  const weighty = usable.filter((term) => term.quoted || term.words.length > 1 || !STOPWORDS.has(term.words[0]!.toLowerCase()));
  const seen = new Set<string>();
  const kept: string[][] = [];
  for (const term of weighty.length > 0 ? weighty : usable) {
    const key = term.words.join(' ').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(term.words);
  }
  return kept.slice(0, MAX_TERMS);
}

/** The FTS5 expression for `terms`: each a double-quoted string, joined by OR. Null when there is nothing to match. */
export function matchExpression(terms: readonly (readonly string[])[]): string | null {
  if (terms.length === 0) return null;
  return terms.map((words) => `"${words.join(' ').replaceAll('"', '""')}"`).join(' OR ');
}

const HIT_OPEN = '\u0002';

/** highlight()'s output split back into the page text and the offsets where hits start. */
export function hitOffsets(marked: string): { text: string; hits: number[] } {
  let text = '';
  const hits: number[] = [];
  let last = 0;
  for (const match of marked.matchAll(/[\u0002\u0003]/g)) {
    text += marked.slice(last, match.index);
    if (match[0] === HIT_OPEN) hits.push(text.length);
    last = match.index + 1;
  }
  return { text: text + marked.slice(last), hits };
}

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * At most `max` characters of `text` around its hits: the window that holds the most hits, opening LEAD_CHARS before
 * the first of them, moved to whole words, with "..." where it cuts the page.
 */
export function passageWindow(text: string, hits: readonly number[], max: number): string {
  if (text.length <= max) return text.trim();
  let best = hits[0] ?? 0;
  let most = 0;
  for (let i = 0, j = 0; i < hits.length; i += 1) {
    while (j < hits.length && hits[j]! < hits[i]! - LEAD_CHARS + max) j += 1;
    if (j - i > most) {
      most = j - i;
      best = hits[i]!;
    }
  }
  let start = Math.max(0, Math.min(best - LEAD_CHARS, text.length - max));
  let end = start + max;
  if (start > 0) {
    const space = text.slice(start, start + 80).search(/\s/);
    if (space >= 0) start += space + 1;
    else if (isLowSurrogate(text.charCodeAt(start))) start += 1;
  }
  if (end < text.length) {
    const space = text.slice(end - 80, end).search(/\s\S*$/);
    if (space >= 0) end = end - 80 + space;
    else if (isLowSurrogate(text.charCodeAt(end))) end -= 1;
  }
  return `${start > 0 ? '... ' : ''}${text.slice(start, end).trim()}${end < text.length ? ' ...' : ''}`;
}

interface Row {
  doc_id: string;
  page: number;
  rank: number;
  marked: string;
  name: string;
}

/**
 * The search. CROSS JOIN keeps page_fts the outer loop (SQLite never reorders it), so the MATCH runs once and each hit
 * looks up its document by primary key; FTS5 then sorts by its own bm25 (ORDER BY rank) and highlight() runs only for
 * the rows returned.
 */
function searchSql(role: Role, withoutVisuals: boolean): string {
  return (
    'SELECT page_fts.doc_id AS doc_id, page_fts.page AS page, page_fts.rank AS rank, ' +
    'highlight(page_fts, 0, char(2), char(3)) AS marked, d.name AS name ' +
    'FROM page_fts CROSS JOIN documents AS d ON d.id = page_fts.doc_id ' +
    `WHERE page_fts MATCH ?1 AND d.removed_at IS NULL AND ${NOT_HIDDEN_SQL}${privilegeFilter(role, 'd.path')}` +
    (withoutVisuals ? " AND d.kind <> 'visual'" : '') +
    ' ORDER BY rank LIMIT ?2'
  );
}

function clampInt(value: number | undefined, low: number, high: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, Math.trunc(value!))) : fallback;
}

/**
 * Keyword search over every page the role may see, best first by bm25: passages led by their page's
 * [[doc:<id> p:<n>]] marker, as AI Search passages are. A KeywordSearch (ask.ts), so retrieve() can fall back to it.
 * Throws FtsNotBuilt when nothing matched because the index is empty.
 */
export async function ftsSearch(db: D1Database, query: string, role: Role, limit = DEFAULT_LIMIT, options: FtsOptions = {}): Promise<FtsChunk[]> {
  const expression = matchExpression(queryTerms(query));
  if (expression === null) return [];
  const window = clampInt(options.windowChars, 200, MAX_WINDOW_CHARS, DEFAULT_WINDOW_CHARS);
  const { results } = await db
    .prepare(searchSql(role, options.withoutVisuals !== false))
    .bind(expression, clampInt(limit, 1, MAX_LIMIT, DEFAULT_LIMIT))
    .all<Row>();
  const chunks: FtsChunk[] = [];
  for (const row of results) {
    const page = Number(row.page);
    // The marker must parse as one (citations.ts INDEX_MARKER), so a row that could not is left out.
    if (!DOC_ID.test(row.doc_id) || !Number.isInteger(page) || page < 1) continue;
    const { text, hits } = hitOffsets(row.marked);
    const passage = passageWindow(text, hits, window);
    if (passage) chunks.push({ docId: row.doc_id, name: row.name, page, score: -row.rank, text: `[[doc:${row.doc_id} p:${page}]]\n${passage}` });
  }
  if (results.length === 0 && (await db.prepare('SELECT 1 AS one FROM page_fts_docs LIMIT 1').first()) === null) throw new FtsNotBuilt();
  return chunks;
}
