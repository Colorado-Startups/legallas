// SPDX-License-Identifier: Apache-2.0
// The Documents table with no matter: a founder's company, no dispute (worker/room-shape.ts). With no matter facts to
// read, a row's date and parties come from the checklist's key facts (worker/checklist.ts, entered on a match), else from
// the file name. A company room drops the case room's columns and any column with nothing in it. Pure: documents-table.ts
// draws it, and a room with a matter never reaches it.
import type { ServedMatch } from '../../worker/checklist.ts';
import { EXTENSION, WORK_PRODUCT } from './doc-titles.ts';

/** A row's date (YYYY-MM-DD) and parties, each '' when the room knows neither. */
export interface KeyFacts {
  date: string;
  parties: string;
}

/** The checklist's served items, as far as this file reads them. */
export interface ChecklistDocs {
  items: readonly { matches: readonly Pick<ServedMatch, 'documentId' | 'href' | 'date' | 'parties'>[] }[];
}

/** The convention's date segment: YYYYMMDD, or a range that dates the file by its last day (scripts/matter/catalog.ts). */
const DAY_SEGMENT = /^(\d{4})(\d{2})(\d{2})(?:-(\d{4})(\d{2})(\d{2}))?$/;
/** A day anywhere in a name outside the convention: 2011-06-09 or 20110609, not inside a longer number. */
const DAY_IN_TEXT = /(?<!\d)(?:(\d{4})-(\d{2})-(\d{2})|(\d{4})(\d{2})(\d{2}))(?!\d)/g;

/** `YYYY-MM-DD` when it is a real calendar day from 1900 to 2099, else ''. */
function realDay(year: string, month: string, day: string): string {
  const text = `${year}-${month}-${day}`;
  const date = new Date(`${text}T00:00:00Z`);
  return /^(19|20)\d{2}$/.test(year) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : '';
}

const segmentsOf = (name: string) => name.replace(EXTENSION, '').split('__').filter(Boolean);

/**
 * The date a file name carries. The convention DocType__YYYYMMDD__Party first, as the matter build reads it; else the first
 * real day written in the name ("Bylaws 2011-06-09.pdf"). '' when it has none.
 */
export function nameDate(name: string): string {
  for (const segment of segmentsOf(name).slice(1)) {
    const match = DAY_SEGMENT.exec(segment);
    if (!match) continue;
    const start = realDay(match[1]!, match[2]!, match[3]!);
    const end = match[4] ? realDay(match[4], match[5]!, match[6]!) : start;
    if (start && end) return end;
  }
  for (const match of name.matchAll(DAY_IN_TEXT)) {
    const day = match[1] ? realDay(match[1], match[2]!, match[3]!) : realDay(match[4]!, match[5]!, match[6]!);
    if (day) return day;
  }
  return '';
}

/** The party a convention name carries: the first segment after the type with a letter in it (not a date) and no work-product mark. */
export function nameParty(name: string): string {
  const party = segmentsOf(name).slice(1).find((segment) => /\p{L}/u.test(segment) && !WORK_PRODUCT.test(segment));
  return party ? party.replace(/[_-]+/g, ' ').trim() : '';
}

/** Each document's date and parties as a person entered them on its checklist matches; the first one given wins. */
export function checklistFacts(checklist: ChecklistDocs | null): Map<string, KeyFacts> {
  const facts = new Map<string, KeyFacts>();
  for (const item of checklist?.items ?? []) {
    for (const match of item.matches) {
      // A file that left the folder: its match no longer counts (worker/checklist.ts serveMatch).
      if (match.href === null) continue;
      const seen = facts.get(match.documentId);
      facts.set(match.documentId, { date: seen?.date || match.date || '', parties: seen?.parties || match.parties || '' });
    }
  }
  return facts;
}

/** A document's date and parties with no matter: the checklist's, else the file name's. */
export function keyFacts(id: string, name: string, checklist: ReadonlyMap<string, KeyFacts>): KeyFacts {
  const entered = checklist.get(id);
  return { date: entered?.date || nameDate(name), parties: entered?.parties || nameParty(name) };
}

/** A column the table can leave out: its header and cells carry docs-th--<column> and docs-cell--<column>. */
export type Column = 'control' | 'date' | 'parties' | 'pages' | 'privilege' | 'bates';

/** The case room's own columns: control numbers, privilege calls and Bates numbers belong to a matter. */
const CASE_COLUMNS: readonly Column[] = ['control', 'privilege', 'bates'];

/**
 * The cells hiddenColumns reads, as DocRow (documents-table-data.ts) holds them. Not imported from there: worker/export.ts
 * reads this file, and that one pulls the browser's modules into the worker's type check.
 */
export interface ColumnCells {
  date: string;
  parties: string;
  pages: number | null;
}

/** The columns a company room leaves out: the case room's, and any with nothing in any row. A case room shows every one. */
export function hiddenColumns(rows: readonly ColumnCells[], company: boolean): Column[] {
  if (!company) return [];
  const empty: Column[] = [];
  if (rows.every((row) => !row.date)) empty.push('date');
  if (rows.every((row) => !row.parties)) empty.push('parties');
  if (rows.every((row) => row.pages === null)) empty.push('pages');
  return [...CASE_COLUMNS, ...empty];
}
