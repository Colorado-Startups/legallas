// SPDX-License-Identifier: Apache-2.0
// The Documents table's data (card P5a): the /api/documents tree flattened into rows, joined with the matter's
// document facts (/api/matter docs), the open discussions (/api/comments?open=1) and the member's last visit
// (POST /api/seen), plus the data-room index, filtering, facet counts and sorting. Pure functions only;
// documents-table.ts draws them. A row's designations are documents-table-facts.ts's, shared with the CSV index. With no
// matter, a row's date and parties are documents-table-company.ts's: the checklist's key facts, else the file name.
import { documentMonth } from './documents-intake-dates.ts';
import { keyFacts, type KeyFacts } from './documents-table-company.ts';
import { designate, privilegedFolder } from './documents-table-facts.ts';
import type { FolderNode, ListedDocument } from './files-api.ts';
import { foldForSearch, matchesQuery, typeLabel } from './files-format.ts';
import { formatControl, type ServedDocFacts, type ServedMatter } from './doc-facts.ts';

/** A listed document, with its control number and Key fields (card F3). */
export type ListedRow = ListedDocument;

/** /api/documents as this page reads it. */
export interface ListedTree extends Omit<FolderNode, 'files' | 'folders' | 'guide'> {
  guide: ListedRow | null;
  files: ListedRow[];
  folders: ListedTree[];
}

/** One row of the table. Every string is display-ready; '' means blank. */
export interface DocRow {
  id: string;
  name: string;
  /** The folder it is listed in (counsel uploads share COUNSEL_FOLDER). */
  folder: string;
  seq: number | null;
  control: string;
  /** Partial ISO date from the matter's facts (with no matter: the checklist's, else the file name's), or ''. Never the sync time. */
  date: string;
  /** "YYYY-MM" by the heatmap's rule (card P5b): the matter date, else when the room last saw the file. */
  month: string | null;
  type: string;
  /** "Tally Payroll → Copperline", one side only, or ''. With no matter: the checklist's parties, else the file name's. */
  parties: string;
  pages: number | null;
  privileged: boolean;
  key: boolean;
  /** The matter's one-line summary, or the file name when there is none. */
  summary: string;
  discussion: boolean;
  counsel: boolean;
  /** When the room last saw the file change (documents.updated_at): what New is measured on. */
  updated: string;
  /** Added or changed since the member's last visit (the Overview's "Since your last visit"). */
  fresh: boolean;
  haystack: string;
}

/** A folder in the data-room index: "04" at the top, "04.2" below it. For browsing only, never cited. */
export interface IndexFolder {
  path: string;
  number: string;
  label: string;
  /** Documents in this folder and below (folder guides excluded). */
  count: number;
  guide: ListedRow | null;
  children: IndexFolder[];
}

/** Where counsel uploads are listed (worker/files-catalog.ts COUNSEL_FOLDER). */
export const COUNSEL_FOLDER = 'from-counsel';
const TOP_PREFIX = /^(\d{2})[-_. ]+(.+)$/;

/** The folder reading lives with the designations now; kept here under its old import path. */
export { privilegedFolder };

/** Changed after the cutoff; never with no cutoff (the visit is unknown). ISO instants compare as strings. */
function isFresh(updatedAt: string, since: string | null): boolean {
  return since !== null && updatedAt > since;
}

function topLabel(node: ListedTree): { number: string; label: string } {
  if (node.path === COUNSEL_FOLDER) return { number: '', label: 'From counsel' };
  const match = TOP_PREFIX.exec(node.name);
  if (!match) return { number: '', label: node.name };
  return { number: match[1]!, label: match[2]!.replace(/[-_]+/g, ' ') };
}

function indexFolder(node: ListedTree, number: string, label: string): IndexFolder {
  const children = node.folders.map((child, i) => indexFolder(child, number ? `${number}.${i + 1}` : '', child.name));
  const count = node.files.length + children.reduce((sum, child) => sum + child.count, 0);
  return { path: node.path, number, label, count, guide: node.guide, children };
}

/** The index from the folder order: top folders keep their 00 to 09 prefixes; subfolders are .1, .2 in name order. */
export function buildIndex(root: ListedTree): IndexFolder[] {
  const top = root.folders.map((node) => {
    const { number, label } = topLabel(node);
    return indexFolder(node, number, label);
  });
  // Numbered folders first, in their own order; then the rest (counsel uploads last).
  const rank = (f: IndexFolder) => (f.number ? 0 : f.path === COUNSEL_FOLDER ? 2 : 1);
  return top.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map(({ f }) => f);
}

/** Every folder in the index, depth first, with its depth (0 at the top). */
export function flattenIndex(index: readonly IndexFolder[], depth = 0): { folder: IndexFolder; depth: number }[] {
  return index.flatMap((folder) => [{ folder, depth }, ...flattenIndex(folder.children, depth + 1)]);
}

/** Finds a folder in the index by its path, or returns null. */
export function findFolder(index: readonly IndexFolder[], path: string): IndexFolder | null {
  return flattenIndex(index).find((entry) => entry.folder.path === path)?.folder ?? null;
}

/** Party ids to display names, from the matter's people and orgs. */
export function partyNames(matter: ServedMatter | null): Map<string, string> {
  return new Map([...(matter?.people ?? []), ...(matter?.orgs ?? [])].map((p) => [p.id, p.name]));
}

function partiesLine(facts: ServedDocFacts | undefined, names: ReadonlyMap<string, string>): string {
  if (!facts) return '';
  const side = (ids: readonly string[]) => ids.map((id) => names.get(id) ?? '').filter(Boolean).join(', ');
  const from = side(facts.from);
  const to = side(facts.to);
  return from && to ? `${from} → ${to}` : from || to;
}

/** The inputs that are joined into the documents table rows: the listed tree, the matter and the open comments. */
export interface JoinInput {
  root: ListedTree;
  matter: ServedMatter | null;
  /** Document ids with at least one open (unresolved) comment. */
  discussed: ReadonlySet<string>;
  prefix: string;
  /** The instant "new" is measured from (overview-news-visit.ts newsCutoff), or null when no visit is known. */
  since?: string | null;
  /** The checklist's key facts by document id (documents-table-company.ts checklistFacts), read only with no matter. */
  checklist?: ReadonlyMap<string, KeyFacts>;
}

function toRow(file: ListedRow, folder: string, input: JoinInput, names: ReadonlyMap<string, string>): DocRow {
  const facts = input.matter?.docs[file.id];
  const seq = file.control_seq ?? facts?.control ?? null;
  const designated = designate(file.name, folder, facts, typeLabel);
  // No matter (a company room, or a case room before its first build): nothing else knows a date or a party.
  const own = input.matter ? null : keyFacts(file.id, file.name, input.checklist ?? new Map());
  const row: DocRow = {
    id: file.id,
    name: file.name,
    folder,
    seq,
    control: formatControl(input.prefix, seq),
    date: own ? own.date : designated.date,
    month: documentMonth(facts, file.updated_at),
    type: designated.type,
    parties: own ? own.parties : partiesLine(facts, names),
    pages: file.pages,
    privileged: designated.privileged,
    key: Boolean(file.key_at),
    summary: facts?.summary || designated.title,
    discussion: input.discussed.has(file.id),
    counsel: file.source === 'counsel',
    updated: file.updated_at,
    fresh: isFresh(file.updated_at, input.since ?? null),
    haystack: '',
  };
  row.haystack = foldForSearch([row.control, row.name, folder, row.date, row.type, row.parties, row.summary].join(' '));
  return row;
}

/** Marks the rows New for another cutoff (the room's visit, once it answers); returns the rows that changed. */
export function remarkFresh(rows: readonly DocRow[], since: string | null): DocRow[] {
  const changed = rows.filter((row) => isFresh(row.updated, since) !== row.fresh);
  for (const row of changed) row.fresh = !row.fresh;
  return changed;
}

/** One row per listed document (folder guides stay guides), joined with its facts. */
export function joinRows(input: JoinInput): DocRow[] {
  const names = partyNames(input.matter);
  const rows: DocRow[] = [];
  const walk = (node: ListedTree) => {
    for (const file of node.files) rows.push(toRow(file, node.path, input, names));
    node.folders.forEach(walk);
  };
  walk(input.root);
  return rows;
}

/** The facet groups the documents table can filter by: type, privilege and marks. */
export type FacetGroup = 'type' | 'privilege' | 'marks';
/** The privilege values a document can have in the table filter. */
export type PrivilegeValue = 'none' | 'privileged';
/** The marks a document can carry in the table filter. */
export type MarkValue = 'key' | 'discussion' | 'new';

/** The documents table's filter: folder, search query, types, privilege, marks, month and counsel. */
export interface TableFilter {
  folder: string;
  query: string;
  types: ReadonlySet<string>;
  privilege: ReadonlySet<PrivilegeValue>;
  marks: ReadonlySet<MarkValue>;
  /** "2013-02" from the intake heatmap (card P5b), or null. */
  month: string | null;
  /** Counsel uploads only (the intake's From counsel filter). */
  counsel: boolean;
}

const MARKS: readonly MarkValue[] = ['key', 'discussion', 'new'];

/** Whether a row carries a Marked box's mark. */
export function hasMark(row: Pick<DocRow, 'key' | 'discussion' | 'fresh'>, mark: MarkValue): boolean {
  return mark === 'key' ? row.key : mark === 'discussion' ? row.discussion : row.fresh;
}

/**
 * The Marked boxes a link presets (R60): `?mark=key`, `?mark=discussion`, `?mark=new`, or several
 * (`?mark=key&mark=discussion`). Anything else is ignored, so a stale or hand-typed link still opens the full table.
 */
export function marksFromSearch(search: string): Set<MarkValue> {
  const asked = new URLSearchParams(search).getAll('mark');
  return new Set(MARKS.filter((mark) => asked.includes(mark)));
}

/** The Documents link that opens the table with one Marked box checked. */
export function markedHref(mark: MarkValue): string {
  return `/documents/?mark=${mark}`;
}

/** Builds a filter that matches every document, optionally inside one folder. */
export function emptyFilter(folder = ''): TableFilter {
  return { folder, query: '', types: new Set(), privilege: new Set(), marks: new Set(), month: null, counsel: false };
}

/** Whether a row is in the folder or one of its subfolders; an empty folder matches every row. */
export function inFolder(row: Pick<DocRow, 'folder'>, folder: string): boolean {
  return !folder || row.folder === folder || row.folder.startsWith(`${folder}/`);
}

function inGroup(row: DocRow, filter: TableFilter, group: FacetGroup): boolean {
  if (group === 'type') return filter.types.size === 0 || filter.types.has(row.type);
  if (group === 'privilege') return filter.privilege.size === 0 || filter.privilege.has(row.privileged ? 'privileged' : 'none');
  // Marks narrow: a row must carry every checked mark.
  return [...filter.marks].every((mark) => hasMark(row, mark));
}

/** The rows outside the facets: folder, words, month and counsel. */
function inScope(row: DocRow, filter: TableFilter): boolean {
  return (
    inFolder(row, filter.folder) &&
    (!filter.query || matchesQuery(row.haystack, filter.query)) &&
    (!filter.month || row.month === filter.month) &&
    (!filter.counsel || row.counsel)
  );
}

const GROUPS: readonly FacetGroup[] = ['type', 'privilege', 'marks'];

/** Keeps the rows that pass the filter's scope and every facet group. */
export function filterRows(rows: readonly DocRow[], filter: TableFilter): DocRow[] {
  return rows.filter((row) => inScope(row, filter) && GROUPS.every((group) => inGroup(row, filter, group)));
}

/** How many rows each facet value matches, by facet group. */
export interface FacetCounts {
  type: Map<string, number>;
  privilege: Map<PrivilegeValue, number>;
  marks: Map<MarkValue, number>;
}

/** Each group's counts apply every other filter, so a box shows what checking it would add. */
export function facetCounts(rows: readonly DocRow[], filter: TableFilter): FacetCounts {
  const counts: FacetCounts = { type: new Map(), privilege: new Map(), marks: new Map() };
  const bump = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const row of rows) {
    if (!inScope(row, filter)) continue;
    const others = (group: FacetGroup) => GROUPS.every((g) => g === group || inGroup(row, filter, g));
    if (others('type')) bump(counts.type, row.type);
    if (others('privilege')) bump(counts.privilege, row.privileged ? 'privileged' : 'none');
    if (others('marks')) for (const mark of MARKS) if (hasMark(row, mark)) bump(counts.marks, mark);
  }
  return counts;
}

/** The columns the documents table can sort by. */
export type SortKey = 'control' | 'date' | 'type' | 'parties' | 'pages' | 'privilege' | 'key' | 'summary';
/** The direction a column sorts in. */
export type SortDir = 'ascending' | 'descending';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** The sort value, or null for a blank cell (blanks always sort last). */
function sortValue(row: DocRow, key: SortKey): string | number | null {
  switch (key) {
    case 'control':
      return row.seq;
    case 'pages':
      return row.pages;
    case 'privilege':
      return row.privileged ? 0 : 1;
    case 'key':
      return row.key ? 0 : 1;
    default:
      return row[key] || null;
  }
}

function compareValues(a: string | number, b: string | number): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b));
}

/** Returns a sorted copy of the rows by key and direction, with ties broken by sequence and then name. */
export function sortRows(rows: readonly DocRow[], key: SortKey, dir: SortDir): DocRow[] {
  const sign = dir === 'ascending' ? 1 : -1;
  const tie = (a: DocRow, b: DocRow) => (a.seq ?? Infinity) - (b.seq ?? Infinity) || collator.compare(a.name, b.name);
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null || vb === null) return va === vb ? tie(a, b) : va === null ? 1 : -1;
    return sign * compareValues(va, vb) || tie(a, b);
  });
}

const SORT_KEYS: readonly SortKey[] = ['control', 'date', 'type', 'parties', 'pages', 'privilege', 'key', 'summary'];

/** The sort a link presets (R85): `?sort=control` ascending, `?sort=-control` descending. Unknown keys are ignored. */
export function sortFromSearch(search: string): { key: SortKey; dir: SortDir } | null {
  const raw = new URLSearchParams(search).get('sort') ?? '';
  const key = raw.replace(/^-/, '') as SortKey;
  return SORT_KEYS.includes(key) ? { key, dir: raw.startsWith('-') ? 'descending' : 'ascending' } : null;
}

/** Documents newest first: control numbers are given in the order files arrive (R85). */
export const NEWEST_FIRST_HREF = '/documents/?sort=-control';
