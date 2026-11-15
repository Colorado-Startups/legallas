// SPDX-License-Identifier: Apache-2.0
// Track pages: a violation's figures as stat tiles (viz/tile.ts), every figure with its cite and money from whole
// cents, then the cap chart when any figure carries a limit. Loaded lazily by track.ts (R20).
import { openExhibit } from './exhibit-pane.ts';
import { capChart, type TrackFigure } from './track-model.ts';
import { citeText } from './track-dom.ts';
import { renderCap } from './track-cap.ts';
import { renderTiles, type TileData } from './viz/tile.ts';

const ROW = 4;

function tileOf(figure: TrackFigure): TileData {
  const cite = figure.cites[0];
  return {
    label: figure.label,
    value: figure.value,
    kind: figure.unit,
    note: figure.note ?? undefined,
    cite: cite ? { cite, text: citeText(cite) } : undefined,
  };
}

/** Draws the tiles (rows of at most four) and the cap chart. */
export function renderFigures(parent: HTMLElement, figures: readonly TrackFigure[], mark: string): void {
  parent.replaceChildren();
  const onCite = (cite: { doc: string; page: number | null }, link: HTMLAnchorElement) => {
    void openExhibit({ id: cite.doc, page: cite.page, opener: link });
  };
  for (let i = 0; i < figures.length; i += ROW) renderTiles(parent, figures.slice(i, i + ROW).map(tileOf), { onCite });
  const chart = capChart(figures);
  if (!chart) return;
  renderCap(parent, chart, {
    title: `${mark}: figures against their limits`,
    caption: 'Each figure against its own limit; figures are never added together.',
    citeText: (row) => (row.cite ? citeText(row.cite) : ''),
  });
}
