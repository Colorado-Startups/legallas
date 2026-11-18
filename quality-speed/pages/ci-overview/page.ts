// SPDX-License-Identifier: Apache-2.0
// The CI overview page: one push from start to finish on each path, what each merge costs and why, where jobs run, and
// the changes ranked by what they save. Composes the chart kit; its one drawing of its own is the push timeline, plain
// SVG on the kit's classes, because the site ships no page CSS.
//
// The build (core/build.ts) calls render() with the scores and adds the title and ring. The drill-down reads rows.json
// beside this file when a lane has put one there, else the dated baseline.

import { existsSync, readFileSync } from 'node:fs';
import type { Manifest, Metric, MetricRecord } from '../../contract/format.ts';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, dataTable, dotMatrix, esc, fmtValue, markKey, meter, metricBullet, metricTile, roadTo100, statTile, tableView, tileRow, type Column } from '../../core/charts/index.ts';
import type { PassState, RoadFixProps } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';
import { lineScore, scorePage } from '../../core/score.ts';
import type { Kind, Path, Rows } from './compute.ts';

const REPO_URL = 'https://github.com/Colorado-Startups/legallas';
const LABELS: Record<string, string> = {
  gates_intact: 'Gates',
  pushes_per_merge: 'Pushes',
  reviews_per_merge: 'Reviews',
  repeat_runs_per_merge: 'Repeats',
  final_push_to_merge_p50: 'To merge',
};
const LANE: Record<Kind, string> = { slim: '1-core', linux: 'Linux', blacksmith: 'Blacksmith', mac: 'Mac', windows: 'Windows' };
const LANE_ORDER: Kind[] = ['slim', 'linux', 'blacksmith', 'mac', 'windows'];
const PATH: Record<Path['path'], string> = { docs: 'Docs', web: 'Web', swift: 'Swift' };

export interface Change {
  id: string;
  label: string;
  state: 'merged' | 'open' | 'owner' | 'no';
  why?: string;
  pull: number | null;
  merged_at?: string;
  effect?: Record<string, number>;
}

const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));

/**
 * Each change not yet in the readings, as a Road to 100 fix: its measured effect applied on top of the ones before it; then the
 * lane's own minutes to goal. A fix that adds nothing to the total under core's weights draws no row.
 */
export function roadFixes(metrics: readonly Metric[], changes: readonly Change[]): RoadFixProps[] {
  const latest = Math.max(0, ...metrics.map((m) => (m.measured_at ? Date.parse(m.measured_at) : 0)));
  const value = new Map(metrics.filter((m) => m.status === 'ok' && m.value !== null).map((m) => [m.id, m.value as number]));
  const lensWeight = (lens: string) => metrics.filter((d) => d.lens === lens).reduce((a, d) => a + d.weight, 0);
  const fixes: (RoadFixProps & { c: number })[] = [];
  for (const c of changes) {
    if (!c.effect || c.state === 'no' || (c.merged_at && Date.parse(c.merged_at) < latest)) continue;
    const fix = { id: c.id, label: c.label, q: 0, s: 0, c: 0 };
    for (const [id, delta] of Object.entries(c.effect)) {
      const d = metrics.find((x) => x.id === id);
      const before = value.get(id);
      if (!d || before === undefined) continue;
      const after = before + delta;
      fix[d.lens === 'quality' ? 'q' : d.lens === 'speed' ? 's' : 'c'] += ((lineScore(d, after) - lineScore(d, before)) * d.weight) / lensWeight(d.lens);
      value.set(id, after);
    }
    if (c.pull) Object.assign(fix, { ref: `#${c.pull}`, href: `${REPO_URL}/pull/${c.pull}` });
    fixes.push(fix);
  }
  const lane = metrics.find((m) => m.id === 'lane_minutes');
  const laneNow = lane && value.has(lane.id) ? lineScore(lane, value.get(lane.id) as number) : 0;
  if (lane) fixes.push({ id: 'lane', label: `Lane in ${lane.goal} min`, q: 0, s: 0, c: ((100 - laneNow) * lane.weight) / lensWeight('consumption') });
  return fixes.filter((f) => fixGain(f) > 1e-9).sort((a, b) => fixGain(b) - fixGain(a));
}

/** One push on one path: a row per job, grouped by runner, each bar from the job's start to its end after the push. */
export function pushChart(p: Path): string {
  const end = Math.max(60, ...p.bars.map((b) => b.end_s));
  const span = Math.ceil(end / 60) * 60;
  const x = (s: number) => `${(34 + (66 * s) / span).toFixed(2)}%`;
  const rows: string[] = [];
  let y = 0;
  for (const k of LANE_ORDER.filter((k) => p.bars.some((b) => b.kind === k))) {
    y += 18;
    rows.push(`<line class="qs-axis" x1="0" x2="100%" y1="${y - 13}" y2="${y - 13}"/><text class="qs-tick-label" x="0" y="${y}">${esc(LANE[k])}</text>`);
    for (const b of p.bars.filter((b) => b.kind === k)) {
      y += 16;
      const w = Math.max(0.5, (66 * (b.end_s - b.start_s)) / span).toFixed(2);
      rows.push(
        `<text class="qs-tick-label" x="2%" y="${y}">${esc(b.job)}</text><rect class="qs-track-s" x="34%" y="${y - 10}" width="66%" height="12" rx="2"/>` +
          `<rect class="qs-fill-s" x="${x(b.start_s)}" y="${y - 10}" width="${w}%" height="12" rx="2" data-tv="${esc(fmtValue(b.end_s - b.start_s, 'seconds'))}" data-tl="${esc(`${b.job}, ${LANE[k]}`)}"/>`,
      );
    }
  }
  y += 18;
  const ticks = Array.from({ length: span / 60 + 1 }, (_, i) => `<text class="qs-tick-label" x="${x(i * 60)}" y="${y}" text-anchor="${i === 0 ? 'start' : i === span / 60 ? 'end' : 'middle'}">${i === span / 60 ? `${i} min` : i}</text>`);
  const usd = p.usd_push === undefined ? '' : `, ${fmtValue(p.usd_push, 'usd')} a push`;
  const label = `${PATH[p.path]} push: ${p.bars.length} jobs, done in ${fmtValue(end / 60, 'minutes')}${usd}, ${p.runs} pushes`;
  return (
    `<figure class="qs-chart"><svg width="100%" height="${y + 4}" role="img" aria-label="${esc(label)}">${rows.join('')}${ticks.join('')}</svg>` +
    `${tableView(`${PATH[p.path]} push`, ['Job', 'Runner', 'Start s', 'End s'], p.bars.map((b) => [b.job, LANE[b.kind], b.start_s, b.end_s]))}</figure>`
  );
}

/** The eight gates as two rows: what main's rules require, and what held on every merged head. */
function gateMatrix(g: boolean[]): string {
  const st = (i: number): PassState => (g[i] ? 'pass' : 'fail');
  return dotMatrix({
    caption: LABELS.gates_intact as string,
    rows: ['Required', 'On merges'],
    cols: ['ci-ok', 'dco', 'review', 'signed', 'lint'],
    states: [
      [st(0), st(1), st(2), st(3), st(7)],
      [st(4), st(5), st(6), 'na', 'na'],
    ],
  });
}

const PROVIDERS = [
  { provider: 'GitHub 1-core', price: '0.002', pool: 'the plan\'s included amount, all of it', stop: 'stop-usage budgets' },
  { provider: 'GitHub Linux', price: '0.006', pool: 'same pool', stop: 'same' },
  { provider: 'GitHub Windows', price: '0.010', pool: 'same pool', stop: 'same' },
  { provider: 'GitHub Mac', price: '0.062', pool: 'same pool', stop: 'same' },
  { provider: 'Blacksmith', price: '0.004 past free', pool: '3,000 min a month, org; 1,800 here', stop: 'none: the guard' },
  { provider: 'Claude cloud VM', price: '0', pool: 'plan usage', stop: 'plan limits' },
  { provider: 'Hugging Face Jobs', price: '0.000167', pool: 'plan credit', stop: 'credit; Spaces never' },
];

/** The page body, from the build's scores, this folder's baseline, drill-down and changes. */
export function render(ctx: PageContext): PageOutput {
  const { score, metrics } = ctx;
  const manifest = read('./manifest.json') as Manifest;
  const baseline = read('./baseline/metrics.json') as MetricRecord[];
  const rows = read(existsSync(new URL('./rows.json', import.meta.url)) ? './rows.json' : './baseline/rows.json') as Rows;
  const changes = read('./changes.json').changes as Change[];
  const baseAt = Math.max(0, ...baseline.map((r) => (r.measured_at ? Date.parse(r.measured_at) : 0)));
  const base = scorePage('ci-overview', manifest, baseline, new Date(baseAt));
  const metric = (id: string) => metrics.find((m) => m.id === id) as Metric;
  const reading = (id: string) => score.metrics.find((s) => s.id === id)?.reading ?? 'missing';
  const bullet = (id: string) => {
    const b = baseline.find((r) => r.id === id)?.value;
    return metricBullet(metric(id), LABELS[id] ?? id, b === null || b === undefined ? { reading: reading(id) } : { reading: reading(id), baseline: b });
  };
  const perDay = (x: number) => Math.round((x * 24) / Math.max(1, rows.span_hours));
  // Dollars show only from a lane's own rows.json. The committed baseline has none: they are the organization's spend.
  const hosted = rows.hosted_usd;
  const usdColumn = (label: string): Column[] => (hosted === undefined ? [] : [{ key: 'usd', label, type: 'num', unit: 'usd' }]);
  const shown = rows.paths.filter((p) => p.runs > 0);
  // The consumption ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: score.quality, s: score.speed, total: score.total, c: score.exact_consumption };
  const body = [
    `<section class="qs-grid" aria-label="One push">${shown.map((p, i) => `<details${i === 0 ? ' open' : ''}><summary>${PATH[p.path]}</summary>${pushChart(p)}</details>`).join('')}</section>`,
    `<div class="qs-grid qs-grid-2">`,
    `<div><div class="qs-grid">${bullets('Per merge', ['pushes_per_merge', 'reviews_per_merge', 'repeat_runs_per_merge'].map(bullet))}`,
    tileRow([
      metricTile(metric('final_push_to_merge_p50'), LABELS.final_push_to_merge_p50 as string, { reading: reading('final_push_to_merge_p50') }),
      statTile({ label: 'Rebases', value: rows.rebases_per_merge, unit: 'ratio' }),
      statTile({ label: 'Merges', value: rows.merges, time: rows.to, stage: 'lab' }),
    ]),
    rows.gates ? gateMatrix(rows.gates) : '',
    `</div></div><div><div class="qs-grid">`,
    // A day's share of this repository's 1,800 Blacksmith minutes over 31 days. GitHub's dollars a day have no limit drawn: the plan's included amount stays off this tree.
    meter({ label: 'Blacksmith/day', value: perDay(rows.blacksmith_minutes), limit: 58 }),
    hosted === undefined ? '' : statTile({ label: 'GitHub/day', value: perDay(hosted), unit: 'usd' }),
    // The sessions' shared logins can't be read from CI: two dated samples of GitHub's rate-limit reading.
    tileRow([
      statTile({ label: 'API local', value: 100, unit: 'percent', better: 'down', status: 'ok', time: '2026-11-02T04:48:00Z', stage: 'lab' }),
      statTile({ label: 'API cloud', value: 40, unit: 'percent', better: 'down', status: 'ok', time: '2026-11-02T05:00:00Z', stage: 'lab' }),
    ]),
    `</div></div></div>`,
    roadTo100({ baseline: { q: base.quality, s: base.speed, total: base.total }, now, fixes: roadFixes(metrics, changes) }),
    markKey(),
    dataTable({
      caption: 'Paths',
      filter: false,
      columns: [
        { key: 'path', label: 'Path' },
        { key: 'pushes', label: 'Pushes', type: 'num' },
        ...usdColumn('$ a push'),
        { key: 'min', label: 'Done', type: 'num', unit: 'minutes' },
      ],
      rows: shown.map((p) => ({ path: PATH[p.path], pushes: p.runs, usd: p.usd_push, min: Math.round(Math.max(0, ...p.bars.map((b) => b.end_s)) / 6) / 10 })),
    }),
    dataTable({
      caption: 'Changes',
      filter: false,
      columns: [
        { key: 'change', label: 'Change' },
        { key: 'state', label: 'State' },
      ],
      linkKey: 'link',
      rows: changes.map((c) => ({ change: c.label, state: c.state === 'no' ? `no: ${c.why ?? ''}` : c.state, link: c.pull ? `${REPO_URL}/pull/${c.pull}` : null })),
    }),
    dataTable({
      caption: 'Jobs',
      columns: [
        { key: 'job', label: 'Job' },
        { key: 'workflow', label: 'Workflow' },
        { key: 'runner', label: 'Runner' },
        { key: 'runs', label: 'Runs', type: 'num' },
        { key: 'p50', label: 'p50', type: 'num', unit: 'seconds' },
        { key: 'minutes', label: 'Min', type: 'num' },
        ...usdColumn('Billed'),
      ],
      rows: rows.jobs.map((j) => ({ job: j.job, workflow: j.workflow, runner: LANE[j.kind], runs: j.runs, p50: j.p50_s, minutes: j.minutes, usd: j.kind === 'blacksmith' ? 0 : j.usd })),
    }),
    dataTable({
      caption: 'Providers',
      filter: false,
      columns: [
        { key: 'provider', label: 'Provider' },
        { key: 'price', label: '$ a min' },
        { key: 'pool', label: 'Free' },
        { key: 'stop', label: 'Stop' },
      ],
      rows: PROVIDERS,
    }),
  ];
  return { body: body.join('') };
}
