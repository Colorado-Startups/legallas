// SPDX-License-Identifier: Apache-2.0
// legallas_search: hybrid search over the room's AI Search index (owner: session B1). Retrieval is the room's own
// (worker/retrieval.ts retrieve: live, non-hidden documents the caller's role may see, worker/privilege.ts; D1 being the
// authority over a lagging index; asked once more when a hybrid search comes back from its keyword side alone;
// passages that repeat an earlier passage's text last, worker/ai-search.ts); this file adds each document's control
// number and folder and turns index markers into readable cites. Passages past the result's size limit (the
// response profile's, session 2b) come with a cursor; a call with it searches again and continues from there. When AI
// Search's month is spent or it fails, the free keyword search answers, and the result carries fallback: "keyword".
// A passage that addresses an AI, or reads as a court order outside the court's record, comes back fenced as untrusted,
// without its control number, page or link, under Ask's reminder (mcp/untrusted.ts, worker/quarantine.ts).
//
// Privacy: the query goes to AI Search, or to the room's own keyword index in D1. It is never logged, audited or
// echoed back; a cursor carries only a short hash of it, so the cursor is refused with another query.
import { z } from 'zod';
import { canPerform } from '../../worker/auth.ts';
import { keywordFallbackFor, RETRIEVAL, retrieve, type KeywordReason, type Retrieved } from '../../worker/retrieval.ts';
import type { Role } from '../../worker/env.ts';
import { displayFolder, NOT_HIDDEN_SQL } from '../../worker/files-catalog.ts';
import { pageIsKnown } from '../../worker/page-known.ts';
import { privilegeFilter } from '../../worker/privilege.ts';
import { MAX_QUERY_CHARS, MAX_SEARCH_RESULTS, type ToolContext, type ToolDefinition } from '../contract.ts';
import { caseData, caseField, decodeCursor, docLink, encodeCursor, fitItems, formatControl, jsonResult, retrievedOn, toolError } from '../format.ts';
import { markUntrusted, noted, untrustedIn, untrustedReason, type Untrusted } from '../untrusted.ts';
import { SEARCH_OUTPUT } from './output.ts';

const inputSchema = z.object({
  query: z.string().trim().min(1).max(MAX_QUERY_CHARS).describe('Words or a question to find in the case documents.'),
  limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).default(10).describe(`Passages to return, at most ${MAX_SEARCH_RESULTS}.`),
  cursor: z.string().max(64).optional().describe('next_cursor from a previous result, with the same query and limit, for the passages that did not fit.'),
});

/** A passage longer than this is cut. */
export const MAX_PASSAGE_CHARS = 3000;
/** A compact result's passages are cut shorter, so several fit in its budget; legallas_read_pages has the rest. */
export const COMPACT_PASSAGE_CHARS = 1500;
/**
 * Passage characters per call. Every result is sent twice (text and structured content), so this keeps a call
 * near 60 KB, far under Microsoft's 500 KB.
 */
export const MAX_TOTAL_CHARS = 30_000;

/**
 * Page markers exactly as scripts/indexparts.ts writes them (worker/citations.ts INDEX_MARKER). Only this form:
 * the indexer breaks up "[[" in document text, so a marker is never document content, while looser forms (the
 * fullwidth brackets a model writes in answers) could be typed into a document to forge a cite.
 */
const MARKER = /\[\[doc:([A-Za-z0-9_-]{1,64}) p:([0-9]{1,6})\]\]/g;

/** The catalog facts a passage shows. Never r2_key, sha256 or etag. */
interface DocFacts {
  id: string;
  folder: string;
  source: string;
  control_seq: number | null;
}

/** One passage as the tool returns it. An untrusted one has no control, page or link (mcp/untrusted.ts markUntrusted). */
export interface Passage {
  id: string;
  control?: string | null;
  title: string;
  folder: string;
  page?: number | null;
  link?: string;
  text: string;
  untrusted?: Untrusted;
}

/** The page of the marker for `docId` nearest the start of `text`, or null when the passage carries none. */
export function passagePage(text: string, docId: string): number | null {
  for (const match of text.matchAll(MARKER)) {
    const page = Number(match[2]);
    if (match[1] === docId && Number.isInteger(page) && page > 0) return page;
  }
  return null;
}

/**
 * The passage's own markers rewritten as "[DOE-000012 p. 4]", or "[doc:<id> p. 4]" before the document is
 * numbered, with no page when its page isn't known. A chunk only ever carries markers for its own document; any other
 * is left as it stands.
 */
export function readableCites(text: string, docId: string, control: string | null, known = true): string {
  return text.replace(MARKER, (whole, id: string, page: string) => (id === docId ? `[${control ?? `doc:${id}`}${known ? ` p. ${Number(page)}` : ''}]` : whole));
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()} [passage cut]` : trimmed;
}

/** A short fingerprint of the query (32-bit FNV-1a), so a cursor only continues the search it came from. */
export function queryTag(query: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < query.length; i += 1) hash = Math.imul(hash ^ query.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

/** A search cursor: where the next passage stands among the query's results, and the query's tag. */
export function searchCursor(next: number, query: string): string {
  return encodeCursor([next, queryTag(query)]);
}

/** The position a cursor continues from, or null when it is malformed or came with another query. */
export function cursorOffset(cursor: string, query: string): number | null {
  const parts = decodeCursor(cursor);
  if (parts?.length !== 2) return null;
  const [next, tag] = parts;
  return typeof next === 'number' && Number.isInteger(next) && next >= 0 && next < MAX_SEARCH_RESULTS && tag === queryTag(query) ? next : null;
}

/** Folder, source and control number for live documents among `ids`, with the same filters as retrieval. */
async function docFacts(db: D1Database, ids: readonly string[], role: Role): Promise<Map<string, DocFacts>> {
  if (ids.length === 0) return new Map();
  const marks = ids.map((_, i) => `?${i + 1}`).join(', ');
  const visible = `removed_at IS NULL AND ${NOT_HIDDEN_SQL}${privilegeFilter(role)}`;
  const { results } = await db
    .prepare(`SELECT id, folder, source, control_seq FROM documents WHERE ${visible} AND id IN (${marks})`)
    .bind(...ids)
    .all<DocFacts>();
  return new Map(results.map((row) => [row.id, row]));
}

const NOTHING_MATCHED =
  'Nothing in the case documents matched. Try other words: a name, a date, a document type or a phrase likely to appear in the text.';

const NO_MORE = 'No more passages for this query. Search again without a cursor to start over.';

const KEYWORD_TIP = 'Use words likely to appear in the documents: names, dates, terms.';

/** Why a result came from keyword search alone, in words for counsel's AI. */
export const KEYWORD_NOTES: Readonly<Record<KeywordReason, string>> = {
  budget: `This month's semantic search allowance is used, so these passages come from keyword search alone. ${KEYWORD_TIP}`,
  unavailable: `The room's semantic search is unavailable right now, so these passages come from keyword search alone. ${KEYWORD_TIP}`,
};

/**
 * The passages for a query, and why keyword search answered it, if it did. Counsel's AIs always get the visuals too
 * (their AI text, plan D8), which Ask leaves out until ASK_VISUALS is "1". When the month's AI Search allowance is
 * used or AI Search fails, retrieve() answers from the free keyword search (worker/retrieval.ts KEYWORD_FALLBACK,
 * worker/fts.ts) and says why; when that cannot answer either, the error reaches runTool, which answers search_budget
 * or internal_error.
 */
async function passagesFor(ctx: ToolContext, query: string): Promise<{ chunks: Retrieved['chunks']; keyword: KeywordReason | null }> {
  const found = await retrieve(ctx.env.SEARCH, ctx.env.DB, query, ctx.member.role, RETRIEVAL, {
    includeVisuals: true,
    keywordFallback: keywordFallbackFor(true),
    keywordOnOutage: true,
  });
  return { chunks: found.chunks, keyword: found.keywordReason ?? null };
}

/** A passage with where it stands among the query's results (so a cursor can name the next one) and its text length. */
interface Placed {
  at: number;
  chars: number;
  passage: Passage;
}

/**
 * Passages for `chunks` from `start` on, cut to `maxChars`, with control numbers and folders. Each is judged whole, with
 * its document's name and folder, as Ask judges it (worker/ask-turn.ts): an untrusted one loses its cite fields.
 */
async function placePassages(ctx: ToolContext, chunks: Retrieved['chunks'], start: number, maxChars: number): Promise<Placed[]> {
  const rest = chunks.slice(start);
  const facts = await docFacts(ctx.env.DB, [...new Set(rest.map((chunk) => chunk.docId))], ctx.member.role);
  const placed: Placed[] = [];
  rest.forEach((chunk, i) => {
    const row = facts.get(chunk.docId);
    // Removed between the two reads: drop it rather than cite a document the room no longer shows.
    if (!row) return;
    const control = formatControl(ctx.env.CONTROL_PREFIX, row.control_seq);
    const known = pageIsKnown(chunk.name);
    const reason = untrustedReason(chunk.text, { name: chunk.name, folder: row.folder });
    // An untrusted passage's own page tags go too, as in Ask: nothing in it reads as a cite.
    const body = clip(reason ? chunk.text.replace(MARKER, '') : readableCites(chunk.text, chunk.docId, control, known), maxChars);
    const page = known ? passagePage(chunk.text, chunk.docId) : null;
    const passage = markUntrusted<Passage>({ id: chunk.docId, control, title: caseField(chunk.name), folder: caseField(displayFolder(row)), page, link: docLink(chunk.docId, page), text: caseData(body, reason) });
    placed.push({ at: start + i, chars: body.length, passage });
  });
  return placed;
}

/** The legallas_search tool, which searches case documents. */
export const searchTool: ToolDefinition<typeof inputSchema> = {
  name: 'legallas_search',
  title: 'Search case documents',
  description:
    'Search every document in the counsel room by meaning and keywords. Returns passages with the document id, ' +
    'control number, title, folder, page and a link to that page in the room. When more passages matched than ' +
    'fit, pass next_cursor with the same query and limit for the rest (each call searches again). To read whole ' +
    'pages, use legallas_read_pages with an id from these results.',
  inputSchema,
  outputSchema: SEARCH_OUTPUT,
  async handler({ query, limit, cursor }, ctx) {
    if (!canPerform(ctx.member.role, 'view')) return toolError('forbidden', 'This member cannot search the counsel room.');
    const start = cursor === undefined ? 0 : cursorOffset(cursor, query);
    if (start === null) return toolError('bad_cursor', 'Pass next_cursor with the query it came with, or search again without a cursor.');
    await ctx.audit('ai_search', null);
    const { chunks, keyword } = await passagesFor(ctx, query);
    // A keyword answer says so in a structured field, so counsel's AI knows why passages may miss a paraphrase.
    const how = keyword ? { fallback: 'keyword' as const, note: KEYWORD_NOTES[keyword] } : {};
    const retrieved = retrievedOn(ctx.now);
    const maxPassage = ctx.profile === 'compact' ? COMPACT_PASSAGE_CHARS : MAX_PASSAGE_CHARS;
    const placed = await placePassages(ctx, chunks.slice(0, limit), start, maxPassage);
    if (placed.length === 0) return jsonResult({ retrieved, results: [], ...how, message: start === 0 ? NOTHING_MATCHED : NO_MORE });
    // Sized with the note any of these passages would bring, so a noted result still fits.
    const marks = untrustedIn(placed.map((item) => item.passage));
    const envelope = noted({ retrieved, results: [], ...how, truncated: true, next_cursor: searchCursor(MAX_SEARCH_RESULTS - 1, query) }, marks);
    // Standard keeps today's cap, MAX_TOTAL_CHARS of passage text; compact counts the result's whole text.
    const fit = fitItems(ctx.profile, placed, { maxItems: limit, maxChars: MAX_TOTAL_CHARS }, envelope, { own: (item) => item.chars, shown: (item) => item.passage });
    const results = fit.items.map((item) => item.passage);
    // Passages carry case text out of the room too, so each document they came from gets an ai_read row
    // (deduped like page reads), and the activity log shows which documents went to the member's AI app.
    for (const id of new Set(results.map((passage) => passage.id))) await ctx.audit('ai_read', id);
    if (fit.next === null) return jsonResult(noted({ retrieved, results, ...how }));
    // The description says what next_cursor is for, so the result carries the cursor and no sentence about it.
    return jsonResult(noted({ retrieved, results, ...how, truncated: true, next_cursor: searchCursor(placed[fit.next].at, query) }));
  },
};
