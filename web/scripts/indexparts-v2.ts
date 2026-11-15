// SPDX-License-Identifier: Apache-2.0
// Index format v2 (W5 E4): page-bounded parts with a header line, for a staging AI Search instance first.
//
// v1 (indexparts.ts) writes one object per document with a [[doc:<id> p:<n>]] marker every ~150 words, and AI
// Search cuts it into 512-token chunks wherever it likes: a chunk can span pages, carry no marker at all (7.5% of
// retrieved passages, mostly CSV, XML and tables) and says nothing about which document it is. v2 writes one
// object per page, split only past MAX_PART_CHARS (about 450 tokens, so AI Search keeps each object as one chunk),
// and every object opens with:
//
//   <control number> | <title from the file name> | <date from the name> | <document type> | <source class> | <tab>
//   [[doc:<id> p:<n>]]
//   <page text>
//
// The header gives keyword and vector search the document's identity (a question naming an exhibit, a date or a
// kind of filing now matches it), and it sits before the marker, so passages.ts pageSegments never quotes it.
// Keys keep v1's shape, text/<doc_id>.p<N>.md (N counts the document's parts from 1), so worker/citations.ts
// docIdFromKey maps every chunk to its document unchanged; keys stay opaque (no names). Each part also carries up
// to five custom metadata fields for filters once the instance has the schema (partMetadata).
import { docTitle } from '../src/scripts/doc-titles.ts';
import { docTypeWords } from '../src/scripts/doc-type.ts';
import { isCourtRecord, isDraft, sourceKind } from '../worker/source-kind.ts';
import { marker, partKey, plainLetters, type IndexPart, type PageText } from './indexparts.ts';

/** About 450 tokens with the header and marker: one AI Search chunk at the instance's 512 (as the law library). */
export const MAX_PART_CHARS = 1800;
/** Each header field is cut here, so a long file name cannot crowd out the page (six fields, about 400 at most). */
const MAX_FIELD_CHARS = 120;

/** What the room knows about a document, from its D1 row. Names stay in the index text, never in keys. */
export interface DocFacts {
  id: string;
  /** "DOE-000412" style control number, or null before the document is numbered. */
  control: string | null;
  name: string;
  folder: string;
  kind: string;
}

export interface PageTextV2 extends PageText {
  ocr?: boolean;
}

export interface IndexPartV2 extends IndexPart {
  /** x-amz-meta-* values for the instance's custom metadata schema (V2_METADATA_SCHEMA). */
  metadata: Record<string, string>;
}

/** The custom metadata schema the staging instance is created with (at most five fields). */
export const V2_METADATA_SCHEMA = [
  { field_name: 'doc_kind', data_type: 'text' },
  { field_name: 'side', data_type: 'text' },
  { field_name: 'doc_date', data_type: 'datetime' },
  { field_name: 'control', data_type: 'number' },
  { field_name: 'ocr', data_type: 'boolean' },
] as const;

const DASHED_SSN = /\b(\d{3})-(\d{2})-(\d{4})\b/g;

/**
 * Numbers in the Social Security number form ddd-dd-dddd that could belong to a person. The Social Security
 * Administration never issues area 000 or 666, group 00 or serial 0000, so those are placeholders ("000-00-0000");
 * every other match counts, area 900 to 999 too (an ITIN is a person's tax number). EINs (dd-ddddddd) never match.
 */
export function ssnShaped(text: string): number {
  let count = 0;
  for (const [, area, group, serial] of text.matchAll(DASHED_SSN)) {
    if (area === '000' || area === '666' || group === '00' || serial === '0000') continue;
    count += 1;
  }
  return count;
}

/** Counts of the three nine-digit forms a Social Security number takes, for a review before any upload. */
export function nineDigitScan(text: string): { dashed: number; spaced: number; plain: number } {
  return {
    dashed: ssnShaped(text),
    spaced: (text.match(/\b\d{3} \d{2} \d{4}\b/g) ?? []).length,
    plain: (text.match(/\b\d{9}\b/g) ?? []).length,
  };
}

/**
 * Document text is data: "[[" is broken up so a file cannot forge an index marker, and the single-bracket cite
 * forms the model writes ([doc:..], 【doc:..】, [law:..]) lose their bracket, so a document cannot plant a cite.
 */
export function neutralizeText(text: string): string {
  return plainLetters(text).replace(/\[(?=\[)/g, '[ ').replace(/([[【])(\s*(?:doc|law)\s*:)/gi, '$1 $2');
}

/**
 * The document date the file name carries (DocType_Abbr__YYYYMMDD__Party, scripts/matter/catalog.ts): "20121122"
 * reads "2012-11-22", "201211" reads "2012-11", "2012" reads "2012", an ISO segment stays, a range keeps its start.
 * Null when the name has no date segment.
 */
export function nameDate(name: string): string | null {
  for (const segment of name.replace(/\.[A-Za-z0-9]{1,5}$/, '').split('__').slice(1)) {
    const iso = /^((?:19|20)\d{2})-(\d{2})(?:-(\d{2}))?$/.exec(segment);
    if (iso) return [iso[1], iso[2], iso[3]].filter(Boolean).join('-');
    const compact = /^((?:19|20)\d{2})(\d{2})?(\d{2})?(?:-\d{4,8})?$/.exec(segment);
    if (compact) return [compact[1], compact[2], compact[3]].filter(Boolean).join('-');
  }
  return null;
}

/** The DocType: the name's first "__" segment, the part the convention puts first. */
function docTypeOf(name: string): string {
  const stem = name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  return stem.includes('__') ? stem.split('__')[0]! : ''; // safe: split always has a first part
}

/** Source classes: what kind of statement a page is, the distinction the allegation rules turn on. */
export type SourceClass =
  | 'order' | 'court-record' | 'pleading' | 'draft' | 'correspondence' | 'press' | 'public-record' | 'analysis' | 'evidence';

/**
 * The source class, from worker/source-kind.ts (the rules Ask's allegation guard uses), so the header and the guard
 * never disagree: a party's filing is a pleading, a letter or email is correspondence, either one a draft when not
 * sent or filed, a press item is press and the room's own notes are analysis. A record splits by generic words into
 * a court's order, another court record (summons, register, transcript), a public record (regulatory filings,
 * Secretary of State and SEC forms) or evidence. Never from names.
 */
export function sourceClass(facts: Pick<DocFacts, 'name' | 'folder'>): SourceClass {
  const kind = sourceKind(facts);
  if (kind === 'press') return 'press';
  if (kind === 'summary') return 'analysis';
  if (kind === 'filing') return isDraft(facts) ? 'draft' : 'pleading';
  if (kind === 'letter' || kind === 'email') return isDraft(facts) ? 'draft' : 'correspondence';
  const folder = facts.folder.toLowerCase();
  const type = docTypeOf(facts.name).toLowerCase();
  if (/^(?:order|judgment|minute[-_ ]?order)\b/.test(type) || /(?:^|\/)orders?(?:\/|$)/.test(folder)) return 'order';
  if (isCourtRecord(facts)) return 'court-record';
  if (/public[-_ ]records?|regulatory[-_ ]filings?/.test(folder) || /^(?:form[-_ ]?d|form[-_ ]?adv|iapd|sos|articles)\b/.test(type)) return 'public-record';
  return 'evidence';
}

/** The binder tab: the first folder of the path ("08-Pleadings"), or "" at the root. */
export function tabOf(folder: string): string {
  return folder.split('/')[0] ?? '';
}

/** The header line every part of a document opens with. It never holds a marker or a cite bracket. */
export function headerLine(facts: DocFacts): string {
  const type = docTypeOf(facts.name);
  const fields = [
    facts.control ?? 'Not numbered',
    docTitle(facts.name),
    nameDate(facts.name) ?? 'undated',
    type ? docTypeWords(type).toLowerCase() : facts.kind,
    sourceClass(facts),
    tabOf(facts.folder) || 'root',
  ];
  // Every field keeps its place (worker/ai-search.ts withoutV2Header counts six), so a long one is cut, not the line.
  return fields
    .map((field) => field.replace(/[[\]【】|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim())
    .map((field) => (field.length > MAX_FIELD_CHARS ? `${field.slice(0, MAX_FIELD_CHARS - 1).trimEnd()}…` : field))
    .join(' | ');
}

/** Splits a line longer than the budget at sentence ends, else at spaces, else anywhere. */
export function splitLine(line: string, budget: number): string[] {
  const out: string[] = [];
  let rest = line;
  while (rest.length > budget) {
    const window = rest.slice(0, budget);
    const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('; '));
    const space = window.lastIndexOf(' ');
    const at = sentence > budget / 3 ? sentence + 1 : space > budget / 3 ? space : budget;
    out.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * A page's text in pieces of at most `budget` characters, whole lines where they fit. For a table (CSV) the first
 * line, its column names, opens every later piece too, so a row far down the sheet still says what its cells are.
 */
export function pagePieces(text: string, budget: number, table = false): string[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().split('\n');
  const columns = table && lines.length > 1 && lines[0]!.length <= budget / 4 ? lines[0]! : null; // safe: length checked
  const room = budget - (columns ? columns.length + 1 : 0);
  const out: string[] = [];
  let current: string[] = [];
  let size = 0;
  const flush = () => {
    if (current.some((line) => line.trim())) out.push(current.join('\n').trim());
    current = [];
    size = 0;
  };
  for (const line of lines.flatMap((l) => splitLine(l, room))) {
    if (size + line.length + 1 > room && current.length) flush();
    if (current.length === 0 && columns && out.length > 0) current.push(columns);
    current.push(line);
    size += line.length + 1;
  }
  flush();
  return out;
}

/** The ISO datetime a name date stands for (its first day), for the datetime metadata field. */
function isoStart(date: string | null): string | null {
  if (!date) return null;
  const [y, m = '01', d = '01'] = date.split('-');
  return `${y}-${m}-${d}T00:00:00Z`;
}

/** Custom metadata for a part (x-amz-meta-*), values at most 64 bytes, the filterable prefix. */
export function partMetadata(facts: DocFacts, ocr: boolean): Record<string, string> {
  const type = docTypeOf(facts.name);
  const out: Record<string, string> = {
    doc_kind: (type ? docTypeWords(type).toLowerCase() : facts.kind).slice(0, 64),
    side: sourceClass(facts),
    ocr: ocr ? 'true' : 'false',
  };
  const date = isoStart(nameDate(facts.name));
  if (date) out.doc_date = date;
  const seq = facts.control ? /(\d+)$/.exec(facts.control)?.[1] : undefined;
  if (seq) out.control = String(Number(seq));
  return out;
}

/** A document's v2 parts: one per page, more for a page past MAX_PART_CHARS, each with the header and marker. */
export function buildPageParts(facts: DocFacts, pages: readonly PageTextV2[], maxChars = MAX_PART_CHARS): IndexPartV2[] {
  const header = headerLine(facts);
  const table = facts.kind === 'csv' || /\.csv$/i.test(facts.name);
  const parts: IndexPartV2[] = [];
  for (const page of [...pages].sort((a, b) => a.n - b.n)) {
    const head = `${header}\n${marker(facts.id, page.n)}\n`;
    for (const piece of pagePieces(neutralizeText(page.text), maxChars - head.length - 1, table)) {
      parts.push({ key: partKey(facts.id, parts.length + 1), body: `${head}${piece}\n`, metadata: partMetadata(facts, page.ocr === true) });
    }
  }
  return parts;
}
