// SPDX-License-Identifier: Apache-2.0
// Whole articles of the Colorado Revised Statutes from a title download at olls.info. Each article opens with its own
// list of sections, then gives them with their source notes and case annotations. Only the operative text is kept: the
// annotations belong to the state's ancillary publications (C.R.S. 2-5-118(2.5)), and the list is what proves no
// section went missing.
import { CRS_NOTE, CRS_SECTION, splitCrsHeading, type Section } from './parse.ts';

/** C.R.S. editions to try, newest first. A title the next edition doesn't have yet falls back to the current one. */
export const OLLS_EDITIONS = [2027, 2026] as const;

function titleName(title: number): string {
  return String(title).padStart(2, '0');
}

/** The OLLS URL of one Colorado Revised Statutes title as a Word file. */
export function ollsDocxUrl(edition: number, title: number): string {
  return `https://olls.info/crs/crs${edition}-title-${titleName(title)}.docx`;
}

/** The OLLS URL of one Colorado Revised Statutes title as a PDF. */
export function ollsPdfUrl(edition: number, title: number): string {
  return `https://olls.info/crs/crs${edition}-title-${titleName(title)}.pdf`;
}

/** One article of the Colorado Revised Statutes: its sections, and the numbers it lists that hold no text. */
export interface CrsArticle {
  sections: Section[];
  /** Numbers the article lists that hold no text: repealed or reserved. */
  empty: string[];
}

const PART_HEADING = /^PART\s+\d/;
const ARTICLE_LINE = /^ARTICLE \d+(?:\.\d+)?$/;
const REPEALED_TEXT = /^\(?(?:Repealed|Reserved)\.?\)?$/i;
const REPEALED_LINE = /\((?:Repealed|Reserved)\)\s*$/i;
/** A line that says a later version of a section follows, and not a note that happens to open with its number. */
const VERSION = /\((?:Effective|Repealed)\b/i;

/** A head's words: "Repealed statutes not revived. (1) ..." is a live section, and a title can run into a quotation. */
function headOf(rest: string): { heading: string; text: string } {
  const split = splitCrsHeading(rest);
  if (split.heading === 'Repealed' && /^[a-z]/.test(split.text)) {
    const whole = /^(.+?\.)\s+(.*)$/.exec(rest);
    return whole ? { heading: whole[1]!.replace(/\.$/, ''), text: whole[2]! } : { heading: rest.replace(/\.$/, ''), text: '' };
  }
  const quoted = !split.text ? /^(.+?\.)\s+(“.*)$/.exec(rest) : null;
  return quoted ? { heading: quoted[1]!.replace(/\.$/, ''), text: quoted[2]! } : split;
}

/**
 * The article's own list of sections, and where its text starts. The list ends where any number comes round again. A source
 * note before that means the text has already begun, so the article has no list. Other lines in a list (subpart headings, a
 * span of repealed numbers split over two lines) say nothing about what comes back, and are passed over.
 */
function articleList(lines: readonly string[], prefix: string): { listed: Map<string, boolean>; body: number } {
  const listed = new Map<string, boolean>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const head = CRS_SECTION.exec(line);
    if (head?.[1]?.startsWith(prefix)) {
      if (listed.has(head[1])) return { listed, body: i };
      listed.set(head[1], REPEALED_LINE.test(line));
    } else if (listed.size > 0 && /^Source:/.test(line)) {
      break;
    }
  }
  return { listed: new Map(), body: 0 };
}

/** The article's own lines, trimmed, from its heading to the next article's. */
function articleLines(paragraphs: readonly string[], title: number, article: string): string[] {
  const start = paragraphs.findIndex((line) => line.trim().toUpperCase() === `ARTICLE ${article}`);
  if (start < 0) throw new Error(`no ARTICLE ${article} in title ${title}`);
  const lines: string[] = [];
  for (const raw of paragraphs.slice(start + 1)) {
    const line = raw.trim();
    if (ARTICLE_LINE.test(line)) break;
    lines.push(line);
  }
  return lines;
}

/**
 * The sections the article's list names, each with text or marked empty. A number the list names must come back with text,
 * or be marked repealed; a section with a heading and no text must say it was repealed.
 */
function wholeSections(sections: readonly Section[], listed: ReadonlyMap<string, boolean>, repealed: ReadonlySet<string>, title: number, article: string): CrsArticle {
  const whole: Section[] = [];
  const empty = new Set<string>();
  for (const section of sections) {
    const words = section.lines.filter((line) => !REPEALED_TEXT.test(line));
    if (words.length > 0) whole.push({ ...section, lines: words });
    else if (repealed.has(section.number) || listed.get(section.number) || section.lines.length > 0) empty.add(section.number);
    else throw new Error(`§ ${section.number} has a heading and no text, and nothing says it was repealed; check the download's layout`);
  }
  const found = new Set(sections.map((section) => section.number));
  const missing = [...listed].filter(([number, gone]) => !gone && !found.has(number)).map(([number]) => number);
  if (missing.length > 0) throw new Error(`article ${article} of title ${title} lists ${missing.join(', ')} and doesn't hold them`);
  for (const [number, gone] of listed) {
    if (gone && !found.has(number)) empty.add(number);
  }
  if (whole.length === 0) throw new Error(`article ${article} of title ${title} yielded no sections; check the download's layout`);
  return { sections: whole, empty: [...empty] };
}

/**
 * One article, whole. A number the article's list names must come back with text, or be marked repealed; a section with a
 * heading and no text must say it was repealed. Anything else fails, because a layout change must not build a partial act.
 */
export function crsWholeArticle(paragraphs: readonly string[], title: number, article: string): CrsArticle {
  const lines = articleLines(paragraphs, title, article);
  const prefix = `${title}-${article}-`;
  const { listed, body } = articleList(lines, prefix);
  const order = [...listed.keys()];
  const sections: Section[] = [];
  const repealed = new Set<string>();
  let current: Section | null = null;
  let inNotes = false;
  for (const line of lines.slice(body)) {
    const head = CRS_SECTION.exec(line);
    if (head?.[1]?.startsWith(prefix)) {
      const number = head[1];
      // Inside a section's notes, a line opening on a number at or before this one is a note about that section.
      const here = current ? order.indexOf(current.number) : -1;
      const there = order.indexOf(number);
      const isNote = inNotes && order.length > 0 && there >= 0 && there <= here && !(there === here && VERSION.test(line));
      if (!isNote) {
        const { heading, text } = headOf(head[2]!);
        if (heading === 'Repealed' || REPEALED_TEXT.test(heading) || REPEALED_LINE.test(line)) repealed.add(number);
        inNotes = false;
        const earlier: Section | undefined = sections.find((section) => section.number === number);
        if (earlier) {
          // The statutes print two versions of a section while an amendment waits for its date. Both are the law to read.
          current = earlier;
          if (earlier.heading === 'Repealed') earlier.heading = heading;
          else current.lines.push(`[Another version of this section follows.] ${heading}.`);
          if (text) current.lines.push(text);
        } else {
          current = { number, heading, lines: text ? [text] : [] };
          sections.push(current);
        }
        continue;
      }
    }
    if (!current || inNotes || !line || PART_HEADING.test(line)) continue;
    if (CRS_NOTE.test(line)) inNotes = true;
    else current.lines.push(line);
  }
  return wholeSections(sections, listed, repealed, title, article);
}
