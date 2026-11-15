// SPDX-License-Identifier: Apache-2.0
// The complaint brief, the claims map: one row per count the track would plead, its elements across, and in each
// element cell the target ring of the strongest proof the record has for it (direct, corroborating,
// circumstantial), repeated as a word. A cell with no proof wears the fog (c-fog) and reads "Not yet in the
// record", with what is missing when the record says. A click on a cell opens its cite in the exhibit pane. The
// Table toggle shows the same map as rows. Strength is never a color scale or a number.
import { guideLook, guideSend } from '../guide-bus.ts';
import { PROOF_WORDS } from '../proof-list-model.ts';
import { citeChip, citeText, el } from '../track-dom.ts';
import { createFrame, fillTable } from '../viz/core.ts';
import { ringSvg } from '../viz/ring.ts';
import { cardOpens, prose, type Terms } from './dom.ts';
import { againstLine, countLine, COUNT_KIND_WORDS, mapLabel, type ClaimsMap, type MapCell, type MapRow } from './model.ts';

const MAX_COLUMNS = 4;
const STRENGTHS = ['direct', 'corroborating', 'circumstantial', 'gap'] as const;

function meter(map: ClaimsMap, parent: Element): void {
  const block = el('p', { class: 'c-meter brief-map__meter', 'data-total': String(map.total) }, parent);
  const pips = el('span', { class: 'c-meter__pips', 'aria-hidden': 'true' }, block);
  for (const strength of map.pips) el('span', { class: 'c-meter__pip', 'data-strength': strength }, pips);
  el('span', { class: 'c-meter__label' }, block, mapLabel(map));
}

function legend(parent: Element): void {
  const list = el('ul', { class: 'viz-legend brief-map__legend', 'aria-label': 'Proof strength' }, parent);
  for (const strength of STRENGTHS) {
    const item = el('li', { class: 'viz-legend__item' }, list);
    ringSvg(strength, 16, item);
    el('span', {}, item, PROOF_WORDS[strength]);
  }
}

function cell(row: MapRow, item: MapCell, parent: Element, terms: Terms): void {
  const gap = item.strength === 'gap';
  const li = el('li', {
    class: gap ? 'brief-map__cell c-fog' : 'brief-map__cell', 'data-state': gap ? 'gap' : undefined, 'data-strength': item.strength,
  }, parent);
  const proof = el('p', { class: 'brief-map__proof' }, li);
  ringSvg(item.strength, 20, proof);
  el('span', {}, proof, PROOF_WORDS[item.strength]);
  const text = el('p', { class: 'brief-map__text' }, li);
  el('span', { class: 'brief-map__n', 'aria-hidden': 'true' }, text, String(item.n));
  el('span', { class: 'u-vh' }, text, `Element ${item.n}: `);
  prose('span', {}, text, item.text, terms);
  if (item.note) el('p', { class: 'brief-map__note t-small' }, li, item.note);
  if (item.cite) {
    const chip = citeChip(item.cite, el('p', { class: 'brief-map__cite' }, li), item.note);
    chip.setAttribute('aria-label', `${citeText(item.cite)}: ${PROOF_WORDS[item.strength].toLowerCase()} for ${row.title}, element ${item.n}`);
    cardOpens(li, chip);
  }
  li.addEventListener('pointerenter', () => (gap ? guideSend({ type: 'gap' }) : guideLook(li)));
}

function countRow(row: MapRow, parent: Element, terms: Terms): void {
  const li = el('li', { class: 'brief-map__count' }, parent);
  const head = el('div', { class: 'brief-map__head' }, li);
  el('h3', { class: 'brief-map__title' }, head, row.title);
  const line = el('p', { class: 'brief-map__line t-small' }, head);
  el('span', { class: 'c-chip' }, line, COUNT_KIND_WORDS[row.kind]);
  const against = againstLine(row.against);
  if (against) el('span', {}, line, against);
  if (row.basis) prose('p', { class: 'brief-map__basis t-small' }, head, row.basis, terms);
  if (row.cells.length === 0) {
    el('p', { class: 'brief-map__none t-small' }, li, 'No elements listed yet.');
    return;
  }
  const cells = el('ol', { class: 'brief-map__cells', 'aria-label': `Elements of ${row.title}` }, li);
  for (const item of row.cells) cell(row, item, cells, terms);
}

/** Draws the map, its meter and legend into `parent`, with the table twin behind the frame's Table toggle. */
export function renderClaimsMap(parent: HTMLElement, map: ClaimsMap, terms: Terms): void {
  meter(map, parent);
  legend(parent);
  const title = 'Counts by element';
  const frame = createFrame(parent, { title });
  const list = el('ol', { class: 'brief-map', 'aria-label': title }, frame.plot);
  list.style.setProperty('--cols', String(Math.min(map.columns, MAX_COLUMNS)));
  for (const row of map.rows) countRow(row, list, terms);
  const rows = map.rows.flatMap((row) => row.cells.map((item) => [
    row.title, countLine(row), `${item.n}. ${item.text}`, PROOF_WORDS[item.strength], item.cite ? citeText(item.cite) : '', item.note ?? '',
  ]));
  fillTable(frame.tableWrap, title, [
    { label: 'Count' }, { label: 'Kind and parties' }, { label: 'Element' }, { label: 'Proof' }, { label: 'Source' }, { label: 'What it shows' },
  ], rows);
}
