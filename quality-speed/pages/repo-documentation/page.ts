// SPDX-License-Identifier: Apache-2.0
// The Repo documentation page, inside the site build's shell (core/build.ts adds the title, the ring and the change log).
// From validated metrics only: four tiles, the front door (this page's infographic: each thing a visitor meets on
// GitHub, scored per lens from the metrics behind it), bullets against goal, the trend and Road to 100.

import type { Metric } from '../../contract/format.ts';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, heatmap, heatLegend, metricBullet, metricTile, roadTo100, tileRow, trend } from '../../core/charts/index.ts';
import type { HeatCell, RoadFixProps } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';
import { type ScoredRow, combine } from '../../core/score.ts';

/** Short labels: at most two words each, so the page stays inside its word budget. */
const LABEL: Record<string, string> = {
  readme_visual_share: 'Visual',
  front_door_dead_names: 'Claims',
  front_door_broken_links: 'Links',
  dead_external_links: 'Outside links',
  community_files_ok: 'Community',
  license_detected: 'Licence',
  about_box_set: 'About',
  main_via_pr: 'Via PR',
  custom_properties_set: 'Properties',
  readme_reading_minutes: 'Reading',
  readme_tokens: 'Tokens',
  lane_minutes: 'Lane',
};

/**
 * The front door, as GitHub shows it. The audit log has no metric: reading it needs an org admin token the lanes don't
 * have (PLAN.md), so its row shows that gap as a missing cell, never a score.
 */
export const ITEMS: { id: string; label: string; metrics: string[] }[] = [
  { id: 'readme', label: 'README', metrics: ['readme_visual_share', 'front_door_dead_names', 'front_door_broken_links', 'dead_external_links', 'readme_reading_minutes', 'readme_tokens'] },
  { id: 'license', label: 'LICENSE', metrics: ['license_detected'] },
  { id: 'community', label: 'Community', metrics: ['community_files_ok'] },
  { id: 'about', label: 'About', metrics: ['about_box_set'] },
  { id: 'activity', label: 'Activity', metrics: ['main_via_pr', 'lane_minutes'] },
  { id: 'properties', label: 'Properties', metrics: ['custom_properties_set'] },
  { id: 'audit', label: 'Audit log', metrics: [] },
];

const LENSES = ['quality', 'speed', 'consumption'] as const;

/** Fixes left, each moving its metrics to goal: the page's Road to 100. */
const FIXES: { id: string; label: string; metrics: string[] }[] = [
  { id: 'security', label: 'Visual security', metrics: ['community_files_ok'] },
  { id: 'about', label: 'Topics, website', metrics: ['about_box_set'] },
  { id: 'properties', label: 'Set properties', metrics: ['custom_properties_set'] },
  { id: 'readme', label: 'README to goal', metrics: ['readme_visual_share', 'readme_reading_minutes', 'readme_tokens'] },
  { id: 'links', label: 'Links, claims', metrics: ['front_door_dead_names', 'front_door_broken_links', 'dead_external_links'] },
  { id: 'lane', label: 'Lane in 5 min', metrics: ['lane_minutes'] },
];

/** Each item's score per lens: the weighted mean of its metrics' scores; excluded when the lens has none there. */
export function itemCells(rows: ScoredRow[]): HeatCell[] {
  const cells: HeatCell[] = [];
  for (const item of ITEMS) {
    for (const lens of LENSES) {
      const mine = rows.filter((r) => r.lens === lens && item.metrics.includes(r.id));
      const weight = mine.reduce((n, r) => n + r.weight, 0);
      // The audit log's gap shows as missing in Quality, the lens it would score.
      if (item.metrics.length === 0) cells.push(lens === 'quality' ? { row: item.id, col: lens, score: null } : { row: item.id, col: lens, score: null, excluded: true });
      else if (weight === 0) cells.push({ row: item.id, col: lens, score: null, excluded: true });
      else cells.push({ row: item.id, col: lens, score: Math.floor(mine.reduce((n, r) => n + r.weight * r.score, 0) / weight) });
    }
  }
  return cells;
}

export function render({ score, metrics, history }: PageContext): PageOutput {
  if (!score.has_list) return { body: '' };
  const reading = (i: number) => score.metrics[i]?.reading ?? 'missing';
  const label = (m: Metric) => LABEL[m.id] ?? m.id;
  const rows: ScoredRow[] = metrics.map((m, i) => ({ id: m.id, lens: m.lens, weight: m.weight, group: m.group, score: score.metrics[i]?.score ?? 0 }));
  // The consumption ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: score.exact_quality, s: score.exact_speed, total: score.total, c: score.exact_consumption };
  const first = history[0];
  const base = first ? { q: first.quality, s: first.speed, total: first.total } : now;
  // A fix under a twentieth of a point across the lenses draws nothing.
  const fixes: RoadFixProps[] = FIXES.map((f) => {
    const lifted = combine(rows.map((r) => (f.metrics.includes(r.id) ? { ...r, score: 100 } : r)));
    return { id: f.id, label: f.label, q: lifted.exact_quality - now.q, s: lifted.exact_speed - now.s, c: lifted.exact_consumption - now.c };
  }).filter((f) => fixGain(f) > 0.05 / 3);
  const tile = (id: string) => {
    const i = metrics.findIndex((m) => m.id === id);
    const m = metrics[i];
    return m ? metricTile(m, label(m), { reading: reading(i) }) : '';
  };
  const bulletsOf = (lenses: readonly string[]) => metrics.flatMap((m, i) => (lenses.includes(m.lens) ? [metricBullet(m, label(m), { reading: reading(i) })] : []));
  const line = history.length >= 2 ? trend({ label: 'Total', points: history.map((h) => ({ t: h.at, v: h.total })), goal: 100, domain: [0, 100], lens: 'quality' }) : '';
  return {
    body: `
${tileRow([tile('readme_visual_share'), tile('readme_reading_minutes'), tile('main_via_pr'), tile('readme_tokens')])}
<section>${heatmap({
      title: 'Front door',
      rows: ITEMS.map((i) => ({ id: i.id, label: i.label })),
      cols: [{ id: 'quality', label: 'Quality', short: 'Q' }, { id: 'speed', label: 'Speed', short: 'S' }, { id: 'consumption', label: 'Consumption', short: 'C' }],
      cells: itemCells(rows),
    })}${heatLegend()}</section>
<section class="qs-grid qs-grid-2">${bullets('Quality', bulletsOf(['quality']))}${bullets('Speed, use', bulletsOf(['speed', 'consumption']))}</section>
${line}
<section>${roadTo100({ baseline: base, now, fixes })}</section>`,
  };
}
