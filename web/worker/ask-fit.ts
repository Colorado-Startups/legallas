// SPDX-License-Identifier: Apache-2.0
// An Ask turn's input fitted to a smaller prompt, for Groq (ask-groq.ts GROQ_PROMPT_CHARS). Ask's prompt usually runs
// about 18,000 tokens and the case picture alone about 7,400 (replica retrieval, 2026-10-04), while Groq's free plan
// takes 8,000 tokens a minute. So the input is trimmed, whole pieces at a time, until the prompt askTurn builds from
// it fits, in this order:
//   1. law passages, all of them;
//   2. retrieved passages past the best MIN_PASSAGES, lowest ranked first (so the best-ranked passages stay);
//   3. the case picture's proof lines (its "   - (" point lines), last first;
//   4. the case picture's other lines, last first, keeping its first ("Matter now: ...");
//   5. passages down to the best one, then the case picture itself;
//   6. the last passage's pages, last first, cut only before a [[doc:<id> p:<n>]] marker, so every page left keeps
//      its marker and so its citable page.
// Citable ids follow the text: a document stays citable only while a kept passage or a kept proof tag names it, so
// the model is never offered a document the prompt no longer shows, and every tag left names a citable document.
// An input that already fits comes back unchanged, so a Workers AI turn is never touched.
import { askTurn, type TurnInput } from './ask-turn.ts';
import type { CitableDoc } from './passages.ts';
import type { PromptChunk } from './prompt.ts';

/** Retrieved passages kept before the case picture's proof lines go (stage 2). */
export const MIN_PASSAGES = 3;

/** A boundary as long as prompt.ts newBoundary's, so a measured prompt is as long as the one sent. */
const MEASURE_BOUNDARY = `CASE-DATA-${'0'.repeat(24)}`;

/** A case picture point line (ask-brief.ts trackText): a point to prove and its proof tags. */
const POINT_LINE = /^ {3}- \(/;
/** Any line. */
const ANY_LINE = /^/;
/** A proof tag in the case picture (cite-book.ts TAG). */
const BRIEF_TAG = /\[doc:([A-Za-z0-9_-]{1,64}) p:[0-9]{1,6}\]/g;
/** Where a passage's next page starts: before an index marker (citations.ts markers). */
const PAGE_START = /(?=\[\[doc:[A-Za-z0-9_-]{1,64} p:[0-9]{1,6}\]\])/;

/** What the fit took out: counts only, for a log line. */
export interface Dropped {
  law: number;
  passages: number;
  briefLines: number;
  brief: boolean;
  pages: number;
}

export interface Fit {
  input: TurnInput;
  /** Characters of the prompt askTurn builds from `input` (system and user messages). */
  chars: number;
  /** False when even the smallest input (the question, the rules and one page of the best passage) is too long. */
  fits: boolean;
  dropped: Dropped;
}

/** Characters of the messages askTurn builds from `input`. */
export function promptChars(input: TurnInput): number {
  return askTurn(input, { boundary: MEASURE_BOUNDARY }).messages.reduce((n, message) => n + message.content.length, 0);
}

/** The live documents of `chunks`, from `citable`: a document whose passages were all dropped is not citable. */
function citableOf(chunks: readonly PromptChunk[], citable: ReadonlyMap<string, CitableDoc>): Map<string, CitableDoc> {
  const ids = new Set(chunks.map((chunk) => chunk.docId));
  return new Map([...citable].filter(([id]) => ids.has(id)));
}

/** The case picture with only these lines, its citable documents cut to the proof tags still in them. */
function briefOf(brief: NonNullable<TurnInput['brief']>, lines: readonly string[]): NonNullable<TurnInput['brief']> {
  const text = lines.join('\n');
  const tagged = new Set([...text.matchAll(BRIEF_TAG)].map((match) => match[1]!)); // safe: the pattern has the group
  return { ...brief, text, citable: new Map([...brief.citable].filter(([id]) => tagged.has(id))) };
}

/**
 * `input` trimmed until askTurn's prompt is at most `budget` characters (see the order above). Pure: it measures by
 * building the prompt, so the alias tags, data blocks and reminders count exactly as they will be sent.
 */
export function fitTurn(input: TurnInput, budget: number): Fit {
  const dropped: Dropped = { law: 0, passages: 0, briefLines: 0, brief: false, pages: 0 };
  let current: TurnInput = input;
  let chars = promptChars(current);
  const done = (): Fit => ({ input: current, chars, fits: chars <= budget, dropped });
  if (chars <= budget) return done();
  /** Applies `next` and measures; false when there was nothing left to take at this stage. */
  const take = (next: TurnInput | null): boolean => {
    if (!next) return false;
    current = next;
    chars = promptChars(current);
    return true;
  };

  // 1. Law.
  if ((current.law ?? []).length > 0) {
    dropped.law = current.law!.length; // safe: checked above
    take({ ...current, law: [] });
  }
  // 2. Passages past the best MIN_PASSAGES.
  while (chars > budget && take(withoutLastPassage(current, MIN_PASSAGES))) dropped.passages++;
  // 3 and 4. The case picture's proof lines, then its other lines (the first stays). Lines go in batches just long
  // enough to cover the overshoot: the prompt shrinks by at most a line's length (alias tags are shorter), so a batch
  // never takes more than one line past what was needed, and a long case picture costs a few measures, not one a line.
  for (const [pattern, keep] of [[POINT_LINE, 0], [ANY_LINE, 1]] as const) {
    for (let cut = withoutBriefLines(current, pattern, chars - budget, keep); chars > budget && cut; cut = withoutBriefLines(current, pattern, chars - budget, keep)) {
      dropped.briefLines += cut.lines;
      take(cut.input);
    }
  }
  // 5. Passages down to one, then the case picture.
  while (chars > budget && take(withoutLastPassage(current, 1))) dropped.passages++;
  if (chars > budget && current.brief) {
    dropped.brief = true;
    take({ ...current, brief: null });
  }
  // 6. The last passage's pages.
  while (chars > budget && take(withoutLastPage(current))) dropped.pages++;
  return done();
}

/** The input without its lowest-ranked passage, or null when only `keep` remain. */
function withoutLastPassage(input: TurnInput, keep: number): TurnInput | null {
  if (input.chunks.length <= keep) return null;
  const chunks = input.chunks.slice(0, -1);
  return { ...input, chunks, citable: citableOf(chunks, input.citable) };
}

/**
 * The input without the case picture's last lines matching `pattern` (past its first `keep` lines), taken from the
 * end until their characters cover `over`; null when no line matches.
 */
function withoutBriefLines(input: TurnInput, pattern: RegExp, over: number, keep: number): { input: TurnInput; lines: number } | null {
  if (!input.brief) return null;
  const lines = input.brief.text.split('\n');
  const gone = new Set<number>();
  let freed = 0;
  for (let i = lines.length - 1; i >= keep && freed < over; i--) {
    if (!pattern.test(lines[i]!)) continue; // safe: in range
    gone.add(i);
    freed += lines[i]!.length + 1; // safe: in range
  }
  if (gone.size === 0) return null;
  return { input: { ...input, brief: briefOf(input.brief, lines.filter((_, i) => !gone.has(i))) }, lines: gone.size };
}

/** The input with the last passage's last page cut off, or null when it has one page left. */
function withoutLastPage(input: TurnInput): TurnInput | null {
  const last = input.chunks.at(-1);
  if (!last) return null;
  const pages = last.text.split(PAGE_START);
  if (pages.length <= 1) return null;
  const chunks = [...input.chunks.slice(0, -1), { ...last, text: pages.slice(0, -1).join('') }];
  return { ...input, chunks, citable: citableOf(chunks, input.citable) };
}
