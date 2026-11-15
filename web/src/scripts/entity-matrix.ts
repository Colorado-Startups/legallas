// SPDX-License-Identifier: Apache-2.0
// The Entity choice page (src/pages/entity.astro): GET /api/entity-matrix drawn as a table, a row per factor and a column
// per form. A statute the law library holds links to its official text, dated; one it doesn't hold says so. On a phone the
// rows stack as cards, each cell labelled with its form (data-label, entity-matrix.css). Built with el(), never innerHTML.
import type { ResolvedCite, ResolvedMatrix } from '../../worker/entity-matrix.ts';
import { el } from './dom-el.ts';
import { ROOM_FETCH_HEADERS, showSessionEnded } from './session-ended.ts';

const part = (name: string) => document.querySelector<HTMLElement>(`[data-em-${name}]`)!; // safe: entity.astro renders every part
const status = part('status');

const LAW_NOTES: Readonly<Record<ResolvedMatrix['law'], string | null>> = {
  on: null,
  off: 'The law library is off in this room, so no statute is dated.',
  empty: 'The law library holds no statutes yet, so none is dated.',
};

function citeItem({ cite, law }: ResolvedCite): HTMLLIElement {
  if (!law) return el('li', { class: 'em-cite em-cite--missing' }, el('span', { class: 'em-cite__name' }, cite), el('span', { class: 'em-cite__date' }, 'not in the law library'));
  // The catalog's URL becomes a link only when it is https; anything else shows as text, still dated.
  const name = law.url.startsWith('https://')
    ? el('a', { class: 'em-cite__name', href: law.url, rel: 'noopener noreferrer', target: '_blank', title: law.title }, cite)
    : el('span', { class: 'em-cite__name', title: law.title }, cite);
  return el('li', { class: 'em-cite' }, name, el('span', { class: 'em-cite__date' }, `as of ${law.retrieved}`));
}

function render(matrix: ResolvedMatrix): void {
  const head = part('head');
  head.replaceChildren(el('th', { scope: 'col' }, 'Factor'), ...matrix.forms.map((form) => el('th', { scope: 'col' }, form.name)));
  part('rows').replaceChildren(
    ...matrix.factors.map((factor) =>
      el(
        'tr',
        { id: factor.id },
        el('th', { scope: 'row', class: 'em-factor' }, factor.factor),
        ...matrix.forms.map((form) => {
          const cell = factor.cells[form.id];
          return el('td', { 'data-label': form.name }, el('p', { class: 'em-text' }, cell.text), el('ul', { class: 'em-cites' }, ...cell.cites.map(citeItem)));
        }),
      ),
    ),
  );
  part('count').textContent = `${matrix.cited} of ${matrix.total} statutes dated from the law library`;
  const bar = part('progress') as HTMLProgressElement;
  bar.max = Math.max(matrix.total, 1);
  bar.value = matrix.cited;
  const note = LAW_NOTES[matrix.law];
  part('law').hidden = note === null;
  part('law').textContent = note ?? '';
  status.textContent = '';
  part('view').hidden = false;
}

async function load(): Promise<void> {
  try {
    const response = await fetch('/api/entity-matrix', { credentials: 'same-origin', headers: ROOM_FETCH_HEADERS });
    if (response.status === 401) showSessionEnded();
    if (!response.ok) throw new Error(String(response.status));
    render((await response.json()) as ResolvedMatrix);
  } catch {
    status.textContent = 'The matrix did not load. Reload the page to try again.';
  }
}

void load();
