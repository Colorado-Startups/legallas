// SPDX-License-Identifier: Apache-2.0
// legallas_list_documents and legallas_get_document: the room's catalog (owner: session B2; `since`, designations and
// the response profile: session 2b). Rows are mapped field by field from worker/files-catalog.ts conventions
// (NOT_HIDDEN_SQL, displayFolder), so r2_key, sha256 and etag are never selected, let alone returned. Every query
// also keeps worker/privilege.ts's rule for the caller's role: a role without viewPrivileged cannot connect at all,
// and would not see a privileged folder if it could.
//
// Designations (privileged, document date, document type, from and to) come from the published manifest
// (meta/matter.json, worker/matter-types.ts DocFacts), read and served by the core's worker/doc-facts.ts and
// doc-facts-serve.ts exactly as the room serves them to the caller's role, because D1 has none of these columns. The Key flag and the date of change come from D1.
//
// Folder guides (worker/agent-files.ts: each AI tool's instruction file, such as CLAUDE.md, AGENTS.md, GEMINI.md,
// .cursorrules or .windsurfrules, and anything under .claude, .cursor, .gemini, .windsurf/rules or .github/instructions)
// are treated as the room treats them: never listed as documents, and get or read on one says what it is instead of
// passing for an unread scan.
import { z } from 'zod';
import { isAgentFile, NOT_AGENT_FILE_SQL } from '../../worker/agent-files.ts';
import { canPerform, isRoomReader } from '../../worker/auth.ts';
import { loadDocFacts, resetDocFactsCache, serveDocFacts } from '../../worker/doc-facts-serve.ts';
import { MatterError, type DocFactsManifest } from '../../worker/doc-facts.ts';
import type { Role } from '../../worker/env.ts';
import { COUNSEL_FOLDER, displayFolder, NOT_HIDDEN_SQL } from '../../worker/files-catalog.ts';
import { isPrivilegedPath, privilegeFilter } from '../../worker/privilege.ts';
import { LIST_PAGE_SIZE, MAX_CHARS_PER_READ, type ResultLimits, type ToolContext, type ToolDefinition } from '../contract.ts';
import { caseData, caseField, decodeCursor, docLink, encodeCursor, fitItems, formatControl, jsonResult, limitsFor, retrievedOn, toolError } from '../format.ts';
import { withToolPrefix } from '../tool-prefix.ts';
import { markUntrusted, noted, untrustedIn, untrustedReason } from '../untrusted.ts';
import { compactView, DOCUMENT_OUTPUT, LIST_OUTPUT } from './output.ts';
import { viewMeta } from '../apps/views.ts';

const DOC_ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).describe('A document id from search or list results.');

/** The documents columns these tools read. Storage columns are deliberately absent. */
export interface DocumentRow {
  id: string;
  path: string;
  folder: string;
  name: string;
  kind: string;
  pages: number | null;
  updated_at: string;
  source: string;
  control_seq: number | null;
  key_at: string | null;
}

const COLUMNS = 'id, path, folder, name, kind, pages, updated_at, source, control_seq, key_at';
/** Every catalog query: live rows only, never the room's hidden data files, and only what `role` may see. */
function live(role: Role): string {
  return `removed_at IS NULL AND ${NOT_HIDDEN_SQL}${privilegeFilter(role)}`;
}
/** displayFolder in SQL: counsel uploads share one folder, whatever their stored path. */
const DISPLAY_FOLDER_SQL = "(CASE WHEN source = 'counsel' THEN ?1 ELSE folder END)";

/** One live, non-hidden document that a member with `role` may see, or null (a hidden one reads as not found). */
export async function findLiveDocument(db: D1Database, id: string, role: Role): Promise<DocumentRow | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM documents WHERE id = ?1 AND ${live(role)}`).bind(id).first<DocumentRow>();
}

/** The fields every document result carries, as the room shows them. */
export function documentFields(row: DocumentRow, prefix: string | undefined): Record<string, unknown> {
  return {
    id: row.id,
    control: formatControl(prefix, row.control_seq),
    title: caseField(row.name),
    folder: caseField(displayFolder(row)),
    type: row.kind,
    pages: row.pages ?? null,
    key: row.key_at !== null && row.key_at !== undefined,
    updated: row.updated_at.slice(0, 10),
    link: docLink(row.id),
  };
}

/** One document's facts from the manifest as served, with parties by name. */
export interface DocMarks {
  privileged: boolean;
  date: string | null;
  type: string | null;
  from: string[];
  to: string[];
  summary: string | null;
}

/** Test support: forget the per-isolate document facts cache (worker/doc-facts.ts). */
export function resetDocumentsCache(): void {
  resetDocFactsCache();
}

/**
 * Each document's designations by lowercase id, as the room serves the manifest to the caller's role: only live
 * documents it may see, and only parties the served manifest keeps. Empty before a publish, for a manifest that
 * does not parse (logged by code only), and for a context without FILES (unit tests of the catalog alone).
 */
export async function designations(ctx: ToolContext): Promise<ReadonlyMap<string, DocMarks>> {
  if (!ctx.env.FILES) return new Map();
  let facts: DocFactsManifest | null;
  try {
    facts = await loadDocFacts(ctx.env.FILES, ctx.now);
  } catch (error) {
    if (!(error instanceof MatterError || error instanceof SyntaxError)) throw error;
    // The error name only: a MatterError message names a field and may quote a value.
    console.error('mcp_designations_unavailable', error.name);
    return new Map();
  }
  if (!facts) return new Map();
  const { results } = await ctx.env.DB.prepare(`SELECT id, control_seq FROM documents WHERE ${live(ctx.member.role)}`).all<{ id: string; control_seq: number | null }>();
  const served = serveDocFacts(facts, new Map(results.map((row) => [row.id.toLowerCase(), row.control_seq ?? null])));
  const names = new Map<string, string>([...served.people, ...served.orgs].map((party) => [party.id, party.name]));
  const named = (ids: readonly string[]) => ids.flatMap((id) => names.get(id) ?? []);
  return new Map(
    Object.entries(served.docs).map(([id, doc]) => [
      id.toLowerCase(),
      { privileged: doc.privileged, date: doc.date, type: doc.type, from: named(doc.from), to: named(doc.to), summary: doc.summary },
    ]),
  );
}

/** A document's designations: privileged always (its folder or the manifest says so), the rest when the manifest has them. */
export function designationFields(row: DocumentRow, marks: DocMarks | undefined): Record<string, unknown> {
  return {
    privileged: isPrivilegedPath(row.path) || marks?.privileged === true,
    ...(marks?.date ? { date: marks.date } : {}),
    ...(marks?.type ? { doc_type: caseField(marks.type) } : {}),
    ...(marks?.from.length ? { from: marks.from.map(caseField) } : {}),
    ...(marks?.to.length ? { to: marks.to.map(caseField) } : {}),
  };
}

/** The not_found error both document tools (and legallas_read_pages) return, naming tools by the room's prefix. */
export function documentNotFound(toolPrefix?: string) {
  return toolError('not_found', withToolPrefix('Use legallas_search or legallas_list_documents to find a valid id.', toolPrefix));
}

/** What get and read return for a folder guide (isAgentFile): what it is and where counsel can open it, nothing of its text. */
export function folderGuide(row: Pick<DocumentRow, 'id'>) {
  return toolError('folder_guide', `This is a folder guide for AI tools, not part of the case record; it is not indexed. Open it in the room: ${docLink(row.id)}`);
}

/** Members may read the catalog; checked on the role re-read from D1 for this call, never on props.role. */
export function canRead(ctx: ToolContext): boolean {
  return canPerform(ctx.member.role, 'view');
}

/** The tool error for a connection that may not read documents. */
export function forbidden() {
  return toolError('forbidden', 'This connection may not read documents. Ask the room owner.');
}

/**
 * How far `as_of` runs behind the listing. The sync stamps updated_at with the time its run started and writes D1
 * only after its snapshot, SSN scan, uploads and text extraction (scripts/sync.ts, apply.ts), so a document can land
 * with an updated_at before a listing made while that sync ran. A day covers any sync; `since` is inclusive, so a
 * client passing as_of back sees such documents, and some it has seen already, never a gap.
 */
export const AS_OF_LAG_MS = 24 * 3600 * 1000;

/** A date (2026-10-01) or date and time (2026-10-01T09:00:00Z; no zone means UTC), as the instant it names. */
const SINCE = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** `since` as an ISO instant (UTC), or null when it is not a real ISO date or date and time. */
export function sinceInstant(since: string): string | null {
  const text = since.trim();
  const match = SINCE.exec(text);
  if (!match) return null;
  const [, year, month, day, time, zone] = match;
  // Date.parse rolls an impossible day over (2026-02-30 to March 2, losing March 1): a real date names itself.
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  const parsed = Date.parse(time && !zone ? `${text}Z` : text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

const listSchema = z.object({
  folder: z.string().max(300).optional().describe('Only documents in this folder (as shown in results). Omit for all.'),
  since: z
    .string()
    .max(40)
    .optional()
    .describe('Only documents added or changed at or after this time: a date (2026-10-01) or date and time in UTC (2026-10-01T09:00:00Z). Pass as_of from an earlier result to see what is new since then; a document may come back that an earlier result listed.'),
  cursor: z.string().max(128).optional().describe('next_cursor from a previous call, with the same folder and since, to fetch the next page.'),
});

/**
 * The list's own caps (standard): 100 rows, and the largest standard result's characters (legallas_read_pages's
 * MAX_CHARS_PER_READ), so a page of long titles or long party lists comes back shorter instead of too large.
 */
const LIST_LIMITS: ResultLimits = { maxItems: LIST_PAGE_SIZE, maxChars: MAX_CHARS_PER_READ };
/** The longest list cursor (a 64-character id), for sizing a compact page. */
const LONGEST_LIST_CURSOR = encodeCursor(['x'.repeat(64)]);

/** The validated arguments of the list documents tool. */
export type ListArgs = z.infer<typeof listSchema>;

/**
 * One page of the catalog in the room's order (by path), keyset-paged on (path, id), at most `size` rows plus one.
 * Folder guides are left out of the rows and the total alike, so pages and cursors walk the same set.
 * Exported, like findLiveDocument, so documents-privilege.test.ts can check the query's own privilege filter.
 */
export async function listPage(db: D1Database, role: Role, args: ListArgs, filters: { since: string | null; after: { path: string; id: string } | null; size: number }) {
  const where = [live(role), NOT_AGENT_FILE_SQL];
  const binds: unknown[] = [];
  if (args.folder !== undefined) {
    binds.push(COUNSEL_FOLDER, args.folder);
    where.push(`${DISPLAY_FOLDER_SQL} = ?2`);
  }
  if (filters.since !== null) {
    binds.push(filters.since);
    // julianday compares instants, whatever the stored ISO form (with or without milliseconds).
    where.push(`julianday(updated_at) >= julianday(?${binds.length})`);
  }
  const filter = where.join(' AND ');
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE ${filter}`).bind(...binds).first<number>('n');
  const page = [...where];
  const pageBinds = [...binds];
  if (filters.after) {
    pageBinds.push(filters.after.path, filters.after.id);
    page.push(`(path > ?${pageBinds.length - 1} OR (path = ?${pageBinds.length - 1} AND id > ?${pageBinds.length}))`);
  }
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM documents WHERE ${page.join(' AND ')} ORDER BY path, id LIMIT ${filters.size + 1}`)
    .bind(...pageBinds)
    .all<DocumentRow>();
  return { total: total ?? 0, rows: results };
}

/** The row a list cursor (the last row's id) names, if it is still one a member with `role` may see; else null. */
export async function cursorRow(db: D1Database, role: Role, cursor: string): Promise<{ path: string; id: string } | null> {
  const parts = decodeCursor(cursor);
  const id = parts?.length === 1 ? parts[0] : null;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return db.prepare(`SELECT path, id FROM documents WHERE id = ?1 AND ${live(role)}`).bind(id).first<{ path: string; id: string }>();
}

/** The legallas_list_documents tool, which lists case documents. */
export const listDocumentsTool: ToolDefinition<typeof listSchema> = {
  name: 'legallas_list_documents',
  title: 'List case documents',
  description:
    `List documents in the counsel room, up to ${LIST_PAGE_SIZE} per page, with id, control number, title, folder, ` +
    'type, page count, Key flag, room link and designations: privileged, and where known the document date, ' +
    'document type, from and to. With since, only documents added or changed since then. When more remain, ' +
    'pass next_cursor to get the next page. Use legallas_search to find documents by content instead.',
  inputSchema: listSchema,
  outputSchema: LIST_OUTPUT,
  // The review grid an AI draws from this result (mcp/apps/view/grid.ts).
  _meta: viewMeta('grid'),
  async handler(args, ctx) {
    if (!canRead(ctx)) return forbidden();
    const since = args.since === undefined ? null : sinceInstant(args.since);
    if (args.since !== undefined && since === null) return toolError('bad_since', 'Give since as a date (2026-10-01) or a date and time in UTC (2026-10-01T09:00:00Z).');
    const after = args.cursor === undefined ? null : await cursorRow(ctx.env.DB, ctx.member.role, args.cursor);
    if (args.cursor !== undefined && !after) return toolError('bad_cursor', withToolPrefix('Call legallas_list_documents again without a cursor to start from the first page.', ctx.toolPrefix));
    const size = limitsFor(ctx.profile, LIST_LIMITS).maxItems;
    const { total, rows } = await listPage(ctx.env.DB, ctx.member.role, args, { since, after, size });
    await ctx.audit('ai_read', null);
    const marks = rows.length > 0 ? await designations(ctx) : new Map<string, DocMarks>();
    const page = markUntrusted(rows.slice(0, size).map((row) => ({ ...documentFields(row, ctx.env.CONTROL_PREFIX), ...designationFields(row, marks.get(row.id.toLowerCase())) })));
    const as_of = new Date(ctx.now.getTime() - AS_OF_LAG_MS).toISOString();
    const retrieved = retrievedOn(ctx.now);
    // Sized with the note its rows would bring; a compact page counts its view too (format.ts fitItems).
    const envelope = noted({ retrieved, total, as_of, documents: [], next_cursor: LONGEST_LIST_CURSOR }, untrustedIn(page));
    const { items: documents } = fitItems(ctx.profile, page, LIST_LIMITS, envelope, { view: compactView });
    const result: Record<string, unknown> = { retrieved, total, as_of, documents };
    // A row beyond the page (the lookahead) or one the compact budget left out: continue after the last one shown.
    if (documents.length < rows.length) result.next_cursor = encodeCursor([rows[documents.length - 1].id]);
    if (total === 0 && args.folder !== undefined) {
      result.note = 'No documents in that folder. Use a folder exactly as results show it, or omit folder to list all.';
    }
    const value = noted(result);
    // A compact caller keeps a small structured copy too, for the views that read the catalog (output.ts compactView).
    return jsonResult(value, ctx.profile === 'compact' ? compactView(value) : undefined);
  },
};

const getSchema = z.object({ id: DOC_ID });

/** The legallas_get_document tool, which gets a document's details. */
export const getDocumentTool: ToolDefinition<typeof getSchema> = {
  name: 'legallas_get_document',
  title: 'Get document details',
  description:
    'Details of one document: control number, title, folder, type, page count, dates, Key flag, room link and ' +
    'designations (privileged, and where known the document date, document type, from, to and a summary). ' +
    'Does not return its text; use legallas_read_pages for that.',
  inputSchema: getSchema,
  outputSchema: DOCUMENT_OUTPUT,
  async handler(args, ctx) {
    if (!canRead(ctx)) return forbidden();
    const row = await findLiveDocument(ctx.env.DB, args.id, ctx.member.role);
    if (!row) return documentNotFound(ctx.toolPrefix);
    if (isAgentFile(row.path)) return folderGuide(row);
    // A guest's AI reads no comments (mcp/server.ts GUEST_TOOLS), so not their count either.
    const reader = isRoomReader(ctx.member.role);
    const comments = reader ? null : await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE document_id = ?1').bind(row.id).first<number>('n');
    await ctx.audit('ai_read', row.id);
    const marks = (await designations(ctx)).get(row.id.toLowerCase());
    // A summary that addresses an AI, or reads as a court order the document is not, is fenced as untrusted, and the
    // result then offers no cite (control number, link) beside it, under Ask's reminder (mcp/untrusted.ts).
    const summary = marks?.summary ? { summary: caseData(marks.summary, untrustedReason(marks.summary, { name: row.name, folder: row.folder })) } : {};
    return jsonResult(noted(markUntrusted({
      retrieved: retrievedOn(ctx.now),
      ...documentFields(row, ctx.env.CONTROL_PREFIX),
      ...designationFields(row, marks),
      ...summary,
      ...(reader ? {} : { comments: comments ?? 0 }),
    })));
  },
};

export { DOC_ID };
