// SPDX-License-Identifier: Apache-2.0
// Infographic building blocks for pages to compose: counted things, a pass grid, a meter and a run of days. Each one
// shows its numbers in words or a table, so color is never alone.

import type { Lens } from './svg.ts';
import { clamp, esc, fmtDate, fmtValue, icon, iconPath, isNum, pct, sr, tableView, lensKey } from './svg.ts';

export interface PictogramProps {
  label: string;
  /** How many there should be. */
  total: number;
  /** How many are in place. */
  filled: number;
  glyph?: 'doc' | 'person' | 'check' | 'lock';
}

/** Counted things, one glyph each: the ones in place are solid, and the ones missing are empty red outlines. */
export function pictogram(props: PictogramProps): string {
  const d = iconPath(props.glyph ?? 'doc');
  const total = Math.max(0, Math.floor(Number(props.total)) || 0);
  const filled = Math.max(0, Math.floor(Number(props.filled)) || 0);
  const items = Array.from({ length: total }, (_, i) => {
    const on = i < filled;
    return `<svg class="qs-pic ${on ? 'is-on' : 'is-off'}" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="${d}"/></svg>`;
  }).join('');
  return `<figure class="qs-chart qs-pictogram" role="img" aria-label="${esc(props.label)}: ${filled} of ${total}"><figcaption>${esc(props.label)}<b>${filled}/${total}</b></figcaption><div class="qs-pics">${items}</div></figure>`;
}

export type PassState = 'pass' | 'fail' | 'na';

export interface DotMatrixProps {
  caption: string;
  rows: string[];
  cols: string[];
  /** One row per `rows`, one state per `cols`. */
  states: PassState[][];
}

/** Pass or fail for every row against every column, such as each role against each route. */
export function dotMatrix(props: DotMatrixProps): string {
  const cell = (state: PassState | undefined, row: string, col: string) => {
    // Only a listed `na` is hatched. A state that's absent or unknown is missing, in red. charts.css draws each mark from
    // data-tv, once, rather than an SVG in every cell: a grid of a few hundred cells stays inside the 100 KB first view.
    const [cls, word] =
      state === 'pass' ? ['pass', 'pass']
      : state === 'na' ? ['na', 'not applicable']
      : state === 'fail' ? ['fail', 'fail']
      : ['fail', 'missing'];
    return `<td class="qs-dm qs-dm-${cls}" data-tv="${word}" data-tl="${esc(`${row}, ${col}`)}">${sr(word)}</td>`;
  };
  const head = props.cols.map((col) => `<th scope="col">${esc(col)}</th>`).join('');
  const body = props.rows
    .map((row, r) => `<tr><th scope="row">${esc(row)}</th>${props.cols.map((col, c) => cell(props.states[r]?.[c], row, col)).join('')}</tr>`)
    .join('');
  return `<div class="qs-scroll qs-dotmatrix" tabindex="0" role="region" aria-label="${esc(props.caption)}"><table><caption>${esc(props.caption)}</caption><thead><tr><td></td>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export interface MeterProps {
  label: string;
  value: number;
  limit: number;
  unit?: string;
  /** Share of the limit where the fill turns to warning, 0 to 1. */
  warnAt?: number;
}

/** One amount against its limit, such as CI minutes used. The word changes with the color. */
export function meter(props: MeterProps): string {
  const share = clamp(props.value / (props.limit || 1));
  const warnAt = props.warnAt ?? 0.9;
  const over = !isNum(props.value) || props.value >= props.limit;
  const state = over ? 'over' : share >= warnAt ? 'warn' : 'ok';
  const mark = state === 'ok' ? '' : icon('alert');
  return (
    `<div class="qs-meter is-${state}"><div class="qs-meter-head"><span>${esc(props.label)}</span><span>${mark}<b>${esc(fmtValue(props.value, props.unit))}</b> / ${esc(fmtValue(props.limit, props.unit))}</span></div>` +
    `<svg width="100%" height="12" role="img" aria-label="${esc(props.label)}: ${esc(fmtValue(props.value, props.unit))} of ${esc(fmtValue(props.limit, props.unit))}"><rect class="qs-meter-track" width="100%" height="12" rx="3"/><rect class="qs-meter-fill" width="${pct(share)}" height="12" rx="3"/></svg></div>`
  );
}

export interface DayState {
  t: string;
  state: 'ok' | 'fail' | 'none';
}

/** A row of days or runs: one tick each, tall and solid when it passed, short and red when it failed. */
export function dayStrip(props: { label: string; days: DayState[]; lens?: Lens }): string {
  const count = props.days.length || 1;
  const lens = lensKey(props.lens);
  const ticks = props.days
    .map((day, i) => {
      const x = pct(i / count);
      const width = pct(1 / count);
      const word = day.state === 'ok' ? 'pass' : day.state === 'fail' ? 'fail' : 'no run';
      const cls = day.state === 'ok' ? `qs-fill-${lens}` : day.state === 'fail' ? 'qs-day-fail' : 'qs-day-none';
      const y = day.state === 'ok' ? 0 : day.state === 'fail' ? 10 : 16;
      const h = day.state === 'ok' ? 22 : day.state === 'fail' ? 12 : 6;
      return `<rect class="${cls}" x="${x}" y="${y}" width="${width}" height="${h}" rx="1" data-tv="${word}" data-tl="${esc(fmtDate(day.t))}"/>`;
    })
    .join('');
  const failed = props.days.filter((d) => d.state === 'fail').length;
  const passed = props.days.filter((d) => d.state === 'ok').length;
  const table = props.days.map((d) => [d.t, d.state]);
  return `<figure class="qs-chart qs-days"><figcaption>${esc(props.label)}<b>${passed}/${props.days.length}</b>${failed ? `<span class="qs-status is-bad">${icon('alert')}${failed}</span>` : ''}</figcaption><svg width="100%" height="22" aria-hidden="true">${ticks}</svg>${tableView(props.label, ['Date', 'State'], table)}</figure>`;
}

/** The key for the reference marks used across every chart. */
export function markKey(words: { goal?: string; now?: string; baseline?: string } = {}): string {
  return `<ul class="qs-mark-key"><li>◆ ${esc(words.goal ?? 'Goal')}</li><li>▼ ${esc(words.now ?? 'Now')}</li><li>▽ ${esc(words.baseline ?? 'Baseline')}</li></ul>`;
}

