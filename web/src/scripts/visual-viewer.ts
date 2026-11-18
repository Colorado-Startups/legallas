// SPDX-License-Identifier: Apache-2.0
// One visual at a time, like turning pages (card P8): the tab's pages as numbered chips, the visual in a
// script-only sandbox, and fletched Previous / Next across the whole binder (also the arrow keys).
//
// The visual cannot navigate or reach the network itself. Its bridge script (worker/visualprep.ts)
// posts { <stored name>: 1, type: 'nav' | 'key' | 'out' | 'cite' }; only messages from this page's own frame are
// read, only slugs that exist in the binder are followed, web links are shown, never opened for the user,
// and a cite opens only a document of this room, by control number, in the exhibit pane.
import {
  el,
  loadBinder,
  markRead,
  pageKicker,
  partLabel,
  visualHref,
  type RoomBinder,
  type RoomSection,
  type RoomVisual,
} from './binder-data.ts';
import { getJson, type FolderNode } from './files-api.ts';
import { controlPrefix } from './matter-api.ts';
import { controlIndex, parseVisualCite } from './visual-cite.ts';
import { pageTitle } from './room-names.ts';

/** The room's stored name as a literal (worker/stored-name.ts; astro.config.mjs defines it), so the page reads `.name===1`. */
declare const ROOM_STORED_NAME: string;

interface BridgeMessage {
  type: 'nav' | 'key' | 'out' | 'cite';
  slug?: unknown;
  key?: unknown;
  url?: unknown;
  ref?: unknown;
}

const root = document.querySelector<HTMLElement>('[data-viewer]');
const frame = root?.querySelector<HTMLIFrameElement>('[data-viewer-frame]');

function isBridgeMessage(data: unknown): data is BridgeMessage {
  return typeof data === 'object' && data !== null && (data as Record<string, unknown>)[ROOM_STORED_NAME] === 1;
}

/** A web link from a visual, if it is plain http(s). Shown to the user as an explicit way out. */
function outsideUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** A copy of D2's fletched arrow from the page's template (visual/index.astro). */
function arrow(kind: 'prev' | 'next'): Node | null {
  const template = document.querySelector<HTMLTemplateElement>('template[data-viewer-arrows]');
  return template?.content.querySelector(`[data-arrow="${kind}"]`)?.cloneNode(true) ?? null;
}

/** What the viewer's parts share: its element, the frame now showing, the binder's lookups and the page shown. */
interface Viewer {
  root: HTMLElement;
  iframe: HTMLIFrameElement;
  visuals: Map<string, RoomVisual>;
  sections: Map<string, RoomSection>;
  /** Every visual's slug in binder order, across the tabs. */
  order: string[];
  current: RoomVisual | null;
  documents: Promise<Map<number, string> | null> | null;
}

function q<T extends HTMLElement = HTMLElement>(v: Viewer, selector: string): T {
  return v.root.querySelector<T>(selector)!;
}

/** Control number to id for the room's documents, fetched once, on the first cite. */
function documentIndex(v: Viewer): Promise<Map<number, string> | null> {
  v.documents ??= getJson<{ root: FolderNode }>('/api/documents').then((result) => {
    if (result.ok) return controlIndex(result.value.root);
    v.documents = null; // a failed fetch is retried on the next cite
    return null;
  });
  return v.documents;
}

function note(v: Viewer, text: string): void {
  q(v, '[data-viewer-note-text]').textContent = text;
  q(v, '[data-viewer-note]').hidden = false;
}

async function openCite(v: Viewer, ref: unknown): Promise<void> {
  const cite = parseVisualCite(ref, controlPrefix());
  if (!cite) return;
  const from = v.current;
  const index = await documentIndex(v);
  if (v.current !== from) return; // the reader turned the page while the list loaded
  const id = index?.get(cite.seq);
  if (!id) {
    note(v, index ? 'That exhibit is not in the room.' : 'The exhibit did not open; try again.');
    return;
  }
  const { openExhibit } = await import('./exhibit-pane.ts');
  if (v.current !== from) return;
  void openExhibit({ id, page: cite.page, opener: v.iframe });
}

function navLink(v: Viewer, kind: 'prev' | 'next', slug: string | undefined, from: RoomSection): HTMLElement | null {
  if (!slug) return null;
  const target = v.visuals.get(slug)!;
  const section = v.sections.get(target.section)!;
  const crossing = section.slug !== from.slug;
  const kicker = kind === 'prev' ? (crossing ? `Previous tab, ${section.label}` : 'Previous') : crossing ? `Next tab, ${section.label}` : 'Next';
  return el(
    'a',
    { class: `binder-turn binder-turn--${kind}`, href: visualHref(slug), rel: kind, 'data-slug': slug },
    arrow(kind),
    el('span', { class: 'binder-turn__kicker' }, kicker),
    el('span', { class: 'binder-turn__title' }, crossing ? section.title : target.title),
  );
}

/** The page's heading: tab crumb, kicker, title and summary. Returns the kicker. */
function showHeading(v: Viewer, visual: RoomVisual, section: RoomSection): string {
  v.root.dataset.accent = section.accent;
  document.title = pageTitle(visual.title);
  const crumbSection = q<HTMLAnchorElement>(v, '[data-crumb-section]');
  crumbSection.textContent = `${section.label}: ${section.title}`;
  crumbSection.href = visualHref(section.visuals[0]!);
  const kicker = pageKicker(section, v.visuals, visual.slug);
  q(v, '[data-viewer-kicker]').textContent = kicker;
  q(v, '[data-viewer-title]').textContent = visual.title;
  const summary = q(v, '[data-viewer-summary]');
  summary.textContent = visual.summary ?? '';
  summary.hidden = !visual.summary;
  return kicker;
}

/** The tab's pages as numbered chips, the current one scrolled into view. */
function showChips(v: Viewer, section: RoomSection, slug: string): void {
  const chips = q(v, '[data-viewer-chips]');
  chips.replaceChildren(
    ...section.visuals.map((s) => {
      const visual = v.visuals.get(s)!;
      const chip = el(
        'a',
        { href: visualHref(s), 'data-slug': s, title: visual.title, 'aria-current': s === slug ? 'page' : undefined },
        el('span', { class: 'binder-chips__n' }, partLabel(section, v.visuals, s)),
        el('span', { class: 'binder-chips__t' }, visual.title),
      );
      return el('li', {}, chip);
    }),
  );
  chips.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

/** Previous and Next across the whole binder. */
function showTurns(v: Viewer, section: RoomSection, slug: string): void {
  const index = v.order.indexOf(slug);
  q(v, '[data-viewer-turns]').replaceChildren(
    ...[navLink(v, 'prev', v.order[index - 1], section), navLink(v, 'next', v.order[index + 1], section)].filter((n): n is HTMLElement => n !== null),
  );
}

/** A fresh frame per page: nothing a visual does survives into the next one, and (unlike changing
 *  src on a live frame) it adds no entry of its own to the session history, so Back stays in step. */
function swapFrame(v: Viewer, visual: RoomVisual): void {
  const next = v.iframe.cloneNode(false) as HTMLIFrameElement;
  next.title = visual.title;
  next.src = visual.src ?? `/files/${encodeURIComponent(visual.id)}`;
  v.iframe.replaceWith(next);
  v.iframe = next;
}

function show(v: Viewer, slug: string, push: boolean): void {
  const visual = v.visuals.get(slug);
  if (!visual) {
    q(v, '[data-viewer-ready]').hidden = true;
    q(v, '[data-viewer-missing]').hidden = false;
    return;
  }
  const section = v.sections.get(visual.section)!;
  v.current = visual;
  if (push) history.pushState({ slug }, '', visualHref(slug));
  const kicker = showHeading(v, visual, section);
  showChips(v, section, slug);
  showTurns(v, section, slug);
  q(v, '[data-viewer-out]').hidden = true;
  q(v, '[data-viewer-note]').hidden = true;
  swapFrame(v, visual);
  q(v, '[data-viewer-status]').textContent = `${kicker}: ${visual.title}`;
  markRead(slug);
}

function step(v: Viewer, delta: -1 | 1): void {
  if (!v.current) return;
  const next = v.order[v.order.indexOf(v.current.slug) + delta];
  if (next) show(v, next, true);
}

/** Shows a web link from a visual as an explicit way out; the reader decides whether to follow it. */
function showOutside(v: Viewer, value: unknown): void {
  const url = outsideUrl(value);
  if (!url) return;
  const link = q<HTMLAnchorElement>(v, '[data-viewer-out-link]');
  link.href = url.href;
  link.textContent = `${url.hostname}${url.pathname.length > 1 ? url.pathname : ''}`;
  q(v, '[data-viewer-out]').hidden = false;
}

/** What a visual's bridge message asks for: a page, a turn, a cite or a web link. */
function onBridgeMessage(v: Viewer, message: BridgeMessage): void {
  if (message.type === 'nav' && typeof message.slug === 'string' && v.visuals.has(message.slug)) show(v, message.slug, true);
  else if (message.type === 'key' && message.key === 'ArrowLeft') step(v, -1);
  else if (message.type === 'key' && message.key === 'ArrowRight') step(v, 1);
  else if (message.type === 'cite') void openCite(v, message.ref);
  else if (message.type === 'out') showOutside(v, message.url);
}

/** Plain left clicks on chips and turns stay in the page; modified clicks open a tab as usual. */
function wireNavigation(v: Viewer): void {
  v.root.addEventListener('click', (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-slug]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    show(v, link.dataset.slug!, true);
  });

  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if ((event.target as Element).closest('input, select, textarea, [contenteditable]')) return;
    if (event.key === 'ArrowLeft') step(v, -1);
    if (event.key === 'ArrowRight') step(v, 1);
  });

  window.addEventListener('message', (event) => {
    // The frame's sandbox is script-only, so every message it sends carries the origin "null".
    if (event.origin === 'null' && event.source === v.iframe.contentWindow && isBridgeMessage(event.data)) {
      onBridgeMessage(v, event.data);
    }
  });

  window.addEventListener('popstate', () => show(v, new URLSearchParams(location.search).get('v') ?? '', false));
}

/** The two notices' close buttons and the full-screen toggle. */
function wireControls(v: Viewer): void {
  q(v, '[data-viewer-out-close]').addEventListener('click', () => {
    q(v, '[data-viewer-out]').hidden = true;
  });
  q(v, '[data-viewer-note-close]').addEventListener('click', () => {
    q(v, '[data-viewer-note]').hidden = true;
  });

  const fullscreen = q<HTMLButtonElement>(v, '[data-viewer-fullscreen]');
  const stage = q(v, '[data-viewer-stage]');
  fullscreen.hidden = !document.fullscreenEnabled;
  fullscreen.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.requestFullscreen();
  });
}

function start(viewer: HTMLElement, firstFrame: HTMLIFrameElement, binder: RoomBinder): void {
  const v: Viewer = {
    root: viewer,
    iframe: firstFrame,
    visuals: new Map(binder.visuals.map((visual) => [visual.slug, visual])),
    sections: new Map(binder.sections.map((s) => [s.slug, s])),
    order: binder.sections.flatMap((s) => s.visuals),
    current: null,
    documents: null,
  };
  wireNavigation(v);
  wireControls(v);
  q(v, '[data-viewer-ready]').hidden = false;
  const requested = new URLSearchParams(location.search).get('v') ?? v.order[0] ?? '';
  history.replaceState({ slug: requested }, '', visualHref(requested));
  show(v, requested, false);
}

async function boot(): Promise<void> {
  if (!root || !frame) return;
  const result = await loadBinder();
  if (!result.ok || result.binder.visuals.length === 0) {
    root.querySelector<HTMLElement>('[data-viewer-missing]')!.hidden = false;
    return;
  }
  start(root, frame, result.binder);
}

void boot();
