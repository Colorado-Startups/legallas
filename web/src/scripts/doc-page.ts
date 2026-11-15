// SPDX-License-Identifier: Apache-2.0
// /doc/?id=<id>: one document as an exhibit (card P6). /api/doc/:id returns its metadata (and writes the one
// `view` audit row); doc-early.ts asked for it from <head>, and this reads the same answer (doc-open.ts). The viewer
// for its kind then reads the bytes from /files/:id. /api/matter (date, type, from and to, privilege, "cited in")
// enriches the header at once. The discussion and /api/documents (the breadcrumb's data-room index, Previous and Next
// in the folder, control numbers for cites in comments) wait until the page is drawn, so on a slow link they don't
// share it with the PDF. #page=N deep links open a PDF page.
import { citedIn, controlIndex, crumbsFor, findFolder, fromTo, namesFor, placeIn } from './doc-nav.ts';
import { docTitle } from './doc-titles.ts';
import { docTypeWords } from './doc-type.ts';
import { highlightText, showCsv, showImage, showMarkdown, showText, showVisual } from './doc-views.ts';
import {
  docHref, downloadUrl, fileUrl, folderHref, getJson, pageFromHash, quoteFromHash, setKey,
  type DocMeta, type FolderNode, type KeyState, type ListedDocument, type Viewer,
} from './files-api.ts';
import { formatBytes, formatDate, plural, typeLabel, whereItOpens } from './files-format.ts';
import { controlPrefix, pageMatter, formatControl, formatPartialDate, type ServedDocFacts, type ServedMatter } from './doc-facts.ts';
import { loadPdfViewer, startPdf } from './doc-pdf-start.ts';
import { docIdIn, docMeta } from './doc-open.ts';
import { pageTitle } from './room-names.ts';
import { MARK_LABEL, UNMARKED_LABEL } from './mark-words.ts';

type ExhibitDoc = DocMeta;

const root = document.querySelector<HTMLElement>('[data-doc]');

function part<T extends HTMLElement = HTMLElement>(page: HTMLElement, name: string): T {
  return page.querySelector<T>(`[data-doc-${name}]`)!; // safe: doc.astro renders every part
}

function show(selector: string): HTMLElement | null {
  const el = root?.querySelector<HTMLElement>(selector) ?? null;
  if (el) el.hidden = false;
  return el;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

function renderCrumbs(page: HTMLElement, tree: FolderNode | null, folder: string): void {
  const items: HTMLElement[] = [];
  const home = node('a', '', 'Documents');
  home.href = '/documents/';
  items.push(home);
  for (const crumb of crumbsFor(tree, folder)) {
    const a = node('a', '');
    a.href = folderHref(crumb.path);
    if (crumb.index) a.append(node('span', 'doc-crumb-index', crumb.index), ' ');
    a.append(crumb.name);
    items.push(a);
  }
  part(page, 'crumbs').replaceChildren(...items.map((item) => {
    const li = document.createElement('li');
    li.append(item);
    return li;
  }));
}

function setLink(a: HTMLAnchorElement, target: ListedDocument | null, label: string): void {
  if (target) {
    a.href = docHref(target.id);
    a.removeAttribute('aria-disabled');
    a.setAttribute('aria-label', `${label}: ${target.name}`);
  } else {
    a.removeAttribute('href');
    a.setAttribute('aria-disabled', 'true');
    a.removeAttribute('aria-label');
  }
}

function renderPager(page: HTMLElement, tree: FolderNode, doc: ExhibitDoc): void {
  const place = placeIn(findFolder(tree, doc.folder), doc.id);
  if (!place || place.total < 2) return;
  const { next } = place;
  setLink(part<HTMLAnchorElement>(page, 'prev'), place.prev, 'Previous in this folder');
  setLink(part<HTMLAnchorElement>(page, 'next'), next, 'Next in this folder');
  part(page, 'next-label').textContent = formatControl(controlPrefix(), next?.control_seq) || 'Next';
  part(page, 'place').textContent = `${place.position} of ${place.total} in folder`;
  part(page, 'pager').hidden = false;
}

/** The documents tree: breadcrumb index, folder neighbours, and control numbers for the discussion. */
async function loadFolder(page: HTMLElement, doc: ExhibitDoc): Promise<void> {
  const result = await getJson<{ root: FolderNode }>('/api/documents');
  if (!result.ok) return; // the plain breadcrumb stays; nothing else depends on it
  const tree = result.value.root;
  renderCrumbs(page, tree, doc.folder);
  renderPager(page, tree, doc);
  page.querySelector('[data-comment-thread]')?.dispatchEvent(new CustomEvent('legallas:controls', { detail: controlIndex(tree) }));
}

interface Fact {
  label: string;
  value: string | HTMLElement;
  quiet?: boolean;
}

function facts(doc: ExhibitDoc, docFacts: ServedDocFacts | null, matter: ServedMatter | null): Fact[] {
  const list: Fact[] = [];
  const date = formatPartialDate(docFacts?.date);
  if (date) list.push({ label: 'Date', value: date });
  list.push({ label: 'Type', value: docFacts?.type ? docTypeWords(docFacts.type) : typeLabel(doc.name) });
  const parties = matter && docFacts ? fromTo(namesFor(matter, docFacts.from), namesFor(matter, docFacts.to)) : null;
  if (parties) list.push(parties);
  if (doc.pages) list.push({ label: 'Pages', value: String(doc.pages) });
  else list.push({ label: 'Size', value: formatBytes(doc.size) });
  if (docFacts) {
    const privileged = node('span', docFacts.privileged ? 'c-chip c-chip--privileged' : '', docFacts.privileged ? MARK_LABEL : UNMARKED_LABEL);
    list.push({ label: 'Privilege', value: privileged });
  }
  if (doc.source === 'counsel') {
    const who = doc.uploader_name ?? doc.uploaded_by;
    list.push({ label: 'From counsel', value: `${who ? `${who}, ` : ''}${formatDate(doc.updated_at)}` });
  }
  list.push({ label: 'Bates', value: 'Not yet produced', quiet: true });
  const cited = matter ? citedIn(matter, doc.id) : '';
  if (cited) list.push({ label: 'Cited in', value: cited });
  return list;
}

function renderFacts(page: HTMLElement, doc: ExhibitDoc, matter: ServedMatter | null): void {
  const docFacts = matter?.docs[doc.id] ?? null;
  part(page, 'facts').replaceChildren(...facts(doc, docFacts, matter).map((fact) => {
    const dd = node('dd', fact.quiet ? 'doc-fact-quiet' : '');
    dd.append(fact.value);
    const div = node('div', 'doc-fact');
    div.append(node('dt', '', fact.label), dd);
    return div;
  }));
  const summary = part(page, 'summary');
  summary.textContent = docFacts?.summary ?? '';
  summary.hidden = !docFacts?.summary;
}

async function loadMatter(page: HTMLElement, doc: ExhibitDoc): Promise<void> {
  const matter = await pageMatter().catch(() => null);
  if (matter) renderFacts(page, doc, matter);
}

function pressKey(button: HTMLButtonElement, on: boolean): void {
  button.setAttribute('aria-pressed', String(on));
}

/**
 * Key: a shared flag any member with `flag` may set (POST /api/documents/:id/key, R35). A change made here or
 * in the exhibit pane is announced as `legallas:key` on document (R66), and both stay in step through it.
 */
function wireKey(page: HTMLElement, doc: ExhibitDoc): void {
  const button = part<HTMLButtonElement>(page, 'key');
  const status = part(page, 'key-status');
  pressKey(button, Boolean(doc.key_at));
  document.addEventListener('legallas:key', (event) => {
    const detail = (event as CustomEvent<KeyState>).detail;
    if (detail?.id === doc.id) pressKey(button, detail.key);
  });
  button.addEventListener('click', async () => {
    const want = button.getAttribute('aria-pressed') !== 'true';
    button.disabled = true;
    const result = await setKey(doc.id, want);
    button.disabled = false;
    if (!result.ok) {
      status.textContent = result.status === 403 ? 'Your role cannot mark Key documents.' : 'Key was not saved; try again.';
      return;
    }
    document.dispatchEvent(new CustomEvent('legallas:key', { detail: result.value }));
    status.textContent = result.value.key ? 'Marked Key for everyone in the room.' : 'Key removed.';
  });
}

function fillHeader(page: HTMLElement, doc: ExhibitDoc): void {
  const control = formatControl(controlPrefix(), doc.control_seq);
  const controlEl = part(page, 'control');
  controlEl.textContent = control;
  controlEl.hidden = !control;
  // The h1 is the reading title (R64); the file name stays under it when it differs, so counsel can find the file.
  const title = docTitle(doc.name);
  part(page, 'title').textContent = title;
  const file = part(page, 'file');
  file.textContent = doc.name;
  file.hidden = title === doc.name;
  document.title = pageTitle(`${control ? `${control} ` : ''}${title}`);
  for (const a of page.querySelectorAll<HTMLAnchorElement>('[data-doc-download]')) a.href = downloadUrl(doc.id);
  part<HTMLAnchorElement>(page, 'open').href = fileUrl(doc.id);
  part<HTMLAnchorElement>(page, 'ask').href = `/ask?doc=${encodeURIComponent(doc.id)}`;
  renderCrumbs(page, null, doc.folder);
  renderFacts(page, doc, null);
  wireKey(page, doc);
}

/** The PDF at #page=N (highlighting &q= when given), telling the discussion which page is in view. */
/**
 * Keeps --doc-pdf-fit at the height of the rendered pages, so on narrow screens the frame (doc.css, at most 80vh)
 * never shows empty ground under a short document (R87). Set through the CSSOM: the CSP refuses style attributes.
 */
function fitFrame(section: HTMLElement): void {
  const frame = section.querySelector<HTMLElement>('[data-pdf-frame]');
  const pages = section.querySelector<HTMLElement>('[data-pdf-viewer]');
  if (!frame || !pages || typeof ResizeObserver === 'undefined') return;
  new ResizeObserver(() => {
    const height = Math.ceil(pages.getBoundingClientRect().height);
    if (height > 0) frame.style.setProperty('--doc-pdf-fit', `${height}px`);
  }).observe(pages);
}

/** Whatever waits for the first page; a viewer that never says so lets it go after this long. */
const DRAWN_FALLBACK_MS = 10_000;

async function runPdf(section: HTMLElement, doc: DocMeta, drawn: () => void): Promise<boolean> {
  fitFrame(section);
  // The worker and a small file start now, beside the library's download (#203).
  const start = startPdf(doc.id, doc.size);
  const { openPdf } = await loadPdfViewer().catch((error: unknown) => {
    start.abort();
    throw error;
  });
  const thread = root?.querySelector('[data-comment-thread]');
  const handle = await openPdf(section, {
    id: doc.id,
    page: pageFromHash(location.hash),
    quote: quoteFromHash(location.hash),
    syncHash: true,
    start,
    onPage: (page) => thread?.dispatchEvent(new CustomEvent('legallas:page', { detail: { page } })),
    onDrawn: drawn,
  });
  if (handle) setTimeout(drawn, DRAWN_FALLBACK_MS);
  return handle !== null;
}

async function runViewer(viewer: Viewer, section: HTMLElement, doc: DocMeta, drawn: () => void): Promise<boolean> {
  switch (viewer) {
    case 'pdf':
      return runPdf(section, doc, drawn);
    case 'image':
      await showImage(section, doc);
      return true;
    case 'markdown':
      await showMarkdown(section, doc);
      return true;
    case 'csv':
      await showCsv(section, doc);
      return true;
    case 'text':
      await showText(section, doc);
      return true;
    case 'visual':
      await showVisual(section, doc);
      return true;
    case 'download':
      section.querySelector('[data-download-what]')!.textContent = // safe: doc.astro renders it
        `${typeLabel(doc.name)}, ${formatBytes(doc.size)}${doc.pages ? `, ${plural(doc.pages, 'page')}` : ''}.${whereItOpens(doc.name) ? ` ${whereItOpens(doc.name)}` : ''}`;
      return true;
  }
}

/** Reveals the viewer for the document's kind; `drawn` is called once its first page is on screen, or it failed. */
async function showView(page: HTMLElement, doc: ExhibitDoc, drawn: () => void): Promise<void> {
  const section = page.querySelector<HTMLElement>(`[data-view="${doc.viewer}"]`);
  if (!section) {
    show('[data-view-failed]');
    drawn();
    return;
  }
  section.hidden = false;
  let ok = false;
  try {
    ok = await runViewer(doc.viewer, section, doc, drawn);
    // A cite into a Markdown, CSV or text file marks its passage in place (&q=, card F7).
    const quote = quoteFromHash(location.hash);
    if (ok && quote && ['markdown', 'csv', 'text'].includes(doc.viewer)) highlightText(section, quote);
  } catch {
    ok = false;
  }
  if (!ok) {
    section.hidden = true;
    show('[data-view-failed]');
  }
  // Every other viewer has drawn by now; a PDF says so itself (onDrawn).
  if (!ok || doc.viewer !== 'pdf') drawn();
}

async function open(page: HTMLElement): Promise<void> {
  const id = docIdIn(location.search);
  if (!id) {
    show('[data-doc-missing]');
    return;
  }
  const result = await docMeta(id);
  if (!result.ok) {
    show(result.status === 404 ? '[data-doc-missing]' : '[data-doc-error]');
    return;
  }
  const doc = result.value;

  page.dataset.docId = doc.id;
  fillHeader(page, doc);
  show('[data-doc-ready]');
  void loadMatter(page, doc);
  let enriched = false;
  const enrich = () => {
    if (enriched) return;
    enriched = true;
    // The discussion panel (CommentThread) loads this document's thread when its data-document-id is set.
    const thread = page.querySelector<HTMLElement>('[data-comment-thread]');
    if (thread) thread.dataset.documentId = doc.id;
    void loadFolder(page, doc);
  };
  await showView(page, doc, enrich);
}

if (root) void open(root);
