// SPDX-License-Identifier: Apache-2.0
// The timeline: drag through the shipped history and every ring on the page replays it. It is a native range input
// over a small line of the main score, so dragging, keyboard and screen readers all work the normal way.

import { esc, fmtDate, jsonBlock, num, safeHref } from './svg.ts';

export interface TimelineScore {
  q: number;
  s: number;
  /** Consumption, on a line written once the lens existed. */
  c?: number;
  total: number;
}

/** One line of the score history: one page's score from one run. */
export interface HistoryLineLike {
  at: string;
  page: string;
  quality: number;
  speed: number;
  consumption?: number;
  total: number;
}

export interface TimelineRow {
  /** The run's date, ISO. */
  t: string;
  /** Scores by ring id, matching `id` on each `ring()`. */
  rings: Record<string, TimelineScore>;
}

export interface TimelineProps {
  history: TimelineRow[];
  /** The ring whose total draws the line behind the slider. */
  main: string;
  /** Load the rows from this file on the first drag, as `{ label, rings }[]`, so a long history stays out of the first view. */
  src?: string;
  label?: string;
}

/**
 * Turns the history's one line per page per run into one timeline row per day, keeping a day's last run.
 * `homeOf` adds a `home` ring from each day's page scores. The home line is computed, never stored.
 */
export function historyRows(lines: HistoryLineLike[], homeOf?: (rings: Record<string, TimelineScore>) => TimelineScore): TimelineRow[] {
  const days = new Map<string, Record<string, TimelineScore>>();
  for (const line of [...lines].sort((a, b) => a.at.localeCompare(b.at))) {
    const day = line.at.slice(0, 10);
    const rings = days.get(day) ?? {};
    rings[line.page] = { q: line.quality, s: line.speed, ...(line.consumption === undefined ? {} : { c: line.consumption }), total: line.total };
    days.set(day, rings);
  }
  return [...days].map(([t, rings]) => ({ t, rings: homeOf ? { ...rings, home: homeOf(rings) } : rings }));
}

function line(rows: TimelineRow[], main: string): string {
  if (rows.length < 2) return '';
  const pts = rows.map((row, i) => `${num((i / (rows.length - 1)) * 100)} ${num(38 - ((row.rings[main]?.total ?? 0) / 100) * 34)}`);
  return `<svg x="0" y="0" width="100%" height="42" viewBox="0 0 100 42" preserveAspectRatio="none"><path class="qs-tl-area" d="M0 42L${pts.join('L')}L100 42Z"/><path class="qs-tl-line" d="M${pts.join('L')}" vector-effect="non-scaling-stroke"/></svg>`;
}

/** The draggable timeline. It starts on the newest run, which is what the rings already show. */
export function timeline(props: TimelineProps): string {
  const rows = props.history;
  const max = Math.max(0, rows.length - 1);
  const lastDate = fmtDate(rows[max]?.t);
  const data = safeHref(props.src) ? '' : jsonBlock(rows.map((row) => ({ label: fmtDate(row.t), rings: row.rings })));
  const href = safeHref(props.src);
  const src = href ? ` data-src="${esc(href)}"` : '';
  return (
    `<div class="qs-timeline" data-qs-timeline${src}><div class="qs-tl-track"><svg class="qs-tl-svg" width="100%" height="42" aria-hidden="true">${line(rows, props.main)}</svg>` +
    `<input type="range" min="0" max="${max}" step="1" value="${max}" aria-label="${esc(props.label ?? 'Replay scores by date')}" aria-valuetext="${esc(lastDate)}" disabled></div>` +
    `<div class="qs-tl-ends"><span>${esc(fmtDate(rows[0]?.t))}</span><output aria-live="off">${esc(lastDate)}</output></div>${data}</div>`
  );
}
