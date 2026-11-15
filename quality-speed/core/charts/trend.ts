// SPDX-License-Identifier: Apache-2.0
// The trend line. The plot is a nested SVG stretched to the chart's width, with a stroke that doesn't stretch,
// and the labels sit in the outer SVG at percentage positions, so text stays one size from phone to desktop.
// Each point has a plain hover area, and the table behind the icon holds every value.

import type { Lens, Stage, Status } from './svg.ts';
import { clamp, esc, fmtDate, fmtValue, icon, isEmptyStatus, isNum, num, provenance, statusWord, tableView, lensKey } from './svg.ts';

export interface TrendPoint {
  t: string;
  /** Null or not a number is a missing reading: it breaks the line and shows red. */
  v: number | null;
}

export interface TrendProps {
  label: string;
  points: TrendPoint[];
  unit?: string;
  goal?: number;
  floor?: number;
  baseline?: number;
  lens?: Lens;
  /** Fixed value range, for example `[0, 100]` for scores. */
  domain?: [number, number];
  height?: number;
  status?: Status;
  stage?: Stage;
}

const PAD_TOP = 24;
const PAD_BOTTOM = 22;
const X_LEFT = 1;
const X_SPAN = 97;

function domainOf(props: TrendProps): [number, number] {
  if (props.domain) return props.domain;
  const values = [...props.points.map((p) => p.v).filter(isNum), ...(props.goal === undefined ? [] : [props.goal])];
  if (props.baseline !== undefined) values.push(props.baseline);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = hi === lo ? Math.abs(hi) * 0.1 || 1 : (hi - lo) * 0.12;
  return [lo - pad, hi + pad];
}

interface Spot {
  x: number;
  y: number;
}

/** The measured stretches of a line. A missing point ends one, so a gap never reads as a straight run. */
function stretches(spots: (Spot | null)[]): Spot[][] {
  const runs: Spot[][] = [[]];
  for (const spot of spots) {
    if (spot) runs.at(-1)?.push(spot);
    else runs.push([]);
  }
  return runs.filter((run) => run.length > 0);
}

/**
 * A stretch as an SVG path. One point alone draws as a dot, through its round cap. Pairs after the M are implicit
 * line-tos, so the path holds one letter however long the history: the guard counts letter runs as words.
 */
function pathOf(run: Spot[]): string {
  const pairs = (run.length === 1 ? [run[0], run[0]] : run).map((spot) => `${spot?.x} ${spot?.y}`);
  return `M${pairs.join(' ')}`;
}

interface Plot {
  xs: number[];
  ys: (number | null)[];
  yOf: (v: number) => number;
}

function plotOf(props: TrendProps, height: number): Plot {
  const [lo, hi] = domainOf(props);
  const span = height - PAD_TOP - PAD_BOTTOM;
  const yOf = (v: number) => Number((PAD_TOP + (1 - clamp((v - lo) / (hi - lo || 1))) * span).toFixed(2));
  const count = props.points.length;
  const xs = props.points.map((_, i) => Number((X_LEFT + (count < 2 ? 1 : i / (count - 1)) * X_SPAN).toFixed(2)));
  return { xs, ys: props.points.map((p) => (isNum(p.v) ? yOf(p.v) : null)), yOf };
}

function refLine(y: number, cls: string, text: string, labelY: number): string {
  return `<line class="${cls}" x1="0" x2="100%" y1="${y}" y2="${y}"/><text class="qs-ref" x="0" y="${labelY}">${esc(text)}</text>`;
}

/** The line usually starts at its baseline, so the label goes on the side the line moves away from. */
function baselineLabelY(plot: Plot, y: number, bottom: number): number {
  const measured = plot.ys.filter(isNum);
  const rising = (measured[0] ?? 0) >= (measured.at(-1) ?? 0);
  return rising ? Math.min(y + 14, bottom - 2) : y - 4;
}

/** The end value sits above the last point on a rising line and below it on a falling one, clear of the line. */
function endLabel(plot: Plot, text: string, height: number): string {
  const last = plot.ys.length - 1;
  const lastY = plot.ys[last] ?? 0;
  const before = plot.ys[last - 1];
  const falling = isNum(before) && before < lastY;
  const y = falling ? Math.min(height - PAD_BOTTOM - 2, lastY + 18) : Math.max(12, lastY - 10);
  return `<text class="qs-end" x="100%" y="${y}" text-anchor="end">${esc(text)}</text>`;
}

function emptyTrend(props: TrendProps): string {
  const word = statusWord(props.status) || 'Too few';
  return `<figure class="qs-chart qs-trend is-empty"><figcaption>${esc(props.label)}</figcaption><div class="qs-trend-empty">${icon('alert')}<span class="qs-state-word">${esc(word)}</span></div></figure>`;
}

/** One line over time, with its goal, its baseline, a crosshair and a table view. */
export function trend(props: TrendProps): string {
  const height = isNum(props.height) ? props.height : 160;
  const measured = props.points.filter((p) => isNum(p.v));
  if (measured.length < 2 || isEmptyStatus(props.status, props.points.at(-1)?.v)) return emptyTrend(props);
  const plot = plotOf(props, height);
  const lens = lensKey(props.lens);
  const runs = stretches(plot.xs.map((x, i) => {
    const y = plot.ys[i];
    return isNum(y) ? { x, y } : null;
  }));
  const line = runs.map(pathOf).join('');
  const baseY = height - PAD_BOTTOM;
  const area = runs.map((run) => `${pathOf(run)}L${run.at(-1)?.x} ${baseY}L${run[0]?.x} ${baseY}Z`).join('');
  const formatted = props.points.map((p) => fmtValue(p.v ?? Number.NaN, props.unit));
  const dates = props.points.map((p) => fmtDate(p.t));
  const refs = [
    props.goal === undefined ? '' : refLine(plot.yOf(props.goal), 'qs-goal-line', `◆ ${fmtValue(props.goal, props.unit)}`, plot.yOf(props.goal) - 4),
    props.baseline === undefined ? '' : refLine(plot.yOf(props.baseline), 'qs-base-line', `▽ ${fmtValue(props.baseline, props.unit)}`, baselineLabelY(plot, plot.yOf(props.baseline), baseY)),
  ].join('');
  const last = props.points.length - 1;
  const first = props.points.findIndex((p) => isNum(p.v));
  const gapCount = props.points.length - measured.length;
  const spoken = `${props.label}: ${formatted[last]} on ${dates[last]}, from ${formatted[first]} on ${dates[first]}.${props.goal === undefined ? '' : ` Goal ${fmtValue(props.goal, props.unit)}.`}${gapCount ? ` ${gapCount} missing.` : ''}`;
  const gaps = plot.xs
    .filter((_, i) => !isNum(plot.ys[i]))
    .map((x) => `<line class="qs-gap" x1="${x}%" x2="${x}%" y1="${PAD_TOP}" y2="${baseY}"/>`)
    .join('');
  const hits = plot.xs
    .map((pointX, i) => {
      const left = i === 0 ? 0 : (pointX + (plot.xs[i - 1] ?? 0)) / 2;
      const right = i === last ? 100 : (pointX + (plot.xs[i + 1] ?? 0)) / 2;
      return `<rect class="qs-hit" x="${num(left)}%" y="0" width="${num(right - left)}%" height="${baseY}" data-tv="${esc(formatted[i])}" data-tl="${esc(dates[i])}"/>`;
    })
    .join('');
  const svg =
    `<svg class="qs-trend-svg" width="100%" height="${height}" role="img" aria-label="${esc(spoken)}">` +
    `<line class="qs-axis" x1="0" x2="100%" y1="${baseY}" y2="${baseY}"/>${refs}${gaps}` +
    `<svg x="0" y="0" width="100%" height="${height}" viewBox="0 0 100 ${height}" preserveAspectRatio="none">` +
    `<path class="qs-area-${lens}" d="${area}"/><path class="qs-line-${lens}" d="${line}" vector-effect="non-scaling-stroke"/></svg>` +
    `<circle class="qs-dot-${lens}" cx="${plot.xs[last]}%" cy="${plot.ys[last]}" r="4.5"/>${endLabel(plot, formatted[last] ?? '', height)}` +
    `<text class="qs-tick-label" x="0" y="${height - 6}">${esc(dates[0])}</text>` +
    `<text class="qs-tick-label" x="100%" y="${height - 6}" text-anchor="end">${esc(dates[last])}</text>${hits}</svg>`;
  const table = props.points.map((p, i) => [p.t, formatted[i] ?? '']);
  return `<figure class="qs-chart qs-trend"><figcaption>${esc(props.label)}${provenance(props.points[last]?.t, props.stage)}</figcaption>${svg}${tableView(props.label, ['Date', 'Value'], table)}</figure>`;
}

/** A small line with no axes, for a stat tile. Decorative: the tile's number carries the value. */
export function sparkline(values: (number | null)[], cls = 'qs-spark'): string {
  const measured = values.filter(isNum);
  if (measured.length < 2) return '';
  const lo = Math.min(...measured);
  const hi = Math.max(...measured);
  const spots = values.map((v, i) => (isNum(v) ? { x: Number(num((i / (values.length - 1)) * 96 + 2)), y: Number(num(22 - clamp((v - lo) / (hi - lo || 1)) * 18)) } : null));
  const runs = stretches(spots);
  const end = runs.at(-1)?.at(-1);
  return (
    `<svg class="${esc(cls)}" width="100%" height="26" aria-hidden="true">` +
    `<svg x="0" y="0" width="100%" height="26" viewBox="0 0 100 26" preserveAspectRatio="none"><path d="${runs.map(pathOf).join('')}" vector-effect="non-scaling-stroke"/></svg>` +
    `<circle cx="${end?.x}%" cy="${end?.y}" r="3"/></svg>`
  );
}
