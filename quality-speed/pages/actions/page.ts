// SPDX-License-Identifier: Apache-2.0
// The Actions page. The one infographic is a fuel gauge for the month's money: what's spent, where the month is heading,
// the goal, the hold and the ceiling. The rest is the kit's. Data that is missing shows as missing: the gauge and tables
// drop out and the tiles go red, so nothing here invents a number.
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, dataTable, esc, markKey, metricBullet, metricTile, roadTo100, tableView, tileRow, totalOf, trend, type ReadingLike, type RoadFixProps, type RoadScore } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';
import type { Metric } from '../../contract/format.ts';

/** The first read of this page, from PLAN.md, with no consumption metric yet; the total by core's own rule. */
const BASELINE: RoadScore = { q: 81, s: 100, total: totalOf(81, 100) };

/** The fixes left, each with its issue and the metrics it moves. One whose metrics are all at goal drops off the road. */
const FIXES: readonly { id: string; label: string; issue?: number; metrics: string[] }[] = [
  { id: 'spend', label: 'Spend', issue: 241, metrics: ['allowance_forecast_usd', 'usd_per_merge'] },
  { id: 'prove', label: 'Prove Claude', issue: 234, metrics: ['workflows_proven_pct'] },
  { id: 'minutes', label: 'Minutes', metrics: ['billed_minutes_per_merge'] },
];

/** How far the hold's label sits left of its mark, in percent, so it doesn't run into the ceiling's on a phone. */
const HOLD_LABEL_GAP = 2;
const dollars = (value: number) => `$${value.toFixed(value < 10 ? 2 : 0)}`;

/** The infographic. The scale ends at the ceiling, the plan's included dollars from the spend detail, and a forecast past it stops there with its own number on it. */
export function gauge(spent: number | null, forecast: number, goal: number, hold: number, ceiling: number): string {
  const share = (usd: number) => Math.min(usd / ceiling, 1) * 100;
  const x = (usd: number) => `${share(usd).toFixed(2)}%`;
  const spoken = `Heading for ${dollars(forecast)} of ${dollars(ceiling)}${spent === null ? '' : `, ${dollars(spent)} spent`}`;
  const table = tableView(spoken, ['Mark', 'Dollars'], [
    ['Spent', spent === null ? 'Missing' : dollars(spent)],
    ['Forecast', dollars(forecast)],
    ['Goal', dollars(goal)],
    ['Floor', dollars(hold)],
    ['Ceiling', dollars(ceiling)],
  ]);
  return (
    `<figure class="qs-chart"><figcaption>Allowance</figcaption><svg width="100%" height="64" role="img" aria-label="${esc(spoken)}">` +
    `<rect class="qs-track-q" width="100%" y="20" height="20" rx="3"/>` +
    `<rect class="qs-area-q" width="${x(forecast)}" y="20" height="20" rx="3"/>` +
    (spent === null ? '' : `<rect class="qs-fill-q" width="${x(spent)}" y="20" height="20" rx="3"/>`) +
    `<line class="qs-goal" x1="${x(goal)}" x2="${x(goal)}" y1="14" y2="46"/><text class="qs-ref" x="${x(goal)}" y="60" text-anchor="middle">◆ ${dollars(goal)}</text>` +
    `<line class="qs-cap" x1="${x(hold)}" x2="${x(hold)}" y1="14" y2="46"/><text class="qs-ref" x="${(share(hold) - HOLD_LABEL_GAP).toFixed(2)}%" y="60" text-anchor="end">${dollars(hold)}</text>` +
    `<text class="qs-ref-strong" x="${x(forecast)}" y="12" text-anchor="${forecast > ceiling / 2 ? 'end' : 'start'}">▼ ${dollars(forecast)}</text>` +
    `<text class="qs-end" x="100%" y="60" text-anchor="end">${dollars(ceiling)}</text></svg>${table}</figure>`
  );
}

/** A line needs two points. The kit draws fewer in red, which means a score of 0 everywhere else, so a young page shows nothing here. */
const lineOf = (props: Parameters<typeof trend>[0]) => (props.points.length >= 2 ? trend(props) : '');

/** The month's spend as a running total, from the days the detail file holds. */
function burnUp(readings: Record<string, { value: number }>, goal: number): string {
  let total = 0;
  const points = Object.entries(readings)
    .filter(([id]) => id.startsWith('day_'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, reading]) => {
      total += reading.value;
      return { t: id.slice(4), v: Number(total.toFixed(2)) };
    });
  return lineOf({ label: 'Spent', unit: 'usd', goal, lens: 'quality', stage: 'live', points });
}

function spendTable(readings: Record<string, { value: number; n: number }>): string {
  const rows = Object.entries(readings)
    .flatMap(([id, reading]) => {
      const parts = /^job_(.+)_([a-z]+)$/.exec(id);
      return parts ? [{ job: parts[1], runner: parts[2], runs: reading.n, minutes: readings[id.replace(/^job_/, 'min_')]?.value ?? null, usd: Number(reading.value.toFixed(2)) }] : [];
    })
    .sort((a, b) => b.usd - a.usd);
  return dataTable({
    caption: 'Spend',
    filter: true,
    columns: [
      { key: 'job', label: 'Job' },
      { key: 'runner', label: 'Runner' },
      { key: 'runs', label: 'Runs', type: 'num' },
      { key: 'minutes', label: 'Minutes', type: 'num' },
      { key: 'usd', label: 'Dollars', type: 'num', unit: 'usd' },
    ],
    rows,
  });
}

/** Queue time by runner, beside the scored shared p90 (PLAN.md). */
function queueTable(readings: Record<string, { value: number; n: number }>): string {
  const rows = Object.entries(readings)
    .filter(([id]) => id.startsWith('queue_'))
    .map(([id, reading]) => ({ runner: id.slice(6), seconds: Number(reading.value.toFixed(1)), jobs: reading.n }));
  if (!rows.length) return '';
  return dataTable({
    caption: 'Queue p95',
    columns: [
      { key: 'runner', label: 'Runner' },
      { key: 'seconds', label: 'Seconds', type: 'num' },
      { key: 'jobs', label: 'Jobs', type: 'num' },
    ],
    rows,
  });
}

export function render({ score, metrics, history, detail }: PageContext): PageOutput {
  const reading = new Map(score.metrics.map((m) => [m.id, m.reading as ReadingLike]));
  const scoreOf = new Map(score.metrics.map((m) => [m.id, m.score]));
  const byId = new Map(metrics.map((m) => [m.id, m]));
  const metric = (id: string): Metric => byId.get(id) as Metric;
  // No date on a tile: the bullets carry the run's date, and a stale reading already scores 0 and draws red.
  const tile = (id: string, label: string) => metricTile({ ...metric(id), measured_at: null }, label, { reading: reading.get(id) ?? 'missing' });
  const bullet = (id: string, label: string) => metricBullet(metric(id), label, { reading: reading.get(id) ?? 'missing' });

  const readings = detail?.readings ?? {};
  const checks = detail?.checks ?? {};
  const plants = Object.keys(checks);
  const forecast = metric('allowance_forecast_usd');
  const spent = readings.month_usd?.value;
  const ceiling = readings.month_usd?.limit;

  const weightOf = (lens: Metric['lens']) => metrics.filter((m) => m.lens === lens).reduce((sum, m) => sum + m.weight, 0) || 1;
  const fixes: RoadFixProps[] = FIXES.map((fix) => {
    const gain = (lens: Metric['lens']) =>
      fix.metrics.reduce((sum, id) => {
        const m = byId.get(id);
        return m?.lens === lens ? sum + ((100 - (scoreOf.get(id) ?? 0)) * m.weight) / weightOf(lens) : sum;
      }, 0);
    const ref = fix.issue ? { ref: `#${fix.issue}`, href: `https://github.com/Colorado-Startups/legallas/issues/${fix.issue}` } : {};
    return { id: fix.id, label: fix.label, q: gain('quality'), s: gain('speed'), c: gain('consumption'), ...ref };
  }).filter((fix) => fixGain(fix) > 0);

  // The consumption ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: score.exact_quality, s: score.exact_speed, total: score.total, c: score.exact_consumption };
  const body = [
    forecast.status === 'ok' && forecast.value !== null && ceiling ? gauge(spent ?? null, forecast.value, forecast.goal, forecast.floor, ceiling) : '',
    bullets('Money', [bullet('allowance_forecast_usd', 'Month end'), bullet('usd_per_merge', 'Per merge'), bullet('blacksmith_minutes_31d', 'Blacksmith')]),
    bullets('Consumption', [bullet('billed_minutes_per_merge', 'Per merge')]),
    tileRow([
      tile('main_green_pct', 'Main green'),
      tile('gates_ran_pct', 'Gates'),
      tile('planted_failures_caught_pct', 'Plants'),
      tile('flaky_trees_pct', 'Flaky'),
      tile('runs_deleted', 'Deleted'),
      tile('unpinned_dependencies', 'Unpinned'),
      tile('workflow_lint_pass', 'Lint'),
      tile('jobs_with_timeout_pct', 'Timeouts'),
      tile('workflows_proven_pct', 'Proven'),
      tile('gates_intact', 'Intact'),
      tile('repeat_runs_per_merge', 'Repeats'),
      tile('app_token_runs_passing', 'Token'),
    ]),
    bullets('Speed', [
      bullet('green_minutes_p50', 'Green p50'),
      bullet('green_minutes_p95', 'Green p95'),
      bullet('slowest_job_minutes_p95', 'Slowest'),
      bullet('queue_seconds_p90', 'Queue p90'),
      bullet('app_token_job_seconds_p50', 'Token p50'),
    ]),
    markKey(),
    // The Plants tile carries the share caught; the table names each one.
    plants.length ? tableView('Plants', ['Plant', 'Caught'], plants.map((name) => [name, checks[name] === 1 ? 'Yes' : 'No'])) : '',
    spent === undefined ? '' : burnUp(readings, forecast.goal),
    lineOf({ label: 'Score', goal: 100, baseline: BASELINE.total, lens: 'quality', stage: 'live', points: history.map((line) => ({ t: line.at.slice(0, 10), v: line.total })) }),
    spent === undefined ? '' : spendTable(readings),
    queueTable(readings),
    roadTo100({ baseline: BASELINE, now, fixes }),
  ];
  return { body: body.join('') };
}
