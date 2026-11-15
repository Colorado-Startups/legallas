// SPDX-License-Identifier: Apache-2.0
// The self-retrieval probe (npm run coverage -- --probe). For each indexed document two queries are built
// locally, its catalog summary and a distinctive 20 to 40 word passage of its own text, and each goes through
// the worker's own retrieve() (worker/retrieval.ts: the hybrid request Ask sends, the second ask when the answer comes
// back empty or keyword-only, the live-document filter and the order Ask reads passages in) against the
// production `legallas` instance over the REST search endpoint. A document that is not among the first TOP
// passages for either query is unfindable. Search only: nothing is written anywhere, and queries and results
// stay in the local audit files.
import type { CoverageRow, ProbeHit, ProbeResult } from './coverage-table.ts';
import { withFreshToken, withRateRetry, type TokenSource } from './law/replica.ts';
import type { Fetch } from './mcp-oauth.ts';
import { mapLimit } from './pool.ts';
import { SpendStop } from './spend-guard.ts';

/** A document counts as found when one of its passages is among the first TOP that Ask reads. */
export const TOP = 10;
/** Probe searches in flight; the pacer holds the request rate. */
export const PROBE_CONCURRENCY = 3;
export const PASSAGE_WORDS = { min: 20, size: 30, max: 40 } as const;
const STEP = 5;
const SEARCH_TIMEOUT_MS = 30_000;
/** Under this many characters a document has too little text to find. */
const BLANK_CHARS = 100;

export interface ProbeTarget {
  id: string;
  summary: string | null;
  passage: string | null;
  /** Ids of documents with the same text or the same file. */
  twins: readonly string[];
  chars: number;
  /** Share of pages read by OCR, 0 to 1. */
  ocrShare: number;
}

/** Lowercase letter-and-digit runs. */
export function terms(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** In how many texts each term appears. */
export function documentFrequency(texts: Iterable<string>): Map<string, number> {
  const df = new Map<string, number>();
  for (const text of texts) for (const term of new Set(terms(text))) df.set(term, (df.get(term) ?? 0) + 1);
  return df;
}

const hasLetter = (term: string) => /\p{L}/u.test(term);

/**
 * The run of PASSAGE_WORDS.size words (the whole text when it has min to max words) whose word terms are rarest
 * across the corpus: the mean inverse document frequency of its terms that contain a letter. A window needs
 * mostly words, not numbers, so a table of figures does not win; very long tokens (links, encoded data) do not
 * count. Null when the text has fewer than PASSAGE_WORDS.min words.
 */
export function distinctivePassage(text: string, df: ReadonlyMap<string, number>, docs: number): string | null {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < PASSAGE_WORDS.min) return null;
  if (words.length <= PASSAGE_WORDS.max) return words.join(' ');
  let best: { score: number; start: number } | null = null;
  for (let start = 0; start + PASSAGE_WORDS.size <= words.length; start += STEP) {
    const window = terms(words.slice(start, start + PASSAGE_WORDS.size).join(' '));
    const scored = window.filter((term) => hasLetter(term) && term.length <= 30);
    if (scored.length < PASSAGE_WORDS.min / 2 || scored.length < window.length * 0.6) continue;
    const score = scored.reduce((sum, term) => sum + Math.log((docs + 1) / ((df.get(term) ?? 0) + 1)), 0) / scored.length;
    if (!best || score > best.score) best = { score, start };
  }
  const start = best?.start ?? 0;
  return words.slice(start, start + PASSAGE_WORDS.size).join(' ');
}

/** Where `id` (and its best twin) first appears in passages in Ask's order, and the first three documents. */
export function rankOf(chunks: readonly { docId: string }[], id: string, twins: readonly string[] = []): Omit<ProbeHit, 'query'> {
  const docs: string[] = [];
  for (const chunk of chunks) if (!docs.includes(chunk.docId)) docs.push(chunk.docId);
  const position = (target: string) => {
    const index = chunks.findIndex((chunk) => chunk.docId === target);
    return index < 0 ? null : index + 1;
  };
  const twinRanks = twins.map(position).filter((rank): rank is number => rank !== null);
  const docIndex = docs.indexOf(id);
  return { rank: position(id), docRank: docIndex < 0 ? null : docIndex + 1, twinRank: twinRanks.length ? Math.min(...twinRanks) : null, top: docs.slice(0, 3) };
}

/**
 * One target per indexed room document (live in D1, indexable, with parts in legallas-index): its catalog summary,
 * its most distinctive passage, and the documents that share its text or its file.
 */
export function probeTargets(rows: readonly CoverageRow[], texts: ReadonlyMap<string, string>, summaries: ReadonlyMap<string, string | null>): ProbeTarget[] {
  const indexed = rows.filter((row) => row.zone === 'room' && row.id && row.indexable === true && row.indexParts > 0);
  const df = documentFrequency(indexed.map((row) => texts.get(row.path) ?? ''));
  const byKey = new Map<string, string[]>();
  for (const row of indexed) {
    for (const key of [row.textGroup ? `t:${row.textGroup}` : null, row.sha256 ? `f:${row.sha256}` : null]) {
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), row.id!]); // safe: filtered on row.id
    }
  }
  return indexed.map((row) => {
    const id = row.id!; // safe: filtered on row.id
    const twins = new Set([...(byKey.get(`t:${row.textGroup}`) ?? []), ...(byKey.get(`f:${row.sha256}`) ?? [])]);
    twins.delete(id);
    const pages = row.text?.pages ?? 0;
    return {
      id,
      summary: summaries.get(row.path) ?? null,
      passage: distinctivePassage(texts.get(row.path) ?? '', df, indexed.length),
      twins: [...twins],
      chars: row.text ? row.text.chars.reduce((sum, n) => sum + n, 0) : 0,
      ocrShare: pages > 0 ? (row.text?.ocrPages ?? 0) / pages : 0,
    };
  });
}

/** Whether a document was found, and when not, one word for why. */
export function classify(target: ProbeTarget, hits: readonly (ProbeHit | null)[]): Pick<ProbeResult, 'unfindable' | 'reason'> {
  const ran = hits.filter((hit): hit is ProbeHit => hit !== null);
  if (ran.some((hit) => hit.rank !== null && hit.rank <= TOP)) return { unfindable: false, reason: null };
  if (ran.length > 0 && ran.every((hit) => hit.error)) return { unfindable: true, reason: 'error' };
  if (target.chars < BLANK_CHARS) return { unfindable: true, reason: 'blank' };
  if (ran.some((hit) => hit.twinRank !== null && hit.twinRank <= TOP)) return { unfindable: true, reason: 'twin' };
  if (ran.some((hit) => hit.rank !== null)) return { unfindable: true, reason: 'buried' };
  if (target.ocrShare > 0.5) return { unfindable: true, reason: 'ocr' };
  return { unfindable: true, reason: 'absent' };
}

export interface ProbeDeps {
  /** Passages for a question in the order Ask reads them (worker/retrieval.ts retrieve). */
  retrieve(question: string): Promise<readonly { docId: string }[]>;
  onProgress?(done: number, total: number): void;
}

/** Error codes only: a search failure message never carries the query. */
function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,60}$/.test(message) ? message : 'search_failed';
}

/** Runs both queries for every target. A failed search is recorded on its hit; the run goes on. */
export async function runProbe(targets: readonly ProbeTarget[], deps: ProbeDeps, concurrency = PROBE_CONCURRENCY): Promise<Map<string, ProbeResult>> {
  const results = new Map<string, ProbeResult>();
  let done = 0;
  const ask = async (target: ProbeTarget, query: string | null): Promise<ProbeHit | null> => {
    if (!query) return null;
    try {
      return { query, ...rankOf(await deps.retrieve(query), target.id, target.twins) };
    } catch (error) {
      // Out of budget ends the probe (scripts/spend-guard.ts); it is not a failed search.
      if (error instanceof SpendStop) throw error;
      return { query, rank: null, docRank: null, twinRank: null, top: [], error: errorCode(error) };
    }
  };
  await mapLimit(targets, concurrency, async (target) => {
    const summary = await ask(target, target.summary);
    const passage = await ask(target, target.passage);
    results.set(target.id, { summary, passage, ...classify(target, [summary, passage]) });
    done += 1;
    deps.onProgress?.(done, targets.length);
  });
  return results;
}

/** Spaces calls `perSecond` apart: each caller waits for the next free slot. */
export function pacer(perSecond: number, now: () => number = Date.now, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))): () => Promise<void> {
  if (!(perSecond > 0)) throw new Error('rate must be positive');
  const gap = 1000 / perSecond;
  let next = 0;
  return async () => {
    const at = Math.max(now(), next);
    next = at + gap;
    const wait = at - now();
    if (wait > 0) await sleep(wait);
  };
}

/**
 * A fetch for mcp-replica.ts restSearch that paces every request (retries included), sets wrangler's current
 * token on each (renewed after a 401) and waits out 429s. Each attempt gets its own timeout.
 */
export function pacedSearchFetch(tokens: TokenSource, wait: () => Promise<void>, fetcher: Fetch = fetch): Fetch {
  return (input, init) =>
    withRateRetry(() =>
      withFreshToken(tokens, async (token) => {
        await wait();
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${token}`);
        return fetcher(input, { ...init, headers, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
      }),
    );
}
