// SPDX-License-Identifier: Apache-2.0
// Every tool's outputSchema (MCP spec: tools, output schema), and the small view a compact result keeps. Built to the bar
// Anthropic's legal plugins set for a connector (anthropics/claude-for-legal CONNECTORS.md, read 2026-11-06): provenance
// in results, "the source, date retrieved, and a citation-ready identifier".
//
// | Field             | On                                         | Is                                     |
// |-------------------|--------------------------------------------|----------------------------------------|
// | `control`, `page` | each row, its `cites`, or the result's own | the citation-ready id: DOE-000012 p. 4 |
// | `link`            | each row, or its `cites`                   | the room page it came from             |
// | `retrieved`       | each result; each law row                  | the day it was read                    |
//
// `retrieved` is once per result, not on every row: a result's rows are read at the same moment, and a copy per row
// costs tokens. A checklist item's cites name whole documents, so they carry no page.
//
// A row whose text is untrusted has no cite fields (mcp/untrusted.ts markUntrusted), so none is required. Every object is
// loose: the SDK checks each standard result against its schema (mcp/server.ts), and a field added later must never turn
// a good result into an error. Only the fields a row is found and cited by are named.
import { z } from 'zod';
import { CLOSE, fenceOf, NOTE_KEY } from '../untrusted.ts';

const RETRIEVED = z.string().describe('Day (UTC) the room served this result: the retrieved date of every row in it.');
const CONTROL = z.string().nullable().optional().describe('Control number to cite, with the page.');
const PAGE = z.number().nullable().optional();
const LINK = z.string().optional().describe('Room link to the document or page.');
const CURSOR = z.string().optional().describe('Pass back with the same arguments for the rest.');

/** A document row: what the room finds it by, cites it by and links it to. */
const DOC = { id: z.string(), control: CONTROL, link: LINK };

/** The output schema of the search tool. */
export const SEARCH_OUTPUT = z.looseObject({
  retrieved: RETRIEVED,
  results: z.array(z.looseObject({ ...DOC, page: PAGE, text: z.string() })),
  next_cursor: CURSOR,
});

/** The output schema of the list documents tool. */
export const LIST_OUTPUT = z.looseObject({
  retrieved: RETRIEVED,
  total: z.number(),
  as_of: z.string().describe('Pass as since for what is new.'),
  documents: z.array(z.looseObject({ ...DOC, title: z.string(), privileged: z.boolean() })),
  next_cursor: CURSOR,
});

/** The output schema of the get document tool. */
export const DOCUMENT_OUTPUT = z.looseObject({ retrieved: RETRIEVED, ...DOC, title: z.string(), privileged: z.boolean(), comments: z.number() });

/** The output schema of the read pages tool. */
export const PAGES_OUTPUT = z.looseObject({
  retrieved: RETRIEVED,
  ...DOC,
  total_pages: z.number().nullable(),
  pages: z.array(z.looseObject({ page: z.number(), link: LINK, text: z.string() })),
  next: z.number().optional().describe('The page to read from next.'),
  next_cursor: CURSOR,
});

/** The output schema of the view visual tool. */
export const VISUAL_OUTPUT = z.looseObject({
  retrieved: RETRIEVED,
  id: z.string().optional(),
  control: CONTROL,
  link: LINK,
  text: z.string().nullable().optional(),
  sections: z.array(z.looseObject({ slug: z.string(), visuals: z.array(z.looseObject(DOC)) })).optional(),
  next: CURSOR,
});

const COMMENT = { id: z.string(), page: z.number().nullable(), link: LINK, text: z.string() };

/** The output schema of the get comments tool. */
export const COMMENTS_OUTPUT = z.looseObject({
  retrieved: RETRIEVED,
  ...DOC,
  total_threads: z.number(),
  threads: z.array(z.looseObject({ ...COMMENT, resolved: z.boolean(), replies: z.array(z.looseObject(COMMENT)) })),
  next_cursor: CURSOR,
});

/** The output schema of the get file tool. */
export const FILE_OUTPUT = z.looseObject({ retrieved: RETRIEVED, ...DOC, embedded: z.boolean(), reason: z.string().optional() });

/** The output schema of the case overview tool. */
export const OVERVIEW_OUTPUT = z.looseObject({
  retrieved: RETRIEVED,
  section: z.string(),
  entries: z.array(z.looseObject({ id: z.string().nullable().optional() })).optional(),
  nextCursor: z.string().nullable().optional().describe('Pass back with the same section for the next page.'),
});

/** The output schema of the propose tools: a pending proposal with its id, expiry and review link. */
export const PROPOSAL_OUTPUT = z.looseObject({
  proposal: z.looseObject({ id: z.string(), status: z.literal('pending'), expires: z.string(), review_link: z.string() }),
});

/** A template list's rows, or one template's part (mcp/templates.ts). */
export const TEMPLATE_OUTPUT = z.looseObject({
  notice: z.string(),
  templates: z.array(z.looseObject({ path: z.string(), title: z.string(), entity: z.array(z.string()), parts: z.number() })).optional(),
  path: z.string().optional(),
  text: z.string().optional(),
  part: z.number(),
  parts: z.number(),
  next_part: z.number().nullable().describe('Pass as part for the rest; null at the end.'),
});

const FINDING = { source: z.string(), link: z.string(), checked: z.string() };

/** The output schema of the public records tool. */
export const RECORDS_OUTPUT = z.looseObject({
  status: z.enum(['approval_needed', 'declined', 'checked']),
  name: z.string(),
  sources: z.array(z.looseObject({ source: z.string(), findings: z.array(z.looseObject(FINDING)) })).optional(),
});

/** Row fields a compact view keeps: what a board, timeline or grid needs to place a row, label it and cite it. */
const VIEW_FIELDS: ReadonlySet<string> = new Set([
  'id', 'control', 'page', 'link', 'title', 'name', 'folder', 'date', 'amount', 'status', 'stage', 'kind', 'type', 'mark', 'key', 'privileged',
  'part', 'parts', 'untrusted', 'truncated',
]);
/** A view's strings stop here, a case-data fence kept whole: a view labels a row, and the text has the rest. */
export const VIEW_TEXT_CHARS = 120;

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);

/** A string cut to VIEW_TEXT_CHARS, inside its fence when it has one (mcp/untrusted.ts), so its mark stays. */
function label(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const fence = fenceOf(value);
  const inner = fence ? fence.inner : value;
  if (inner.length <= VIEW_TEXT_CHARS) return value;
  const cut = `${inner.slice(0, VIEW_TEXT_CHARS)} [cut]`;
  return fence ? fence.open + cut + CLOSE : cut;
}

const pick = (value: unknown, keys: readonly string[]): Obj | null =>
  isObj(value) ? Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]])) : null;

/** One row as a view keeps it: its VIEW_FIELDS, its first cite, and its due dates; null when nothing is left. */
export function viewRow(row: unknown): Obj | null {
  if (!isObj(row)) return null;
  const out: Obj = {};
  for (const [key, field] of Object.entries(row)) {
    if (key === 'cites' && Array.isArray(field) && field.length > 0) out.cite = pick(field[0], ['control', 'page', 'link']);
    else if (key === 'due' && Array.isArray(field)) out.due = field.map((date) => pick(date, ['date', 'opens', 'state']));
    else if (VIEW_FIELDS.has(key) && !isObj(field) && !Array.isArray(field)) out[key] = label(field);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The structured content a compact result keeps (format.ts jsonResult's `view`), for the views that read
 * legallas_case_overview and legallas_list_documents: the result's own short fields and counts, and each list as rows of
 * VIEW_FIELDS. The text keeps everything. Pages are sized with it (format.ts fitItems, overview-page.ts FITS), so text
 * and view together stay within Copilot's budget.
 */
export function compactView(value: Obj): Obj {
  const out: Obj = {};
  for (const [key, field] of Object.entries(value)) {
    // The untrusted note stays in the text, before the rows it explains; a row keeps its own `untrusted` mark.
    if (key === NOTE_KEY) continue;
    if (Array.isArray(field)) {
      const rows = field.map(viewRow).filter((row): row is Obj => row !== null);
      if (rows.length > 0) out[key] = rows;
    } else if (key === 'counts' && isObj(field)) {
      out[key] = field;
    } else if (!isObj(field)) {
      out[key] = label(field);
    }
  }
  return out;
}
