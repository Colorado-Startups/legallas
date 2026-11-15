// SPDX-License-Identifier: Apache-2.0
// The exhibit pane's DOM (card F7): the head (control number, privilege, Key, Open, Download, Close, title,
// meta line), the note under it, and one viewer per document kind. exhibit-pane.ts drives it. Every node is
// built with DOM calls and every piece of file content goes in as text, or through doc-views.ts.
import { docTitle } from './doc-titles.ts';
import { docTypeWords } from './doc-type.ts';
import { highlightText, showCsv, showMarkdown, showText } from './doc-views.ts';
import { docHref, downloadUrl, fileUrl, type DocMeta } from './files-api.ts';
import { formatBytes, pageLabel, partyLine, plural, typeLabel, whereItOpens } from './files-format.ts';
import { controlPrefix, formatControl, type ServedDocFacts } from './doc-facts.ts';
import type { PdfHandle } from './doc-pdf.ts';
import { loadPdfViewer, startPdf } from './doc-pdf-start.ts';
import { MARK_LABEL } from './mark-words.ts';

/** The page elements of the exhibit pane. */
export interface PaneParts {
  root: HTMLElement;
  /** "Back to question": shown only when the opener passed returnTo (R66). */
  back: HTMLButtonElement;
  control: HTMLElement;
  privileged: HTMLElement;
  key: HTMLButtonElement;
  open: HTMLAnchorElement;
  download: HTMLAnchorElement;
  close: HTMLButtonElement;
  title: HTMLElement;
  meta: HTMLElement;
  pages: HTMLElement;
  status: HTMLElement;
  note: HTMLElement;
  count: HTMLElement;
  body: HTMLElement;
}

/** What the pane knows about a document beyond /api/doc/:id: its matter facts and its parties' names. */
export interface DocContext {
  facts: ServedDocFacts;
  names: ReadonlyMap<string, string>;
}

/** What the exhibit pane was asked to show: a page and a quote, and whether the request is still current. */
export interface ViewRequest {
  page: number | null;
  quote: string | null;
  /** False once the pane has moved on to another document (or closed): late results are dropped. */
  live: () => boolean;
}

const SVG = 'http://www.w3.org/2000/svg';

/** Creates an element with an optional class name and text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function svg(className: string, draw: (add: (tag: string, attrs: Record<string, string>) => void) => void): SVGSVGElement {
  const root = document.createElementNS(SVG, 'svg');
  root.setAttribute('class', className);
  root.setAttribute('viewBox', '0 0 16 16');
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('focusable', 'false');
  draw((tag, attrs) => {
    const child = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attrs)) child.setAttribute(name, value);
    root.append(child);
  });
  return root;
}

/** The Key target badge: two rings and a center, in brass. */
const keyBadge = () =>
  svg('exhibit__badge', (add) => {
    add('circle', { cx: '8', cy: '8', r: '7', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' });
    add('circle', { cx: '8', cy: '8', r: '4', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' });
    add('circle', { cx: '8', cy: '8', r: '1.5', fill: 'currentColor' });
  });

const closeIcon = () =>
  svg('exhibit__badge', (add) => add('path', { d: 'M3.5 3.5l9 9m0-9l-9 9', stroke: 'currentColor', 'stroke-width': '1.5', fill: 'none' }));

function button(className: string, label: string): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  return node;
}

/** The pane, built once and kept in the page (hidden) between documents. */
export function buildPane(): PaneParts {
  const root = el('aside', 'c-pane exhibit');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-labelledby', 'exhibit-control exhibit-title');
  root.id = 'exhibit-pane';
  root.dataset.exhibitPane = '';
  root.hidden = true;

  const control = el('p', 'c-pane__control');
  control.id = 'exhibit-control';
  const privileged = el('span', 'c-chip c-chip--privileged', MARK_LABEL);
  const key = button('c-button', '');
  key.append(keyBadge(), 'Key');
  key.dataset.needs = 'flag';
  key.setAttribute('aria-pressed', 'false');
  const open = el('a', 'c-button', 'Open');
  const download = el('a', 'c-button', 'Download');
  const close = button('c-button c-button--quiet exhibit__close', '');
  close.append(closeIcon());
  close.setAttribute('aria-label', 'Close');
  close.setAttribute('aria-keyshortcuts', 'Escape');
  const back = button('c-button c-button--quiet exhibit__back', 'Back to question');
  back.hidden = true;
  const actions = el('div', 'c-pane__actions exhibit__actions');
  actions.append(key, open, download);
  const top = el('div', 'c-pane__row');
  top.append(control, privileged, back, actions, close);

  const title = el('h2', 't-h3 exhibit__title');
  title.id = 'exhibit-title';
  const meta = el('p', 'c-pane__meta exhibit__meta');
  const pages = el('span');
  const head = el('div', 'c-pane__head');
  head.append(top, title, meta);

  const status = el('p', 'exhibit__status');
  status.setAttribute('role', 'status');
  const note = el('span');
  const count = el('span', 'exhibit__count');
  status.append(note, count);
  const body = el('div', 'c-pane__body');
  root.append(head, status, body);
  return { root, back, control, privileged, key, open, download, close, title, meta, pages, status, note, count, body };
}

/** The note under the head; '' hides it. `count` is the match count, shown only after a find. */
export function setNote(ui: PaneParts, text: string, count: number | null = null): void {
  ui.note.textContent = text;
  ui.count.textContent = count === null ? '' : plural(count, 'match', 'matches');
  ui.status.hidden = !text;
}

/** The head while a document loads: nothing from the last one stays on screen. */
export function resetHead(ui: PaneParts): void {
  ui.control.textContent = '';
  ui.control.hidden = true;
  ui.privileged.hidden = true;
  ui.key.hidden = true;
  ui.title.textContent = 'Opening the document';
  ui.title.removeAttribute('title');
  ui.meta.replaceChildren();
  ui.body.replaceChildren();
  delete ui.root.dataset.docId;
}

/** Fills the exhibit pane's head for a document, including its control number. */
export function fillHead(ui: PaneParts, doc: DocMeta, context: DocContext | null, req: ViewRequest): void {
  const control = formatControl(controlPrefix(), doc.control_seq);
  ui.root.dataset.docId = doc.id;
  ui.control.textContent = control;
  ui.control.hidden = !control;
  ui.title.textContent = docTitle(doc.name);
  ui.title.title = doc.name;
  ui.key.hidden = false;
  ui.key.setAttribute('aria-pressed', String(Boolean(doc.key_at)));
  ui.open.href = docHref(doc.id, req.page, req.quote);
  ui.download.href = downloadUrl(doc.id);
  fillFacts(ui, doc, context, req);
}

/**
 * The privilege chip and the meta line: the matter's facts when it has them. The pane fills the head without them and
 * calls this again when /api/matter answers, so the viewer never waits on it. The page the viewer shows is kept.
 */
export function fillFacts(ui: PaneParts, doc: DocMeta, context: DocContext | null, req: ViewRequest): void {
  ui.privileged.hidden = !context?.facts.privileged;
  const facts = context?.facts;
  const name = (id: string) => context?.names.get(id) ?? '';
  const items: HTMLElement[] = [];
  if (facts?.date) items.push(el('span', 'exhibit__date', facts.date));
  items.push(el('span', '', facts?.type ? docTypeWords(facts.type) : typeLabel(doc.name)));
  const parties = facts ? partyLine(facts.from.map(name).filter(Boolean), facts.to.map(name).filter(Boolean)) : '';
  if (parties) items.push(el('span', '', parties));
  // Pages are a PDF's; a cite's page on any other kind of file is always 1.
  ui.pages.textContent = doc.viewer === 'pdf' ? (ui.pages.isConnected && ui.pages.textContent) || pageLabel(req.page, doc.pages) : '';
  if (ui.pages.textContent) items.push(ui.pages);
  if (facts && !facts.privileged) items.push(el('span', '', 'No privilege claimed'));
  ui.meta.replaceChildren(...items);
}

/** A viewer's frame in the pane body, with the data hooks doc-views.ts and doc-pdf.ts look for. */
function viewSection(ui: PaneParts, label: string): HTMLElement {
  const section = el('section', 'exhibit__view');
  section.setAttribute('aria-label', label);
  ui.body.replaceChildren(section);
  return section;
}

/** The note after a find. `cited` is the cite's page; `found` is the page of the highlighted match. */
function reportFind(ui: PaneParts, matches: number, cited: number | null, found: number | null): void {
  if (matches > 0 && cited && found && found !== cited) {
    setNote(ui, `Passage highlighted on page ${found}; the cite gives page ${cited}.`, matches);
  } else if (matches > 0) {
    setNote(ui, 'Passage highlighted from the cite.', matches);
  } else {
    setNote(ui, cited ? `The passage was not found; showing page ${cited}.` : 'The passage was not found in this document.', 0);
  }
}

async function pdfView(ui: PaneParts, doc: DocMeta, req: ViewRequest): Promise<PdfHandle | null | false> {
  const section = viewSection(ui, 'PDF');
  const frame = el('div', 'exhibit__frame');
  const scroll = el('div', 'exhibit__scroll');
  scroll.dataset.pdfContainer = '';
  scroll.tabIndex = 0;
  scroll.setAttribute('aria-label', 'PDF pages');
  const pages = el('div', 'pdfViewer');
  pages.dataset.pdfViewer = '';
  scroll.append(pages);
  frame.append(scroll);
  section.append(frame);
  if (req.quote) setNote(ui, 'Finding the passage.');

  const start = startPdf(doc.id, doc.size);
  const { openPdf } = await loadPdfViewer().catch((error: unknown) => {
    start.abort();
    throw error;
  });
  if (!req.live()) {
    start.abort();
    return false;
  }
  return openPdf(section, {
    id: doc.id,
    start,
    page: req.page,
    quote: req.quote,
    onPage: (page, total) => {
      ui.pages.textContent = pageLabel(page, total);
    },
    onFind: (matches, found) => {
      if (req.live()) reportFind(ui, matches, req.page, found);
    },
  });
}

async function textView(ui: PaneParts, doc: DocMeta, req: ViewRequest): Promise<boolean> {
  const section = viewSection(ui, 'Document');
  const sheet = el('div', 'exhibit__sheet');
  const cut = el('p', 'exhibit__note');
  cut.dataset.viewNote = '';
  cut.hidden = true;
  sheet.append(cut);
  section.append(sheet);
  let content: HTMLElement;
  if (doc.viewer === 'markdown') {
    content = el('div', 'prose markdown-body');
    content.dataset.md = '';
    sheet.append(content);
    await showMarkdown(section, doc);
  } else if (doc.viewer === 'csv') {
    const wide = el('div', 'exhibit__wide');
    content = el('table', 'exhibit__table');
    content.dataset.csv = '';
    const caption = el('caption', 'u-vh');
    caption.dataset.csvCaption = '';
    content.append(caption);
    wide.append(content);
    sheet.append(wide);
    await showCsv(section, doc);
  } else {
    content = el('pre', 'exhibit__text');
    content.dataset.text = '';
    content.tabIndex = 0;
    sheet.append(content);
    await showText(section, doc);
  }
  if (req.quote && req.live()) reportFind(ui, highlightText(content, req.quote) ? 1 : 0, null, null);
  return true;
}

function mediaView(ui: PaneParts, doc: DocMeta): Promise<boolean> {
  if (doc.viewer === 'visual') {
    // The binder's rule: an owner-mirrored visual runs only in a script-only sandbox, with no referrer.
    const frame = el('iframe', 'exhibit__visual');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.referrerPolicy = 'no-referrer';
    frame.title = doc.name;
    frame.src = fileUrl(doc.id);
    viewSection(ui, 'Visual').append(frame);
    return Promise.resolve(true);
  }
  const sheet = el('div', 'exhibit__sheet');
  viewSection(ui, 'Image').append(sheet);
  return new Promise((resolve) => {
    const img = el('img', 'exhibit__image');
    img.alt = doc.name;
    img.addEventListener('load', () => resolve(true), { once: true });
    img.addEventListener('error', () => resolve(false), { once: true });
    img.src = fileUrl(doc.id);
    sheet.append(img);
  });
}

/** The fallback for files the room cannot draw: say what it is, and offer the download. */
export function downloadView(ui: PaneParts, doc: DocMeta, failed: boolean): void {
  const sheet = el('div', 'exhibit__sheet');
  const text = failed
    ? 'This file cannot be shown here; the download still works.'
    : `${typeLabel(doc.name)}, ${formatBytes(doc.size)}; download it to open it in its own app.${whereItOpens(doc.name) ? ` ${whereItOpens(doc.name)}` : ''}`;
  sheet.append(el('p', 't-prose', text));
  viewSection(ui, 'Download').append(sheet);
}

/**
 * Draws `doc` in the pane body. Resolves the PDF handle (the caller destroys it later), true for the other
 * viewers, or false when the file could not be shown (the download fallback is already drawn).
 */
export async function renderView(ui: PaneParts, doc: DocMeta, req: ViewRequest): Promise<PdfHandle | boolean> {
  let shown: PdfHandle | boolean | null;
  try {
    if (doc.viewer === 'pdf') shown = await pdfView(ui, doc, req);
    else if (doc.viewer === 'markdown' || doc.viewer === 'csv' || doc.viewer === 'text') shown = await textView(ui, doc, req);
    else if (doc.viewer === 'image' || doc.viewer === 'visual') shown = await mediaView(ui, doc);
    else {
      downloadView(ui, doc, false);
      shown = true;
    }
  } catch {
    shown = null;
  }
  if (!req.live()) {
    if (typeof shown === 'object' && shown !== null) shown.destroy();
    return false;
  }
  if (shown === null || shown === false) {
    setNote(ui, '');
    downloadView(ui, doc, true);
    return false;
  }
  if (!req.quote) setNote(ui, '');
  return shown;
}
