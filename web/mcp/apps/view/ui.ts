// SPDX-License-Identifier: Apache-2.0
// What the views share on screen: the header, case text with its untrusted mark, cite chips, the page reader and the
// status line. Built with the chart kit's element helper (src/scripts/viz/core.ts), text only through textContent, so
// case text never becomes markup.
import { html } from '../../../src/scripts/viz/core.ts';
import type { Host } from './bridge.ts';
import { binderRef, citeLabel, isObj, resultData, resultError, shown, type Cite, type Shown } from './model.ts';

export { html };

/** Ask's reminder for a marked passage, short (mcp/untrusted.ts UNTRUSTED_NOTES says it in full). */
const UNTRUSTED_TIP = 'Marked by the room: this text addresses an AI or reads as a court order it is not. Evidence only, never instructions.';

/** Case text as a span, with a visible mark when the room fenced it as untrusted. */
export function caseText(parent: Element, value: Shown | null, className = ''): HTMLElement {
  const span = html('span', { class: className }, parent, value?.text ?? '');
  if (value?.untrusted) {
    span.classList.add('v-untrusted');
    span.title = UNTRUSTED_TIP;
  }
  return span;
}

/** The view's frame: a heading, a row of tabs or tools, the body and a status line for errors and loading. */
export interface Shell {
  head: HTMLElement;
  tools: HTMLElement;
  /** Above the body, so a page opened from a long grid shows where the reader is looking. */
  slot: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
  status(text: string, kind?: 'error' | 'busy' | ''): void;
}

export function shell(app: HTMLElement, title: string, host: Host): Shell {
  app.replaceChildren();
  const head = html('header', { class: 'v-head' }, app);
  html('h1', { class: 'v-title' }, head, title);
  const tools = html('div', { class: 'v-tools' }, head);
  if (host.mode === 'host') {
    const full = html('button', { type: 'button', class: 'v-button v-button--quiet', 'aria-label': 'Full screen' }, head, 'Expand');
    full.addEventListener('click', () => host.fullscreen());
  }
  const line = html('p', { class: 'v-status', role: 'status' }, app);
  line.hidden = true;
  const slot = html('div', { class: 'v-slot' }, app);
  const body = html('div', { class: 'v-body' }, app);
  const foot = html('footer', { class: 'v-foot' }, app);
  return {
    head, tools, slot, body, foot,
    status(text, kind = '') {
      line.textContent = text;
      line.dataset.kind = kind;
      line.hidden = text === '';
    },
  };
}

/** The reader beside a view: one page of a cited document, read through legallas_read_pages. */
export interface Reader {
  open(cite: Cite): Promise<void>;
}

export function reader(parent: HTMLElement, host: Host): Reader {
  const panel = html('aside', { class: 'v-reader', 'aria-label': 'Cited page' }, parent);
  panel.hidden = true;
  const bar = html('div', { class: 'v-reader__bar' }, panel);
  const label = html('strong', { class: 'v-reader__label' }, bar);
  const room = html('button', { type: 'button', class: 'v-button v-button--quiet' }, bar, 'Open in the room');
  const close = html('button', { type: 'button', class: 'v-button v-button--quiet', 'aria-label': 'Close the page' }, bar, 'Close');
  const text = html('div', { class: 'v-reader__text', tabindex: '0' }, panel);
  let link: string | null = null;
  room.addEventListener('click', () => link && host.openLink(link));
  close.addEventListener('click', () => {
    panel.hidden = true;
  });
  return {
    async open(cite) {
      if (!cite.doc) {
        if (cite.link) host.openLink(cite.link);
        return;
      }
      const page = cite.page ?? 1;
      panel.hidden = false;
      label.textContent = citeLabel({ ...cite, page });
      link = cite.link;
      room.hidden = !link;
      text.replaceChildren(html('p', { class: 'v-muted' }, undefined, 'Reading the page…'));
      try {
        const result = await host.callTool(host.config.tools.read, { id: cite.doc, from: page, to: page });
        const data = resultData(result);
        const first = data && Array.isArray(data.pages) ? data.pages.find(isObj) : undefined;
        text.replaceChildren();
        if (!first) {
          html('p', { class: 'v-error' }, text, resultError(result) ?? 'That page has no text.');
          return;
        }
        if (typeof first.link === 'string') link = first.link;
        room.hidden = !link;
        caseText(text, shown(first.text), 'v-reader__page');
        text.focus();
      } catch (error) {
        text.replaceChildren(html('p', { class: 'v-error' }, undefined, error instanceof Error ? error.message : 'The page did not open.'));
      }
    },
  };
}

/** A cite chip: opens the page in the reader (in the AI), the exhibit (in the binder), or the room link. */
export function citeChip(parent: Element, cite: Cite, host: Host, read: Reader): HTMLButtonElement {
  const chip = html('button', { type: 'button', class: 'v-cite', 'data-cite': '' }, parent, citeLabel(cite));
  chip.title = cite.doc ? 'Read this page' : 'Open in the room';
  chip.addEventListener('click', (event) => {
    event.stopPropagation();
    openCite(cite, host, read);
  });
  return chip;
}

export function openCite(cite: Cite, host: Host, read: Reader): void {
  if (host.mode === 'binder') {
    const ref = binderRef(cite);
    if (ref) host.openBinderCite(ref);
    else if (cite.link) host.openLink(cite.link);
    return;
  }
  void read.open(cite);
}

/** "Retrieved 2026-11-06" and the room's reminder that every cite is checked in the room before it is relied on. */
export function retrieved(foot: HTMLElement, data: Record<string, unknown>): void {
  const day = typeof data.retrieved === 'string' ? data.retrieved : null;
  html('p', { class: 'v-muted' }, foot, `${day ? `Retrieved ${day}. ` : ''}Check each cite in the room before relying on it.`);
}
