// SPDX-License-Identifier: Apache-2.0
// Colorado Court of Appeals slip opinions (W4c, 2026-10-05): the opinion as the division announced it, for the
// opinions the Caselaw Access Project has no copy of. CourtListener (Free Law Project) keeps the PDF the court
// published (storage.courtlistener.com); its REST API needs a token, so the build reads the PDF.
//
// The layout: a summary that is no part of the opinion, a caption page (parties, counsel, "Opinion by JUDGE X",
// the panel line "Y and Z, JJ., concur"), then numbered paragraphs ("¶ 1"), double spaced, a page number at the
// foot, and footnotes single spaced under a gap at the page bottom (a long one runs on at the foot of the next
// page). A footnote is marked in the text by a smaller run ("Fable" "1" "contends") or, in some files, by a digit
// set close after a word ("the motion,1 finding"). A neutral citation is pinpointed by paragraph, so every
// paragraph keeps its "¶ n" and every footnote says the paragraph its mark sits in. The summary, caption and
// counsel are head matter and dropped, like CAP's. The build refuses a file whose paragraphs skip, whose footnote
// marks and texts do not pair one to one, or whose panel line names a separate writing the text does not hold.
import { isSeparateOpinion } from '../../worker/law-cite.ts';
import { headingOf, judgeName } from './opinions.ts';
import type { PdfItem } from './pdf.ts';
import type { UnitOpinion } from './types.ts';

interface Line {
  page: number;
  /** The baseline of the line's largest run. */
  y: number;
  /** The left edge of its first run. */
  x: number;
  items: PdfItem[];
}

/** Footnote marks and labels are set at 9 points against 12 to 14 point text. */
const SMALL = 11;
/** Page numbers sit at the foot, below this. */
const FOOT = 60;
/** Footnote lines are single spaced (about 16 points apart); body lines double (about 33). */
const SINGLE = 22;
/** The gap between the last body line and the footnotes under it (the rule between them); body gaps stay under it. */
const FOOTNOTE_GAP = 40;
/** A centered heading starts well in from the margin; quotations and lists are indented less. */
const HEADING_INDENT = 85;
/** Wrapped lines of one paragraph or item start at the same edge, to the point. */
const SAME_EDGE = 1.5;
// A heading's own label set apart from its words ("II." "Analysis"), and a list item's ("•", "(4)").
const HEADING_LABEL = /^(?:[IVX]{1,5}|[A-Z]|\d{1,2}|[a-z])\.$/;
const LIST_LABEL = /^(?:[•▪·]|\((?:\d{1,2}|[a-z]{1,2}|[ivx]{1,5})\))$/;
const PARAGRAPH = /^¶\s?(\d{1,4})$/;
const NUMBER = /^\d{1,2}\s*$/;
// The closing line of a writing: "JUDGE OTHER and JUDGE THIRD concur."
const CLOSING_TAIL = /(?:specially\s+)?(?:concurs?|dissents?)\.?$/u;
const CLOSING_NAME = /^(?:CHIEF\s+)?(?:JUDGE|JUSTICE)\s+[\p{Lu}.'’ -]+$/u;

/**
 * One pass over the names, each standing alone between commas and "and". A single pattern for the whole line could read
 * a run of capitals in so many ways that a short line stalled the builder.
 */
export function isClosing(text: string): boolean {
  const tail = CLOSING_TAIL.exec(text);
  if (!tail) return false;
  const names = text.slice(0, tail.index).trimEnd().replace(/^and\s+/, '').replace(/,$/, '');
  return names.split(/\s*,\s*(?:and\s+)?|\s+and\s+/).every((name) => CLOSING_NAME.test(name));
}

/** The runs of a page grouped into lines (a raised mark stays on its line), top to bottom, each left to right. */
export function slipLines(items: readonly PdfItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const item of sorted) {
    const last = lines.at(-1);
    if (last && last.page === item.page && Math.abs(last.y - item.y) <= 5) last.items.push(item);
    else lines.push({ page: item.page, y: item.y, x: item.x, items: [item] });
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.x = line.items[0]!.x;
    line.y = line.items.reduce((big, item) => (item.size > big.size ? item : big)).y;
  }
  return lines;
}

/** The text of runs set side by side: a space where the runs do not touch. */
export function joinRuns(items: readonly PdfItem[]): string {
  let text = '';
  let end = -Infinity;
  for (const item of items) {
    if (text && item.x - end > 1.5 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
    text += item.str;
    end = item.x + item.width;
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** A wrapped line joined to the one before it; a line ending in a hyphen after a letter or digit ("38-") runs on. */
export function joinWrapped(before: string, after: string): string {
  return /[\p{L}\d]-$/u.test(before) ? `${before}${after}` : `${before} ${after}`;
}

/** The page number line at the foot of a page. */
function isPageNumber(line: Line): boolean {
  return line.y < FOOT && line.items.every((item) => /^\d{1,3}$/.test(item.str.trim()));
}

/**
 * Where a page's footnotes start: the first line of the single spaced run at the bottom of the page when a gap wider
 * than any body gap sits above it; the page's length when it has none.
 */
export function footnoteStart(lines: readonly Pick<Line, 'y'>[]): number {
  let start = lines.length - 1;
  while (start > 0 && lines[start - 1]!.y - lines[start]!.y < SINGLE) start--;
  return start > 0 && lines[start - 1]!.y - lines[start]!.y > FOOTNOTE_GAP ? start : lines.length;
}

interface Writing extends UnitOpinion {
  /** Footnote number to the paragraph its mark sits in. */
  marks: Map<number, number>;
}

interface Caption {
  /** The caption page's text: parties, court numbers, panel. */
  text: string;
  author: string | null;
  panel: string;
}

/** The caption between the summary and ¶ 1: who wrote the opinion and how the panel voted. */
function readCaption(lines: readonly Line[]): Caption {
  const texts = lines.map((line) => joinRuns(line.items));
  const from = texts.findIndex((text) => /^COLORADO (?:COURT OF APPEALS|SUPREME COURT)\b/i.test(text));
  if (from < 0) throw new Error('no caption in the slip opinion');
  const byAt = texts.findIndex((text, i) => i > from && /^Opinion by\b/i.test(text));
  if (byAt < 0) throw new Error('no "Opinion by" line in the slip opinion caption');
  const panel = texts.slice(byAt + 1, byAt + 3).find((text) => /\b(?:concurs?|dissents?|concurring|dissenting)\b/i.test(text)) ?? '';
  if (!panel) throw new Error('no panel line ("..., JJ., concur") in the slip opinion caption');
  return { text: texts.slice(from, byAt).join(' '), author: judgeName(texts[byAt]!), panel };
}

/** A slip opinion read: the caption's text (for the parties check) and each writing, the court's first. */
export interface SlipCase {
  caption: string;
  writings: UnitOpinion[];
}

// A footnote's text ends a sentence or a citation; one that does not runs on at the foot of the next page.
const ENDED = /[.?!)\]”"]$/;

/** The left margin: the most common left edge of the body lines. */
function marginOf(lines: readonly Line[]): number {
  const counts = new Map<number, number>();
  for (const line of lines) counts.set(Math.round(line.x), (counts.get(Math.round(line.x)) ?? 0) + 1);
  return [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
}

/** Where a read of the opinion's body is: the writings so far, the paragraph and footnote counts, and how the last line was set. */
interface SlipState {
  margin: number;
  writings: Writing[];
  /** The writing lines go to now: the court's first, then each separate writing as it opens. */
  writing: Writing;
  footnotes: Map<number, string>;
  paragraph: number;
  nextMark: number;
  lastFootnote: number;
  kind: 'text' | 'heading' | null;
  lastX: number;
}

function newWriting(opinion: Writing['opinion'], judge: Writing['judge'], role: Writing['role']): Writing {
  return { opinion, judge, role, lines: [], notes: [], startPage: null, marks: new Map() };
}

/** A footnote mark in the text: they come in order, each noted against the paragraph it sits in. */
function markFootnote(s: SlipState, n: number): void {
  if (n !== s.nextMark) throw new Error(`footnote mark ${n} where mark ${s.nextMark} was expected`);
  s.writing.marks.set(n, s.paragraph);
  s.nextMark++;
}

/** Takes a line's "¶ n" opener off its runs and counts the paragraph. False when the line is not one that opens a paragraph. */
function openParagraph(s: SlipState, runs: PdfItem[]): boolean {
  const first = runs[0];
  const head = first ? PARAGRAPH.exec(first.str.trim()) : null;
  if (!first || head === null || first.x >= s.margin - 5) return false;
  runs.shift();
  const n = Number(head[1]);
  if (n !== s.paragraph + 1) throw new Error(`¶ ${n} follows ¶ ${s.paragraph}`);
  s.paragraph = n;
  return true;
}

/** The runs of a line that are text, with the footnote marks counted and left out: raised runs, then inline digits. */
function takeMarks(s: SlipState, runs: readonly PdfItem[], page: number): { kept: PdfItem[]; text: string } {
  if (runs[0] && runs[0].size < SMALL && NUMBER.test(runs[0].str)) throw new Error(`a footnote label in the text on page ${page}`);
  const kept = runs.filter((run) => {
    if (run.size >= SMALL || !NUMBER.test(run.str)) return true;
    markFootnote(s, Number(run.str));
    return false;
  });
  let text = joinRuns(kept);
  // A mark set close after a word in the text's own size ("the motion,1 finding"); a decimal ("39.1") is not one.
  for (;;) {
    const inline = new RegExp(String.raw`(?<![0-9][.,])(?<=[\p{L}.,;:’”")\]])${s.nextMark}(?=\s|$)`, 'u');
    if (!inline.test(text)) break;
    text = text.replace(inline, '');
    markFootnote(s, s.nextMark);
  }
  return { kept, text };
}

/** A line that heads a concurrence or dissent starts a writing of its own. True when it did. */
function startSeparateWriting(s: SlipState, text: string): boolean {
  const heading = s.writing.lines.length > 0 ? headingOf(text) : null;
  if (!heading || !isSeparateOpinion(heading.opinion)) return false;
  s.writing = newWriting(heading.opinion, heading.judge, heading.role);
  s.writings.push(s.writing);
  s.kind = null;
  return true;
}

/** Sets a line of text in the writing: a new paragraph, list item or heading, or the wrapped rest of the one before. */
function placeLine(s: SlipState, line: Line, kept: readonly PdfItem[], text: string, opens: boolean): void {
  const { writing } = s;
  const first = kept[0]?.str.trim() ?? '';
  const x = kept[0]?.x ?? line.x;
  const item = LIST_LABEL.test(first) && kept.length > 1;
  const labeled = HEADING_LABEL.test(first) && kept.length > 1 && Math.abs(x - s.margin) > SAME_EDGE;
  const append = () => (writing.lines[writing.lines.length - 1] = joinWrapped(writing.lines.at(-1) ?? '', text));
  if (opens) {
    writing.lines.push(`¶ ${s.paragraph} ${text}`);
    [s.kind, s.lastX] = ['text', s.margin];
  } else if (item) {
    // A list item: its wrapped lines start where its text does, past the label.
    writing.lines.push(text);
    [s.kind, s.lastX] = ['text', kept[1]?.x ?? x];
  } else if (labeled || (x - s.margin > HEADING_INDENT && s.kind !== 'heading')) {
    writing.lines.push(text);
    s.kind = 'heading';
  } else if (s.kind === 'heading' && x - s.margin > HEADING_INDENT) {
    append();
  } else if (s.kind === 'text' && Math.abs(x - s.lastX) <= SAME_EDGE) {
    append();
  } else {
    writing.lines.push(text);
    [s.kind, s.lastX] = ['text', x];
  }
}

function bodyLine(s: SlipState, line: Line): void {
  const runs = [...line.items];
  const opens = openParagraph(s, runs);
  const { kept, text } = takeMarks(s, runs, line.page);
  if (!text) return;
  if (!opens && isClosing(text)) {
    s.kind = null;
    return;
  }
  if (!opens && startSeparateWriting(s, text)) return;
  placeLine(s, line, kept, text, opens);
}

/** A line in the footnotes at a page's foot: a new numbered note, or the run-on of the one before. */
function footnoteLine(s: SlipState, line: Line, first: boolean): void {
  const label = line.items[0];
  if (label && label.size < SMALL && NUMBER.test(label.str)) {
    const n = Number(label.str);
    if (n !== s.lastFootnote + 1) throw new Error(`footnote ${n} follows footnote ${s.lastFootnote}`);
    s.footnotes.set(n, joinRuns(line.items.slice(1)));
    s.lastFootnote = n;
    return;
  }
  const open = s.footnotes.get(s.lastFootnote);
  if (open === undefined || (first && ENDED.test(open))) throw new Error(`unlabeled single spaced text at the foot of page ${line.page}`);
  s.footnotes.set(s.lastFootnote, joinWrapped(open, joinRuns(line.items)));
}

/** The writings, once every mark pairs with a note and the panel line agrees with how many writings there are. */
function finishSlip(s: SlipState, caption: Caption): SlipCase {
  const marked = s.writings.flatMap((w) => [...w.marks.keys()]);
  if (marked.length !== s.footnotes.size || marked.some((n) => !s.footnotes.has(n))) {
    throw new Error(`the slip opinion's ${marked.length} footnote marks and ${s.footnotes.size} footnotes do not pair up`);
  }
  const separate = /\bdissent|\bspecially concur|\bconcur\w* in (?:part|the judgment)/i.test(caption.panel);
  if (separate !== s.writings.length > 1) throw new Error(`the panel line "${caption.panel}" and the ${s.writings.length} writings found disagree`);
  return {
    caption: caption.text,
    writings: s.writings.map(({ marks, ...w }) => ({ ...w, notes: [...marks].map(([n, p]) => `Footnote ${n} (¶ ${p}): ${s.footnotes.get(n)}`) })),
  };
}

/**
 * The writings of a Colorado slip opinion from its PDF's text runs (pdf.ts pdfItems): numbered paragraphs as lines
 * that open "¶ n", headings and list items as lines of their own, footnotes as notes "Footnote 3 (¶ 20): ...".
 */
export function slipOpinion(items: readonly PdfItem[]): SlipCase {
  const all = slipLines(items).filter((line) => !isPageNumber(line));
  const start = all.findIndex((line) => PARAGRAPH.exec(line.items[0]!.str.trim())?.[1] === '1');
  if (start < 0) throw new Error('no ¶ 1 in the slip opinion');
  const caption = readCaption(all.slice(0, start));
  const body = all.slice(start);
  const majority = newWriting('majority', caption.author, 'opinion of the court');
  const margin = marginOf(body);
  const state: SlipState = { margin, writings: [majority], writing: majority, footnotes: new Map(), paragraph: 0, nextMark: 1, lastFootnote: 0, kind: null, lastX: margin };

  for (const page of new Set(body.map((line) => line.page))) {
    const lines = body.filter((line) => line.page === page);
    const cut = footnoteStart(lines);
    for (const line of lines.slice(0, cut)) bodyLine(state, line);
    lines.slice(cut).forEach((line, i) => footnoteLine(state, line, i === 0));
  }
  return finishSlip(state, caption);
}
