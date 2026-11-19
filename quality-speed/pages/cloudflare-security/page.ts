// SPDX-License-Identifier: Apache-2.0
// The Cloudflare security page: its metrics as tiles, each example config's checks, Road to 100, and the guide item by item.
// States come from the lane's detail and practices.json; words come only from labels.
import type { PageContext, PageOutput } from '../../core/build.ts';
import { dataTable, dotMatrix, markKey, metricTile, roadTo100, tileRow } from '../../core/charts/index.ts';
import type { PassState, RoadFixProps } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';
import type { Detail } from '../../core/detail.ts';
import { combine, type PageScore, type ScoredRow } from '../../core/score.ts';
import { CHECKS, CONFIGS, PRACTICES, type ConfigId } from './collect.ts';

const LABELS: Record<string, string> = {
  workers_practices_met: 'Guide met',
  edge_rows_checked: 'Edge rows',
  compat_date_age_days: 'Date age',
  sources_read_hours: 'Read gap',
  lane_minutes: 'Lane minutes',
};
const CONFIG_NAMES: Record<ConfigId, string> = { room: 'Room', mcp: 'MCP', backup: 'Backup' };
const CHECK_NAMES = { date: 'Date', node: 'Node', maps: 'Maps', urls: 'URLs', logs: 'Logs' } as const;
const PR = 'https://github.com/Colorado-Startups/legallas/pull/';

/** The fixes left, in order (PLAN.md): each brings these metrics to goal. */
const FIXES: { id: string; label: string; metrics: string[] }[] = [
  { id: 'guide', label: 'Guide met', metrics: ['workers_practices_met'] },
  { id: 'edge', label: 'Every edge row', metrics: ['edge_rows_checked'] },
  { id: 'date', label: 'Date current', metrics: ['compat_date_age_days'] },
  { id: 'reads', label: 'Daily read', metrics: ['sources_read_hours'] },
  { id: 'lane', label: 'Lane in 5 min', metrics: ['lane_minutes'] },
];

/** Each config's checks, from the lane's detail. With no detail, every mark reads missing. */
export function configStates(detail: Detail | null): PassState[][] {
  return (Object.keys(CONFIGS) as ConfigId[]).map((id) =>
    // An absent mark is drawn red, as missing (core/charts/blocks.ts).
    CHECKS.map((check) => {
      const v = detail?.checks[`${id}_${check}`];
      return (v === 1 ? 'pass' : v === 0 ? 'fail' : undefined) as PassState;
    }),
  );
}

/** One item's state: its config check, read from the detail, decides over the review. */
export function itemState(item: (typeof PRACTICES.items)[number], detail: Detail | null): string {
  if (item.check) {
    const v = (Object.keys(CONFIGS) as ConfigId[]).map((id) => detail?.checks[`${id}_${item.check}`]);
    if (v.some((x) => x === undefined)) return 'missing';
    if (v.some((x) => x === 0)) return 'fail';
  }
  return item.settled;
}

export function render({ score: page, metrics, detail }: PageContext): PageOutput {
  const tiles = metrics.map((m, i) => metricTile(m, LABELS[m.id] ?? m.id, { reading: page.metrics[i]?.reading ?? 'missing' }));
  const rows: ScoredRow[] = metrics.map((m, i) => ({ id: m.id, lens: m.lens, weight: m.weight, group: m.group, score: page.metrics[i]?.score ?? 0 }));
  const configs = dotMatrix({ caption: 'Example configs', rows: Object.values(CONFIG_NAMES), cols: CHECKS.map((c) => CHECK_NAMES[c]), states: configStates(detail) });
  const items = dataTable({
    caption: 'Workers guide',
    columns: [
      { key: 'item', label: 'item' },
      { key: 'state', label: 'state' },
      { key: 'pr', label: 'PR' },
    ],
    linkKey: 'link',
    rows: PRACTICES.items.map((item) => ({ item: `${item.n}. ${item.label}`, state: itemState(item, detail), pr: `#${item.pr}`, link: `${PR}${item.pr}` })),
  });
  return { body: [markKey(), tileRow(tiles), configs, road(rows, page), items].join('\n') };
}

/** The fixes left: each in turn brings its metrics to goal, scored by the site's own rule. One that adds nothing draws no row. */
export function roadFixes(start: ScoredRow[]): RoadFixProps[] {
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
  return roadTo100({ baseline: { q: 0, s: 0, c: 0, total: 0 }, now, fixes: roadFixes(start) });
}
