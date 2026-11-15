// SPDX-License-Identifier: Apache-2.0
// The heatmap, built as a real table so rows and columns are announced for free. Each cell shows its number,
// so color is never alone, and links to what it drills into. The darker the cell, the closer to 100, and a 0 is
// an empty red tile: the page fills up as the work gets done.

import { esc, icon, isNum, safeHref, scoreBand, sr } from './svg.ts';

export interface HeatAxisItem {
  id: string;
  label: string;
  /** Shorter header for a narrow column. */
  short?: string;
}

export interface HeatCell {
  row: string;
  col: string;
  /** The cell's score, or null when its measurement is missing, which scores 0. */
  score: number | null;
  href?: string;
  /** Excluded cells make no sense for this row, like an investor in a forming room. They come from the reviewed list. */
  excluded?: boolean;
}

export interface HeatmapProps {
  title: string;
  /** Small text beside the title, such as a share of the page. */
  note?: string;
  rows: HeatAxisItem[];
  cols: HeatAxisItem[];
  cells: HeatCell[];
}

function excludedCell(rowLabel: string, colLabel: string): string {
  return `<td class="qs-hx">${sr(`${rowLabel}, ${colLabel}: not applicable`)}</td>`;
}

function scoreCell(cell: HeatCell, rowLabel: string, colLabel: string): string {
  const score = isNum(cell.score) ? cell.score : 0;
  const missing = !isNum(cell.score);
  const band = scoreBand(score);
  const face = missing ? icon('alert') : `${band === 5 ? icon('check') : ''}<span>${score}</span>`;
  const spoken = `${rowLabel}, ${colLabel}: ${missing ? 'missing, scores 0' : score}`;
  const href = safeHref(cell.href);
  const cls = `qs-heat qs-h${band}${missing ? ' is-missing' : ''}`;
  const inner = href
    ? `<a class="${cls}" href="${esc(href)}" aria-label="${esc(spoken)}">${face}</a>`
    : `<span class="${cls}" role="img" aria-label="${esc(spoken)}">${face}</span>`;
  return `<td>${inner}</td>`;
}

/** One score grid, rows against columns. */
export function heatmap(props: HeatmapProps): string {
  const head = props.cols
    .map((col) => `<th scope="col" title="${esc(col.label)}">${esc(col.short ?? col.label)}</th>`)
    .join('');
  const body = props.rows
    .map((row) => {
      const cells = props.cols
        .map((col) => {
          const cell = props.cells.find((c) => c.row === row.id && c.col === col.id);
          if (cell?.excluded) return excludedCell(row.label, col.label);
          return scoreCell(cell ?? { row: row.id, col: col.id, score: null }, row.label, col.label);
        })
        .join('');
      return `<tr><th scope="row" title="${esc(row.label)}">${esc(row.short ?? row.label)}</th>${cells}</tr>`;
    })
    .join('');
  const note = props.note ? ` <span class="qs-heat-note">${esc(props.note)}</span>` : '';
  return `<div class="qs-heatmap"><table><caption>${esc(props.title)}${note}</caption><thead><tr><td></td>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** The scale under a heatmap: an empty red tile for 0, then the five steps up to 100. */
export function heatLegend(): string {
  const steps: [number, string][] = [
    [0, '0'],
    [1, '1'],
    [2, '25'],
    [3, '50'],
    [4, '75'],
    [5, '100'],
  ];
  const tiles = steps
    .map(([band, text]) => `<span class="qs-heat-step qs-h${band}">${band === 5 ? icon('check') : ''}${text}</span>`)
    .join('');
  return `<div class="qs-heat-legend" role="img" aria-label="Score scale: an empty red tile is 0, darker is closer to 100.">${tiles}</div>`;
}
