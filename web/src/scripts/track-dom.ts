// SPDX-License-Identifier: Apache-2.0
// Track pages: the small DOM pieces every section shares. Cite chips carry data-exhibit, so a plain click opens
// the exhibit pane (initExhibitLinks in track.ts) and a modified click follows the link to /doc/. Text only:
// matter strings are untrusted data and never reach innerHTML. CSP: no style= attributes.
import { controlPrefix, formatCite, type ServedCite, type Side } from './matter-api.ts';
import { shapeSvg } from './viz/core.ts';

type Attrs = Record<string, string | undefined>;

/** A stable, selector-safe id fragment from a manifest id. */
export function slug(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '-');
}

/** Creates an element with attributes and optional text, appended to a parent when one is given. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs = {}, parent?: Element | null, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
}

/** Where a cite goes without script: the document page, at the cited page. */
export function citeHref(cite: Pick<ServedCite, 'doc' | 'page'>): string {
  const base = `/doc/?id=${encodeURIComponent(cite.doc)}`;
  return cite.page === null ? base : `${base}#page=${cite.page}`;
}

/** "DOE-000412 at 3"; before a number is assigned, "Document at 3". */
export function citeText(cite: Pick<ServedCite, 'control' | 'page'>): string {
  return formatCite(controlPrefix(), cite) || (cite.page === null ? 'Document' : `Document at ${cite.page}`);
}

/** A cite chip that opens the exhibit pane at the cited page. */
export function citeChip(cite: ServedCite, parent: Element, note?: string | null): HTMLAnchorElement {
  const title = note ?? cite.note ?? undefined;
  return el('a', { class: 'c-cite', href: citeHref(cite), title, 'data-exhibit': '' }, parent, citeText(cite));
}

/** A row of cite chips; nothing when there are none. */
export function citeRow(cites: readonly ServedCite[], parent: Element, label = 'Sources'): HTMLElement | null {
  if (cites.length === 0) return null;
  const row = el('span', { class: 'track-cites', role: 'group', 'aria-label': label }, parent);
  for (const cite of cites) citeChip(cite, row);
  return row;
}

/** A neutral party chip with the party's side shape: the shape backs the side, the name stays in ink. */
export function partyChip(name: string, side: Side | null, parent: Element): HTMLElement {
  const chip = el('span', { class: 'c-chip track-party' }, parent);
  if (side) shapeSvg(side, 12, chip);
  el('span', {}, chip, name);
  return chip;
}

/** The violation letter mark: the letter itself, so the mark never rests on color alone. */
export function markBadge(mark: string, parent: Element): HTMLElement {
  return el('span', { class: 'c-mark', 'data-mark': mark, 'aria-hidden': 'true' }, parent, mark);
}

/** One sentence, ending in a period (DESIGN.md section 9). */
export function emptyLine(sentence: string, parent: Element): HTMLElement {
  const box = el('div', { class: 'c-empty track-blank' }, parent);
  el('p', { class: 'c-empty__text' }, box, sentence);
  return box;
}

// How far below the viewport a lazy section starts loading, so it is drawn by the time it scrolls into view.
const NEAR_MARGIN = '600px 0px';
const IDLE_TIMEOUT_MS = 3000;

/**
 * Runs `load` once, off the eager path (R20: the chart modules stay out of the page's eager script): when
 * `section` comes near the viewport, or when the browser is idle after load, so printing never finds an empty
 * section. A failed load leaves one sentence in `body`.
 */
export function whenNear(section: Element, body: HTMLElement, load: () => Promise<void>): void {
  let started = false;
  let observer: IntersectionObserver | null = null;
  const run = () => {
    if (started) return;
    started = true;
    observer?.disconnect();
    load().catch(() => {
      body.replaceChildren();
      emptyLine('This section could not load; reload the page to try again.', body);
    });
  };
  if (typeof IntersectionObserver === 'undefined') {
    run();
    return;
  }
  observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && run(), { rootMargin: NEAR_MARGIN });
  observer.observe(section);
  const idle = () => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    else setTimeout(run, IDLE_TIMEOUT_MS);
  };
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
  window.addEventListener('beforeprint', run, { once: true });
}
