// SPDX-License-Identifier: Apache-2.0
// legallas_read_pages: the extracted text of a range of pages (owner: session B2; the response profile and the
// in-page cursor: session 2b). Parts in INDEX are size-based (`text/<id>.p<N>.md`), not pages; mcp/pages-text.ts
// regroups them by the `[[doc:<id> p:<n>]]` markers (see scripts/indexparts.ts and worker/citations.ts). A page that
// addresses an AI, or reads as a court order outside the court's record, comes back fenced as untrusted, with its page
// number but no link, under Ask's reminder (mcp/untrusted.ts, worker/quarantine.ts).
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { isAgentFile } from '../../worker/agent-files.ts';
import { MAX_CHARS_PER_READ, MAX_PAGES_PER_READ, type ToolDefinition } from '../contract.ts';
import { caseData, decodeCursor, docLink, encodeCursor, jsonResult, limitsFor, resultChars, retrievedOn, toolError } from '../format.ts';
import { readPageRange, type IndexReader, type PageRangeText } from '../pages-text.ts';
import {
  canRead, DOC_ID, documentFields, documentNotFound, findLiveDocument, folderGuide, forbidden, type DocumentRow,
} from './documents.ts';
import { pageIsKnown } from '../../worker/page-known.ts';
import { withToolPrefix } from '../tool-prefix.ts';
import { markUntrusted, noted, untrustedReason, type Untrusted } from '../untrusted.ts';
import { PAGES_OUTPUT } from './output.ts';

const inputSchema = z.object({
  id: DOC_ID,
  from: z.number().int().min(1).default(1).describe('First page to read (1-based).'),
  to: z.number().int().min(1).optional().describe(`Last page to read. At most ${MAX_PAGES_PER_READ} pages per call.`),
  cursor: z.string().max(64).optional().describe('next_cursor from a previous result for this document: continues inside the page that was cut.'),
});

/** One page as returned. Text is wrapped as case data; a page with no extracted text has an empty string. */
interface PageEntry {
  page: number;
  /** Absent on an untrusted page: it is not offered as a cite. */
  link?: string;
  text: string;
  untrusted?: Untrusted;
  /** Present when the page's text was cut at the per-call limit; next_cursor continues it. */
  truncated?: true;
  /** Present when the text starts inside the page, where a previous result's cut left off. */
  continued?: true;
}

/** The fewest text characters a compact read is fitted down to; one page always comes back, so a call makes progress. */
const MIN_FIT_CHARS = 500;

function outOfRange(total: number) {
  return toolError('out_of_range', `This document has ${total} page${total === 1 ? '' : 's'}. Ask for a page from 1 to ${total}.`);
}

/** Cuts text to at most max UTF-16 units without splitting a surrogate pair. */
function cut(text: string, max: number): string {
  const head = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
}

/** A page's mark, judged on its whole text (mcp/untrusted.ts); undefined leaves caseData to judge what is sent. */
export type PageJudge = (page: number) => Untrusted | null | undefined;

/**
 * Pages from..end as entries, whole pages only while they fit in maxChars. `stoppedAt` is the first page
 * left out for the limit (null when all fit). A first page longer than the limit is cut and marked instead,
 * so every call makes progress; `cut` is then how many of its characters were sent.
 */
export function buildEntries(id: string, text: ReadonlyMap<number, string>, from: number, end: number, maxChars: number, judge: PageJudge = () => undefined) {
  const entries: PageEntry[] = [];
  let chars = 0;
  for (let page = from; page <= end; page += 1) {
    const body = text.get(page) ?? '';
    if (entries.length > 0 && chars + body.length > maxChars) return { entries, stoppedAt: page };
    if (body.length > maxChars) {
      const head = cut(body, maxChars);
      entries.push({ page, link: docLink(id, page), text: caseData(head, judge(page)), truncated: true });
      return { entries, stoppedAt: page + 1, cut: head.length };
    }
    entries.push({ page, link: docLink(id, page), text: body ? caseData(body, judge(page)) : '' });
    chars += body.length;
  }
  return { entries, stoppedAt: null };
}

/** The first page alone, cut and marked: reading stopped inside it. Null when none of its text was read. */
function partialFirst(id: string, body: string | undefined, page: number, maxChars: number, judge: PageJudge) {
  if (!body) return null;
  const head = cut(body, maxChars);
  return { entries: [{ page, link: docLink(id, page), text: caseData(head, judge(page)), truncated: true } as PageEntry], stoppedAt: page + 1, cut: head.length };
}

function noText(fields: Record<string, unknown>, row: DocumentRow) {
  return jsonResult(noted({
    ...fields,
    total_pages: row.pages ?? null,
    pages: [],
    note: `This document has no extracted text (for example a photo or a scan that was not read). Open it in the room: ${docLink(row.id)}`,
  }));
}

/** Where a read starts: `offset` characters into page `from` when resuming a cut page. */
interface Span {
  from: number;
  end: number;
  total: number | null;
  offset: number;
}

/**
 * The result for pages span.from..span.end within `budget` text characters, or null when no text was read. An
 * untrusted page keeps its number but not its link, and the result carries Ask's reminder first (mcp/untrusted.ts).
 */
function pageResult(id: string, fields: Record<string, unknown>, pages: ReadonlyMap<number, string>, span: Span, budget: number, judge: PageJudge): Record<string, unknown> | null {
  const built = span.end >= span.from ? buildEntries(id, pages, span.from, span.end, budget, judge) : partialFirst(id, pages.get(span.from), span.from, budget, judge);
  if (!built) return null;
  if (span.offset > 0) built.entries[0].continued = true;
  const after = built.stoppedAt ?? span.end + 1;
  const last = built.entries[built.entries.length - 1].page;
  const result: Record<string, unknown> = { ...fields, total_pages: span.total, from: span.from, to: last, pages: built.entries };
  if (span.total === null || after <= span.total) result.next = after;
  // The cut page continues where this result stopped (offsets count the page's whole text, from its start).
  if (built.cut !== undefined) result.next_cursor = encodeCursor([last, (last === span.from ? span.offset : 0) + built.cut]);
  return noted({ ...result, pages: markUntrusted(built.entries, ['page']) });
}

/** Page text from `offset` on, for a read resuming inside page `from`; null when the page no longer runs that far. */
function resumeAt(text: PageRangeText, from: number, offset: number): Map<number, string> | null {
  if (offset === 0) return text.pages;
  const first = text.pages.get(from) ?? '';
  if (first.length <= offset) return null;
  return new Map([...text.pages].map(([page, body]) => [page, page === from ? body.slice(offset) : body]));
}

/** How a read is bounded: an in-page offset to resume from, and a compact result's character budget; and its day. */
export interface ReadOptions {
  offset?: number;
  fitChars?: number;
  /** The result's retrieved date (format.ts retrievedOn); the tool always sets it. */
  retrieved?: string;
}

/**
 * Reads pages from..requestedTo of a live document (checked and audited by the caller), within
 * MAX_PAGES_PER_READ pages and maxChars characters (and, with fitChars, a result text of at most that many
 * characters). Only pages up to the index's `readThrough` are returned, so a page that was not read never passes
 * for a blank one.
 */
export async function readPages(index: IndexReader, row: DocumentRow, prefix: string | undefined, from: number, requestedTo: number | undefined, maxChars: number, options: ReadOptions = {}): Promise<CallToolResult> {
  const offset = options.offset ?? 0;
  if (row.pages && from > row.pages) return outOfRange(row.pages);
  let to = Math.min(requestedTo ?? Number.MAX_SAFE_INTEGER, from + MAX_PAGES_PER_READ - 1);
  if (row.pages) to = Math.min(to, row.pages);
  const text = await readPageRange(index, row.id, from, to, maxChars + offset);
  // Only PDFs have a page count in D1; for other files, the last marker is the last page once all is read.
  const total = row.pages ?? (text.complete ? text.lastPage : null);
  const dated: Record<string, unknown> = options.retrieved === undefined ? {} : { retrieved: options.retrieved };
  const { pages: _count, ...fields } = markUntrusted({ ...dated, ...documentFields(row, prefix) });
  if (!text.hasText || total === 0) return noText(fields, row);
  if (total !== null && from > total) return outOfRange(total);
  const pages = resumeAt(text, from, offset);
  if (!pages) return toolError('index_changed', `The text of this document changed. Read it again from page ${from} without a cursor.`);

  let end = total !== null ? Math.min(to, total) : to;
  if (!text.complete) end = Math.min(end, text.readThrough);
  const span: Span = { from, end, total, offset };
  // Each page is judged whole, as read and with its document, however much of it this result sends.
  const doc = { name: row.name, folder: row.folder };
  const marks = new Map<number, Untrusted | null>();
  const judge: PageJudge = (page) => {
    if (!marks.has(page)) marks.set(page, untrustedReason(text.pages.get(page) ?? '', doc));
    return marks.get(page);
  };
  let budget = maxChars;
  let result = pageResult(row.id, fields, pages, span, budget, judge);
  // A compact result counts its whole text, markup and escapes included (the note too): cut the text budget until it fits.
  while (options.fitChars && result && resultChars(result) > options.fitChars && budget > MIN_FIT_CHARS) {
    budget = Math.max(MIN_FIT_CHARS, budget - (resultChars(result) - options.fitChars) - 64);
    result = pageResult(row.id, fields, pages, span, budget, judge);
  }
  if (!result) return toolError('index_changed', 'The text of this document is being updated. Try again in a minute.');
  if (!pageIsKnown(row.name)) result.note = 'This document has no page numbers. Its text is one block, so cite its control number and never a page.';
  return jsonResult(result);
}

/** A read_pages cursor: the page that was cut and how many of its characters were sent. */
function pageCursor(cursor: string): { page: number; offset: number } | null {
  const parts = decodeCursor(cursor);
  if (parts?.length !== 2) return null;
  const [page, offset] = parts;
  const counted = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= max;
  return counted(page, 999_999) && counted(offset, 999_999_999) ? { page, offset } : null;
}

/** The legallas_read_pages tool, which reads document pages. */
export const readPagesTool: ToolDefinition<typeof inputSchema> = {
  name: 'legallas_read_pages',
  title: 'Read document pages',
  description:
    `Read the text of pages from one document, at most ${MAX_PAGES_PER_READ} pages or about ` +
    `${MAX_CHARS_PER_READ.toLocaleString('en-US')} characters per call, each page labelled with its number and ` +
    'room link. When more remains, the result says which page to continue from (next). A single page longer ' +
    'than the limit comes back cut and marked truncated; pass next_cursor with the same id to read the rest of it.',
  inputSchema,
  outputSchema: PAGES_OUTPUT,
  async handler(args, ctx) {
    if (!canRead(ctx)) return forbidden();
    const resume = args.cursor === undefined ? null : pageCursor(args.cursor);
    if (args.cursor !== undefined && !resume) return toolError('bad_cursor', withToolPrefix('Pass next_cursor from a previous legallas_read_pages result, or read by from and to.', ctx.toolPrefix));
    const from = resume?.page ?? args.from ?? 1;
    if (args.to !== undefined && args.to < from) return toolError('bad_range', 'Give a last page (to) that is not before the first page (from).');
    const row = await findLiveDocument(ctx.env.DB, args.id, ctx.member.role);
    if (!row) return documentNotFound(ctx.toolPrefix);
    // Before the audit and the index: nothing of a folder guide is read (and the index has none of it).
    if (isAgentFile(row.path)) return folderGuide(row);
    await ctx.audit('ai_read', row.id);
    // Standard reads MAX_CHARS_PER_READ characters of page text; compact fits the whole result in its limit.
    const { maxChars } = limitsFor(ctx.profile, { maxItems: MAX_PAGES_PER_READ, maxChars: MAX_CHARS_PER_READ });
    const options: ReadOptions = { offset: resume?.offset ?? 0, retrieved: retrievedOn(ctx.now), ...(ctx.profile === 'compact' ? { fitChars: maxChars } : {}) };
    return readPages(ctx.env.INDEX, row, ctx.env.CONTROL_PREFIX, from, args.to, maxChars, options);
  },
};
