// SPDX-License-Identifier: Apache-2.0
// Stat tiles, and the empty red tile a missing measurement turns into. The red tile is deliberately loud: a page
// can't rise because a check broke.

import type { Lens, Stage, Status } from './svg.ts';
import { esc, fmtValue, icon, isEmptyStatus, isNum, provenance, safeHref, statusWord, sr, lensKey } from './svg.ts';
import { sparkline } from './trend.ts';

export interface StatTileProps {
  label: string;
  value: number | null;
  unit?: string;
  /** Change from the last period, in the metric's unit. */
  delta?: number;
  /** Which way is good for this metric. Defaults to up. */
  better?: 'up' | 'down';
  spark?: number[];
  lens?: Lens;
  status?: Status;
  time?: string;
  stage?: Stage;
  href?: string;
}

function wrap(body: string, cls: string, href?: string): string {
  const link = safeHref(href);
  return link ? `<a class="${cls}" href="${esc(link)}">${body}</a>` : `<div class="${cls}">${body}</div>`;
}

/** The tile for a metric with no usable measurement. It scores 0, and says why in one word. */
export function missingTile(props: { label: string; status?: Status; href?: string }): string {
  const word = statusWord(props.status) || 'Missing';
  return wrap(`<span class="qs-tile-label">${esc(props.label)}</span><span class="qs-tile-empty">${icon('alert')}<span class="qs-state-word">${esc(word)}</span></span>`, 'qs-tile is-missing', props.href);
}

function deltaOf(props: StatTileProps): string {
  if (!isNum(props.delta) || props.delta === 0) return '';
  const up = props.delta > 0;
  const good = up === ((props.better ?? 'up') === 'up');
  const arrow = up ? '▲' : '▼';
  return `<span class="qs-delta ${good ? 'is-good' : 'is-bad'}">${arrow} ${esc(fmtValue(Math.abs(props.delta), props.unit))}${sr(good ? ' better' : ' worse')}</span>`;
}

/** A single number: label, value, optional change and sparkline, with when and how it was measured. */
export function statTile(props: StatTileProps): string {
  if (props.status !== 'no_events' && isEmptyStatus(props.status, props.value)) return missingTile(props);
  const lens = lensKey(props.lens);
  const value = props.status === 'no_events'
    ? `<span class="qs-tile-value">${icon('check')}<span class="qs-tile-word">No events</span></span>`
    : `<span class="qs-tile-value">${esc(fmtValue(props.value ?? 0, props.unit))}</span>`;
  const spark = props.spark ? sparkline(props.spark, `qs-spark qs-spark-${lens}`) : '';
  return wrap(
    `<span class="qs-tile-label">${esc(props.label)}</span>${value}<span class="qs-tile-foot">${deltaOf(props)}${provenance(props.time, props.stage)}</span>${spark}`,
    'qs-tile',
    props.href,
  );
}

/** A row of tiles that wraps to fit its space. */
export function tileRow(tiles: string[]): string {
  return `<div class="qs-tiles">${tiles.join('')}</div>`;
}
