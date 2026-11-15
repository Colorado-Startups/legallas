// SPDX-License-Identifier: Apache-2.0
// The checks scripts/kit-run.ts applies to every tool result a kit gets (mcp/tools/output.ts shapes): each cited row
// carries a control number and a room link, each page link opens its page, each law row carries its citation, source
// and retrieved date, and a guest sees no privileged document. Pure, so its test needs no server.
import { normalizeCitation, unitIdFor } from '../worker/law-cite.ts';

/** Counts over one or more tool results. */
export interface CiteTally {
  /** Rows naming a document (an `id` with a `control` field). */
  cited: number;
  /** Cited rows whose control is null or empty. */
  noControl: number;
  /** Cited rows whose control is not `<prefix>-NNNNNN`. */
  badControl: number;
  /** Cited rows with no room link. */
  noLink: number;
  /** Rows with a page number and a link. */
  pageLinks: number;
  /** Page links that do not end `#page=<page>`. */
  badPageLinks: number;
  /** Law rows (a `citation` field). */
  lawRows: number;
  /** Law rows missing source_url or retrieved. */
  badLawRows: number;
  /** Privileged document ids seen, marked privileged or named by id. */
  privileged: string[];
}

export function emptyTally(): CiteTally {
  return { cited: 0, noControl: 0, badControl: 0, noLink: 0, pageLinks: 0, badPageLinks: 0, lawRows: 0, badLawRows: 0, privileged: [] };
}

export function addTally(into: CiteTally, from: CiteTally): CiteTally {
  for (const key of Object.keys(into) as (keyof CiteTally)[]) {
    if (key === 'privileged') into.privileged = [...new Set([...into.privileged, ...from.privileged])];
    else into[key] += from[key];
  }
  return into;
}

const MAX_DEPTH = 12;

/** Walks one tool result and counts what its rows cite. */
export function tallyCites(value: unknown, prefix: string, privilegedIds: ReadonlySet<string>): CiteTally {
  const tally = emptyTally();
  const control = new RegExp(`^${prefix}-\\d{6}$`);
  const seen = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || node === null) return;
    if (typeof node === 'string') {
      for (const id of privilegedIds) if (node.includes(id)) seen.add(id);
      return;
    }
    if (typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const row = node as Record<string, unknown>;
    if (typeof row.id === 'string' && 'control' in row) {
      tally.cited++;
      if (typeof row.control !== 'string' || row.control === '') tally.noControl++;
      else if (!control.test(row.control)) tally.badControl++;
      if (typeof row.link !== 'string' || row.link === '') tally.noLink++;
      if (row.privileged === true) seen.add(row.id);
    }
    if (typeof row.page === 'number' && typeof row.link === 'string') {
      tally.pageLinks++;
      if (!row.link.endsWith(`#page=${row.page}`)) tally.badPageLinks++;
    }
    if (typeof row.citation === 'string') {
      tally.lawRows++;
      if (typeof row.source_url !== 'string' || typeof row.retrieved !== 'string') tally.badLawRows++;
    }
    for (const child of Object.values(row)) walk(child, depth + 1);
  };
  walk(value, 0);
  tally.privileged = [...seen];
  return tally;
}

/** What a tally fails on, as short labels; empty when it passes. A guest must see no privileged row. */
export function tallyFailures(tally: CiteTally, guest: boolean): string[] {
  const out: string[] = [];
  if (tally.noControl > 0) out.push(`${tally.noControl} cited row(s) without a control number`);
  if (tally.badControl > 0) out.push(`${tally.badControl} control number(s) in the wrong form`);
  if (tally.noLink > 0) out.push(`${tally.noLink} cited row(s) without a room link`);
  if (tally.badPageLinks > 0) out.push(`${tally.badPageLinks} page link(s) that miss their page`);
  if (tally.badLawRows > 0) out.push(`${tally.badLawRows} law row(s) without source or retrieved date`);
  if (guest && tally.privileged.length > 0) out.push(`guest saw ${tally.privileged.length} privileged document(s)`);
  return out;
}

/** worker/burst.ts, mirrored (it declares Workers types): seconds a burst-limited caller waits. */
export const BURST_RETRY_AFTER_SECONDS = 60;

/** mcp/prompts.ts, mirrored (it imports Workers types): the date `days` before `now`, YYYY-MM-DD (UTC). */
export function daysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** The case fixture's privileged work product by path: matter.example.json marks it, doc-ids.json names its path. */
export function privilegedPaths(docIds: Readonly<Record<string, string>>, matter: { docs: Readonly<Record<string, { privileged?: unknown }>> }): string[] {
  return Object.entries(docIds)
    .filter(([, id]) => matter.docs[id]?.privileged === true)
    .map(([rel]) => rel)
    .sort();
}

/** What the guest got from the room's own API: each list's status, the documents it listed, and each privileged id's routes. */
export interface RoomApiResult {
  rooms_status: number;
  documents_status: number;
  /** Documents in the guest's list; null when the body was not that JSON. */
  documents: number | null;
  /** One row per privileged id: `/api/rooms/:room/files/:id` and `/rooms/:room/view/:id`. */
  direct: { id: string; file: number; viewer: number }[];
  /** Privileged ids the list named or a route opened. */
  privileged: string[];
}

/**
 * What the guest's room-API check fails on; empty when it passes. A list that did not load, or loaded empty, checked
 * nothing, so it fails too. Each privileged route must answer exactly 404: a 401 or 500 says the guest was never served.
 */
export function roomApiFailures(room: RoomApiResult): string[] {
  const out: string[] = [];
  if (room.rooms_status !== 200) out.push(`rooms list answered ${room.rooms_status}`);
  if (room.documents_status !== 200) out.push(`documents list answered ${room.documents_status}`);
  if (!room.documents) out.push(`documents list held ${room.documents ?? 'no JSON'}`);
  for (const row of room.direct) {
    if (row.file !== 404 || row.viewer !== 404) out.push(`privileged ${row.id}: file ${row.file}, view ${row.viewer}, not 404`);
  }
  if (room.privileged.length > 0) out.push(`guest listed or opened ${room.privileged.length} privileged document(s)`);
  return out;
}

/** The citations in a kit reference's "Where to look" column (entity-matrix.md's Factors), split on ";". */
export function factorCitations(markdown: string): string[] {
  const start = markdown.indexOf('## Factors');
  if (start < 0) return [];
  const rows = markdown.slice(start).split('\n').slice(1);
  const cites: string[] = [];
  for (const line of rows) {
    if (line.startsWith('## ')) break;
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 4 || cells[1] === 'Factor' || /^-+$/.test(cells[1])) continue;
    for (const part of cells[2].split(';')) {
      const cite = part.replace(/\(.*?\)/g, '').trim();
      if (/\d/.test(cite)) cites.push(cite);
    }
  }
  return [...new Set(cites)];
}

/** The law library unit a citation names (C.R.S. 7-90-501 and C.R.S. § 7-90-501(1) name the same one), or null. */
function citedUnit(cite: unknown): string | null {
  const normal = typeof cite === 'string' ? normalizeCitation(cite) : null;
  return normal ? unitIdFor(normal) : null;
}

/** True when some law row is the statute `cite` names and carries the date its text was fetched (YYYY-MM-DD). */
export function datedLawRow(cite: string, results: readonly Readonly<Record<string, unknown>>[]): boolean {
  const unit = citedUnit(cite);
  return unit !== null && results.some((row) => citedUnit(row.citation) === unit && typeof row.retrieved === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.retrieved));
}
