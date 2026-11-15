// SPDX-License-Identifier: Apache-2.0
// Three SEC documents the default pack stores: the staff's interpretations of the Securities Act rules, the Form ADV
// instructions, and Form D with its instructions. sec.gov refuses a machine client that doesn't name a company and an
// email, so each install declares its own (default-pack.ts). The interpretations are staff views, not rules, and
// everything built from them says so.
import { htmlText, type Section } from './parse.ts';
import { pdfParagraphs } from './pdf-paragraphs.ts';

/** The SEC staff page of Securities Act Rules interpretations. */
export const SEC_INTERPRETATIONS_URL = 'https://www.sec.gov/rules-regulations/staff-guidance/corporation-finance-interpretations/securities-act-rules';
/** The SEC's Form ADV instructions PDF. */
export const FORM_ADV_URL = 'https://www.sec.gov/files/formadv-instructions.pdf';
/** The SEC's Form D PDF. */
export const FORM_D_URL = 'https://www.sec.gov/files/formd.pdf';

const CONTACT = /^\S.*\s\S+@\S+\.\S+$/;

/** The user agent sec.gov asks for: a company name, then an email. Null when `contact` isn't one. */
export function secUserAgent(contact: string | undefined): string | null {
  const value = contact?.trim();
  return value && CONTACT.test(value) ? value : null;
}

/** An SEC staff interpretation: a question, or an interpretive response. */
export interface Interpretation extends Section {
  /** "Question" or "Interpretive Response", which the page numbers apart: 1xx and 2xx, then 5xx and 6xx. */
  form: 'Question' | 'Interpretive Response';
  /** The page's own anchor for it, when it has one. */
  anchor: string | null;
}

const FIRST = 'QUESTIONS AND ANSWERS OF GENERAL APPLICABILITY';
const SECOND = 'INTERPRETIVE RESPONSES REGARDING PARTICULAR SITUATIONS';
const TOKEN = /<h3\b[^>]*>([\s\S]*?)<\/h3>|<h4\b[^>]*>([\s\S]*?)<\/h4>|<(p|li)\b[^>]*>([\s\S]*?)<\/\3>/g;

/** "Section 110. Rule 134 — Scope" to "Rule 134 — Scope": the page's own section numbers aren't the law's. */
function groupName(raw: string): string {
  return htmlText(raw).replace(/^Sections?\s+[\d\s\w]*?\.\s*/, '');
}

/** Every interpretation on the page, with what it says and which rule it sits under. Throws on a page cut short. */
export function secInterpretations(html: string): { updated: string; items: Interpretation[] } {
  if (!/<\/html>\s*$/i.test(html)) throw new Error('the SEC interpretations page is cut short: no closing html');
  const updated = /Last Update:\s*([A-Z][a-z]+\.? \d{1,2}, \d{4})/.exec(html)?.[1];
  if (!updated) throw new Error('the SEC interpretations page does not say when it was last updated; check its layout');
  const start = html.indexOf(FIRST);
  const second = html.indexOf(SECOND);
  const end = html.indexOf('class="date-modified', second);
  if (start < 0 || second < start || end < 0) throw new Error('the SEC interpretations page has lost its two parts; check its layout');
  const items: Interpretation[] = [];
  let group = '';
  let current: Interpretation | null = null;
  for (const match of html.slice(start, end).matchAll(TOKEN)) {
    const inResponses = start + match.index > second;
    if (match[1] !== undefined) {
      group = groupName(match[1]);
      current = null;
    } else if (match[2] !== undefined) {
      const question = /^Question\s+(\d{3}\.\d{2})/.exec(htmlText(match[2]));
      if (!question) throw new Error(`the SEC interpretations page has a heading it can't read: "${htmlText(match[2]).slice(0, 60)}"`);
      current = { number: question[1]!, heading: group, lines: [], form: 'Question', anchor: /\bid="([^"]+)"/.exec(match[2])?.[1] ?? null };
      items.push(current);
    } else {
      const text = htmlText(match[4]!);
      if (!text) continue;
      const response = inResponses ? /^(\d{3}\.\d{2})\*?\s+(.*)$/.exec(text) : null;
      if (response) {
        current = { number: response[1]!, heading: group, lines: [response[2]!], form: 'Interpretive Response', anchor: null };
        items.push(current);
      } else if (current) {
        current.lines.push(text);
      } else if (!/^\[[^\]]*\]$/.test(text)) {
        // A bracketed note under a rule ("[withdrawn, ...]") stands in for interpretations that are gone. Anything else is lost text.
        throw new Error(`the SEC interpretations page has text under "${group}" outside any interpretation: "${text.slice(0, 60)}"`);
      }
    }
  }
  const blank = items.find((item) => item.lines.length === 0);
  if (blank) throw new Error(`SEC interpretation ${blank.number} has no text; check the page's layout`);
  return { updated, items };
}

const FORM_ADV_PARTS = [
  { head: /(?:^|\s)Form ADV: General Instructions$/, name: 'General Instructions' },
  { head: /(?:^|\s)Form ADV: Instructions for Part 1A$/, name: 'Instructions for Part 1A' },
  { head: /^GLOSSARY OF TERMS$/, name: 'Glossary of Terms' },
] as const;

/**
 * The Form ADV instructions, split at the three headings it prints. A heading can share a paragraph with what comes
 * before it, when the PDF leaves no gap, so those words stay with the part before. Throws if a heading is missing or out
 * of order, or if a part holds no text.
 */
export function formAdvParts(lines: readonly string[]): { name: string; lines: string[] }[] {
  const paragraphs = pdfParagraphs(lines, { dropLine: /^SEC 1707\b/ });
  const parts: { name: string; lines: string[] }[] = [];
  let next = 0;
  for (const paragraph of paragraphs) {
    const heading = FORM_ADV_PARTS[next]?.head.exec(paragraph);
    if (heading) {
      const before = paragraph.slice(0, heading.index).trim();
      if (before && parts.length > 0) parts.at(-1)!.lines.push(before);
      parts.push({ name: FORM_ADV_PARTS[next]!.name, lines: [] });
      next += 1;
    } else if (parts.length > 0) {
      parts.at(-1)!.lines.push(paragraph);
    }
  }
  if (next < FORM_ADV_PARTS.length) throw new Error(`the Form ADV instructions have no "${FORM_ADV_PARTS[next]!.name}" where it should be; check the file's layout`);
  const blank = parts.find((part) => part.lines.length === 0);
  if (blank) throw new Error(`the Form ADV instructions' "${blank.name}" holds no text`);
  return parts;
}

/** What Form D prints on page after page: its running heads, its page numbers and the instructions' "(Continued)" head. */
const FORM_D_FURNITURE = /FORM D|U\.S\. Securities and Exchange Commission|Washington, DC 20549|Form D \d{1,2}|Item-by-Item Instructions\s*\(Continued\)/g;
/** A bullet: "o" or a dot before a capital, a dash before a small letter. */
const FORM_D_BULLET = /^(?:(?:o|[\u2022\u25aa\u25cf\u25e6\uf0a7\uf0b7])\s*(?=[A-Z])|[-\u2010\u2013]\s*(?=[a-z]))/;
/** An item's heading ("Item 7. Type of Filing. Indicate...") or the signature instruction's, each the start of a paragraph. */
const FORM_D_HEAD = /^(?:Item \d{1,2}\. [A-Z][^.]*\.(?:\s|$)|Signature and Submission\.)/;
/** Where the General Instructions' own labels start, wherever the narrow columns put them. */
const FORM_D_LABELS = /\s*(?=\b(?:Who must file|When to file|When amendment is not required|How to file|Saturdays, Sundays and holidays|Filing fee|Amendment content|Definitions of terms):)/;
/** Where the Terms of Submission's undertakings start: the form prints them with no mark. */
const FORM_D_TERMS = /\s*(?=\b(?:Notifying the SEC|Irrevocably appointing|Certifying that|Each issuer identified above)\b)/;
/** An item's instruction heading, or the signature instruction after the last one. */
const FORM_D_ITEM = /(?:^|\s)(?:Item (\d{1,2})\. ([A-Z][^.\n]{1,90})|Signature and Submission)\.(?=\s|$)/g;

/** Two lines of one paragraph: a word a line break hyphenated keeps its hyphen ("non-accredited"), and "www." its address. */
function joinLines(before: string, after: string): string {
  return (/[A-Za-z]-$/.test(before) && /^[a-z]/.test(after)) || /\bwww\.$/.test(before) ? `${before}${after}` : `${before} ${after}`;
}

/**
 * Form D's lines as paragraphs, page furniture gone. A paragraph opens at a bullet or a heading, after a gap, or where a
 * bullet's last sentence ends a line and a capital starts the next. A gap inside a sentence (a column or page break: no
 * stop before it) is no paragraph.
 */
function formDParagraphs(lines: readonly string[]): string[] {
  const out: string[] = [];
  let paragraph = '';
  let previous = '';
  let gap = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) {
      if (paragraph) out.push(paragraph);
      paragraph = '';
      gap = true;
      continue;
    }
    if (!line.replace(FORM_D_FURNITURE, '').trim()) continue;
    const bullet = FORM_D_BULLET.exec(line);
    const endsBullet = FORM_D_BULLET.test(paragraph) && /\.["\u201d]?$/.test(previous) && !/\bU\.S\.$/.test(previous) && /^[A-Z]/.test(line);
    if (bullet || FORM_D_HEAD.test(line) || endsBullet) {
      if (paragraph) out.push(paragraph);
      paragraph = bullet ? `${bullet[0].trim()} ${line.slice(bullet[0].length)}` : line;
    } else if (paragraph) {
      paragraph = joinLines(paragraph, line);
    } else {
      const last = out.at(-1);
      paragraph = gap && last && !/[.:;)\]"\u201d\u2217*]$/.test(last) ? joinLines(out.pop()!, line) : line;
    }
    previous = line;
    gap = false;
  }
  if (paragraph) out.push(paragraph);
  return out;
}

/** One part of Form D that a citation can name. */
export interface FormDPart {
  /** What a citation names after "Form D, ": "General Instructions", "Item 7". */
  name: string;
  /** The heading as the form prints it: "Item 7. Type of Filing". */
  heading: string;
  lines: string[];
}

/** The text after `from` (found at or past `after`) up to where `to` matches. Throws if either is missing. */
function cut(doc: string, from: string, to: RegExp, after: number): { text: string; end: number } {
  const begin = doc.indexOf(from, after);
  if (begin < 0) throw new Error(`Form D has no "${from}" where it should be; check the file's layout`);
  const rest = doc.slice(begin + from.length);
  const stop = to.exec(rest);
  if (!stop) throw new Error(`Form D's "${from}" has no end where it should; check the file's layout`);
  return { text: rest.slice(0, stop.index), end: begin + from.length + stop.index };
}

const linesOf = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);

/**
 * Form D's own words in the order it prints them: the Terms of Submission each issuer signs (with their footnote), the
 * General Instructions, the instruction to each item, then to Signature and Submission. The fields to fill in and the
 * continuation pages hold no instruction, so they stay out. Throws if the file isn't OMB 3235-0076, a part is missing or
 * empty, the items skip or repeat a number, or text sits before the first item.
 */
export function formD(lines: readonly string[]): { expires: string; edition: string | null; parts: FormDPart[] } {
  const doc = formDParagraphs(lines).join('\n');
  if (!/OMB Number:?\s*3235-0076/.test(doc)) throw new Error('the file has no OMB number 3235-0076, so it is not Form D; check its address');
  const expires = /Expires:?\s*([A-Z][a-z]+\.? \d{1,2}, \d{4})/.exec(doc)?.[1];
  if (!expires) throw new Error("Form D doesn't say when its OMB approval expires; check the file's layout");
  const edition = /SEC ?1972 \(\d{1,2}\/\d{2}\)/.exec(doc)?.[0].replace(/^SEC ?/, 'SEC ') ?? null;

  const terms = cut(doc, 'Terms of Submission.', /(?<=duly authorized person\.)/, 0);
  const termsLines = terms.text.replace(/\s*\n\s*/g, ' ').split(FORM_D_TERMS).map((line) => line.trim()).filter(Boolean);
  const footnote = /This undertaking does not affect[\s\S]*?anti-fraud authority\./.exec(doc.slice(terms.end));
  if (!footnote) throw new Error("Form D's Terms of Submission have lost their footnote on NSMIA; check the file's layout");
  termsLines.push(`\u2217 ${footnote[0].replace(/\s+/g, ' ')}`);

  const general = cut(doc, 'General Instructions', /Item-by-Item Instructions/, terms.end);
  const generalLines = linesOf(general.text).flatMap((line) => line.split(FORM_D_LABELS).map((part) => part.trim()).filter(Boolean));

  const items = cut(doc, 'Item-by-Item Instructions', /Items? 1 and 2 Continuation Page/, general.end);
  const heads = [...items.text.matchAll(FORM_D_ITEM)];
  const before = items.text.slice(0, heads[0]?.index ?? items.text.length).trim();
  if (before) throw new Error(`Form D's Item-by-Item Instructions have text before any item: "${before.slice(0, 60)}"`);
  const instructions = heads.map((head, i): FormDPart => {
    const text = linesOf(items.text.slice(head.index + head[0].length, heads[i + 1]?.index ?? items.text.length));
    if (head[1] === undefined) {
      if (i !== heads.length - 1) throw new Error("Form D's Signature and Submission instruction comes before an item; check the file's layout");
      return { name: 'Signature and Submission', heading: 'Signature and Submission', lines: text };
    }
    if (Number(head[1]) !== i + 1) throw new Error(`Form D's instructions go to Item ${head[1]} where Item ${i + 1} should be; check the file's layout`);
    return { name: `Item ${head[1]}`, heading: `Item ${head[1]}. ${head[2]!.trim()}`, lines: text };
  });
  if (instructions.at(-1)?.name !== 'Signature and Submission') throw new Error("Form D has no Signature and Submission instruction after its items; check the file's layout");

  const parts = [
    { name: 'Terms of Submission', heading: 'Terms of Submission', lines: termsLines },
    { name: 'General Instructions', heading: 'General Instructions', lines: generalLines },
    ...instructions,
  ];
  const blank = parts.find((part) => part.lines.length === 0);
  if (blank) throw new Error(`Form D's ${blank.name} holds no text`);
  return { expires, edition, parts };
}
