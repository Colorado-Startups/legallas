// SPDX-License-Identifier: Apache-2.0
// Text of Word (.docx, .doc), RTF and OpenDocument text files with no outside tool, for computers that have no textutil.
// office.ts uses this everywhere but macOS, where textutil stays, so a Mac room reads its files as it always has. Pure
// byte and string work: nothing is unpacked to disk, no link in a file is followed, and no XML entity a file declares is
// expanded. Errors say only that a file can't be read, never what is in it.
import { zipEntry } from './law/docx.ts';
import { attrsOf, xmlText } from './ooxml.ts';
import { decodeText } from './text-file.ts';

/** Largest text or XML part read: office.ts's limit. A bigger one fails the document as "too-large" (a zip bomb, say). */
export const MAX_PART_BYTES = 64 * 1024 * 1024;

export class TooLarge extends Error {}

/** One entry of a zip archive as text, in UTF-8 or UTF-16 as XML allows, or '' when it has no such entry. */
export function zipText(zip: Buffer, name: string): string {
  try {
    const bytes = zipEntry(zip, name, MAX_PART_BYTES);
    return bytes ? decodeText(bytes) : '';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new TooLarge('too-large');
    throw error;
  }
}

interface Tag {
  name: string;
  closing: boolean;
  empty: boolean;
  start: number;
  end: number;
}

/** Where the closing `delimiter` of a construct opened at `start` ends (its last character), or -1. */
function endOf(xml: string, start: number, opener: string, delimiter: string): number {
  const at = xml.indexOf(delimiter, start + opener.length);
  return at < 0 ? -1 : at + delimiter.length - 1;
}

/**
 * Where the tag at `start` ends. A `>` in a quoted attribute value doesn't end it, nor one inside a comment or a CDATA
 * section. -1 when the part runs out first.
 */
function tagEnd(xml: string, start: number): number {
  if (xml.startsWith('<!--', start)) return endOf(xml, start, '<!--', '-->');
  if (xml.startsWith('<![CDATA[', start)) return endOf(xml, start, '<![CDATA[', ']]>');
  if (xml[start + 1] === '!' || xml[start + 1] === '?') return xml.indexOf('>', start);
  let quote = '';
  for (let i = start + 1; i < xml.length; i += 1) {
    const char = xml[i];
    if (quote !== '') quote = char === quote ? '' : quote;
    else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return i;
  }
  return -1;
}

/**
 * Every element tag of a part, in one pass, so a part with a tag left open can't make this slow. A part that doesn't close
 * fails, as it does in textutil: text past the break would go unread, and the SSN guard would count the file as scanned.
 */
function* tagsOf(xml: string): Generator<Tag> {
  const open: string[] = [];
  let start = xml.indexOf('<');
  while (start >= 0) {
    const end = tagEnd(xml, start);
    if (end < 0) throw new Error('not closed');
    const inside = xml.slice(start + 1, end);
    if (inside[0] !== '?' && inside[0] !== '!') {
      const closing = inside[0] === '/';
      const empty = inside.endsWith('/');
      const name = (closing ? inside.slice(1) : inside).split(/[\s/]/, 1)[0]!; // safe: split always yields a first part
      if (closing && open.pop() !== name) throw new Error('not closed');
      if (!closing && !empty) open.push(name);
      yield { name, closing, empty, start, end };
    }
    start = xml.indexOf('<', end);
  }
  if (open.length > 0) throw new Error('not closed');
}

/**
 * The text between two element tags as a reader shows it: comments dropped, CDATA sections as written, the rest with its
 * entities decoded. A number split by a comment or across CDATA sections reads whole, as textutil reads it (#282).
 */
export function runText(raw: string): string {
  let out = '';
  let from = 0;
  for (const match of raw.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    out += xmlText(raw.slice(from, match.index)) + (match[1] ?? '');
    from = match.index + match[0].length;
  }
  return out + xmlText(raw.slice(from));
}

/** The prefixes a part binds to any of these namespaces, '' for the default one: the prefix itself is the author's choice. */
function prefixesOf(xml: string, namespaces: ReadonlySet<string>): Set<string> {
  const prefixes = new Set<string>();
  for (const match of xml.matchAll(/\sxmlns(?::([\w.-]+))?\s*=\s*["']([^"']*)["']/g)) {
    if (namespaces.has(match[2]!)) prefixes.add(match[1] ?? ''); // safe: group 2 always takes part in a match
  }
  return prefixes;
}

/** A tag's name inside those namespaces, or null when it is another namespace's. */
function localName(name: string, prefixes: ReadonlySet<string>): string | null {
  const colon = name.indexOf(':');
  return prefixes.has(colon < 0 ? '' : name.slice(0, colon)) ? name.slice(colon + 1) : null;
}

const WORD_NAMESPACES = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
const ODT_TEXT_NAMESPACE = new Set(['urn:oasis:names:tc:opendocument:xmlns:text:1.0']);
const WORD_MAIN = /wordprocessingml\.(?:document|template)\.main\+xml$|ms-word\.(?:document|template)\.macroEnabled\.main\+xml$/;
/** The parts a .docx keeps apart from its body: footnotes, endnotes, headers and footers (#223). Comments stay out. */
const WORD_NOTES = /wordprocessingml\.(?:footnotes|endnotes|header|footer)\+xml$/;

/** Paragraphs in the order they end. A paragraph inside another, as in a text box, doesn't cut the outer one short. */
class Paragraphs {
  readonly lines: string[] = [];
  private readonly open: string[] = [];
  start(): void {
    this.open.push('');
  }
  end(): void {
    if (this.open.length > 0) this.lines.push(this.open.pop()!); // safe: open isn't empty
  }
  add(text: string): void {
    if (this.open.length > 0) this.open[this.open.length - 1] += text;
  }
  finish(): string[] {
    while (this.open.length > 0) this.end();
    return this.lines;
  }
}

/**
 * One WordprocessingML part's paragraphs. Only `t` holds text, so a tracked deletion (`delText`) isn't read, and a run
 * marked hidden (`vanish`) is left out too (#278): the SSN guard reads every part whole, so it still sees both.
 */
function wordLines(xml: string): string[] {
  const prefixes = prefixesOf(xml, WORD_NAMESPACES);
  if (prefixes.size === 0) throw new Error('not a Word part');
  const paragraphs = new Paragraphs();
  let textFrom = -1;
  let inRun = false;
  let hidden = false;
  for (const tag of tagsOf(xml)) {
    const local = localName(tag.name, prefixes);
    if (local === 'r') {
      inRun = !tag.closing && !tag.empty;
      hidden = false;
    } else if (local === 'vanish' && inRun && !tag.closing) {
      hidden = !/\bval\s*=\s*["'](?:0|false|off)["']/.test(xml.slice(tag.start, tag.end));
    } else if (hidden) {
      textFrom = -1;
    } else if (local === 'p') {
      if (tag.empty) paragraphs.lines.push('');
      else if (tag.closing) paragraphs.end();
      else paragraphs.start();
    } else if (local === 't') {
      if (tag.closing && textFrom >= 0) paragraphs.add(runText(xml.slice(textFrom, tag.start)));
      textFrom = tag.closing || tag.empty ? -1 : tag.end + 1;
    } else if (local === 'tab' || local === 'br' || local === 'cr') {
      paragraphs.add(' ');
    }
  }
  return paragraphs.finish().map((line) => line.replace(/[ \t]+/g, ' ').trim());
}

/** A .docx's parts of one content type, by its [Content_Types].xml overrides: the names are the writer's choice. */
function docxParts(zip: Buffer, type: RegExp): string[] {
  const overrides = [...zipText(zip, '[Content_Types].xml').matchAll(/<(?:[\w.-]+:)?Override\b[^>]*>/g)].map((match) => attrsOf(match[0]));
  return overrides.filter((attrs) => type.test(attrs.ContentType ?? '')).map((attrs) => (attrs.PartName ?? '').replace(/^\//, ''));
}

/** A .docx's footnotes, endnotes, headers and footers, in that file's order, one paragraph to a line. '' when it has none. */
export function docxSideText(zip: Buffer): string {
  const sides = docxParts(zip, WORD_NOTES).map((part) => zipText(zip, part)).filter((xml) => xml !== '');
  return sides.flatMap(wordLines).join('\n');
}

/**
 * A .docx: its main part, found by its content type and not by a name, then its footnotes, endnotes, headers and footers,
 * one paragraph to a line. Deleted text is not read. A file with no main part isn't a Word file, and fails: it never reads
 * as empty text, which the SSN guard would count as scanned.
 */
export function docxText(zip: Buffer): string {
  const main = zipText(zip, docxParts(zip, WORD_MAIN)[0] ?? '');
  if (main === '') throw new Error('not a Word file');
  const side = docxSideText(zip);
  return [...wordLines(main), ...(side === '' ? [] : [side])].join('\n');
}

/**
 * An OpenDocument text file: content.xml, one paragraph or heading to a line. A file with no such part fails, and a
 * tracked deletion, which it keeps apart in `tracked-changes`, is not read.
 */
export function odtText(zip: Buffer): string {
  const xml = zipText(zip, 'content.xml');
  const prefixes = prefixesOf(xml, ODT_TEXT_NAMESPACE);
  if (prefixes.size === 0) throw new Error('not an OpenDocument text file');
  const paragraphs = new Paragraphs();
  let tracked = 0;
  let textFrom = 0;
  for (const tag of tagsOf(xml)) {
    if (tracked === 0) paragraphs.add(runText(xml.slice(textFrom, tag.start)));
    textFrom = tag.end + 1;
    const local = localName(tag.name, prefixes);
    if (local === 'tracked-changes' && !tag.empty) tracked += tag.closing ? -1 : 1;
    else if (tracked > 0) continue;
    else if (local === 'p' || local === 'h') {
      if (tag.empty) paragraphs.lines.push('');
      else if (tag.closing) paragraphs.end();
      else paragraphs.start();
    } else if (local === 'tab') paragraphs.add('\t');
    else if (local === 'line-break') paragraphs.add('\n');
    else if (local === 's') paragraphs.add(' ');
  }
  return paragraphs.finish().join('\n');
}

// RTF groups that hold no text of the document. A group starting \* is skipped too, as the RTF spec says of one a reader
// does not know.
const RTF_SKIP = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'listtable',
  'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'mmathPr', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf',
]);
const RTF_TEXT: Readonly<Record<string, string>> = {
  par: '\n', line: '\n', row: '\n', sect: '\n', page: '\n', tab: '\t', cell: '\t',
  emdash: '\u2014', endash: '\u2013', lquote: '\u2018', rquote: '\u2019', ldblquote: '\u201c', rdblquote: '\u201d', bullet: '\u2022', emspace: ' ', enspace: ' ',
};

function rtfDecoder(codePage: number): TextDecoder {
  try {
    return new TextDecoder(`windows-${codePage}`);
  } catch {
    return new TextDecoder('windows-1252');
  }
}

/** The group state of an RTF read. hidden: \v hidden text or \deleted struck text, left out of the reader's text (#278). The SSN guard reads all of it. */
interface RtfGroup {
  skip: boolean;
  uc: number;
  hidden: boolean;
}

/** Where an RTF read is: the text so far, the bytes waiting to be decoded, and the open groups. */
interface RtfReader {
  out: string;
  pending: number[];
  decoder: TextDecoder;
  state: RtfGroup;
  stack: RtfGroup[];
  /** How many characters a \uN still replaces: the fallback that follows it. */
  fallback: number;
  /** Where the next character is, in the Latin-1 source. */
  i: number;
}

const rtfHidden = (reader: RtfReader): boolean => reader.state.skip || reader.state.hidden;

/** Decodes the bytes of the \'hh runs gathered so far, with the file's code page. */
function rtfFlush(reader: RtfReader): void {
  if (reader.pending.length > 0) reader.out += reader.decoder.decode(new Uint8Array(reader.pending));
  reader.pending = [];
}

/** The text a control symbol stands for: an escaped brace or backslash, a no-break space or hyphen, a line break. */
function rtfSymbolText(next: string): string {
  if (next === '\\' || next === '{' || next === '}') return next;
  if (next === '~') return ' ';
  if (next === '_') return '-';
  return next === '\n' || next === '\r' ? '\n' : '';
}

/** A backslash that starts no control word: a \'hh byte, \* (a group to skip), or a control symbol. Moves past it. */
function rtfSymbol(reader: RtfReader, source: string): void {
  const next = source[reader.i + 1] ?? '';
  if (next === "'") {
    const code = Number.parseInt(source.slice(reader.i + 2, reader.i + 4), 16);
    if (reader.fallback > 0) reader.fallback -= 1;
    else if (!rtfHidden(reader) && Number.isFinite(code)) reader.pending.push(code);
    reader.i += 4;
    return;
  }
  rtfFlush(reader);
  if (next === '*') reader.state.skip = true;
  else if (!rtfHidden(reader)) reader.out += rtfSymbolText(next);
  reader.i += 2;
}

/** A control word and its number, if it had one: the code page, \ucN, \binN, \uN, hidden text, a group to skip, or a text mark. */
function rtfWord(reader: RtfReader, name: string, param: number | null): void {
  rtfFlush(reader);
  const { state } = reader;
  if (name === 'ansicpg' && param !== null) reader.decoder = rtfDecoder(param);
  else if (name === 'uc' && param !== null) state.uc = param;
  else if (name === 'bin' && param !== null && param > 0) reader.i += param;
  else if (name === 'u' && param !== null) {
    if (!rtfHidden(reader)) reader.out += String.fromCodePoint(param < 0 ? param + 65536 : param);
    reader.fallback = state.uc;
  } else if (name === 'v' || name === 'deleted') state.hidden = param !== 0;
  else if (RTF_SKIP.has(name)) state.skip = true;
  else if (!rtfHidden(reader) && Object.hasOwn(RTF_TEXT, name)) reader.out += RTF_TEXT[name];
}

/** The backslash at the reader: a control word, or a symbol. */
function rtfControl(reader: RtfReader, source: string): void {
  const word = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(source.slice(reader.i, reader.i + 48));
  if (!word) {
    rtfSymbol(reader, source);
    return;
  }
  const [whole, name = '', digits] = word;
  reader.i += whole.length;
  rtfWord(reader, name, digits === undefined ? null : Number(digits));
}

/** A character of text: kept as a byte for the code page, unless a \uN fallback or a hidden group covers it. */
function rtfLiteral(reader: RtfReader, char: string): void {
  if (reader.fallback > 0) reader.fallback -= 1;
  else if (!rtfHidden(reader)) reader.pending.push(char.charCodeAt(0));
  reader.i += 1;
}

/** An RTF file's text, read with its own code page. Not RTF at all, or RTF that doesn't close, is an error. */
export function rtfText(bytes: Buffer): string {
  // Latin-1 keeps one character per byte, so \binN can skip bytes by index and \'hh runs can be decoded together.
  const source = bytes.toString('latin1');
  if (!source.startsWith('{\\rtf')) throw new Error('not rtf');
  const reader: RtfReader = { out: '', pending: [], decoder: rtfDecoder(1252), state: { skip: false, uc: 1, hidden: false }, stack: [], fallback: 0, i: 0 };
  while (reader.i < source.length) {
    const char = source.charAt(reader.i);
    if (char === '{') {
      rtfFlush(reader);
      reader.stack.push(reader.state);
      reader.state = { ...reader.state };
      reader.i += 1;
    } else if (char === '}') {
      rtfFlush(reader);
      reader.state = reader.stack.pop() ?? reader.state;
      reader.fallback = 0;
      reader.i += 1;
    } else if (char === '\\') rtfControl(reader, source);
    else if (char === '\n' || char === '\r') reader.i += 1;
    else rtfLiteral(reader, char);
  }
  // A \bin that runs past the end lands here too, with its group still open.
  if (reader.stack.length > 0) throw new Error('not closed');
  rtfFlush(reader);
  return reader.out;
}

// --- Word 97 to 2003 ------------------------------------------------------------------------------------------------

const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const END_OF_CHAIN = 0xfffffffe;
const NO_STREAM = 0xffffffff;

/** How a compound file's sectors are found, and how a chain of them follows through an allocation table. */
interface CfbSectors {
  /** No chain or table can be longer than the file has sectors. */
  maxSectors: number;
  sector(n: number): Buffer;
  chain(start: number, table: readonly number[], limit?: number): number[];
}

function cfbSectors(file: Buffer, sectorSize: number): CfbSectors {
  // No chain or table can be longer than the file has sectors, so a file that points at itself stops here.
  const maxSectors = Math.ceil(file.length / sectorSize);
  return {
    maxSectors,
    // Sector 0 starts one sector in: the header fills the first sector, whatever the sector size.
    sector: (n) => file.subarray((n + 1) * sectorSize, (n + 2) * sectorSize),
    chain(start, table, limit = maxSectors) {
      const out: number[] = [];
      for (let at = start; at !== END_OF_CHAIN && at !== NO_STREAM; at = table[at] ?? END_OF_CHAIN) {
        out.push(at);
        if (out.length > limit) throw new Error('a sector chain with no end');
      }
      return out;
    },
  };
}

/** The file allocation table: the sectors that hold it are 109 listed in the header, and the rest in the DIFAT chain. */
function cfbFat(file: Buffer, sectors: CfbSectors): number[] {
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i += 1) {
    const value = file.readUInt32LE(76 + i * 4);
    if (value < END_OF_CHAIN) fatSectors.push(value);
  }
  let difat = file.readUInt32LE(68);
  for (let seen = 0; difat < END_OF_CHAIN; seen += 1) {
    if (seen > sectors.maxSectors) throw new Error('a DIFAT chain with no end');
    const page = sectors.sector(difat);
    for (let i = 0; i + 4 < page.length; i += 4) {
      const value = page.readUInt32LE(i);
      if (value < END_OF_CHAIN) fatSectors.push(value);
    }
    difat = page.readUInt32LE(page.length - 4);
  }
  const fat: number[] = [];
  for (const at of fatSectors) {
    const page = sectors.sector(at);
    for (let i = 0; i + 4 <= page.length; i += 4) fat.push(page.readUInt32LE(i));
  }
  return fat;
}

interface CfbEntry {
  name: string;
  start: number;
  size: number;
}

/** The directory entries: each stream's name, first sector and size. The first is the root. */
function cfbEntries(file: Buffer, sectors: CfbSectors, fat: readonly number[]): CfbEntry[] {
  const directory = Buffer.concat(sectors.chain(file.readUInt32LE(48), fat).map((n) => sectors.sector(n)));
  const entries: CfbEntry[] = [];
  for (let at = 0; at + 128 <= directory.length; at += 128) {
    const nameBytes = directory.readUInt16LE(at + 64);
    if (directory[at + 66] === 0 || nameBytes < 2 || nameBytes > 64) continue;
    entries.push({ name: directory.toString('utf16le', at, at + nameBytes - 2), start: directory.readUInt32LE(at + 116), size: directory.readUInt32LE(at + 120) });
  }
  return entries;
}

/** Reads a stream held in the mini stream, the small streams packed in the root's own data. */
function cfbMiniReader(file: Buffer, sectors: CfbSectors, fat: readonly number[], miniStream: Buffer, miniSize: number): (start: number, size: number) => Buffer {
  const miniFat: number[] = [];
  const miniFatBytes = Buffer.concat(sectors.chain(file.readUInt32LE(60), fat).map((n) => sectors.sector(n)));
  for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(miniFatBytes.readUInt32LE(i));
  return (start, size) =>
    Buffer.concat(sectors.chain(start, miniFat, Math.ceil(miniStream.length / miniSize)).map((n) => miniStream.subarray(n * miniSize, (n + 1) * miniSize))).subarray(0, size);
}

/** The named streams of a compound file (the container .doc files use), by name. */
export function cfbStreams(file: Buffer, names: readonly string[]): Map<string, Buffer> {
  if (file.length < 512 || !file.subarray(0, 8).equals(CFB_MAGIC)) throw new Error('not a compound file');
  const sectorSize = 1 << file.readUInt16LE(30);
  const miniSize = 1 << file.readUInt16LE(32);
  if ((sectorSize !== 512 && sectorSize !== 4096) || miniSize !== 64) throw new Error('not a compound file');
  const cutoff = file.readUInt32LE(56);
  const sectors = cfbSectors(file, sectorSize);
  const fat = cfbFat(file, sectors);
  const regular = (start: number, size: number) => Buffer.concat(sectors.chain(start, fat).map((n) => sectors.sector(n))).subarray(0, size);
  const entries = cfbEntries(file, sectors, fat);
  const root = entries[0];
  if (!root) throw new Error('a compound file with no root');
  const mini = cfbMiniReader(file, sectors, fat, regular(root.start, root.size), miniSize);

  const streams = new Map<string, Buffer>();
  for (const name of names) {
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry) continue;
    if (entry.size > MAX_PART_BYTES) throw new TooLarge('too-large');
    streams.set(name, entry.size < cutoff ? mini(entry.start, entry.size) : regular(entry.start, entry.size));
  }
  return streams;
}

const FIB_FLAGS = 0x0a;
const FIB_ENCRYPTED = 0x0100;
const FIB_TABLE_1 = 0x0200;
const CLX_INDEX = 33;

/**
 * A Word 97 to 2003 file's text, from its piece table ([MS-DOC]). Every story is read: the body, footnotes, headers and
 * the rest, so the SSN guard sees them all. Field codes are dropped and their results kept. An encrypted file is an error.
 */
export function docText(file: Buffer): string {
  const streams = cfbStreams(file, ['WordDocument', '0Table', '1Table']);
  const word = streams.get('WordDocument');
  if (!word || word.length < 0x200) throw new Error('not a Word file');
  const flags = word.readUInt16LE(FIB_FLAGS);
  if (flags & FIB_ENCRYPTED) throw new Error('encrypted');
  const table = streams.get(flags & FIB_TABLE_1 ? '1Table' : '0Table');
  if (!table) throw new Error('no table stream');
  // FIB: 32 bytes, then counted arrays of shorts and longs, then the pairs of offset and length. Word 97 onward.
  const shorts = word.readUInt16LE(32);
  const longs = word.readUInt16LE(34 + shorts * 2);
  const pairs = 34 + shorts * 2 + 2 + longs * 4 + 2;
  const clxAt = word.readUInt32LE(pairs + CLX_INDEX * 8);
  const clxLength = word.readUInt32LE(pairs + CLX_INDEX * 8 + 4);
  const clx = table.subarray(clxAt, clxAt + clxLength);
  let at = 0;
  while (at < clx.length && clx[at] === 1) at += 3 + clx.readUInt16LE(at + 1);
  if (clx[at] !== 2) throw new Error('no piece table');
  const size = clx.readUInt32LE(at + 1);
  const plc = clx.subarray(at + 5, at + 5 + size);
  const pieces = (size - 4) / 12;
  if (!Number.isInteger(pieces)) throw new Error('a piece table of the wrong size');
  const latin = new TextDecoder('windows-1252');
  let text = '';
  for (let n = 0; n < pieces; n += 1) {
    const count = plc.readUInt32LE((n + 1) * 4) - plc.readUInt32LE(n * 4);
    const fc = plc.readUInt32LE((pieces + 1) * 4 + n * 8 + 2);
    const compressed = (fc & 0x40000000) !== 0;
    const offset = fc & 0x3fffffff;
    const from = compressed ? offset / 2 : offset;
    const to = from + (compressed ? count : count * 2);
    if (count < 0 || to > word.length) throw new Error('a piece past the end of the file');
    text += compressed ? latin.decode(word.subarray(from, to)) : word.toString('utf16le', from, to);
  }
  return wordMarks(text);
}

/** Word's marks in text as a person reads it. A field's code, between 0x13 and 0x14, is dropped; its result, to 0x15, stays. */
export function wordMarks(text: string): string {
  let out = '';
  // One entry for each open field: whether it has reached its result.
  const fields: boolean[] = [];
  for (const char of text) {
    if (char === '\u0013') fields.push(false);
    else if (char === '\u0014') fields[fields.length - 1] = true;
    else if (char === '\u0015') fields.pop();
    else if (fields.includes(false)) continue;
    else if (char === '\r' || char === '\u000b' || char === '\u000c') out += '\n';
    else if (char === '\u0007') out += '\t';
    else if (char === '\u001e') out += '-';
    else if (char === '\u00a0') out += ' ';
    else if (char >= ' ' || char === '\t' || char === '\n') out += char;
  }
  return out;
}
