// SPDX-License-Identifier: Apache-2.0
// The complaint brief, the key exhibits: one card per exhibit, its control number at the cited page, the
// document's type and date, and what it proves in one line. The chip opens the exhibit pane at that page; a click
// anywhere else on the card does the same.
import { guideLook } from '../guide-bus.ts';
import { citeChip, el } from '../track-dom.ts';
import type { ExhibitCard } from './model.ts';
import { cardOpens, prose, type Terms } from './dom.ts';

/** Draws the exhibit cards into `parent`. */
export function renderExhibits(parent: Element, cards: readonly ExhibitCard[], terms: Terms): void {
  const list = el('ul', { class: 'brief-cards brief-exhibits' }, parent);
  for (const item of cards) {
    const card = el('li', { class: 'brief-card brief-exhibit' }, list);
    const head = el('div', { class: 'brief-exhibit__head' }, card);
    const chip = citeChip(item.cite, el('p', { class: 'brief-exhibit__cite' }, head), item.proves);
    if (item.type || item.date) {
      const meta = el('p', { class: 'brief-exhibit__meta t-small' }, head);
      if (item.type) el('span', {}, meta, item.type);
      if (item.date) el('time', { class: 't-mono', datetime: item.date }, meta, item.date);
    }
    prose('p', { class: 'brief-exhibit__proves' }, card, item.proves, terms);
    cardOpens(card, chip);
    card.addEventListener('pointerenter', () => guideLook(card));
  }
}
