// SPDX-License-Identifier: Apache-2.0
// Single C.F.R. sections from govinfo's annual edition, one XML file each. eCFR's robots file disallows its API path, and a
// title's eCFR bulk file can be far larger than a few sections need (title 26 was 84 MB on 2026-11-13). govinfo's link
// service answers a section number with its file in the most recent edition; that edition's PDF is the official text.
import { htmlText, type Section } from './parse.ts';

/** "1.83-2" is part 1, section 83-2: the two halves govinfo's link service asks for. */
const SECTION = /^(\d{1,4})\.(\d{1,5}[A-Z]?(?:-\d{1,3}[A-Za-z]?)?)$/;

/** The link service's address for a section in the most recent edition: XML to read, PDF for a person. */
export function cfrAnnualUrl(title: number, section: string, type: 'xml' | 'pdf' = 'xml'): string {
  const match = SECTION.exec(section);
  if (!match || !Number.isInteger(title)) throw new Error(`bad C.F.R. section ${title} ${section}`);
  return `https://www.govinfo.gov/link/cfr/${title}/${match[1]}?sectionnum=${match[2]}&year=mostrecent&link-type=${type}`;
}

/** The PDF beside the XML file the link service sent a download to, so the reading link is the edition the text came from. */
export function cfrAnnualPdf(xmlUrl: string): string | null {
  const match = /^https:\/\/www\.govinfo\.gov\/content\/pkg\/(CFR-\d{4}-title\d+-vol\d+)\/xml\/(\1-sec[\w.-]+)\.xml$/.exec(xmlUrl);
  return match ? `https://www.govinfo.gov/content/pkg/${match[1]}/pdf/${match[2]}.pdf` : null;
}

/** One section of an annual CFR edition, with the date its volume is revised as of. */
export interface CfrAnnualSection {
  /** "2025-04-01": the date the edition's volume is revised as of. Amendments after it are not in the text. */
  revised: string;
  section: Section;
}

// Notes about the rule, not its words: amendment history, editor's notes, authority and source lines.
const NOT_TEXT = /<(CITA|EDNOTE|SECAUTH|AUTH|SOURCE)\b[\s\S]*?<\/\1>/g;
// One line per paragraph, heading or table row, in reading order.
const BLOCK = /<(P|FP|HD|BOXHD|ROW)\b[^>]*>([\s\S]*?)<\/\1>/g;
const CELL = /<(CHED|ENT)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1>)/g;
/** Every tag this reader knows. Any other might carry words it would drop or misread, so the section fails instead. */
const KNOWN = new Set(['SECTION', 'SECTNO', 'SUBJECT', 'P', 'FP', 'HD', 'E', 'EXAMPLE', 'GPOTABLE', 'BOXHD', 'CHED', 'ROW', 'ENT']);

/**
 * The file is pretty-printed: each line break it adds sits beside a tag, followed by four spaces a level. A space past a
 * multiple of four is the text's own (`</E>` then " Except as provided"), so it stays; the rest goes. Every line break in
 * the 26 CFR files read on 2026-11-13 sits beside a tag.
 */
function unindent(xml: string): string {
  return xml.replace(/(?<=>)\n( *)|\n( *)(?=<)/g, (_match, after?: string, before?: string) => ' '.repeat((after ?? before ?? '').length % 4));
}

/** One section's file, read whole. Throws when the file is cut short, holds another section, or has text this can't read. */
export function cfrAnnualSection(xml: string, title: number, number: string): CfrAnnualSection {
  const where = `${title} C.F.R. § ${number}`;
  if (!/<\/CFRGRANULE>\s*$/.test(xml)) throw new Error(`${where}: the file is cut short, with no closing CFRGRANULE`);
  const field = (tag: string) => htmlText(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1] ?? '');
  if (field('CFRTITLE') !== String(title)) throw new Error(`${where}: the file is from title ${field('CFRTITLE') || 'unknown'}`);
  const revised = field('DATE');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(revised)) throw new Error(`${where}: the file does not say which edition it is`);
  const sections = [...xml.matchAll(/<SECTION\b[^>]*>([\s\S]*?)<\/SECTION>/g)];
  if (sections.length !== 1) throw new Error(`${where}: the file holds ${sections.length} sections, not one`);
  const body = unindent(sections[0]![1]!);
  const sectno = htmlText(/<SECTNO>([\s\S]*?)<\/SECTNO>/.exec(body)?.[1] ?? '');
  // The annual edition prints a section number's hyphen as a hyphen or a dash, by edition (seen 2026-11-18:
  // 26 C.F.R. 301.6109-1 came with U+2013). Either is the same number; any other difference is another section.
  if (sectno.replace(/[\u2010-\u2015\u2212]/g, '-') !== `§ ${number}`) throw new Error(`${where}: the file holds ${sectno || 'no section number'}`);
  const heading = htmlText(/<SUBJECT>([\s\S]*?)<\/SUBJECT>/.exec(body)?.[1] ?? '').replace(/\.$/, '');
  if (!heading) throw new Error(`${where}: the file gives no heading`);
  const text = body
    .replace(/<(SECTNO|SUBJECT)>[\s\S]*?<\/\1>/g, ' ')
    .replace(NOT_TEXT, ' ')
    // A printed page number, not a word; the text around it already has its own spaces.
    .replace(/<PRTPAGE\b[^>]*\/>/g, '')
    // A built-up fraction after a whole number ("2<FR>1/2</FR> months") would read as 21/2.
    .replace(/<FR>([\s\S]*?)<\/FR>/g, ' $1');
  for (const [, name] of text.matchAll(/<\/?([A-Za-z][\w-]*)/g)) {
    if (!KNOWN.has(name!)) throw new Error(`${where} uses <${name}>, which this reader doesn't read yet`);
  }
  const lines: string[] = [];
  for (const [, tag, inner] of text.matchAll(BLOCK)) {
    const row = tag === 'ROW' || tag === 'BOXHD';
    // Text in a row but outside its cells would be dropped with no other check to see it.
    const loose = row ? htmlText(inner!.replace(CELL, ' ')) : '';
    if (loose) throw new Error(`${where} has text in a table row outside any cell: "${loose.slice(0, 80)}"`);
    const line = row ? [...inner!.matchAll(CELL)].map((cell) => htmlText(cell[2] ?? '')).join(' | ') : htmlText(inner!);
    if (line.replace(/[|\s]/g, '')) lines.push(line);
  }
  const rest = htmlText(text.replace(BLOCK, ' '));
  if (rest) throw new Error(`${where} has text outside any paragraph: "${rest.slice(0, 80)}"`);
  if (lines.length === 0) throw new Error(`${where}: the file holds no text`);
  return { revised, section: { number, heading, lines } };
}
