// SPDX-License-Identifier: Apache-2.0
// Bullet charts: one measured value against its goal. Right is always better, whichever way the metric runs,
// because the scale goes from the floor (scores 0) to the goal (scores 100).

import type { Lens, Stage, Status } from './svg.ts';
import { clamp, esc, fmtValue, icon, isEmptyStatus, pct, provenance, safeHref, statusWord, tableView, lensKey } from './svg.ts';

export interface BulletProps {
  label: string;
  value: number | null;
  unit?: string;
  floor: number;
  goal: number;
  baseline?: number;
  lens?: Lens;
  status?: Status;
  time?: string;
  stage?: Stage;
  href?: string;
}

/** Where the goal tick sits on the bar. The rest of the bar shows a value that beats its goal. */
export const GOAL_AT = 0.875;

/** Position on the bar, 0 to 1, for a value between a floor and a goal, in either direction. */
export function bulletPosition(value: number, floor: number, goal: number): number {
  if (goal === floor) return GOAL_AT;
  return clamp(((value - floor) / (goal - floor)) * GOAL_AT);
}

function bar(props: BulletProps, position: number, empty: boolean): string {
  const lens = lensKey(props.lens);
  const goal = pct(GOAL_AT);
  const fill = empty
    ? ''
    : `<rect class="qs-fill-${lens}" x="0" y="6" width="${pct(position)}" height="10" rx="3"/>`;
  const base =
    props.baseline === undefined || empty
      ? ''
      : `<line class="qs-tick-base" x1="${pct(bulletPosition(props.baseline, props.floor, props.goal))}" x2="${pct(bulletPosition(props.baseline, props.floor, props.goal))}" y1="3" y2="19"/>`;
  return (
    `<svg class="qs-bullet-bar" width="100%" height="22" aria-hidden="true">` +
    `<rect class="${empty ? 'qs-track-empty' : `qs-track-${lens}`}" x="0" y="6" width="100%" height="10" rx="3"/>` +
    `${fill}${base}<line class="qs-goal" x1="${goal}" x2="${goal}" y1="1" y2="21"/></svg>`
  );
}

/** One bullet row. A missing, stale or thin reading shows as an empty red bar and a word. */
export function bullet(props: BulletProps): string {
  const empty = isEmptyStatus(props.status, props.value);
  const value = props.value ?? 0;
  const clean = props.status === 'no_events';
  const position = empty ? 0 : clean ? GOAL_AT : bulletPosition(value, props.floor, props.goal);
  const atGoal = !empty && position >= GOAL_AT;
  const shown = empty
    ? `${icon('alert')}<span class="qs-state-word">${esc(statusWord(props.status) || 'Missing')}</span>`
    : `${atGoal ? icon('check') : ''}<b>${clean ? 'No events' : esc(fmtValue(value, props.unit))}</b>`;
  const href = safeHref(props.href);
  const name = href ? `<a href="${esc(href)}">${esc(props.label)}</a>` : esc(props.label);
  return (
    `<div class="qs-bullet${empty ? ' is-empty' : ''}">` +
    `<div class="qs-bullet-name">${name}</div>` +
    `<div class="qs-bullet-value">${shown}</div>` +
    `${bar(props, position, empty)}` +
    `<div class="qs-bullet-scale"><span>${esc(fmtValue(props.floor, props.unit))}</span><span class="qs-bullet-goal">◆ ${esc(fmtValue(props.goal, props.unit))}</span>${provenance(props.time, props.stage)}</div>` +
    `</div>`
  );
}

/** A group of bullets with one table view behind them. */
export function bullets(caption: string, rows: BulletProps[]): string {
  const table = rows.map((row) => [
    row.label,
    row.status === 'no_events' ? 'No events' : isEmptyStatus(row.status, row.value) ? statusWord(row.status) || 'Missing' : fmtValue(row.value ?? 0, row.unit),
    fmtValue(row.goal, row.unit),
    fmtValue(row.floor, row.unit),
    row.time ?? '',
    row.stage ?? '',
  ]);
  return `<figure class="qs-chart qs-bullets"><figcaption class="qs-sr">${esc(caption)}</figcaption>${rows.map(bullet).join('')}${tableView(caption, ['Metric', 'Value', 'Goal', 'Floor', 'Measured', 'How'], table)}</figure>`;
}
