// SPDX-License-Identifier: Apache-2.0
// The shape of one Ask answer on screen (card P7): the safe blocks from sanitize.ts regrouped into labelled
// claims, the "Not in the record" callout and the general background box. Pure, so it is tested in node and
// shared by the Ask page and the drawer.
//
// The model writes CONFIRMED / READ / INFERENCE (prompt.ts); the room shows Fact / Read / Inference. The server
// already holds each label to its cites (worker/answer-shape.ts); here, once the citations are in, a Fact whose
// every cite was dropped is shown as Read too, which also covers turns saved before that check.
// "Not in the record" comes from the server's dontKnow flag only (R11); the "I don't know." opener the
// protocol requires is folded into it, never shown twice. General background always goes last.
//
// The law library (T21): LAW claims and the "Law (from the law library)" section form the Law group, drawn
// apart from the record with its notice. The room enforces the line the prompt draws: a law cite never stands
// behind a Fact or Read claim (law is not a fact of the case), and a record cite never stands behind a LAW
// claim (a pleading is not law); either is shown as a note instead of a link.
//
// A LAW claim whose every law cite is a dissent's or concurrence's part is labelled as that writing ("Dissent"),
// never shown as the court's holding, with a note when its words do not say so themselves (W4b, 2026-10-05).
//
// Card 11.5 (product notices A1, A4, A6): every source is "Checked against [source] on [date]" or not checked. A law
// citation written as plain text, with no validated [law:] tag in the answer naming it, is followed by NOT_CHECKED_NOTE.
// A deadline the answer names is flagged (answer-deadlines.ts).
import { formatCite } from './matter-api.ts';
import { deadlineFlags, type DeadlineFlag } from './answer-deadlines.ts';
import { isoDay } from './documents-intake-rules.ts';
import { baseCitation, CASE_LAW_THROUGH, citationsIn, isSeparateOpinion, normalizeCitation } from '../../worker/law-cite.ts';
import { pageIsKnown } from '../../worker/page-known.ts';
import { CHECKED_AGAINST, NOT_CHECKED, RECOMMENDATION_NOTE, RECOMMENDATION_STAMP } from '../../worker/product-notices.ts';
import { isBackgroundHeading, isLawHeading, isOptionsHeading, lawIndex, renderAnswer, type Block, type Inline } from './sanitize.ts';
import { isCompanyRoom } from './room-shape.ts';

/** The four kinds of claim in an answer: fact, read, inference and law. */
export type ClaimKind = 'fact' | 'read' | 'inference' | 'law';
/** The separate writing a LAW claim rests on alone; "separate" when its cites mix a dissent and a concurrence. */
export type SeparateWriting = 'dissent' | 'concurrence' | 'concurrence-dissent' | 'separate';

/** One part of an answer's body: a labelled claim, or a plain block. */
export type AnswerPart = { kind: 'claim'; claim: ClaimKind; inline: Inline[]; separate?: SeparateWriting } | Block;

/** An answer ready to draw: the not-in-the-record callout and the body parts. */
export interface AnswerView {
  /** The "Not in the record" callout's text; [] for the callout with its default sentence; null for none. */
  absent: Inline[] | null;
  body: AnswerPart[];
  /** Statements of law from the law library, drawn as the Law group with its notice. */
  law: AnswerPart[];
  /** Every option and the recommendation (prompt.ts OPTIONS_HEADING), drawn as their own group; record and law cites both stay. */
  options: AnswerPart[];
  /** General legal background, never from the record; drawn boxed after everything else. */
  background: Block[];
  /** The answer stopped at max_tokens (the server's `truncated`): CUT_OFF closes it. */
  cut: boolean;
  /** Deadlines the answer names, flagged with the A6 words. */
  deadlines: DeadlineFlag[];
  /** YYYY-MM-DD the room checked the record cites (the turn's day); null when unknown. */
  checkedOn: string | null;
}

/** The label shown for each kind of claim. */
export const CLAIM_LABELS: Record<ClaimKind, string> = { fact: 'Fact', read: 'Read', inference: 'Inference', law: 'Law' };
/** The label shown for each kind of separate writing. */
export const SEPARATE_LABELS: Record<SeparateWriting, string> = {
  dissent: 'Dissent',
  concurrence: 'Concurrence',
  'concurrence-dissent': 'Separate opinion',
  separate: 'Separate opinion',
};
/** Opens a claim resting only on a separate opinion when its own words do not say so. */
export const SEPARATE_NOTE = "[a separate opinion, not the court's holding]";
const MODEL_LABELS: Record<string, ClaimKind> = { CONFIRMED: 'fact', READ: 'read', INFERENCE: 'inference', LAW: 'law' };
const LABEL = /^\s*(CONFIRMED|READ|INFERENCE|LAW)\s*[:.-]\s*/;
const LABEL_ALONE = /^\s*(CONFIRMED|READ|INFERENCE|LAW)\s*$/;
/** Shown in place of a cite that crosses the line between the record and the law. */
export const LAW_NOT_FACT = '[law is not a fact of the case]';
/** The note placed after a case document that is cited as law. */
export const RECORD_NOT_LAW = '[a case document is not law]';
/** The same two in a company room (room-shape.ts), which has no case (card 11.3). */
export const COMPANY_LAW_NOT_FACT = '[law is not a fact in the documents]';
/** The note placed after a company-room document that is cited as law. */
export const COMPANY_RECORD_NOT_LAW = '[a document in this room is not law]';
const lawNotFact = () => (isCompanyRoom() ? COMPANY_LAW_NOT_FACT : LAW_NOT_FACT);
const recordNotLaw = () => (isCompanyRoom() ? COMPANY_RECORD_NOT_LAW : RECORD_NOT_LAW);
/** The notice shown with law: it is research support, and says how far the case law runs. */
export const LAW_NOTICE = `Research support; have your own lawyer review how it applies. Case law here runs through ${CASE_LAW_THROUGH}; check newer authority.`;
/** After a law citation written as plain text that no validated tag in the answer names (A4). */
export const NOT_CHECKED_NOTE = `[${NOT_CHECKED}]`;
/** Closes an answer the model stopped at max_tokens, in place of the ending it never wrote. */
export const CUT_OFF = 'This answer was cut off; ask a narrower question.';
const DONT_KNOW = /^\s*I don['’]t know\.?\s*/i;
// The model joins dates with narrow (U+202F) and thin (U+2009) spaces, which the answer serif draws almost
// zero-width ("May2012"). A plain no-break space keeps them together and reads as a full space.
const NARROW_SPACES = /[  ]/g;

/** `text` with narrow and thin spaces made full no-break spaces (U+00A0). Hyphens, U+2011 included, stay. */
export function widenSpaces(text: string): string {
  return text.replace(NARROW_SPACES, ' ');
}

/**
 * The claim a line of inline tokens opens with, and the tokens without the label. Null when unlabelled. LAW is a
 * label only when `allowLaw` (the server sent a law list); otherwise "LAW:" is ordinary text.
 */
export function splitClaim(inline: readonly Inline[], allowLaw = false): { claim: ClaimKind; inline: Inline[] } | null {
  const [first, second, ...rest] = inline;
  if (first?.kind === 'text') {
    const match = LABEL.exec(first.text);
    if (!match || (match[1] === 'LAW' && !allowLaw)) return null;
    const text = first.text.slice(match[0].length);
    return { claim: MODEL_LABELS[match[1]!]!, inline: [...(text ? [{ kind: 'text' as const, text }] : []), ...inline.slice(1)] };
  }
  // **CONFIRMED**: the fact
  if (first?.kind === 'strong' && LABEL_ALONE.test(first.text) && (allowLaw || first.text.trim() !== 'LAW')) {
    const claim = MODEL_LABELS[first.text.trim()]!;
    if (second?.kind !== 'text') return { claim, inline: inline.slice(1) };
    const text = second.text.replace(/^\s*[:.-]?\s*/, '');
    return { claim, inline: [...(text ? [{ kind: 'text' as const, text }] : []), ...rest] };
  }
  return null;
}

/** Bullets become claims one by one; unlabelled bullets stay together as a list between them. */
function listParts(items: readonly Inline[][], allowLaw: boolean): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let run: Inline[][] = [];
  const flush = () => {
    if (run.length) parts.push({ kind: 'ul', items: run });
    run = [];
  };
  for (const item of items) {
    const claim = splitClaim(item, allowLaw);
    if (!claim) {
      run.push(item);
      continue;
    }
    flush();
    parts.push({ kind: 'claim', ...claim });
  }
  flush();
  return parts;
}

function paragraphPart(block: Extract<Block, { kind: 'p' }>, allowLaw: boolean): AnswerPart {
  const claim = splitClaim(block.inline, allowLaw);
  return claim ? { kind: 'claim', ...claim } : block;
}

/** Drops the protocol's "I don't know." opener from the first paragraph; returns what is left of it. */
function takeDontKnow(blocks: Block[]): Inline[] {
  const first = blocks[0];
  if (first?.kind !== 'p' || first.inline[0]?.kind !== 'text' || !DONT_KNOW.test(first.inline[0].text)) return [];
  blocks.shift();
  const text = first.inline[0].text.replace(DONT_KNOW, '');
  return [...(text ? [{ kind: 'text' as const, text }] : []), ...first.inline.slice(1)];
}

/** Inline tokens of `kind` turned into a note. */
function swapTokens(inline: readonly Inline[], kind: Inline['kind'], note: string): Inline[] {
  return inline.map((t): Inline => (t.kind === kind ? { kind: 'note', text: note } : t));
}

/** A claim with the cites its kind may not carry turned into notes (see the header). */
export function guardClaim(part: AnswerPart): AnswerPart {
  if (part.kind !== 'claim') return part;
  if (part.claim === 'law') return { ...part, inline: swapTokens(part.inline, 'cite', recordNotLaw()) };
  if (part.claim === 'fact' || part.claim === 'read') return { ...part, inline: swapTokens(part.inline, 'law', lawNotFact()) };
  return part;
}

/**
 * Any part guarded for the section it lands in: claims by their kind; an unlabelled paragraph or list in the
 * record section may not carry a law cite, and one in the Law section may not carry a record cite.
 */
export function guardPart(part: AnswerPart, section: 'body' | 'law' | 'options'): AnswerPart {
  if (part.kind === 'claim') return guardClaim(part);
  // An option rests on the record and the law alike, so both kinds of source stay.
  if (section === 'options') return part;
  const [kind, note] = section === 'law' ? (['cite', recordNotLaw()] as const) : (['law', lawNotFact()] as const);
  if (part.kind === 'p') return { ...part, inline: swapTokens(part.inline, kind, note) };
  if (part.kind === 'ul') return { ...part, items: part.items.map((item) => swapTokens(item, kind, note)) };
  return part;
}

/**
 * One chip per source in a run of text: a later cite or law tag naming the same page (or law) as an earlier one in the
 * same claim, paragraph or list item is dropped, with the space before it (an answer once showed one page's chip 20
 * times). Notes are kept: each stands for a cite of its own.
 */
export function dedupeChips(inline: readonly Inline[]): Inline[] {
  const seen = new Set<string>();
  const out: Inline[] = [];
  for (const token of inline) {
    const key = token.kind === 'cite' ? token.href : token.kind === 'law' ? `law:${token.id}` : null;
    if (key !== null && seen.has(key)) {
      const last = out.at(-1);
      if (last?.kind === 'text' && last.text.trim() === '') out.pop();
      continue;
    }
    if (key !== null) seen.add(key);
    out.push(token);
  }
  return out;
}

/** `part` with `change` applied to each run of inline tokens it holds. */
function eachInline(part: AnswerPart, change: (inline: readonly Inline[]) => Inline[]): AnswerPart {
  if (part.kind === 'claim' || part.kind === 'p') return { ...part, inline: change(part.inline) };
  if (part.kind === 'ul') return { ...part, items: part.items.map(change) };
  return part;
}

const citeBase = (cite: string) => baseCitation(normalizeCitation(cite) ?? cite);

/** NOT_CHECKED_NOTE after each law citation in the text that `checked` (validated cites' bases) does not hold. */
function markUnchecked(inline: readonly Inline[], checked: ReadonlySet<string>): Inline[] {
  return inline.flatMap((token): Inline[] => {
    if (token.kind !== 'text' && token.kind !== 'strong') return [token];
    const hits = citationsIn(token.text).filter((hit) => !checked.has(baseCitation(hit.cite)));
    const note = (cite: string): Inline => ({ kind: 'note', text: NOT_CHECKED_NOTE, cite });
    if (hits.length === 0) return [token];
    if (token.kind === 'strong') return [token, ...hits.flatMap((hit): Inline[] => [{ kind: 'text', text: ' ' }, note(hit.cite)])];
    const out: Inline[] = [];
    let last = 0;
    for (const hit of hits) {
      const end = hit.index + hit.length;
      out.push({ kind: 'text', text: `${token.text.slice(last, end)} ` }, note(hit.cite));
      last = end;
    }
    if (last < token.text.length) out.push({ kind: 'text', text: token.text.slice(last) });
    return out;
  });
}

/** "Checked against [source] on [date]" (A1); without a date, just the source. */
function checkedAgainst(source: string, date: string | null | undefined): string {
  const line = CHECKED_AGAINST.replace('[source]', source);
  return date ? line.replace('[date]', date) : line.replace(' on [date]', '');
}

/** The tag a claim is drawn with: its kind, or the separate writing a LAW claim rests on alone. */
export function claimLabel(part: Extract<AnswerPart, { kind: 'claim' }>): string {
  return part.separate ? SEPARATE_LABELS[part.separate] : CLAIM_LABELS[part.claim];
}

/**
 * A LAW claim whose every validated law cite is a concurrence's or dissent's part is that writing's view, not the
 * court's holding: it is labelled as the writing, and opens with SEPARATE_NOTE unless its words name the writing.
 */
export function markSeparate(part: AnswerPart): AnswerPart {
  if (part.kind !== 'claim' || part.claim !== 'law') return part;
  const writings = part.inline.flatMap((t) => (t.kind === 'law' ? [t.opinion] : []));
  if (writings.length === 0 || !writings.every((o) => isSeparateOpinion(o))) return part;
  const same = writings.every((o) => o === writings[0]);
  const separate = (same ? writings[0] : 'separate') as SeparateWriting;
  const says = part.inline.some((t) => t.kind === 'text' && /\bdissent|\bconcurr|separate opinion/i.test(t.text));
  return { ...part, separate, inline: says ? part.inline : [{ kind: 'note', text: SEPARATE_NOTE }, { kind: 'text', text: ' ' }, ...part.inline] };
}

/** A Fact needs a cite that survived validation: with the final citations in, one without any is shown as Read. */
export function settleFact(part: AnswerPart, final: boolean): AnswerPart {
  if (!final || part.kind !== 'claim' || part.claim !== 'fact') return part;
  return part.inline.some((token) => token.kind === 'cite') ? part : { ...part, claim: 'read' };
}

/** Options for building an answer view: the don't-know flag and whether the model was cut off. */
export interface ViewOptions {
  dontKnow: boolean;
  /** The server said the model stopped at max_tokens; only for a finished turn. */
  truncated?: boolean;
  prefix: string;
  /** The server's validated law citations; absent when the law library is off or for older saved turns. */
  law?: readonly unknown[];
  /** When the turn was asked (Turn.at): the day its record cites were checked. */
  at?: string;
}

type Section = 'body' | 'law' | 'options' | 'background';

/** The lines of the options section (prompt.ts RECOMMEND_RULES), which open it even when its heading is missing. */
const OPTION_LINE = /^\s*(?:OPTION|RECOMMENDATION|NOT VERIFIED)\s*:/;

function opensOptions(part: AnswerPart): boolean {
  const lead = (inline: readonly Inline[]) => {
    const first = inline[0];
    return first?.kind === 'text' || first?.kind === 'strong' ? first.text : '';
  };
  if (part.kind === 'p') return OPTION_LINE.test(lead(part.inline));
  return part.kind === 'ul' && part.items.some((item) => OPTION_LINE.test(lead(item)));
}

/**
 * Where a part goes: LAW claims always to the Law group; record claims end a law or background section. Only a heading
 * ends the options: a labelled line among them is part of what they rest on.
 */
function sectionFor(part: AnswerPart, section: Section): Section {
  if (section === 'options' || opensOptions(part)) return 'options';
  if (part.kind !== 'claim') return section;
  if (part.claim === 'law') return 'law';
  return 'body';
}

/**
 * The answer as it is drawn. `citations` is null while streaming, as in renderAnswer. Streamed, final and saved
 * turns all come through here (paintTurn), so their spaces are widened in one place; cite quotes are untouched.
 */
export function answerView(answer: string, citations: readonly unknown[] | null, options: ViewOptions): AnswerView {
  const label = (cite: { control_seq?: number | null; page: number; name: string }) =>
    formatCite(options.prefix, { control: cite.control_seq ?? null, page: pageIsKnown(cite.name) ? cite.page : null });
  const blocks = renderAnswer(widenSpaces(answer), citations, label, options.law);
  const absent = options.dontKnow ? takeDontKnow(blocks) : null;
  const view: AnswerView = {
    absent,
    body: [],
    law: [],
    options: [],
    background: [],
    cut: options.truncated === true,
    deadlines: deadlineFlags(answer),
    checkedOn: (options.at && isoDay(options.at)) || null,
  };
  // The Law group exists only when the server sent a law list (the library is on for this answer).
  const allowLaw = options.law !== undefined;
  const lawHeading = (text: string) => allowLaw && isLawHeading(text);
  let section: Section = 'body';
  for (const block of blocks) {
    if (block.kind === 'h' && (isBackgroundHeading(block.text) || lawHeading(block.text) || isOptionsHeading(block.text))) {
      section = lawHeading(block.text) ? 'law' : isOptionsHeading(block.text) ? 'options' : 'background';
      continue;
    }
    const parts = block.kind === 'ul' ? listParts(block.items, allowLaw) : block.kind === 'p' ? [paragraphPart(block, allowLaw)] : [block];
    // Background runs from its heading to the end, unless labelled claims follow it: those are the record.
    if (section === 'background' && !parts.some((part) => part.kind === 'claim')) {
      view.background.push(block);
      continue;
    }
    for (const part of parts) {
      section = sectionFor(part, section);
      const target = section === 'law' || section === 'options' ? section : 'body';
      view[target].push(eachInline(markSeparate(settleFact(guardPart(part, target), citations !== null)), dedupeChips));
    }
  }
  // Once the citations are in, a law cite in the text is checked only when a validated tag names the same law.
  if (citations === null) return view;
  const checked = new Set([...lawIndex(options.law).values()].map((entry) => citeBase(entry.cite)));
  const mark = (inline: readonly Inline[]) => markUnchecked(inline, checked);
  if (view.absent) view.absent = mark(view.absent);
  for (const key of ['body', 'law', 'options'] as const) view[key] = view[key].map((part) => eachInline(part, mark));
  view.background = view.background.map((block) => eachInline(block, mark) as Block);
  return view;
}

/** Plain text of an answer with its cites in room form, for "Copy with cites". */
export function answerText(view: AnswerView): string {
  const line = (inline: readonly Inline[]) => inline.map((t) => (t.kind === 'cite' || t.kind === 'law' ? `(${t.label})` : t.text)).join('').trim();
  const out: string[] = [];
  if (view.absent) out.push(`Not in the record. ${line(view.absent)}`.trim());
  if (view.deadlines.length) out.push(['Deadline.', ...view.deadlines.map(deadlineLine)].join(' '));
  for (const part of view.body) {
    if (part.kind === 'claim') out.push(`${claimLabel(part)}: ${line(part.inline)}`);
    else if (part.kind === 'p') out.push(line(part.inline));
    else if (part.kind === 'ul') out.push(...part.items.map((item) => `- ${line(item)}`));
    else out.push(part.text);
  }
  if (view.law.length) {
    out.push(`Law. ${LAW_NOTICE}`);
    for (const part of view.law) {
      if (part.kind === 'claim') out.push(`${claimLabel(part)}: ${line(part.inline)}`);
      else if (part.kind === 'p') out.push(line(part.inline));
      else if (part.kind === 'ul') out.push(...part.items.map((item) => `- ${line(item)}`));
      else out.push(part.text);
    }
  }
  if (view.options.length) {
    out.push(`Options and recommendation. ${RECOMMENDATION_STAMP} ${RECOMMENDATION_NOTE}`);
    for (const part of view.options) {
      if (part.kind === 'claim') out.push(`${claimLabel(part)}: ${line(part.inline)}`);
      else if (part.kind === 'p') out.push(line(part.inline));
      else if (part.kind === 'ul') out.push(...part.items.map((item) => `- ${line(item)}`));
      else out.push(part.text);
    }
  }
  if (view.background.length) {
    out.push('General background, not from the record.');
    for (const block of view.background) {
      if (block.kind === 'p') out.push(line(block.inline));
      else if (block.kind === 'ul') out.push(...block.items.map((item) => `- ${line(item)}`));
      else out.push(block.text);
    }
  }
  const sources = answerSources(view);
  const checks = [
    ...sources.record.map((cite) => `- ${cite.label}: ${sourceCheck(cite, view.checkedOn)}.`),
    ...sources.law.map((cite) => `- ${cite.label}: ${sourceCheck(cite, view.checkedOn)}.`),
    ...sources.unchecked.map((cite) => `- ${cite}: ${NOT_CHECKED}.`),
  ];
  if (checks.length) out.push(['Sources.', ...checks].join('\n'));
  // A pasted answer keeps the warning, so a cut answer is never mistaken for a whole one.
  if (view.cut) out.push(CUT_OFF);
  return out.filter(Boolean).join('\n\n');
}

/** One deadline flag as a line of text: "83(b) election: This can't be fixed later. It must ...". */
function deadlineLine(flag: DeadlineFlag): string {
  return `${flag.name ? `${flag.name}: ` : ''}${flag.title} ${flag.body}`;
}

/** A record page cited in an answer. */
export type RecordSource = Extract<Inline, { kind: 'cite' }>;
/** A law source cited in an answer. */
export type LawSource = Extract<Inline, { kind: 'law' }>;

/** How a source was checked (A1): a record page on the answer's day; law against the text its library read, on the day it read it. */
export function sourceCheck(source: RecordSource | LawSource, checkedOn: string | null): string {
  if (source.kind === 'cite') return checkedAgainst(`${source.name}, p. ${source.page}`, checkedOn);
  return checkedAgainst(source.source ?? 'the law library', source.retrieved ?? checkedOn);
}

/**
 * Every source in the answer, once each in order of first use: the record's pages, then the law, then the law citations
 * written as plain text that no validated tag names (not checked).
 */
export function answerSources(view: AnswerView): { record: RecordSource[]; law: LawSource[]; unchecked: string[] } {
  const inlines = (parts: readonly AnswerPart[]) =>
    parts.flatMap((part) => (part.kind === 'claim' || part.kind === 'p' ? part.inline : part.kind === 'ul' ? part.items.flat() : []));
  const all = [...inlines(view.absent ? [{ kind: 'p', inline: view.absent }] : []), ...inlines(view.body), ...inlines(view.law), ...inlines(view.options), ...inlines(view.background)];
  const seen = new Set<string>();
  const record: RecordSource[] = [];
  const law: LawSource[] = [];
  const unchecked: string[] = [];
  for (const token of all) {
    if (token.kind === 'note' && token.cite && !unchecked.includes(token.cite)) unchecked.push(token.cite);
    // Record pages by link; law by id, since many sections share one official document (a C.R.S. title PDF).
    const key = token.kind === 'law' ? `law:${token.id}` : token.kind === 'cite' ? token.href : null;
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    if (token.kind === 'cite') record.push(token);
    else if (token.kind === 'law') law.push(token);
  }
  return { record, law, unchecked };
}
