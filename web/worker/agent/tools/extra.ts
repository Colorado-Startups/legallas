// SPDX-License-Identifier: Apache-2.0
// The research agent's second set of tools (plan session 9): comment threads, original files as text, the visual
// binder and the full track briefs. Like the first six (adapters.ts), each is the MCP's own handler, imported unedited
// and run by adapters.ts call() under the member's own role, and the model reads its result only through
// compactResult (every string field screened by addressesModel, ids aliased, links dropped). What each one adds to
// the evidence book, and so to the final answer's cite book, is only what is the record itself:
// - legallas_get_comments: nothing. Threads are the members' notes about the record, not the record: citing a page for
//   a comment's words would put them in the document's mouth. They steer which pages the steps read, and come in
//   pages with a nextCursor (brief.ts fitList; compact.ts drops the tool's own next_cursor).
// - legallas_get_file: nothing. The file's details, its page count and a pointer to legallas_read_pages. The research
//   context's client kind is never 'claude', so the handler never reads the bytes, and call() refuses any result
//   that carries more than text (textOnly).
// - legallas_view_visual: the visual's text, as its one page under its own marker, from a live visual this role may
//   see, with any "[[" in it broken up (as the index does, scripts/indexparts.ts neutralizeMarkers) so a marker in a
//   page's text can never name another page; and, from the first stretch of a visual whose whole text is clean, its
//   PNG queued for the next tool step's vision input (images.ts). The PNG goes to Workers AI only, never to a client,
//   so it is not a download.
// - legallas_case_overview (already offered): nothing; the documents a brief cites get aliases, so the steps can read
//   the pages it names, and brief.ts pages its view so a whole brief is reached in parts, never cut.
// Offered: comments only to roles that may read them (owner and counsel), visuals only when Ask takes visuals
// (ASK_VISUALS, after its replica eval). Comments, visuals and the overview run with the compact profile, so a result
// lands near TOOL_RESULT_CHARS, and a long brief or text comes in parts with a cursor instead of being cut.
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { ResponseProfile, ToolDefinition } from '../../../mcp/contract.ts';
import { encodeCursor } from '../../../mcp/format.ts';
import { fenceOf } from '../../../mcp/untrusted.ts';
import { getCommentsTool } from '../../../mcp/tools/comments.ts';
import { getFileTool } from '../../../mcp/tools/files.ts';
import { overviewTool } from '../../../mcp/tools/overview.ts';
import { viewVisualTool } from '../../../mcp/tools/visuals.ts';
import { askVisuals } from '../../ask.ts';
import { canPerform } from '../../auth.ts';
import type { Member } from '../../env.ts';
import { addressesModel } from '../../quarantine.ts';
import { liveDocuments } from '../../retrieval.ts';
import { findVisualRow, readVisualAi } from '../../visual-ai.ts';
import { fitList, overviewView } from './brief.ts';
import { compactResult } from './compact.ts';
import type { Evidence } from './evidence.ts';
import type { QueuedImage } from './images.ts';

/** What the second set's collectors use of a turn's tool state (adapters.ts ToolState). */
export interface ExtraState {
  env: { DB: D1Database; FILES: R2Bucket; ASK_VISUALS?: string };
  member: Member;
  evidence: Evidence;
  /** Visual PNGs for the next tool step (images.ts stepWithImages). */
  images: QueuedImage[];
}

/** Short descriptions: every step sends them. The overview's replaces adapters.ts's, to say briefs come whole. */
export const EXTRA_DESCRIPTIONS: Record<string, string> = {
  [overviewTool.name]:
    'The case picture by section: summary, tracks (each with its whole brief: theory, cast, hurdles, dates, key exhibits, drafts, proof per violation), violations, events, people, orgs, money, docs. Follow nextCursor; a long entry comes in parts sharing its id.',
  [getCommentsTool.name]: "Comment threads the room's members wrote on one document, given its alias: notes about the record, not the record. Pass page for one page's threads; follow nextCursor for more.",
  [getFileTool.name]: "One document's original file details, given its alias: type, size and pages. Its text is read with legallas_read_pages.",
  [viewVisualTool.name]: 'The visual binder (charts and timelines that explain the matter). No id: its tabs and pages. With an alias or slug: the text the page shows, and its image when the budget allows.',
};

/** The tools of the second set this member is offered this turn, in the order the model sees them. */
export function extraTools(env: ExtraState['env'], member: Member): ToolDefinition<any>[] {
  const defs: ToolDefinition<any>[] = [getFileTool];
  if (canPerform(member.role, 'readComments')) defs.push(getCommentsTool);
  if (askVisuals(env)) defs.push(viewVisualTool);
  return defs;
}

const COMPACT: ReadonlySet<string> = new Set([getCommentsTool.name, viewVisualTool.name, overviewTool.name]);

/** The response profile a tool runs with in research: compact for those whose pages would pass TOOL_RESULT_CHARS. */
export function profileFor(name: string): ResponseProfile {
  return COMPACT.has(name) ? 'compact' : 'standard';
}

/** True when a result is text only: no image, resource or anything else a model could be sent. */
export function textOnly(result: CallToolResult): boolean {
  return (result.content ?? []).every((part) => part.type === 'text');
}

/**
 * The text of a result field without its case-data fence (mcp/format.ts caseData), an untrusted one too: the evidence
 * book keeps the words, and Ask's own quarantine judges them again before the answer (worker/ask-turn.ts).
 */
export function unfenced(text: string): string {
  return fenceOf(text)?.inner ?? text;
}

/** The visual's PNG for the next step, when it fits the side-file limits and its whole text addresses no model. */
async function queueImage(state: ExtraState, id: string): Promise<void> {
  const row = await findVisualRow(state.env.DB, id, state.member.role);
  const side = row ? await readVisualAi(state.env.FILES, row.sha256, { png: true }) : null;
  if (!side?.png || addressesModel(side.text)) return;
  state.images.push({ alias: state.evidence.alias(id), png: side.png });
}

/**
 * legallas_view_visual's evidence: a visual's text (one stretch of it) as page 1 of its own document, kept only for a
 * live visual this role may see, and its PNG queued with the first stretch. The binder's contents (no id) add nothing.
 */
export async function collectVisual(state: ExtraState, args: Record<string, unknown>, value: Record<string, unknown>): Promise<void> {
  const id = typeof value.id === 'string' ? value.id : null;
  // Any "[[" broken up, as the index does (scripts/indexparts.ts neutralizeMarkers): only our own marker names a page.
  const text = typeof value.text === 'string' ? unfenced(value.text).replace(/\[(?=\[)/g, '[ ') : '';
  if (!id || text.trim() === '') return;
  const citable = await liveDocuments(state.env.DB, [id], state.member.role, { withoutVisuals: !askVisuals(state.env) });
  const doc = citable.get(id);
  if (!doc) return;
  state.evidence.addChunks([{ docId: id, name: doc.name, text: `[[doc:${id} p:1]]\n${text}` }], citable);
  if (args.cursor === undefined) await queueImage(state, id);
}

/** legallas_get_comments' view: fitList, with the tool's own thread cursor (the first thread left out). */
function commentsView(result: CallToolResult, evidence: Evidence): string {
  const value = result.structuredContent as Record<string, unknown> | undefined;
  if (result.isError || !value || !Array.isArray(value.threads)) return compactResult(result, evidence);
  const threads = value.threads as { id?: unknown }[];
  return fitList(result, evidence, 'threads', value.next_cursor, (kept) => encodeCursor([String(threads[kept]?.id)]));
}

/** The model's view of a tool's result: paged for the overview and the comments, compactResult for the rest. */
export function toolView(name: string, args: Record<string, unknown>, result: CallToolResult, evidence: Evidence): string {
  if (name === overviewTool.name) return overviewView(args, result, evidence);
  if (name === getCommentsTool.name) return commentsView(result, evidence);
  return compactResult(result, evidence);
}
