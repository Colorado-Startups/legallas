// SPDX-License-Identifier: Apache-2.0
// The complaint brief, "Who's who": one card per party in the brief's cast, grouped by the role the pleading gives
// it (plaintiff side, defendants, relief defendants, nominal defendants, others named), or by side when the cast
// pleads no defendant role. Each card leads with the side shape and the name, with the defined term the brief
// calls it by (Richard Roe ("Roe")), then the plain role and the org the party acts through. Shape backs the side;
// a hidden word says it to screen readers.
import { shapeSvg, SIDE_WORDS } from '../viz/core.ts';
import { el } from '../track-dom.ts';
import { castGroups, castTerm, type CastCard } from './model.ts';
import { prose, type Terms } from './dom.ts';

function card(item: CastCard, parent: Element, terms: Terms): HTMLElement {
  const li = el('li', { class: 'brief-cast__card' }, parent);
  const head = el('p', { class: 'brief-cast__name' }, li);
  shapeSvg(item.side, 16, head);
  const name = el('span', {}, head, item.name);
  const short = castTerm(item.name, terms);
  if (short) el('span', { class: 'brief-cast__term' }, name, ` (\u201c${short}\u201d)`);
  el('span', { class: 'u-vh' }, head, `, ${SIDE_WORDS[item.side].toLowerCase()}`);
  if (item.role) prose('p', { class: 'brief-cast__role' }, li, item.role, terms);
  if (item.via) {
    const via = el('p', { class: 'brief-cast__via t-small' }, li, 'Through ');
    shapeSvg(item.via.side, 12, via);
    el('span', { class: 'brief-cast__via-name' }, via, item.via.name);
  }
  return li;
}

/** Draws the cast into `parent`, one labelled group per pleaded role (or side) when more than one is present. */
export function renderCast(parent: Element, cards: readonly CastCard[], terms: Terms): void {
  const groups = castGroups(cards);
  for (const group of groups) {
    const block = el('div', { class: 'brief-cast__group' }, parent);
    const { label } = group;
    if (groups.length > 1) el('h3', { class: 't-label brief-cast__heading' }, block, label);
    const list = el('ul', { class: 'brief-cast__list', 'aria-label': groups.length > 1 ? undefined : label }, block);
    for (const item of group.cards) card(item, list, terms);
  }
}
