// SPDX-License-Identifier: Apache-2.0
// The Mac app page's body: the Swift job's answers as tiles, its time against goal and Road to 100. Words come only from
// labels; everything else is charts.
import type { PageContext, PageOutput } from '../../core/build.ts';
import { combine, type PageScore, type ScoredRow } from '../../core/score.ts';
import { bullets, markKey, metricBullet, metricTile, roadTo100, tileRow } from '../../core/charts/index.ts';
import type { RoadFixProps } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';

/** The fixes left, in order (PLAN.md): each brings these metrics to goal. */
const FIXES: { id: string; label: string; metrics: string[] }[] = [
  { id: 'bundle', label: 'App bundle', metrics: ['app_bundle_verified'] },
  { id: 'green', label: 'Swift green', metrics: ['swift_jobs_passing'] },
  { id: 'faster', label: 'Under 10 minutes', metrics: ['swift_job_minutes_p50'] },
  { id: 'lane', label: 'Lane in 5 min', metrics: ['lane_minutes'] },
];

/** The page body. The build draws the title, the ideal and the page's ring above it. */
export function render({ score: page, metrics }: PageContext): PageOutput {
  if (!page.has_list) return { body: '' };
  const at = new Map(metrics.map((m, i) => [m.id, { metric: m, ...page.metrics[i]! }])); // safe: one score per listed metric
  const get = (id: string) => at.get(id)!; // safe: every id below is on the reviewed list
  const tiles = tileRow([
    metricTile(get('swift_jobs_passing').metric, 'Swift jobs passing', { reading: get('swift_jobs_passing').reading }),
    metricTile(get('app_bundle_verified').metric, 'App bundle', { reading: get('app_bundle_verified').reading }),
  ]);
  const speed = bullets('Speed', [metricBullet(get('swift_job_minutes_p50').metric, 'Swift job', { reading: get('swift_job_minutes_p50').reading })]);
  const rows: ScoredRow[] = metrics.map((m, i) => ({ id: m.id, lens: m.lens, weight: m.weight, group: m.group, score: page.metrics[i]?.score ?? 0 }));
  return { body: [markKey(), tiles, speed, road(rows, page)].join('\n') };
}

/** The fixes left: each in turn brings its metrics to goal, scored by the site's own rule. One that adds nothing to the total draws no row. */
export function roadFixes(start: ScoredRow[], page: PageScore): RoadFixProps[] {
  let rows = start;
  let before = combine(rows);
  const fixes: RoadFixProps[] = [];
  for (const fix of FIXES) {
    rows = rows.map((r) => (fix.metrics.includes(r.id) ? { ...r, score: 100 } : r));
    const after = combine(rows);
    const q = after.exact_quality - before.exact_quality;
    const s = after.exact_speed - before.exact_speed;
    const c = after.exact_consumption - before.exact_consumption;
    const props = { id: fix.id, label: fix.label, q, s, c };
    if (fixGain(props) > 0) fixes.push(props);
    before = after;
  }
  return fixes;
}

function road(start: ScoredRow[], page: PageScore): string {
  // The consumption ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: page.exact_quality, s: page.exact_speed, total: page.total, c: page.exact_consumption };
  return roadTo100({ baseline: { q: 0, s: 0, total: 0 }, now, fixes: roadFixes(start, page) });
}
