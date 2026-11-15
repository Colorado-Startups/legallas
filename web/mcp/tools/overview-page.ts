// SPDX-License-Identifier: Apache-2.0
// legallas_case_overview's pages (owner: session 2a) under the D6 response profiles. Standard (Claude, Harvey) keeps
// the caps the tool has always had; compact (Microsoft and unknown clients) holds at most 25 entries and 9,000
// characters per page as sent: the text and the small view it keeps (tools/output.ts compactView) together. An entry too long for a page is split across pages into parts that share its id,
// its lists sliced in order (standard splits tracks and violations, compact every section); only a single list item
// longer than a page is shortened, flagged `truncated`. Cursors are opaque and name the entry and part.
import type { ResponseProfile, ResultLimits } from '../contract.ts';
import { decodeCursor as decodeParts, encodeCursor as encodeParts, limitsFor, wireChars } from '../format.ts';
import { CLOSE, fenceOf, noteChars, type Untrusted } from '../untrusted.ts';
import { viewRow } from './output.ts';
import { CUT, MAX_TEXT_CHARS } from './overview-text.ts';

/** Standard: entries per page at most. */
export const PAGE_ENTRIES = 40;
/**
 * Standard: compact JSON characters per page at most (one entry always fits). The result carries the page twice, as
 * pretty text and as structured content, so this keeps a call near 60 KB, far under Microsoft's 500 KB.
 */
export const PAGE_BUDGET_CHARS = 24_000;
/** Standard: one entry's compact JSON at most; a larger one is split or shrunk. */
export const MAX_ENTRY_CHARS = 12_000;
/** The overview's own caps; format.ts limitsFor narrows them to COMPACT_LIMITS for a compact caller. */
const STANDARD_LIMITS: ResultLimits = { maxItems: PAGE_ENTRIES, maxChars: PAGE_BUDGET_CHARS };
const COMPACT = limitsFor('compact', STANDARD_LIMITS);
/** Compact: entries per page at most. */
export const COMPACT_PAGE_ENTRIES = COMPACT.maxItems;
/** Compact: characters per page as sent at most, text and view together (format.ts compactChars). */
export const COMPACT_PAGE_CHARS = COMPACT.maxChars;
/**
 * Compact: what a page takes as sent besides its items, at most: its own fields (retrieved, section, total, offset,
 * nextCursor) twice, in the text and in the view, and the result's brackets.
 */
const COMPACT_ENVELOPE_CHARS = 500;

/** How a profile sizes and caps a page. */
export interface Fit {
  profile: ResponseProfile;
  /** Items (entries or parts) per page at most. */
  entries: number;
  /** The page's items at most, as `size` measures them. */
  pageChars: number;
  /** One item at most. */
  itemChars: number;
  size(value: unknown): number;
}

const compactLength = (value: unknown) => JSON.stringify(value).length;

/** Characters `value` takes as an item of a pretty-printed page: its own pretty form indented two levels, and a separator. */
function embeddedLength(value: unknown): number {
  const text = JSON.stringify(value, null, 2);
  return text.length + 4 * text.split('\n').length + 2;
}

/**
 * Characters an item takes on a compact page: what it adds as sent (its text, escaped in the text block, and its row of
 * the view, each with a comma), or its indented size when that is more. The second keeps parts no larger than they
 * were, so Ask's view of a page (worker/agent/tools/brief.ts) still holds a whole part.
 */
function compactLengthOf(value: unknown): number {
  const row = viewRow(value);
  return Math.max(embeddedLength(value), wireChars(value) + 1 + (row === null ? 0 : JSON.stringify(row).length + 1));
}

/** The size limits of each response profile. */
export const FITS: Record<ResponseProfile, Fit> = {
  standard: { profile: 'standard', entries: PAGE_ENTRIES, pageChars: PAGE_BUDGET_CHARS, itemChars: MAX_ENTRY_CHARS, size: compactLength },
  compact: {
    profile: 'compact', entries: COMPACT_PAGE_ENTRIES, pageChars: COMPACT_PAGE_CHARS - COMPACT_ENVELOPE_CHARS,
    itemChars: COMPACT_PAGE_CHARS - COMPACT_ENVELOPE_CHARS, size: compactLengthOf,
  },
};

/** `fit` with room left for the note `marks` bring to a page (mcp/untrusted.ts noted), so a noted page still fits. */
export function withNoteRoom(fit: Fit, marks: readonly Untrusted[]): Fit {
  const room = noteChars(marks);
  return room === 0 ? fit : { ...fit, pageChars: fit.pageChars - room, itemChars: fit.itemChars - room };
}

/** A string cut to `max` characters, keeping a case-data wrapper (and its untrusted mark) intact. */
function shorten(value: string, max: number): string {
  const fence = fenceOf(value);
  const inner = fence ? fence.inner : value;
  if (inner.length <= max) return value;
  const cut = inner.slice(0, max) + CUT;
  return fence ? fence.open + cut + CLOSE : cut;
}

/** Shortens a value's long text and long lists to the given limits. */
export function shrink(value: unknown, maxText: number, maxItems: number): unknown {
  if (typeof value === 'string') return shorten(value, maxText);
  if (Array.isArray(value)) return value.slice(0, maxItems).map((v) => shrink(v, maxText, maxItems));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shrink(v, maxText, maxItems)]));
  }
  return value;
}

/** An entry within `max` as `size` measures it: long text and long lists are cut harder until it fits, and it is flagged. */
export function shrinkTo(entry: unknown, max: number, size: (value: unknown) => number): unknown {
  if (size(entry) <= max) return entry;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return shrink(entry, MAX_TEXT_CHARS, 20);
  for (const [maxText, maxItems] of [[400, 20], [120, 8], [40, 3]] as const) {
    const small = { ...(shrink(entry, maxText, maxItems) as Record<string, unknown>), truncated: true };
    if (size(small) <= max) return small;
  }
  const { id, part, parts } = entry as { id?: unknown; part?: unknown; parts?: unknown };
  return { id: typeof id === 'string' ? id : null, ...(typeof part === 'number' ? { part, parts } : {}), truncated: true };
}

/** An entry within MAX_ENTRY_CHARS: long text and long lists are cut harder until it fits, and it is flagged. */
export function shrinkEntry(entry: unknown): unknown {
  return shrinkTo(entry, MAX_ENTRY_CHARS, compactLength);
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);

/** One list item and where it sits: a top-level list (`[key]`) or a list inside a top-level object (`[key, sub]`). */
interface Slice {
  path: readonly [string] | readonly [string, string];
  item: unknown;
}

/** The entry without its non-empty lists (kept one level down), and every list item in order. */
function takeLists(entry: Obj): { head: Obj; slices: Slice[] } {
  const head: Obj = {};
  const slices: Slice[] = [];
  for (const [key, value] of Object.entries(entry)) {
    if (Array.isArray(value) && value.length) {
      for (const item of value) slices.push({ path: [key], item });
    } else if (isObj(value)) {
      const inner: Obj = {};
      for (const [sub, v] of Object.entries(value)) {
        if (Array.isArray(v) && v.length) for (const item of v) slices.push({ path: [key, sub], item });
        else inner[sub] = v;
      }
      head[key] = inner;
    } else {
      head[key] = value;
    }
  }
  return { head, slices };
}

/** `base` with `slices` pushed into its lists (created as needed), nested objects copied so `base` is never changed. */
function assemble(base: Obj, slices: readonly Slice[]): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(base)) out[k] = isObj(v) ? { ...v } : v;
  for (const { path, item } of slices) {
    const [key, sub] = path;
    if (sub === undefined) {
      ((out[key] ??= []) as unknown[]).push(item);
    } else {
      const box = (out[key] ??= {}) as Obj;
      ((box[sub] ??= []) as unknown[]).push(item);
    }
  }
  return out;
}

/**
 * Slices in groups, in order: group 0 goes with a head, and each group takes slices while `fits(index, group)`. A
 * slice that does not fit starts the next group, alone if it must.
 */
function grouped(slices: readonly Slice[], fits: (index: number, group: readonly Slice[]) => boolean): Slice[][] {
  const groups: Slice[][] = [[]];
  for (const slice of slices) {
    const current = groups.at(-1)!;
    if (fits(groups.length - 1, [...current, slice])) current.push(slice);
    else groups.push([slice]);
  }
  return groups;
}

/**
 * A list item too long for a part alone, as fragments that each fit one: the first has the item's own fields, the
 * rest are `{ id, continues: true, ... }` (the id when the item has one), its lists sliced in order. An item with no
 * lists stays whole (and is cut with its part).
 */
function fragmentsOf(slice: Slice, alone: (slice: Slice) => boolean): Slice[] {
  if (!isObj(slice.item)) return [slice];
  const { head, slices } = takeLists(slice.item);
  if (!slices.length) return [slice];
  const base = (index: number): Obj => (index === 0 ? head : { ...(typeof head.id === 'string' ? { id: head.id } : {}), continues: true });
  const fragment = (index: number, group: readonly Slice[]): Slice => ({ path: slice.path, item: assemble(base(index), group) });
  return grouped(slices, (index, group) => alone(fragment(index, group))).map((group, index) => fragment(index, group));
}

/**
 * An entry as one or more page items within `fit.itemChars`. One that fits comes back as it is. A larger one is
 * split into parts, `{ id, part, parts, ... }`: part 1 has the scalar fields and the lists follow in order across
 * the parts, so joining the parts' lists gives the entry back. A list item too long for a part alone is split the
 * same way one level down, its later fragments marked `continues`. Only something still too long (a list item with no
 * lists, or one nested deeper) is cut, its part flagged `truncated`. An entry without an id is cut instead.
 */
export function splitEntry(entry: unknown, fit: Fit): unknown[] {
  if (fit.size(entry) <= fit.itemChars) return [entry];
  if (!isObj(entry) || typeof entry.id !== 'string') return [shrinkTo(entry, fit.itemChars, fit.size)];
  const id = entry.id;
  const { head, slices } = takeLists(entry);
  const part = (index: number, group: readonly Slice[], marks: { part: number; parts: number }) =>
    assemble({ id, ...marks, ...(index === 0 ? head : {}) }, group);
  // Sized with three-digit part markers, so the real markers never push a part over.
  const fits = (index: number, group: readonly Slice[]) => fit.size(part(index, group, { part: 999, parts: 999 })) <= fit.itemChars;
  const alone = (slice: Slice) => fits(1, [slice]);
  const groups = grouped(slices.flatMap((slice) => (alone(slice) ? [slice] : fragmentsOf(slice, alone))), fits);
  return groups.map((group, i) => shrinkTo(part(i, group, { part: i + 1, parts: groups.length }), fit.itemChars, fit.size));
}

/** Where a page starts: an entry, and the part of it (0 for its start). */
export interface Position {
  offset: number;
  part: number;
}

/**
 * Up to `fit.entries` items from `start`, within `fit.pageChars` (one item always fits). With `split`, an entry too
 * long for one item comes in parts (splitEntry) and a page can end inside it; otherwise it is cut to fit. A start
 * part the entry no longer has (a stale cursor, or one for an entry that was never split) restarts the entry, so
 * nothing is skipped.
 */
export function fitPage(entries: readonly unknown[], start: Position, fit: Fit, split: boolean): { items: unknown[]; next: Position | null } {
  const items: unknown[] = [];
  let size = 0;
  for (let offset = start.offset; offset < entries.length; offset++) {
    const parts = split ? splitEntry(entries[offset], fit) : [shrinkTo(entries[offset], fit.itemChars, fit.size)];
    const first = offset === start.offset && start.part < parts.length ? start.part : 0;
    for (let part = first; part < parts.length; part++) {
      const length = fit.size(parts[part]);
      if (items.length >= fit.entries || (items.length > 0 && size + length > fit.pageChars)) return { items, next: { offset, part } };
      items.push(parts[part]);
      size += length;
    }
  }
  return { items, next: null };
}

/** Standard: up to PAGE_ENTRIES entries from `offset`, each shrunk to MAX_ENTRY_CHARS, stopping before PAGE_BUDGET_CHARS. */
export function pageOf(entries: readonly unknown[], offset: number): { items: unknown[]; next: number | null } {
  const { items, next } = fitPage(entries, { offset, part: 0 }, FITS.standard, false);
  return { items, next: next === null ? null : next.offset };
}

const MAX_OFFSET = 999_999;
const MAX_PART = 9_999;
const whole = (value: unknown, max: number): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;

/** The opaque cursor for the start of entry `offset` in `section` (format.ts encodeCursor). */
export function encodeCursor(section: string, offset: number): string {
  return encodeParts([section, offset]);
}

/** The cursor for a position: the plain entry cursor at a part 0, else one naming the part and the profile that split it. */
export function encodePosition(section: string, { offset, part }: Position, profile: ResponseProfile): string {
  return part === 0 ? encodeCursor(section, offset) : encodeParts([section, offset, part, profile]);
}

/**
 * The position a cursor names, or null when it is malformed or belongs to another section. A part split under the
 * other profile restarts its entry, since parts are cut to each profile's size.
 */
export function decodePosition(cursor: string, section: string, profile: ResponseProfile): Position | null {
  const parts = decodeParts(cursor);
  if (!parts || parts[0] !== section || !whole(parts[1], MAX_OFFSET)) return null;
  if (parts.length === 2) return { offset: parts[1], part: 0 };
  const [, , part, splitBy] = parts;
  if (parts.length !== 4 || !whole(part, MAX_PART) || part === 0 || (splitBy !== 'compact' && splitBy !== 'standard')) return null;
  return { offset: parts[1], part: splitBy === profile ? part : 0 };
}

/** The entry offset a cursor names, or null when it is malformed or belongs to another section. */
export function decodeCursor(cursor: string, section: string): number | null {
  return decodePosition(cursor, section, 'standard')?.offset ?? null;
}
