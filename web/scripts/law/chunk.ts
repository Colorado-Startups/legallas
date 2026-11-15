// SPDX-License-Identifier: Apache-2.0
// Law units to index parts. Each part is small enough that AI Search keeps it as one chunk (the legallas-law
// instance chunks at 512 tokens; a part stays under MAX_CHARS, about 450 tokens with its header), so every
// chunk the search returns starts with its own citation line and the catalog entry describes it exactly.
import { isSeparateOpinion } from '../../worker/law-cite.ts';
import { opinionLabel, opinionParenthetical } from './opinions.ts';
import type { BuiltChunk, LawUnit, Scheme, UnitOpinion } from './types.ts';

/** The longest a law chunk may be, in characters. */
export const MAX_CHARS = 1800;
const LABEL = /^\(([0-9]{1,3}(?:\.[0-9]{1,2})?|[a-z]{1,3}|[A-Z]{1,5})\)\s*/;
const ROMAN_UPPER = /^[IVXL]+$/;
const ROMAN_LOWER = /^[ivxl]+$/;

/**
 * The outline level of a subsection label in a scheme, 1 for the outermost. Colorado statutes number
 * (1) (a) (I) (A); federal rules (a) (1) (i) (A), where a lowercase roman is told from a letter by isRomanHere. `outline`
 * is what the default pack's federal and Delaware text uses.
 */
export function labelLevel(label: string, scheme: Scheme, previous: readonly string[]): number {
  const digits = /^[0-9]/.test(label);
  const lower = /^[a-z]+$/.test(label);
  if (scheme === 'outline') {
    // Like federal rules, except a list that starts on a number has the number on top: (1) (2) (3), never (1)(2).
    const numbered = previous[0] === undefined || /^[0-9]/.test(previous[0]);
    if (digits) return numbered ? 1 : 2;
    if (lower) return numbered && previous[0] !== undefined ? 2 : isRomanHere(label, previous) ? 3 : 1;
    return previous.length === 0 ? 1 : 4;
  }
  if (scheme === 'cfr' || scheme === 'usc') {
    if (lower) return isRomanHere(label, previous) ? 3 : 1;
    if (digits) return 2;
    return 4;
  }
  if (digits) return 1;
  if (lower) return 2;
  return ROMAN_UPPER.test(label) ? 3 : 4;
}

const ROMAN_DIGITS: Record<string, number> = { i: 1, v: 5, x: 10, l: 50 };

/** A lowercase roman numeral's value (i = 1, iv = 4), or 0 when the label is not one. */
export function romanValue(label: string): number {
  if (!ROMAN_LOWER.test(label)) return 0;
  let total = 0;
  for (let k = 0; k < label.length; k++) {
    const here = ROMAN_DIGITS[label[k]!]!;
    const next = ROMAN_DIGITS[label[k + 1] ?? ''] ?? 0;
    total += here < next ? -here : here;
  }
  return total;
}

/**
 * Whether a lowercase label inside a numbered paragraph is a roman numeral (level 3) rather than the next letter
 * (level 1): "i" opens a roman run unless the letters have reached "h"; a longer numeral ("ii", "iv") is roman;
 * a single "v", "x" or "l" must follow its roman predecessor, so "(v)" after "(iv)" is roman, after "(u)" a letter.
 */
function isRomanHere(label: string, previous: readonly string[]): boolean {
  if (previous.length < 2 || romanValue(label) === 0) return false;
  if (label === 'i') return previous[0] !== 'h';
  // "(ii)", "(iv)": never single letters, and their "(i)" often sits mid-line where no label is read.
  if (label.length > 1) return true;
  const before = previous[2];
  return before !== undefined && romanValue(before) === romanValue(label) - 1;
}

/** The leading labels of a line: "(11) (a) text" gives ["11", "a"]. */
export function leadingLabels(line: string): string[] {
  const labels: string[] = [];
  let rest = line;
  for (let match = LABEL.exec(rest); match; match = LABEL.exec(rest)) {
    labels.push(match[1]!);
    rest = rest.slice(match[0].length);
  }
  return labels;
}

/** The subsection path after `line`, given the path before it. Lines without labels keep the path. */
export function subsectionPath(path: readonly string[], line: string, scheme: Scheme): string[] {
  let next = [...path];
  for (const label of leadingLabels(line)) {
    const level = labelLevel(label, scheme, next);
    next = [...next.slice(0, level - 1), label];
  }
  return next;
}

/**
 * The lines of a section under the kept subsections, given as label paths ("c/7" is (c)(7)), with the lead-in
 * lines above them ("(c) Further exemptions", "Notwithstanding subsection (a), none of the following..."). Lines
 * before the first label belong to no subsection and are left out. Throws when a kept subsection has no line.
 */
export function excerptLines(lines: readonly string[], keep: readonly string[], scheme: Scheme): string[] {
  let path: string[] = [];
  const paths = lines.map((line) => (path = subsectionPath(path, line, scheme)));
  const wanted = keep.map((k) => k.split('/'));
  const under = (p: string[], w: string[]) => p.length >= w.length && w.every((s, i) => p[i] === s);
  const above = (p: string[], w: string[]) => p.length > 0 && p.length < w.length && p.every((s, i) => w[i] === s);
  wanted.forEach((w, i) => {
    if (!paths.some((p) => under(p, w))) throw new Error(`no subsection ${keep[i]} in the section`);
  });
  return lines.filter((_, i) => wanted.some((w) => under(paths[i]!, w) || above(paths[i]!, w)));
}

/** "(2)(b)" for a path, at most two levels deep: a pinpoint, not an outline. */
export function pinOf(path: readonly string[]): string {
  return path
    .slice(0, 2)
    .map((label) => `(${label})`)
    .join('');
}

/** The citation line every part opens with: the cite, then the heading. */
export function headerLine(cite: string, title: string): string {
  return `${cite}. ${title}`.replace(/\.\.\s/, '. ').trim();
}

interface Run {
  lines: string[];
  /** The pinpoint of the subsection the run starts in (two levels at most). */
  pin: string;
  /** The top-level subsection the run ends in. */
  last: string | null;
  /** Opinions: the first and last star page the run's text sits on (null when no page is known). */
  page: string | null;
  end: string | null;
}

// Words or numbers: what makes a stretch of a line text on its page (a lone space or period is not).
const TEXT = /[\p{L}\p{N}]/u;

/**
 * The star pages a line's text sits on, given the page in effect before it, and the page in effect after it. The
 * reporter marks where each page begins ([*152]), so text before a marker is on the earlier page; a marker at the
 * very end of a line puts none of the line on its page.
 */
export function linePages(line: string, page: string | null): { pages: string[]; after: string | null } {
  const pages: string[] = [];
  let current = page;
  let from = 0;
  for (const marker of line.matchAll(/\[\*(\d{1,5})\]/g)) {
    if (current && TEXT.test(line.slice(from, marker.index))) pages.push(current);
    current = marker[1]!;
    from = marker.index! + marker[0].length;
  }
  if (current && TEXT.test(line.slice(from))) pages.push(current);
  return { pages, after: current };
}

// A slip opinion's paragraph ("¶ 15 ..."), or a footnote that names the paragraph its mark sits in (slip.ts).
const PARAGRAPH_LINE = /^(?:¶ (\d{1,4})\b|Footnote \S{1,4} \(¶ (\d{1,4})\):)/;

/**
 * The numbered paragraphs a line of a slip opinion sits in, given the paragraph in effect before it, and the one in
 * effect after it: a line opening "¶ 15" is paragraph 15; a heading ("II. Analysis", short, no closing punctuation)
 * is in none; other text (a list item, a block quotation, the rest of a split paragraph) is in the paragraph before.
 */
export function lineParagraphs(line: string, paragraph: string | null): { pages: string[]; after: string | null } {
  const opens = PARAGRAPH_LINE.exec(line);
  if (opens) return { pages: [opens[1] ?? opens[2]!], after: opens[1] ?? opens[2]! };
  const heading = line.length < 90 && !/[.:;?!”")\]]$/.test(line);
  return { pages: paragraph && !heading && TEXT.test(line) ? [paragraph] : [], after: paragraph };
}

/** Splits a line longer than the budget at sentence ends, so no part exceeds MAX_CHARS. */
export function splitLong(line: string, budget: number): string[] {
  if (line.length <= budget) return [line];
  const out: string[] = [];
  let rest = line;
  while (rest.length > budget) {
    const window = rest.slice(0, budget);
    const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('; '));
    const at = cut > budget / 3 ? cut + 1 : window.lastIndexOf(' ') > 0 ? window.lastIndexOf(' ') : budget;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Groups a unit's lines into runs under the budget, noting each run's subsection span and the star pages its text
 * covers: a run that opens on a star page starts on that page, and one whose text crosses onto the next page ends
 * there, so its pinpoint is a range ("151-52") rather than the page it starts on.
 */
export function runsOf(unit: Pick<LawUnit, 'lines' | 'scheme' | 'startPage' | 'pinpoint'>, budget: number): Run[] {
  const where = unit.pinpoint === 'paragraph' ? lineParagraphs : linePages;
  const runs: Run[] = [];
  let path: string[] = [];
  let page: string | null = unit.startPage ?? null;
  let current: Run | null = null;
  for (const line of unit.lines.flatMap((l) => splitLong(l, budget))) {
    const next = subsectionPath(path, line, unit.scheme);
    const size = current ? current.lines.reduce((n, l) => n + l.length + 1, 0) : 0;
    if (!current || size + line.length > budget) {
      current = { lines: [], pin: pinOf(next), last: next[0] ?? null, page: null, end: null };
      runs.push(current);
    }
    current.lines.push(line);
    if (next[0] !== undefined) current.last = next[0];
    path = next;
    const { pages, after } = where(line, page);
    for (const p of pages) {
      if (current.page === null || Number(p) < Number(current.page)) current.page = p;
      if (current.end === null || Number(p) > Number(current.end)) current.end = p;
    }
    page = after;
  }
  return runs;
}

/** A run's pinpoint: where it starts, and to the top-level subsection it ends in when that differs: "(3)-(6)". */
export function spanPin(run: Pick<Run, 'pin' | 'last'>): string {
  if (!run.pin) return '';
  const first = /^\(([^)]+)\)/.exec(run.pin)?.[1];
  return run.last && first && run.last !== first ? `${run.pin}-(${run.last})` : run.pin;
}

/** A page range as citations write it (Bluebook 3.2(a)): the last two digits kept, other repeated ones dropped. */
export function pageSpan(from: string, to: string): string {
  if (from.length !== to.length) return `${from}-${to}`;
  let same = 0;
  while (same < from.length - 2 && from[same] === to[same]) same++;
  return `${from}-${to.slice(same)}`;
}

/** A reporter cite with a pinpoint page or range: "107 P.3d 393, 395", "331 P.3d 140, 151-52" (no pin on page one). */
export function casePin(cite: string, page: string | null, end: string | null = null): string {
  const first = /(\d+)$/.exec(cite)?.[1];
  if (page && end && end !== page) return `${cite}, ${pageSpan(page, end)}`;
  return page && page !== first ? `${cite}, ${page}` : cite;
}

/** A neutral cite with the paragraphs a part covers: "2011 COA 17, ¶ 15", "2011 COA 17, ¶¶ 15-17". */
export function paragraphPin(cite: string, from: string | null, to: string | null = null): string {
  if (!from) return cite;
  return to && to !== from ? `${cite}, ¶¶ ${from}-${to}` : `${cite}, ¶ ${from}`;
}

// A slip opinion's footnote line (slip.ts): its number and the paragraph its mark sits in.
const FOOTNOTE_LINE = /^Footnote (\d{1,3}) \(¶ (\d{1,4})\):/;

interface FootnoteRef {
  n: string;
  p: string;
}

/** The footnotes each notes run of a slip opinion holds; a run that opens mid-footnote holds the one it continues. */
function footnoteRefs(runs: readonly Run[]): (FootnoteRef[] | null)[] {
  let carried: FootnoteRef | null = null;
  return runs.map((run) => {
    const refs = run.lines.flatMap((line) => {
      const m = FOOTNOTE_LINE.exec(line);
      return m ? [{ n: m[1]!, p: m[2]! }] : [];
    });
    if (carried && !FOOTNOTE_LINE.test(run.lines[0] ?? '')) refs.unshift(carried);
    carried = refs.at(-1) ?? carried;
    return refs.length > 0 ? refs : null;
  });
}

/**
 * A slip opinion's footnote part cited by its notes (footnotes are numbered through the opinion): one note at the
 * paragraph its mark sits in, "2011 COA 17, ¶ 7 n.2"; several by number, "2011 COA 17, nn.2-5" (Bluebook 3.2(b)).
 */
export function footnotePin(cite: string, notes: readonly FootnoteRef[]): string {
  const first = notes[0];
  const last = notes.at(-1);
  if (!first || !last) return cite;
  return first.n === last.n ? `${cite}, ¶ ${first.p} n.${first.n}` : `${cite}, nn.${first.n}-${last.n}`;
}

/** The pinpoint style of a case unit: paragraphs for a slip opinion's neutral cite, else star pages. */
function pinFor(unit: Pick<LawUnit, 'pinpoint'>): (cite: string, from: string | null, to: string | null) => string {
  return unit.pinpoint === 'paragraph' ? paragraphPin : casePin;
}

/**
 * The index parts of one unit: one part when it fits, else `<id>~1`, `<id>~2`, ... The first part is cited as the
 * unit itself; each later part adds its span, "(3)-(6)", or the one subsection it covers.
 */
export function chunkUnit(unit: LawUnit, budget = MAX_CHARS): BuiltChunk[] {
  if (unit.opinions) return chunkOpinions(unit, unit.opinions, budget);
  const header = headerLine(unit.cite, unit.title);
  const runs = runsOf(unit, budget - header.length - 40);
  const { lines: _lines, scheme: _scheme, startPage: _start, pinpoint: _pinpoint, excerpt, ...facts } = unit;
  return runs.map((run, index) => {
    // A part that starts at the unit's beginning is cited as the whole unit; later parts carry their pinpoint, and
    // so does every part of an excerpt, which never starts at the section's beginning.
    const pin = (index > 0 || excerpt) && !/\)$/.test(unit.cite) ? spanPin(run) : '';
    const cite = unit.scheme === 'case' ? pinFor(unit)(unit.cite, run.page, run.end) : `${unit.cite}${pin}`;
    const part = runs.length > 1 ? ` (part ${index + 1} of ${runs.length})` : '';
    const id = runs.length > 1 ? `${unit.id}~${index + 1}` : unit.id;
    const lead = `${headerLine(cite, unit.title)}${part}`;
    return { ...facts, id, cite, text: `${lead}\n\n${run.lines.join('\n')}\n` };
  });
}

/**
 * An opinion's parts, writing by writing, numbered through the case: no part mixes the court's opinion with a
 * concurrence or dissent, and footnotes form parts of their own after their writing's text. Each part's citation
 * line names its writing: "Opinion of the court, Fable, J." for the court's, and for a separate writing the
 * parenthetical a brief would use ("107 P.3d 393, 395 (Other, J., dissenting)"), with the text opening on a plain
 * marker, "(Dissent, Other, J.)", so the passage says what it is wherever it is read.
 */
function chunkOpinions(unit: LawUnit, opinions: readonly UnitOpinion[], budget: number): BuiltChunk[] {
  const { lines: _lines, scheme: _scheme, startPage: _start, pinpoint, excerpt: _excerpt, opinions: _opinions, ...facts } = unit;
  const pinned = pinFor(unit);
  const pieces = opinions.flatMap((writing) => {
    const label = opinionLabel(writing.opinion, writing.judge);
    const separate = isSeparateOpinion(writing.opinion);
    const marker = separate ? `(${label})` : null;
    const title = separate ? unit.title : `${unit.title}. ${label}`;
    const room = budget - headerLine(`${unit.cite}${opinionParenthetical(writing.opinion, writing.judge, writing.role)}`, title).length - (marker ? marker.length + 1 : 0) - 40;
    const body = runsOf({ lines: writing.lines, scheme: unit.scheme, startPage: writing.startPage ?? undefined, pinpoint }, room);
    const lastPage = body.at(-1)?.end ?? writing.startPage;
    const notes = runsOf({ lines: writing.notes, scheme: unit.scheme, startPage: lastPage ?? undefined, pinpoint }, room);
    const refs = pinpoint === 'paragraph' ? footnoteRefs(notes) : notes.map(() => null);
    return [...body.map((run) => ({ run, refs: null })), ...notes.map((run, i) => ({ run, refs: refs[i]! }))].map((piece) => ({ ...piece, writing, marker, title }));
  });
  return pieces.map(({ run, refs, writing, marker, title }, index) => {
    const pin = refs ? footnotePin(unit.cite, refs) : pinned(unit.cite, run.page, run.end);
    const cite = `${pin}${opinionParenthetical(writing.opinion, writing.judge, writing.role)}`;
    const part = pieces.length > 1 ? ` (part ${index + 1} of ${pieces.length})` : '';
    const id = pieces.length > 1 ? `${unit.id}~${index + 1}` : unit.id;
    const lines = marker ? [marker, ...run.lines] : run.lines;
    const text = `${headerLine(cite, title)}${part}\n\n${lines.join('\n')}\n`;
    return { ...facts, id, cite, opinion: writing.opinion, ...(writing.judge ? { author: writing.judge } : {}), text };
  });
}
