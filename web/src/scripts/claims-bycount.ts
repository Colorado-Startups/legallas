// SPDX-License-Identifier: Apache-2.0
// Card P4 (Claims & Proof). Two views that read without a grid. By count (the phone default): each count as a
// disclosure, closed it shows one ring per element; open, who it is pleaded against, the authority, and a card per
// element with its cite chips (a gap card is dashed). Table: every proof item as a row, the matrix's table twin.

import type { ServedMatter } from './matter-api.ts';
import {
  authoritiesOf, authorityPlacement, byStrength, elementLabel, partiesAgainst, roman, strengthsOf, strongestOf,
  type ClaimsModel, type RoomClaim,
} from './claims-model.ts';
import { citeChip, el, partyChip, ring, STRENGTH_WORDS } from './claims-dom.ts';
import { gapItem } from './claims-aside.ts';

/** Draws the claims as one block per count into the host element. */
export function renderByCount(host: HTMLElement, model: ClaimsModel, matter: ServedMatter): void {
  const list = el('div', { class: 'claims-counts' }, host);
  model.claims.forEach((claim, i) => countBlock(list, claim, matter, i === 0));
}

function summaryLabel(claim: RoomClaim): string {
  const strengths = strengthsOf(claim);
  const tally = (['direct', 'corroborating', 'circumstantial', 'gap'] as const)
    .map((s) => [s, strengths.filter((x) => x === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${STRENGTH_WORDS[s].toLowerCase()}`);
  const n = strengths.length;
  return `${n} ${n === 1 ? 'element' : 'elements'}: ${tally.join(', ')}`;
}

function countBlock(parent: HTMLElement, claim: RoomClaim, matter: ServedMatter, open: boolean): void {
  const details = el('details', { class: 'claims-count' }, parent);
  details.open = open;
  const summary = el('summary', { class: 'claims-count__summary' }, details);
  el('span', { class: 'claims-count__num u-mono' }, summary, roman(claim.count));
  el('span', { class: 'claims-count__label' }, summary, claim.label);
  const marks = el('span', { class: 'claims-count__marks', role: 'img', 'aria-label': summaryLabel(claim) }, summary);
  for (const s of strengthsOf(claim)) ring(s, 18, marks);
  const body = el('div', { class: 'claims-count__body' }, details);
  const against = el('p', { class: 'claims-count__against' }, body);
  el('span', { class: 'claims-count__lead' }, against, 'Against');
  for (const party of partiesAgainst(claim, matter)) partyChip(party, against);
  const authorities = authoritiesOf(claim);
  if (authorities.length) el('p', { class: 'claims-count__authority' }, body, authorities.join('; '));
  const cards = el('ul', { class: 'claims-cards' }, body);
  claim.elements.forEach((element, i) => {
    const label = elementLabel(claim, i);
    const strongest = strongestOf(element.proof);
    if (strongest === 'gap') {
      gapItem({ claim, element, label, strongest }, cards).classList.add('claims-card', 'claims-card--gap');
      return;
    }
    const li = el('li', { class: 'claims-card', 'data-strength': strongest }, cards);
    const head = el('p', { class: 'claims-card__head' }, li);
    ring(strongest, 18, head);
    el('span', { class: 'u-vh' }, head, `${STRENGTH_WORDS[strongest]}. `);
    el('span', { class: 'u-mono claims-card__label' }, head, label);
    el('span', { class: 'claims-card__text' }, head, element.text);
    if (authorityPlacement(claim) === 'element' && element.authority) {
      el('p', { class: 'claims-card__authority' }, li, element.authority);
    }
    const cites = el('div', { class: 'claims-cites' }, li);
    for (const p of byStrength(element.proof.filter((x) => x.strength !== 'gap'))) citeChip(p.cite, cites, p.note);
  });
}

/** Every proof item, gaps included, in pleaded order: what the matrix shows, as rows. */
export function renderProofTable(host: HTMLElement, model: ClaimsModel): void {
  const wrap = el('div', { class: 'c-table-wrap' }, host);
  const table = el('table', { class: 'c-table claims-table' }, wrap);
  el('caption', { class: 'u-vh' }, table, 'Every proof item by count and element');
  const head = el('tr', {}, el('thead', {}, table));
  for (const label of ['Element', 'Strength', 'Cite', 'What it shows']) el('th', { scope: 'col' }, head, label);
  const body = el('tbody', {}, table);
  for (const claim of model.claims) {
    claim.elements.forEach((element, i) => {
      const items = byStrength(element.proof);
      const label = `${elementLabel(claim, i)} ${element.text}`;
      if (items.length === 0) {
        const tr = el('tr', {}, body);
        el('td', {}, tr, label);
        el('td', {}, tr, STRENGTH_WORDS.gap);
        el('td', {}, tr);
        el('td', {}, tr, 'No document in the record yet.');
      }
      for (const p of items) {
        const tr = el('tr', {}, body);
        el('td', {}, tr, label);
        el('td', {}, tr, STRENGTH_WORDS[p.strength]);
        citeChip(p.cite, el('td', { class: 'c-table__num' }, tr), p.note);
        el('td', { class: 'c-table__summary' }, tr, p.note ?? '');
      }
    });
  }
}
