// SPDX-License-Identifier: Apache-2.0
// Card P5b (Documents, intake). The From counsel list (#from-counsel): every file counsel sent into the room,
// newest first, with who sent it, when, its size, and whether it has reached the client's case files yet.
import { docHref, getJson, type CounselUpload } from './files-api.ts';
import { formatBytes } from './files-format.ts';
import { isoDay, syncStatus } from './documents-intake-rules.ts';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function statusIcon(state: 'waiting' | 'synced'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'docs-counsel__icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  // Synced: a check. Waiting: a clock face.
  path.setAttribute('d', state === 'synced' ? 'M3.5 8.5 6.5 11.5 12.5 4.5' : 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 5v3.25l2 1.25');
  svg.append(path);
  return svg;
}

function row(upload: CounselUpload): HTMLLIElement {
  const item = el('li', 'docs-counsel__item');
  const link = el('a', 'docs-counsel__name', upload.name);
  link.href = docHref(upload.id);
  const meta = el('p', 'docs-counsel__meta t-small');
  const from = upload.uploader_name ?? upload.uploaded_by ?? 'Counsel';
  meta.append(
    el('span', undefined, from),
    el('span', 'u-mono', isoDay(upload.uploaded_at)),
    el('span', 'u-num', formatBytes(upload.size)),
  );
  const status = syncStatus(upload.pulled);
  const chip = el('span', 'c-chip docs-counsel__status');
  chip.dataset.state = status.state;
  chip.append(statusIcon(status.state), el('span', undefined, status.label));
  item.append(link, meta, chip);
  return item;
}

/** The counsel upload list, which can be reloaded. */
export interface CounselList {
  /** Reloads the list; resolves to the number of files, or null when it could not be read. */
  refresh(): Promise<number | null>;
}

/** Fills `list` with the uploads; `note` holds the one-sentence empty or error state. */
export function createCounselList(list: HTMLElement, note: HTMLElement): CounselList {
  const refresh = async () => {
    list.setAttribute('aria-busy', 'true');
    const result = await getJson<{ uploads: CounselUpload[] }>('/api/uploads');
    list.removeAttribute('aria-busy');
    if (!result.ok) {
      list.replaceChildren();
      note.textContent = 'The counsel files did not load; reload the page to try again.';
      note.hidden = false;
      return null;
    }
    const uploads = result.value.uploads;
    list.replaceChildren(...uploads.map(row));
    note.textContent = 'Nothing from counsel yet.';
    note.hidden = uploads.length > 0;
    return uploads.length;
  };
  return { refresh };
}
