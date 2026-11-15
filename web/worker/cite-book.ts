// SPDX-License-Identifier: Apache-2.0
// The cite book for one question: every document Ask may cite (retrieved passages and case-picture proof tags), a
// short per-request id for each, the pages whose text reached the prompt, and what kind of source each one is.
//
// Why short ids: glm-5.3-flash copied 36-character document ids wrong now and then (about 5 in 88 eval runs, each
// cite then dropped), while it copied short law tags perfectly. The prompt shows D1, D2, ... (prompt.ts), the model
// cites [doc:D3 p:4], and the server maps that back to the real id (restoreCites) before validation and before the
// browser sees it, so the browser's cite parser and links are unchanged. An alias names only a document in this
// book, so a mapped id can never point at a document that was not retrieved or tagged for this question.
//
// Why pages: a cite is valid only for a page whose text reached the prompt for that document (its [[doc:<id> p:<n>]]
// markers in the retrieved passages) or the exact page of a case-picture proof tag (citations.ts PageRule).
//
// Why the rest: a passage that calls itself counsel's work product (provenance.ts) marks its document `workProduct`,
// so no Fact rests on it; and a letter's or email's writer, by kind (speaker.ts), lets an attributed claim say whose
// statement it is. A record whose passage calls itself an official record (a Secretary of State's certificate, an
// agency's letter, a court's order: provenance.ts) is marked `official`, so it supports a Fact only where the room files
// official records (answer-shape.ts).
import type { PageRule, SourceChunk } from './citations.ts';
import type { CitableDoc } from './passages.ts';
import { selfDescribedOfficialRecord, selfDescribedWorkProduct } from './provenance.ts';
import { isCourtRecord, sourceKind, type SourceKind } from './source-kind.ts';
import { speakerOf, type Speaker, type SpeakerKind } from './speaker.ts';
import { withoutV2Header } from './v2-header.ts';

export interface BookEntry {
  doc: CitableDoc;
  /** The id the prompt shows and the model cites: D1, D2, ... in order of first appearance in the prompt. */
  alias: string;
  /** Pages whose text reached the prompt in a retrieved passage. */
  passagePages: Set<number>;
  /** Pages a case-picture proof tag names. */
  briefPages: Set<number>;
  kind: SourceKind;
  /** A passage of it calls itself counsel's work product (never for a court record): no Fact rests on it. */
  workProduct: boolean;
  /** A record whose passage calls itself an official record (provenance.ts selfDescribedOfficialRecord). */
  official: boolean;
  /** Who wrote a letter or an email, by kind, when its passages and the manifest settle it (speaker.ts). */
  speaker: SpeakerKind | null;
}

export interface CiteBook extends PageRule {
  /** By real document id, in alias order. */
  entries: Map<string, BookEntry>;
  /** Alias (upper case) to real document id. */
  ids: Map<string, string>;
  /** Every citable document, as validateCitations takes them. */
  citable: Map<string, CitableDoc>;
  /** True when the page's text reached the prompt in a retrieved passage (not only a proof tag). */
  fromPassage(id: string, page: number): boolean;
}

const MARKER = /\[\[doc:([A-Za-z0-9_-]{1,64}) p:([0-9]{1,6})\]\]/g;
const TAG = /\[doc:([A-Za-z0-9_-]{1,64}) p:([0-9]{1,6})\]/g;

/**
 * Pages of `docId` whose text is in this passage: every marker naming it, and the page before the first marker
 * when text precedes it (a v1 passage then starts inside the previous page). A text document (no page count) is one
 * page, so its page 1 is always in when any of its text is. The header line an index v2 part opens with names the
 * document, not page text, so it is dropped first (withoutV2Header): a v2 part reaches only its own marker's page.
 */
export function passagePages(chunk: SourceChunk, pages: number | null): number[] {
  const text = withoutV2Header(chunk.text);
  const out = new Set<number>();
  let first: { page: number; at: number } | null = null;
  for (const match of text.matchAll(MARKER)) {
    if (match[1] !== chunk.docId) continue;
    const page = Number(match[2]);
    first ??= { page, at: match.index };
    out.add(page);
  }
  if (first && first.page > 1 && text.slice(0, first.at).trim() !== '') out.add(first.page - 1);
  if (pages === null && text.trim() !== '') out.add(1);
  return [...out].filter((page) => page >= 1 && (pages === null || page <= pages));
}

/**
 * The book for one question. `retrieved` holds the live documents of the passages; `brief` is the case picture with
 * the live documents its proof tags name (ask-brief.ts); `speakers` are the writers the manifest knows (speaker.ts).
 * Aliases follow the prompt's order: case picture first.
 */
export function citeBook(
  chunks: readonly SourceChunk[],
  retrieved: ReadonlyMap<string, CitableDoc>,
  brief: { text: string; citable: ReadonlyMap<string, CitableDoc> } | null = null,
  speakers: readonly Speaker[] = [],
): CiteBook {
  const entries = new Map<string, BookEntry>();
  const ids = new Map<string, string>();
  const texts = new Map<string, string[]>();
  const add = (doc: CitableDoc): BookEntry => {
    const known = entries.get(doc.id);
    if (known) return known;
    const alias = `D${entries.size + 1}`;
    const entry: BookEntry = { doc, alias, passagePages: new Set(), briefPages: new Set(), kind: sourceKind(doc), workProduct: false, official: false, speaker: null };
    entries.set(doc.id, entry);
    ids.set(alias, doc.id);
    return entry;
  };
  if (brief) {
    for (const match of brief.text.matchAll(TAG)) {
      const doc = brief.citable.get(match[1]!); // safe: the pattern has the group
      if (doc) add(doc).briefPages.add(Number(match[2]));
    }
  }
  for (const chunk of chunks) {
    const doc = retrieved.get(chunk.docId);
    if (!doc) continue;
    const entry = add(doc);
    for (const page of passagePages(chunk, doc.pages)) entry.passagePages.add(page);
    const text = withoutV2Header(chunk.text);
    // The court's own record keeps its standing: an order may discuss work product without being any.
    if (!entry.workProduct && !isCourtRecord(doc) && selfDescribedWorkProduct(text)) entry.workProduct = true;
    if (!entry.official && entry.kind === 'record' && selfDescribedOfficialRecord(text)) entry.official = true;
    texts.set(doc.id, [...(texts.get(doc.id) ?? []), text]);
  }
  for (const entry of entries.values()) {
    if (entry.kind === 'letter' || entry.kind === 'email') entry.speaker = speakerOf({ name: entry.doc.name, kind: entry.kind }, texts.get(entry.doc.id) ?? [], speakers);
  }
  const citable = new Map([...entries].map(([id, entry]) => [id, entry.doc]));
  return {
    entries,
    ids,
    citable,
    allows: (id, page) => {
      const entry = entries.get(id);
      return entry !== undefined && (entry.passagePages.has(page) || entry.briefPages.has(page));
    },
    fromPassage: (id, page) => entries.get(id)?.passagePages.has(page) ?? false,
  };
}

/**
 * Prompt text with every [doc:<id> p:<n>] tag (markers already rewritten by markersToCites, or a case-picture proof
 * tag) shown with its alias. A tag for a document outside the book is removed: the model may not cite it.
 */
export function aliasTags(text: string, book: CiteBook): string {
  return text.replace(TAG, (_, id: string, page: string) => {
    const entry = book.entries.get(id);
    return entry ? `[doc:${entry.alias} p:${page}]` : '';
  });
}

// One cite inside a bracket as the model may write it: "doc:D3 p:4", "D3 p.4", "doc: D3, page 4", "doc:D3 pp. 4-5",
// "doc:D3 p:4, 6". A range cites its first page; a list cites each page.
const ITEM = /^\s*(?:doc\s*:\s*)?(D[1-9][0-9]{0,2})\s*[,;]?\s*(?:pp?|pages?)\s*[.:]?\s*([0-9]{1,6}(?:\s*(?:[-\u2013,]|and)\s*[0-9]{1,6}){0,8})\s*$/i;
const BRACKET = /[[【]([^[\]【】\n]{1,160})[\]】]/g;
const ITEM_SPLIT = /[;,](?=\s*(?:doc\s*:\s*)?D[1-9])/i;

export interface RestoreCount {
  /** Alias cites the book does not know (a garbled or invented id); left as written, so validation drops them. */
  unresolved: number;
}

/**
 * The model's alias cites rewritten to the canonical [doc:<real id> p:<n>] form the browser and validateCitations
 * read; several in one bracket become one tag each, and a page range cites its first page. Brackets that are not
 * alias cites (real ids, law tags, prose) are left exactly as written.
 */
export function restoreCites(text: string, book: CiteBook, count?: RestoreCount): string {
  return text.replace(BRACKET, (whole, inner: string) => {
    const items = inner.split(ITEM_SPLIT).map((part) => ITEM.exec(part));
    if (items.some((item) => item === null)) return whole;
    return items
      .flatMap((item) => {
        const alias = item![1]!.toUpperCase(); // safe: checked above; the pattern has the group
        const id = book.ids.get(alias);
        if (!id && count) count.unresolved++;
        // Ranges keep their first page; a list ("4, 6", "4 and 6") cites each.
        const pages = item![2]!.replace(/\s*[-\u2013]\s*[0-9]+/g, '').split(/\s*(?:,|and)\s*/).map(Number); // safe: as above
        return [...new Set(pages)].map((page) => `[doc:${id ?? alias} p:${page}]`);
      })
      .join(' ');
  });
}

// A cite id the model wrote outside a cite: in prose ("the draft (doc:D1) was not retrieved", "doc:D13 p:3") or
// inside a bracket that is not a cite ("[proof tag at doc:D15 p:33]"). restoreCites maps only bracketed cites, so the
// reader would see the per-request alias; restoreMentions renders each one instead. "doc:" must open a word, so a URL
// or a file name ("example.com/doc:D1", "my-doc:D1") is never touched, and a canonical tag ([doc:<id> p:<n>], mapped
// or an unknown alias left for validation to drop) is kept as written.
const MENTION_SRC = String.raw`(?<![\w./:@-])doc[ \t]*:[ \t]*(D[1-9][0-9]{0,2})(?![\w-]|\.\w)(?:[ \t]*[,;]?[ \t]*(?:pp?|pages?)[ \t]*[.:]?[ \t]*([0-9]{1,6})(?:[ \t]*[-\u2013][ \t]*[0-9]{1,6})?(?!\w))?`;
const MENTION = new RegExp(String.raw`([ \t]*[[【]doc:[A-Za-z0-9_-]{1,64} p:[0-9]{1,6}[\]】])|([ \t]*)([([]?)${MENTION_SRC}([)\]]?)`, 'gi');
/** What may yet open or continue a mention at the end of streamed text ("(", "d", "doc:", "doc:D1 p:3"), with its lead. */
const MENTION_TAIL = /[ \t]*[([]?(?:(?<![\w./:@-])d(?:o(?:c(?:[ \t]*(?::(?:[ \t]*(?:D(?:[1-9][0-9]{0,2}(?:[ \t]*[,;]?[ \t]*(?:p(?:p|a(?:g(?:e(?:s)?)?)?)?[ \t]*[.:]?[ \t]*(?:[0-9]{1,6}(?:[ \t]*[-\u2013][ \t]*[0-9]{0,6})?)?)?)?)?)?)?)?)?)?)?)?$/i;

/**
 * Text with every cite id written outside a cite rendered for the reader. With a page it becomes the canonical
 * [doc:<real id> p:<n>] tag (a range cites its first page), which the browser shows as the document's control number
 * and page once validated. Without a page it is no cite, and the model's aside may name the wrong document ("the repair
 * ticket itself (doc:D1)" with D1 another exhibit), so it is removed with the parentheses or bracket it
 * stood alone in; standing in the sentence itself, it becomes the document's name so the sentence still reads. An id
 * the book does not know is removed. Labels are decided before this runs (answer-shape.ts), so a mention never changes
 * one. While streaming, `text` may open with `sent` characters already sent, given only so a
 * mention's start is judged in context; nothing starting in them is changed.
 */
export function restoreMentions(text: string, book: CiteBook, sent = 0): string {
  return text.replace(MENTION, (whole, tag: string | undefined, lead: string, open: string, alias: string, page: string | undefined, close: string, at: number) => {
    if (tag || at < sent) return whole;
    const id = book.ids.get(alias.toUpperCase());
    const entry = id === undefined ? undefined : book.entries.get(id);
    const alone = (open === '(' && close === ')') || (open === '[' && close === ']');
    if (!entry || (!page && alone)) return alone || (!open && !close) ? '' : `${lead}${open}${close}`;
    const shown = page ? `[doc:${entry.doc.id} p:${Number(page)}]` : entry.doc.name.replace(/[[\]【】]/g, '').replace(/\s+/g, ' ').trim();
    return `${lead}${open}${shown}${close}`;
  });
}

/** Where text that may yet become a mention starts at the end of streamed `text` (it waits for the next delta). */
export function mentionTail(text: string): number {
  return MENTION_TAIL.exec(text)?.index ?? text.length; // the pattern matches the empty end at least
}
