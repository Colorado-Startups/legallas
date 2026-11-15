// SPDX-License-Identifier: Apache-2.0
// legallas_search_law (T21): search the law library, public law kept apart from the case record in its own
// index (worker/law.ts). Registered only while the law library is on (mcp/server.ts), so the five record tools
// and their schemas never change. Results carry the canonical citation, the official source link, the date the
// text was fetched and the track (civil, regulator or both), and say plainly that they are research support. An
// opinion passage also carries its writing (`opinion`, `author`), and `notes` says what each track and writing used
// means, so a dissent is never the holding. One answer's shape and size: mcp/law-answer.ts.
// With `list: true` it pages through what the library holds instead (catalog.json in R2 legallas-law, the
// authority on what may be cited): one row per unit, a statute or rule section, a jury instruction or an opinion.
//
// Privacy: the query goes to AI Search only. It is never logged or echoed back; one ai_search audit row records
// that a search happened, as for legallas_search.
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { canPerform } from '../../worker/auth.ts';
import { lawCatalog, lawEnabled, retrieveLaw } from '../../worker/law.ts';
import { LAW_OPINIONS, LAW_TRACKS, unitOf, type LawChunk, type LawOpinion, type LawTrack } from '../../worker/law-cite.ts';
import { LAW_TOOL_NAME, LIST_PAGE_SIZE, MAX_CHARS_PER_READ, MAX_QUERY_CHARS, type McpEnv, type ResultLimits, type ToolContext, type ToolDefinition } from '../contract.ts';
import { decodeCursor, encodeCursor, fitItems, forProfile, jsonResult, toolError } from '../format.ts';
import { DEFAULT_PASSAGES, lawAnswer, lawData, NOTICE } from '../law-answer.ts';
import { lawLibraryHolds } from '../../worker/room-settings.ts';

export { LAW_TOOL_NAME };
/** The most law passages that one search returns. */
export const MAX_LAW_RESULTS = 12;

/** A result as one copy of minified text, whatever the caller (format.ts forProfile, as a compact caller gets every tool's). */
const once = (result: CallToolResult) => forProfile('compact', result);

const inputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(MAX_QUERY_CHARS)
    .optional()
    .describe('Words or a legal question: a doctrine, an element, a statute or rule number. Leave out with list.'),
  list: z
    .boolean()
    .optional()
    .describe('true lists what the library holds instead of searching: one row per statute or rule section, jury instruction or opinion, with its citation, official link and track.'),
  track: z
    .enum(['civil', 'regulator', 'any'])
    .default('any')
    .describe('civil: authority for a court claim; regulator: authority for a filing with a regulator; any: both. Material that applies to both appears under either.'),
  limit: z.number().int().min(1).max(MAX_LAW_RESULTS).default(DEFAULT_PASSAGES).describe(`Passages to return, at most ${MAX_LAW_RESULTS}.`),
  // A list cursor carries a unit id of up to 96 characters, base64url-encoded.
  cursor: z.string().max(160).optional().describe('next_cursor from a previous result, with the same other arguments, to continue it.'),
});

type LawArgs = z.infer<typeof inputSchema>;

/** The tracks a request covers: "both" material counts for either filing. */
export function tracksFor(track: 'civil' | 'regulator' | 'any'): LawTrack[] {
  return track === 'any' ? [...LAW_TRACKS] : [track, 'both'];
}

export { lawData, NOTICE };
const NOTHING_MATCHED = 'Nothing in the law library matched. Try a doctrine name, an element, or a statute or rule number.';

/**
 * Searches the library. The answer is the one shape of mcp/law-answer.ts: every passage asked for, each cut to its share
 * of one answer, once as text. Search results are not paged: `limit` fewer passages gives each more room.
 */
async function searchLaw(env: McpEnv & { LAW: R2Bucket; LAW_SEARCH: AiSearchInstance }, query: string, args: LawArgs, ctx: ToolContext) {
  if (args.cursor !== undefined) return toolError('bad_cursor', 'A search has no pages. Ask for fewer passages with limit to read more of each, or search again.');
  await ctx.audit('ai_search', null);
  const { passages } = await retrieveLaw(env.LAW_SEARCH, env.LAW, query, { limit: args.limit, tracks: tracksFor(args.track) });
  if (passages.length === 0) return once(jsonResult({ results: [], notice: NOTICE, message: NOTHING_MATCHED }));
  return once(jsonResult(lawAnswer(passages)));
}

/** One unit of the library as the catalog listing shows it. */
export interface LawUnit {
  unit: string;
  citation: string;
  title: string;
  kind: LawChunk['kind'];
  track: LawTrack;
  source_url: string;
  source: string;
  retrieved: string;
  /** Indexed parts the unit is split into; search returns parts. */
  parts: number;
  /** An opinion's writings, the opinion of the court ("majority") first: only it states the holding. */
  opinions?: LawOpinion[];
}

/** The part number of a chunk id (`<unit>~<n>`), 0 for a unit indexed whole. */
const partOf = (id: string) => Number(/~([0-9]+)$/.exec(id)?.[1] ?? 0);

/** The catalog's units on `tracks`, sorted by unit id, each described by its first part (which carries the unit's cite). */
export function lawUnits(catalog: ReadonlyMap<string, LawChunk>, tracks: readonly LawTrack[]): LawUnit[] {
  const units = new Map<string, { first: LawChunk; parts: number; opinions: LawOpinion[] }>();
  for (const chunk of catalog.values()) {
    if (!tracks.includes(chunk.track)) continue;
    const id = unitOf(chunk.id);
    const held = units.get(id) ?? { first: chunk, parts: 0, opinions: [] };
    if (partOf(chunk.id) < partOf(held.first.id)) held.first = chunk;
    held.parts += 1;
    if (chunk.opinion && !held.opinions.includes(chunk.opinion)) held.opinions.push(chunk.opinion);
    units.set(id, held);
  }
  return [...units.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([unit, { first, parts, opinions }]) => ({
      unit,
      citation: first.cite,
      title: first.title,
      kind: first.kind,
      track: first.track,
      source_url: first.url,
      source: first.source,
      retrieved: first.retrieved,
      parts,
      ...(opinions.length ? { opinions: LAW_OPINIONS.filter((o) => opinions.includes(o)) } : {}),
    }));
}

/** The listing's own caps (standard): 100 units, within the largest standard result's characters, as for the catalog. */
const LAW_LIST_LIMITS: ResultLimits = { maxItems: LIST_PAGE_SIZE, maxChars: MAX_CHARS_PER_READ };
/** The longest list cursor (a 96-character unit id), for sizing a compact page. */
const LONGEST_LAW_CURSOR = encodeCursor(['x'.repeat(96)]);

/** One page of the catalog listing, keyset-paged on the unit id. */
async function listLaw(env: McpEnv & { LAW: R2Bucket }, args: LawArgs, ctx: ToolContext) {
  const parts = args.cursor === undefined ? null : decodeCursor(args.cursor);
  const after = parts?.length === 1 && typeof parts[0] === 'string' ? parts[0] : null;
  if (args.cursor !== undefined && after === null) return toolError('bad_cursor', 'Pass next_cursor from a previous list result, or list again without a cursor.');
  await ctx.audit('ai_read', null);
  const catalog = await lawCatalog(env.LAW);
  const all = lawUnits(catalog ?? new Map(), tracksFor(args.track));
  const rest = after === null ? all : all.filter((unit) => unit.unit > after);
  const fit = fitItems(ctx.profile, rest, LAW_LIST_LIMITS, { total: all.length, units: [], notice: NOTICE, next_cursor: LONGEST_LAW_CURSOR });
  const result: Record<string, unknown> = { total: all.length, units: fit.items, notice: NOTICE };
  if (fit.next !== null) result.next_cursor = encodeCursor([rest[fit.next - 1].unit]);
  return once(jsonResult(result));
}

/** The tool that searches the law library. */
export const searchLawTool: ToolDefinition<typeof inputSchema> = {
  name: LAW_TOOL_NAME,
  title: 'Search the law library',
  description:
    `Search the law library: ${lawLibraryHolds} Public law, separate from the case ` +
    'documents. Returns passages with the canonical citation, the official source link, the date retrieved and the track; an ' +
    'opinion passage also says which writing it is from (the opinion of the court, a concurrence or a dissent) and its author. ' +
    'Only the opinion of the court states the holding. With list: true and no query, lists what the library holds, ' +
    'one row per unit, paged with next_cursor.',
  inputSchema,
  // No outputSchema: the answer is the JSON once, as text, for every client (a structured copy would double its tokens).
  // Each passage and unit carries its own citation, official link and retrieved date: no result-wide date.
  async handler(args, ctx) {
    if (!canPerform(ctx.member.role, 'view')) return toolError('forbidden', 'This member cannot search the counsel room.');
    const env: McpEnv = ctx.env;
    if (!lawEnabled(env)) return toolError('unavailable', 'The law library is not turned on.');
    if (args.list === true) return listLaw(env, args, ctx);
    if (args.query === undefined) return toolError('bad_request', 'Give a query to search, or list: true to page through the library.');
    return searchLaw(env, args.query, args, ctx);
  },
};
