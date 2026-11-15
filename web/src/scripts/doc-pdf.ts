// SPDX-License-Identifier: Apache-2.0
// The PDF viewer: PDF.js bundled from the pinned pdfjs-dist, its worker served from this origin and its
// data files under /pdfjs/ (integrations/pdfjs-assets.mjs). Nothing comes from a CDN.
//
// Locked down for case files: no XFA forms, no PDF JavaScript (no scripting manager, and the QuickJS
// sandbox is not shipped), no eval (PDF.js 6 has no eval path; isEvalSupported stays false for older
// versions and the CSP blocks eval anyway), forms drawn rather than editable, links open in a new tab
// with no referrer.
//
// openPdf (card F7) serves both the /doc/ page and the exhibit pane: it opens at a page, finds the cited
// passage with PDFFindController, and hands back a handle so the pane can tear the viewer down. Only /doc/
// keeps the address in step (#page=N), through syncHash.
import 'pdfjs-dist/web/pdf_viewer.css';
import '../styles/exhibit-pane.css';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker } from 'pdfjs-dist';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
// In this order: pdfjs-global.ts sets the global pdf_viewer.mjs reads as it evaluates. Static, so one dynamic import of
// this file fetches both chunks at once.
import { pdfjs } from './pdfjs-global.ts';
import * as viewerLib from 'pdfjs-dist/web/pdf_viewer.mjs';
import { pdfWorkerFailed, startPdf, workerUrl, type PdfStart } from './doc-pdf-start.ts';
import { fileUrl, pageFromHash, quoteFromHash } from './files-api.ts';
import { pdfFindQuery } from './files-format.ts';

const ASSETS = '/pdfjs/';
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const STEP = 1.25;

/** Options for opening a PDF: the document id, and the page to open at. */
export interface PdfOptions {
  id: string;
  /** The page to open at (1-based); the first page when absent. */
  page?: number | null;
  /** A passage to find and highlight once the pages are laid out. */
  quote?: string | null;
  /** Keep #page=N in the address while reading and follow hash changes (the /doc/ page only). */
  syncHash?: boolean;
  /** Called as the reader moves through the document. */
  onPage?: (page: number, total: number) => void;
  /**
   * Called with the number of matches for the passage and the page of the one shown. 0 matches means it was
   * not found and the requested page alone shows.
   */
  onFind?: (matches: number, page: number | null) => void;
  /**
   * The worker and file reads the caller started as soon as it knew it had a PDF (doc-pdf-start.ts). Without it they
   * start here, which still runs them beside each other.
   */
  start?: PdfStart;
  /** Called once, when the first page's text is on screen (or that page failed to draw). */
  onDrawn?: () => void;
}

/** The handle on an open PDF: its page count, page jumps and quote search. */
export interface PdfHandle {
  readonly total: number;
  goTo(page: number): void;
  /** Finds and highlights `quote`; resolves with the match count (0 when absent, and the view stays put). */
  highlight(quote: string): Promise<number>;
  destroy(): void;
}

type Viewer = import('pdfjs-dist/web/pdf_viewer.mjs').PDFViewer;
type Bus = import('pdfjs-dist/web/pdf_viewer.mjs').EventBus;
type Finder = import('pdfjs-dist/web/pdf_viewer.mjs').PDFFindController;
type FoundStates = { FOUND: number; WRAPPED: number; NOT_FOUND: number };

interface FindResult {
  matches: number;
  /** The page of the highlighted match, or null when there is none. */
  page: number | null;
}

interface FindState {
  state: number;
  matchesCount: { current: number; total: number };
  rawQuery: string | string[] | null;
}

let sharedWorker: PDFWorker | null = null;

/**
 * The library, and the page's one PDFWorker on the port the caller started. Passed to getDocument, it belongs to no
 * loading task, so closing one document never tears down the worker the next one needs.
 */
function loadLibrary(port: Worker | null) {
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  if (!port) sharedWorker = null;
  else if (sharedWorker?.port !== port) sharedWorker = pdfjs.PDFWorker.create({ port });
  return { pdfjs, viewerLib, worker: sharedWorker };
}

/**
 * Opens the document on the shared worker, and again on PDF.js's own if that worker fails to load (pdfWorkerFailed). The
 * retry reads the file by its address: the bytes went to the first attempt.
 */
async function loadDocument(library: Library, id: string, bytes: Uint8Array | null): Promise<{ task: PDFDocumentLoadingTask; pdf: PDFDocumentProxy | null }> {
  const task = library.pdfjs.getDocument(loadParams(id, bytes, library.worker));
  const opened = task.promise.then((pdf) => pdf, () => null);
  if (!library.worker) return { task, pdf: await opened };
  const first = await Promise.race([opened, pdfWorkerFailed().then(() => 'worker failed' as const)]);
  if (first !== 'worker failed') return { task, pdf: first };
  void task.destroy();
  sharedWorker = null;
  const retry = library.pdfjs.getDocument(loadParams(id, null, null));
  return { task: retry, pdf: await retry.promise.then((pdf) => pdf, () => null) };
}

function loadParams(id: string, bytes: Uint8Array | null, worker: PDFWorker | null): DocumentInitParameters & { isEvalSupported: boolean } {
  return {
    // The bytes when the caller already read the file whole, else PDF.js reads it in ranges.
    ...(bytes ? { data: bytes } : { url: fileUrl(id) }),
    ...(worker ? { worker } : {}),
    withCredentials: false,
    isEvalSupported: false,
    enableXfa: false,
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
  };
}

interface PdfToolbar {
  onPage(page: number): void;
  ready(): void;
}

/** The /doc/ page's pager and zoom bar, when `section` has one (the pane shows the bare pages). */
function pdfToolbar(section: HTMLElement, viewer: Viewer, eventBus: Bus, total: number, goTo: (n: number) => void, signal: AbortSignal): PdfToolbar | null {
  const q = <T extends HTMLElement>(selector: string) => section.querySelector<T>(selector);
  const page = q<HTMLInputElement>('[data-pdf-page]');
  const prev = q<HTMLButtonElement>('[data-pdf-prev]');
  const next = q<HTMLButtonElement>('[data-pdf-next]');
  const scale = q<HTMLSelectElement>('[data-pdf-scale]');
  const custom = q<HTMLOptionElement>('[data-pdf-custom]');
  const zoomIn = q<HTMLButtonElement>('[data-pdf-zoom-in]');
  const zoomOut = q<HTMLButtonElement>('[data-pdf-zoom-out]');
  if (!page || !prev || !next || !scale || !custom || !zoomIn || !zoomOut) return null;
  const count = q('[data-pdf-count]');
  const status = q('[data-pdf-status]');
  page.max = String(total);
  if (count) count.textContent = `of ${total}`;

  eventBus.on('scalechanging', ({ scale: value, presetValue }: { scale: number; presetValue?: string }) => {
    const preset = presetValue ?? String(value);
    const option = Array.from(scale.options).find((o) => o.value === preset && o !== custom);
    custom.hidden = Boolean(option);
    if (!option) {
      custom.value = 'custom';
      custom.textContent = `${Math.round(value * 100)}%`;
    }
    scale.value = option ? option.value : 'custom';
    zoomOut.disabled = value <= MIN_SCALE;
    zoomIn.disabled = value >= MAX_SCALE;
  });
  const zoom = (factor: number) => {
    viewer.currentScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewer.currentScale * factor));
  };
  prev.addEventListener('click', () => goTo(viewer.currentPageNumber - 1), { signal });
  next.addEventListener('click', () => goTo(viewer.currentPageNumber + 1), { signal });
  page.addEventListener('change', () => {
    const n = Number(page.value);
    if (Number.isFinite(n)) goTo(n);
    else page.value = String(viewer.currentPageNumber);
  }, { signal });
  scale.addEventListener('change', () => {
    if (scale.value !== 'custom') viewer.currentScaleValue = scale.value;
  }, { signal });
  zoomIn.addEventListener('click', () => zoom(STEP), { signal });
  zoomOut.addEventListener('click', () => zoom(1 / STEP), { signal });

  return {
    onPage(n: number) {
      page.value = String(n);
      prev.disabled = n <= 1;
      next.disabled = n >= total;
    },
    ready() {
      if (status) status.textContent = `${total} ${total === 1 ? 'page' : 'pages'}`;
    },
  };
}

/**
 * Runs a phrase find from the current page onward (wrapping) and resolves once PDF.js settles on found or not
 * found. PDF.js scrolls the first match into view and highlights every match.
 */
function findPhrase(eventBus: Bus, finder: Finder, states: FoundStates, quote: string, signal: AbortSignal): Promise<FindResult> {
  const query = pdfFindQuery(quote);
  if (!query || signal.aborted) return Promise.resolve({ matches: 0, page: null });
  return new Promise<FindResult>((resolve) => {
    const done = (result: FindResult) => {
      eventBus.off('updatefindcontrolstate', onState);
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => done({ matches: 0, page: null });
    const onState = ({ state, matchesCount, rawQuery }: FindState) => {
      if (rawQuery !== query) return;
      if (state === states.NOT_FOUND) done({ matches: 0, page: null });
      else if (state === states.FOUND || state === states.WRAPPED) {
        const index = finder.selected?.pageIdx ?? -1;
        done({ matches: Math.max(1, matchesCount.total), page: index >= 0 ? index + 1 : null });
      }
    };
    eventBus.on('updatefindcontrolstate', onState);
    signal.addEventListener('abort', onAbort);
    eventBus.dispatch('find', {
      source: null,
      type: '',
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: false,
      matchDiacritics: false,
    });
  });
}

type Library = ReturnType<typeof loadLibrary>;

/** A PDFViewer with its own event bus, link service and find controller: nothing is shared between viewers. */
function createViewer(container: HTMLDivElement, viewerEl: HTMLDivElement, { pdfjs, viewerLib }: Library) {
  const { EventBus, LinkTarget, PDFFindController, PDFLinkService, PDFViewer } = viewerLib;
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' });
  const findController = new PDFFindController({ eventBus, linkService });
  const viewer: Viewer = new PDFViewer({
    container,
    viewer: viewerEl,
    eventBus,
    linkService,
    findController,
    annotationMode: pdfjs.AnnotationMode.ENABLE,
    annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE,
    removePageBorders: false,
  });
  linkService.setViewer(viewer);
  return { eventBus, linkService, findController, viewer };
}

interface Reading {
  opts: PdfOptions;
  viewer: Viewer;
  eventBus: Bus;
  total: number;
  toolbar: PdfToolbar | null;
  goTo: (n: number) => void;
  find: (quote: string) => Promise<FindResult>;
  signal: AbortSignal;
}

/** Page tracking, the opening page and passage, and (for /doc/) the address. */
function followReading({ opts, viewer, eventBus, total, toolbar, goTo, find, signal }: Reading): void {
  eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
    toolbar?.onPage(pageNumber);
    opts.onPage?.(pageNumber, total);
    // Keep the address a shareable deep link without adding a history entry per page.
    if (opts.syncHash) history.replaceState(history.state, '', `${location.pathname}${location.search}#page=${pageNumber}`);
  });

  eventBus.on('pagesinit', () => {
    viewer.currentScaleValue = 'page-width';
    if (opts.page) goTo(opts.page);
    opts.onPage?.(viewer.currentPageNumber, total);
    toolbar?.ready();
    if (!opts.quote) return;
    void find(opts.quote).then(({ matches, page }) => {
      if (signal.aborted) return;
      // Not found: the cited page alone, as if no passage had been given.
      if (matches === 0 && opts.page) goTo(opts.page);
      opts.onFind?.(matches, page);
    });
  });

  if (opts.syncHash) {
    window.addEventListener('hashchange', () => {
      const page = pageFromHash(location.hash);
      if (page) goTo(page);
    }, { signal });
  }
}

/** Calls `done` once: on the first page's text layer, or on a page that failed to draw. */
function whenDrawn(eventBus: Bus, done: () => void): void {
  const finish = () => {
    eventBus.off('textlayerrendered', finish);
    eventBus.off('pagerendered', failed);
    done();
  };
  const failed = ({ error }: { error?: unknown }) => {
    if (error) finish();
  };
  eventBus.on('textlayerrendered', finish);
  eventBus.on('pagerendered', failed);
}

/**
 * Opens document `opts.id` in `section`, which holds a [data-pdf-container] (absolutely positioned, as PDF.js
 * requires) around a [data-pdf-viewer]. The /doc/ toolbar hooks are optional. Resolves null if the PDF cannot
 * be read (the caller offers the download).
 */
export async function openPdf(section: HTMLElement, opts: PdfOptions): Promise<PdfHandle | null> {
  const container = section.querySelector<HTMLDivElement>('[data-pdf-container]');
  const viewerEl = section.querySelector<HTMLDivElement>('[data-pdf-viewer]');
  const start = opts.start ?? startPdf(opts.id, null);
  if (!container || !viewerEl) {
    start.abort();
    return null;
  }
  const library = loadLibrary(start.port);
  const { eventBus, linkService, findController, viewer } = createViewer(container, viewerEl, library);
  if (opts.onDrawn) whenDrawn(eventBus, opts.onDrawn);

  const { task, pdf } = await loadDocument(library, opts.id, await start.bytes);
  if (!pdf) {
    void task.destroy();
    return null;
  }

  const life = new AbortController();
  const total = pdf.numPages;
  const goTo = (n: number) => {
    viewer.currentPageNumber = Math.min(Math.max(1, Math.round(n)), total);
  };
  const find = (quote: string) => findPhrase(eventBus, findController, library.viewerLib.FindState, quote, life.signal);
  const toolbar = pdfToolbar(section, viewer, eventBus, total, goTo, life.signal);
  followReading({ opts, viewer, eventBus, total, toolbar, goTo, find, signal: life.signal });
  // The pane resizes without the window, so watch the container itself.
  const resize = new ResizeObserver(() => {
    const preset = viewer.currentScaleValue;
    if (preset === 'page-width' || preset === 'page-fit' || preset === 'auto') viewer.currentScaleValue = preset;
  });
  resize.observe(container);

  viewer.setDocument(pdf);
  linkService.setDocument(pdf, null);

  return {
    total,
    goTo,
    highlight: async (quote: string) => (await find(quote)).matches,
    destroy() {
      if (life.signal.aborted) return;
      life.abort();
      start.abort();
      resize.disconnect();
      viewer.cleanup();
      viewer.setDocument(null as unknown as PDFDocumentProxy);
      linkService.setDocument(null, null);
      void task.destroy();
    },
  };
}

/** The /doc/ page: opens at #page=N, highlights &q=<passage> if given, and keeps the hash in step. */
export async function showPdf(section: HTMLElement, id: string): Promise<boolean> {
  const handle = await openPdf(section, {
    id,
    page: pageFromHash(location.hash),
    quote: quoteFromHash(location.hash),
    syncHash: true,
  });
  return handle !== null;
}
