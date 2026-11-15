// SPDX-License-Identifier: Apache-2.0
// Card P5b (Documents, intake). "Send to client": each file goes up as a raw PUT to /api/uploads (XMLHttpRequest,
// for the progress bar), one at a time, into a queue of rows that show the name, size, progress and a Cancel
// button, then one plain sentence when it lands or fails. The Worker streams the body to R2 and checks it again.
import { formatBytes } from './files-format.ts';
import { DOCS_UPLOADED_EVENT, docsTarget, type DocsUploadedDetail } from './documents-intake-dates.ts';
import { errorCode, messageFor, percent, precheck, uploadedId } from './documents-intake-rules.ts';

type Outcome = { ok: true; id: string } | { ok: false; code: string };

interface Row {
  item: HTMLLIElement;
  label: HTMLElement;
  bar: HTMLElement;
  value: HTMLElement;
  status: HTMLElement;
  action: HTMLButtonElement;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fileIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', 'docs-intake__file');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M5 2.75h6.5L15.25 6.5v10.75H5Z M11.5 2.75V6.5h3.75');
  svg.append(path);
  return svg;
}

function buildRow(file: File): Row {
  const item = el('li', 'docs-intake__item');
  item.dataset.state = 'waiting';
  const label = el('p', 'docs-intake__name');
  label.append(el('span', 'docs-intake__verb', 'Sending to client: '), el('strong', undefined, file.name));
  const size = el('span', 'docs-intake__size u-num', formatBytes(file.size));
  const track = el('div', 'docs-intake__track');
  const bar = el('div', 'docs-intake__bar');
  track.append(bar);
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', `Sending ${file.name}`);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', '0');
  const value = el('span', 'docs-intake__pct u-num', '0%');
  const status = el('p', 'docs-intake__status t-small');
  const action = el('button', 'c-button c-button--quiet docs-intake__action', 'Cancel');
  action.type = 'button';
  item.append(fileIcon(), label, size, track, value, action, status);
  return { item, label, bar: track, value, status, action };
}

function setProgress(row: Row, pct: number): void {
  row.bar.setAttribute('aria-valuenow', String(pct));
  row.bar.style.setProperty('--progress', `${pct}%`);
  row.value.textContent = `${pct}%`;
}

function finish(row: Row, outcome: Outcome, name: string, onDismiss: () => void): void {
  row.item.dataset.state = outcome.ok ? 'done' : outcome.code === 'canceled' ? 'canceled' : 'error';
  const verb = row.label.querySelector('.docs-intake__verb');
  if (verb) verb.textContent = outcome.ok ? 'Sent to client: ' : 'Not sent: ';
  if (outcome.ok) setProgress(row, 100);
  row.status.textContent = outcome.ok ? 'In the room now; it reaches the client files at the next sync.' : messageFor(outcome.code);
  row.action.textContent = 'Dismiss';
  row.action.setAttribute('aria-label', `Dismiss ${name}`);
  row.action.onclick = onDismiss;
}

/** PUTs one file. `abort` is filled in so Cancel can stop it. */
function send(file: File, row: Row, abort: { run: () => void }): Promise<Outcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    // The filename goes in a header, never the URL: request URLs can reach Cloudflare's logs.
    xhr.open('PUT', '/api/uploads');
    xhr.setRequestHeader('X-Upload-Name', encodeURIComponent(file.name));
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) setProgress(row, percent(event.loaded, event.total));
    });
    xhr.addEventListener('load', () => {
      const id = xhr.status === 201 ? uploadedId(xhr.responseText) : null;
      resolve(id ? { ok: true, id } : { ok: false, code: errorCode(xhr.responseText) ?? '' });
    });
    xhr.addEventListener('error', () => resolve({ ok: false, code: 'network' }));
    xhr.addEventListener('abort', () => resolve({ ok: false, code: 'canceled' }));
    abort.run = () => xhr.abort();
    xhr.send(file);
  });
}

/** The upload queue that takes files to send. */
export interface UploadQueue {
  add(files: Iterable<File>): void;
}

/**
 * The queue in `list`. Files go one at a time, so a large file does not starve the others; a queued file can be
 * canceled before it starts. `onLanded` runs after each upload that lands (the counsel list reloads).
 */
export function createQueue(list: HTMLElement, onLanded: (id: string) => void): UploadQueue {
  let chain = Promise.resolve();
  const add = (file: File) => {
    const row = buildRow(file);
    const dismiss = () => row.item.remove();
    list.append(row.item);
    const refused = precheck(file);
    if (refused) return finish(row, { ok: false, code: refused }, file.name, dismiss);
    let canceled = false;
    const abort = { run: () => { canceled = true; } };
    row.action.setAttribute('aria-label', `Cancel ${file.name}`);
    row.action.onclick = () => abort.run();
    chain = chain.then(async () => {
      if (canceled) return finish(row, { ok: false, code: 'canceled' }, file.name, dismiss);
      row.item.dataset.state = 'sending';
      const outcome = await send(file, row, abort);
      finish(row, outcome, file.name, dismiss);
      if (!outcome.ok) return;
      onLanded(outcome.id);
      const detail: DocsUploadedDetail = { id: outcome.id };
      docsTarget().dispatchEvent(new CustomEvent<DocsUploadedDetail>(DOCS_UPLOADED_EVENT, { detail, bubbles: true }));
    });
  };
  return { add: (files) => { for (const file of files) add(file); } };
}
