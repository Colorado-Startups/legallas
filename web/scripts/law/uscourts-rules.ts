// SPDX-License-Identifier: Apache-2.0
// The Federal Rules of Civil Procedure and of Evidence, from the House Judiciary Committee prints that uscourts.gov posts
// as text PDFs (pdf.ts pdfLines): one law unit per rule. A federal work, so no copyright (17 U.S.C. 105). The print's
// running heads, title and article headings, page numbers and the House's own editorial footnotes stay out. Each rule's
// words, its history line and Rule 4's waiver forms stay in.

export type RuleSet = 'civil' | 'evidence';

export const USCOURTS_RULES_URLS: Readonly<Record<RuleSet, string>> = {
  civil: 'https://www.uscourts.gov/sites/default/files/document/federal-rules-of-civil-procedure.pdf',
  evidence: 'https://www.uscourts.gov/sites/default/files/document/federal-rules-of-evidence.pdf',
};

interface Shape {
  name: string;
  /** The line the rules follow; it names the last amendments the print holds. */
  start: RegExp;
  /** The line after the last rule. */
  end: RegExp;
  first: string;
  /** Numbered by article (Rule 801 opens Article VIII), not straight through. */
  byArticle: boolean;
  /** "8Rule 4.1 FEDERAL RULES OF CIVIL PROCEDURE", page number and running head run together. */
  runningHead: RegExp;
  /** A title or article heading, which may wrap onto a second line in capitals. */
  division: RegExp;
}

const SHAPES: Readonly<Record<RuleSet, Shape>> = {
  civil: {
    name: 'Federal Rules of Civil Procedure',
    start: /^Effective September 16, 1938, as amended to ([A-Z][a-z]+ \d{1,2}, \d{4})$/,
    // The forms appendix, the Supplemental Admiralty Rules and the Social Security Rules follow, the last numbered from 1 again.
    end: /^APPENDIX OF FORMS$/,
    first: '1',
    byArticle: false,
    runningHead: /^\d*\s*Rule \d{1,2}(?:\.\d)?\s*FEDERAL RULES OF CIVIL PROCEDURE$/,
    division: /^TITLE [IVX]+\. /,
  },
  evidence: {
    name: 'Federal Rules of Evidence',
    start: /^Effective July 1, 1975, as amended to ([A-Z][a-z]+ \d{1,2}, \d{4})$/,
    // The print's end mark, as pdfjs reads its glyph.
    end: /^Æ$/,
    first: '101',
    byArticle: true,
    runningHead: /^\d*\s*Rule \d{3,4}\s*FEDERAL RULES OF EVIDENCE$/,
    division: /^ARTICLE [IVX]+\. /,
  },
};

export interface CourtRule {
  /** "26", "4.1", "502". */
  number: string;
  heading: string;
  /** One paragraph per line: each lettered or numbered part, each bullet, the history line. */
  lines: string[];
}

const HEADING = /^Rule (\d{1,4}(?:\.\d)?)\. (\S.*)$/;
const ABROGATED = /^Rule (\d{1,4}(?:\.\d)?)\. \[Abrogated [^\]]*\]$/;
/** The amendment history each rule ends with. */
const HISTORY = /^\((?:As amended|As added|Amended|Added)\b/;
const LABEL = /^\((?:\d{1,2}|[a-z]{1,4}|[A-Z]{1,2})\) /;
/** A justified line is never this short, so a shorter one ending a clause closes its paragraph. */
const SHORT = 40;

interface Raw {
  number: string;
  heading: string[];
  body: string[];
}

/**
 * Every rule of the set in print order, the date of the last amendments the print holds, and the rules abrogated whole.
 * Throws if the print's start or end can't be found, a rule number goes backward or skips one, or a rule comes back
 * empty or without its history line: a print laid out some new way stops the build instead of storing part of a rule.
 */
export function courtRules(lines: readonly string[], set: RuleSet): { asOf: string; rules: CourtRule[]; abrogated: string[] } {
  const shape = SHAPES[set];
  const text = lines.map((line) => line.trim());
  const startAt = text.findIndex((line) => shape.start.test(line));
  if (startAt < 0) throw new Error(`the ${shape.name} print never says what it is amended to; check the file's address and layout`);
  const asOf = shape.start.exec(text[startAt]!)![1]!;
  const endAt = text.findIndex((line, i) => i > startAt && shape.end.test(line));
  if (endAt < 0) throw new Error(`the ${shape.name} print has no end after its last rule; check the file's layout`);

  const raws: Raw[] = [];
  const abrogated: string[] = [];
  let current: Raw | null = null;
  let last = 0;
  let prev = '';
  let afterHead = false;
  let inDivision = false;
  let inHeading = false;
  for (const line of text.slice(startAt + 1, endAt)) {
    const before = prev;
    prev = line;
    if (!line) {
      inDivision = false;
      inHeading = false;
      continue;
    }
    if (shape.runningHead.test(line)) {
      afterHead = true;
      continue;
    }
    // The House's editorial footnote prints at the head of a page, its mark ("1") as a line of its own.
    const footnote = afterHead && /^[1-9] [A-Z][a-z]+ /.test(line);
    afterHead = false;
    if (footnote || /^\d{1,2}$/.test(line) || /^\(\d{1,3}\)$/.test(line)) continue;
    if (shape.division.test(line)) {
      inDivision = true;
      continue;
    }
    if (inDivision) {
      if (/[a-z]/.test(line)) throw new Error(`the ${shape.name} print has text in a title heading: "${line.slice(0, 60)}"`);
      continue;
    }
    // A heading follows a blank line, or a rule abrogated whole; "Rule 81. They should be" mid-paragraph is text.
    const opens = !before || ABROGATED.test(before);
    const gone = opens ? ABROGATED.exec(line) : null;
    const head = opens && !gone ? HEADING.exec(line) : null;
    if (gone || head) {
      const number = (gone ?? head)![1]!;
      if (Number(number) <= last) throw new Error(`the ${shape.name} print has Rule ${number} after Rule ${current?.number ?? last}; check the file's layout`);
      if (last === 0 && number !== shape.first) throw new Error(`the ${shape.name} print starts at Rule ${number}, not Rule ${shape.first}`);
      last = Number(number);
      if (gone) {
        abrogated.push(number);
        current = null;
      } else {
        current = { number, heading: [head![2]!], body: [] };
        raws.push(current);
        inHeading = true;
      }
      continue;
    }
    if (!current) throw new Error(`the ${shape.name} print has text outside any rule: "${line.slice(0, 60)}"`);
    if (inHeading) {
      if (current.heading.length >= 3) throw new Error(`Rule ${current.number}'s heading runs past three lines; check the file's layout`);
      current.heading.push(line);
      continue;
    }
    current.body.push(line);
  }

  const words = wordsOf(raws.flatMap((raw) => raw.body));
  const rules = raws.map((raw): CourtRule => {
    const heading = clean(raw.heading.reduce((a, b) => join(a, b, words)));
    const paragraphs: string[] = [];
    let previous = '';
    for (const line of raw.body) {
      if (!previous || startsParagraph(previous, line)) paragraphs.push(line);
      else paragraphs[paragraphs.length - 1] = join(paragraphs.at(-1)!, line, words);
      previous = line;
    }
    if (paragraphs.length === 0) throw new Error(`Rule ${raw.number} of the ${shape.name} holds no text`);
    // Rule 4's waiver forms follow its history line; every other rule ends with it.
    if (!paragraphs.some((line) => HISTORY.test(line))) throw new Error(`Rule ${raw.number} of the ${shape.name} has no history line, so its text may be cut short`);
    return { number: raw.number, heading, lines: paragraphs.map(clean) };
  });
  assertNoGaps(shape, [...rules.map((rule) => rule.number), ...abrogated]);
  return { asOf, rules, abrogated };
}

/** Rule numbers never skip: the civil rules run 1 to the last, the evidence rules 101 up within each article. */
function assertNoGaps(shape: Shape, numbers: readonly string[]): void {
  const whole = [...new Set(numbers.map((number) => Math.floor(Number(number))))].sort((a, b) => a - b);
  const groups = new Map<number, number[]>();
  for (const n of whole) {
    const group = shape.byArticle ? Math.floor(n / 100) : 0;
    groups.set(group, [...(groups.get(group) ?? []), n]);
  }
  const keys = [...groups.keys()];
  if (shape.byArticle && keys.some((key, i) => key !== i + 1)) throw new Error(`the ${shape.name} skip an article: ${keys.join(', ')}`);
  for (const [group, members] of groups) {
    const base = group * 100;
    const gap = members.findIndex((n, i) => n !== base + i + 1);
    if (gap >= 0) throw new Error(`the ${shape.name} skip Rule ${base + gap + 1}; check the file's layout`);
  }
}

/** A line opens a paragraph when it starts a bullet, the history line, or a labelled part after a clause ends. */
function startsParagraph(previous: string, line: string): boolean {
  if (/^•/.test(line) || HISTORY.test(line)) return true;
  // "forms;" then "and" alone on a line, then "(iii) A party": the clause ends either way.
  if (LABEL.test(line) && /(?:[.:;\u2014\]]|\.\)|(?:^|; )(?:and|or))$/.test(previous)) return true;
  return previous.length < SHORT && /[.:;?)\]]$/.test(previous) && /^[A-Z(‘•]/.test(line);
}

interface Words {
  plain: ReadonlySet<string>;
  hyphened: ReadonlySet<string>;
}

/** Every word the print sets whole on a line, with and without its own hyphens, to tell a broken word from a compound. */
function wordsOf(lines: readonly string[]): Words {
  const plain = new Set<string>();
  const hyphened = new Set<string>();
  for (const line of lines) {
    for (const match of line.replace(/[A-Za-z]-$/, ' ').matchAll(/[A-Za-z]+(?:-[A-Za-z]+)*/g)) {
      const word = match[0].toLowerCase();
      (word.includes('-') ? hyphened : plain).add(word);
    }
  }
  return { plain, hyphened };
}

/**
 * Joins a wrapped line. The print breaks words at line ends ("pro-" "ceedings", "AN-" "SWERS"), so the hyphen goes unless
 * the print sets the compound whole somewhere ("third-party") or the rest is a compound itself ("question-" "and-answer").
 */
function join(before: string, after: string, words: Words): string {
  if (/\u2014$/.test(before)) return `${before}${after}`;
  const tail = /([A-Za-z]+)-$/.exec(before)?.[1];
  const head = /^([A-Za-z]+(?:-[A-Za-z]+)*)/.exec(after)?.[1];
  if (!tail || !head) return `${before} ${after}`;
  const broken = `${before.slice(0, -1)}${after}`;
  // "at-" "torney-client" is a broken word; "question-" "and-answer" isn't.
  if (words.plain.has(`${tail}${head.split('-')[0]}`.toLowerCase())) return broken;
  if (head.includes('-')) return `${before}${after}`;
  if (words.hyphened.has(`${tail}-${head}`.toLowerCase())) return `${before}${after}`;
  // Two whole words ("declaratory-" "judgment"), or a prefix English always hyphenates ("self-" "identification").
  const lower = tail.toLowerCase();
  if (/^(?:self|cross)$/.test(lower) || (tail.length >= 6 && head.length >= 4 && words.plain.has(lower) && words.plain.has(head.toLowerCase()))) return `${before}${after}`;
  const capitals = tail === tail.toUpperCase() && head === head.toUpperCase();
  return /^[a-z]/.test(head) || capitals ? broken : `${before}${after}`;
}

/** The print's paired single quotes are double quotes, and its rule of l's is a blank to fill in. */
function clean(text: string): string {
  return text
    .replace(/‘‘/g, '“')
    .replace(/’’/g, '”')
    .replace(/l{5,}/g, '________')
    .replace(/\s+/g, ' ')
    .trim();
}
