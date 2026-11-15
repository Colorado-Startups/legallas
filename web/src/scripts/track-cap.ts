// SPDX-License-Identifier: Apache-2.0
// Track pages: the cap chart. Each figure that carries a limit is one horizontal bar against its own limit, drawn
// as a dashed rule ("Limit 24"). Bars sit side by side and are never added into a new figure. The bar shape is
// viz/bar.ts's (a rounded data end, a square baseline); the frame, tooltip, keyboard focus and table twin are
// viz/core.ts's. Loaded lazily with the figures.
import { formatValue, createFrame, fillTable, hideTip, linearNext, observeWidth, rovingFocus, showTip, svg, textWidth, fitLabel, type ChartHandle } from './viz/core.ts';
import { barPath, BAR_MAX } from './viz/bar.ts';
import { capX, type CapChart } from './track-model.ts';

const ROW = 40;
const TOP = 22;
const AXIS = 22;

/** Options for a cap chart: its title, caption and cite text. */
export interface CapOptions {
  title: string;
  caption?: string;
  /** The cite text for a row's table cell ("DOE-000412 at 3"). */
  citeText: (row: CapChart['rows'][number]) => string;
}

function limitWord(chart: CapChart, limit: number): string {
  return `Limit ${formatValue(chart.unit, limit, true)}`;
}

function draw(frame: ChartHandle['frame'], chart: CapChart, opts: CapOptions, width: number): void {
  const labelW = Math.min(Math.max(...chart.rows.map((r) => textWidth(r.label))) + 12, Math.round(width * 0.38));
  const valueW = textWidth(formatValue(chart.unit, chart.max, true)) + 12;
  const plotW = Math.max(width - labelW - valueW, 40);
  const height = TOP + chart.rows.length * ROW + AXIS;
  const x = (v: number) => labelW + capX(v, chart.max, plotW);
  const root = svg('svg', { class: 'viz-svg track-cap', width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': opts.title });
  const bottom = TOP + chart.rows.length * ROW;
  svg('line', { class: 'viz-baseline', x1: x(0), x2: x(0), y1: TOP, y2: bottom }, root);
  for (const tick of [0, chart.max / 2, chart.max]) {
    svg('text', { class: 'viz-axis', x: x(tick), y: bottom + 16, 'text-anchor': 'middle' }, root).textContent = formatValue(chart.unit, tick, true);
  }
  for (const limit of chart.limits) {
    const rows = chart.rows.map((r, i) => (r.limit === limit ? i : -1)).filter((i) => i >= 0);
    const y1 = TOP + rows[0] * ROW + 2;
    const y2 = TOP + (rows[rows.length - 1] + 1) * ROW - 2;
    svg('line', { class: 'track-cap__limit', x1: x(limit), x2: x(limit), y1: y1 - 6, y2 }, root);
    svg('text', { class: 'viz-axis track-cap__limit-label', x: x(limit), y: y1 - 10, 'text-anchor': 'middle' }, root).textContent = limitWord(chart, limit);
  }
  const marks = chart.rows.map((row, i) => {
    const y = TOP + i * ROW;
    const thick = Math.min(BAR_MAX, ROW * 0.6);
    const band = y + (ROW - thick) / 2;
    const label = svg('text', { class: 'viz-cat', x: labelW - 8, y: y + ROW / 2 + 4, 'text-anchor': 'end' }, root);
    label.textContent = fitLabel(row.label, labelW - 12);
    const value = formatValue(chart.unit, row.value);
    const g = svg('g', { class: 'viz-hit', role: 'img', 'aria-label': `${row.label}: ${value}, ${limitWord(chart, row.limit).toLowerCase()}` }, root);
    svg('rect', { class: 'viz-hit__area', x: x(0), y: y + 4, width: Math.max(x(Math.max(row.value, row.limit)) - x(0), 24), height: ROW - 8 }, g);
    if (row.value > 0) {
      const box = { x: x(0), y: band, w: Math.max(x(row.value) - x(0), 1), h: thick };
      svg('path', { class: 'viz-bar viz-mark', 'data-side': 'nominal', d: barPath(box, 'right') }, g);
    }
    svg('text', { class: 'viz-value', x: x(row.value) + 6, y: y + ROW / 2 + 4, 'text-anchor': 'start' }, root).textContent = formatValue(chart.unit, row.value, true);
    const show = () => showTip(frame, g, row.label, [{ value, label: limitWord(chart, row.limit), side: 'nominal' }]);
    g.addEventListener('pointerenter', show);
    g.addEventListener('focus', show);
    g.addEventListener('pointerleave', () => hideTip(frame));
    g.addEventListener('blur', () => hideTip(frame));
    return g;
  });
  rovingFocus(marks, linearNext(marks.length), () => {});
  frame.plot.replaceChildren(root);
}

/** Draws the cap chart into `container` with its table twin. Redraws on resize. */
export function renderCap(container: HTMLElement, chart: CapChart, opts: CapOptions): ChartHandle {
  const frame = createFrame(container, { title: opts.title, caption: opts.caption });
  fillTable(frame.tableWrap, opts.title, [{ label: 'Figure' }, { label: 'Value', num: true }, { label: 'Limit', num: true }, { label: 'Source' }],
    chart.rows.map((row) => [row.label, formatValue(chart.unit, row.value), formatValue(chart.unit, row.limit), opts.citeText(row)]));
  const stop = observeWidth(frame.plot, (width) => draw(frame, chart, opts, width));
  return { frame, destroy: () => { stop(); frame.destroy(); } };
}
