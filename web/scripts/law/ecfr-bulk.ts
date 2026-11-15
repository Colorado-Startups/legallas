// SPDX-License-Identifier: Apache-2.0
// Whole parts of the Code of Federal Regulations from govinfo's eCFR bulk data: one XML file per title, the same text
// the eCFR site shows, published for machines. eCFR's own robots file disallows its /api/versioner/v1/full/ path, so a
// law pack that follows the file's rules reads the title from here and only links to ecfr.gov for a reader.
import { htmlText, type Section } from './parse.ts';

/** The govinfo bulk-data URL of one eCFR title. */
export function ecfrBulkUrl(title: number): string {
  return `https://www.govinfo.gov/bulkdata/ECFR/title-${title}/ECFR-title${title}.xml`;
}

/** One part of an eCFR title, with the date the title file says it was last amended through. */
export interface EcfrPart {
  /** "Oct. 19, 2026": the date the title file says it was last amended through. */
  amended: string;
  sections: Section[];
  /** Section numbers marked reserved. */
  reserved: string[];
}

// One line per paragraph, heading, table row or printed form line, in reading order. A table row's first, so a paragraph
// inside a cell stays in its row. FP-DASH, FP-1 and FP-2 are the lines of the forms and schedules the rules print.
const BLOCK = /<(TR|P|PSPACE|FP[\w-]*|FRP|HED|HD\d|TTITLE|CAPTION|MATH|GPH)\b[^>]*>([\s\S]*?)<\/\1>/g;
// Notes about the rule, not its words: authority, source, amendment history, editor's notes, links to later amendments.
const NOT_TEXT = /<(SECAUTH|CITA|EDNOTE|AUTH|SOURCE|XREF)\b[\s\S]*?<\/\1>/g;
/** A formula printed as a picture has no words to keep, so the text says one is missing rather than closing up over it. */
const FORMULA = ' [formula printed as an image; see the official text] ';

function withoutNotes(body: string): string {
  return (
    body
      .replace(NOT_TEXT, ' ')
      .replace(/<HEAD>[\s\S]*?<\/HEAD>/g, ' ')
      // A footnote mark ("the rule<SU>1</SU><FTREF/>") would read as part of the word before it. Any other superscript is
      // part of what the rule says, an exponent say, so it stays and says what it is.
      .replace(/<SU\b[^>]*>(?:(?!<\/SU>)[\s\S])*<\/SU>\s*<FTREF\s*\/>/g, ' ')
      .replace(/<sup\b[^>]*>\s*<a\b[\s\S]*?<\/sup>/g, ' ')
      .replace(/<(SU|sup)\b[^>]*>([\s\S]*?)<\/\1>/g, '^$2')
      .replace(/<img\b[^>]*>/g, FORMULA)
  );
}

// A formula outside any paragraph is a line of its own.
const READ = new RegExp(`${BLOCK.source}|${FORMULA.replace(/[[\]]/g, '\\$&')}`, 'g');

function blockLines(text: string): string[] {
  const lines: string[] = [];
  for (const match of text.matchAll(READ)) {
    const line = match[1] === 'TR' ? [...match[2]!.matchAll(/<(TD|TH)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((cell) => htmlText(cell[2]!)).join(' | ') : htmlText(match[2] ?? match[0]);
    if (line.replace(/[|\s]/g, '')) lines.push(line);
  }
  return lines;
}

/** Text no block above took. A tag this file hasn't used before would otherwise vanish without a word. */
function assertAllRead(text: string, where: string): void {
  const rest = htmlText(text.replace(READ, ' '));
  if (rest) throw new Error(`${where} has text the parser doesn't read: "${rest.slice(0, 80)}"`);
}

/** Text between sections: its headings are structure and its filing notice is boilerplate, so only the notes are kept. */
function noteLines(gap: string, part: number): string[] {
  if (/<DIV9\b/.test(gap)) throw new Error(`eCFR part ${part} has an appendix, which this parser has no place for yet`);
  const text = withoutNotes(gap.replace(/<EXTRACT\b(?:(?!<\/EXTRACT>)[\s\S])*?ATTENTION ELECTRONIC FILERS(?:(?!<\/EXTRACT>)[\s\S])*?<\/EXTRACT>/g, ' '));
  assertAllRead(text, `eCFR part ${part}, between sections`);
  return blockLines(text).map((line) => `Note printed before this section: ${line}`);
}

/** Throws when a title file was cut short, or a part it should hold is missing: a part must never come back partial. */
export function ecfrPart(titleXml: string, part: number): EcfrPart {
  if (!/<\/DLPSTEXTCLASS>\s*$/.test(titleXml)) throw new Error('the eCFR title file is cut short: no closing DLPSTEXTCLASS');
  const amended = htmlText(/<AMDDATE>([\s\S]*?)<\/AMDDATE>/.exec(titleXml)?.[1] ?? '').replace(/\s*\(.*\)$/, '');
  if (!amended) throw new Error('the eCFR title file does not say when it was last amended');
  const open = new RegExp(`<DIV5\\s+N="${part}"[^>]*TYPE="PART"[^>]*>`).exec(titleXml);
  if (!open) throw new Error(`eCFR part ${part} is not in the title file`);
  const end = titleXml.indexOf('</DIV5>', open.index);
  if (end < 0) throw new Error(`eCFR part ${part} never closes`);
  const xml = titleXml.slice(open.index + open[0].length, end);
  const sections: Section[] = [];
  const reserved: string[] = [];
  // Notes printed between sections (Regulation S's preliminary notes, say) belong to no section number, so each goes with
  // the section it comes before, marked as such, rather than being lost.
  let notes: string[] = [];
  let from = 0;
  for (const match of xml.matchAll(/<DIV8\s+N="([^"]+)"[^>]*>([\s\S]*?)<\/DIV8>/g)) {
    notes.push(...noteLines(xml.slice(from, match.index), part));
    from = match.index + match[0].length;
    const label = htmlText(match[1]!).replace(/^§+\s*/, '').replace(/\.$/, '');
    const head = htmlText(/<HEAD>([\s\S]*?)<\/HEAD>/.exec(match[2]!)?.[1] ?? '');
    const heading = head
      .replace(/^§+\s*\S+(?:\s*(?:-|\u2014|--)\s*\S+)?\s*/, '')
      .replace(/\.$/, '')
      .trim();
    const body = withoutNotes(match[2]!);
    assertAllRead(body, `17 C.F.R. § ${label}`.replace('17 C.F.R. ', 'C.F.R. '));
    const lines = blockLines(body);
    // Only a heading that says so makes a section reserved. Silence might be a layout this can't read.
    const isReserved = /\[\s*reserved\s*\]/i.test(head);
    if (isReserved && lines.length === 0) {
      reserved.push(label);
      continue;
    }
    // A span of numbers ("§§ 232.600-232.903") or a label no citation can name.
    if (!/^[0-9]+\.[0-9A-Za-z()-]+$/.test(label) || /^\d+\.[^-]*\d-\d+\.\d/.test(label)) throw new Error(`eCFR part ${part} has text under "${label}", which no citation can name`);
    // Everything was read (assertAllRead), so a section with no lines is one whose heading is its whole text: a form's name.
    sections.push({ number: label, heading, lines: [...notes, ...(lines.length > 0 ? lines : [heading])] });
    notes = [];
  }
  notes.push(...noteLines(xml.slice(from), part));
  if (notes.length > 0) sections.at(-1)?.lines.push(...notes);
  if (sections.length === 0) throw new Error(`eCFR part ${part} yielded no sections; check the file's layout`);
  return { amended, sections, reserved };
}
