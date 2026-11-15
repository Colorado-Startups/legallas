// SPDX-License-Identifier: Apache-2.0
// The rules under the Colorado Securities Act (3 CCR 704-1) from the Secretary of State's PDF. That site's terms bar
// robots, so a person downloads it and seeds it (seed.ts), and this reads the text of that copy.
//
// Checked against the real layout (ruleVersionId 12350, read 2026-11-01). A rule starts a paragraph with its number:
// "51-3.7 Title", "51-3.20. Title", "51-4.1(IA) Title", and once "Rule 3.33. Title". Numbers don't ascend: the adviser
// rules start again at 51-4.1(IA), and chapter 6 runs 6.0, 6.10, 6.1. So position in a paragraph is what tells a rule
// from a cross-reference, which never opens one in a form this reads.
import type { Section } from './parse.ts';
import { pdfParagraphs } from './pdf-paragraphs.ts';

const RULE_HEAD = /^(?:Rule\s+(?:51-)?|51-)(\d{1,2}\.\d{1,2}(?:\.\d{1,2}){0,3}[A-Z]?(?:\s?\(IA\))?)\.?(?:\s+([A-Z(“].*))?$/;
/** Where the rules end and the Secretary of State's notes about them begin. */
const END = /^Editor['’]s Notes?\b/i;
/** A title is short and doesn't introduce what follows. Otherwise the rule opens straight on its text. */
const MAX_TITLE = 240;

/** The rules, in the document's order. Throws on a file that isn't these rules, or that yields none. */
export function coloradoRules(lines: readonly string[]): { sections: Section[]; empty: string[] } {
  if (!lines.some((line) => /3 CCR 704-1/.test(line))) throw new Error('this file does not say it is 3 CCR 704-1');
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const paragraph of pdfParagraphs(lines, { end: END, dropParagraph: /^(?:CHAPTER\s+\d|CODE OF COLORADO REGULATIONS\b|_+$)/ })) {
    const head = RULE_HEAD.exec(paragraph);
    const number = head ? `51-${head[1]!.replace(/\s/g, '')}` : '';
    const earlier = sections.find((section) => section.number === number);
    // A number that already has text is that rule being mentioned. A heading and then its repeal notice is one rule.
    if (!head || earlier?.lines.length) {
      current?.lines.push(paragraph);
      continue;
    }
    if (earlier) {
      current = earlier;
      if (/^\(?repealed\b/i.test(head[2] ?? '')) current.heading = head[2]!;
      continue;
    }
    const text = (head[2] ?? '').trim();
    const isTitle = text.length > 0 && text.length <= MAX_TITLE && !text.endsWith(':');
    current = { number, heading: isTitle ? text.replace(/\.$/, '') : `Rule ${number}`, lines: isTitle || !text ? [] : [text] };
    sections.push(current);
  }
  const whole: Section[] = [];
  const empty: string[] = [];
  for (const section of sections) {
    const gone = /^\(?repealed\b/i.test(section.heading);
    if (gone && section.lines.length > 0) throw new Error(`rule ${section.number} is marked repealed and has text after it, which may be another rule; check the file's layout`);
    if (gone) empty.push(section.number);
    else if (section.lines.length === 0) throw new Error(`rule ${section.number} has a heading and no text; check the file's layout`);
    else whole.push(section);
  }
  const stray = whole.flatMap((section) => section.lines).find((line) => /^\d{1,3}$/.test(line));
  if (stray) throw new Error(`a page number was left in the text ("${stray}"); check the file's layout`);
  if (whole.length === 0) throw new Error('no rules in this file; check its layout');
  return { sections: whole, empty };
}
