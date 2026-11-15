// SPDX-License-Identifier: Apache-2.0
// The Projects page: one ordered board of visual cards, little in progress, nothing started sitting long, done means a
// merged pull request, and its views and workflows keep it so. The build adds the title, the ring and the ideal state; this returns the rest, from the chart kit
// only. Every word is a fixed label here; the stage strip's counts come from detail.json (board.ts stageDetail).
import type { Metric } from '../../contract/format.ts';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, dataTable, dotMatrix, markKey, meter, metricBullet, metricTile, roadTo100, tileRow } from '../../core/charts/index.ts';
import type { PassState, RoadFixProps } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';
import type { Detail } from '../../core/detail.ts';
import type { MetricScore } from '../../core/score.ts';
import { checksFor, STAGES, stageId } from './board.ts';

/** A label for each metric, and for the fix that brings it to goal. */
const LABELS: Record<string, { label: string; fix: string }> = {
  in_progress: { label: 'In progress', fix: 'Finish before starting' },
  done_with_pr: { label: 'Done with PR', fix: 'Link the PR' },
  cards_ready: { label: 'Cards ready', fix: 'Table first, few words' },
  oldest_active_hours: { label: 'Oldest started', fix: 'Done in three days' },
  views_correct: { label: 'Views', fix: 'Reset the views' },
  status_matches_state: { label: 'Status matches', fix: 'Turn workflows on' },
  lane_minutes: { label: 'Lane minutes', fix: 'Shorter lane' },
};

const STAGE_NAMES = ['Backlog', 'Ready', 'In progress', 'In review', 'Done'];
/** The stage strip's columns: board.ts checksFor's ids, in order. */
const CHECKS: [string, string][] = [
  ['order', 'Order'],
  ['tag', 'Stage or codebase'],
  ['visual', 'Table first'],
  ['short', '30 words'],
  ['age', '3 days'],
  ['pr', 'Merged PR'],
];

const label = (id: string) => LABELS[id]?.label ?? id;

/** What reaching goal on each metric adds to its ring: its weight's share of the points it is short, largest gain on the total first. */
export function roadFixes(metrics: readonly Metric[], scores: readonly MetricScore[]): RoadFixProps[] {
  const lensWeight = (lens: Metric['lens']) => metrics.filter((m) => m.lens === lens).reduce((a, m) => a + m.weight, 0);
  return metrics
    .map((m, i) => {
      const gain = ((100 - (scores[i]?.score ?? 0)) * m.weight) / lensWeight(m.lens);
      return { id: m.id, label: LABELS[m.id]?.fix ?? m.id, q: m.lens === 'quality' ? gain : 0, s: m.lens === 'speed' ? gain : 0, c: m.lens === 'consumption' ? gain : 0 };
    })
    .filter((f) => fixGain(f) > 1e-9)
    .sort((a, b) => fixGain(b) - fixGain(a));
}

/**
 * Each stage against each check: pass when every card there passes, hatched when the check isn't asked of that stage or the
 * stage is empty, and red when it fails or wasn't read. Each row names its card count.
 */
function stageStrip(detail: Detail | null): string {
  const rows = STAGES.map((stage, i) => {
    const n = detail?.readings[stageId(stage)]?.value;
    return n === undefined ? (STAGE_NAMES[i] as string) : `${STAGE_NAMES[i]} ${n}`;
  });
  const states = STAGES.map((stage) => {
    const asked = Object.keys(checksFor(stage, 0, 0));
    return CHECKS.map(([check]): PassState | undefined => {
      if (!asked.includes(check)) return 'na';
      const r = detail?.readings[`${stageId(stage)}_${check}`];
      if (!r) return undefined;
      return r.n === 0 ? 'na' : r.value === r.n ? 'pass' : 'fail';
    });
  });
  return dotMatrix({ caption: 'Stages', rows, cols: CHECKS.map(([, name]) => name), states: states as PassState[][] });
}

export function render({ score, metrics, history, detail }: PageContext): PageOutput {
  if (!score.has_list) return { body: '' };
  const at = (id: string) => metrics.findIndex((m) => m.id === id);
  const reading = (id: string) => score.metrics[at(id)]?.reading ?? 'missing';
  const metric = (id: string) => metrics[at(id)] as Metric;
  const first = history[0];
  const baseline = first ? { q: first.quality, s: first.speed, total: first.total } : { q: score.quality, s: score.speed, total: score.total };
  // The consumption ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: score.exact_quality, s: score.exact_speed, total: score.total, c: score.exact_consumption };
  // Work in progress against the floor, where it scores 0: amber past the goal, red at the floor. A meter's limit is
  // already over, so the goal itself can't be the limit.
  const wip = metric('in_progress');
  const wipMeter =
    reading('in_progress') === 'measured' && wip.value !== null
      ? meter({ label: label('in_progress'), value: wip.value, limit: wip.floor, warnAt: (wip.goal + 1) / wip.floor })
      : tileRow([metricTile(wip, label('in_progress'), { reading: reading('in_progress') })]);
  const table = dataTable({
    caption: 'Every metric',
    columns: [
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Value', type: 'num', unitKey: 'unit' },
      { key: 'samples', label: 'Cards', type: 'num' },
      { key: 'score', label: 'Score', type: 'score' },
    ],
    linkKey: 'run',
    rows: metrics.map((m, i) => ({ metric: label(m.id), value: m.value, unit: m.unit, samples: m.sample_size, score: Math.floor(score.metrics[i]?.score ?? 0), run: m.source_url })),
  });
  const body = [
    stageStrip(detail),
    wipMeter,
    bullets('Board', ['oldest_active_hours', 'cards_ready', 'done_with_pr'].map((id) => metricBullet(metric(id), label(id), { reading: reading(id) }))),
    bullets('Upkeep', ['views_correct', 'status_matches_state'].map((id) => metricBullet(metric(id), label(id), { reading: reading(id) }))),
    roadTo100({ baseline, now, fixes: roadFixes(metrics, score.metrics) }),
    markKey(),
    table,
  ].join('');
  return { body };
}
