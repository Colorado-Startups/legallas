// SPDX-License-Identifier: Apache-2.0
// Card P1b (Overview, case picture). The DOM pieces every case block shares: the block frame (heading with its
// count and "Open ..." link), the one-sentence empty state and cite chips (opened by the exhibit pane). All text goes in
// through textContent and attributes; nothing here parses HTML.
import { el } from './dom-el.ts';

export { el };

/** A case block: heading, count, an optional "Open ..." link, then `body`. Returns the section and its body. */
export function block(opts: {
  key: string;
  title: string;
  count: string;
  open?: { href: string; label: string };
  wide?: boolean;
}): { section: HTMLElement; body: HTMLElement; tools: HTMLElement } {
  const headingId = `ov-${opts.key}-title`;
  const tools = el('div', { class: 'ov-block__tools' });
  if (opts.open) tools.append(el('a', { class: 'ov-block__open', href: opts.open.href }, opts.open.label));
  const head = el(
    'header',
    { class: 'ov-block__head' },
    el('h2', { class: 't-h2 ov-block__title', id: headingId }, opts.title),
    el('p', { class: 'ov-block__count', 'data-ov-count': '' }, opts.count),
    tools,
  );
  const body = el('div', { class: 'ov-block__body' });
  const section = el(
    'section',
    { class: 'ov-block', 'data-ov-block': opts.key, 'data-wide': opts.wide ? 'true' : undefined, 'aria-labelledby': headingId },
    head,
    body,
  );
  return { section, body, tools };
}

/** One sentence, ending in a period (DESIGN.md section 9). */
export function emptyState(sentence: string): HTMLElement {
  return el('div', { class: 'c-empty ov-blank' }, el('p', { class: 'c-empty__text' }, sentence));
}

/** A "Table" toggle for a chart block's head (every chart has a table twin). */
export function tableToggle(tools: HTMLElement, label: string, onToggle: (table: boolean) => void): HTMLButtonElement {
  const button = el('button', { type: 'button', class: 'c-button c-button--quiet ov-block__toggle', 'aria-pressed': 'false' }, 'Table');
  button.setAttribute('aria-label', `Show ${label} as a table`);
  button.addEventListener('click', () => {
    const table = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(table));
    onToggle(table);
  });
  tools.prepend(button);
  return button;
}

// How far below the viewport a chart starts loading, so it is drawn by the time it scrolls into view.
const NEAR_MARGIN = '600px 0px';
// After the page has loaded, an idle browser fetches the charts anyway, so printing or a full-page capture
// never finds an empty block.
const IDLE_TIMEOUT_MS = 3000;

/**
 * Runs `load` once, off the critical path (R20: the chart modules stay out of the Overview's eager script):
 * when `section` first comes within NEAR_MARGIN of the viewport, or when the browser is idle after the page
 * has loaded, whichever is first. It runs at once when the URL hash names an element inside `section` or the
 * browser has no IntersectionObserver. A failed load leaves one sentence in `body`.
 */
export function whenNear(section: HTMLElement, body: HTMLElement, load: () => Promise<void>): void {
  let observer: IntersectionObserver | null = null;
  let started = false;
  const run = () => {
    if (started) return;
    started = true;
    observer?.disconnect();
    load().catch(() => body.replaceChildren(emptyState('This chart could not load; reload the page to try again.')));
  };
  const hashId = decodeURIComponent(window.location.hash.slice(1));
  const target = hashId ? document.getElementById(hashId) : null;
  if ((target && section.contains(target)) || typeof IntersectionObserver === 'undefined') {
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
}
