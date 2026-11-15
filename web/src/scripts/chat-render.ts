// SPDX-License-Identifier: Apache-2.0
// Ask answers as DOM (card P7), shared by the Ask page and the drawer. Built with createElement and
// textContent only; the one link shape is the validated /doc/ cite from sanitize.ts.
//
// Cite chips read "DOE-000412 at 3". Each is an a[data-exhibit] link (R66): a plain click opens F7's exhibit
// pane beside the answer at the cited page with the pinpoint quote highlighted, and a second click closes it;
// a modified click follows the href to /doc/. The quote rides in data-quote, never in a URL.
import {
  answerSources,
  answerText,
  answerView,
  claimLabel,
  CUT_OFF,
  LAW_NOTICE,
  sourceCheck,
  type AnswerPart,
  type AnswerView,
  type LawSource,
  type RecordSource,
} from './chat-answer.ts';
import type { DeadlineFlag } from './answer-deadlines.ts';
import { isOfficialLink } from '../../worker/law-cite.ts';
import { NOT_CHECKED, RECOMMENDATION_NOTE, RECOMMENDATION_STAMP } from '../../worker/product-notices.ts';
import type { Turn } from './chat-store.ts';
import { controlPrefix } from './matter-api.ts';
import { initExhibitLinks, openExhibit, type ExhibitReturn } from './exhibit-pane.ts';
import { loadPdfViewer } from './doc-pdf-start.ts';
import type { Block, Inline } from './sanitize.ts';
import '../styles/chat-answer.css';

/** A record citation inside an answer. */
export type Cite = Extract<Inline, { kind: 'cite' }>;

const ABSENT_DEFAULT = 'The documents in this room do not answer this.';
const citeOf = new WeakMap<Element, Cite>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Opens a cited page in the exhibit pane (R40's helper, now F7's pane). `opener` regains focus on close;
 * `returnTo` gives the pane a way back to an overlay the cite came from (the drawer, R66).
 */
export function openCite(docId: string, page: number, quote: string | null, opener: HTMLElement | null, returnTo: ExhibitReturn | null = null): void {
  void openExhibit({ id: docId, page, quote, opener, returnTo });
}

/** The label shown for each track of a law source. */
export const TRACK_LABELS: Record<LawSource['track'], string> = {
  civil: 'Civil',
  regulator: 'Regulator filings only',
  both: 'Civil and regulator',
};

/** A law cite: the canonical citation, opening the official source in a new tab. Never a room link. */
function lawLink(token: LawSource, className = 'c-cite ask-law-cite'): Node {
  if (!isOfficialLink(token.href)) return document.createTextNode(token.label);
  const link = el('a', className, token.label);
  link.href = token.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = `${token.title}\n${TRACK_LABELS[token.track]}. Opens the official source.`;
  return link;
}

function inlineNodes(tokens: readonly Inline[]): Node[] {
  return tokens.map((token) => {
    if (token.kind === 'text') return document.createTextNode(token.text);
    if (token.kind === 'strong') return el('strong', '', token.text);
    if (token.kind === 'note') return el('span', 'ask-note', token.text);
    if (token.kind === 'law') {
      const wrap = document.createDocumentFragment();
      wrap.append(' ', lawLink(token));
      return wrap;
    }
    const link = el('a', 'c-cite', token.label);
    if (!token.href.startsWith('/doc/?id=')) return document.createTextNode(token.label);
    link.href = token.href;
    link.dataset.cite = '';
    link.dataset.exhibit = '';
    if (token.quote) link.dataset.quote = token.quote;
    link.title = token.quote ? `${token.name}\n“${token.quote}”` : token.name;
    citeOf.set(link, token);
    if (/\.pdf$/i.test(token.name)) link.dataset.pdf = '';
    // A space before the chip, so "order. DOE-000231 at 1" never runs together.
    const wrap = document.createDocumentFragment();
    wrap.append(' ', link);
    return wrap;
  });
}

function blockNode(block: Block): HTMLElement {
  if (block.kind === 'h') return el('h3', 'ask-answer__h', block.text);
  if (block.kind === 'ul') {
    const ul = el('ul', 'ask-answer__list');
    for (const item of block.items) {
      const li = el('li');
      li.append(...inlineNodes(item));
      ul.append(li);
    }
    return ul;
  }
  const p = el('p', 'ask-answer__p');
  p.append(...inlineNodes(block.inline));
  return p;
}

function partNode(part: AnswerPart): HTMLElement {
  if (part.kind !== 'claim') return blockNode(part);
  const p = el('p', 'c-claim ask-claim');
  p.dataset.kind = part.claim;
  const tag = el('span', 'c-claim__tag ask-claim__tag');
  const mark = el('span', 'ask-claim__mark', part.claim === 'inference' ? '∴' : part.claim === 'law' ? '§' : '');
  mark.setAttribute('aria-hidden', 'true');
  // A LAW claim resting only on a dissent or concurrence wears that writing's name, never "Law" (chat-answer.ts).
  if (part.separate) p.dataset.separate = part.separate;
  tag.append(mark, claimLabel(part), el('span', 'u-vh', ': '));
  const text = el('span', 'ask-claim__text');
  text.append(...inlineNodes(part.inline));
  p.append(tag, text);
  return p;
}

function absentNode(inline: readonly Inline[]): HTMLElement {
  const box = el('div', 'c-callout c-callout--absent ask-callout');
  box.setAttribute('role', 'note');
  const body = el('p', 'ask-callout__text');
  body.append(...(inline.length ? inlineNodes(inline) : [document.createTextNode(ABSENT_DEFAULT)]));
  box.append(el('p', 'ask-callout__title', 'Not in the record'), body);
  return box;
}

function backgroundNode(blocks: readonly Block[]): HTMLElement {
  const box = el('aside', 'c-callout c-callout--background ask-callout');
  box.setAttribute('aria-label', 'General background, not from the record');
  const lead = el('p', 'ask-callout__lead');
  lead.append(el('strong', '', 'General background, not from the record.'));
  box.append(lead, ...blocks.map(blockNode));
  return box;
}

/** The deadlines the answer names (A6), flagged above it. */
function deadlineNode(flags: readonly DeadlineFlag[]): HTMLElement {
  const box = el('div', 'c-callout ask-callout ask-deadline');
  box.setAttribute('role', 'note');
  box.setAttribute('aria-label', 'Deadline');
  const lead = el('p', 'ask-callout__lead');
  lead.append(el('strong', '', 'Deadline'));
  box.append(
    lead,
    ...flags.map((flag) => {
      const p = el('p', 'ask-callout__text');
      if (flag.name) p.append(el('span', 'ask-deadline__name', `${flag.name}:`), ' ');
      p.append(el('strong', '', flag.title), ' ', flag.body);
      return p;
    }),
  );
  return box;
}

/** The options and the recommendation, under the A4 stamp, with their record and law cites kept. */
function optionsNode(parts: readonly AnswerPart[]): HTMLElement {
  const box = el('section', 'c-callout ask-callout ask-options');
  box.setAttribute('aria-label', 'Options and recommendation');
  const lead = el('p', 'ask-callout__lead');
  lead.append(el('strong', '', 'Options and recommendation'), ' ', el('span', 'ask-options__stamp', RECOMMENDATION_STAMP));
  box.append(lead, el('p', 'ask-options__note t-small', RECOMMENDATION_NOTE), ...parts.map(partNode));
  return box;
}

/** The Law group: statements of law from the law library, with the notice beside them. */
function lawNode(parts: readonly AnswerPart[]): HTMLElement {
  const box = el('section', 'c-callout ask-callout ask-law');
  box.setAttribute('aria-label', 'Law, from the law library');
  const lead = el('p', 'ask-callout__lead ask-law__lead');
  lead.append(el('strong', '', 'Law'), ' ', el('span', 'ask-law__notice', LAW_NOTICE));
  box.append(lead, ...parts.map(partNode));
  return box;
}

/** "Checked against [source] on [date]" under a source (A1). */
function checkNode(text: string): HTMLElement {
  return el('span', 'ask-sources__check t-small', text);
}

function recordItem(cite: RecordSource, checkedOn: string | null): HTMLElement {
  const li = el('li', 'ask-sources__item');
  li.append(...inlineNodes([cite]), ' ', checkNode(sourceCheck(cite, checkedOn)));
  return li;
}

function lawItem(cite: LawSource, checkedOn: string | null): HTMLElement {
  const li = el('li', 'ask-sources__item');
  li.append(lawLink(cite, 'c-cite ask-law-cite'), ' ', el('span', 'ask-sources__name', cite.title));
  if (cite.track !== 'civil') li.append(' ', el('span', 'ask-sources__track t-small', TRACK_LABELS[cite.track]));
  li.append(' ', checkNode(sourceCheck(cite, checkedOn)));
  return li;
}

/** A law citation written as plain text that no validated tag names. */
function uncheckedItem(cite: string): HTMLElement {
  const li = el('li', 'ask-sources__item');
  li.append(el('span', 'ask-sources__name', cite), ' ', checkNode(NOT_CHECKED));
  return li;
}

/** Every source the answer used, each marked checked or not checked (A4), in three labeled groups: Record, Law and Not checked. */
export function sourcesNode(view: AnswerView): HTMLElement | null {
  const { record, law, unchecked } = answerSources(view);
  if (record.length + law.length + unchecked.length === 0) return null;
  const box = el('div', 'ask-sources');
  const group = (title: string, items: HTMLElement[]) => {
    if (items.length === 0) return;
    const ul = el('ul', 'ask-sources__list');
    ul.append(...items);
    box.append(el('h3', 'ask-sources__h t-small', title), ul);
  };
  group('Record', record.map((cite) => recordItem(cite, view.checkedOn)));
  group('Law', law.map((cite) => lawItem(cite, view.checkedOn)));
  group('Not checked', unchecked.map(uncheckedItem));
  return box;
}

/** The note that closes an answer the model stopped at max_tokens. */
function cutNode(): HTMLElement {
  const note = el('p', 'ask-cut t-small', CUT_OFF);
  note.setAttribute('role', 'note');
  return note;
}

/**
 * The answer's nodes in reading order: "Not in the record", the deadline flag, the body, the Law group, the options, the
 * background box, then the sources, each marked checked or not checked, and last the cut-off note when the model stopped
 * at max_tokens.
 */
export function answerNodes(view: AnswerView): HTMLElement[] {
  const sources = sourcesNode(view);
  return [
    ...(view.absent ? [absentNode(view.absent)] : []),
    ...(view.deadlines.length ? [deadlineNode(view.deadlines)] : []),
    ...view.body.map(partNode),
    ...(view.law.length ? [lawNode(view.law)] : []),
    ...(view.options.length ? [optionsNode(view.options)] : []),
    ...(view.background.length ? [backgroundNode(view.background)] : []),
    ...(sources ? [sources] : []),
    ...(view.cut ? [cutNode()] : []),
  ];
}

/** The DOM parts of one rendered chat turn. */
export interface TurnView {
  root: HTMLLIElement;
  answer: HTMLDivElement;
  foot: HTMLDivElement;
}

/** An empty turn: the question as asked, then room for the answer. */
export function turnView(question: string): TurnView {
  const root = el('li', 'ask-turn');
  const answer = el('div', 'ask-turn__a');
  answer.setAttribute('aria-live', 'off');
  const foot = el('div', 'ask-turn__foot');
  foot.hidden = true;
  root.append(el('p', 'ask-turn__q', question), answer, foot);
  return { root, answer, foot };
}

function footNodes(view: AnswerView, turn: Turn): Node[] {
  const copy = el('button', 'c-button ask-copy', 'Copy with cites');
  copy.type = 'button';
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(answerText(view)).then(
      () => (copy.textContent = 'Copied'),
      () => (copy.textContent = 'Copy failed'),
    );
  });
  const docs = new Set(turn.citations.map((cite) => cite.id)).size;
  const count = el('span', 'ask-turn__count t-small', docs === 1 ? '1 document cited' : `${docs} documents cited`);
  return docs ? [copy, count] : [copy];
}

/** Draws `turn` into `view`. While streaming (`final` false) cites show as pending notes. */
export function paintTurn(view: TurnView, turn: Turn, final: boolean): void {
  const answer = answerView(turn.answer, final ? turn.citations : null, {
    dontKnow: final && turn.dontKnow,
    truncated: final && turn.truncated === true,
    prefix: controlPrefix(),
    law: turn.law,
    at: turn.at,
  });
  view.answer.replaceChildren(...answerNodes(answer));
  view.root.dataset.state = turn.failed ? 'failed' : final ? 'done' : 'streaming';
  view.foot.hidden = !final || turn.failed || !turn.answer;
  view.foot.replaceChildren(...(view.foot.hidden ? [] : footNodes(answer, turn)));
}

/** Callbacks wired to the citations of a rendered answer. */
export interface CiteWiring {
  /** Hears which cite has focus or hover (null when none), for the companion's citing state. */
  onFocus?: (cite: Cite | null) => void;
  /**
   * Takes plain cite clicks instead of the page-wide exhibit link handler, for the drawer (R66): it closes
   * itself, then opens the pane, so the two never stack.
   */
  onOpen?: (cite: Cite) => void;
}

/**
 * Starts the PDF viewer's code and worker when `root` cites a PDF, so a click on the cite waits only for the file. For
 * the newest answer only: a page of saved answers would otherwise load the viewer however few cites are opened.
 */
export function warmPdfCites(root: ParentNode): void {
  if (root.querySelector('a[data-cite][data-pdf]')) void loadPdfViewer().catch(() => undefined);
}

/** Wires the cites inside `root`: the exhibit pane on click, the PDF viewer on hover or focus, and focus reports for the companion. */
export function wireCites(root: HTMLElement, wiring: CiteWiring = {}): void {
  initExhibitLinks();
  const citeAt = (target: EventTarget | null) => (target instanceof Element ? target.closest('a[data-cite]') : null);
  const warm = (event: Event) => {
    if (citeAt(event.target)?.hasAttribute('data-pdf')) void loadPdfViewer().catch(() => undefined);
  };
  root.addEventListener('focusin', warm);
  root.addEventListener('pointerover', warm);
  const { onFocus, onOpen } = wiring;
  if (onOpen) {
    root.addEventListener('click', (event) => {
      const link = citeAt(event.target);
      const cite = link && citeOf.get(link);
      if (!cite || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onOpen(cite);
    });
  }
  if (!onFocus) return;
  const enter = (event: Event) => {
    const link = citeAt(event.target);
    if (link) onFocus(citeOf.get(link) ?? null);
  };
  const leave = (event: Event) => {
    if (citeAt(event.target)) onFocus(null);
  };
  root.addEventListener('focusin', enter);
  root.addEventListener('mouseover', enter);
  root.addEventListener('focusout', leave);
  root.addEventListener('mouseout', leave);
}
