// SPDX-License-Identifier: Apache-2.0
// Field validators for the matter manifest: its document facts (worker/doc-facts.ts) and the litigation pack's
// whole-manifest parser (worker/matter.ts). Each one names the field it rejects, never the value, so an error can be
// shown to the owner without echoing matter text.
import type { Cite, PartialDate } from './matter-types.ts';

export class MatterError extends Error {
  override name = 'MatterError';
}

/** Slug ids within the manifest, for example "ev-0042", "p-doe", "count-3-el-2". */
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** documents.id: crypto.randomUUID() for every mirrored file and upload. */
const DOC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARTIAL_DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
const MAX_PAGE = 100_000;
/** Cite.note: a neutral pointer, never quoted case text. */
export const MAX_CITE_NOTE = 160;
/** Ids one entry may name (refs). */
const MAX_REFS = 200;

export function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new MatterError(`${where} must be an object`);
  return value as Record<string, unknown>;
}

export function text(value: unknown, where: string, max: number): string {
  if (typeof value !== 'string') throw new MatterError(`${where} must be a string`);
  const trimmed = value.normalize('NFC').trim();
  if (!trimmed || trimmed.length > max) throw new MatterError(`${where} must be 1 to ${max} characters`);
  return trimmed;
}

export function optionalText(value: unknown, where: string, max: number): string | null {
  return value === undefined || value === null || value === '' ? null : text(value, where, max);
}

export function list(value: unknown, where: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new MatterError(`${where} must be an array`);
  if (value.length > max) throw new MatterError(`${where} has more than ${max} entries`);
  return value;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], where: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new MatterError(`${where} must be one of ${allowed.join(', ')}`);
}

export function bool(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') throw new MatterError(`${where} must be true or false`);
  return value;
}

export function id(value: unknown, where: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new MatterError(`${where} must be a lowercase slug id`);
  return value;
}

/** A list of ids (missing means none), with no repeats. */
export function ids(value: unknown, where: string, max: number): string[] {
  const out = list(value ?? [], where, max).map((v, i) => id(v, `${where}[${i}]`));
  if (new Set(out).size !== out.length) throw new MatterError(`${where} repeats an id`);
  return out;
}

export function optionalId(value: unknown, where: string): string | null {
  return value === undefined || value === null ? null : id(value, where);
}

/** The ids of a list, each declared once (`seen` carries ids declared before it); returns `seen`. */
export function uniqueIds<T extends { id: string }>(items: T[], where: string, seen = new Set<string>()): Set<string> {
  items.forEach((item, i) => {
    if (seen.has(item.id)) throw new MatterError(`${where}[${i}].id repeats an earlier id`);
    seen.add(item.id);
  });
  return seen;
}

/** A list of ids that must each be already declared (`known`). */
export function refs(value: unknown, where: string, known: Set<string>): string[] {
  const out = ids(value, where, MAX_REFS);
  out.forEach((ref, i) => {
    if (!known.has(ref)) throw new MatterError(`${where}[${i}] names an unknown id`);
  });
  return out;
}

export function docId(value: unknown, where: string): string {
  if (typeof value !== 'string' || !DOC_ID.test(value)) throw new MatterError(`${where} must be a document id (UUID)`);
  return value.toLowerCase();
}

export function positiveInt(value: unknown, where: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new MatterError(`${where} must be a whole number from 1 to ${max}`);
  }
  return value;
}

/** Whole cents, zero or more. */
export function cents(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new MatterError(`${where} must be whole cents, zero or more`);
  }
  return value;
}

/** "2023", "2023-10" or "2023-10-17", a real calendar date between 1900 and 2100. */
export function partialDate(value: unknown, where: string): PartialDate {
  const match = typeof value === 'string' ? PARTIAL_DATE.exec(value) : null;
  if (!match) throw new MatterError(`${where} must be a date as YYYY, YYYY-MM or YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = match[2] === undefined ? 1 : Number(match[2]);
  const day = match[3] === undefined ? 1 : Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (year < MIN_YEAR || year > MAX_YEAR || !real) throw new MatterError(`${where} is not a real date`);
  return match[0];
}

export function optionalPartialDate(value: unknown, where: string): PartialDate | null {
  return value === undefined || value === null ? null : partialDate(value, where);
}

/** The first day a partial date can mean, as YYYY-MM-DD, so it compares with another day as a string. */
export function earliestDay(date: PartialDate): string {
  return [date.slice(0, 4), date.slice(5, 7) || '01', date.slice(8, 10) || '01'].join('-');
}

/** A record fact: a real date no later than the build day (dates are compared as the builder's calendar day). */
export function pastDate(value: unknown, where: string, buildDay: string): PartialDate {
  const date = partialDate(value, where);
  if (earliestDay(date) > buildDay) throw new MatterError(`${where} is after the build date; the room shows record facts only`);
  return date;
}

export function optionalPastDate(value: unknown, where: string, buildDay: string): PartialDate | null {
  return value === undefined || value === null ? null : pastDate(value, where, buildDay);
}

/** An ISO timestamp with a zone, for example "2026-09-30T18:00:00Z". */
export function timestamp(value: unknown, where: string): string {
  if (typeof value !== 'string' || !TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new MatterError(`${where} must be an ISO timestamp with a zone`);
  }
  return value;
}

export function cite(value: unknown, where: string): Cite {
  const r = record(value, where);
  const page = r.page === undefined || r.page === null ? null : positiveInt(r.page, `${where}.page`, MAX_PAGE);
  const note = optionalText(r.note, `${where}.note`, MAX_CITE_NOTE);
  return note === null ? { doc: docId(r.doc, `${where}.doc`), page } : { doc: docId(r.doc, `${where}.doc`), page, note };
}

/** At least one cite: every entry in the room says where it comes from. Exact repeats are dropped. */
export function cites(value: unknown, where: string, max: number): Cite[] {
  const raw = list(value, where, max);
  if (raw.length === 0) throw new MatterError(`${where} must cite at least one document`);
  const seen = new Set<string>();
  const out: Cite[] = [];
  raw.forEach((v, i) => {
    const c = cite(v, `${where}[${i}]`);
    const key = `${c.doc}#${c.page ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  });
  return out;
}
