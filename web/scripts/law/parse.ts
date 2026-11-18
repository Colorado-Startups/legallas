// SPDX-License-Identifier: Apache-2.0
// Raw official text to law units. Each parser keeps the operative text only: statute and rule wording, the
// opinion itself. History notes, editor's notes, cross references, law review lists, amendment notes and case
// head matter (captions, counsel, any syllabus) are dropped, so no annotation text enters the library.
import { isSeparateOpinion, type LawOpinion } from '../../worker/law-cite.ts';
import { decodeXml } from './docx.ts';
import { articleRole, headingOf, isDescriptor, judgeName } from './opinions.ts';

/** One section of a statute or rule: its number, heading and paragraphs. */
export interface Section {
  number: string;
  heading: string;
  lines: string[];
}

/** Matches a Colorado Revised Statutes section heading, capturing its number and its text. */
export const CRS_SECTION = /^(\d{1,2}(?:\.\d)?-\d{1,3}(?:\.\d)?-\d{3,4}(?:\.\d{1,2})?)\.\s+(.*)$/;
/** Lines that end a section's operative text: everything after them until the next section is notes. */
export const CRS_NOTE = /^(?:Source:|Editor's note|Cross references?:|Law reviews?:|ANNOTATION\b)/i;

/** A C.R.S. heading and the text that follows it on the same line: "Derivative proceeding - demand. (1) No...". */
export function splitCrsHeading(rest: string): { heading: string; text: string } {
  const repealed = /^(\(?Repealed\.?\)?)\s*(.*)$/i.exec(rest);
  if (repealed) return { heading: 'Repealed', text: repealed[2] ?? '' };
  const match = /^(.+?\.)(?:\s+(?=[(A-Z"0-9])|$)(.*)$/.exec(rest);
  if (!match) return { heading: rest.trim(), text: '' };
  return { heading: match[1]!.replace(/\.$/, '').trim(), text: (match[2] ?? '').trim() };
}

/**
 * The sections of one C.R.S. article from the OLLS title paragraphs: from the line "ARTICLE <n>" to the next
 * "ARTICLE" line. A section's text runs from its heading to its "Source:" line; notes after it are dropped.
 */
export function crsArticle(paragraphs: readonly string[], article: string): Section[] {
  const start = paragraphs.findIndex((line) => line.trim().toUpperCase() === `ARTICLE ${article}`);
  if (start < 0) throw new Error(`no ARTICLE ${article} in the title`);
  const sections: Section[] = [];
  let current: Section | null = null;
  let inNotes = false;
  for (const raw of paragraphs.slice(start + 1)) {
    const line = raw.trim();
    if (/^ARTICLE \d/i.test(line)) break;
    const head = CRS_SECTION.exec(line);
    if (head) {
      const { heading, text } = splitCrsHeading(head[2]!);
      current = { number: head[1]!, heading, lines: text ? [text] : [] };
      sections.push(current);
      inNotes = false;
    } else if (!current || inNotes || !line) {
      continue;
    } else if (CRS_NOTE.test(line)) {
      inNotes = true;
    } else {
      current.lines.push(line);
    }
  }
  return sections;
}

/** Tags stripped, entities decoded, whitespace collapsed. */
export function htmlText(fragment: string): string {
  let text = fragment.replace(/<br\s*\/?>/gi, ' ');
  // Again until no tag is left, so removing one never leaves another behind.
  for (let before = ''; before !== text; ) {
    before = text;
    text = text.replace(/<[^>]+>/g, '');
  }
  return decodeXml(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&(?:sect);/g, '§')
    .replace(/&(?:ndash);/g, '-')
    .replace(/&(?:mdash);/g, '\u2014')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One eCFR section (versioner XML, `?section=`): heading and paragraphs; source and authority notes dropped. */
export function ecfrSection(xml: string): Section {
  const div = /<DIV8\s+N="([^"]+)"[^>]*>([\s\S]*?)<\/DIV8>/.exec(xml);
  if (!div) throw new Error('no eCFR section in the response');
  const head = htmlText(/<HEAD>([\s\S]*?)<\/HEAD>/.exec(div[2]!)?.[1] ?? '');
  const heading = head.replace(/^§+\s*[0-9a-z.()-]+\s*/i, '').replace(/\.$/, '');
  const body = div[2]!.replace(/<(SECAUTH|CITA|EDNOTE|AUTH|SOURCE)\b[\s\S]*?<\/\1>/g, '').replace(/<HEAD>[\s\S]*?<\/HEAD>/, '');
  const lines: string[] = [];
  for (const match of body.matchAll(/<(P|FP|HED)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const text = htmlText(match[2]!);
    if (text) lines.push(text);
  }
  return { number: div[1]!, heading, lines };
}

/**
 * One section's page on uscode.house.gov (the Law Revision Counsel's current Code): its text, cut at the source credit
 * that closes it, and how current the Code is ("Public Law 119-136 (October 22, 2026)"). Throws on a page that may be cut
 * short or does not say how current it is.
 */
export function uscodePage(html: string, number: string, label: string): { section: Section; through: string } {
  const end = html.search(/<[a-z]+ class="source-credit"/);
  if (end < 0) throw new Error(`${label}: the page has no source credit, so its text may be cut short`);
  const through = /current through (Public Law [\d-]+ \([A-Z][a-z]+ \d{1,2}, \d{4}\))/.exec(html)?.[1];
  if (!through) throw new Error(`${label}: the page doesn't say how current it is`);
  return { section: uscSection(html.slice(0, end), number), through };
}

/** One U.S. Code section from its HTML: the text up to and including its source credit, no notes. */
export function uscSection(html: string, section: string): Section {
  // Footnote markers ("each of <sup>4</sup> such caterer") point at editorial notes, which are not statute text.
  const body = html.replace(/<head>[\s\S]*?<\/head>/i, '').replace(/<sup>\s*<a\b[^>]*>\s*\d{1,3}\s*<\/a>\s*<\/sup>/gi, '');
  const lines = body
    .replace(/<\/(p|h[1-6]|div)>/gi, '\n')
    .split('\n')
    .map(htmlText)
    .filter(Boolean);
  const start = lines.findIndex((line) => new RegExp(`^§\\s*${section.replace(/-/g, '[-–]')}\\.`).test(line.replace(/–/g, '-')));
  if (start < 0) throw new Error(`no § ${section} in the govinfo page`);
  const heading = lines[start]!.replace(/^§\s*[0-9a-z–-]+\.\s*/i, '');
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^(Editorial Notes|Statutory Notes|Amendments)$/i.test(line)) break;
    // The source credit "(Aug. 1, 1990, ch. 1, ...)" is the last line of the section text.
    if (/^\((?:[A-Z][a-z]{2,3}\.?|June|July|May) \d/.test(line)) break;
    out.push(line);
  }
  return { number: section, heading, lines: out };
}

/**
 * One writing of a Caselaw Access Project case page (opinions.ts): its paragraphs with star pages as [*307] markers,
 * and its footnotes apart, each with the page its mark sits on.
 */
export interface Opinion {
  /** CAP's data-type, or the heading's kind for a writing CAP left inside another's article. */
  type: string;
  /** The author line as printed (the heading, for a writing found under one). */
  author: string;
  lines: string[];
  /** "[*848] Footnote 6: ..." (no marker when the mark was not found). */
  notes: string[];
  /** The last star page before this writing's text (CAP keeps headnote pages out, so the head matter can end later). */
  startPage: string | null;
  opinion: LawOpinion;
  judge: string | null;
  role: string;
}

/** The parties line(s) of a CAP case's head matter, as plain text: what checks a file holds the case it should. */
export function capParties(html: string): string {
  return [...html.matchAll(/<(p|h\d)\b[^>]*class="parties"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => htmlText(m[2]!)).join(' ');
}

/** The last star page in `html`, footnotes left out (a footnote can run onto a page the text has not reached). */
function lastPage(html: string): string | null {
  return [...html.replace(/<aside\b[\s\S]*?<\/aside>/g, '').matchAll(/class="page-label"[^>]*>\*?(\d+)</g)].at(-1)?.[1] ?? null;
}

/** The writings of a CAP case HTML (static.case.law/<reporter>/<vol>/html/<page>-<n>.html); head matter dropped. */
export function capOpinions(html: string): Opinion[] {
  const out: Opinion[] = [];
  for (const match of html.matchAll(/<article class="opinion"([^>]*)>([\s\S]*?)<\/article>/g)) {
    out.push(...articleOpinions(match[1]!, match[2]!, lastPage(html.slice(0, match.index))));
  }
  return out;
}

// A star page marker, or a footnote mark (<a class="footnotemark" href="#footnote_1_6">), in reading order.
const PAGE_OR_MARK = /\[\*(\d{1,5})\]|<a\b[^>]*\bclass="footnotemark"[^>]*>/g;

/** One CAP article: usually one writing, more when a separate one sits under a heading inside it. */
function articleOpinions(attrs: string, body: string, startPage: string | null): Opinion[] {
  const type = /data-type="([^"]*)"/.exec(attrs)?.[1] ?? 'majority';
  const inner = body.replace(/<a[^>]*class="page-label"[^>]*>\*?(\d+)<\/a>/g, ' [*$1] ');
  const author = htmlText(/<p class="author"[^>]*>([\s\S]*?)<\/p>/.exec(inner)?.[1] ?? '');
  const paragraphs = [...inner.matchAll(/<(p|blockquote|aside)\b([^>]*)>([\s\S]*?)<\/\1>/g)];
  const opening = paragraphs.map((p) => (p[1] === 'aside' || /class="author"/.test(p[2]!) ? '' : htmlText(p[3]!))).find(Boolean) ?? '';
  const stated = isDescriptor(opening) ? `${author} ${opening}` : author;
  let current: Opinion = { type, author, lines: [], notes: [], startPage, ...articleRole(type, stated), judge: judgeName(author) };
  const opinions = [current];
  const marks = new Map<string, { page: string | null; owner: Opinion }>();
  let page = startPage;
  for (const [, tag, pAttrs, content] of paragraphs) {
    if (tag === 'aside') continue;
    const text = /class="author"/.test(pAttrs!) ? '' : htmlText(content!);
    const heading = text && current.lines.length > 0 ? headingOf(text) : null;
    if (heading) {
      const at = /^\[\*(\d{1,5})\]/.exec(text)?.[1] ?? page;
      current = { type: heading.opinion, author: text, lines: [], notes: [], startPage: at, opinion: heading.opinion, judge: heading.judge, role: heading.role };
      opinions.push(current);
    }
    for (const m of content!.matchAll(PAGE_OR_MARK)) {
      if (m[1]) page = m[1];
      else marks.set(/href="#([^"]+)"/.exec(m[0])?.[1] ?? '', { page, owner: current });
    }
    if (!text || heading) continue;
    // "dissenting." under the author line: the part's own marker says it (chunk.ts).
    if (isSeparateOpinion(current.opinion) && current.lines.length === 0 && isDescriptor(text)) continue;
    current.lines.push(text);
  }
  for (const [, tag, pAttrs, content] of paragraphs) {
    if (tag !== 'aside') continue;
    const text = htmlText(content!.replace(/<a\b[^>]*href="#ref_[^"]*"[^>]*>[\s\S]*?<\/a>/, '')).replace(/^[\s.]+/, '');
    if (!text) continue;
    const mark = marks.get(/\bid="([^"]+)"/.exec(pAttrs!)?.[1] ?? '');
    const label = /data-label="([^"]{1,8})"/.exec(pAttrs!)?.[1];
    (mark?.owner ?? current).notes.push(`${mark?.page ? `[*${mark.page}] ` : ''}Footnote${label ? ` ${label}` : ''}: ${text}`);
  }
  return opinions.filter((o) => o.lines.length > 0 || o.notes.length > 0);
}
