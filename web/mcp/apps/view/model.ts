// SPDX-License-Identifier: Apache-2.0
// The views' data, without the DOM: a tool result as the board, the timeline and the grid read it. A standard result's
// structured content is the whole object; a compact one (Copilot) keeps a small copy (mcp/tools/output.ts compactView:
// a row's first cite as `cite`, no `evidence`, no parties). So every field here is optional, and a missing one is left
// out, never guessed. Case text arrives fenced (mcp/untrusted.ts): `shown` takes it out of the fence and keeps the mark.

export type Obj = Record<string, unknown>;

export const isObj = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);

/** A field's text out of its <case-record> fence, and the fence's untrusted mark (null when trusted or unfenced). */
export interface Shown {
  text: string;
  untrusted: string | null;
}

const OPEN = /^<case-record(?: untrusted="([a-z-]+)")?>\n/;
const CLOSE = '\n</case-record>';

export function shown(value: unknown): Shown | null {
  if (typeof value === 'number') return { text: String(value), untrusted: null };
  if (typeof value !== 'string' || value === '') return null;
  const open = OPEN.exec(value);
  if (open && value.endsWith(CLOSE) && value.length >= open[0].length + CLOSE.length) {
    return { text: value.slice(open[0].length, -CLOSE.length), untrusted: open[1] ?? null };
  }
  return { text: value, untrusted: null };
}

/** The plain text of a field, '' when it has none. */
export const plain = (value: unknown): string => shown(value)?.text ?? '';

/** The object a tool result holds: its structured content, or, for a client sent text only, the JSON in its text. */
export function resultData(result: unknown): Obj | null {
  if (!isObj(result) || result.isError === true) return null;
  if (isObj(result.structuredContent)) return result.structuredContent;
  const block = Array.isArray(result.content) ? result.content.find((part) => isObj(part) && part.type === 'text') : undefined;
  if (!isObj(block) || typeof block.text !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(block.text);
    return isObj(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A failed result's hint (format.ts toolError: "code: hint"), or null for a result that did not fail. */
export function resultError(result: unknown): string | null {
  if (!isObj(result) || result.isError !== true) return null;
  const block = Array.isArray(result.content) ? result.content.find((part) => isObj(part) && part.type === 'text') : undefined;
  const text = isObj(block) && typeof block.text === 'string' ? block.text : '';
  return text.replace(/^[a-z_]+: /, '') || 'The tool failed.';
}

/** One cite: what it is called (control number and page), the document it opens and the room link. */
export interface Cite {
  control: string | null;
  page: number | null;
  doc: string | null;
  link: string | null;
}

/** The document id and page a room link names (format.ts docLink: /doc/?id=<id>#page=<n>). */
export function linkTarget(link: unknown): { doc: string | null; page: number | null } {
  if (typeof link !== 'string') return { doc: null, page: null };
  try {
    const url = new URL(link);
    const page = Number(/^#page=(\d+)$/.exec(url.hash)?.[1]);
    return { doc: url.pathname.endsWith('/doc/') ? url.searchParams.get('id') : null, page: page > 0 ? page : null };
  } catch {
    return { doc: null, page: null };
  }
}

function citeOf(value: unknown, docFallback: string | null = null): Cite | null {
  if (!isObj(value)) return null;
  const target = linkTarget(value.link);
  const doc = typeof value.doc === 'string' ? value.doc : target.doc ?? docFallback;
  const page = typeof value.page === 'number' && value.page > 0 ? value.page : target.page;
  const control = typeof value.control === 'string' ? value.control : null;
  const link = typeof value.link === 'string' ? value.link : null;
  return control || doc || link ? { control, page, doc, link } : null;
}

/**
 * Every cite a row carries: its `cites` (standard), its one `cite` (compact), a proof item's or exhibit's `cite`, and,
 * for a document row (one with a control number of its own), the row itself.
 */
export function citesOf(row: Obj): Cite[] {
  const out: Cite[] = [];
  const add = (cite: Cite | null) => {
    if (cite && !out.some((c) => c.control === cite.control && c.page === cite.page && c.doc === cite.doc)) out.push(cite);
  };
  if (Array.isArray(row.cites)) row.cites.forEach((c) => add(citeOf(c)));
  add(citeOf(row.cite));
  if (typeof row.control === 'string') add(citeOf({ ...row, doc: typeof row.id === 'string' ? row.id : null, page: null }));
  return out;
}

/** A cite's label: "DOE-000012 p. 4", or the page alone when the document has no number yet. */
export function citeLabel(cite: Cite): string {
  const page = cite.page ? `p. ${cite.page}` : '';
  return [cite.control ?? (page ? '' : 'Source'), page].filter(Boolean).join(' ');
}

/** A cite as the binder's bridge names it (src/scripts/visual-cite.ts): "DOE-000012@4", or null without a number. */
export function binderRef(cite: Cite): string | null {
  if (!cite.control || !/^[A-Z]{2,6}-\d{6}$/.test(cite.control)) return null;
  return cite.page ? `${cite.control}@${cite.page}` : cite.control;
}

/** Rows of a list that share an id (an entry too long for a page comes in parts): one row each, cites joined. */
export function joinParts(rows: readonly unknown[]): Obj[] {
  const byId = new Map<string, Obj>();
  const out: Obj[] = [];
  for (const row of rows) {
    if (!isObj(row)) continue;
    const id = typeof row.id === 'string' ? row.id : null;
    const first = id ? byId.get(id) : undefined;
    if (!first) {
      out.push(row);
      if (id) byId.set(id, row);
      continue;
    }
    const cites = [...(Array.isArray(first.cites) ? first.cites : []), ...(Array.isArray(row.cites) ? row.cites : [])];
    if (cites.length) first.cites = cites;
  }
  return out;
}

// Board ---------------------------------------------------------------------------------------------------------

/** A due date: the day and its state (worker/checklist.ts DateState). */
export interface Due {
  date: string;
  state: string | null;
}

export interface Card {
  id: string;
  title: Shown;
  /** Short facts under the title: stage, forum, period, kind. */
  meta: string[];
  /** What happens next: an open checklist item's evidence, a track's theory line. */
  next: Shown | null;
  due: Due | null;
  cites: Cite[];
  link: string | null;
  untrusted: boolean;
}

export interface Column {
  key: string;
  label: string;
  cards: Card[];
}

/** The checklist's statuses (worker/checklist.ts ChecklistStatus), most urgent first. */
export const STATUS_ORDER = ['missing', 'check', 'not_yet', 'if_applies', 'in_place', 'not_applicable'] as const;
const WORDS: Readonly<Record<string, string>> = {
  missing: 'Missing', check: 'Check', not_yet: 'Not yet', if_applies: 'If it applies', in_place: 'In place', not_applicable: 'Not applicable',
};

/** A key as words: "not_yet" to "Not yet". */
export function words(key: string): string {
  const known = WORDS[key];
  if (known) return known;
  const spaced = key.replace(/[_-]+/g, ' ').trim();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : 'Other';
}

/** The field a section's board groups by: the first of these any row has. */
const GROUP_KEYS = ['status', 'kind', 'type', 'side', 'role', 'mark'] as const;
/** Due states still to act on (worker/checklist.ts DateState), most urgent first. */
const OPEN_STATES = ['late', 'passed', 'check', 'soon', 'upcoming'];

/** The next date to act on: the earliest not done, the most urgent state first on the same day. */
export function nextDue(value: unknown): Due | null {
  if (!Array.isArray(value)) return null;
  const open = value
    .filter(isObj)
    .filter((d) => typeof d.date === 'string' && d.state !== 'done')
    .map((d) => ({ date: d.date as string, state: typeof d.state === 'string' ? d.state : null }))
    .sort((a, b) => a.date.localeCompare(b.date) || OPEN_STATES.indexOf(a.state ?? '') - OPEN_STATES.indexOf(b.state ?? ''));
  return open[0] ?? null;
}

function cardOf(row: Obj): Card {
  const brief = isObj(row.brief) ? row.brief : null;
  const title = shown(row.title) ?? shown(row.name) ?? shown(row.label) ?? shown(row.term) ?? { text: String(row.id ?? 'Untitled'), untrusted: null };
  const period = isObj(row.period) && typeof row.period.from === 'string' ? `${row.period.from} to ${typeof row.period.to === 'string' ? row.period.to : 'now'}` : '';
  const meta = [plain(row.stage) && words(plain(row.stage)), plain(row.forum), period, plain(row.date)].filter((m): m is string => !!m);
  const dated = brief && Array.isArray(brief.dates) ? brief.dates.filter(isObj).map((d) => ({ ...d, state: null })) : [];
  const exhibits = brief && Array.isArray(brief.exhibits) ? brief.exhibits.filter(isObj).map((x) => x.cite) : [];
  const cites = citesOf({ ...row, cites: [...(Array.isArray(row.cites) ? row.cites : []), ...exhibits] });
  return {
    id: String(row.id ?? title.text),
    title,
    meta,
    next: shown(row.evidence) ?? shown(brief?.line) ?? shown(row.summary),
    due: nextDue(row.due) ?? nextDue(dated),
    cites,
    link: typeof row.link === 'string' ? row.link : null,
    untrusted: !!row.untrusted || !!title.untrusted,
  };
}

/** A section's entries as board columns: grouped by status (checklist), kind (tracks) or the like, in a fixed order. */
export function board(entries: readonly unknown[]): Column[] {
  const rows = joinParts(entries);
  const key = GROUP_KEYS.find((k) => rows.some((row) => typeof row[k] === 'string')) ?? null;
  const columns = new Map<string, Column>();
  for (const row of rows) {
    const group = key && typeof row[key] === 'string' ? (row[key] as string) : 'all';
    if (!columns.has(group)) columns.set(group, { key: group, label: group === 'all' ? 'All' : words(group), cards: [] });
    columns.get(group)!.cards.push(cardOf(row));
  }
  const rank = (k: string) => {
    const i = (STATUS_ORDER as readonly string[]).indexOf(k);
    return key === 'status' && i >= 0 ? i : STATUS_ORDER.length;
  };
  return [...columns.values()].sort((a, b) => rank(a.key) - rank(b.key));
}

// Timeline ------------------------------------------------------------------------------------------------------

/** The event types the room's timeline draws (worker/matter-types.ts EVENT_TYPES). */
export const EVENT_TYPES = ['filing', 'service', 'pleading', 'discovery', 'meeting', 'communication', 'milestone', 'order', 'custom'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** One dated row, as the room's timeline (src/scripts/viz/timeline.ts) takes an event, plus its cites. */
export interface Dated {
  id: string;
  date: string;
  title: string;
  summary: string | null;
  type: EventType;
  untrusted: boolean;
  cites: Cite[];
}

const PARTIAL_DATE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;

/** Sections whose rows carry a date: the chronology, money facts and dated documents. */
export const DATED_SECTIONS: ReadonlySet<string> = new Set(['events', 'money', 'docs']);

/** A section's dated rows as timeline events. Money reads as a milestone with its amount; a document as a communication. */
export function datedRows(section: string, entries: readonly unknown[]): Dated[] {
  const fallback: EventType = section === 'money' ? 'milestone' : section === 'docs' ? 'communication' : 'custom';
  return joinParts(entries)
    .filter((row) => typeof row.date === 'string' && PARTIAL_DATE.test(row.date))
    .map((row) => {
      const title = shown(row.title) ?? shown(row.label) ?? shown(row.name) ?? { text: String(row.id ?? ''), untrusted: null };
      const amount = typeof row.amount === 'string' ? `${row.amount} · ` : '';
      const type = (EVENT_TYPES as readonly string[]).includes(row.type as string) ? (row.type as EventType) : fallback;
      return {
        id: String(row.id ?? `${row.date}-${title.text}`),
        date: row.date as string,
        title: amount + title.text,
        summary: shown(row.summary)?.text ?? null,
        type,
        untrusted: !!row.untrusted || !!title.untrusted,
        cites: citesOf(row),
      };
    });
}

// Grid ----------------------------------------------------------------------------------------------------------

export type CellKind = 'cite' | 'text' | 'date' | 'number' | 'flag' | 'list';

export interface GridColumn {
  key: string;
  label: string;
  kind: CellKind;
}

/** legallas_list_documents' fields, in the order a review grid reads them (mcp/tools/documents.ts documentFields). */
export const GRID_COLUMNS: readonly GridColumn[] = [
  { key: 'control', label: 'Control', kind: 'cite' },
  { key: 'title', label: 'Document', kind: 'text' },
  { key: 'date', label: 'Date', kind: 'date' },
  { key: 'doc_type', label: 'Type', kind: 'text' },
  { key: 'from', label: 'From', kind: 'list' },
  { key: 'to', label: 'To', kind: 'list' },
  { key: 'folder', label: 'Folder', kind: 'text' },
  { key: 'pages', label: 'Pages', kind: 'number' },
  { key: 'key', label: 'Key', kind: 'flag' },
  { key: 'privileged', label: 'Privileged', kind: 'flag' },
  { key: 'updated', label: 'Changed', kind: 'date' },
];

const hasValue = (value: unknown): boolean => (Array.isArray(value) ? value.length > 0 : value === true || (value !== false && value !== null && value !== undefined && value !== ''));

/** The columns at least one row fills: a compact result keeps fewer fields, so its grid is narrower. */
export function gridColumns(rows: readonly Obj[]): GridColumn[] {
  return GRID_COLUMNS.filter((col) => col.kind === 'cite' || col.key === 'title' || rows.some((row) => hasValue(row[col.key])));
}

/** A cell's text. */
export function cellText(row: Obj, col: GridColumn): string {
  const value = row[col.key];
  if (col.kind === 'flag') return value === true ? 'Yes' : '';
  if (col.kind === 'list') return Array.isArray(value) ? value.map(plain).filter(Boolean).join('; ') : plain(value);
  if (col.kind === 'cite') return typeof value === 'string' ? value : '';
  return plain(value);
}

/** Rows sorted on a column, blanks last, numbers by value, the rest as text (dates and control numbers sort as text). */
export function sortRows(rows: readonly Obj[], col: GridColumn, dir: 1 | -1): Obj[] {
  const key = (row: Obj): string | number | null => {
    if (col.kind === 'number') return typeof row[col.key] === 'number' ? (row[col.key] as number) : null;
    if (col.kind === 'flag') return row[col.key] === true ? 0 : null;
    const text = cellText(row, col);
    return text === '' ? null : text.toLowerCase();
  };
  return rows
    .map((row, index) => ({ row, index, k: key(row) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? a.index - b.index : a.k === null ? 1 : -1;
      const order = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : String(a.k).localeCompare(String(b.k));
      return order * dir || a.index - b.index;
    })
    .map(({ row }) => row);
}

/** Rows any of whose cells hold every word of `query`, case-insensitive. */
export function filterRows(rows: readonly Obj[], columns: readonly GridColumn[], query: string): Obj[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...rows];
  return rows.filter((row) => {
    const text = columns.map((col) => cellText(row, col)).join(' ').toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
