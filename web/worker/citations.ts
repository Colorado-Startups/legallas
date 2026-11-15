// SPDX-License-Identifier: Apache-2.0
// Citations for Legallas answers. The model writes [doc:<id> p:<n>]; only ids that were retrieved for this
// question and are live documents survive, so an answer can never link to a file the room did not hand it.
import { pageSegments, type CitableDoc, type FoundPassage } from './passages.ts';

/** One validated citation, sent to the browser in the final `citations` event. */
export interface Citation {
  id: string;
  page: number;
  name: string;
  /** The permanent control number (migration 0003); null until the document is numbered. */
  control_seq: number | null;
  /** The pinpoint passage on that page (R10), or null when no sentence of the page fits. */
  quote: string | null;
}

/** Which pages of a document an answer may cite for this question (cite-book.ts builds the room's). */
export interface PageRule {
  allows(id: string, page: number): boolean;
}

/** One retrieved passage as the index holds it, [[doc:<id> p:<n>]] markers included. */
export type SourceChunk = FoundPassage;

const MAX_PAGE = 100_000;
const MAX_CITATIONS = 50;

// What the model writes. Loose on spacing, strict on the id and page shapes. gpt-oss often writes its native
// fullwidth brackets (【doc:<id> p:<n>】) instead of [ ], so both are accepted (eval of 2026-10-02).
const ANSWER_CITE = /[[【]doc:\s*([A-Za-z0-9_-]{1,64})\s+p(?:age)?[:.]?\s*([0-9]{1,6})[\]】]/g;
// What the index text carries: [[doc:<id> p:<n>]].
const INDEX_MARKER = /\[\[doc:([A-Za-z0-9_-]{1,64}) p:([0-9]{1,6})\]\]/g;

/** Every [doc:<id> p:<n>] reference in an answer, in order, duplicates included. */
export function citedRefs(answer: string): { id: string; page: number }[] {
  const refs: { id: string; page: number }[] = [];
  for (const match of answer.matchAll(ANSWER_CITE)) refs.push({ id: match[1]!, page: Number(match[2]) });
  return refs;
}

/** Index markers inside a retrieved chunk, rewritten to the single-bracket form the model should cite. */
export function markersToCites(text: string): string {
  return text.replace(INDEX_MARKER, (_, id: string, page: string) => `[doc:${id} p:${page}]`);
}

function pageFits(page: number, doc: CitableDoc): boolean {
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) return false;
  return doc.pages === null || page <= doc.pages;
}

/**
 * The answer's citations that the browser may turn into links. A reference survives only if its id is in
 * `citable` (retrieved for this question AND live in D1) and its page exists in that document. Unknown ids,
 * removed documents and impossible pages are dropped. Order of first appearance; no duplicates. With `pages`
 * (the room's cite book), a page must also be one whose text reached the prompt or a case-picture proof tag's page.
 */
export function validateCitations(
  answer: string,
  citable: ReadonlyMap<string, CitableDoc>,
  chunks: readonly SourceChunk[] = [],
  pages?: PageRule,
): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();
  const carriers = citeCarriers(answer);
  for (const ref of citedRefs(answer)) {
    const doc = citable.get(ref.id);
    if (!doc || !pageFits(ref.page, doc) || (pages && !pages.allows(ref.id, ref.page))) continue;
    const key = `${ref.id}:${ref.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const quote = pinpointQuote(pageSegments(chunks, ref.id, ref.page), carriers.get(key) ?? '');
    const seq = doc.control_seq;
    const control_seq = typeof seq === 'number' && Number.isInteger(seq) && seq > 0 ? seq : null;
    out.push({ id: doc.id, page: ref.page, name: doc.name, control_seq, quote });
    if (out.length === MAX_CITATIONS) break;
  }
  return out;
}

/** The answer sentence that carries each cite: the text on its line, back to the previous sentence end. */
export function citeCarriers(answer: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of answer.matchAll(ANSWER_CITE)) {
    const lineStart = answer.lastIndexOf('\n', match.index - 1) + 1;
    const before = answer
      .slice(lineStart, match.index)
      .replace(ANSWER_CITE, ' ')
      .replace(/^\s*(?:[-*\u2022]\s+)?(?:CONFIRMED|READ|INFERENCE)\s*:\s*/, '')
      // The attribution answer-shape.ts adds names a kind of source, not the claim.
      .replace(/^According to (?:a|an|the) [^,]{1,40}, /, '');
    const parts = splitSentences(before);
    const last = parts.at(-1) ?? '';
    const carrier = quoteTokens(last).size >= 3 ? last : before;
    const key = `${match[1]}:${Number(match[2])}`;
    out.set(key, `${out.get(key) ?? ''} ${carrier}`.trim());
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Pinpoint quote (R10). For each citation, the 8 to 40 word sentence on the cited page that shares the
// most words with the answer sentence carrying the cite, and shares enough of them to be the passage the claim
// rests on (QUOTE_MIN_SHARED, or half of a short claim's words): one common word is not a pinpoint. The exhibit pane
// searches for it, so it stays a verbatim run of the page text: whitespace and hyphenation are normalized, nothing
// else is rewritten.
// ---------------------------------------------------------------------------------------------------

const QUOTE_MIN_WORDS = 8;
// 40, not 20: findings in agreements and filings often run longer, and a long sentence is still capped at 200 characters.
const QUOTE_MAX_WORDS = 40;
/** Content words a quote must share with the claim, unless the claim is short (then half of its words, at least 2). */
const QUOTE_MIN_SHARED = 3;
export const QUOTE_MAX_CHARS = 200;
// A period after these words (or after a single capital, as in "P. Teller") does not end a sentence.
const ABBREVIATIONS = new Set(
  ('mr mrs ms dr jr sr st no nos inc co corp ltd llc v vs etc al e.g i.e u.s ' +
    'jan feb mar apr jun jul aug sep sept oct nov dec art sec ex para pp p hon esq').split(' '),
);
const STOPWORDS = new Set(
  ('the a an and or but of to in on at by for with as is was were be been being it its that this these those ' +
    'from he she they his her their them him which who whom what when where there here has have had not no ' +
    'so than then into onto upon about over under also any all each other such').split(' '),
);

/** Whitespace collapsed; soft hyphens dropped; Unicode hyphens made ASCII; words broken across lines rejoined. */
export function normalizeQuoteText(text: string): string {
  return text
    .replace(/­/g, '')
    .replace(/[‐‑]/g, '-')
    .replace(/(\p{L})-[ \t]*\r?\n\s*(\p{Ll})/gu, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sentences of one normalized run, keeping abbreviations and initials inside their sentence. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const end of text.matchAll(/[.!?]["'”’)\]]?\s+(?=["'“‘(\[]?[\p{Lu}\p{N}])/gu)) {
    const stop = end.index + end[0].trimEnd().length;
    const word = /([\p{L}.]+)\.["'”’)\]]?$/u.exec(text.slice(start, stop))?.[1] ?? '';
    if (ABBREVIATIONS.has(word.toLowerCase()) || /^\p{Lu}$/u.test(word)) continue;
    out.push(text.slice(start, stop).trim());
    start = end.index + end[0].length;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/** Distinct content words: lowercase letters and digits, stopwords and single letters left out. */
export function quoteTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const [word] of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    if ((word.length > 1 || /\d/.test(word)) && !STOPWORDS.has(word)) tokens.add(word);
  }
  return tokens;
}

/** A quote candidate: the text it is scored on, and for a table row the cells one of which is quoted. */
interface Candidate {
  text: string;
  cells?: string[];
}

const RULE_CELL = /^:?-{2,}:?$/;
const wordCount = (text: string) => text.split(' ').length;

/** A markdown table row's cells (pipes stripped), or null for any other line; a separator row has none. */
export function tableCells(line: string): string[] | null {
  if ((line.match(/\|/g)?.length ?? 0) < 2 || !/^\s*\|/.test(line)) return null;
  const cells = line.split('|').map((cell) => normalizeQuoteText(cell)).filter((cell) => cell !== '' && !RULE_CELL.test(cell));
  return cells.length > 0 ? cells : null;
}

/**
 * Runs of whole lines from a block with no sentence breaks (a table, form or header laid out line by line): from each
 * line, the shortest run that reaches QUOTE_MIN_WORDS, if it stays under QUOTE_MAX_WORDS.
 */
function lineWindows(block: string): string[] {
  const lines = block.split('\n').filter((line) => line.trim() !== '');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i; j < lines.length; j++) {
      const text = normalizeQuoteText(lines.slice(i, j + 1).join('\n'));
      if (wordCount(text) > QUOTE_MAX_WORDS) break;
      if (wordCount(text) >= QUOTE_MIN_WORDS) {
        out.push(text);
        break;
      }
    }
  }
  return out;
}

/**
 * Candidates on a page: each markdown table row (scored on its cells, quoting one cell), then paragraphs and list
 * items split into sentences of 8 to 40 words; a block too long to split (no sentence ends, as in a PDF table) also
 * gives runs of its lines.
 */
function candidates(segments: readonly string[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const add = (candidate: Candidate) => {
    if (seen.has(candidate.text)) return;
    seen.add(candidate.text);
    out.push(candidate);
  };
  for (const segment of segments) {
    // Table rows leave a blank line behind, so the prose around them splits as before.
    const prose = segment.split('\n').map((line) => {
      const cells = tableCells(line);
      if (!cells) return line;
      add({ text: cells.join(' '), cells });
      return '';
    });
    for (const block of prose.join('\n').split(/\n\s*\n|\n(?=\s*(?:[-*•#>|]|\d{1,2}[.)])\s)/)) {
      const flat = normalizeQuoteText(block).replace(/^(?:[-*•#>|]+|\d{1,2}[.)])\s+/, '');
      const sentences = splitSentences(flat);
      for (const sentence of sentences) {
        const words = wordCount(sentence);
        if (words >= QUOTE_MIN_WORDS && words <= QUOTE_MAX_WORDS) add({ text: sentence });
      }
      if (sentences.some((sentence) => wordCount(sentence) > QUOTE_MAX_WORDS)) for (const run of lineWindows(block)) add({ text: run });
    }
  }
  return out;
}

/** At most QUOTE_MAX_CHARS, cut at a word boundary so the quote stays a prefix of the page text. */
function capQuote(sentence: string): string {
  if (sentence.length <= QUOTE_MAX_CHARS) return sentence;
  const cut = sentence.slice(0, QUOTE_MAX_CHARS + 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut.slice(0, QUOTE_MAX_CHARS)).trimEnd();
}

/** True when `shared` content words are enough overlap for a claim of `wanted` content words. */
function enoughOverlap(shared: number, wanted: number): boolean {
  return shared >= QUOTE_MIN_SHARED || (shared >= 2 && shared * 2 >= wanted);
}

/** Content words of `text` that the claim has. */
function shared(text: string, wanted: ReadonlySet<string>): number {
  let score = 0;
  for (const token of quoteTokens(text)) if (wanted.has(token)) score++;
  return score;
}

/**
 * The page sentence (or table row, or run of lines) with the highest word overlap with `carrier`, or null when none
 * shares enough content words with it (enoughOverlap). A table row is quoted by its cell sharing the most words, so
 * the quote is verbatim in the file and in the rendered table alike. Ties go to the earlier candidate.
 */
export function pinpointQuote(segments: readonly string[], carrier: string): string | null {
  const wanted = quoteTokens(carrier);
  if (wanted.size === 0) return null;
  let best: Candidate | null = null;
  let bestScore = 0;
  for (const candidate of candidates(segments)) {
    const score = shared(candidate.text, wanted);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (best === null || !enoughOverlap(bestScore, wanted.size)) return null;
  if (!best.cells) return capQuote(best.text);
  let cell = best.cells[0]!; // safe: tableCells returns at least one cell
  for (const next of best.cells) if (shared(next, wanted) > shared(cell, wanted)) cell = next;
  return capQuote(cell);
}
