// SPDX-License-Identifier: Apache-2.0
// The page's infographic: the last 28 days as a calendar, a week to a row, oldest at the top. A real table in the chart
// kit's heatmap classes, darker for more changes merged that day, blank for none, and the kit's alert mark on a day whose
// changes later needed repair. Every day carries the kit's hover.
import { esc, fmtDate, icon } from '../../core/charts/index.ts';
import type { Day } from './series.ts';

/** Changes per day at which a day's shade steps up: light, middle, dark. */
export const STEPS = [1, 5, 15] as const;

/** A day's shade: 0 for no change, then 1 to 3. */
export function shade(changes: number): 0 | 1 | 2 | 3 {
  if (changes >= STEPS[2]) return 3;
  if (changes >= STEPS[1]) return 2;
  if (changes >= STEPS[0]) return 1;
  return 0;
}

/** The kit's heat bands for each shade; band 5 is kept for "at goal" and band 0 for "scores 0". */
const BAND = ['', 'qs-h2', 'qs-h3', 'qs-h4'] as const;
const WEEKDAY = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
/** Text only a screen reader gets, in the kit's class. */
const sr = (text: string) => `<span class="qs-sr">${esc(text)}</span>`;

export function calendar(days: Day[], label: string): string {
  const weeks: Day[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const head = (weeks[0] ?? []).map((d) => `<th scope="col">${WEEKDAY[new Date(`${d.t}T00:00:00Z`).getUTCDay()]}</th>`).join('');
  const cell = (d: Day) => {
    const s = shade(d.changes);
    const mark = d.failed ? `${icon('alert')}${sr(`, ${d.failed} needed repair`)}` : '';
    const tip = `data-tv="${d.changes}${d.failed ? `, ${d.failed} repaired` : ''}" data-tl="${esc(fmtDate(d.t))}"`;
    return `<td><span class="qs-heat ${BAND[s]}" ${tip}>${d.changes || ''}${mark}${d.changes ? '' : sr('none')}</span></td>`;
  };
  const body = weeks.map((w) => `<tr><th scope="row">${esc(fmtDate(w[0]?.t))}</th>${w.map(cell).join('')}</tr>`).join('');
  const active = days.filter((d) => d.changes > 0).length;
  const note = `<span class="qs-heat-note">${active}/${days.length}</span>`;
  return `<div class="qs-heatmap qs-cal"><table><caption>${esc(label)} ${note}</caption><thead><tr><td></td>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
