// SPDX-License-Identifier: Apache-2.0
// The Pull requests page body, under the build's ring: GitHub's Pull requests tab, section by section (Pull requests,
// Review, Merge queue, Stacks), one bullet per metric, then Road to 100, folded so the sections keep the word budget. The build hands it readings and scores only, never per pull request
// facts, so everything here comes from them. At most 80 visible words.

import type { Metric } from '../../contract/format.ts';
import { bullets, metricBullet, roadTo100, totalOf } from '../../core/charts/index.ts';
import type { ReadingLike, RoadFixProps } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';
import type { PageContext, PageOutput } from '../../core/build.ts';
import type { MetricScore } from '../../core/score.ts';

/** The baseline in PLAN.md, taken 2026-11-02 before any fix, with no consumption metric yet; the total by core's own rule. */
export const BASELINE = { q: 16.525044, s: 100, total: totalOf(16.525044, 100) };

/** Short labels: they are most of the page's words. */
const LABELS: Record<string, string> = {
  required_gates_on_merged_head: 'Gates',
  ci_green_first_time: 'Green',
  no_blocking_findings: 'No Blocking',
  no_rework_7d: 'No rework',
  small_changes: 'Small',
  template_complete: 'Template',
  open_to_merge_p50: 'Merge p50',
  open_to_merge_p90: 'Merge p90',
  review_result_p90: 'Review p90',
  queue_ejections_pct: 'Ejected',
  queue_wait_p50: 'Queue p50',
  queue_wait_p90: 'Queue p90',
  queue_prs_per_group_p50: 'Grouped',
  queue_minutes_per_merge: 'Minutes',
  pushes_per_merge: 'Pushes',
  final_push_to_merge_p50: 'Final',
  review_rounds: 'Rounds',
  review_tokens_p50: 'Tokens',
  big_changes_stacked: 'Stacked',
  lane_minutes: 'Lane',
};

/** GitHub's Pull requests tab, in its order: each section's metrics. */
export const SECTIONS: { title: string; ids: string[] }[] = [
  {
    title: 'Pull requests',
    ids: ['required_gates_on_merged_head', 'ci_green_first_time', 'no_rework_7d', 'small_changes', 'template_complete', 'pushes_per_merge', 'open_to_merge_p50', 'open_to_merge_p90', 'final_push_to_merge_p50', 'lane_minutes'],
  },
  { title: 'Review', ids: ['no_blocking_findings', 'review_rounds', 'review_result_p90', 'review_tokens_p50'] },
  { title: 'Merge queue', ids: ['queue_ejections_pct', 'queue_wait_p50', 'queue_wait_p90', 'queue_prs_per_group_p50', 'queue_minutes_per_merge'] },
  { title: 'Stacks', ids: ['big_changes_stacked'] },
];

/** The fixes in PLAN.md, each tied to the metric it moves. */
const FIXES: { id: string; label: string; metric: string }[] = [
  { id: 'rebase', label: 'Rebase, verify', metric: 'required_gates_on_merged_head' },
  { id: 'finish', label: 'Finish first', metric: 'no_rework_7d' },
  { id: 'split', label: 'Split', metric: 'small_changes' },
  { id: 'push', label: 'Push, then open', metric: 'ci_green_first_time' },
  { id: 'template', label: 'Template', metric: 'template_complete' },
  { id: 'rules', label: 'Rules first', metric: 'no_blocking_findings' },
  { id: 'queue', label: 'Rebase, then queue', metric: 'queue_ejections_pct' },
  { id: 'lane', label: 'Lane in 5 min', metric: 'lane_minutes' },
  { id: 'one-push', label: 'One push', metric: 'pushes_per_merge' },
  { id: 'one-round', label: 'One round', metric: 'review_rounds' },
  { id: 'stack', label: 'Stack', metric: 'big_changes_stacked' },
];

/**
 * Points a fix adds to its lens: its metric's weight share times the points core's scorer says are left. A fix that adds nothing
 * to the total under core's own weights draws no row.
 */
export function fixGains(metrics: readonly Metric[], scores: readonly MetricScore[]): RoadFixProps[] {
  const lensWeight = (lens: string) => metrics.filter((m) => m.lens === lens).reduce((n, m) => n + m.weight, 0);
  return FIXES.map((fix) => {
    const m = metrics.find((x) => x.id === fix.metric);
    if (!m) throw new Error(`fix ${fix.id} names no metric`);
    const gain = Math.round((m.weight / lensWeight(m.lens)) * (100 - (scores.find((x) => x.id === m.id)?.score ?? 0)) * 10) / 10;
    return { id: fix.id, label: fix.label, q: m.lens === 'quality' ? gain : 0, s: m.lens === 'speed' ? gain : 0, c: m.lens === 'consumption' ? gain : 0 };
  }).filter((f) => fixGain(f) > 0);
}

export function render(context: PageContext): PageOutput {
  const { score, metrics } = context;
  const reading = (id: string): ReadingLike => score.metrics.find((m) => m.id === id)?.reading ?? 'missing';
  // No date per row: 13 dates cost 26 of the page's words, and a stale reading already scores 0 and draws red.
  const rows = (ids: string[]) =>
    ids.flatMap((id) => metrics.filter((m) => m.id === id)).map((m) => metricBullet({ ...m, measured_at: null }, LABELS[m.id] ?? m.id, { reading: reading(m.id) }));
  // The consumption ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: score.exact_quality, s: score.exact_speed, total: score.total, c: score.exact_consumption };
  return {
    body:
      SECTIONS.map((x) => `<section><h2>${x.title}</h2>${bullets(x.title, rows(x.ids))}</section>`).join('') +
      `<details><summary>Road to 100</summary>${roadTo100({ baseline: BASELINE, now, fixes: fixGains(metrics, score.metrics) })}</details>`,
  };
}
