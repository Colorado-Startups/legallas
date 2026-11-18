// SPDX-License-Identifier: Apache-2.0
// The SSN detector behind the sync's guard (pii-scan.ts) and the index's last check (indexparts.ts). The room's
// rule: Social Security numbers never go in; business EINs stay. Three rules, each reporting a masked form only
// (***-**-1234), never the number:
//
//   ssn-form    ddd-dd-dddd, ddd dd dddd or ddd.dd.dddd standing on its own, with an area, group and serial the
//               SSA issues: not area 000, 666 or 900 to 999 (never issued as SSNs), group 00 or serial 0000.
//   labelled    nine digits in any grouping (digit boxes, EIN grouping, plain) that start within LABEL_WINDOW
//               characters after a label: social security, SSN, taxpayer identification number, TIN, identifying
//               number. Blank-form placeholders (area 000, group 00 or serial 0000) are left out; an ITIN (area 9xx)
//               after a label counts.
//   known-hash  nine digits in any grouping whose salted scrypt hash is listed in the gitignored
//               legallas.config.json (piiHashes, pii-hash.ts): a known SSN in any format, never stored as digits.
//
// A business EIN (dd-ddddddd) matches only the last two: after a label, or when its digits are a known SSN.
// Text is read in NFKC first, so fullwidth digits and dashes and thin, narrow and figure spaces read as plain ones, and
// with its format characters (Unicode Cf: soft hyphen, zero-width space and joiners, BOM) dropped, since PDF and Word
// text carries them inside numbers and NFKC keeps them. A file or folder name has its own reading (pathHits), because a
// name's dashes only separate words.

export type PiiRule = 'ssn-form' | 'labelled' | 'known-hash' | 'private-key';

export interface PiiHit {
  rule: PiiRule;
  /** Offsets into the text scanned, for tests and dedupe; never printed. */
  start: number;
  end: number;
  /** ***-**-1234: the last four digits only. */
  masked: string;
}

/** Nine digits in some grouping: where they sit in the text, and the digits alone. */
export interface NineDigits {
  start: number;
  end: number;
  digits: string;
}

/** Answers whether nine digits are a known SSN (pii-hash.ts KnownSsnHashes). */
export interface KnownMatcher {
  matches(digits: string): Promise<boolean>;
  matchesSync(digits: string): boolean;
}

/**
 * How far after a label the nine digits may start. About 40 characters covers "SSN: " and a digit box form's
 * "Social security number\nor\nEmployer identification number\n"; 60 also reaches past the K-1's line E
 * parenthetical ("Partner's SSN or TIN (Do not use TIN of a disregarded entity. See instructions.)").
 */
export const LABEL_WINDOW = 60;

export function maskDigits(digits: string): string {
  return `***-**-${digits.slice(-4)}`;
}

/** An area, group and serial the SSA could have issued to a person (see the header). */
export function issuable(area: string, group: string, serial: string): boolean {
  return area !== '000' && area !== '666' && area[0] !== '9' && group !== '00' && serial !== '0000';
}

const DASH = '[-\\u2010-\\u2014\\u2212]';
const SPACE = '[ \\u00a0]';

/**
 * The three printed forms, each with the separator class it uses. A form next to more digits through the same
 * separator class (1-ddd-dd-dddd, a row of a table "12 ddd dd dddd 2012") is part of a longer number, not an SSN.
 * A dash joins a longer number only when tight: "Founder 1 - ddd-dd-dddd" and "ddd-dd-dddd - 500 shares" are SSNs.
 */
const FORMS: readonly { form: RegExp; before: RegExp; after: RegExp }[] = [
  {
    form: new RegExp(`(?<!\\d)(\\d{3}) ?${DASH} ?(\\d{2}) ?${DASH} ?(\\d{4})(?!\\d)`, 'g'),
    before: new RegExp(`\\d${DASH}$`),
    after: new RegExp(`^${DASH}\\d`),
  },
  {
    form: new RegExp(`(?<!\\d)(\\d{3})${SPACE}{1,2}(\\d{2})${SPACE}{1,2}(\\d{4})(?!\\d)`, 'g'),
    before: new RegExp(`\\d${SPACE}{1,2}$`),
    after: new RegExp(`^${SPACE}{1,2}\\d`),
  },
  { form: /(?<!\d)(\d{3})\.(\d{2})\.(\d{4})(?!\d)/g, before: /\d\.$/, after: /^\.\d/ },
];

/**
 * True when the match starts right after a URL's percent escape, which owns its first two digits as its hex pair
 * ("https://.../Code%20effective%201.14.2012.pdf" is %20 then a date). The % must not follow a digit ("5%" is a
 * percentage) and must end one unbroken token shaped like a URL: one holding "://", or a path starting with "/".
 * So "5%123-45-6789", "rate%..." and "n/a%..." in a table or OCR text still count.
 */
function inUrlEscape(text: string, start: number): boolean {
  if (text[start - 1] !== '%' || /\d/.test(text[start - 2] ?? '')) return false;
  const token = text.slice(0, start - 1).split(/\s/).pop() ?? '';
  return token.includes('://') || token.startsWith('/');
}

/** Format characters (Unicode Cf): invisible, so a number reads the same with or without them. */
const FORMAT = /\p{Cf}/gu;

const plainWidths = (text: string) => text.normalize('NFKC').replace(FORMAT, '');

/**
 * Rule ssn-form: printed SSNs with an issuable area, group and serial. With `neighbors` off, a digit beside the form
 * does not make it a longer number, for text whose separators only separate words (pathHits).
 */
export function ssnFormHits(raw: string, neighbors = true): PiiHit[] {
  const text = plainWidths(raw);
  const hits: PiiHit[] = [];
  for (const { form, before, after } of FORMS) {
    for (const match of text.matchAll(form)) {
      const [whole, area, group, serial] = match as unknown as [string, string, string, string];
      const start = match.index;
      const end = start + whole.length;
      if (!issuable(area, group, serial)) continue;
      if (neighbors && (before.test(text.slice(Math.max(0, start - 4), start)) || after.test(text.slice(end, end + 4)) || inUrlEscape(text, start))) continue;
      hits.push({ rule: 'ssn-form', start, end, masked: maskDigits(serial) });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** True when the text holds a printed SSN (rule ssn-form). */
export function hasSsnForm(text: string): boolean {
  return ssnFormHits(text).length > 0;
}

/** What may sit between two digit groups of one number: spaces or a newline, dashes, dots, box rules. */
const JOIN = /^[\s\-\u2010-\u2014\u2212.|]{1,4}$/;

interface Group {
  start: number;
  end: number;
  digits: string;
}

/**
 * Every run of exactly nine digits made of whole digit groups joined by JOIN ("ddddddddd", "ddd-dd-dddd",
 * "dd-ddddddd", "d d d d d d d d d", across a line break). A group longer than nine digits is some other number.
 * An amount's cents (".56" not followed by another dot) end the number, so "1,234.56 78.90" is not one.
 */
export function nineDigitRuns(raw: string): NineDigits[] {
  const text = plainWidths(raw);
  const groups: Group[] = [...text.matchAll(/\d+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, digits: m[0] }));
  const joined = groups.map((group, i) => {
    const next = groups[i + 1];
    return next !== undefined && JOIN.test(text.slice(group.end, next.start));
  });
  for (let i = 1; i < groups.length; i += 1) {
    const cents = groups[i].digits.length === 2 && text.slice(groups[i - 1].end, groups[i].start) === '.';
    if (cents && !(joined[i] && text[groups[i].end] === '.')) {
      joined[i - 1] = false;
      joined[i] = false;
    }
  }
  const runs: NineDigits[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    let digits = '';
    for (let j = i; j < groups.length && digits.length < 9; j += 1) {
      digits += groups[j].digits;
      if (digits.length === 9) runs.push({ start: groups[i].start, end: groups[j].end, digits });
      if (!joined[j]) break;
    }
  }
  return runs;
}

/** Labels that say the next number is a person's tax number. Abbreviations count in capitals only. */
const LABELS: readonly RegExp[] = [
  /social[\s-]+security/gi,
  /\bsoc\.?\s?sec\b\.?/gi,
  /(?<![A-Za-z])S\.?S\.?N(?:s|'s)?(?![A-Za-z])/g,
  /(?<![A-Za-z])SS ?#/g,
  /taxpayer[\s-]+identification[\s-]+(?:number|no\b)/gi,
  /(?<![A-Za-z])I?TINs?(?![A-Za-z])/g,
  /identifying[\s-]+(?:number|no\b)/gi,
];

/** Where each label ends, in text order. */
function labelEnds(text: string): number[] {
  return LABELS.flatMap((label) => [...text.matchAll(label)].map((m) => m.index + m[0].length)).sort((a, b) => a - b);
}

/** A blank form's filler ("000-00-0000", "123-00-0000"): area 000, group 00 or serial 0000. */
function placeholder(digits: string): boolean {
  return digits.startsWith('000') || digits.slice(3, 5) === '00' || digits.endsWith('0000');
}

/** Rule labelled: nine digits starting within LABEL_WINDOW characters after a label. Overlapping runs count once. */
export function labelledHits(raw: string, runs: readonly NineDigits[] = nineDigitRuns(raw)): PiiHit[] {
  const ends = labelEnds(plainWidths(raw));
  if (ends.length === 0) return [];
  const hits: PiiHit[] = [];
  for (const run of runs) {
    if (placeholder(run.digits) || !ends.some((end) => run.start >= end && run.start - end <= LABEL_WINDOW)) continue;
    if (hits.some((hit) => run.start < hit.end && hit.start < run.end)) continue;
    hits.push({ rule: 'labelled', start: run.start, end: run.end, masked: maskDigits(run.digits) });
  }
  return hits;
}

function knownHit(run: NineDigits): PiiHit {
  return { rule: 'known-hash', start: run.start, end: run.end, masked: maskDigits(run.digits) };
}

function sorted(hits: PiiHit[]): PiiHit[] {
  return hits.sort((a, b) => a.start - b.start || a.rule.localeCompare(b.rule));
}

/** Every hit of the three rules (known-hash only with a matcher), in text order. */
export async function findPii(text: string, known: KnownMatcher | null = null): Promise<PiiHit[]> {
  const runs = nineDigitRuns(text);
  const hits = [...ssnFormHits(text), ...labelledHits(text, runs)];
  if (known) {
    const matched = await Promise.all(runs.map((run) => known.matches(run.digits)));
    runs.forEach((run, i) => {
      if (matched[i]) hits.push(knownHit(run));
    });
  }
  return sorted(hits);
}

/** findPii without awaiting: the known-hash rule hashes synchronously (cached per run). */
export function findPiiSync(text: string, known: KnownMatcher | null = null): PiiHit[] {
  const runs = nineDigitRuns(text);
  const hits = [...ssnFormHits(text), ...labelledHits(text, runs)];
  if (known) {
    for (const run of runs) if (known.matchesSync(run.digits)) hits.push(knownHit(run));
  }
  return sorted(hits);
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** How many bytes the UTF-8 sequence led by `byte` holds: 2 to 4, or 1 for a byte that leads none. */
function utf8Length(byte: number): number {
  if (byte >= 0xc2 && byte <= 0xdf) return 2;
  if (byte >= 0xe0 && byte <= 0xef) return 3;
  if (byte >= 0xf0 && byte <= 0xf4) return 4;
  return 1;
}

/**
 * Percent escapes decoded: each run of escaped bytes read as UTF-8, a whole code point at a time ("%E2%80%8B" is one
 * zero-width space, not three Latin-1 letters). A byte that starts no valid sequence ("%AD" alone, "%E9") reads as the
 * Latin-1 character it names, as before.
 */
function decodeEscapes(rel: string): string {
  return rel.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    const bytes = run.slice(1).split('%').map((hex) => parseInt(hex, 16));
    let out = '';
    for (let i = 0; i < bytes.length; ) {
      const length = utf8Length(bytes[i]!); // safe: i < length
      if (length > 1) {
        try {
          out += UTF8.decode(Uint8Array.from(bytes.slice(i, i + length)));
          i += length;
          continue;
        } catch {
          // Not a whole UTF-8 sequence: its first byte reads as Latin-1 below.
        }
      }
      out += String.fromCharCode(bytes[i]!);
      i += 1;
    }
    return out;
  });
}

/**
 * A path as the rules read it: percent escapes decoded as UTF-8, format characters dropped, underscores as spaces, in
 * capitals so a label counts in any case.
 */
function pathText(rel: string): string {
  return decodeEscapes(rel).replace(FORMAT, '').replace(/_/g, ' ').toUpperCase();
}

/** Every hit in a file or folder name. A digit beside the form does not hide it there: W-9-ddd-dd-dddd, ddd-dd-dddd-2024. */
export function pathHits(rel: string, known: KnownMatcher | null = null): PiiHit[] {
  const text = pathText(rel);
  return sorted([...ssnFormHits(text, false), ...findPiiSync(text, known)]);
}

/**
 * A PEM private key's first line, for the sync's guard. Not personal data, and so not in findPii, which the index's checks
 * share, but the room would serve it to every member.
 */
export function privateKeyHits(text: string): PiiHit[] {
  const found = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.exec(text);
  return found ? [{ rule: 'private-key', start: found.index, end: found.index + found[0].length, masked: 'private key' }] : [];
}

/** A path with its digits masked. */
export function maskDigitsOf(rel: string): string {
  return rel.replace(/\p{Nd}/gu, '#');
}

/** A path fit to print: its digits masked when it holds a number, so the guard never prints what it caught. */
export function maskPath(rel: string, known: KnownMatcher | null = null): string {
  return pathHits(rel, known).length > 0 ? maskDigitsOf(rel) : rel;
}
