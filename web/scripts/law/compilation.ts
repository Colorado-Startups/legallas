// SPDX-License-Identifier: Apache-2.0
// A whole federal act from govinfo's Statute Compilations (USLM XML, the House Office of the Legislative Counsel's
// text of the act as amended). Each section is numbered by the act ("Sec. 203") and notes its U.S. Code section
// ("[80b-3]"), so a unit can be cited the way the Code is and still name the act's own section. Footnotes and
// editorial notes are not the act's words and are dropped.
import { htmlText, type Section } from './parse.ts';

/** A section of a statute compilation, with the act's own section number. */
export interface CompiledSection extends Section {
  /** The act's own section number: "203", "2A". */
  actSection: string;
  /** The U.S. Code title it is codified in. */
  uscTitle: number;
}

/** A statute compilation: its title and the last public law it reflects. */
export interface Compilation {
  title: string;
  /** "P.L. 119-27": the last public law the compilation reflects. */
  through: string;
  sections: CompiledSection[];
  /** Act sections with no words of their own, only an editorial note (a section that amended another act). */
  empty: string[];
}

/** The index just past the `</tag>` closing the element that opens at `start`, however deeply it nests. */
function elementEnd(xml: string, start: number, tag: string): number {
  const pattern = new RegExp(`<${tag}\\b[^>]*?(/?)>|</${tag}>`, 'g');
  pattern.lastIndex = start;
  let depth = 0;
  for (let match = pattern.exec(xml); match; match = pattern.exec(xml)) {
    if (match[0].startsWith('</')) depth -= 1;
    else if (!match[1]) depth += 1;
    if (depth === 0) return pattern.lastIndex;
  }
  throw new Error(`a <${tag}> never closes: the compilation is cut short`);
}

/**
 * What may sit between the sections of an act: title headings, the long title and the enacting words. Anything else is text
 * no section holds, like a section whose identifier this can't read, and it must not vanish.
 */
function assertOnlyStructure(between: string, title: string): void {
  const rest = htmlText(
    between
      .replace(/<(longTitle|enactingFormula|preface|meta)\b[\s\S]*?<\/\1>/g, ' ')
      .replace(/<(num|heading)\b[\s\S]*?<\/\1>/g, ' ')
      .replace(NOTE_FREE, ' '),
  );
  if (rest) throw new Error(`${title} has text outside any section it can read: "${rest.slice(0, 80)}"`);
}

const STRUCTURE = /<(?=(?:subsection|paragraph|subparagraph|clause|subclause|item|subitem|continuation|quotedContent|compsdtd:row)\b)/g;
const NOTE_FREE = /<footnote\b[\s\S]*?<\/footnote>|<ref\b[^>]*class="footnoteRef"[^>]*>[\s\S]*?<\/ref>|<editorialNote\b[\s\S]*?<\/editorialNote>/g;

/** The body's paragraphs: one line per subsection, paragraph and so on, each opening with its label. */
function bodyLines(body: string): string[] {
  const lines = body
    .replace(NOTE_FREE, ' ')
    .replace(/<compsdtd:entry\b[^>]*>/g, ' | ')
    .replace(STRUCTURE, '\n<')
    .split('\n')
    .map((line) => htmlText(line).replace(/^\|\s*/, ''))
    .filter(Boolean);
  // A label alone ("(a)") opens the next line's text: "(a) (1) To effect ...", which the chunker reads as (a)(1).
  const out: string[] = [];
  let label = '';
  for (const line of lines) {
    if (/^(?:\([0-9A-Za-z]{1,6}\)\s*)+$/.test(line)) {
      label += `${line} `;
      continue;
    }
    out.push(`${label}${line}`);
    label = '';
  }
  if (label) out.push(label.trim());
  return out;
}

/** "findings " to "Findings", "schedule a" to "Schedule A", "CUSTODY OF CLIENT ACCOUNTS. " to "CUSTODY OF CLIENT ACCOUNTS". */
function plainHeading(raw: string): string {
  const text = htmlText(raw.replace(NOTE_FREE, ' ')).replace(/[.—-]+$/, '').trim();
  return (text.charAt(0).toUpperCase() + text.slice(1)).replace(/ ([a-z])$/, (_, letter: string) => ` ${letter.toUpperCase()}`);
}

interface UscRef {
  title: number | null;
  section: string;
  at: number;
}

/** The U.S. Code notes in a section, "note" references left out: they point at a note, not at the section's own text. */
function uscRefs(body: string): UscRef[] {
  const refs: UscRef[] = [];
  for (const match of body.matchAll(/<editorialNote\b[^>]*role="uscRef"[^>]*>([\s\S]*?)<\/editorialNote>/g)) {
    const text = htmlText(match[1]!).replace(/\s*([–-])\s*/g, '-');
    const ref = /^\[(?:(\d{1,2}) U\.S\.C\. )?([0-9A-Za-z]+(?:-[0-9A-Za-z]+)?)( note)?\]$/.exec(text);
    if (!ref) throw new Error(`a U.S. Code note reads "${text}", which the build cannot read`);
    if (ref[3]) continue;
    refs.push({ title: ref[1] ? Number(ref[1]) : null, section: ref[2]!.toLowerCase(), at: match.index });
  }
  return refs;
}

/** Where a section's own head ends: the first subdivision. A heading after this belongs to a subsection. */
function headingOf(body: string): string | null {
  const first = body.search(/<(?:subsection|paragraph|chapeau|content)\b/);
  const heading = /<heading\b[^>]*>([\s\S]*?)<\/heading>/.exec(body);
  if (!heading || (first >= 0 && heading.index > first)) return null;
  return plainHeading(heading[1]!);
}

/**
 * The sections of a compilation, each numbered by its U.S. Code section. `uncoded` names the act sections the file gives
 * no U.S. Code note for (a law pack checks these by hand), and any other section with text and no note throws: a
 * citation must never be guessed. A second note inside a section ("[77aa] Schedule A") starts a section of its own.
 */
export function parseCompilation(xml: string, uscTitle: number, uncoded: Readonly<Record<string, string>> = {}): Compilation {
  if (!/<\/statuteCompilation>\s*$/.test(xml)) throw new Error('the compilation is cut short: no closing statuteCompilation');
  const title = htmlText(/<dc:title>([\s\S]*?)<\/dc:title>/.exec(xml)?.[1] ?? '');
  const law = htmlText(/<currentThroughPublicLaw>([\s\S]*?)<\/currentThroughPublicLaw>/.exec(xml)?.[1] ?? '').replace(/–/g, '-');
  if (!title || !law) throw new Error('the compilation does not say its title and the law it runs through');
  const through = `P.L. ${law.replace(/^P\.L\.\s*/, '')}`;
  const sections: CompiledSection[] = [];
  const empty: string[] = [];
  const opener = /<section\b[^>]*\bidentifier="[^"]*\/s([0-9A-Za-z-]+)"[^>]*>/g;
  const mainStart = xml.indexOf('<main');
  let previousEnd = 0;
  for (let match = opener.exec(xml); match; match = opener.exec(xml)) {
    assertOnlyStructure(xml.slice(previousEnd || mainStart, match.index), title);
    const end = elementEnd(xml, match.index, 'section');
    const body = xml.slice(match.index + match[0].length, end - '</section>'.length);
    opener.lastIndex = end;
    const actSection = match[1]!;
    const num = /<num\b[^>]*>[\s\S]*?<\/num>/.exec(body);
    // A few sections print their heading as an empty section of its own just before them ("penalties").
    const above = /<section\b(?![^>]*identifier)[^>]*>\s*<heading\b[^>]*>([\s\S]*?)<\/heading>\s*<\/section>\s*$/.exec(xml.slice(previousEnd, match.index));
    previousEnd = end;
    const head = headingOf(body) ?? (above ? plainHeading(above[1]!) : `Section ${actSection}`);
    const refs = uscRefs(body);
    const pieces = refs.slice(1).map((ref) => {
      // A later section's note usually sits inside its own heading: one still open where the note is.
      const open = body.lastIndexOf('<heading', ref.at);
      return open >= 0 && !body.slice(open, ref.at).includes('</heading>') ? open : ref.at;
    });
    const spans = [0, ...pieces, body.length];
    for (let i = 0; i + 1 < spans.length; i++) {
      const raw = body.slice(spans[i]!, spans[i + 1]!);
      const text = i === 0 ? raw.replace(num?.[0] ?? '', ' ').replace(/<heading\b[^>]*>[\s\S]*?<\/heading>/, (whole) => (headingOf(body) ? ' ' : whole)) : raw.replace(/<heading\b[^>]*>[\s\S]*?<\/heading>/, ' ');
      const lines = bodyLines(text);
      const ref = refs[i];
      const coded = ref?.section ?? uncoded[actSection];
      if (lines.length === 0 && !ref) {
        empty.push(actSection);
        continue;
      }
      if (!coded) throw new Error(`section ${actSection} of ${title} has text and no U.S. Code note; add it to the pack's uncoded list after checking it`);
      if (lines.length === 0) throw new Error(`section ${actSection} of ${title} (${coded}) has no text`);
      const heading = i === 0 ? head : plainHeading(/<heading\b[^>]*>([\s\S]*?)<\/heading>/.exec(raw)?.[1] ?? `Section ${actSection}`);
      // A piece with its own note, like a schedule, isn't part of the section it happens to sit in.
      sections.push({ number: coded, heading, lines, actSection: i === 0 ? actSection : '', uscTitle: ref?.title ?? uscTitle });
    }
  }
  assertOnlyStructure(xml.slice(previousEnd || mainStart), title);
  if (sections.length === 0) throw new Error(`${title}: no sections in the compilation; check its layout`);
  return { title, through, sections, empty };
}
