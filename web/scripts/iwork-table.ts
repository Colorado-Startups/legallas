// SPDX-License-Identifier: Apache-2.0
// Tables in Apple's iWork files, for iwork.ts: a Numbers sheet's, a table on a Keynote slide or in a Pages document. Set
// out as Excel's are in ooxml.ts: one line per row, cells joined by " | ", and numbers as the app shows them.
import {
  allFields, fieldsOf, firstField, IworkFailure, MAX_DEPTH, objectAt, STORAGE, textOf, type Field, type IwaObject, type Walk,
} from './iwa.ts';

export const TABLE_MODEL = 6001;
/** Empty cells kept between two values on a row, as in ooxml.ts. */
const MAX_GAP = 50;
/** decimal128 holds exact values, so a number keeps every digit Numbers can show. */
const DIGITS = 15;
/** Numbers counts seconds from 2001-01-01, as written, with no time zone. */
const EPOCH_2001_MS = Date.UTC(2001, 0, 1);
const NO_OFFSET = 0xffff;
const WIDE_OFFSET_UNIT = 4;

/** A number without float noise, as ooxml.ts prints one. */
const plainNumber = (value: number) => String(Number(value.toPrecision(DIGITS)));

/** A decimal128 as Numbers stores money and most numbers: sign and exponent in the top bytes, then the mantissa. */
export function decimal128(bytes: Buffer): number {
  const exponent = (((bytes[15]! & 0x7f) << 7) | (bytes[14]! >> 1)) - 0x1820; // safe: callers pass 16 bytes
  let mantissa = BigInt(bytes[14]! & 1); // safe: callers pass 16 bytes
  for (let i = 13; i >= 0; i -= 1) mantissa = mantissa * 256n + BigInt(bytes[i]!); // safe: callers pass 16 bytes
  const value = Number(`${mantissa}e${exponent}`);
  return bytes[15]! & 0x80 ? -value : value; // safe: callers pass 16 bytes
}

/**
 * Seconds from 2001 as YYYY-MM-DD, with HH:MM when it has a time of day (ooxml.ts serialDate's shape). A format that
 * hides the year, such as a pivot table's "January", gets none here either: what the app shows is what is read, and
 * behind a pivot's month is a year nobody chose, which would state a false date.
 */
export function dateText(seconds: number, pattern = 'y'): string {
  const ms = EPOCH_2001_MS + Math.round(seconds / 60) * 60_000;
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return '';
  const date = new Date(ms);
  const iso = date.toISOString();
  const time = iso.slice(11, 16);
  const shown = pattern.replace(/'[^']*'/g, '');
  if (!/y/i.test(shown)) {
    const month = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    if (/[ML]/.test(shown)) return /d/.test(shown) ? `${month} ${date.getUTCDate()}` : month;
    return time;
  }
  return time === '00:00' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${time}`;
}

/** How a format shows a number. Field 1 is the format's kind. */
interface NumberFormat {
  kind: number;
  decimals: number | null;
  currency: string;
  /** A date format's pattern, as Unicode writes them: "M/d/yy h:mm a", or "LLLL" for a month alone. */
  pattern: string;
}

const FORMAT_CURRENCY = 257;
const FORMAT_PERCENT = 258;
/** Numbers writes this many decimals for "as many as the value has". */
const DECIMALS_AUTO_FROM = 100;

interface TableLists {
  strings: Map<number, string>;
  /** Rich text cells: key -> the cell's storage object. */
  rich: Map<number, IwaObject>;
  formats: Map<number, NumberFormat>;
}

function listEntries(list: IwaObject | undefined): Field[][] {
  return list ? allFields(fieldsOf(list.message), 3).map((entry) => fieldsOf(entry.bytes)) : [];
}

/** The lists a table's cells point into: field 4 of its data store is strings, 17 rich text, 22 number formats. */
function tableLists(store: readonly Field[], walk: Walk): TableLists {
  const lists: TableLists = { strings: new Map(), rich: new Map(), formats: new Map() };
  const list = (n: number) => objectAt(walk, firstField(store, n));
  for (const entry of listEntries(list(4))) lists.strings.set(firstField(entry, 1)?.value ?? 0, textOf(firstField(entry, 3)));
  for (const entry of listEntries(list(17))) {
    const payload = objectAt(walk, firstField(entry, 9));
    const storage = payload ? objectAt(walk, firstField(fieldsOf(payload.message), 1)) : undefined;
    if (storage?.type === STORAGE) lists.rich.set(firstField(entry, 1)?.value ?? 0, storage);
  }
  for (const entry of listEntries(list(22))) {
    const format = firstField(entry, 6);
    if (!format || format.isVarint) continue;
    const fields = fieldsOf(format.bytes);
    const decimals = firstField(fields, 2);
    lists.formats.set(firstField(entry, 1)?.value ?? 0, {
      kind: firstField(fields, 1)?.value ?? 0,
      decimals: decimals?.isVarint && decimals.value < DECIMALS_AUTO_FROM ? decimals.value : null,
      currency: textOf(firstField(fields, 3)),
      pattern: textOf(firstField(fields, 14)),
    });
  }
  return lists;
}

// A cell's flags say which values follow its 12-byte header, in this order.
const HAS_DECIMAL = 0x1;
const HAS_DOUBLE = 0x2;
const HAS_SECONDS = 0x4;
const HAS_STRING = 0x8;
const HAS_RICH = 0x10;
/** Style, condition, formula, control, error and suggestion IDs: nothing to read, four bytes each. */
const SKIPPED_IDS = [0x20, 0x40, 0x80, 0x100, 0x200, 0x400, 0x800, 0x1000];
const HAS_NUMBER_FORMAT = 0x2000;
const HAS_CURRENCY_FORMAT = 0x4000;
const HAS_DATE_FORMAT = 0x8000;
const CELL_VERSION = 5;
const CELL_HEADER = 12;

const CELL_NUMBER = 2;
const CELL_TEXT = 3;
const CELL_DATE = 5;
const CELL_BOOL = 6;
const CELL_DURATION = 7;
const CELL_ERROR = 8;
const CELL_RICH = 9;
const CELL_CURRENCY = 10;

function numberText(value: number, format: NumberFormat | undefined): string {
  if (format?.kind === FORMAT_PERCENT) return `${format.decimals === null ? plainNumber(value * 100) : Number((value * 100).toFixed(format.decimals))}%`;
  if (format?.kind === FORMAT_CURRENCY) {
    const amount = format.decimals === null ? plainNumber(value) : value.toFixed(format.decimals);
    return format.currency === '' ? amount : `${format.currency} ${amount}`;
  }
  return plainNumber(value);
}

/**
 * One cell's text. Numbers keeps a formula's last result in the cell, so the value shown is the value read. A cell
 * storage version other than 5 is from a much older Numbers, reported as old-format rather than guessed at.
 */
function cellText(buffer: Buffer, lists: TableLists, walk: Walk, depth: number): string {
  if (buffer.length < CELL_HEADER || buffer[0] !== CELL_VERSION) throw new IworkFailure('old-format');
  const type = buffer[1]!; // safe: the length is checked above
  const flags = buffer.readUInt32LE(8);
  let at = CELL_HEADER;
  const take = (bytes: number) => {
    if (at + bytes > buffer.length) throw new IworkFailure('unreadable');
    at += bytes;
    return at - bytes;
  };
  const decimal = flags & HAS_DECIMAL ? decimal128(buffer.subarray(take(16), at)) : null;
  const double = flags & HAS_DOUBLE ? buffer.readDoubleLE(take(8)) : null;
  const seconds = flags & HAS_SECONDS ? buffer.readDoubleLE(take(8)) : null;
  const string = flags & HAS_STRING ? buffer.readUInt32LE(take(4)) : null;
  const rich = flags & HAS_RICH ? buffer.readUInt32LE(take(4)) : null;
  for (const id of SKIPPED_IDS) if (flags & id) take(4);
  const numberFormat = flags & HAS_NUMBER_FORMAT ? buffer.readUInt32LE(take(4)) : null;
  const currencyFormat = flags & HAS_CURRENCY_FORMAT ? buffer.readUInt32LE(take(4)) : null;
  const dateFormat = flags & HAS_DATE_FORMAT ? buffer.readUInt32LE(take(4)) : null;
  const value = decimal ?? double;
  switch (type) {
    case CELL_NUMBER:
    case CELL_CURRENCY:
      return value === null ? '' : numberText(value, lists.formats.get(currencyFormat ?? numberFormat ?? -1));
    case CELL_TEXT:
      return string === null ? '' : (lists.strings.get(string) ?? '');
    case CELL_DATE:
      return seconds === null ? '' : dateText(seconds, lists.formats.get(dateFormat ?? -1)?.pattern || undefined);
    case CELL_BOOL:
      return value === null ? '' : value !== 0 ? 'TRUE' : 'FALSE';
    case CELL_DURATION:
      return value === null ? '' : `${plainNumber(value)} s`;
    case CELL_ERROR:
      return '#ERROR';
    case CELL_RICH: {
      const storage = rich === null ? undefined : lists.rich.get(rich);
      return storage ? walk.storageText(storage, depth + 1) : '';
    }
    default:
      return '';
  }
}

/**
 * A tile row's cells: field 7 holds one 16-bit offset per column into field 6, 0xffff for an empty cell. Field 8 marks a
 * row whose offsets count in 4-byte units, which the apps use even for small rows.
 */
function rowCells(row: readonly Field[], lists: TableLists, walk: Walk, depth: number): { col: number; text: string }[] {
  const buffer = firstField(row, 6)?.bytes ?? Buffer.alloc(0);
  // A much older Numbers keeps its cells in fields 3 and 4 alone. Reporting that beats returning an empty table.
  if (!firstField(row, 6) && (firstField(row, 3)?.bytes.length ?? 0) > 0) throw new IworkFailure('old-format');
  const offsets = firstField(row, 7)?.bytes ?? Buffer.alloc(0);
  const unit = firstField(row, 8)?.value ? WIDE_OFFSET_UNIT : 1;
  const filled: { col: number; start: number }[] = [];
  for (let col = 0; col * 2 + 2 <= offsets.length; col += 1) {
    const offset = offsets.readUInt16LE(col * 2);
    if (offset !== NO_OFFSET) filled.push({ col, start: offset * unit });
  }
  const cells: { col: number; text: string }[] = [];
  for (const [index, { col, start }] of filled.entries()) {
    const end = filled[index + 1]?.start ?? buffer.length;
    if (start >= end || end > buffer.length) throw new IworkFailure('unreadable');
    const text = cellText(buffer.subarray(start, end), lists, walk, depth).replace(/\s+/g, ' ').trim();
    if (text !== '') cells.push({ col, text });
  }
  return cells;
}

/** A table's rows as "a | b | c": field 4 is the data store, whose tiles each hold a run of rows. */
export function tableText(model: IwaObject, walk: Walk, depth: number): string {
  if (depth >= MAX_DEPTH) return '';
  walk.reached.add(model.id);
  const store = fieldsOf(firstField(fieldsOf(model.message), 4)?.bytes ?? Buffer.alloc(0));
  const lists = tableLists(store, walk);
  const tiles = fieldsOf(firstField(store, 3)?.bytes ?? Buffer.alloc(0));
  const tileRows = firstField(tiles, 2)?.value ?? 256;
  const rows = new Map<number, string>();
  for (const entry of allFields(tiles, 1)) {
    const mark = fieldsOf(entry.bytes);
    const tile = objectAt(walk, firstField(mark, 2));
    if (!tile) throw new IworkFailure('unreadable');
    const first = (firstField(mark, 1)?.value ?? 0) * tileRows;
    for (const rowField of allFields(fieldsOf(tile.message), 5)) {
      const row = fieldsOf(rowField.bytes);
      const cells = rowCells(row, lists, walk, depth);
      if (cells.length === 0) continue;
      const out: string[] = [cells[0]!.text]; // safe: cells is not empty
      for (let i = 1; i < cells.length; i += 1) {
        const gap = Math.min(Math.max(cells[i]!.col - cells[i - 1]!.col - 1, 0), MAX_GAP); // safe: i and i - 1 are in range
        out.push(...Array<string>(gap).fill(''), cells[i]!.text); // safe: i is in range
      }
      rows.set(first + (firstField(row, 1)?.value ?? 0), out.join(' | '));
    }
  }
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, line]) => line).join('\n');
}
