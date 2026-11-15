// SPDX-License-Identifier: Apache-2.0
// The data-room index as a spreadsheet (D17): GET /api/documents/index.csv lists every document the member may see,
// in control-number order, with the Documents table's designations (src/scripts/documents-table-facts.ts) and a link
// back into the room. The rows are /api/documents's: live, never the room's data files (NOT_HIDDEN_SQL), filtered by
// privilegeFilter for the role and by canSeeDocument once more, and folder guides stay out, as in the table. Every
// cell is neutralized against spreadsheet formula injection (csvCell). Each export writes one `download` audit row
// with via 'index-csv' and no document id; storage columns (r2_key, sha256, etag) are never selected. A company room
// (worker/room-shape.ts) writes what its table shows (#902): no control numbers, and each row's date and parties from the
// checklist's key facts, else the file name (src/scripts/documents-table-company.ts).
import { audit } from './audit.ts';
import { canPerform, LOCAL_HOSTS } from './auth.ts';
import { buildChecklist, checklistEnabled } from './checklist.ts';
import { readMatches, readNotApplicable } from './checklist-store.ts';
import { readCompany } from './company-settings.ts';
import { loadDocFacts } from './doc-facts-serve.ts';
import { MatterError } from './doc-facts.ts';
import type { Env, RequestContext } from './env.ts';
import { buildTree, NOT_HIDDEN_SQL, type CatalogRow, type FolderNode, type ListedDocument } from './files-catalog.ts';
import { attachment } from './files-http.ts';
import { withSecurityHeaders } from './headers.ts';
import { errorJson, isAllowedDocumentRead } from './http.ts';
import type { DocFacts } from './matter-types.ts';
import { canSeeDocument, privilegeFilter } from './privilege.ts';
import { isCompanyRoom } from './room-shape.ts';
import type { Route } from './router.ts';
import { CONTROL_PREFIX_FALLBACK } from '../src/scripts/control-prefix.ts';
import { checklistFacts, keyFacts, type KeyFacts } from '../src/scripts/documents-table-company.ts';
import { designate } from '../src/scripts/documents-table-facts.ts';
import { MARK_LABEL } from '../src/scripts/mark-words.ts';

export const INDEX_CSV_PATH = '/api/documents/index.csv';

export const INDEX_HEADER = ['Control no.', 'Title', 'File name', 'Folder', 'Date', 'Type', MARK_LABEL, 'Key', 'Room link'] as const;

/** A company room's columns: its table hides control numbers and shows parties. */
export const COMPANY_INDEX_HEADER = ['Title', 'File name', 'Folder', 'Date', 'Type', 'Parties', MARK_LABEL, 'Key', 'Room link'] as const;

/**
 * The start of a cell a spreadsheet may read as a formula or a command: = + - @ (OWASP's list) or the full-width = + - @
 * some spreadsheets fold to the same, after any leading whitespace (\s with /u spans no-break and ideographic spaces),
 * and any cell that opens with a tab, carriage return or line feed.
 */
const FORMULA_START = /^\s*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r\n]/u;

/** One CSV field: always quoted, quotes doubled, and a leading formula character defused with an apostrophe. */
export function csvCell(value: string): string {
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

/** One index row, display-ready. */
export interface IndexRow {
  control: string;
  title: string;
  name: string;
  folder: string;
  date: string;
  type: string;
  /** Written only in a company room. */
  parties: string;
  privileged: boolean;
  key: boolean;
  link: string;
}

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

/**
 * The whole file: a UTF-8 byte order mark (so Excel reads accents), the header, then one CRLF line per row. `company`
 * writes a company room's columns (COMPANY_INDEX_HEADER).
 */
export function indexCsv(rows: readonly IndexRow[], company = false): string {
  const lines = company
    ? [COMPANY_INDEX_HEADER, ...rows.map((r) => [r.title, r.name, r.folder, r.date, r.type, r.parties, yesNo(r.privileged), yesNo(r.key), r.link])]
    : [INDEX_HEADER, ...rows.map((r) => [r.control, r.title, r.name, r.folder, r.date, r.type, yesNo(r.privileged), yesNo(r.key), r.link])];
  return `﻿${lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const PREFIX = /^[A-Z]{2,6}$/;

/**
 * The room's control prefix (the CONTROL_PREFIX secret), or null when it is unset or malformed. The room's neutral
 * fallback (src/scripts/control-prefix.ts) is for local development only (the dev identity's own test, auth.ts:
 * ALLOW_DEV_IDENTITY "1" on a localhost host): a production index labelled with it would not match the numbers counsel
 * see in the room, and they file it.
 */
export function exportPrefix(env: Pick<Env, 'CONTROL_PREFIX' | 'ALLOW_DEV_IDENTITY'>, url: URL): string | null {
  const value = env.CONTROL_PREFIX;
  if (value && PREFIX.test(value)) return value;
  return env.ALLOW_DEV_IDENTITY === '1' && LOCAL_HOSTS.has(url.hostname) ? CONTROL_PREFIX_FALLBACK : null;
}

/** "DOE-000412" as the room writes it (src/scripts/doc-facts.ts formatControl); '' before a document is numbered. */
export function formatControl(prefix: string, seq: number | null): string {
  return typeof seq === 'number' && Number.isInteger(seq) && seq > 0 ? `${prefix}-${String(seq).padStart(6, '0')}` : '';
}

/** The document facts by lowercased document id (the server joins ids lowercased); none when no good manifest. */
async function factsById(env: Env): Promise<ReadonlyMap<string, DocFacts>> {
  try {
    const facts = await loadDocFacts(env.FILES, new Date());
    return new Map(Object.entries(facts?.docs ?? {}).map(([id, docFacts]) => [id.toLowerCase(), docFacts]));
  } catch (error) {
    if (!(error instanceof MatterError || error instanceof SyntaxError)) throw error;
    // The table lists documents without facts in this case too; the reason names a field, never matter text.
    console.error('bad_matter', error.name);
    return new Map();
  }
}

/** The documents a member with `role` may see, as /api/documents builds them. */
async function visibleTree(c: RequestContext): Promise<FolderNode> {
  const { results } = await c.env.DB.prepare(
    'SELECT id, path, folder, name, kind, size, pages, updated_at, source, control_seq, key_at, key_by FROM documents ' +
      `WHERE removed_at IS NULL AND ${NOT_HIDDEN_SQL}${privilegeFilter(c.member.role)} ORDER BY path`,
  ).all<CatalogRow>();
  return buildTree(results.filter((row) => canSeeDocument(c.member.role, row.path)));
}

/** Every listed file (folder guides excluded) with the folder it is listed in. */
function listedFiles(node: FolderNode): { file: ListedDocument; folder: string }[] {
  return [...node.files.map((file) => ({ file, folder: node.path })), ...node.folders.flatMap(listedFiles)];
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * The index rows, in control-number order (unnumbered last, then by folder and name), as the table first sorts. A company
 * room passes its checklist's key facts, and each row's date and parties are the table's (keyFacts).
 */
export function indexRows(
  root: FolderNode,
  facts: ReadonlyMap<string, DocFacts>,
  prefix: string,
  origin: string,
  checklist: ReadonlyMap<string, KeyFacts> | null = null,
): IndexRow[] {
  const seq = (file: ListedDocument) => file.control_seq ?? Number.MAX_SAFE_INTEGER;
  return listedFiles(root)
    .sort((a, b) => seq(a.file) - seq(b.file) || collator.compare(`${a.folder}/${a.file.name}`, `${b.folder}/${b.file.name}`))
    .map(({ file, folder }) => {
      const designated = designate(file.name, folder, facts.get(file.id.toLowerCase()), () => '');
      const own = checklist ? keyFacts(file.id, file.name, checklist) : null;
      return {
        control: formatControl(prefix, file.control_seq),
        title: designated.title,
        name: file.name,
        folder,
        date: own ? own.date : designated.date,
        type: designated.type,
        parties: own ? own.parties : '',
        privileged: designated.privileged,
        key: file.key_at !== null,
        link: new URL(`/doc/?id=${encodeURIComponent(file.id)}`, origin).href,
      };
    });
}

/** A company room's key facts by document id, as its table reads them from /api/checklist; none while the checklist is off. */
async function checklistKeyFacts(c: RequestContext): Promise<Map<string, KeyFacts>> {
  if (!checklistEnabled(c.env)) return new Map();
  const [matches, notApplicable, company] = await Promise.all([readMatches(c.env.DB, c.member.role), readNotApplicable(c.env.DB), readCompany(c.env.DB)]);
  // The day moves only the items' statuses, never a match's date or parties.
  return checklistFacts(buildChecklist(company, matches, notApplicable, new Date().toISOString().slice(0, 10)));
}

async function exportIndex(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'download')) return errorJson('forbidden', 403);
  // The export writes an audit row, so another example.com page must not be able to trigger it (like /files).
  if (!isAllowedDocumentRead(c.request)) return errorJson('forbidden', 403);
  // Before any read or audit row: without the room's prefix every control number would be wrong.
  const prefix = exportPrefix(c.env, c.url);
  if (prefix === null) {
    console.error('index_not_configured');
    return errorJson('not_configured', 503);
  }
  const [root, facts, company] = await Promise.all([visibleTree(c), factsById(c.env), isCompanyRoom(c.env)]);
  const checklist = company ? await checklistKeyFacts(c) : null;
  const body = indexCsv(indexRows(root, facts, prefix, c.url.origin, checklist), company);
  await audit(c, 'download', null, 'index-csv');
  const headers = new Headers({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': attachment(`${prefix}-index-${new Date().toISOString().slice(0, 10)}.csv`),
  });
  return withSecurityHeaders(new Response(body, { headers }), 'file');
}

export const routes: Route[] = [{ method: 'GET', path: INDEX_CSV_PATH, handler: exportIndex }];
