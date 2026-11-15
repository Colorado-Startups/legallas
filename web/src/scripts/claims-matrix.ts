// SPDX-License-Identifier: Apache-2.0
// Card P4 (Claims & Proof). The Matrix view: counts as pleaded, their elements down the side, the documents that
// carry proof across, a target ring in each cell for that document's strongest proof of that element, and the
// strongest proof for the element repeated as a word. A cell is a real link to the cited page; a plain click or
// Enter selects it instead, and the aside (claims-aside.ts) shows what the document shows. Arrow keys move
// through the grid with one Tab stop (nextCell from viz/matrix.ts).

import { controlPrefix, formatControl, type ServedCite } from './matter-api.ts';
import {
  authoritiesOf, authorityPlacement, byStrength, partiesAgainst, roman, type ClaimsModel, type RoomClaim,
  type RoomElement, type RoomProof,
} from './claims-model.ts';
import { citeText, el, partyChip, ring, strengthWord, STRENGTH_WORDS } from './claims-dom.ts';
import { nextCell, type MatrixRow } from './viz/matrix.ts';
import { citeHref } from './viz/tile.ts';
import type { ServedMatter } from './matter-api.ts';

/** A selected matrix cell: its claim and element. */
export interface CellSelection {
  claim: RoomClaim;
  element: RoomElement;
  /** "III.1" */
  label: string;
  /** This document's proof items for the element, strongest first. */
  items: RoomProof[];
  cite: ServedCite;
}

interface Focusable { link: HTMLAnchorElement; row: number; col: number }

/** Draws the grid into `host`; `onSelect` hears each cell a person chooses. */
export function renderMatrix(
  host: HTMLElement, model: ClaimsModel, matter: ServedMatter, onSelect: (s: CellSelection | null) => void,
): void {
  const wrap = el('div', { class: 'claims-matrix-wrap' }, host);
  const table = el('table', { class: 'claims-matrix' }, wrap);
  el('caption', { class: 'u-vh' }, table, 'Each element of each count against the documents that prove it');
  drawHead(table, model);
  const focusables: Focusable[] = [];
  let current: { link: HTMLAnchorElement; tr: HTMLElement } | null = null;
  const choose = (link: HTMLAnchorElement, tr: HTMLElement, selection: CellSelection) => {
    current?.link.removeAttribute('aria-current');
    current?.tr.removeAttribute('aria-selected');
    current = { link, tr };
    link.setAttribute('aria-current', 'true');
    tr.setAttribute('aria-selected', 'true');
    onSelect(selection);
  };
  let rowIndex = 0;
  for (const group of model.matrix.groups) {
    const claim = group.claim as RoomClaim;
    const body = el('tbody', { class: 'claims-matrix__group' }, table);
    drawCountRow(body, claim, matter, model.columns.length + 2);
    group.rows.forEach((row, i) => {
      drawElementRow(body, claim, row, i, rowIndex, focusables, choose);
      rowIndex += 1;
    });
  }
  wireKeys(focusables);
}

function drawHead(table: HTMLTableElement, model: ClaimsModel): void {
  const tr = el('tr', {}, el('thead', {}, table));
  el('th', { scope: 'col', class: 'claims-matrix__element' }, tr, 'Element');
  const prefix = controlPrefix();
  for (const col of model.columns) {
    const control = formatControl(prefix, col.control);
    const th = el('th', { scope: 'col', class: 'claims-matrix__doc', title: col.type ?? undefined }, tr);
    el('span', { class: 'claims-matrix__num u-mono' }, th, control ? control.slice(prefix.length + 1) : 'No number');
    if (control) el('span', { class: 'u-vh' }, th, ` (${control})`);
    if (col.type) el('span', { class: 'claims-matrix__type' }, th, col.type);
  }
  el('th', { scope: 'col', class: 'claims-matrix__best' }, tr, 'Strongest');
}

function drawCountRow(body: HTMLElement, claim: RoomClaim, matter: ServedMatter, span: number): void {
  const tr = el('tr', { class: 'claims-matrix__count' }, body);
  const th = el('th', { scope: 'colgroup', colspan: String(span) }, tr);
  const line = el('div', { class: 'claims-count-head' }, th);
  el('span', { class: 'claims-count-head__num u-mono' }, line, roman(claim.count));
  el('span', { class: 'claims-count-head__label' }, line, claim.label);
  const against = el('span', { class: 'claims-count-head__against' }, line);
  el('span', { class: 'u-vh' }, against, 'Against: ');
  for (const party of partiesAgainst(claim, matter)) partyChip(party, against);
  if (authorityPlacement(claim) === 'count') {
    const [authority] = authoritiesOf(claim);
    if (authority) el('span', { class: 'claims-count-head__authority' }, line, authority);
  }
}

function drawElementRow(
  body: HTMLElement, claim: RoomClaim, row: MatrixRow, index: number, rowIndex: number, focusables: Focusable[],
  choose: (link: HTMLAnchorElement, tr: HTMLElement, s: CellSelection) => void,
): void {
  const element = row.element as RoomElement;
  const label = `${roman(claim.count)}.${index + 1}`;
  const tr = el('tr', {}, body);
  const th = el('th', { scope: 'row', class: 'claims-matrix__element' }, tr);
  el('span', { class: 'claims-matrix__label u-mono' }, th, label);
  el('span', { class: 'claims-matrix__text' }, th, element.text);
  if (authorityPlacement(claim) === 'element' && element.authority) {
    el('span', { class: 'claims-matrix__authority' }, th, element.authority);
  }
  row.cells.forEach((cell, col) => {
    const td = el('td', { class: 'claims-matrix__cell' }, tr);
    if (!cell) return;
    const items = byStrength(cell.items as RoomProof[]);
    const cite = items[0].cite;
    const link = el('a', {
      class: 'c-proof', 'data-strength': cell.strongest, href: citeHref(cite), tabindex: '-1',
      'aria-label': `${STRENGTH_WORDS[cell.strongest]} proof of ${label}, ${citeText(cite)}`,
    }, td);
    ring(cell.strongest, 20, link);
    const note = cite.note ?? items[0].note;
    if (note) link.title = note;
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      choose(link, tr, { claim, element, label, items, cite });
    });
    focusables.push({ link, row: rowIndex, col });
  });
  strengthWord(row.strongest, el('td', { class: 'claims-matrix__best' }, tr));
}

function wireKeys(focusables: Focusable[]): void {
  focusables[0]?.link.setAttribute('tabindex', '0');
  const cells = focusables.map(({ row, col }) => ({ row, col }));
  focusables.forEach(({ link }, i) => link.addEventListener('keydown', (event) => {
    let to = event.key.startsWith('Arrow') ? nextCell(cells, i, event.key) : -1;
    if (event.key === 'Home') to = 0;
    if (event.key === 'End') to = focusables.length - 1;
    if (to < 0 || to === i) return;
    event.preventDefault();
    focusables.forEach((f, j) => f.link.setAttribute('tabindex', j === to ? '0' : '-1'));
    focusables[to].link.focus();
  }));
}
