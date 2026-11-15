// SPDX-License-Identifier: Apache-2.0
// Card P4 (Claims & Proof). The Matrix view's aside: the selected cell (what each document shows for that
// element, with its cite chips; a cite note is the chip's title, R33), then the gaps (elements with no proof yet,
// with the nearest document the record offers) and the elements that rest on circumstantial proof alone.

import { authoritiesOf, byStrength, roman, type ClaimsModel, type ElementRef } from './claims-model.ts';
import type { CellSelection } from './claims-matrix.ts';
import { citeChip, el, openCite, ring, strengthWord } from './claims-dom.ts';

/** Fills the detail card for a selection, or its one-line prompt when nothing is selected. */
export function showDetail(host: HTMLElement, selection: CellSelection | null): void {
  host.replaceChildren();
  if (!selection) {
    el('p', { class: 'claims-detail__prompt' }, host, 'Choose a ring to see what that document shows.');
    return;
  }
  const { claim, element, items, cite } = selection;
  const head = el('div', { class: 'claims-detail__head' }, host);
  const index = claim.elements.indexOf(element) + 1;
  el('p', { class: 't-label claims-detail__where' }, head, `Count ${roman(claim.count)}, element ${index}`);
  strengthWord(items[0].strength, head);
  el('h2', { class: 't-h3 claims-detail__title' }, host, element.text);
  const authority = element.authority || authoritiesOf(claim)[0];
  if (authority) el('p', { class: 'claims-detail__authority' }, host, authority);
  const list = el('ul', { class: 'claims-proof-list' }, host);
  const others = byStrength(element.proof.filter((p) => p.strength !== 'gap' && !items.includes(p)));
  for (const proof of [...items, ...others]) {
    const li = el('li', { class: 'claims-proof-list__item', 'data-current': String(items.includes(proof)) }, list);
    citeChip(proof.cite, li, proof.note);
    if (proof.note) el('span', { class: 'claims-proof-list__note' }, li, proof.note);
  }
  const open = el('button', { type: 'button', class: 'c-button' }, host, 'Open at the page');
  open.addEventListener('click', () => openCite(cite.doc, cite.page, open));
}

/** The gap callouts and the circumstantial-only list. */
export function renderGaps(host: HTMLElement, model: ClaimsModel): void {
  host.replaceChildren();
  const head = el('div', { class: 'claims-gaps__head' }, host);
  el('h2', { class: 't-label claims-gaps__title' }, head, 'Gaps');
  el('span', { class: 'claims-gaps__count u-num' }, head, String(model.gaps.length));
  if (model.gaps.length === 0) {
    el('p', { class: 'claims-gaps__none' }, host, 'Every element has proof in the record.');
  } else {
    const list = el('ul', { class: 'claims-gap-list' }, host);
    for (const gap of model.gaps) gapItem(gap, list);
  }
  if (model.circumstantialOnly.length === 0) return;
  el('h2', { class: 't-label claims-gaps__title claims-gaps__sub' }, host, 'Circumstantial only');
  const list = el('ul', { class: 'claims-circ-list' }, host);
  for (const ref of model.circumstantialOnly) {
    const li = el('li', {}, list);
    el('span', { class: 'u-mono claims-circ-list__label' }, li, ref.label);
    el('span', {}, li, ref.element.text);
  }
}

/** One gap: the element, then what the record comes nearest to, each with its cite. */
export function gapItem(gap: ElementRef, parent: Element): HTMLElement {
  const li = el('li', { class: 'claims-gap' }, parent);
  ring('gap', 16, el('span', { class: 'claims-gap__mark' }, li));
  const body = el('div', { class: 'claims-gap__body' }, li);
  const title = el('p', { class: 'claims-gap__title' }, body);
  el('span', { class: 'u-mono' }, title, gap.label);
  title.append(` ${gap.element.text}`);
  const nearest = gap.element.proof.filter((p) => p.strength === 'gap');
  const notes = [...new Set(nearest.map((p) => p.note).filter((n): n is string => Boolean(n)))];
  el('p', { class: 'claims-gap__note' }, body, notes.length ? notes.join(' ') : 'No document in the record yet.');
  if (nearest.length) {
    const cites = el('div', { class: 'claims-cites' }, body);
    for (const p of nearest) citeChip(p.cite, cites, p.note);
  }
  return li;
}
