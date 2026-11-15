// SPDX-License-Identifier: Apache-2.0
// Card F5b (Charts viz). Bar charts: one series, grouped or stacked, horizontal or vertical. `layoutBars` is
// pure (tested in bar.test.ts); `renderBars` draws it with a legend, tooltip, keyboard focus and a table twin.
// Marks: at most 24px thick, a 4px rounded data end and a square baseline, a 2px surface gap between segments.

import { scaleBand, scaleLinear } from 'd3-scale';
import {
  createFrame, fillTable, fitLabel, formatValue, hideTip, html, linearNext, observeWidth, rovingFocus, seriesSide,
  shapeSvg, showTip, svg, textWidth, type ChartHandle, type Frame, type MarkSide, type ValueKind,
} from './core.ts';
import type { MoneySeries } from './money.ts';

/** One category of a bar chart, with its id and label. */
export interface BarCategory { id: string; label: string }
/** One series of a bar chart: its id, label and optionally the side that colors it. */
export interface BarSeries {
  id: string;
  label: string;
  side?: MarkSide | null;
  /** For money bars: which series (R43) the values belong to. A stack never mixes the two. */
  series?: MoneySeries;
}

/** `values[c][s]` is category c, series s; values are non-negative (cents when `kind` is usd). */
export interface BarData {
  categories: BarCategory[];
  series: BarSeries[];
  values: number[][];
}

/** Inputs to the bar layout: the width, the orientation and whether bars stack. */
export interface BarLayoutOptions {
  width: number;
  orientation: 'horizontal' | 'vertical';
  stacked: boolean;
  kind: ValueKind;
  /** Plot height for vertical bars; horizontal bars size themselves by row. */
  height?: number;
}

/** One laid-out bar: its category, series, value, path and hit box. */
export interface BarRect { cat: number; series: number; value: number; d: string; hit: Box }
/** A rectangle by x, y, width and height. */
export interface Box { x: number; y: number; w: number; h: number }
/** An axis tick: its value, position and label. */
export interface Tick { value: number; pos: number; label: string }
/** A category label: its shortened and full text, and its position. */
export interface CatLabel { text: string; full: string; x: number; y: number }
/** The label of a stack's total, with its position and text anchor. */
export interface TotalLabel { text: string; x: number; y: number; anchor: 'start' | 'middle' }

/** The computed bar chart layout: its size, its plot box and the shapes to draw. */
export interface BarLayout {
  width: number;
  height: number;
  plot: Box;
  rects: BarRect[];
  ticks: Tick[];
  cats: CatLabel[];
  totals: TotalLabel[];
}

/** The thickest one bar is drawn, in pixels. */
export const BAR_MAX = 24;
/** The space between neighbouring bars, in pixels. */
export const BAR_GAP = 2;
const RADIUS = 4;
const HIT_MIN = 24;
const ROW = 36;
const AXIS_BAND = 24;

/** A bar outline with only its data end rounded. `end` names the side the data grows toward. */
export function barPath(b: Box, end: 'right' | 'top' | 'none'): string {
  const { x, y, w, h } = b;
  const r = end === 'none' ? 0 : Math.max(0, Math.min(RADIUS, (end === 'right' ? w : h) / 2, (end === 'right' ? h : w) / 2));
  const n = (v: number) => Math.round(v * 100) / 100;
  if (r === 0) return `M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`;
  if (end === 'right') {
    return `M${n(x)} ${n(y)}H${n(x + w - r)}A${r} ${r} 0 0 1 ${n(x + w)} ${n(y + r)}V${n(y + h - r)}`
      + `A${r} ${r} 0 0 1 ${n(x + w - r)} ${n(y + h)}H${n(x)}Z`;
  }
  return `M${n(x)} ${n(y + h)}V${n(y + r)}A${r} ${r} 0 0 1 ${n(x + r)} ${n(y)}H${n(x + w - r)}`
    + `A${r} ${r} 0 0 1 ${n(x + w)} ${n(y + r)}V${n(y + h)}Z`;
}

function clean(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** The largest bar end: a category's sum when stacked, its largest single value otherwise. */
export function barMax(data: BarData, stacked: boolean): number {
  let max = 0;
  data.values.forEach((row) => {
    const vals = data.series.map((_, s) => clean(row[s]));
    max = Math.max(max, stacked ? vals.reduce((a, b) => a + b, 0) : Math.max(0, ...vals));
  });
  return max;
}

interface Slot { cat: number; series: number; start: number; end: number; band0: number; thick: number; last: boolean }

/** Splits each category band into marks: one per series side by side, or one stack. Positions in value units. */
function slots(data: BarData, opts: BarLayoutOptions, bandStart: (c: number) => number, bandWidth: number): Slot[] {
  const out: Slot[] = [];
  const n = data.series.length;
  const groupThick = opts.stacked || n === 1 ? Math.min(BAR_MAX, bandWidth * 0.7) : Math.min(BAR_MAX, (bandWidth * 0.8) / n - 1);
  data.categories.forEach((_, c) => {
    const row = data.series.map((__, s) => clean(data.values[c]?.[s]));
    const lastNonZero = row.reduce((at, v, s) => (v > 0 ? s : at), -1);
    let acc = 0;
    row.forEach((v, s) => {
      if (opts.stacked || n === 1) {
        const band0 = bandStart(c) + (bandWidth - groupThick) / 2;
        out.push({ cat: c, series: s, start: acc, end: acc + v, band0, thick: groupThick, last: s === lastNonZero });
        acc += v;
      } else {
        const span = n * groupThick + (n - 1) * BAR_GAP;
        const band0 = bandStart(c) + (bandWidth - span) / 2 + s * (groupThick + BAR_GAP);
        out.push({ cat: c, series: s, start: 0, end: v, band0, thick: groupThick, last: true });
      }
    });
  });
  return out.filter((sl) => sl.end > sl.start);
}

function totalsOf(data: BarData, stacked: boolean): number[] {
  return data.categories.map((_, c) => {
    const vals = data.series.map((__, s) => clean(data.values[c]?.[s]));
    return stacked || data.series.length === 1 ? vals.reduce((a, b) => a + b, 0) : 0;
  });
}

/**
 * A stack sums its segments, so a stacked chart may not hold both a promise series and a movement series (R43).
 * Grouped bars sit side by side and are never summed, so they may.
 */
export function assertStackable(data: BarData, stacked: boolean): void {
  if (!stacked) return;
  const kinds = new Set(data.series.flatMap((s) => (s.series ? [s.series] : [])));
  if (kinds.size > 1) throw new Error('renderBars: a stack cannot add promises to movements; use grouped bars or two charts');
}

/** Computes the layout of a bar chart, horizontal or vertical. */
export function layoutBars(data: BarData, opts: BarLayoutOptions): BarLayout {
  assertStackable(data, opts.stacked);
  return opts.orientation === 'horizontal' ? layoutHorizontal(data, opts) : layoutVertical(data, opts);
}

function layoutHorizontal(data: BarData, opts: BarLayoutOptions): BarLayout {
  const max = barMax(data, opts.stacked);
  const grouped = !opts.stacked && data.series.length > 1;
  const row = grouped ? Math.max(ROW, data.series.length * 14 + 12) : ROW;
  const labelW = Math.min(Math.max(0, ...data.categories.map((c) => textWidth(c.label))) + 8, Math.round(opts.width * 0.38));
  const valueW = textWidth(formatValue(opts.kind, max, true)) + 8;
  const plot: Box = { x: labelW, y: 4, w: Math.max(opts.width - labelW - valueW, 40), h: data.categories.length * row };
  const x = scaleLinear().domain([0, max || 1]).nice().range([plot.x, plot.x + plot.w]);
  const band = scaleBand<number>().domain(data.categories.map((_, i) => i)).range([plot.y, plot.y + plot.h]);
  const rects = slots(data, opts, (c) => band(c) ?? 0, band.bandwidth()).map((sl) => {
    const x0 = x(sl.start);
    const w = Math.max(x(sl.end) - x0 - (sl.last ? 0 : BAR_GAP), 1);
    const box = { x: x0, y: sl.band0, w, h: sl.thick };
    const hitH = Math.max(sl.thick, HIT_MIN);
    return { cat: sl.cat, series: sl.series, value: sl.end - sl.start, d: barPath(box, sl.last ? 'right' : 'none'),
      hit: { x: x0, y: sl.band0 + sl.thick / 2 - hitH / 2, w: Math.max(w, 4), h: hitH } };
  });
  const ticks = x.ticks(Math.max(2, Math.floor(plot.w / 90))).map((v) => ({ value: v, pos: x(v), label: formatValue(opts.kind, v, true) }));
  const cats = data.categories.map((c, i) => ({ text: fitLabel(c.label, labelW - 8), full: c.label, x: labelW - 8, y: (band(i) ?? 0) + band.bandwidth() / 2 }));
  const totals = totalsOf(data, opts.stacked).flatMap((t, i) => (t > 0
    ? [{ text: formatValue(opts.kind, t, true), x: x(t) + 6, y: (band(i) ?? 0) + band.bandwidth() / 2, anchor: 'start' as const }] : []));
  return { width: opts.width, height: plot.y + plot.h + AXIS_BAND, plot, rects, ticks, cats, totals };
}

function layoutVertical(data: BarData, opts: BarLayoutOptions): BarLayout {
  const max = barMax(data, opts.stacked);
  const axisW = textWidth(formatValue(opts.kind, max, true)) + 10;
  const plotH = opts.height ?? 220;
  const plot: Box = { x: axisW, y: 18, w: Math.max(opts.width - axisW - 4, 40), h: plotH };
  const y = scaleLinear().domain([0, max || 1]).nice().range([plot.y + plot.h, plot.y]);
  const band = scaleBand<number>().domain(data.categories.map((_, i) => i)).range([plot.x, plot.x + plot.w]).paddingInner(0.2);
  const rects = slots(data, opts, (c) => band(c) ?? 0, band.bandwidth()).map((sl) => {
    const yTop = y(sl.end);
    const h = Math.max(y(sl.start) - yTop - (sl.last ? 0 : BAR_GAP), 1);
    const box = { x: sl.band0, y: yTop + (sl.last ? 0 : BAR_GAP), w: sl.thick, h };
    const hitW = Math.max(sl.thick, HIT_MIN);
    return { cat: sl.cat, series: sl.series, value: sl.end - sl.start, d: barPath(box, sl.last ? 'top' : 'none'),
      hit: { x: sl.band0 + sl.thick / 2 - hitW / 2, y: box.y, w: hitW, h: Math.max(h, 4) } };
  });
  const ticks = y.ticks(Math.max(2, Math.floor(plot.h / 50))).map((v) => ({ value: v, pos: y(v), label: formatValue(opts.kind, v, true) }));
  const cats = data.categories.map((c, i) => ({ text: fitLabel(c.label, band.bandwidth() + band.step() * 0.2), full: c.label, x: (band(i) ?? 0) + band.bandwidth() / 2, y: plot.y + plot.h + 16 }));
  const totals = totalsOf(data, opts.stacked).flatMap((t, i) => (t > 0
    ? [{ text: formatValue(opts.kind, t, true), x: (band(i) ?? 0) + band.bandwidth() / 2, y: y(t) - 6, anchor: 'middle' as const }] : []));
  return { width: opts.width, height: plot.y + plot.h + AXIS_BAND, plot, rects, ticks, cats, totals };
}

/** A chosen bar: its category, series and value. */
export interface BarSelection { category: BarCategory; series: BarSeries; value: number }

/** Options for drawing a bar chart: the layout options without width, plus a title, caption and click callback. */
export interface BarOptions extends Omit<BarLayoutOptions, 'width'> {
  title: string;
  caption?: string;
  /** Called on click or Enter; makes each bar a button. */
  onSelect?: (selection: BarSelection) => void;
}

function drawAxes(root: SVGSVGElement, layout: BarLayout, horizontal: boolean): void {
  const { plot } = layout;
  for (const t of layout.ticks) {
    const line = horizontal
      ? { x1: t.pos, x2: t.pos, y1: plot.y, y2: plot.y + plot.h }
      : { x1: plot.x, x2: plot.x + plot.w, y1: t.pos, y2: t.pos };
    svg('line', { class: t.value === 0 ? 'viz-baseline' : 'viz-grid', ...line }, root);
    const label = svg('text', horizontal
      ? { class: 'viz-axis', x: t.pos, y: plot.y + plot.h + 16, 'text-anchor': 'middle' }
      : { class: 'viz-axis', x: plot.x - 6, y: t.pos + 4, 'text-anchor': 'end' }, root);
    label.textContent = t.label;
  }
  for (const c of layout.cats) {
    const text = svg('text', horizontal
      ? { class: 'viz-cat', x: c.x, y: c.y + 4, 'text-anchor': 'end' }
      : { class: 'viz-cat', x: c.x, y: c.y, 'text-anchor': 'middle' }, root);
    text.textContent = c.text;
    if (c.text !== c.full) svg('title', {}, text).textContent = c.full;
  }
  for (const t of layout.totals) {
    svg('text', { class: 'viz-value', x: t.x, y: t.y + (horizontal ? 4 : 0), 'text-anchor': t.anchor }, root).textContent = t.text;
  }
}

function drawLegend(frame: Frame, data: BarData): void {
  if (data.series.length < 2) return;
  const list = html('ul', { class: 'viz-legend' });
  frame.plot.before(list);
  data.series.forEach((s, i) => {
    const item = html('li', { class: 'viz-legend__item' }, list);
    shapeSvg(seriesSide(i, s.side), 12, item);
    html('span', {}, item, s.label);
  });
}

function tableFor(frame: Frame, data: BarData, opts: BarOptions): void {
  const multi = data.series.length > 1;
  const columns = [{ label: 'Category' }, ...data.series.map((s) => ({ label: multi ? s.label : 'Value', num: true }))];
  if (multi && opts.stacked) columns.push({ label: 'Total', num: true });
  const rows = data.categories.map((c, ci) => {
    const vals = data.series.map((_, s) => clean(data.values[ci]?.[s]));
    const cells = [c.label, ...vals.map((v) => formatValue(opts.kind, v))];
    if (multi && opts.stacked) cells.push(formatValue(opts.kind, vals.reduce((a, b) => a + b, 0)));
    return cells;
  });
  fillTable(frame.tableWrap, opts.title, columns, rows);
}

/** Draws a bar chart into `container`. Redraws on resize; `destroy` removes it. */
export function renderBars(container: HTMLElement, data: BarData, opts: BarOptions): ChartHandle {
  assertStackable(data, opts.stacked);
  const frame = createFrame(container, { title: opts.title, caption: opts.caption });
  drawLegend(frame, data);
  tableFor(frame, data, opts);
  const horizontal = opts.orientation === 'horizontal';
  const draw = (width: number) => {
    const layout = layoutBars(data, { ...opts, width });
    const root = svg('svg', { class: 'viz-svg', width: layout.width, height: layout.height, viewBox: `0 0 ${layout.width} ${layout.height}`, role: 'group', 'aria-label': opts.title });
    drawAxes(root, layout, horizontal);
    const marks = layout.rects.map((r) => drawBar(root, frame, data, opts, r));
    rovingFocus(marks, linearNext(marks.length), () => {});
    frame.plot.replaceChildren(root);
  };
  const stop = observeWidth(frame.plot, draw);
  return { frame, destroy: () => { stop(); frame.destroy(); } };
}

function drawBar(root: SVGSVGElement, frame: Frame, data: BarData, opts: BarOptions, r: BarRect): SVGGElement {
  const category = data.categories[r.cat];
  const series = data.series[r.series];
  const side = seriesSide(r.series, series.side);
  const value = formatValue(opts.kind, r.value);
  const name = data.series.length > 1 ? `${category.label}, ${series.label}` : category.label;
  const g = svg('g', { class: 'viz-hit', role: opts.onSelect ? 'button' : 'img', 'aria-label': `${name}: ${value}` }, root);
  svg('rect', { class: 'viz-hit__area', x: r.hit.x, y: r.hit.y, width: r.hit.w, height: r.hit.h }, g);
  svg('path', { class: 'viz-bar viz-mark', 'data-side': side, d: r.d }, g);
  const show = () => showTip(frame, g, category.label, [{ value, label: series.label, side }]);
  g.addEventListener('pointerenter', show);
  g.addEventListener('focus', show);
  g.addEventListener('pointerleave', () => hideTip(frame));
  g.addEventListener('blur', () => hideTip(frame));
  if (opts.onSelect) {
    const select = () => opts.onSelect?.({ category, series, value: r.value });
    g.addEventListener('click', select);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
  }
  return g;
}
