// SPDX-License-Identifier: Apache-2.0
// The complaint brief, money and figures: each dollar figure in the record as a bar, set in its group ("Spring
// invoices", "Spoiled stock") under the group's name. Every bar carries its amount as the cited filing states it and the
// cite chip that opens the page; bars share one scale and are never added together, within a group or across.
// Figures that are not dollars (counts) follow as stat tiles. The bars are HTML (a width per bar through a custom
// property), so the labels wrap and print as text; the Table toggle shows the same figures as rows. Loaded lazily
// by page.ts (R20).
import { openExhibit } from '../exhibit-pane.ts';
import { citeChip, citeText, el } from '../track-dom.ts';
import { createFrame, fillTable, formatUsd } from '../viz/core.ts';
import { renderTiles, type TileData } from '../viz/tile.ts';
import { barLength, type MoneyBar, type MoneyView } from './model.ts';

const TILE_ROW = 4;

function bar(item: MoneyBar, max: number, parent: Element): void {
  const row = el('li', { class: 'brief-money__row' }, parent);
  el('p', { class: 'brief-money__label' }, row, item.label);
  const track = el('p', { class: 'brief-money__track' }, row);
  const fill = el('span', { class: 'brief-money__bar', 'aria-hidden': 'true' }, track);
  fill.style.setProperty('--share', String(barLength(item.value, max, 1)));
  el('span', { class: 'brief-money__value' }, track, formatUsd(item.value));
  if (item.cite) citeChip(item.cite, track, item.note);
  if (item.note) el('p', { class: 'brief-money__note t-small' }, row, item.note);
}

function tileOf(figure: MoneyView['others'][number]): TileData {
  const cite = figure.cites[0];
  return {
    label: figure.label, value: figure.value, kind: figure.unit, note: figure.note ?? undefined,
    cite: cite ? { cite, text: citeText(cite) } : undefined,
  };
}

/** Draws the grouped bars (with their table twin) and the count tiles into `parent`. */
export function renderMoney(parent: HTMLElement, view: MoneyView): void {
  parent.replaceChildren();
  if (view.groups.length > 0) {
    const title = 'Dollar figures in the record';
    const frame = createFrame(parent, { title, caption: 'Each amount as its cited filing states it, on one scale; amounts are never added together.' });
    const named = view.groups.some((group) => group.label);
    for (const group of view.groups) {
      const block = el('div', { class: 'brief-money__group' }, frame.plot);
      if (named) el('h3', { class: 't-label brief-money__group-title' }, block, group.label || 'Other figures');
      const list = el('ul', { class: 'brief-money', 'aria-label': group.label || title }, block);
      for (const item of group.bars) bar(item, view.max, list);
    }
    const rows = view.groups.flatMap((group) => group.bars.map((item) => [
      ...(named ? [group.label || 'Other figures'] : []), item.label, formatUsd(item.value), item.cite ? citeText(item.cite) : '', item.note ?? '',
    ]));
    fillTable(frame.tableWrap, title, [
      ...(named ? [{ label: 'Group' }] : []), { label: 'Figure' }, { label: 'Amount', num: true }, { label: 'Source' }, { label: 'Note' },
    ], rows);
  }
  if (view.others.length === 0) return;
  const tiles = el('div', { class: 'brief-money__tiles' }, parent);
  tiles.style.setProperty('--tiles', String(Math.min(view.others.length, TILE_ROW)));
  const onCite = (cite: { doc: string; page: number | null }, link: HTMLAnchorElement) => {
    void openExhibit({ id: cite.doc, page: cite.page, opener: link });
  };
  for (let i = 0; i < view.others.length; i += TILE_ROW) {
    renderTiles(tiles, view.others.slice(i, i + TILE_ROW).map(tileOf), { onCite });
  }
}
