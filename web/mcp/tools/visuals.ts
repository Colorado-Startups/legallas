// SPDX-License-Identifier: Apache-2.0
// legallas_view_visual (session 4, decision D8): the visual binder for counsel's AIs. With no id, the binder's table of
// contents: tabs and pages from the binder manifest joined to the live visuals (worker/visual-ai.ts loadBinder, the
// same rule as /api/visuals). With a visual's id or slug, the text the page shows once its charts are drawn (its side
// file, meta/visual-ai/<html sha256>.txt) and its room link, plus the page as a PNG for Claude when one is stored.
// Results follow the caller's profile (D6, format.ts limitsFor); a `next` cursor continues the table or a long text.
//
// A PNG is a byte pull: audited as `download` (never deduped) and counted against DAILY_DOWNLOAD_CAP, past which the
// visual's text comes back without it. Every query keeps removed_at IS NULL, NOT_HIDDEN_SQL and privilegeFilter (in
// worker/visual-ai.ts). A visual's sha256 only finds its side file; it is never returned, nor is any r2_key.
//
// A visual whose text addresses an AI, or reads as a court order outside the court's record, comes back fenced as
// untrusted, without its control number or link and without its image, under Ask's reminder (mcp/untrusted.ts). The
// whole text is judged, so every stretch of it is fenced alike. The research agent drops such an image too (extra.ts).
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { utcDay } from '../../worker/usage.ts';
import { findVisualRow, loadBinder, readVisualAi, type LoadedBinder, type VisualRow } from '../../worker/visual-ai.ts';
import { visualPath, type RoomSection, type RoomVisual } from '../../worker/visuals.ts';
import { downloadsToday } from '../audit.ts';
import { DAILY_DOWNLOAD_CAP, MAX_CHARS_PER_READ, ROOM_ORIGIN, type ResultLimits, type ToolContext, type ToolDefinition } from '../contract.ts';
import { caseData, caseField, decodeCursor, docLink, embeddable, encodeCursor, fitToProfile, formatControl, imageResult, jsonResult, limitsFor, retrievedOn, toolError } from '../format.ts';
import { canRead, forbidden } from './documents.ts';
import { VISUAL_OUTPUT } from './output.ts';
import { withToolPrefix } from '../tool-prefix.ts';
import { markUntrusted, noted, untrustedReason, type Untrusted } from '../untrusted.ts';

const inputSchema = z.object({
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional()
    .describe("A visual's id (from search results or the binder contents) or its slug. Omit it to list the binder."),
  cursor: z.string().max(512).optional().describe("A previous result's next, to continue the binder contents or a long text."),
});

/** This tool's own caps (the standard profile): the whole binder (at most 1,000 pages) and a read's worth of text. */
export const TOC_LIMITS: ResultLimits = { maxItems: 1_000, maxChars: MAX_CHARS_PER_READ };
/** The size limits of a text result: one item, up to the per-read character cap. */
export const TEXT_LIMITS: ResultLimits = { maxItems: 1, maxChars: MAX_CHARS_PER_READ };

/** The size a result is measured by: the text every client reads (jsonResult's pretty JSON). */
export function resultChars(value: Record<string, unknown>): number {
  return JSON.stringify(value, null, 2).length;
}

/** The folder a document's path sits in, '' at the root: what the source rules read (worker/source-kind.ts). */
function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function visualLink(slug: string | null, id: string): string {
  return slug ? `${ROOM_ORIGIN}${visualPath(slug)}` : docLink(id);
}

function tocEntry(visual: RoomVisual, row: VisualRow | undefined, prefix: string | undefined): Record<string, unknown> {
  return {
    id: visual.id,
    slug: visual.slug,
    control: formatControl(prefix, row?.control_seq ?? null),
    title: caseField(visual.title),
    summary: caseField(visual.summary),
    ...(visual.overview ? { overview: true } : {}),
    link: visualLink(visual.slug, visual.id),
  };
}

function tocPage(loaded: LoadedBinder, prefix: string | undefined, offset: number, count: number, retrieved: string): Record<string, unknown> {
  const all = loaded.binder.visuals;
  const bySection = new Map<string, RoomSection>(loaded.binder.sections.map((section) => [section.slug, section]));
  const sections: Record<string, unknown>[] = [];
  for (const visual of all.slice(offset, offset + count)) {
    let group = sections[sections.length - 1];
    if (!group || group.slug !== visual.section) {
      const section = bySection.get(visual.section);
      group = { slug: visual.section, tab: caseField(section?.label ?? null), title: caseField(section?.title ?? null), summary: caseField(section?.summary ?? null), visuals: [] };
      sections.push(group);
    }
    (group.visuals as unknown[]).push(tocEntry(visual, loaded.rows.get(visual.id), prefix));
  }
  const page: Record<string, unknown> = { retrieved, tabs: loaded.binder.sections.length, visuals: all.length, from: offset + 1, sections };
  if (offset + count < all.length) page.next = encodeCursor(['toc', offset + count]);
  // Binder titles and summaries are written in the room: judged as caseField judges them, each item marked (mcp/untrusted.ts).
  // How to read a page is the tool's description, so the table carries no sentence about it.
  return noted(markUntrusted(page));
}

/**
 * The table of contents from `offset`, as many pages as `limits` allow (always at least one). fitToProfile picks the
 * pages by their size as nested in the result (with room for the wrapper); the built page is then measured as sent.
 */
export function tableOfContents(loaded: LoadedBinder, prefix: string | undefined, offset: number, limits: ResultLimits, retrieved: string): Record<string, unknown> {
  const nestedSize = (visual: RoomVisual) => {
    const lines = JSON.stringify(tocEntry(visual, loaded.rows.get(visual.id), prefix), null, 2).split('\n');
    return lines.join('\n').length + lines.length * 8 + 2;
  };
  const wrapper = resultChars(tocPage(loaded, prefix, offset, 0, retrieved)) + 600;
  const room = { maxItems: limits.maxItems, maxChars: Math.max(1, limits.maxChars - wrapper) };
  let count = fitToProfile(loaded.binder.visuals, room, nestedSize, offset).items.length;
  let page = tocPage(loaded, prefix, offset, count, retrieved);
  while (count > 1 && resultChars(page) > limits.maxChars) {
    count -= 1;
    page = tocPage(loaded, prefix, offset, count, retrieved);
  }
  return page;
}

/** End of the stretch of `text` from `offset` that fits `budget`, at a line break when one is in its second half. */
export function textEnd(text: string, offset: number, budget: number): number {
  const hard = Math.min(text.length, offset + Math.max(1, budget));
  if (hard >= text.length) return text.length;
  const lineBreak = text.lastIndexOf('\n', hard);
  const end = lineBreak > offset + budget / 2 ? lineBreak + 1 : hard;
  return /[\uD800-\uDBFF]/.test(text[end - 1] ?? '') ? end - 1 : end;
}

/**
 * `facts` plus the stretch of `text` from `offset` that keeps the whole result within `maxChars` as sent (JSON escapes
 * newlines and quotes, so the stretch is measured in the result, not the text), and `next` when more remains. `reason`
 * is the whole text's mark (mcp/untrusted.ts; left out, caseData judges the stretch): an untrusted stretch comes
 * without cite fields, the note first.
 */
export function fitText(facts: Record<string, unknown>, id: string, text: string, offset: number, maxChars: number, reason?: Untrusted | null): Record<string, unknown> {
  const build = (end: number) => noted(markUntrusted({
    ...facts,
    text: caseData(text.slice(offset, end), reason),
    from: offset + 1,
    ...(end < text.length ? { next: encodeCursor(['text', id, end]) } : {}),
  }));
  let budget = maxChars - resultChars(build(offset)) - 64;
  let value = build(textEnd(text, offset, budget));
  for (let over = resultChars(value) - maxChars; over > 0 && budget > 1; over = resultChars(value) - maxChars) {
    budget = Math.max(1, budget - over);
    value = build(textEnd(text, offset, budget));
  }
  return value;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const NO_BINDER: LoadedBinder = { binder: { sections: [], visuals: [] }, rows: new Map() };
const notFound = (toolPrefix?: string) => toolError('not_found', withToolPrefix('Call legallas_view_visual without an id for the binder contents, or use legallas_search.', toolPrefix));
const badCursor = (toolPrefix?: string) => toolError('bad_cursor', withToolPrefix('Call legallas_view_visual again without a cursor to start from the beginning.', toolPrefix));
const badManifest = () => toolError('bad_manifest', "The binder's contents could not be read. Ask the room owner.");
const DOWNLOAD_LIMIT_NOTE = "Today's limit for images and files through AI tools is reached, so the image is left out. It resets at midnight UTC.";

const isOffset = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Where a cursor resumes: an offset (0 or more) into the table (`toc`) or into one visual's text, else null. */
function cursorOffset(cursor: string | undefined, kind: 'toc' | 'text', id: string | null): number | null {
  if (cursor === undefined) return 0;
  const parts = decodeCursor(cursor);
  if (kind === 'toc' && parts?.length === 2 && parts[0] === 'toc' && isOffset(parts[1])) return parts[1];
  if (kind === 'text' && parts?.length === 3 && parts[0] === 'text' && parts[1] === id && isOffset(parts[2])) return parts[2];
  return null;
}

function visualFacts(ctx: ToolContext, loaded: LoadedBinder, visual: RoomVisual | null, row: VisualRow): Record<string, unknown> {
  const section = visual ? loaded.binder.sections.find((s) => s.slug === visual.section) : undefined;
  return {
    retrieved: retrievedOn(ctx.now),
    id: row.id,
    slug: visual?.slug ?? null,
    control: formatControl(ctx.env.CONTROL_PREFIX, row.control_seq),
    title: visual?.title ?? row.name,
    tab: section ? `${section.label}: ${section.title}` : null,
    summary: visual?.summary ?? null,
    link: visualLink(visual?.slug ?? null, row.id),
  };
}

/** One visual by id or slug: its facts, a stretch of its text, and its PNG for Claude with the first stretch. */
async function viewOne(ctx: ToolContext, loaded: LoadedBinder, key: string, cursor: string | undefined): Promise<CallToolResult> {
  const visual = loaded.binder.visuals.find((v) => v.id === key || v.slug === key) ?? null;
  const row = visual ? loaded.rows.get(visual.id) : await findVisualRow(ctx.env.DB, key, ctx.member.role);
  if (!row) return notFound(ctx.toolPrefix);
  const offset = cursorOffset(cursor, 'text', row.id);
  if (offset === null) return badCursor(ctx.toolPrefix);
  await ctx.audit('ai_read', row.id);
  const facts = visualFacts(ctx, loaded, visual, row);
  const ai = await readVisualAi(ctx.env.FILES, row.sha256, { png: ctx.clientKind === 'claude' && offset === 0 });
  if (!ai) return jsonResult({ ...facts, text: null, note: 'This visual has no AI-readable text yet. Open it in the room with the link.' });
  if (offset > ai.text.length) return badCursor(ctx.toolPrefix);
  const reason = untrustedReason(ai.text, { name: row.name, folder: folderOf(row.path) });
  const png = ai.png && embeddable(ai.png.byteLength) ? ai.png : null;
  // An untrusted visual's image would carry the same words to the model, so it is held back like its cites.
  const held = png !== null && reason !== null;
  const capped = png !== null && !held && (await downloadsToday(ctx.env.DB, ctx.member.email, utcDay(ctx.now))) >= DAILY_DOWNLOAD_CAP;
  const image = png === null ? {} : held ? { image_embedded: false, image_reason: 'untrusted' } : capped ? { image_embedded: false, image_reason: 'download_limit', note: DOWNLOAD_LIMIT_NOTE } : { image_embedded: true };
  const value = fitText({ ...facts, ...image }, row.id, ai.text, offset, limitsFor(ctx.profile, TEXT_LIMITS).maxChars, reason);
  if (png === null || held || capped) return jsonResult(value);
  await ctx.audit('download', row.id);
  return imageResult(value, { data: base64(png), mimeType: 'image/png' });
}

/** The legallas_view_visual tool, which views a visual. */
export const viewVisualTool: ToolDefinition<typeof inputSchema> = {
  name: 'legallas_view_visual',
  title: 'View a visual',
  description:
    'The visual binder made to explain the matter: charts, timelines and one-idea pages grouped into tabs. With no id, ' +
    'its tabs and pages (each with id, slug, control number and room link). With an id or slug, the text the page ' +
    'shows (headings, labels, table cells and chart labels) and its room link, and an image of the page where the ' +
    'client takes images. When more remains, the result gives a cursor to continue.',
  inputSchema,
  outputSchema: VISUAL_OUTPUT,
  async handler(args, ctx) {
    if (!canRead(ctx)) return forbidden();
    const loaded = await loadBinder(ctx.env.DB, ctx.env.FILES, ctx.member.role);
    // A visual can still be read by its id while the binder's manifest is broken; only the contents need it.
    if (args.id !== undefined) return viewOne(ctx, 'error' in loaded ? NO_BINDER : loaded, args.id, args.cursor);
    if ('error' in loaded) return badManifest();
    const offset = cursorOffset(args.cursor, 'toc', null);
    if (offset === null) return badCursor(ctx.toolPrefix);
    await ctx.audit('ai_read', null);
    const retrieved = retrievedOn(ctx.now);
    if (loaded.binder.visuals.length === 0) return jsonResult({ retrieved, tabs: 0, visuals: 0, sections: [] });
    if (offset >= loaded.binder.visuals.length) return badCursor(ctx.toolPrefix);
    return jsonResult(tableOfContents(loaded, ctx.env.CONTROL_PREFIX, offset, limitsFor(ctx.profile, TOC_LIMITS), retrieved));
  },
};
