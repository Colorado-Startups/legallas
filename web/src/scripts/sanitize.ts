// SPDX-License-Identifier: Apache-2.0
// The allowlist renderer for Legallas answers. Model output is untrusted (retrieved text can carry injected
// instructions), so it becomes plain data here: paragraphs, "- " bullets, one heading kind, **bold**, and
// citation links. Nothing else survives. No HTML, no images, no URL schemes from the answer: the links this
// file produces are /doc/?id=<id>#page=<n> for a record citation the server validated, and, for a law
// citation the server validated, that citation's official source page (https on LAW_LINK_HOSTS only).
// chat-render.ts turns the result into DOM with textContent and createElement, never innerHTML.
// No DOM types here: scripts/ask-eval-score.ts and the worker tests import this file too.

import { pageIsKnown } from '../../worker/page-known.ts';
import { isLawId, isOfficialLink, LAW_OPINIONS, type LawOpinion, type LawTrack } from '../../worker/law-cite.ts';

/** A law citation from the server's `citations` event (worker/law.ts LawCitation), re-checked here. */
export interface ValidLaw {
  id: string;
  cite: string;
  title: string;
  url: string;
  track: LawTrack;
  /** Opinion parts: which writing (chat-answer.ts labels a claim resting only on a dissent or concurrence). */
  opinion?: LawOpinion;
  /** Publisher and edition the library read the text from, and the YYYY-MM-DD it did (A1: "Checked against [source] on [date]"). */
  source?: string;
  retrieved?: string;
}

/** A citation that passed validation, with its document id, page and name. */
export interface ValidCitation {
  id: string;
  page: number;
  name: string;
  /** Control number from migration 0003; absent or null before the document is numbered. */
  control_seq?: number | null;
  /** The pinpoint passage on the cited page (R10), for the exhibit pane's highlight. */
  quote?: string | null;
}

/** One inline piece of an answer, such as text, bold text or a cite. */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'cite'; href: string; label: string; id: string; page: number; name: string; quote: string | null }
  /** A validated law citation: its canonical cite, linking to the official source. */
  | { kind: 'law'; href: string; label: string; text: string; id: string; title: string; track: LawTrack; opinion?: LawOpinion; source?: string; retrieved?: string }
  /** A citation not (or not yet) validated: shown as a muted note, never a link. `cite`: a law citation written as plain text (chat-answer.ts). */
  | { kind: 'note'; text: string; cite?: string };

/** One block of an answer: a paragraph, a list or a heading. */
export type Block = { kind: 'p'; inline: Inline[] } | { kind: 'ul'; items: Inline[][] } | { kind: 'h'; text: string };

const DOC_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** The shape of a document id, for links that carry one (the Ask page's ?doc=). */
export const DOC_ID_SHAPE = DOC_ID;
const MAX_PAGE = 100_000;
const MAX_NAME = 200;
const MAX_QUOTE = 200;
/** The note shown in place of a source that is still pending. */
export const PENDING_NOTE = '[source pending]';
// Product notices A4 ("not checked"); chat-answer-checks.test.ts holds it to product-notices.ts. No import here: this file's
// imports are a quality-speed input listed by hand (.github/scripts/changed-paths.sh).
/** The note shown when a cited source was removed and so was not checked. */
export const DROPPED_NOTE = '[not checked: source removed]';
/** The note shown in place of a link that was removed. */
export const LINK_REMOVED = '[link removed]';

/** The one link shape this renderer emits. Refuses anything that is not a clean id and page. */
export function docHref(id: string, page: number): string | null {
  if (!DOC_ID.test(id) || !Number.isInteger(page) || page < 1 || page > MAX_PAGE) return null;
  return `/doc/?id=${encodeURIComponent(id)}#page=${page}`;
}

/** Citations from the server event, re-checked here: the browser trusts shapes, not just the wire. */
export function citationIndex(citations: readonly unknown[] | null): Map<string, ValidCitation> | null {
  if (citations === null) return null;
  const index = new Map<string, ValidCitation>();
  for (const raw of citations) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, page, name, control_seq: seq, quote } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || typeof page !== 'number' || typeof name !== 'string') continue;
    if (!docHref(id, page)) continue;
    index.set(`${id}:${page}`, {
      id,
      page,
      name: name.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_NAME),
      control_seq: typeof seq === 'number' && Number.isInteger(seq) && seq > 0 && seq < 1_000_000 ? seq : null,
      quote: typeof quote === 'string' && quote.trim() ? quote.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_QUOTE) : null,
    });
  }
  return index;
}

const TRACKS = new Set(['civil', 'regulator', 'both']);
const MAX_CITE = 120;

/** Law citations from the server event: well-formed ids and an official https link, or they are left out. */
export function lawIndex(law: readonly unknown[] | null | undefined): Map<string, ValidLaw> {
  const index = new Map<string, ValidLaw>();
  for (const raw of law ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, cite, title, url, track, opinion, source, retrieved } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || !isLawId(id) || typeof cite !== 'string' || typeof title !== 'string') continue;
    if (typeof url !== 'string' || !isOfficialLink(url) || typeof track !== 'string' || !TRACKS.has(track)) continue;
    const clean = (text: string, max: number) => text.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
    const writing = LAW_OPINIONS.find((o) => o === opinion);
    index.set(id, {
      id,
      cite: clean(cite, MAX_CITE),
      title: clean(title, MAX_NAME),
      url,
      track: track as LawTrack,
      ...(writing ? { opinion: writing } : {}),
      ...(typeof source === 'string' && source.trim() ? { source: clean(source, MAX_NAME) } : {}),
      ...(typeof retrieved === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(retrieved) ? { retrieved } : {}),
    });
  }
  return index;
}

// The model's citation, in ASCII brackets or gpt-oss's native fullwidth ones (【doc:<id> p:<n>】).
const CITE = String.raw`[[【]doc:\s*([A-Za-z0-9_-]{1,64})\s+p(?:age)?[:.]?\s*([0-9]{1,6})[\]】]`;
const CITE_SHAPE = new RegExp(`^${CITE}$`);
// A law citation (worker/law-cite.ts ANSWER_LAW_CITE): [law:<id>] or 【law:<id>】.
const LAW_CITE = String.raw`[[【]law:\s*([a-z0-9~-]{3,96})\s*[\]】]`;
const INLINE = new RegExp(`${CITE}|\\*\\*([^*\\n]{1,500})\\*\\*|${LAW_CITE}`, 'g');
const LAW_HEADING = /^law \(from the law library\)$/i;
// A markdown link target: (url), allowing one level of nested parentheses as in javascript:alert(1).
const TARGET = String.raw`\((?:[^()\n]|\([^()\n]*\))*\)?`;
const BACKGROUND = /^general background \(not from the case files\)$/i;
const OPTIONS = /^options and recommendations?$/i;

/** True for the heading the prompt puts over statements of law (prompt.ts LAW_HEADING). */
export function isLawHeading(text: string): boolean {
  return LAW_HEADING.test(text.trim());
}

/** True for the heading the prompt puts over the options and the recommendation (prompt.ts OPTIONS_HEADING). */
export function isOptionsHeading(text: string): boolean {
  return OPTIONS.test(text.trim());
}

/** True for the heading the prompt puts over general legal knowledge (prompt.ts BACKGROUND_HEADING). */
export function isBackgroundHeading(text: string): boolean {
  return BACKGROUND.test(text.trim());
}

/**
 * Removes every construct that could load, link or run something, before any structure is read:
 * HTML tags and comments, markdown images, markdown links (their text is kept), autolinks, bare URLs
 * and dangerous schemes.
 */
export function stripUnsafe(text: string): string {
  // Until stable: removing a link or image can join its neighbours into a new tag, so one pass is not enough.
  let out = text;
  let previous: string;
  do {
    previous = out;
    // Ends: each pass only removes characters, or swaps an address for LINK_REMOVED, whose words never form one again.
    out = stripPass(out);
  } while (out !== previous);
  return out;
}

/** One pass of stripUnsafe: the tag loop, then images, links, reference definitions and addresses. */
function stripPass(text: string): string {
  // Tags and comments go until none is left: removing one can join its neighbours into a new one ("<<b>script>").
  let bare = text;
  let previous: string;
  do {
    previous = bare;
    bare = bare.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<\/?[A-Za-z!?][^<>]*>?/g, '');
  } while (bare !== previous);
  return (
    bare
      // Images: inline ![alt](url) and reference ![alt][ref]. The alt text goes too.
      .replace(new RegExp(String.raw`!\[[^\]\n]*\](?:${TARGET}|\[[^\]\n]*\])`, 'g'), '')
      // Links: keep the words, drop the target. A citation tag written as a link stays a citation tag.
      .replace(new RegExp(String.raw`\[([^\]\n]*)\]${TARGET}`, 'g'), (_, words: string) => (CITE_SHAPE.test(`[${words}]`) ? `[${words}]` : words))
      // Reference definitions: [1]: target
      .replace(/^\s*\[[^\]\n]+\]:\s*\S+.*$/gm, '')
      .replace(/\b(?:https?|ftp|file|javascript|vbscript|data|blob|mailto|tel):[^\s)\]]+/gi, LINK_REMOVED)
      .replace(/\bwww\.[^\s)\]]+/gi, LINK_REMOVED)
  );
}

/** Makes the label shown for a citation. */
export type CiteLabel = (cite: ValidCitation) => string;

/** The label without a control number: "<name>, p. 3", or the name alone when its page isn't known. The room passes its own (chat-answer.ts). */
export const nameLabel: CiteLabel = (cite) => (pageIsKnown(cite.name) ? `${cite.name}, p. ${cite.page}` : cite.name);

/**
 * A law tag as a token: a link for a validated citation, a note otherwise (pending while streaming). With the law
 * library off (`law` undefined) the tag is plain text, exactly as before the library existed.
 */
function lawToken(raw: string, id: string, law: Map<string, ValidLaw> | null | undefined): Inline {
  if (law === undefined) return { kind: 'text', text: raw };
  if (law === null) return { kind: 'note', text: PENDING_NOTE };
  const entry = law.get(id);
  if (!entry || !isOfficialLink(entry.url)) return { kind: 'note', text: DROPPED_NOTE };
  const { source, retrieved } = entry;
  return {
    kind: 'law',
    href: entry.url,
    label: entry.cite,
    text: entry.cite,
    id: entry.id,
    title: entry.title,
    track: entry.track,
    ...(entry.opinion ? { opinion: entry.opinion } : {}),
    ...(source ? { source } : {}),
    ...(retrieved ? { retrieved } : {}),
  };
}

function inlineTokens(line: string, cites: Map<string, ValidCitation> | null, label: CiteLabel, law?: Map<string, ValidLaw> | null): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const pushText = (text: string) => {
    if (text) out.push({ kind: 'text', text });
  };
  for (const match of line.matchAll(INLINE)) {
    pushText(line.slice(last, match.index));
    last = match.index + match[0].length;
    if (match[3] !== undefined) {
      out.push({ kind: 'strong', text: match[3] });
      continue;
    }
    if (match[4] !== undefined) {
      out.push(lawToken(match[0], match[4], law));
      continue;
    }
    const id = match[1]!;
    const page = Number(match[2]);
    if (cites === null) {
      out.push({ kind: 'note', text: PENDING_NOTE });
      continue;
    }
    const cite = cites.get(`${id}:${page}`);
    const href = cite ? docHref(cite.id, cite.page) : null;
    if (cite && href) {
      out.push({ kind: 'cite', href, label: label(cite) || nameLabel(cite), id: cite.id, page: cite.page, name: cite.name, quote: cite.quote ?? null });
    }
    else out.push({ kind: 'note', text: DROPPED_NOTE });
  }
  pushText(line.slice(last));
  return out;
}

/**
 * The answer as safe blocks. `citations` is the server's validated list, or null while the answer is
 * still streaming (every citation is then a pending note). `label` names a validated cite on screen.
 */
export function renderAnswer(answer: string, citations: readonly unknown[] | null, label: CiteLabel = nameLabel, lawCitations?: readonly unknown[]): Block[] {
  const cites = citationIndex(citations);
  // The law library is on for this answer only when the server sent a law list (absent while it is off, and on
  // turns saved before it). Then law tags are pending while streaming and link only when validated.
  const lawOn = lawCitations !== undefined;
  const law = !lawOn ? undefined : citations === null ? null : lawIndex(lawCitations);
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Inline[][] | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'p', inline: inlineTokens(paragraph.join('\n'), cites, label, law) });
    paragraph = [];
    if (list) blocks.push({ kind: 'ul', items: list });
    list = null;
  };
  for (const rawLine of stripUnsafe(answer).split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const bare = line.replace(/^#{1,6}\s+/, '').replace(/^\*\*(.*)\*\*:?$/, '$1').replace(/:$/, '').trim();
    if (!line.trim()) {
      flush();
    } else if (BACKGROUND.test(bare) || OPTIONS.test(bare) || (lawOn && LAW_HEADING.test(bare)) || /^#{1,6}\s+\S/.test(line)) {
      flush();
      blocks.push({ kind: 'h', text: bare });
    } else if (/^\s*(?:[-*•]|\d{1,2}[.)])\s+/.test(line)) {
      if (paragraph.length) {
        blocks.push({ kind: 'p', inline: inlineTokens(paragraph.join('\n'), cites, label, law) });
        paragraph = [];
      }
      list ??= [];
      list.push(inlineTokens(line.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, ''), cites, label, law));
    } else {
      if (list) {
        blocks.push({ kind: 'ul', items: list });
        list = null;
      }
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

/** Every href in a rendering, for tests and for a last check before links reach the DOM. */
export function hrefsOf(blocks: readonly Block[]): string[] {
  const inlines = blocks.flatMap((block) => (block.kind === 'p' ? block.inline : block.kind === 'ul' ? block.items.flat() : []));
  return inlines.flatMap((token) => (token.kind === 'cite' || token.kind === 'law' ? [token.href] : []));
}
