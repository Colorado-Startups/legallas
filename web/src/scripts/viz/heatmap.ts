// SPDX-License-Identifier: Apache-2.0
// Card F5b (Charts viz). Month heatmap of document counts: years down, months across, one hue light to dark in
// four steps (charts.css, `data-level`). A month with documents is a button; choosing it calls `onSelect` with
// "YYYY-MM" (choosing it again clears). `monthCounts`, `heatGrid`, `levelOf` and `gridNext` are pure (heatmap.test.ts).

import {
  createFrame, fillTable, formatCount, hideTip, html, observeWidth, showTip, type ChartHandle, type Frame,
} from './core.ts';

/** The short month names the heatmap shows. */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
/** The number of shading levels on the heatmap. */
export const LEVELS = 4;

/** Document counts by month, and the documents dated to a year only. */
export interface MonthCounts {
  /** "YYYY-MM" to count. */
  months: Map<string, number>;
  /** Documents dated to a year only, by year. */
  yearOnly: Map<string, number>;
  undated: number;
}

/** Counts partial ISO dates by month. "2023" counts toward its year only; anything else is undated. */
export function monthCounts(dates: Array<string | null | undefined>): MonthCounts {
  const out: MonthCounts = { months: new Map(), yearOnly: new Map(), undated: 0 };
  for (const date of dates) {
    const m = typeof date === 'string' ? /^(\d{4})(?:-(\d{2}))?/.exec(date) : null;
    const month = m?.[2] ? Number(m[2]) : 0;
    if (!m) out.undated += 1;
    else if (month >= 1 && month <= 12) out.months.set(`${m[1]}-${m[2]}`, (out.months.get(`${m[1]}-${m[2]}`) ?? 0) + 1);
    else if (!m[2]) out.yearOnly.set(m[1], (out.yearOnly.get(m[1]) ?? 0) + 1);
    else out.undated += 1;
  }
  return out;
}

/** 0 for none, else 1..4 by share of the busiest month. */
export function levelOf(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(LEVELS, Math.ceil((LEVELS * count) / max));
}

/** The counts each level covers, for the legend: level k spans [lo, hi]. Empty ranges are dropped. */
export function levelRanges(max: number): Array<{ level: number; lo: number; hi: number }> {
  const out = [];
  for (let k = 1; k <= LEVELS; k += 1) {
    const lo = Math.floor(((k - 1) * max) / LEVELS) + 1;
    const hi = Math.floor((k * max) / LEVELS);
    if (hi >= lo) out.push({ level: k, lo, hi });
  }
  return out;
}

/** One heatmap cell: a month, its count, its shade level and its grid position. */
export interface HeatCell { month: string; count: number; level: number; row: number; col: number }
/** The heatmap grid: its years, its cells and the largest count. */
export interface HeatGrid { years: string[]; cells: HeatCell[]; max: number }

/** Every month from the first year with a document to the last, in reading order. */
export function heatGrid(months: Map<string, number>): HeatGrid {
  const years = [...months.keys()].map((k) => Number(k.slice(0, 4)));
  if (years.length === 0) return { years: [], cells: [], max: 0 };
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  const max = Math.max(...months.values());
  const out: HeatGrid = { years: [], cells: [], max };
  for (let y = lo; y <= hi; y += 1) {
    out.years.push(String(y));
    for (let m = 1; m <= 12; m += 1) {
      const month = `${y}-${String(m).padStart(2, '0')}`;
      const count = months.get(month) ?? 0;
      out.cells.push({ month, count, level: levelOf(count, max), row: y - lo, col: m - 1 });
    }
  }
  return out;
}

/**
 * Arrow movement between months that have documents. Left and Right go to the previous or next such month in
 * reading order; Up and Down go to the adjacent year, at the nearest such month to the same column. -1 to stay.
 */
export function gridNext(cells: HeatCell[], from: number, key: string): number {
  const live = (i: number) => (cells[i]?.count ?? 0) > 0;
  const step = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
  if (step) {
    for (let i = from + step; i >= 0 && i < cells.length; i += step) if (live(i)) return i;
    return -1;
  }
  const dir = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
  const here = cells[from];
  if (!dir || !here) return -1;
  for (let row = here.row + dir; row >= 0 && row * 12 < cells.length; row += dir) {
    for (let d = 0; d < 12; d += 1) {
      for (const col of d === 0 ? [here.col] : [here.col - d, here.col + d]) {
        const i = row * 12 + col;
        if (col >= 0 && col < 12 && live(i)) return i;
      }
    }
  }
  return -1;
}

/** Options for drawing the heatmap: its title, caption and the callback for a chosen month. */
export interface HeatmapOptions {
  title: string;
  caption?: string;
  /** "YYYY-MM" when a month is chosen, null when the choice is cleared. */
  onSelect?: (month: string | null) => void;
}

/** The heatmap's handle: mark a month as chosen without calling the selection callback. */
export interface HeatmapHandle extends ChartHandle {
  /** Marks a month as chosen (or none), without calling onSelect. */
  select(month: string | null): void;
}

function monthWords(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

function docs(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'document' : 'documents'}`;
}

/** Draws the heatmap. Counts come from `monthCounts` over the documents' dates. */
export function renderHeatmap(container: HTMLElement, counts: MonthCounts, opts: HeatmapOptions): HeatmapHandle {
  const frame = createFrame(container, { title: opts.title, caption: opts.caption });
  const grid = heatGrid(counts.months);
  const table = html('table', { class: 'viz-heat', 'aria-label': opts.title }, frame.plot);
  const headRow = html('tr', {}, html('thead', {}, table));
  html('td', { class: 'viz-heat__corner' }, headRow);
  for (const m of MONTHS) {
    const th = html('th', { scope: 'col', class: 'viz-heat__month' }, headRow);
    html('span', { class: 'viz-heat__long' }, th, m);
    html('span', { class: 'viz-heat__short', 'aria-hidden': 'true' }, th, m.charAt(0));
  }
  const body = html('tbody', {}, table);
  const buttons = new Map<number, HTMLButtonElement>();
  grid.years.forEach((year) => html('th', { scope: 'row', class: 'viz-heat__year u-mono' }, html('tr', {}, body), year));
  grid.cells.forEach((cell, i) => {
    const td = html('td', { class: 'viz-heat__td' }, body.rows[cell.row]);
    const label = `${monthWords(cell.month)}: ${docs(cell.count)}`;
    if (cell.count === 0) {
      html('span', { class: 'viz-heat__cell', 'data-level': '0', role: 'img', 'aria-label': label }, td);
      return;
    }
    const b = html('button', { type: 'button', class: 'viz-heat__cell', 'data-level': String(cell.level), 'aria-label': label, 'aria-pressed': 'false', tabindex: '-1' }, td);
    buttons.set(i, b);
  });
  let chosen: string | null = null;
  const select = (month: string | null) => {
    chosen = month;
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(grid.cells[i].month === month)));
  };
  wireCells(frame, grid, buttons, (month) => {
    select(chosen === month ? null : month);
    opts.onSelect?.(chosen);
  });
  drawHeatLegend(frame, grid.max);
  heatTable(frame, opts.title, grid, counts);
  // On the narrowest phones twelve 24px months need more room than the column has and the grid moves sideways;
  // a one-line note says so, only while that is true (a scroll shadow would hide behind the opaque cells).
  const more = html('p', { class: 'viz-heat__more t-caption', hidden: true }, undefined, 'More months to the right.');
  frame.plot.prepend(more);
  const stop = observeWidth(frame.plot, (w) => {
    table.setAttribute('data-compact', String(w < 480));
    requestAnimationFrame(() => { more.hidden = table.offsetWidth <= frame.plot.clientWidth; });
  });
  return { frame, select, destroy: () => { stop(); frame.destroy(); } };
}

function wireCells(frame: Frame, grid: HeatGrid, buttons: Map<number, HTMLButtonElement>, choose: (month: string) => void): void {
  const first = [...buttons.keys()][0];
  if (first !== undefined) buttons.get(first)?.setAttribute('tabindex', '0');
  buttons.forEach((b, i) => {
    const cell = grid.cells[i];
    const show = () => showTip(frame, b, monthWords(cell.month), [{ value: formatCount(cell.count), label: cell.count === 1 ? 'document' : 'documents' }]);
    b.addEventListener('pointerenter', show);
    b.addEventListener('focus', show);
    b.addEventListener('pointerleave', () => hideTip(frame));
    b.addEventListener('blur', () => hideTip(frame));
    b.addEventListener('click', () => choose(cell.month));
    b.addEventListener('keydown', (event) => {
      const to = event.key.startsWith('Arrow') ? gridNext(grid.cells, i, event.key) : -1;
      const target = buttons.get(to);
      if (!target) return;
      event.preventDefault();
      buttons.forEach((other) => other.setAttribute('tabindex', other === target ? '0' : '-1'));
      target.focus();
    });
  });
}

function drawHeatLegend(frame: Frame, max: number): void {
  if (max <= 0) return;
  const legend = html('ul', { class: 'viz-legend viz-heat__legend', 'aria-label': 'Documents per month' }, frame.plot);
  const none = html('li', { class: 'viz-legend__item' }, legend);
  html('span', { class: 'viz-heat__swatch', 'data-level': '0', 'aria-hidden': 'true' }, none);
  html('span', {}, none, 'None');
  for (const r of levelRanges(max)) {
    const item = html('li', { class: 'viz-legend__item' }, legend);
    html('span', { class: 'viz-heat__swatch', 'data-level': String(r.level), 'aria-hidden': 'true' }, item);
    html('span', { class: 'u-num' }, item, r.lo === r.hi ? formatCount(r.lo) : `${formatCount(r.lo)} to ${formatCount(r.hi)}`);
  }
}

function heatTable(frame: Frame, title: string, grid: HeatGrid, counts: MonthCounts): void {
  const rows = grid.cells.filter((c) => c.count > 0).map((c) => [c.month, formatCount(c.count)]);
  for (const [year, n] of [...counts.yearOnly].sort()) rows.push([`${year}, month not stated`, formatCount(n)]);
  if (counts.undated > 0) rows.push(['Undated', formatCount(counts.undated)]);
  fillTable(frame.tableWrap, title, [{ label: 'Month' }, { label: 'Documents', num: true }], rows);
}
