// SPDX-License-Identifier: Apache-2.0
// The SEC page. The build runs it fenced, so it draws only from what render() receives, this folder's needs.json and the
// law.json the law kit's collector writes beside it: the SEC clock (the infographic: every deadline on the reviewed list,
// placed by path and by when it falls, filled when the product states it), a bullet per metric with its baseline, Road to
// 100, and the kit's needs charts on a page of their own. PLAN.md has the metrics.
import { readFileSync } from 'node:fs';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, esc, metricBullet, roadTo100, tableView, totalOf } from '../../core/charts/index.ts';
import type { LawView } from '../../core/law/law.ts';
import { LAW_LABEL, lawCharts, readView, roadFixes } from '../../core/law/page.ts';

interface Need {
  id: string;
  flags?: { kind: string; text: string }[];
}

/** Where each flag on the list sits: its lane, its column and a short label, keyed by need id and flag text. */
export const CLOCK: Record<string, { lane: keyof typeof LANES; at: (typeof COLUMNS)[number]; label: string }> = {
  'raise-edgar-access|well in advance': { lane: 'raise', at: 'Before', label: 'Form ID' },
  'raise-506c-verification|within the prior three months': { lane: 'raise', at: 'Before', label: '506(c)' },
  'raise-form-d-deadline|irrevocably contractually committed': { lane: 'raise', at: 'Day 0', label: 'Sale' },
  'raise-form-d-deadline|within 15 days after the first sale': { lane: 'raise', at: '15 d', label: 'Form D' },
  'raise-form-d-amendments|anniversary of the': { lane: 'raise', at: 'Yearly', label: 'Amend' },
  'angels-506c-verification|within the prior three months': { lane: 'invest', at: 'Before', label: '506(c)' },
  'angels-restricted-securities|a minimum of one year': { lane: 'invest', at: 'Yearly', label: '144' },
  'groups-vehicle-form-d|within 15 days after': { lane: 'invest', at: '15 d', label: 'Form D' },
  'groups-manager-era|within 60 days': { lane: 'invest', at: '60 d', label: 'ADV' },
  'groups-manager-era|within 90 days after': { lane: 'invest', at: 'Yearly', label: 'ADV' },
  'funds-offering|within 15 days after': { lane: 'manage', at: '15 d', label: 'Form D' },
  'funds-form-d-amendment|anniversary of the': { lane: 'manage', at: 'Yearly', label: 'Amend' },
  'funds-era-reporting|within 60 days': { lane: 'manage', at: '60 d', label: 'ADV' },
  'funds-era-reporting|within 90 days after': { lane: 'manage', at: 'Yearly', label: 'ADV' },
};
const LANES = { raise: 'Raising', invest: 'Investors', manage: 'Funds' } as const;
export const COLUMNS = ['Before', 'Day 0', '15 d', '60 d', 'Yearly'] as const;
const ROW = 20;

/** The baseline: the law kit on main at 23a5a4c, 2026-11-04 (PLAN.md, Baseline), by metric id; no consumption metric yet. */
export const BASELINE = { q: 76, s: 100, total: totalOf(76, 100) };
const BASE_VALUES: Record<string, number> = { coverage: 58.62, verified: 90, fresh: 100, rights: 100, flags: 71.42, change_lag: 0 };

/** The flags on the list, each placed on the clock and found or not. Throws for a flag with no place, so a new one can't go unseen. */
export function marks(needs: readonly Need[], view: LawView | null = null) {
  return needs.flatMap((n) =>
    (n.flags ?? []).map((f) => {
      const place = CLOCK[`${n.id}|${f.text}`];
      if (!place) throw new Error(`${n.id}: the flag "${f.text}" has no place on the SEC clock`);
      const found = view?.rows.find((r) => r.id === n.id)?.flags.find((g) => g.text === f.text)?.found === true;
      return { ...place, found };
    }),
  );
}

const pct = (f: number) => `${Number((f * 100).toFixed(2))}%`;

/** The infographic: one lane per kind of reader, one column per moment, a dot per deadline, filled when stated, a red ring when not. */
export function clock(needs: readonly Need[], view: LawView | null): string {
  const all = marks(needs, view);
  const lanes = (Object.keys(LANES) as (keyof typeof LANES)[])
    .map((lane) => {
      const here = all.filter((m) => m.lane === lane);
      const tall = Math.max(1, ...COLUMNS.map((c) => here.filter((m) => m.at === c).length));
      const axis = tall * ROW + 6;
      const dots = COLUMNS.map((col, i) => {
        const x = pct((i + 0.5) / COLUMNS.length);
        return here
          .filter((m) => m.at === col)
          .map((m, j) => {
            const y = axis - 4 - (j + 0.5) * ROW;
            return `<g data-tl="${esc(m.label)}" data-tv="${m.found ? 'stated' : 'missing'}"><circle class="${m.found ? 'qs-dot-q' : 'qs-track-empty'}" cx="${x}" cy="${y}" r="5" transform="translate(-12 0)"/><text class="qs-tick-label" x="${x}" y="${y + 4}" transform="translate(-3 0)">${esc(m.label)}</text></g>`;
          })
          .join('');
      }).join('');
      return `<p class="qs-tick-label">${esc(LANES[lane])}</p><svg width="100%" height="${axis + 4}" aria-hidden="true"><line class="qs-axis" x1="0" x2="100%" y1="${axis}" y2="${axis}"/>${dots}</svg>`;
    })
    .join('');
  const ticks = COLUMNS.map((c, i) => `<text class="qs-tick-label" x="${pct((i + 0.5) / COLUMNS.length)}" y="12" text-anchor="middle">${esc(c)}</text>`).join('');
  const stated = `<b>${all.filter((m) => m.found).length}/${all.length}</b>`;
  return (
    `<figure class="qs-chart" role="img" aria-label="${esc(`SEC clock: ${all.length} deadlines`)}">` +
    `<figcaption>SEC clock${stated}</figcaption>${lanes}<svg width="100%" height="16" aria-hidden="true">${ticks}</svg>` +
    `${tableView('SEC clock', ['Lane', 'When', 'What', 'State'], all.map((m) => [LANES[m.lane], m.at, m.label, m.found ? 'stated' : 'missing']))}</figure>`
  );
}

/** The first view: the clock, a bullet per metric, Road to 100. Apart from render() so a test can hand it any view. */
export function body(context: PageContext, needs: readonly Need[], view: LawView | null): string {
  const rows = context.metrics.map((m, i) =>
    metricBullet(m, LAW_LABEL[m.id] ?? m.id, { reading: context.score.metrics[i]?.reading ?? 'missing', ...(m.id in BASE_VALUES ? { baseline: BASE_VALUES[m.id] } : {}) }),
  );
  // The consumption ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: context.score.quality, s: context.score.speed, total: context.score.total, c: context.score.exact_consumption };
  // The kit's needs grid is about 40 KB, so it opens on its own page and the first view stays under the 100 KB limit.
  const more = '<p><a class="qs-btn" href="needs.html">Needs</a></p>';
  return `${clock(needs, view)}${bullets('Metrics', rows)}${more}${roadTo100({ baseline: BASELINE, now, fixes: roadFixes(context) })}`;
}

export function render(context: PageContext): PageOutput {
  const needs = (JSON.parse(readFileSync(new URL('./needs.json', import.meta.url), 'utf8')) as { needs: Need[] }).needs;
  const view = readView(new URL('./law.json', import.meta.url));
  return { body: body(context, needs, view), pages: { needs: `<nav><a href="index.html">SEC</a></nav><main>${lawCharts(view)}</main>` } };
}
