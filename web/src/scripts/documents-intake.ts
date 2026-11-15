// SPDX-License-Identifier: Apache-2.0
// Card P5b (Documents, intake). Renders into /documents/'s [data-docs-intake]: the From counsel and Send to client
// buttons, the upload queue, the From counsel list (#from-counsel, which /inbox/ redirects to) and the month
// heatmap. The heatmap draws into [data-docs-heatmap] when the page provides one (so the table's layout can
// place it), otherwise at the end of the slot. The table (card P5a) hears `docs:filter` {month, counsel} and
// `docs:uploaded` on its slot (ruling R45, documents-intake-dates.ts): opening From counsel filters it to counsel
// uploads, and a month on the heatmap filters it by document date.
import { createCounselList } from './documents-intake-counsel.ts';
import { DOCS_FILTER_EVENT, docsTarget, type DocsFilterDetail } from './documents-intake-dates.ts';
import { mountHeatmap } from './documents-intake-heat.ts';
import { UPLOAD_ACCEPT, UPLOAD_LIMITS } from './documents-intake-rules.ts';
import { createQueue } from './documents-intake-upload.ts';

const COUNSEL_ID = 'from-counsel';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function uploadIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'docs-intake__icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M8 10.5V2.5M4.75 5.75 8 2.5l3.25 3.25M2.75 10.5v3h10.5v-3');
  svg.append(path);
  return svg;
}

interface Parts {
  toggle: HTMLButtonElement;
  count: HTMLElement;
  send: HTMLButtonElement;
  input: HTMLInputElement;
  queue: HTMLUListElement;
  panel: HTMLElement;
  list: HTMLUListElement;
  note: HTMLElement;
  heat: HTMLElement;
  heatNote: HTMLElement;
}

function build(root: HTMLElement): Parts {
  const actions = el('div', 'docs-intake__actions');
  const toggle = el('button', 'c-button docs-intake__toggle', 'From counsel');
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', COUNSEL_ID);
  toggle.setAttribute('aria-expanded', 'false');
  const count = el('span', 'docs-intake__count u-num');
  count.hidden = true;
  toggle.append(count);
  const send = el('button', 'c-button c-button--primary');
  send.type = 'button';
  send.dataset.needs = 'upload';
  send.append(uploadIcon(), el('span', undefined, 'Send to client'));
  const input = el('input', 'u-vh');
  input.type = 'file';
  input.multiple = true;
  input.accept = UPLOAD_ACCEPT;
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  actions.append(toggle, send, input);

  const queue = el('ul', 'docs-intake__queue');
  queue.setAttribute('aria-live', 'polite');
  queue.setAttribute('aria-label', 'Files being sent to the client');

  const panel = el('section', 'docs-counsel');
  panel.id = COUNSEL_ID;
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', `${COUNSEL_ID}-title`);
  const head = el('div', 'docs-counsel__head');
  const title = el('h2', 'docs-counsel__title t-h3', 'From counsel');
  title.id = `${COUNSEL_ID}-title`;
  title.tabIndex = -1;
  // The accepted types and size limit are about sending, so a member who cannot upload never sees them.
  const limits = el('p', 'docs-counsel__limits t-caption', UPLOAD_LIMITS);
  limits.dataset.needs = 'upload';
  head.append(title, limits);
  const list = el('ul', 'docs-counsel__list');
  const note = el('p', 'docs-counsel__note t-small');
  note.hidden = true;
  panel.append(head, list, note);

  const heat = document.querySelector<HTMLElement>('[data-docs-heatmap]') ?? el('div', 'docs-intake__heat');
  const heatNote = el('p', 'docs-intake__heat-note t-small');
  heatNote.hidden = true;
  heat.append(heatNote);
  root.classList.add('docs-intake');
  root.replaceChildren(actions, queue, panel);
  if (!heat.isConnected) root.append(heat);
  return { toggle, count, send, input, queue, panel, list, note, heat, heatNote };
}

/**
 * Opens or closes the From counsel list. A click also tells the table (`onToggle`); a link to #from-counsel
 * brings the list into view, and the table reads that hash itself.
 */
function wireCounsel(parts: Parts, onToggle: (open: boolean) => void): () => Promise<void> {
  const counsel = createCounselList(parts.list, parts.note);
  const show = (open: boolean, focus = false) => {
    parts.panel.hidden = !open;
    parts.toggle.setAttribute('aria-expanded', String(open));
    if (open && focus) {
      parts.panel.scrollIntoView({ block: 'start' });
      parts.panel.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    }
  };
  parts.toggle.addEventListener('click', () => {
    show(parts.panel.hidden !== false);
    onToggle(!parts.panel.hidden);
  });
  const fromHash = () => {
    if (location.hash === `#${COUNSEL_ID}`) show(true, true);
  };
  window.addEventListener('hashchange', fromHash);
  fromHash();
  return async () => {
    const n = await counsel.refresh();
    parts.count.textContent = n ? String(n) : '';
    parts.count.hidden = !n;
    parts.toggle.setAttribute('aria-label', n ? `From counsel, ${n} ${n === 1 ? 'file' : 'files'}` : 'From counsel');
  };
}

/** The file picker, plus files dropped anywhere on the page's main column. */
function wireSend(parts: Parts, root: HTMLElement, refresh: () => Promise<void>): void {
  const queue = createQueue(parts.queue, () => void refresh());
  parts.send.addEventListener('click', () => parts.input.click());
  parts.input.addEventListener('change', () => {
    if (parts.input.files) queue.add(Array.from(parts.input.files));
    parts.input.value = '';
  });
  const zone = document.querySelector<HTMLElement>('main') ?? root;
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  zone.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    root.dataset.drop = 'over';
  });
  zone.addEventListener('dragleave', (event) => {
    if (!zone.contains(event.relatedTarget as Node | null)) delete root.dataset.drop;
  });
  zone.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    delete root.dataset.drop;
    if (event.dataTransfer?.files.length) queue.add(Array.from(event.dataTransfer.files));
  });
}

const root = document.querySelector<HTMLElement>('[data-docs-intake]');
if (root) {
  const parts = build(root);
  const counselOpen = () => !parts.panel.hidden;
  const heat = mountHeatmap(parts.heat, parts.heatNote, counselOpen);
  const refresh = wireCounsel(parts, (open) => {
    const detail: DocsFilterDetail = { month: heat.month(), counsel: open };
    docsTarget().dispatchEvent(new CustomEvent<DocsFilterDetail>(DOCS_FILTER_EVENT, { detail, bubbles: true }));
  });
  wireSend(parts, root, refresh);
  void refresh();
}
