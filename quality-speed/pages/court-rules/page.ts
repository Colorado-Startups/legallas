// SPDX-License-Identifier: Apache-2.0
// The Court rules page: the court map (the infographic), one bullet per metric, and Road to 100. PLAN.md has the
// metrics; needs.json is the reviewed list. It reads the law.json the law kit's collector writes beside it, so it runs
// inside the build's fence.
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, dotMatrix, metricBullet, missingTile, roadTo100, totalOf, type PassState } from '../../core/charts/index.ts';
import type { LawView } from '../../core/law/law.ts';
import { readView, roadFixes } from '../../core/law/page.ts';

export const FORUMS = ['Federal', 'Colorado', 'Delaware'];
export const TOPICS = ['Lost ESI', 'Discovery', 'Privilege', 'Local rules', 'Arbitration', 'Service'];

/** Where each need sits on the map: one or more [topic, forum] cells. */
export const MAP: Record<string, [string, string][]> = {
  'us-lost-esi': [['Lost ESI', 'Federal']],
  'us-obstruction': [['Lost ESI', 'Federal']],
  'us-securities-stay': [['Lost ESI', 'Federal']],
  'co-lost-esi': [['Lost ESI', 'Colorado']],
  'de-lost-esi': [['Lost ESI', 'Delaware']],
  'us-discovery': [['Discovery', 'Federal']],
  'co-discovery': [['Discovery', 'Colorado'], ['Privilege', 'Colorado']],
  'de-discovery': [['Discovery', 'Delaware']],
  'us-privilege-log': [['Privilege', 'Federal']],
  'us-privilege-waiver': [['Privilege', 'Federal']],
  'de-privilege-log': [['Privilege', 'Delaware']],
  'd-colo-local': [['Local rules', 'Federal']],
  'd-del-local': [['Local rules', 'Federal']],
  'arbitration-clause': [['Arbitration', 'Federal']],
  'us-arbitration': [['Arbitration', 'Federal']],
  'co-arbitration': [['Arbitration', 'Colorado']],
  'de-arbitration': [['Arbitration', 'Delaware']],
  'de-director-service': [['Service', 'Delaware']],
};

/** The baseline, retaken with the law kit on main at 23a5a4c, 2026-11-04 (PLAN.md, Baseline), with no consumption metric yet; the total by core's own rule. */
export const BASELINE = { q: 45, s: 100, total: totalOf(45, 100) };

/**
 * A cell passes when the collector found every need in it held, fails when any isn't, and is hatched when no need belongs
 * there. Before the collector has run it is a red tile, never a guess.
 */
export function courtMap(view: LawView | null): string {
  if (!view) return missingTile({ label: 'Court map' });
  const cells = new Map<string, boolean[]>();
  for (const row of view.rows) {
    const places = MAP[row.id];
    if (!places) throw new Error(`${row.id}: a need with no place on the court map`);
    for (const [topic, forum] of places) cells.set(`${topic}|${forum}`, [...(cells.get(`${topic}|${forum}`) ?? []), row.covered]);
  }
  const state = (held: boolean[] | undefined): PassState => (!held ? 'na' : held.every(Boolean) ? 'pass' : 'fail');
  return dotMatrix({ caption: 'Court map', rows: TOPICS, cols: FORUMS, states: TOPICS.map((t) => FORUMS.map((f) => state(cells.get(`${t}|${f}`)))) });
}

const LABEL: Record<string, string> = { law_lookup_tokens_p95: 'Lookup tokens' };
const label = (id: string) => LABEL[id] ?? `${id[0]!.toUpperCase()}${id.slice(1).replaceAll('_', ' ')}`;

export function render(context: PageContext): PageOutput {
  const view = readView(new URL('./law.json', import.meta.url));
  const rows = context.metrics.map((m, i) => metricBullet(m, label(m.id), { reading: context.score.metrics[i]?.reading ?? 'missing' }));
  // Exact halves, so the fixes, which close each metric's exact gap, end at 100 with no rounding remainder.
  // The consumption ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: context.score.exact_quality, s: context.score.exact_speed, total: context.score.total, c: context.score.exact_consumption };
  return { body: `${courtMap(view)}${bullets('Metrics', rows)}${roadTo100({ baseline: BASELINE, now, fixes: roadFixes(context) })}` };
}
