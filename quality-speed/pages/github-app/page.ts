// SPDX-License-Identifier: Apache-2.0
// The GitHub App page: its metrics as tiles, Road to 100, and the permissions the App should hold. Words come only from labels.
import { readFileSync } from 'node:fs';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { dataTable, markKey, metricTile, roadTo100, tileRow } from '../../core/charts/index.ts';
import type { RoadFixProps } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';
import { combine, type PageScore, type ScoredRow } from '../../core/score.ts';
import type { Expected } from './collect.ts';

const LABELS: Record<string, string> = { app_permissions_off: 'Permissions off', app_token_runs_passing: 'Runs passing', app_token_job_seconds_p50: 'Job time', lane_minutes: 'Lane minutes' };
const { permissions } = JSON.parse(readFileSync(new URL('./expected.json', import.meta.url), 'utf8')) as Expected;

/** The fixes left, in order (PLAN.md): each brings these metrics to goal. */
const FIXES: { id: string; label: string; metrics: string[] }[] = [
  { id: 'permissions', label: 'Exact permissions', metrics: ['app_permissions_off'] },
  { id: 'runs', label: 'Every run passes', metrics: ['app_token_runs_passing'] },
  { id: 'fast', label: 'Job in a minute', metrics: ['app_token_job_seconds_p50'] },
  { id: 'lane', label: 'Lane in 5 min', metrics: ['lane_minutes'] },
];

export function render({ score: page, metrics }: PageContext): PageOutput {
  const tiles = metrics.map((m, i) => metricTile(m, LABELS[m.id] ?? m.id, { reading: page.metrics[i]?.reading ?? 'missing' }));
  const rows: ScoredRow[] = metrics.map((m, i) => ({ id: m.id, lens: m.lens, weight: m.weight, group: m.group, score: page.metrics[i]?.score ?? 0 }));
  const table = dataTable({
    caption: 'Expected',
    columns: [
      { key: 'permission', label: 'permission' },
      { key: 'level', label: 'level' },
    ],
    rows: Object.entries(permissions).map(([permission, level]) => ({ permission, level })),
  });
  return { body: [markKey(), tileRow(tiles), road(rows, page), table].join('\n') };
}

/** The fixes left: each in turn brings its metrics to goal, scored by the site's own rule. One that adds nothing draws no row. */
export function roadFixes(start: ScoredRow[], page: PageScore): RoadFixProps[] {
  let rows = start;
  let before = combine(rows);
  const fixes: RoadFixProps[] = [];
  for (const fix of FIXES) {
    rows = rows.map((r) => (fix.metrics.includes(r.id) ? { ...r, score: 100 } : r));
    const after = combine(rows);
    const props = {
      id: fix.id,
      label: fix.label,
      q: after.exact_quality - before.exact_quality,
      s: after.exact_speed - before.exact_speed,
      c: after.exact_consumption - before.exact_consumption,
    };
    if (fixGain(props) > 0) fixes.push(props);
    before = after;
  }
  return fixes;
}

function road(start: ScoredRow[], page: PageScore): string {
  const now = { q: page.exact_quality, s: page.exact_speed, c: page.exact_consumption, total: page.total };
  return roadTo100({ baseline: { q: 0, s: 0, c: 0, total: 0 }, now, fixes: roadFixes(start, page) });
}
