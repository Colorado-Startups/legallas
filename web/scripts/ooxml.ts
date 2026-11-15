// SPDX-License-Identifier: Apache-2.0
// Plain text from the XML parts of PowerPoint and Excel files (Office Open XML), for office.ts. Pure string work:
// no XML parser, no entity declarations. Only XML's five predefined entities and character references are decoded,
// so a part that declares its own entities gets nothing from them.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const MAX_GAP = 50;
const DAY_MS = 86_400_000;
/** Excel's built-in date and time number formats (ECMA-376 Part 1, 18.8.30). */
const BUILT_IN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
/** Excel's built-in percent formats, 0% and 0.00%. */
const BUILT_IN_PERCENTS = new Set([9, 10]);
/** Significant digits kept for a plain number: more than Excel ever shows, without float noise. */
const DIGITS = 12;

/** Decodes the five predefined entities and character references; anything else stays as written. */
export function xmlText(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] !== '#') return ENTITIES[ref] ?? whole;
    const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** The attributes of one start tag, by qualified name, with their values decoded. */
export function attrsOf(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/\s([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1]!] = xmlText(match[2] ?? match[3] ?? ''); // safe: group 1 always takes part in a match
  }
  return attrs;
}

/**
 * The prefix this file's readers expect for each namespace a PowerPoint or Excel part uses ('' for none). The prefix is the
 * writer's choice: the Open XML SDK writes `x:` for SpreadsheetML, and other tools write `ns1:`. Strict namespaces included.
 */
const USUAL_PREFIX = new Map<string, string>([
  ['http://schemas.openxmlformats.org/spreadsheetml/2006/main', ''],
  ['http://purl.oclc.org/ooxml/spreadsheetml/main', ''],
  ['http://schemas.openxmlformats.org/package/2006/relationships', ''],
  ['http://schemas.openxmlformats.org/drawingml/2006/main', 'a'],
  ['http://purl.oclc.org/ooxml/drawingml/main', 'a'],
  ['http://schemas.openxmlformats.org/presentationml/2006/main', 'p'],
  ['http://purl.oclc.org/ooxml/presentationml/main', 'p'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'r'],
  ['http://purl.oclc.org/ooxml/officeDocument/relationships', 'r'],
]);

/** A qualified name with a bound prefix renamed: a known namespace's to its usual prefix, any other's out of the way. */
function usualName(name: string, bound: ReadonlyMap<string, string>, element: boolean): string {
  const colon = name.indexOf(':');
  const prefix = colon < 0 ? '' : name.slice(0, colon);
  if (prefix === 'xmlns' || (colon < 0 && !element)) return name; // an unprefixed attribute is in no namespace
  const namespace = bound.get(prefix);
  if (namespace === undefined) return name; // undeclared: left as written
  const local = name.slice(colon + 1);
  const usual = USUAL_PREFIX.get(namespace);
  if (usual === undefined) return `o.${prefix || 'default'}:${local}`; // another namespace can't pass for a known one
  return usual === '' ? local : `${usual}:${local}`;
}

/**
 * A PowerPoint or Excel part with its elements and attributes renamed to the usual prefixes, so `<x:c>` reads as `<c>`.
 * A namespace is bound file-wide by its first declaration: Office writes them all on the root. A part whose root never
 * closes throws: text past the break would go unread, and the SSN guard would count the file as scanned. Text with no
 * element at all reads as ''.
 */
export function usualPrefixes(xml: string): string {
  if (xml === '') return xml;
  const bound = new Map<string, string>();
  for (const match of xml.matchAll(/\sxmlns(?::([\w.-]+))?\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const prefix = match[1] ?? '';
    if (!bound.has(prefix)) bound.set(prefix, match[2] ?? match[3] ?? '');
  }
  const root = /<([A-Za-z_][\w.:-]*)[^>]*?(\/?)>/.exec(xml);
  if (!root) return ''; // no element at all, such as a stored link's target path: nothing to read, as before
  const body = xml.trimEnd();
  if (!(root[2] === '/' ? body.endsWith('>') && root.index + root[0].length === body.length : body.endsWith(`</${root[1]}>`))) {
    throw new Error('not closed');
  }
  if (bound.size === 0) return xml;
  return xml.replace(/<(\/?)([A-Za-z_][\w.:-]*)([^>]*)>/g, (_whole, slash: string, name: string, rest: string) => {
    const attrs = rest.replace(/(\s)([A-Za-z_][\w.:-]*)(\s*=\s*)("[^"]*"|'[^']*')/g, (_a, space: string, attr: string, eq: string, value: string) => `${space}${usualName(attr, bound, false)}${eq}${value}`);
    return `<${slash}${usualName(name, bound, true)}${attrs}>`;
  });
}

/** `target` resolved against `baseDir` inside the archive ("../x" climbs, a leading "/" is the archive root). */
function resolvePart(baseDir: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : baseDir + target).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

/**
 * A relationships part (`_rels/*.rels`) as Id -> part path inside the archive. External targets (links) are
 * left out. With `type`, only relationships whose Type matches it.
 */
export function relTargets(rels: string, baseDir: string, type?: RegExp): Map<string, string> {
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const attrs = attrsOf(match[0]);
    if (!attrs.Id || !attrs.Target || attrs.TargetMode === 'External') continue;
    if (type && !type.test(attrs.Type ?? '')) continue;
    targets.set(attrs.Id, resolvePart(baseDir, attrs.Target));
  }
  return targets;
}

/** The number in a part name such as ppt/slides/slide12.xml, for ordering. */
export function partNumber(name: string): number {
  return Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
}

/** The text of the `<t>` elements in a fragment (a shared string, an inline string), joined as written. */
export function cellText(fragment: string): string {
  return [...fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1]!)).join(''); // safe: group 1 always matches
}

/**
 * A slide's (or notes page's) text: one line per DrawingML paragraph, with line breaks kept. Slide number
 * fields are left out, so notes pages do not gain a stray number.
 */
export function slideLines(xml: string): string[] {
  const body = xml.replace(/<a:fld\b[^>]*type="slidenum"[\s\S]*?<\/a:fld>/g, '');
  const lines: string[] = [];
  for (const paragraph of body.matchAll(/<a:p(?:\s[^>]*?)?(?<!\/)>([\s\S]*?)<\/a:p>/g)) {
    let line = '';
    for (const piece of paragraph[1]!.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\b[^>]*>/g)) { // safe: group 1 always matches
      line += piece[1] === undefined ? '\n' : xmlText(piece[1]);
    }
    if (line.trim() !== '') lines.push(line.trim());
  }
  return lines;
}

export type NumberStyle = 'date' | 'percent' | null;

/**
 * How a number format shows a number: a date or time (Excel's built-ins, or a code with d, m, y, h or s outside
 * quotes and brackets), a percent (the built-ins, or a code with %), or as it is (null).
 */
function numberStyle(id: number, code: string | undefined): NumberStyle {
  if (BUILT_IN_DATES.has(id)) return 'date';
  if (BUILT_IN_PERCENTS.has(id)) return 'percent';
  const bare = (code ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  return /[dmyhs]/i.test(bare) ? 'date' : bare.includes('%') ? 'percent' : null;
}

/** For each cell style index (the `s` attribute), how its number format shows a number. */
export function numberStyles(styles: string): NumberStyle[] {
  const codes = new Map<number, string>();
  for (const match of styles.matchAll(/<numFmt\b[^>]*>/g)) {
    const attrs = attrsOf(match[0]);
    codes.set(Number(attrs.numFmtId), attrs.formatCode ?? '');
  }
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  return [...cellXfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(attrsOf(m[0]).numFmtId ?? 0);
    return numberStyle(id, codes.get(id));
  });
}

/** An Excel serial date as YYYY-MM-DD, with HH:MM when it has a time of day. */
export function serialDate(serial: number, date1904 = false): string {
  // The 1900 system counts from 1899-12-31 but keeps Lotus's 1900-02-29, so from day 61 on it counts from 1899-12-30.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : serial < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const iso = new Date(epoch + Math.round(serial * DAY_MS / 60_000) * 60_000).toISOString();
  const time = iso.slice(11, 16);
  return time === '00:00' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${time}`;
}

/** The column number (A = 1) of a cell reference such as "AB12", or 0. */
function column(ref: string | undefined): number {
  let n = 0;
  for (const char of /^[A-Z]+/.exec(ref ?? '')?.[0] ?? '') n = n * 26 + char.charCodeAt(0) - 64;
  return n;
}

export interface SheetContext {
  shared: readonly string[];
  /** xl/styles.xml, for telling dates and percents from plain numbers. */
  styles: string;
  date1904: boolean;
}

/** A number as a date, a percent (to two decimals) or a plain number (DIGITS significant digits). */
function numberText(number: number, style: NumberStyle, date1904: boolean): string {
  if (style === 'date') return serialDate(number, date1904);
  if (style === 'percent') return `${Number((number * 100).toFixed(2))}%`;
  return String(Number(number.toPrecision(DIGITS)));
}

/** One cell's text: shared and inline strings, booleans, errors, and numbers as their format shows them. */
function cellValue(attrs: Record<string, string>, inner: string, ctx: SheetContext, styles: readonly NumberStyle[]): string {
  const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
  const value = raw === undefined ? '' : xmlText(raw);
  switch (attrs.t) {
    case 's':
      return ctx.shared[Number(value)] ?? '';
    case 'inlineStr':
      return cellText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? '');
    case 'b':
      return value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : value;
    case 'str':
    case 'e':
    case 'd':
      return value;
    default: {
      const number = Number(value);
      return value !== '' && Number.isFinite(number) ? numberText(number, styles[Number(attrs.s ?? 0)] ?? null, ctx.date1904) : value;
    }
  }
}

/** A worksheet as one line per row that has a value, cells joined by " | " (empty cells between values kept). */
export function sheetRows(xml: string, ctx: SheetContext): string[] {
  const styles = numberStyles(ctx.styles);
  const lines: string[] = [];
  for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: { col: number; text: string }[] = [];
    for (const cell of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = attrsOf(cell[1] ?? '');
      const text = cellValue(attrs, cell[2] ?? '', ctx, styles).replace(/\s+/g, ' ').trim();
      if (text !== '') cells.push({ col: column(attrs.r) || (cells.at(-1)?.col ?? 0) + 1, text });
    }
    if (cells.length === 0) continue;
    const out: string[] = [cells[0]!.text]; // safe: cells is not empty
    for (let i = 1; i < cells.length; i += 1) {
      const gap = Math.min(Math.max(cells[i]!.col - cells[i - 1]!.col - 1, 0), MAX_GAP); // safe: i and i - 1 are in range
      out.push(...Array<string>(gap).fill(''), cells[i]!.text); // safe: i is in range
    }
    lines.push(out.join(' | '));
  }
  return lines;
}
