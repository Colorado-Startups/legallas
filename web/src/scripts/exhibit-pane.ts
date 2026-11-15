// SPDX-License-Identifier: Apache-2.0
// The exhibit pane (card F7; DESIGN.md section 7, "Exhibit pane"): any document, opened at a page with the
// cited passage highlighted, beside the page that cites it. Wider than 64rem it is the right half of a split
// view and the page stays usable; at 64rem and below it is a modal full-screen sheet that traps focus. Esc or
// Close shuts it and returns focus to the cite. The DOM and the viewers live in exhibit-pane-view.ts.
//
// Pages either call openExhibit({ id, page, quote, opener }) or mark their cite links and call
// initExhibitLinks() once:
//   <a class="c-cite" href="/doc/?id=<id>#page=3" data-exhibit data-quote="<passage>">DOE-000412 at 3</a>
// A plain click opens the pane; a modified click (new tab, new window) follows the link to /doc/ as usual.
// A pane opened from inside an overlay (the Ask drawer) passes returnTo: the overlay closes first, so the two
// never stack, and the pane's "Back to question" button closes the pane and reopens it (R66).
// A Key change is announced as a `legallas:key` event on document, detail { id, key, key_at, key_by }.
import '../styles/exhibit-pane.css';
import '../styles/markdown-body.css';
import { docTarget, getJson, setKey, type DocMeta, type DocTarget } from './files-api.ts';
import { normalizeQuote } from './files-format.ts';
import { guideSend } from './guide-bus.ts';
import { pageMatter, type ServedMatter } from './doc-facts.ts';
import type { PdfHandle } from './doc-pdf.ts';
import { buildPane, fillFacts, fillHead, renderView, resetHead, setNote, type DocContext, type PaneParts } from './exhibit-pane-view.ts';

/** A request to open an exhibit: the document id, and optionally a page and a quote. */
export interface ExhibitRequest {
  id: string;
  page?: number | null;
  quote?: string | null;
  /** The cite that opened the pane: aria-expanded while open, and focused again on close. */
  opener?: HTMLElement | null;
  /** Where "Back to question" goes: the button's label, and how to reopen what the cite came from. */
  returnTo?: ExhibitReturn | null;
}

/** How the pane hands back to where it was opened: a label and a callback that reopens it. */
export interface ExhibitReturn {
  label: string;
  reopen: () => void;
}

/** Matches the c-pane sheet rule in components.css: at 64rem and below the pane covers the page. */
const SHEET_QUERY = '(max-width: 64rem)';
const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])';

let ui: PaneParts | null = null;
let handle: PdfHandle | null = null;
let opener: HTMLElement | null = null;
let generation = 0;
let session: AbortController | null = null;
let inerted: HTMLElement[] = [];
let keyBusy = false;
let returnTo: ExhibitReturn | null = null;
let matter: Promise<{ matter: ServedMatter; names: Map<string, string> } | null> | null = null;

/** The matter's facts about one document, from one cached GET /api/matter; null when there are none. */
async function docContext(id: string): Promise<DocContext | null> {
  matter ??= pageMatter()
    .then((m) => (m ? { matter: m, names: new Map([...m.people, ...m.orgs].map((p) => [p.id, p.name])) } : null))
    .catch(() => {
      matter = null; // a failed fetch is retried on the next open
      return null;
    });
  const loaded = await matter;
  const facts = loaded?.matter.docs[id];
  return loaded && facts ? { facts, names: loaded.names } : null;
}

function setOpener(next: HTMLElement | null): void {
  if (opener && opener !== next) opener.setAttribute('aria-expanded', 'false');
  opener = next;
  if (next) {
    next.setAttribute('aria-expanded', 'true');
    next.setAttribute('aria-controls', 'exhibit-pane');
  }
}

function teardownView(): void {
  handle?.destroy();
  handle = null;
}

/** The split starts under the header while the header is on screen, and at the top once it scrolls away. */
function placeUnderHeader(pane: HTMLElement): void {
  const header = document.querySelector('body > header');
  const bottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
  pane.style.setProperty('--exhibit-top', `${Math.round(bottom)}px`);
}

/** Split or sheet, from the viewport width; only the sheet is modal (aria-modal, inert page, focus trap). */
function applyMode(pane: HTMLElement): void {
  const sheet = matchMedia(SHEET_QUERY).matches;
  document.documentElement.dataset.exhibit = sheet ? 'sheet' : 'split';
  pane.setAttribute('aria-modal', String(sheet));
  for (const el of inerted) el.inert = false;
  inerted = [];
  if (sheet) {
    for (const el of document.body.children) {
      if (el instanceof HTMLElement && el !== pane && !el.inert) {
        el.inert = true;
        inerted.push(el);
      }
    }
  }
  placeUnderHeader(pane);
}

function trapTab(event: KeyboardEvent, pane: HTMLElement): void {
  const items = Array.from(pane.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !pane.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !pane.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function onKeydown(event: KeyboardEvent, pane: HTMLElement): void {
  if (event.defaultPrevented || event.isComposing) return;
  const modal = pane.getAttribute('aria-modal') === 'true';
  if (event.key === 'Escape' && (modal || pane.contains(event.target as Node))) {
    event.preventDefault();
    closeExhibit();
  } else if (event.key === 'Tab' && modal) {
    trapTab(event, pane);
  }
}

function showPane(parts: PaneParts): void {
  if (!parts.root.hidden) return;
  parts.root.hidden = false;
  session = new AbortController();
  const { signal } = session;
  const reposition = () => placeUnderHeader(parts.root);
  document.addEventListener('keydown', (e) => onKeydown(e, parts.root), { signal });
  window.addEventListener('scroll', reposition, { passive: true, signal });
  window.addEventListener('resize', reposition, { passive: true, signal });
  matchMedia(SHEET_QUERY).addEventListener('change', () => applyMode(parts.root), { signal });
  applyMode(parts.root);
}

/**
 * Closes the pane, stops its viewer, and returns focus to the cite that opened it (unless `restoreFocus` is
 * false: "Back to question" hands focus to the overlay it reopens instead).
 */
export function closeExhibit(restoreFocus = true): void {
  if (!ui || ui.root.hidden) return;
  returnTo = null;
  ui.back.hidden = true;
  generation += 1;
  teardownView();
  ui.root.hidden = true;
  resetHead(ui);
  session?.abort();
  session = null;
  for (const el of inerted) el.inert = false;
  inerted = [];
  delete document.documentElement.dataset.exhibit;
  const back = opener;
  setOpener(null);
  if (restoreFocus && back?.isConnected) back.focus();
}

async function toggleKey(parts: PaneParts): Promise<void> {
  const id = parts.root.dataset.docId;
  if (!id || keyBusy) return;
  const on = parts.key.getAttribute('aria-pressed') !== 'true';
  keyBusy = true;
  parts.key.setAttribute('aria-pressed', String(on));
  const result = await setKey(id, on);
  keyBusy = false;
  if (parts.root.dataset.docId !== id) return;
  if (result.ok) {
    parts.key.setAttribute('aria-pressed', String(result.value.key));
    document.dispatchEvent(new CustomEvent('legallas:key', { detail: result.value }));
    return;
  }
  parts.key.setAttribute('aria-pressed', String(!on));
  if (result.status === 404) {
    // No Key route (or the document is gone): the toggle goes away rather than failing again.
    const hadFocus = document.activeElement === parts.key;
    parts.key.hidden = true;
    if (hadFocus) parts.close.focus();
  } else {
    setNote(parts, 'Key did not save; try again.');
  }
}

function pane(): PaneParts {
  if (ui) return ui;
  const parts = buildPane();
  parts.close.addEventListener('click', () => closeExhibit());
  parts.back.addEventListener('click', () => {
    const target = returnTo;
    closeExhibit(false);
    target?.reopen();
  });
  parts.key.addEventListener('click', () => void toggleKey(parts));
  document.body.append(parts.root);
  ui = parts;
  return parts;
}

/** Opens document `req.id` in the pane at `req.page`, highlighting `req.quote` when it is found. */
export async function openExhibit(req: ExhibitRequest): Promise<void> {
  initExhibitLinks();
  const parts = pane();
  const mine = ++generation;
  const live = () => mine === generation;
  teardownView();
  setOpener(req.opener ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : opener));
  resetHead(parts);
  returnTo = req.returnTo ?? null;
  parts.back.hidden = !returnTo;
  parts.back.textContent = returnTo?.label || 'Back to question';
  setNote(parts, 'Opening the document.');
  showPane(parts);
  guideSend({ type: 'cite' });
  parts.close.focus();

  const page = req.page && req.page > 0 ? Math.floor(req.page) : null;
  const quote = normalizeQuote(req.quote) || null;
  const context = docContext(req.id);
  const meta = await getJson<DocMeta>(`/api/doc/${encodeURIComponent(req.id)}`);
  if (!live()) return;
  if (!meta.ok) {
    parts.title.textContent = meta.status === 404 ? 'Document not found' : 'Document not opened';
    setNote(parts, meta.status === 404 ? 'This document is no longer in the room.' : 'This document did not open; try again.');
    return;
  }
  const view = { page, quote, live };
  // The matter's facts join the head when they come; the viewer doesn't wait for them.
  fillHead(parts, meta.value, null, view);
  void context.then((facts) => {
    if (live() && facts) fillFacts(parts, meta.value, facts, view);
  });
  const shown = await renderView(parts, meta.value, view);
  if (live() && typeof shown === 'object') handle = shown;
}

let bound = false;

function onCiteClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[data-exhibit]');
  if (!link || link.getAttribute('aria-disabled') === 'true') return;
  const target: DocTarget | null = docTarget(link.getAttribute('href') ?? '', location.href);
  if (!target) return;
  event.preventDefault();
  // A second click on the cite whose pane is open closes it.
  if (link === opener && ui && !ui.root.hidden) {
    closeExhibit();
    return;
  }
  void openExhibit({ ...target, quote: link.dataset.quote ?? target.quote, opener: link });
}

/** Routes plain clicks on a[data-exhibit] links anywhere in the page to the pane. Safe to call more than once. */
export function initExhibitLinks(): void {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('click', onCiteClick);
}
