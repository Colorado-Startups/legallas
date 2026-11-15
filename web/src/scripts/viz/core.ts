// SPDX-License-Identifier: Apache-2.0
// Card F5b (Charts viz). Shared pieces for every chart in viz/: the side shapes from web/DESIGN.md section 3,
// element helpers, money and count formatting, the chart frame (title, Chart/Table toggle, tooltip) and the
// resize and motion hooks. CSP: no style= attributes anywhere; dynamic values go through presentation
// attributes or el.style.setProperty, and every color comes from charts.css through classes and data attributes.

import type { Side } from '../../../worker/matter-types.ts';

/** The SVG XML namespace. */
export const SVG_NS = 'http://www.w3.org/2000/svg';

/** A mark's side, plus `filing` for events and `none` for parties the record does not name. */
export type MarkSide = Side | 'filing' | 'none';

/** The canonical shapes, on a 16 by 16 viewBox. Scale the viewBox, never the path. */
export const SHAPES: Record<MarkSide, { tag: 'circle' | 'path' | 'rect'; attrs: Record<string, string> }> = {
  client: { tag: 'circle', attrs: { cx: '8', cy: '8', r: '6' } },
  defendant: { tag: 'path', attrs: { d: 'M8 1.5 14.5 8 8 14.5 1.5 8Z' } },
  nominal: { tag: 'path', attrs: { d: 'M8 1.5 13.6 4.75v6.5L8 14.5 2.4 11.25v-6.5Z' } },
  court: { tag: 'rect', attrs: { x: '2.5', y: '2.5', width: '11', height: '11' } },
  third: { tag: 'path', attrs: { d: 'M8 2 14.5 13.5h-13Z' } },
  filing: { tag: 'rect', attrs: { x: '2.75', y: '2.75', width: '10.5', height: '10.5' } },
  none: { tag: 'circle', attrs: { cx: '8', cy: '8', r: '5.25' } },
};

/** Words for each side, for legends, labels and tables. */
export const SIDE_WORDS: Record<MarkSide, string> = {
  client: 'Client side',
  defendant: 'Defendants',
  nominal: 'Company and nominal parties',
  court: 'Court',
  third: 'Third parties',
  filing: 'Filing or order',
  none: 'Not stated',
};

/** Series without a side take these in input order: color follows the series, never its rank. */
export const SERIES_ORDER: readonly Side[] = ['client', 'nominal', 'third', 'defendant', 'court'];

/** The side for a series: the one given, or one chosen by its position in the series order. */
export function seriesSide(index: number, side?: MarkSide | null): MarkSide {
  return side ?? SERIES_ORDER[index % SERIES_ORDER.length];
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const USD_WHOLE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const USD_COMPACT = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
});
const COUNT = new Intl.NumberFormat('en-US');

/** Whole cents to USD, at the edge only: "$1,250" for whole dollars, "$1,250.40" otherwise. */
export function formatUsd(cents: number): string {
  if (!Number.isFinite(cents)) return '';
  const dollars = cents / 100;
  return Number.isInteger(cents / 100) ? USD_WHOLE.format(dollars) : USD.format(dollars);
}

/** Axis ticks: "$1.3M", "$250K", "$900". */
export function formatUsdCompact(cents: number): string {
  return Number.isFinite(cents) ? USD_COMPACT.format(cents / 100) : '';
}

/** Formats a count as text, or an empty string when it is not a finite number. */
export function formatCount(n: number): string {
  return Number.isFinite(n) ? COUNT.format(n) : '';
}

/** How a chart reads its numbers: `usd` values are whole cents. */
export type ValueKind = 'usd' | 'count';

/** Formats a value as a count or as dollars, in compact dollars when asked. */
export function formatValue(kind: ValueKind, n: number, compact = false): string {
  if (kind === 'count') return formatCount(n);
  return compact ? formatUsdCompact(n) : formatUsd(n);
}

/** Cents must be whole: a fractional or non-finite amount is a data error, refused rather than rounded. */
export function assertCents(cents: number, what: string): void {
  if (!Number.isSafeInteger(cents)) throw new Error(`${what}: amount must be whole cents`);
}

type Attrs = Record<string, string | number | boolean | null | undefined>;

function setAttrs(node: Element, attrs: Attrs): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
}

/** Creates an SVG element with attributes, appended to a parent when one is given. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Attrs = {}, parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  setAttrs(node, attrs);
  parent?.append(node);
  return node;
}

/** Creates an HTML element with attributes and optional text, appended to a parent when one is given. */
export function html<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs = {}, parent?: Element, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  setAttrs(node, attrs);
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
}

/** A side shape as a nested <svg>, `size` px square, centered on (cx, cy) when given. */
export function shapeSvg(side: MarkSide, size: number, parent?: Element, cx?: number, cy?: number): SVGSVGElement {
  const box = svg('svg', {
    class: 'c-shape viz-mark', 'data-side': side, viewBox: '0 0 16 16', width: size, height: size,
    x: cx === undefined ? undefined : cx - size / 2, y: cy === undefined ? undefined : cy - size / 2,
    'aria-hidden': 'true', focusable: 'false',
  }, parent);
  box.style.setProperty('--shape-size', `${size}px`); // F1's .c-shape sizes from this, over the attributes
  const spec = SHAPES[side];
  svg(spec.tag, spec.attrs, box);
  return box;
}

/** Whether the reader asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Calls `draw(width)` now and whenever the element's width changes. Returns the disconnect. */
export function observeWidth(target: Element, draw: (width: number) => void): () => void {
  let last = -1;
  const run = (width: number) => {
    const w = Math.round(width);
    if (w === last || w <= 0) return;
    last = w;
    draw(w);
  };
  run(target.getBoundingClientRect().width);
  if (typeof ResizeObserver !== 'function') return () => {};
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) run(entry.contentRect.width);
  });
  observer.observe(target);
  return () => observer.disconnect();
}

/** A table column: header text plus whether it holds numbers (right-aligned, tabular). */
export interface Column {
  label: string;
  num?: boolean;
}

/** The elements of a chart frame: its root, plot, table wrapper and tooltip. */
export interface Frame {
  root: HTMLElement;
  plot: HTMLElement;
  tableWrap: HTMLElement;
  tip: HTMLElement;
  /** Shows the table instead of the chart, or back. */
  setView(view: 'chart' | 'table'): void;
  destroy(): void;
}

/** What every render function returns. */
export interface ChartHandle {
  frame: Frame;
  destroy(): void;
}

/** Options for a chart frame: its title and a one-sentence caption. */
export interface FrameOptions {
  title: string;
  /** One sentence under the title (what is plotted, and the unit). */
  caption?: string;
  /** Starts on the table, for pages whose own toggle chose it. */
  view?: 'chart' | 'table';
}

/** The figure every chart sits in: title, a Chart / Table toggle, the plot, the table twin and one tooltip. */
export function createFrame(container: HTMLElement, opts: FrameOptions): Frame {
  const root = html('figure', { class: 'viz' }, container);
  const head = html('figcaption', { class: 'viz__head' }, root);
  html('span', { class: 'viz__title t-label' }, head, opts.title);
  const toggle = html('button', { type: 'button', class: 'c-button c-button--quiet viz__toggle', 'aria-pressed': 'false' }, head, 'Table');
  if (opts.caption) html('p', { class: 'viz__caption t-caption' }, root, opts.caption);
  const plot = html('div', { class: 'viz__plot' }, root);
  const tableWrap = html('div', { class: 'c-table-wrap viz__table', hidden: true }, root);
  const tip = html('div', { class: 'viz__tip', role: 'status', 'aria-live': 'polite', hidden: true }, root);
  const setView = (view: 'chart' | 'table') => {
    const table = view === 'table';
    toggle.setAttribute('aria-pressed', String(table));
    plot.hidden = table;
    tableWrap.hidden = !table;
    tip.hidden = true;
  };
  toggle.addEventListener('click', () => setView(plot.hidden ? 'chart' : 'table'));
  setView(opts.view ?? 'chart');
  return { root, plot, tableWrap, tip, setView, destroy: () => root.remove() };
}

/** Fills the frame's table twin. Cells are text only (labels are untrusted data). */
export function fillTable(wrap: HTMLElement, caption: string, columns: Column[], rows: string[][]): HTMLTableElement {
  wrap.replaceChildren();
  const table = html('table', { class: 'c-table' }, wrap);
  html('caption', { class: 'u-vh' }, table, caption);
  const headRow = html('tr', {}, html('thead', {}, table));
  for (const col of columns) html('th', { scope: 'col', class: col.num ? 'c-table__num' : undefined }, headRow, col.label);
  const body = html('tbody', {}, table);
  for (const row of rows) {
    const tr = html('tr', {}, body);
    row.forEach((cell, i) => html(i === 0 ? 'th' : 'td', {
      scope: i === 0 ? 'row' : undefined, class: columns[i]?.num ? 'c-table__num' : undefined,
    }, tr, cell));
  }
  return table;
}

/** One line in the tooltip: the value leads, the name follows, keyed by a short mark of its side. */
export interface TipLine {
  value: string;
  label: string;
  side?: MarkSide;
}

/** Shows the frame's tooltip beside `anchor` (a mark or its hit area). Text only. */
export function showTip(frame: Frame, anchor: Element, heading: string, lines: TipLine[]): void {
  const { tip, root } = frame;
  tip.replaceChildren();
  html('p', { class: 'viz__tip-head t-small' }, tip, heading);
  for (const line of lines) {
    const row = html('p', { class: 'viz__tip-row' }, tip);
    if (line.side) html('span', { class: 'viz__key', 'data-side': line.side, 'aria-hidden': 'true' }, row);
    html('strong', { class: 'viz__tip-value' }, row, line.value);
    html('span', { class: 'viz__tip-label' }, row, line.label);
  }
  tip.hidden = false;
  const box = root.getBoundingClientRect();
  const at = anchor.getBoundingClientRect();
  const left = Math.min(Math.max(at.left + at.width / 2 - box.left, 0), Math.max(box.width - tip.offsetWidth, 0));
  tip.style.setProperty('--tip-x', `${Math.round(left)}px`);
  tip.style.setProperty('--tip-y', `${Math.round(at.bottom - box.top + 8)}px`);
}

/** Hides the frame's tooltip. */
export function hideTip(frame: Frame): void {
  frame.tip.hidden = true;
}

/**
 * Roving focus over a chart's marks: one Tab stop, arrows move, Home and End jump. `next` picks the index an
 * arrow moves to (a grid moves by rows, a graph by direction); return -1 to stay.
 */
export function rovingFocus(
  marks: Element[], next: (from: number, key: string) => number, onFocus: (index: number) => void,
): (index: number) => void {
  const focusAt = (index: number) => {
    marks.forEach((m, i) => m.setAttribute('tabindex', i === index ? '0' : '-1'));
    (marks[index] as HTMLElement | SVGElement | undefined)?.focus();
  };
  marks.forEach((mark, i) => {
    mark.setAttribute('tabindex', i === 0 ? '0' : '-1');
    mark.addEventListener('focus', () => onFocus(i));
    mark.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      let to = -1;
      if (key === 'Home') to = 0;
      else if (key === 'End') to = marks.length - 1;
      else if (key.startsWith('Arrow')) to = next(i, key);
      if (to < 0 || to === i || to >= marks.length) return;
      event.preventDefault();
      focusAt(to);
    });
  });
  return focusAt;
}

/** Arrow handling for marks in one line: Right/Down forward, Left/Up back. */
export function linearNext(count: number): (from: number, key: string) => number {
  return (from, key) => {
    if (key === 'ArrowRight' || key === 'ArrowDown') return Math.min(from + 1, count - 1);
    if (key === 'ArrowLeft' || key === 'ArrowUp') return Math.max(from - 1, 0);
    return -1;
  };
}

/** Estimated rendered width of a label at `px` size, for layout before any text exists (Inter averages 0.56em). */
export function textWidth(text: string, px = 12): number {
  return Math.ceil(text.length * px * 0.56);
}

/** Cuts a label to fit `maxPx`, ending in an ellipsis. The full text stays in the table and tooltip. */
export function fitLabel(text: string, maxPx: number, px = 12): string {
  if (textWidth(text, px) <= maxPx) return text;
  const chars = Math.max(Math.floor(maxPx / (px * 0.56)) - 1, 1);
  return `${text.slice(0, chars).trimEnd()}…`;
}
