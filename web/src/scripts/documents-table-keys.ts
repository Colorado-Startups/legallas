// SPDX-License-Identifier: Apache-2.0
// Keyboard and pointer for the Documents table (card P5a; DESIGN.md section 11): `/` focuses the filter, j and k
// move the row focus, Enter or a click on a row opens the document, Esc in the filter clears it, then leaves it.
// The single-key shortcuts work only while focus is inside the Documents work area (WCAG 2.1.4, ruling R80).
import { docHref } from './files-api.ts';

/** The page elements the table's single-key shortcuts act on. */
export interface KeyTargets {
  /** The work area (filter, heatmap and table); the single-key shortcuts listen here, not on the document. */
  region: HTMLElement;
  table: HTMLElement;
  body: HTMLTableSectionElement;
  filter: HTMLInputElement;
  /** Document ids in the order the table shows them now. */
  visibleIds: () => string[];
}

/** The row j (+1) or k (-1) moves to: the first row from nothing, and it stops at either end. */
export function stepIndex(current: number, delta: 1 | -1, length: number): number {
  if (length === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return Math.min(length - 1, Math.max(0, current + delta));
}

/** True while a person is typing, so single-letter keys stay letters. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** The action a single-key shortcut asks for: focus the filter, or step to the next or previous row. */
export type KeyAction = 'filter' | 'next' | 'prev' | null;

/** The single-key shortcut a keydown asks for: none outside the work area, while typing, or with a modifier. */
export function keyAction(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>, typing: boolean, inRegion: boolean,
): KeyAction {
  if (!inRegion || typing || event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === '/') return 'filter';
  if (event.key === 'j') return 'next';
  if (event.key === 'k') return 'prev';
  return null;
}

function rowFor(body: HTMLTableSectionElement, id: string): HTMLTableRowElement | null {
  return [...body.rows].find((tr) => tr.dataset.id === id) ?? null;
}

function select(body: HTMLTableSectionElement, id: string): void {
  for (const tr of body.querySelectorAll('tr[aria-selected]')) tr.removeAttribute('aria-selected');
  const tr = rowFor(body, id);
  if (!tr) return;
  tr.setAttribute('aria-selected', 'true');
  tr.focus({ preventScroll: true });
  tr.scrollIntoView({ block: 'nearest' });
}

function open(id: string): void {
  location.assign(docHref(id));
}

/** Binds the single-key shortcuts in the work area to the filter and the table rows. */
export function bindKeys(targets: KeyTargets): void {
  const { region, body, filter, visibleIds } = targets;
  let selected = '';

  const move = (delta: 1 | -1) => {
    const ids = visibleIds();
    const next = stepIndex(ids.indexOf(selected), delta, ids.length);
    if (next < 0) return;
    selected = ids[next]!;
    select(body, selected);
  };

  region.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    if (event.target === filter && event.key === 'Escape') {
      if (filter.value) {
        filter.value = '';
        filter.dispatchEvent(new Event('input'));
      } else filter.blur();
      return;
    }
    const action = keyAction(event, isTyping(event.target), region.contains(event.target as Node));
    if (action === 'filter') {
      event.preventDefault();
      filter.focus();
      filter.select();
    } else if (action) {
      event.preventDefault();
      move(action === 'next' ? 1 : -1);
    } else if (isTyping(event.target)) {
      return;
    } else if (event.key === 'Enter' && event.target instanceof HTMLTableRowElement && event.target.dataset.id) {
      event.preventDefault();
      open(event.target.dataset.id);
    }
  });

  // A click anywhere on a row opens it, except on its own controls (the number link already opens it).
  body.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('a, button, input, label')) return;
    const tr = target.closest<HTMLTableRowElement>('tr[data-id]');
    if (!tr || window.getSelection()?.toString()) return;
    open(tr.dataset.id!);
  });

  // Tabbing onto a row's link moves the selection with it, so j and k continue from there.
  body.addEventListener('focusin', (event) => {
    const tr = (event.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-id]');
    if (!tr || tr.dataset.id === selected) return;
    selected = tr.dataset.id!;
    for (const other of body.querySelectorAll('tr[aria-selected]')) other.removeAttribute('aria-selected');
    tr.setAttribute('aria-selected', 'true');
  });
}
