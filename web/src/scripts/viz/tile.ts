// SPDX-License-Identifier: Apache-2.0
// Card F5b (Charts viz). The stat tile (DESIGN.md section 7, `c-stat`): a value, a label, a note holding a date or
// a cite, and an optional sparkline. Money always carries its cite. No trend arrows and no colored figures.

import type { Cite, MoneyFact } from '../../../worker/matter-types.ts';
import { formatValue, html, type ValueKind } from './core.ts';
import { SERIES_WORDS, seriesOf, sumSeries, type MoneySeries } from './money.ts';
import { renderSpark } from './spark.ts';

/** A cite on a tile: the cite itself and its text. */
export interface TileCite {
  cite: Cite;
  /** The cite as text, for example "DOE-000412 at 3"; the page formats it (control numbers are F7's). */
  text: string;
}

/** The data a tile shows: its label and its value. */
export interface TileData {
  label: string;
  /** A count, or whole cents when `kind` is usd. */
  value: number;
  kind: ValueKind;
  /** A date or short qualifier, for example "2011-04 to 2013-06". */
  note?: string;
  cite?: TileCite;
  trend?: { values: number[]; label: string; from?: string; to?: string };
}

/** Options for a tile: what happens when its cite is followed. */
export interface TileOptions {
  /** Called when the cite is followed; the page opens the exhibit pane instead of navigating. */
  onCite?: (cite: Cite, link: HTMLAnchorElement) => void;
}

/** `/doc/?id=<id>#page=<n>`, the cite chip's plain link target. */
export function citeHref(cite: Cite): string {
  const base = `/doc/?id=${encodeURIComponent(cite.doc)}`;
  return cite.page ? `${base}#page=${cite.page}` : base;
}

/** Money tiles must carry a cite (DESIGN.md: "Money always carries its cite"). */
export function tileProblems(tile: TileData): string[] {
  const problems: string[] = [];
  if (!Number.isFinite(tile.value)) problems.push('value is not a number');
  if (tile.kind === 'usd' && !Number.isSafeInteger(tile.value)) problems.push('money must be whole cents');
  if (tile.kind === 'usd' && !tile.cite) problems.push('money needs a cite');
  return problems;
}

/**
 * A money tile summing one series (R43). Refuses a set holding the other series; entries with no kind are left
 * out. The cite is the first counted entry's first cite (`citeText` formats it); the note is the date span.
 */
export function moneyTile(label: string, money: MoneyFact[], series: MoneySeries, citeText: (cite: Cite) => string): TileData {
  const value = sumSeries(money, series);
  const counted = money.filter((f) => seriesOf(f.kind) === series && f.amountCents > 0);
  const dates = counted.map((f) => f.date).sort();
  const span = dates.length === 0 ? undefined : dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`;
  const first = counted.find((f) => f.cites.length > 0)?.cites[0];
  return {
    label: label || SERIES_WORDS[series],
    value,
    kind: 'usd',
    note: span,
    cite: first ? { cite: first, text: citeText(first) } : undefined,
  };
}

/** Appends one stat tile to `parent`. A money tile without a cite is refused (nothing is drawn). */
export function renderTile(parent: Element, tile: TileData, opts: TileOptions = {}): HTMLElement | null {
  if (tileProblems(tile).length > 0) return null;
  const root = html('div', { class: 'c-stat viz-tile' }, parent);
  html('div', { class: 'c-stat__value t-stat' }, root, formatValue(tile.kind, tile.value));
  html('div', { class: 'c-stat__label' }, root, tile.label);
  if (tile.trend && tile.trend.values.length > 1) {
    const spark = html('div', { class: 'viz-tile__spark' }, root);
    renderSpark(spark, tile.trend.values, { ...tile.trend, kind: tile.kind });
  }
  if (tile.note || tile.cite) {
    const note = html('div', { class: 'c-stat__note t-caption' }, root, tile.note ? `${tile.note} ` : undefined);
    if (tile.cite) {
      const { cite, text } = tile.cite;
      const link = html('a', { class: 'c-cite', href: citeHref(cite) }, note, text);
      if (opts.onCite) {
        link.addEventListener('click', (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          opts.onCite?.(cite, link);
        });
      }
    }
  }
  return root;
}

/** A row of at most four tiles (DESIGN.md). Extra tiles are not drawn; returns how many were. */
export function renderTiles(parent: Element, tiles: TileData[], opts: TileOptions = {}): number {
  const row = html('div', { class: 'viz-tiles' }, parent);
  let drawn = 0;
  for (const tile of tiles.slice(0, 4)) if (renderTile(row, tile, opts)) drawn += 1;
  return drawn;
}
