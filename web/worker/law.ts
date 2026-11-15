// SPDX-License-Identifier: Apache-2.0
// The law library in the Worker (T21): retrieval from the `legallas-law` AI Search instance, kept apart from
// the record's index, with the catalog (catalog.json in R2 legallas-law) as the authority on what may be cited,
// the way D1 is for the record. Shared by Ask (routes/ask.ts) and legallas_search_law (mcp/tools/search-law.ts).
//
// Off unless LAW_LIBRARY is "1" and both bindings exist, so the room behaves exactly as before until the
// owner creates the bucket and instance and turns it on (web/README.md "The law library").
//
// Privacy: the question goes to AI Search only, like the record search. Law results are public law, so every
// member who may ask may read them.
import { askAgain, distinctFirst } from './ai-search.ts';
import { citedLaw, isLawId, isOfficialLink, lawFromKey, LAW_OPINIONS, LAW_TRACKS, unitOf, type LawChunk, type LawTrack } from './law-cite.ts';

export { isOfficialLink, LAW_LINK_HOSTS } from './law-cite.ts';

/** Passages Ask adds beside the record's 20. */
export const LAW_RESULTS = 8;
/**
 * Ask sends law only when the best law passage's vector similarity to the question reaches this; then every
 * catalog passage the search returned goes along. Calibrated on the local replica (same embedding model,
 * 2026-10-03): every record eval question's best law passage scored at most 0.51, every law eval question's at
 * least 0.565 (rechecked 2026-10-04 with 2,047 parts: record at most 0.574, 2 of 22 at or above; law at least
 * 0.565), while a relevant statute can sit at 0.53 under a better-scoring opinion, so the floor applies to the
 * question, not to each passage. Recheck against the legallas-law instance once it exists.
 */
export const ASK_LAW_MIN_VECTOR = 0.55;
/** At most this many from the index before track filtering, so a filtered search still fills its limit. */
const LAW_FETCH = 24;
const MAX_LAW_CITATIONS = 30;

/** The bindings and flag the law library needs. All optional: absent means off. */
export interface LawBindings {
  LAW_LIBRARY?: string;
  /** R2 legallas-law: catalog.json (and the parts AI Search reads). */
  LAW?: R2Bucket;
  /** AI Search instance legallas-law over legallas-law law/. */
  LAW_SEARCH?: AiSearchInstance;
}

export function lawEnabled(env: LawBindings): env is LawBindings & { LAW: R2Bucket; LAW_SEARCH: AiSearchInstance } {
  return env.LAW_LIBRARY === '1' && env.LAW !== undefined && env.LAW_SEARCH !== undefined;
}

/** Retrieval only, the same settings as the record search (worker/retrieval.ts searchRequest). */
export function lawSearchRequest(question: string): AiSearchSearchRequest {
  return {
    query: question,
    ai_search_options: {
      retrieval: { retrieval_type: 'hybrid', keyword_match_mode: 'or', max_num_results: LAW_FETCH, match_threshold: 0.4, return_on_failure: false },
      query_rewrite: { enabled: false },
      reranking: { enabled: false },
      cache: { enabled: false },
    },
  };
}

const TRACKS = new Set<string>(LAW_TRACKS);
const OPINIONS = new Set<string>(LAW_OPINIONS);

/**
 * A catalog entry with every field the room shows, well formed; anything else is not citable. An opinion part's
 * `opinion` must be one the room knows (a part that says it is from an unknown writing is never shown as law), and
 * its `author` a short name.
 */
export function validEntry(raw: unknown): LawChunk | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const strings = ['id', 'cite', 'title', 'url', 'retrieved', 'track', 'kind', 'source'] as const;
  if (!strings.every((key) => typeof e[key] === 'string' && (e[key] as string).length <= 400)) return null;
  const entry = e as unknown as LawChunk;
  if (!isLawId(entry.id) || !TRACKS.has(entry.track) || !isOfficialLink(entry.url) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.retrieved)) return null;
  if (e.opinion !== undefined && (typeof e.opinion !== 'string' || !OPINIONS.has(e.opinion))) return null;
  if (e.author !== undefined && (typeof e.author !== 'string' || e.author.length > 80)) return null;
  return entry;
}

let cached: { etag: string; catalog: Map<string, LawChunk> } | null = null;

/** Forgets the cached catalog (tests). */
export function resetLawCatalog(): void {
  cached = null;
}

/** The catalog by chunk id, cached by etag per isolate. Null when the bucket has none (nothing is citable). */
export async function lawCatalog(bucket: R2Bucket): Promise<Map<string, LawChunk> | null> {
  const object = await bucket.get('catalog.json', cached ? { onlyIf: { etagDoesNotMatch: cached.etag } } : undefined);
  if (object === null) return (cached = null);
  if (!('body' in object) || !object.body) return cached?.catalog ?? null;
  const parsed = (await object.json().catch(() => null)) as { version?: unknown; chunks?: unknown } | null;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.chunks)) return null;
  const catalog = new Map<string, LawChunk>();
  for (const raw of parsed.chunks) {
    const entry = validEntry(raw);
    if (entry) catalog.set(entry.id, entry);
  }
  cached = { etag: object.etag, catalog };
  return catalog;
}

/** One retrieved law passage: the catalog entry and the indexed text (which opens with the citation line). */
export interface LawPassage extends LawChunk {
  text: string;
}

export interface RetrievedLaw {
  passages: LawPassage[];
  /** Chunks retrieved for this question: the only ids a [law:<id>] citation may name. */
  citable: Map<string, LawChunk>;
}

export interface LawRetrieveOptions {
  limit?: number;
  /** Only these tracks; default all. "both" material counts for either filing. */
  tracks?: readonly LawTrack[];
  /** No law at all unless the best passage's vector score reaches this (results without scores get none). */
  minVector?: number;
}

/**
 * Searches the law index and keeps chunks the catalog knows, on the requested tracks, with the track the catalog
 * gives (never the key's alone: both must agree). Passages repeating an earlier passage's text come last.
 */
export async function retrieveLaw(search: Pick<AiSearchInstance, 'search'>, bucket: R2Bucket, question: string, options: LawRetrieveOptions = {}): Promise<RetrievedLaw> {
  const request = lawSearchRequest(question);
  let result = await search.search(request);
  if (askAgain(request, result)) result = await search.search(request);
  const catalog = await lawCatalog(bucket);
  const empty: RetrievedLaw = { passages: [], citable: new Map() };
  if (!catalog) return empty;
  // Only law parts count, for the gate as for the results: anything else the instance indexed (catalog.json, if a
  // prefix setting ever lapses) can neither open the gate nor be cited.
  const lawChunks = (result.chunks ?? []).filter((chunk) => lawFromKey(chunk.item?.key ?? '') !== null);
  if (options.minVector !== undefined && !relevantEnough(lawChunks, options.minVector)) return empty;
  const tracks = new Set<LawTrack>(options.tracks ?? LAW_TRACKS);
  const found: LawPassage[] = [];
  for (const chunk of lawChunks) {
    const key = lawFromKey(chunk.item?.key ?? '');
    const entry = key ? catalog.get(key.id) : undefined;
    const text = typeof chunk.text === 'string' ? chunk.text.trim() : '';
    if (!key || !entry || entry.track !== key.track || !tracks.has(entry.track) || !text) continue;
    found.push({ ...entry, text });
  }
  const passages = unitsFirst(distinctFirst(found), options.limit ?? LAW_RESULTS);
  return { passages, citable: new Map(passages.map(({ text: _text, ...entry }) => [entry.id, entry])) };
}

/**
 * At most this many parts of one unit (a statute section, an opinion) come before every other unit's parts: one
 * long opinion's parts can otherwise fill the passages and push out the instruction or statute that answers.
 */
export const LAW_PARTS_PER_UNIT = 2;

/** The first `limit` passages, a unit's parts past LAW_PARTS_PER_UNIT moved after all others, rank kept within each. */
export function unitsFirst<T extends { id: string }>(passages: readonly T[], limit: number): T[] {
  const counts = new Map<string, number>();
  const first: T[] = [];
  const more: T[] = [];
  for (const passage of passages) {
    const unit = unitOf(passage.id);
    const n = counts.get(unit) ?? 0;
    counts.set(unit, n + 1);
    (n < LAW_PARTS_PER_UNIT ? first : more).push(passage);
  }
  return [...first, ...more].slice(0, limit);
}

/**
 * True when some chunk's vector score reaches `floor`. Fails closed: results without vector scores (a keyword-only
 * answer) never pass, so a question only gets law when AI Search measured its relevance. The local mock
 * (law-mock.ts) carries scores like the real instance.
 */
export function relevantEnough(chunks: readonly { scoring_details?: { vector_score?: number } }[], floor: number): boolean {
  const scores = chunks.map((chunk) => chunk.scoring_details?.vector_score).filter((v): v is number => typeof v === 'number');
  return scores.length > 0 && Math.max(...scores) >= floor;
}

/** One validated law citation, sent to the browser in the `citations` event's `law` list. */
export type LawCitation = LawChunk;

/** The answer's [law:<id>] citations that name a chunk retrieved for this question. Order of first appearance. */
export function validateLawCitations(answer: string, citable: ReadonlyMap<string, LawChunk>): LawCitation[] {
  const out: LawCitation[] = [];
  const seen = new Set<string>();
  for (const id of citedLaw(answer)) {
    const entry = citable.get(id);
    if (!entry || seen.has(id)) continue;
    seen.add(id);
    out.push(entry);
    if (out.length === MAX_LAW_CITATIONS) break;
  }
  return out;
}
