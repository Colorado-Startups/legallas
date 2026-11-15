// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). Partial ISO dates ("2023", "2023-10", "2023-10-17") as UTC spans, so an event known
// only to the month is drawn across that month instead of pretending to a day. Pure: no DOM.

/** How exactly a date is known: to the year, month or day. */
export type Precision = 'year' | 'month' | 'day';

/** A partial date resolved to a half-open UTC span [start, end) in epoch milliseconds. */
export interface DateSpan {
  start: number;
  end: number;
  precision: Precision;
}

/** The number of milliseconds in one day. */
export const DAY_MS = 86_400_000;

const PARTIAL = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/** The span a partial ISO date covers, or null when the string is not a real calendar date. */
export function parsePartialDate(value: string): DateSpan | null {
  const match = PARTIAL.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  if (match[2] === undefined) {
    return { start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1), precision: 'year' };
  }
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11) return null;
  if (match[3] === undefined) {
    return { start: Date.UTC(year, month, 1), end: Date.UTC(year, month + 1, 1), precision: 'month' };
  }
  const day = Number(match[3]);
  const start = Date.UTC(year, month, day);
  if (day < 1 || new Date(start).getUTCMonth() !== month) return null;
  return { start, end: start + DAY_MS, precision: 'day' };
}

/** True when the span is wider than one day and so is drawn as a band, not a point. */
export function isSpan(span: DateSpan): boolean {
  return span.precision !== 'day';
}

/** The span's midpoint, where a point mark for it sits. */
export function midpoint(span: DateSpan): number {
  return span.start + (span.end - span.start) / 2;
}

/** Chronological order: earlier start first; at the same start the coarser (wider) span first. */
export function compareSpans(a: DateSpan, b: DateSpan): number {
  return a.start - b.start || b.end - a.end;
}

/** True when two half-open spans share any time. */
export function overlaps(a: DateSpan, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/** The ISO label for a millisecond instant at a precision: "2023", "2023-10" or "2023-10-17". */
export function isoLabel(ms: number, precision: Precision): string {
  const iso = new Date(ms).toISOString();
  return precision === 'year' ? iso.slice(0, 4) : precision === 'month' ? iso.slice(0, 7) : iso.slice(0, 10);
}

const PROSE_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

/** The voice guide's prose form: "Oct. 17, 2023", "Oct. 2023" or "2023". */
export function proseDate(span: DateSpan): string {
  const date = new Date(span.start);
  const year = date.getUTCFullYear();
  if (span.precision === 'year') return String(year);
  const month = PROSE_MONTHS[date.getUTCMonth()];
  return span.precision === 'month' ? `${month} ${year}` : `${month} ${date.getUTCDate()}, ${year}`;
}
