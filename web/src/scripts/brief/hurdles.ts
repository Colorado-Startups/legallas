// SPDX-License-Identifier: Apache-2.0
// The complaint brief, what counsel must get past and confirm: the hurdles as cards (four to a row on a wide
// screen), each a title, one or two plain sentences and the cites; then the dates to confirm with counsel, oldest
// first, each an ISO date, one line and its cites.
import type { RoomHurdle } from '../matter-api.ts';
import { citeRow, el } from '../track-dom.ts';
import type { DateRow } from './model.ts';
import { prose, type Terms } from './dom.ts';

/** Draws the hurdle cards into `parent`. */
export function renderHurdles(parent: Element, hurdles: readonly RoomHurdle[], terms: Terms): void {
  const list = el('ul', { class: 'brief-cards brief-hurdles' }, parent);
  for (const hurdle of hurdles) {
    const card = el('li', { class: 'brief-card' }, list);
    el('h3', { class: 'brief-card__title' }, card, hurdle.title);
    prose('p', { class: 'brief-card__text' }, card, hurdle.text, terms);
    citeRow(hurdle.cites, el('p', { class: 'brief-card__cites' }, card), `Sources for ${hurdle.title}`);
  }
}

/** Draws the dates to confirm into `parent`, one row each. */
export function renderDates(parent: Element, rows: readonly DateRow[], terms: Terms): void {
  const list = el('ul', { class: 'brief-dates' }, parent);
  for (const row of rows) {
    const item = el('li', { class: 'brief-dates__row' }, list);
    el('time', { class: 'brief-dates__date t-mono', datetime: row.iso || undefined }, item, row.iso);
    const body = el('p', { class: 'brief-dates__text' }, item);
    prose('span', { class: 'brief-dates__words' }, body, row.text, terms);
    citeRow(row.cites, body, `Sources for ${row.iso}`);
  }
}
