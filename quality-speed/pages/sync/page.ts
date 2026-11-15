// SPDX-License-Identifier: Apache-2.0
// The sync page's body: the infographic (the folder is home, step by step, pass or fail per computer), a ring and the
// owner's rules per computer, speed against goal and Road to 100. Words come only from labels; everything else is charts.
import type { PageContext, PageOutput } from '../../core/build.ts';
import { combine, type PageScore, type ScoredRow } from '../../core/score.ts';
import { bullets, dotMatrix, markKey, metricBullet, metricTile, ring, roadTo100, tileRow } from '../../core/charts/index.ts';
import type { PassState, RoadFixProps } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';

const COMPUTERS = [
  { id: 'mac', label: 'Mac' },
  { id: 'windows', label: 'Windows' },
];
/** The folder is home: each step and the metric that proves it, per computer. */
const STEPS = [
  { label: 'Read or named', id: 'files_read' },
  { label: 'Found', id: 'change_to_index_text_max' },
  { label: 'Unchanged', id: 'folder_unchanged' },
];
const issue = (n: number) => `https://github.com/Colorado-Startups/legallas/issues/${n}`;

/** The fixes left, ranked by score gained (PLAN.md): each brings these metrics to goal. */
const RUN = ['folder_unchanged', 'change_to_index_text_max'];
/** One fix per computer's lane, so Road to 100 adds each computer's metrics once its lane runs. */
const FIXES: { id: string; label: string; issue?: number; metrics: string[] }[] = [
  { id: 'windows-run', label: 'Windows run', metrics: ['windows_files_read', ...RUN.map((m) => `windows_${m}`)] },
  { id: 'mac-run', label: 'Mac run', metrics: RUN.map((m) => `mac_${m}`) },
  { id: 'iwork', label: 'iWork', issue: 66, metrics: ['mac_files_read'] },
  { id: 'lanes', label: 'Lanes in 5 min', metrics: COMPUTERS.map((c) => `${c.id}_lane_minutes`) },
];

/** The page body. The build draws the title and the page's ring above it. */
export function render({ score: page, metrics }: PageContext): PageOutput {
  if (!page.has_list) return { body: '' };
  const at = new Map(metrics.map((m, i) => [m.id, { metric: m, ...page.metrics[i]! }])); // safe: one score per listed metric
  const get = (id: string) => at.get(id)!; // safe: every id below is on the reviewed list
  const tile = (id: string, label: string) => metricTile(get(id).metric, label, { reading: get(id).reading });
  const groups = COMPUTERS.map((c) => ({ ...c, score: page.groups.find((g) => g.id === c.id) ?? { quality: 0, speed: 0, total: 0 } }));

  // Pass when the step's metric is at goal; a hole, which the kit shows as missing, when it isn't measured.
  const states = STEPS.map((step) => {
    const row: PassState[] = [];
    COMPUTERS.forEach((c, i) => {
      const m = get(`${c.id}_${step.id}`);
      if (m.reading === 'measured') row[i] = m.score === 100 ? 'pass' : 'fail';
    });
    return row;
  });
  const journey = dotMatrix({ caption: 'The folder is home', rows: STEPS.map((step) => step.label), cols: COMPUTERS.map((c) => c.label), states });

  const columns = groups.map((c) => {
    const score = ring({ id: `sync-${c.id}`, q: c.score.quality, s: c.score.speed, total: c.score.total, size: 'md', label: c.label, note: '50%', key: false });
    const tiles = tileRow([tile(`${c.id}_files_read`, 'Read'), tile(`${c.id}_folder_unchanged`, 'Unchanged')]);
    return `<div class="qs-grid"><div class="qs-ring-row">${score}</div>${tiles}</div>`;
  });

  const speed = bullets('Speed', groups.map((c) => metricBullet(get(`${c.id}_change_to_index_text_max`).metric, c.label, { reading: get(`${c.id}_change_to_index_text_max`).reading })));

  const rows: ScoredRow[] = metrics.map((m, i) => ({ id: m.id, lens: m.lens, weight: m.weight, group: m.group, score: page.metrics[i]?.score ?? 0 }));
  const body = [
    markKey(),
    `<section class="qs-grid qs-grid-3">${journey}${columns.join('')}</section>`,
    speed,
    road(rows, page),
  ];
  return { body: body.join('\n') };
}

/** The fixes left: each in turn brings its metrics to goal, scored by the site's own rule, its gain by core's own weights. */
export function roadFixes(start: ScoredRow[], page: PageScore): RoadFixProps[] {
  const groups = page.groups.map((g) => ({ id: g.id, weight: g.weight }));
  let rows = start;
  let before = combine(rows, groups);
  const fixes: RoadFixProps[] = [];
  for (const fix of FIXES) {
    rows = rows.map((r) => (fix.metrics.includes(r.id) ? { ...r, score: 100 } : r));
    const after = combine(rows, groups);
    const q = after.exact_quality - before.exact_quality;
    const s = after.exact_speed - before.exact_speed;
    const c = after.exact_consumption - before.exact_consumption;
    const props = { id: fix.id, label: fix.label, q, s, c, ...(fix.issue ? { ref: `#${fix.issue}`, href: issue(fix.issue) } : {}) };
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
