// SPDX-License-Identifier: Apache-2.0
// Card F5b (Charts viz). Sparklines: a 2px line with an end dot, no axes. `sparkPath` is pure (spark.test.ts).
// A sparkline is a figure inside a tile or a table cell, so it is role="img" with a sentence naming its ends.

import { line } from 'd3-shape';
import { scaleLinear } from 'd3-scale';
import { formatValue, svg, type ValueKind } from './core.ts';

/** A sparkline's path data and its end point. */
export interface SparkGeometry {
  d: string;
  end: { x: number; y: number } | null;
}

const PAD = 4;

/** The line through `values`, fit to `width` by `height` with room for the end dot. Non-finite values are skipped. */
export function sparkPath(values: number[], width: number, height: number): SparkGeometry {
  const points = values.map((v, i) => [i, v] as const).filter(([, v]) => Number.isFinite(v));
  if (points.length === 0) return { d: '', end: null };
  const lo = Math.min(...points.map(([, v]) => v));
  const hi = Math.max(...points.map(([, v]) => v));
  const x = scaleLinear().domain([0, Math.max(values.length - 1, 1)]).range([PAD, width - PAD]);
  const y = scaleLinear().domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi]).range([height - PAD, PAD]);
  const path = line<readonly [number, number]>().x(([i]) => x(i)).y(([, v]) => y(v));
  const last = points[points.length - 1];
  const round = (n: number) => Math.round(n * 100) / 100;
  return { d: path(points) ?? '', end: { x: round(x(last[0])), y: round(y(last[1])) } };
}

/** Options for drawing a sparkline: its size and the kind of value. */
export interface SparkOptions {
  width?: number;
  height?: number;
  kind?: ValueKind;
  /** What the values are, for the accessible name: "Documents per month". */
  label: string;
  /** Labels for the first and last values, for the accessible name: "2023-01", "2023-12". */
  from?: string;
  to?: string;
}

/** Appends a sparkline to `parent`. Its accessible name states the first and last values. */
export function renderSpark(parent: Element, values: number[], opts: SparkOptions): SVGSVGElement {
  const width = opts.width ?? 96;
  const height = opts.height ?? 24;
  const kind = opts.kind ?? 'count';
  const geo = sparkPath(values, width, height);
  const finite = values.filter((v) => Number.isFinite(v));
  const first = finite.length ? formatValue(kind, finite[0]) : '';
  const last = finite.length ? formatValue(kind, finite[finite.length - 1]) : '';
  const name = finite.length
    ? `${opts.label}: ${first}${opts.from ? ` in ${opts.from}` : ''} to ${last}${opts.to ? ` in ${opts.to}` : ''}`
    : `${opts.label}: no values`;
  const root = svg('svg', { class: 'viz-spark', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': name }, parent);
  if (geo.d) svg('path', { class: 'viz-spark__line', d: geo.d }, root);
  if (geo.end) svg('circle', { class: 'viz-spark__end', cx: geo.end.x, cy: geo.end.y, r: 3 }, root);
  return root;
}
