// SPDX-License-Identifier: Apache-2.0
// The Insights page: delivery health, visible and improving. The site build (core/build.ts) calls render() and puts the
// title and the score ring above the body. Composes the chart kit, plus one infographic (calendar.ts). Every word on the
// page is a fixed label here; the data adds numbers, dates and pull request numbers, never a title or a body.
//
// See it with the build: `node quality-speed/core/build.ts --synthetic --out <dir>`.
import { existsSync, readFileSync } from 'node:fs';
import type { Manifest, Metric, MetricDef, MetricRecord } from '../../contract/format.ts';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, dataTable, markKey, metricBullet, missingTile, roadTo100, trend } from '../../core/charts/index.ts';
import type { MetricLike, RoadFixProps, TrendPoint } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';
import { calendar } from './calendar.ts';
import { checkDetail, type Detail, type MetricId } from './records.ts';
import { baselineScore, fromCore, type PageScore } from './score.ts';
import { daily, sinceFirst, type Day } from './series.ts';

const REPO_URL = 'https://github.com/Colorado-Startups/legallas';

/** One or two words per metric. */
const LABELS: Record<MetricId | 'lane_minutes', string> = {
  change_failure_rate: 'Failed',
  rework_rate: 'Rework',
  merges_tied_to_issue: 'Tied',
  failure_drill: 'Drill',
  change_frequency: 'Change days',
  lead_time_p50: 'Lead time',
  recovery_time_p50: 'Recovery',
  lane_minutes: 'Lane minutes',
};

/** The fixes on the Road to 100 (PLAN.md, "Fixes"), and which metric each one moves. */
type FixId = 'time' | 'issue_line' | 'review_first' | 'daily' | 'smaller' | 'repair_faster' | 'drill' | 'lane';
const FIXES: Record<FixId, string> = {
  time: 'A week',
  issue_line: 'Issue line',
  review_first: 'Review first',
  daily: 'Daily changes',
  smaller: 'Smaller changes',
  repair_faster: 'Faster repair',
  drill: 'Drill',
  lane: 'Lane in 5 min',
};

function fixFor(id: MetricId | 'lane_minutes', score: PageScore): FixId {
  const waiting = score.readings.get(id) === 'too_few_samples' || score.readings.get(id) === 'missing';
  if ((id === 'change_failure_rate' || id === 'change_frequency') && waiting) return 'time';
  switch (id) {
    case 'merges_tied_to_issue':
      return 'issue_line';
    case 'rework_rate':
    case 'change_failure_rate':
      return 'review_first';
    case 'change_frequency':
      return 'daily';
    case 'lead_time_p50':
      return 'smaller';
    case 'recovery_time_p50':
      return 'repair_faster';
    case 'failure_drill':
      return 'drill';
    case 'lane_minutes':
      return 'lane';
  }
}

/**
 * What each fix adds to its ring: each metric's weight share of the points it is short, largest gain on the total first, by
 * core's own weights. A fix that adds nothing to the total there draws no row.
 */
export function roadFixes(m: { metrics: readonly MetricDef[] }, score: PageScore): RoadFixProps[] {
  const lensWeight = (l: MetricDef['lens']) => m.metrics.filter((d) => d.lens === l).reduce((a, d) => a + d.weight, 0);
  const byFix = new Map<FixId, { q: number; s: number; c: number }>();
  for (const d of m.metrics) {
    const short = ((100 - (score.scores.get(d.id) ?? 0)) * d.weight) / lensWeight(d.lens);
    if (short <= 1e-9) continue;
    const fix = fixFor(d.id as MetricId | 'lane_minutes', score);
    const sum = byFix.get(fix) ?? { q: 0, s: 0, c: 0 };
    sum[d.lens === 'quality' ? 'q' : d.lens === 'speed' ? 's' : 'c'] += short;
    byFix.set(fix, sum);
  }
  return [...byFix.entries()]
    .map(([id, g]) => ({ id, label: FIXES[id], q: g.q, s: g.s, c: g.c }))
    .filter((f) => fixGain(f) > 0)
    .sort((a, b) => fixGain(b) - fixGain(a));
}

export interface BodyInput {
  /** The reviewed definitions joined with their readings, as the build passes them. */
  metrics: Metric[];
  score: PageScore;
  /** The baseline's readings, marked on the bullets, trends and Road to 100. */
  baseline: MetricRecord[];
  baseScore: PageScore;
  /** The drill-down rows, when the collector's detail.json is at hand. */
  detail: Detail | null;
  now: number;
}

const joined = (m: Metric): MetricLike => ({
  lens: m.lens,
  unit: m.unit,
  floor: m.floor,
  goal: m.goal,
  value: m.value,
  stage: m.stage,
  measured_at: m.measured_at,
  source_url: m.source_url,
});

function points(days: Day[], key: 'lead' | 'rework' | 'tied'): TrendPoint[] {
  return sinceFirst(days).flatMap((d) => (d[key] === null ? [] : [{ t: d.t, v: d[key] as number }]));
}

export function body(input: BodyInput): string {
  const { metrics, score, baseline, baseScore, detail, now } = input;
  const byId = new Map(metrics.map((m) => [m.id, m]));
  const baseById = new Map(baseline.map((r) => [r.id, r]));
  const metric = (id: MetricId) => byId.get(id) as Metric;
  const bullet = (id: MetricId) => {
    const opts: Parameters<typeof metricBullet>[2] = { reading: score.readings.get(id) ?? 'missing' };
    const b = baseById.get(id)?.value;
    if (typeof b === 'number') opts.baseline = b;
    return metricBullet(joined(metric(id)), LABELS[id], opts);
  };
  const days = detail ? daily(detail, now) : [];
  const line = (id: MetricId, key: 'lead' | 'rework' | 'tied') => {
    const m = metric(id);
    const props: Parameters<typeof trend>[0] = { label: LABELS[id], unit: m.unit, goal: m.goal, lens: m.lens, stage: 'live', points: points(days, key) };
    const b = baseById.get(id)?.value;
    if (typeof b === 'number') props.baseline = b;
    return trend(props);
  };
  const drill = detail
    ? [
        `<section class="qs-grid qs-grid-3">${line('lead_time_p50', 'lead')}${line('rework_rate', 'rework')}${line('merges_tied_to_issue', 'tied')}</section>`,
        dataTable({
          caption: 'Recoveries',
          columns: [
            { key: 'pr', label: 'Change' },
            { key: 'by', label: 'Repaired by' },
            { key: 'hours', label: 'Hours', type: 'num' },
          ],
          linkKey: 'link',
          rows: detail.recoveries.map((r) => ({
            pr: `#${r.pr}`,
            by: r.repaired_by === null ? (r.open ? 'open' : 'green CI') : `#${r.repaired_by}`,
            hours: r.hours,
            link: `${REPO_URL}/pull/${r.pr}`,
          })),
        }),
      ]
    : [];
  const every = dataTable({
    caption: 'Every metric',
    columns: [
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Value', type: 'num', unitKey: 'unit' },
      { key: 'samples', label: 'Samples', type: 'num' },
      { key: 'score', label: 'Score', type: 'score' },
      { key: 'status', label: 'State', type: 'status' },
    ],
    linkKey: 'run',
    rows: metrics.map((m) => {
      const reading = score.readings.get(m.id) ?? 'missing';
      return {
        metric: LABELS[m.id as keyof typeof LABELS],
        value: m.value,
        unit: m.unit,
        samples: m.sample_size,
        score: Math.floor(score.scores.get(m.id) ?? 0),
        status: reading === 'measured' ? 'ok' : reading === 'too_few_samples' ? 'few_samples' : reading,
        run: m.source_url,
      };
    }),
  });
  // Exact lens scores, so the fixes, each a share of the points short, add up to 100 with nothing left over. The consumption
  // ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const ringNow = { q: score.exactQuality, s: score.exactSpeed, total: score.total, c: score.exactConsumption };
  const ringBase = { q: baseScore.exactQuality, s: baseScore.exactSpeed, total: baseScore.total };
  return [
    `<section class="qs-grid qs-grid-2">`,
    detail ? calendar(days, 'Change days') : missingTile({ label: 'Change days', status: 'missing' }),
    `<div class="qs-grid">`,
    bullets('Stable', (['change_failure_rate', 'rework_rate', 'merges_tied_to_issue', 'failure_drill'] as const).map(bullet)),
    bullets('Fast', (['change_frequency', 'lead_time_p50', 'recovery_time_p50'] as const).map(bullet)),
    `</div></section>`,
    ...drill,
    roadTo100({ baseline: ringBase, now: ringNow, fixes: roadFixes({ metrics }, score) }),
    markKey(),
    every,
  ].join('');
}

/** The baseline's readings as records, so the page can mark them. Numbers only; the commit link stands in for a run. */
export interface BaselineFile {
  measured_at: string;
  commit: string;
  readings: { id: string; value: number | null; samples: number; no_events: boolean }[];
}

export function baselineRecords(b: BaselineFile): MetricRecord[] {
  return b.readings.map((r) => {
    const seen = { page: 'insights' as const, stage: 'live' as const, measured_at: b.measured_at, source_url: `${REPO_URL}/commit/${b.commit}` };
    if (r.value !== null) return { id: r.id, status: 'ok', value: r.value, sample_size: r.samples, ...seen };
    if (r.no_events) return { id: r.id, status: 'no_events', value: null, sample_size: 0, ...seen };
    return { id: r.id, status: 'missing', value: null, sample_size: null, ...seen };
  });
}

const here = new URL('./', import.meta.url);

/** A file beside this page, parsed, or null when it is absent or unreadable. */
function nearby(name: string): unknown {
  const file = new URL(name, here);
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as unknown) : null;
  } catch {
    return null;
  }
}

/** The collector's drill-down rows, when a run left detail.json beside this page and it holds numbers only. */
export function loadDetail(value: unknown = nearby('detail.json')): Detail | null {
  return value !== null && typeof value === 'object' && checkDetail(value).length === 0 && Array.isArray((value as Detail).changes)
    ? (value as Detail)
    : null;
}

/** What the site build calls. */
export function render(context: PageContext): PageOutput {
  const file = nearby('baseline/readings.json') as BaselineFile | null;
  const baseline = file ? baselineRecords(file) : [];
  const defs: Manifest = { page: 'insights', metrics: context.metrics, changes: [] };
  const baseScore = baselineScore(defs, baseline, file ? Date.parse(file.measured_at) : 0);
  const measured = context.metrics.map((m) => (m.measured_at ? Date.parse(m.measured_at) : 0));
  const now = Math.max(...measured, 0) || Date.now();
  return { body: body({ metrics: context.metrics, score: fromCore(context.score), baseline, baseScore, detail: loadDetail(), now }) };
}
