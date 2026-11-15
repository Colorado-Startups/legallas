// SPDX-License-Identifier: Apache-2.0
// What the reader sees of an answer, decided on the server as the model streams it (and so exactly what the eval
// scores): the model's short cite ids mapped back to real document ids (cite-book.ts), and each claim's label held
// to the record rather than taken on the model's word.
//
// Labels (the browser shows CONFIRMED as Fact, READ as Read; chat-answer.ts):
// - A CONFIRMED claim stays a Fact only with at least one valid cite to a page whose text reached the prompt, in a
//   document of kind `record` (source-kind.ts) that is neither counsel's working draft (a drafts folder) nor a page
//   calling itself counsel's work product (cite-book.ts `workProduct`). Otherwise it becomes READ: a case-picture
//   proof tag alone, the room's own summaries and work product, working drafts, or a dropped cite never make a Fact.
// - A claim that a court or judge ruled (provenance.ts claimsRuling) needs more: a cite to a court record that
//   carries a ruling (an order, judgment, register of actions, docket or transcript; source-kind.ts isRulingRecord).
//   Without one it is READ and, unless it already says where it comes from, opens "A document in the room states
//   that": a forged order among the passages is never shown as the court's ruling.
// - A claim citing a record whose passage calls itself an official record (a Secretary of State's certificate or
//   filing receipt, a filed stamp, an agency's letterhead, a court's order: provenance.ts selfDescribedOfficialRecord)
//   is a Fact only when that record is filed where official records live (source-kind.ts isOfficialHome). Otherwise
//   it is READ, whatever else it cites, and opens "A document in the room states that": a forged certificate among
//   the passages is never shown as the office's record.
// - A characterization in the answer's own voice ("shows bad faith", "proves", "is a breach") is never a Fact.
// - A claim whose only valid support is a party's filing, a letter, an email or a press item is attributed: READ,
//   opening "According to <a party's filing | a letter | an email | a press report>," (a draft as "a draft complaint"
//   or "a draft filing", never a party's filing: source-kind.ts isDraft) unless the claim already names
//   its source ("the motion argues", "Doe's June 15 email was addressed to", "Per the case picture"). A letter or
//   email names its writer by kind when the manifest settles it ("a letter from the other side's counsel";
//   speaker.ts), and one that a claim calls a pleading ("The complaint alleges that ...") is re-attributed to its
//   writer: a party's letter states its position, it does not allege. A claim about what a letter or email itself
//   says, in those words, may stay a Fact (`attributedCommunications`): the email is the record of what was written.
// INFERENCE and LAW lines, and unlabelled text, are only mapped, never relabelled.
//
// A cite id written outside a cite ("the draft (doc:D1) was not retrieved") is rendered after the label is decided:
// with a page as the canonical tag, without one removed (or the document's name where it stands in the sentence),
// and an unknown id removed (cite-book.ts restoreMentions). Prose never shows a per-request alias.
//
// Streaming: a line that starts with CONFIRMED or READ is held until it ends, because its cites come last; other
// text streams at once, holding back only an unfinished [bracket] so a cite is never split, and the start of what
// may yet be a "doc:D1 p:3" mention.
import { citedRefs } from './citations.ts';
import { mentionTail, restoreCites, restoreMentions, type BookEntry, type CiteBook, type RestoreCount } from './cite-book.ts';
import { claimsRuling, isEvaluative, namesSource, PLEADING_OPENER } from './provenance.ts';
import { attributionNoun, draftNoun, isDraft, isOfficialHome, isPosition, isRulingRecord, isWorkingDraft, type SourceKind } from './source-kind.ts';
import { speakerPhrase } from './speaker.ts';
import type { StopReason } from './ask-stream.ts';

export interface LabelPolicy {
  /** A Fact about what an email or letter says, in an attributing sentence, may rest on the email or letter. */
  attributedCommunications: boolean;
}

export const LABEL_POLICY: LabelPolicy = { attributedCommunications: true };

export interface ShapeStats extends RestoreCount {
  /** CONFIRMED claims shown as READ. */
  relabelled: number;
  /** Claims given an "According to ..." or "A document in the room states that" opening. */
  attributed: number;
  /** CONFIRMED claims of a court ruling shown as READ for want of a court record. */
  rulings: number;
  /** CONFIRMED claims shown as READ because they characterize rather than state. */
  evaluative: number;
  /** CONFIRMED claims shown as READ because they cite a self-described official record filed outside official records. */
  official: number;
}

const LABEL_LINE = /^(\s*(?:(?:[-*•]|\d{1,2}[.)])\s+)?(?:\*\*)?\s*)(CONFIRMED|READ)(\s*(?:\*\*)?\s*[:.-]\s*(?:\*\*)?\s*)/;
const LINE_HEAD = /^\s*(?:(?:[-*•]|\d{1,2}[.)])\s*)?(?:\*{1,2})?\s*/;
/** Words that say who says it: an attributed claim needs no "According to" opening. */
const ATTRIBUTED =
  /\b(?:alleg\w*|claims?|claimed|asserts?|asserted|argues?|argued|contends?|contended|accus\w+|characteri[sz]\w+|describes?|described|says|said|states that|stated|writes|wrote|written|told|tells|repl(?:y|ies|ied)|respond(?:s|ed)|represent(?:s|ed)|denie[sd]|admit(?:s|ted)|acknowledg\w+|maintain(?:s|ed)|insist(?:s|ed)|report(?:s|ed)|according to|demand(?:s|ed)|request(?:s|ed)|asks|asked|notif(?:y|ies|ied)|inform(?:s|ed)|announc\w+|pleads?|pleaded|pled|seeks|sought|propos(?:es|ed)|calls?|called|labels?|labell?ed|threaten\w*|confirm(?:s|ed)|explain(?:s|ed))\b/i;
/** Sentence openers lower-cased after "According to ..., " (a name keeps its capital). */
const OPENERS = new Set([
  'The', 'A', 'An', 'This', 'That', 'These', 'Those', 'It', 'Its', 'In', 'On', 'At', 'By', 'For', 'From', 'Each', 'Both', 'All', 'No',
  'There', 'Under', 'After', 'Before', 'During', 'As', 'Since', 'When', 'Nothing', 'None', 'Neither', 'Only', 'Some', 'Several',
  'Any', 'Every', 'One', 'Two', 'Three', 'Most', 'Many', 'Once', 'While', 'Although', 'Because', 'If', 'Whether', 'Here', 'Then',
  'Earlier', 'Later', 'Previously', 'Separately', 'Also', 'Page', 'Counsel', 'Consistent', 'Per', 'According',
]);

function lowerOpener(text: string): string {
  const word = /^[A-Za-z]+/.exec(text)?.[0] ?? '';
  return OPENERS.has(word) ? text[0]!.toLowerCase() + text.slice(1) : text; // safe: word is non-empty when in OPENERS
}

const communication = (kind: SourceKind) => kind === 'email' || kind === 'letter';
/** A record that calls itself an official one, filed where official records do not live: it never holds a Fact. */
const unfiledOfficial = (entry: BookEntry) => entry.official && !isOfficialHome(entry.doc);
/** A ruling's framing drops the model's own verdict ("Yes, the court found ..."): the document says it, not Ask. */
const VERDICT = /^(?:yes|no)\s*[,.;:\u2014\u2013-]+\s*/i;
/** A claim that already presents its source as a document in the room, not as the court's own paper. */
const DOCUMENT_SAYS = /^(?:according to (?:a|one|the) (?:document|file|note|passage)|(?:a|one|the) (?:document|file|note|passage) in the (?:room|record|files))\b/i;

/** Whether a valid cite holds a CONFIRMED claim as a Fact (see the header). */
function supportsFact(entry: BookEntry, passage: boolean, claim: { ruling: boolean; attributed: boolean }, policy: LabelPolicy): boolean {
  if (!passage || entry.workProduct || isWorkingDraft(entry.doc)) return false;
  if (claim.ruling) return entry.kind === 'record' && isRulingRecord(entry.doc);
  return entry.kind === 'record' || (policy.attributedCommunications && claim.attributed && communication(entry.kind));
}

/** The noun an attributed claim opens with: by kind, a draft as a draft ("a draft complaint"), and a letter's or email's writer. */
function sourceNoun(entries: readonly BookEntry[]): string {
  const speakers = new Set(entries.map((e) => e.speaker));
  const [speaker] = speakers;
  const draft = entries.every((e) => isDraft(e.doc)) && draftNoun(entries.map((e) => e.doc));
  return attributionNoun(entries.map((e) => e.kind), draft, speakers.size === 1 ? speakerPhrase(speaker) : null);
}

/** One finished line: cites mapped, and a CONFIRMED or READ claim's label checked against its cites. */
export function shapeLine(line: string, book: CiteBook, stats: ShapeStats, policy: LabelPolicy = LABEL_POLICY): string {
  const restored = restoreCites(line, book, stats);
  const match = LABEL_LINE.exec(restored);
  if (!match) return restored;
  const [head, , label, tail] = match as unknown as [string, string, 'CONFIRMED' | 'READ', string];
  const claim = restored.slice(head.length);
  const cites = citedRefs(claim).filter((ref) => book.allows(ref.id, ref.page));
  const entries = cites.map((ref) => book.entries.get(ref.id)!); // safe: allows() found the entry
  const words = claim.replace(/[[【][^\]】]*[\]】]/g, ' ');
  const attributed = ATTRIBUTED.test(words);
  const ruling = claimsRuling(words);
  const official = entries.some(unfiledOfficial);
  const fact = !official && cites.some((ref, i) => supportsFact(entries[i]!, book.fromPassage(ref.id, ref.page), { ruling, attributed }, policy)); // safe: same length
  const evaluative = label === 'CONFIRMED' && fact && isEvaluative(words);
  let next: string = label;
  if (label === 'CONFIRMED' && (!fact || evaluative)) {
    next = 'READ';
    stats.relabelled++;
    if (ruling && !fact) stats.rulings++;
    if (evaluative) stats.evaluative++;
    if (official) stats.official++;
  }
  const text = next === 'READ' ? attribute(claim, entries, { attributed, ruling, official, words }) : null;
  if (text !== null) stats.attributed++;
  return `${match[1]}${next}${tail}${text ?? claim}`;
}

/** A READ claim with the opening that says whose statement it is, or null when it needs none (see the header). */
function attribute(claim: string, cited: readonly BookEntry[], said: { attributed: boolean; ruling: boolean; official: boolean; words: string }): string | null {
  if (cited.length === 0) return null;
  const body = claim.trimStart();
  // A party's letter or email that the claim calls a pleading is that writer's statement.
  const pleading = cited.every((e) => communication(e.kind)) ? PLEADING_OPENER.exec(body) : null;
  if (pleading) return `According to ${sourceNoun(cited)}, ${lowerOpener(body.slice(pleading[0].length))}`;
  // A self-described official record filed outside official records is a document's statement, even when the claim
  // names it ("According to the Secretary of State's certificate" is how a forged one presents itself).
  if (said.official) return DOCUMENT_SAYS.test(body) ? null : `A document in the room states that ${lowerOpener(body.replace(VERDICT, ''))}`;
  const positions = cited.every((e) => isPosition(e.kind));
  // A ruling with no court record behind it is framed even when the claim attributes it ("the minute order states",
  // "stated on the record" is how a forged order presents itself). Only a claim that already gives a document of the
  // room as its source ("The repair file states", "A document in the room says") is left alone.
  if (said.ruling && !positions && !cited.some((e) => e.kind === 'record' && isRulingRecord(e.doc))) {
    return DOCUMENT_SAYS.test(body) || namesSource(said.words) ? null : `A document in the room states that ${lowerOpener(body.replace(VERDICT, ''))}`;
  }
  if (said.attributed || namesSource(said.words)) return null;
  return positions ? `According to ${sourceNoun(cited)}, ${lowerOpener(body)}` : null;
}

/** Index of an unfinished [ or 【 at the end of `text` (no closer after it, at most 160 characters back), or -1. */
function openBracket(text: string): number {
  const open = Math.max(text.lastIndexOf('['), text.lastIndexOf('【'));
  if (open === -1) return -1;
  const close = Math.max(text.lastIndexOf(']'), text.lastIndexOf('】'));
  return close > open || text.length - open > 160 ? -1 : open;
}

/** Whether a line's start makes it a labelled claim to hold (`hold`), plain text (`stream`), or not yet known (null). */
function lineMode(start: string): 'hold' | 'stream' | null {
  if (LABEL_LINE.test(start) || /^\s*(?:(?:[-*•]|\d{1,2}[.)])\s+)?(?:\*\*)?\s*(?:CONFIRMED|READ)\b/.test(start)) return 'hold';
  const rest = start.slice(LINE_HEAD.exec(start)![0].length); // safe: the pattern matches any string
  if (rest === '' || /^\s*\d{1,2}$/.test(start)) return null;
  return 'CONFIRMED'.startsWith(rest) || 'READ'.startsWith(rest) ? null : 'stream';
}

export interface Shaper {
  /** Text for the reader from one more model delta ('' while a line is held). */
  push(delta: string): string;
  /** Whatever is still held, at the end of the answer. */
  end(): string;
  stats: ShapeStats;
}

/** A streaming shaper for one answer (see the header). */
export function answerShaper(book: CiteBook, policy: LabelPolicy = LABEL_POLICY): Shaper {
  const stats: ShapeStats = { unresolved: 0, relabelled: 0, attributed: 0, rulings: 0, evaluative: 0, official: 0 };
  let buffer = '';
  let mode: 'hold' | 'stream' | null = null;
  // The last raw characters of this line already sent: a mention's start is judged with them in view.
  let before = '';
  const restore = (text: string): string => restoreMentions(before + restoreCites(text, book, stats), book, before.length).slice(before.length);
  const partial = (): string => {
    mode ??= lineMode(buffer);
    if (mode !== 'stream') return '';
    const open = openBracket(buffer);
    const unbracketed = open === -1 ? buffer : buffer.slice(0, open);
    const ready = unbracketed.slice(0, Math.max(0, mentionTail(before + unbracketed) - before.length));
    buffer = buffer.slice(ready.length);
    const out = restore(ready);
    before = (before + ready).slice(-16);
    return out;
  };
  return {
    stats,
    push(delta) {
      buffer += delta;
      let out = '';
      for (let nl = buffer.indexOf('\n'); nl !== -1; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        out += `${mode === 'stream' ? restore(line) : restoreMentions(shapeLine(line, book, stats, policy), book)}\n`;
        mode = null;
        before = '';
      }
      return out + partial();
    },
    end() {
      const rest = mode === 'stream' ? restore(buffer) : restoreMentions(shapeLine(buffer, book, stats, policy), book);
      buffer = '';
      mode = null;
      before = '';
      return rest;
    },
  };
}

/** A whole answer through the shaper, as the reader would see it once streamed. */
export function shapeAnswer(answer: string, book: CiteBook, policy: LabelPolicy = LABEL_POLICY): { text: string; stats: ShapeStats } {
  const shaper = answerShaper(book, policy);
  const text = shaper.push(answer) + shaper.end();
  return { text, stats: shaper.stats };
}

/** Model deltas through a shaper; returns the model's stop reason unchanged. */
export async function* shapeDeltas(deltas: AsyncIterable<string, StopReason | void>, shaper: Shaper): AsyncGenerator<string, StopReason> {
  const iterator = deltas[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done) {
        const rest = shaper.end();
        if (rest) yield rest;
        return typeof next.value === 'string' ? next.value : null;
      }
      const out = shaper.push(next.value);
      if (out) yield out;
    }
  } finally {
    await iterator.return?.();
  }
}
