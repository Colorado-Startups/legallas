// SPDX-License-Identifier: Apache-2.0
// The Reliability page: every number against its goal, which risky area each review covered, the road to 100, and links
// to the pages that own the neighboring numbers. Every word is a fixed label here. The data adds numbers and dates only.
import { readFileSync } from 'node:fs';
import type { Metric } from '../../contract/format.ts';
import { bullets, dotMatrix, markKey, metricBullet, ring, roadTo100, totalOf } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';
import type { PageScore } from '../../core/score.ts';
import { RISKY_AREAS, type MetricId, type Review } from './measure.ts';

/** One or two words per metric. */
const LABELS: Record<MetricId, string> = {
  open_bugs_critical_high: 'Open high',
  bugs_found_first: 'Found first',
  reopened_bugs_90d: 'Reopened',
  failed_main_runs_with_issue: 'Filed',
  risky_areas_reviewed_in_time: 'Reviewed',
  fixes_with_test: 'Tested',
  detection_drill: 'Drill',
  time_to_find_p90: 'To find',
  time_to_fix_high_p90: 'Fix high',
  time_to_fix_other_p90: 'Fix other',
  error_to_issue_p90: 'To issue',
  failed_main_run_minutes_90d: 'Minutes lost',
};

const AREAS: Record<(typeof RISKY_AREAS)[number], string> = {
  'who-can-see-what': 'Access',
  citations: 'Citations',
  'sync-and-save-back': 'Sync',
  migrations: 'Migrations',
  'pii-guard': 'SSN guard',
  'spend-guard': 'Spend guard',
  'connector-contract': 'Connectors',
};

/** The score before anything was fixed (PLAN.md, "Baseline"), with no consumption metric yet; the total by core's own rule. */
export const BASELINE = { q: 46.81, s: 57.14, total: totalOf(46.81, 57.14) };

/** The pages that own the neighboring numbers: this page links to them and does not measure them again. */
const NEIGHBORS = ['issues', 'testing', 'security', 'actions', 'insights'] as const;

interface Scored {
  quality: number;
  speed: number;
  total: number;
}

export interface Context {
  score: PageScore;
  metrics: Metric[];
  others?: Partial<Record<string, Scored>>;
}

const label = (id: string) => LABELS[id as MetricId] ?? id;

/** The most recent reviews, newest first, each row of areas marked for whether that review covered it. */
export function reviewMatrix(all: readonly Review[]): string {
  const reviews = [...all].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
  return dotMatrix({
    caption: 'Reviews',
    rows: RISKY_AREAS.map((area) => AREAS[area]),
    cols: reviews.map((review) => review.date),
    states: RISKY_AREAS.map((area) => reviews.map((review) => (review.areas.includes(area) ? 'pass' : 'fail'))),
  });
}

/** Each metric short of its goal, with what reaching it adds to its ring. */
function roadFixes(context: Context) {
  const scores = new Map(context.score.metrics.map((m) => [m.id, m.score]));
  const total = (lens: string) => context.metrics.filter((m) => m.lens === lens).reduce((sum, m) => sum + m.weight, 0);
  return context.metrics
    .map((m) => {
      const gain = (m.weight * (100 - (scores.get(m.id) ?? 0))) / (total(m.lens) || 1);
      return { id: m.id, label: label(m.id), q: m.lens === 'quality' ? gain : 0, s: m.lens === 'speed' ? gain : 0, c: m.lens === 'consumption' ? gain : 0 };
    })
    .filter((fix) => fixGain(fix) > 0)
    .sort((a, b) => fixGain(b) - fixGain(a));
}

export function render(context: Context): { body: string } {
  const { score, metrics } = context;
  const readings = new Map(score.metrics.map((m) => [m.id, m.reading]));
  // The consumption ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: score.exact_quality, s: score.exact_speed, total: score.total, c: score.exact_consumption };
  const lens = (name: string) => metrics.filter((m) => m.lens === name).map((m) => metricBullet(m, label(m.id), { reading: readings.get(m.id) ?? 'missing' }));
  const { reviews } = JSON.parse(readFileSync(new URL('./reviews.json', import.meta.url), 'utf8')) as { reviews: Review[] };
  const neighbors = NEIGHBORS.map((page) => {
    const other = context.others?.[page];
    const name = `${page.charAt(0).toUpperCase()}${page.slice(1)}`;
    return ring({ q: other?.quality ?? null, s: other?.speed ?? null, total: other?.total ?? null, size: 'sm', label: name, href: `../${page}/` });
  });
  const body = [
    markKey(),
    `<div class="qs-grid-2">${bullets('Quality', lens('quality'))}${bullets('Speed', lens('speed'))}</div>`,
    bullets('Consumption', lens('consumption')),
    reviewMatrix(reviews),
    roadTo100({ baseline: BASELINE, now, fixes: roadFixes(context) }),
    // Closed, so the five page names stay one click away without counting against the word limit.
    `<details><summary>Pages</summary><div class="qs-ring-row">${neighbors.join('')}</div></details>`,
  ];
  return { body: body.join('') };
}
