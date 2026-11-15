// SPDX-License-Identifier: Apache-2.0
// The launch readiness page, under the build's ring: the owner's conditions, a bullet per metric, each group's
// conditions as check marks, every condition met or open with its evidence, and Road to
// 100. Each condition's and rule's state comes from the lanes' detail; evidence comes from the list.
import { readFileSync } from 'node:fs';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, dataTable, metricBullet, metricTile, pictogram, roadTo100 } from '../../core/charts/index.ts';
import type { RoadFixProps } from '../../core/charts/index.ts';
import { combine, lineScore, type ScoredRow } from '../../core/score.ts';
import { type Condition, type Conditions, isScored } from './collect.ts';

export const LIST: Conditions = JSON.parse(readFileSync(new URL('conditions.json', import.meta.url), 'utf8'));

const NAMES: Record<string, string> = {
  regulatory: 'Regulatory',
  claims: 'Claims',
  ai: 'AI',
  ip: 'IP',
  third_party: 'Third party',
  contracts: 'Contracts',
  privacy: 'Privacy',
  filing: 'Filing',
  security: 'Security',
  conditions_met: 'Conditions met',
  lane_minutes: 'Lane minutes',
  days_to_clear: 'Days to clear',
};

/** PLAN.md's baseline, taken before any fix. */
export const BASELINE = { q: 0, s: 0, total: 0 };

const scored = (list: Conditions) => list.conditions.filter(isScored);
const inGroup = (list: Conditions, group: string) => scored(list).filter((c) => c.group === group);
/**
 * Whether a condition is met: the lane's verified check for a scored one; for the owner's, whether it has evidence, which
 * they get only once done. A card row has neither, so it never reads met.
 */
type Met = (id: string) => boolean;
const metOf = (list: Conditions, detail: PageContext['detail']): Met => (id) =>
  detail && id in detail.checks ? detail.checks[id] === 1 : (list.conditions.find((c) => c.id === id && c.owner)?.evidence ?? null) !== null;
/** Waiting for a condition that isn't met yet. */
const waits = (c: Condition, met: Met) => c.after !== undefined && !met(c.after);

/** A group's verified count of met conditions, from the lane's checks. */
export function metIn(list: Conditions, detail: PageContext['detail'], group: string): number {
  return inGroup(list, group).filter((c) => detail?.checks[c.id] === 1).length;
}

/** Road to 100: each group's conditions open now, most first, then those after the go-ahead, then the pace. */
export function road(list: Conditions, context: Pick<PageContext, 'metrics' | 'score' | 'detail'>): RoadFixProps[] {
  const isMet = metOf(list, context.detail);
  const groups = [...new Set(scored(list).map((c) => c.group))];
  const open = (g: string, later: boolean) => inGroup(list, g).filter((c) => !isMet(c.id) && waits(c, isMet) === later).length;
  const steps: Array<{ id: string; label: string; adds: number; metric?: string }> = groups
    .filter((g) => open(g, false) > 0)
    .sort((a, b) => open(b, false) - open(a, false))
    .map((g) => ({ id: g, label: NAMES[g] ?? g, adds: open(g, false) }));
  const later = groups.reduce((n, g) => n + open(g, true), 0);
  if (later > 0) steps.push({ id: 'go_ahead', label: 'After go-ahead', adds: later });
  steps.push({ id: 'pace', label: 'Pace', adds: 0, metric: 'days_to_clear' });
  const total = scored(list).length;
  let met = scored(list).filter((c) => isMet(c.id)).length;
  let state: ScoredRow[] = context.metrics.map((m, i) => ({ id: m.id, lens: m.lens, weight: m.weight, score: context.score.metrics[i]?.score ?? 0 }));
  let before = combine(state);
  const fixes: RoadFixProps[] = [];
  for (const step of steps) {
    met += step.adds;
    state = state.map((row) => {
      const def = context.metrics.find((m) => m.id === row.id);
      if (!def) return row;
      const value = row.id === 'conditions_met' ? (100 * met) / total : row.id === step.metric ? def.goal : undefined;
      return value === undefined ? row : { ...row, score: Math.max(row.score, lineScore(def, value)) };
    });
    const after = combine(state);
    const q = after.exact_quality - before.exact_quality;
    const s = after.exact_speed - before.exact_speed;
    if (q + s > 0) fixes.push({ id: step.id, label: step.label, q, s });
    before = after;
  }
  return fixes;
}

/** The body under the build's heading and ring. */
export function render(context: PageContext, list: Conditions = LIST): PageOutput {
  const { metrics, score, detail } = context;
  const isMet = metOf(list, detail);
  const reading = (i: number) => score.metrics[i]?.reading ?? 'missing';
  const owners = list.conditions.filter((c) => c.owner);
  const groups = [...new Set(scored(list).map((c) => c.group))];
  const speed = metrics.findIndex((m) => m.id === 'days_to_clear');
  const speedMetric = metrics[speed];
  const needs = (c: Condition) => (c.owner ? 'Owner' : !isScored(c) ? 'Board' : waits(c, isMet) ? 'Go-ahead' : '');
  const now = { q: score.exact_quality, s: score.exact_speed, total: score.total };
  const body = `<section>
${pictogram({ label: 'Needs the owner', total: owners.length, filled: owners.filter((c) => isMet(c.id)).length, glyph: 'person' })}
${bullets('Against goal', metrics.map((m, i) => metricBullet(m, NAMES[m.id] ?? m.id, { reading: reading(i) })))}
</section>
<section><h2>Conditions met</h2>
<div class="qs-grid qs-grid-3">${groups.map((g) => pictogram({ label: NAMES[g] ?? g, total: inGroup(list, g).length, filled: metIn(list, detail, g), glyph: 'check' })).join('')}</div>
</section>
<section><h2>Pace</h2>
${speedMetric ? metricTile(speedMetric, NAMES.days_to_clear ?? '', { reading: reading(speed) }) : ''}
</section>
<section>
${dataTable({
  caption: 'Every condition',
  columns: [
    { key: 'label', label: 'Condition' },
    { key: 'group', label: 'Group' },
    { key: 'needs', label: 'Needs' },
    { key: 'met', label: 'Met' },
    { key: 'evidence', label: 'Evidence' },
  ],
  rows: list.conditions.map((c) => ({
    label: c.label,
    group: NAMES[c.group] ?? c.group,
    needs: needs(c),
    met: detail && c.id in detail.checks ? (detail.checks[c.id] === 1 ? 'Met' : 'Open') : '',
    evidence: c.evidence === null ? (c.eval ? 'Eval' : '') : typeof c.evidence === 'number' ? `#${c.evidence}` : 'Card',
    href: typeof c.evidence === 'number' ? `https://github.com/Colorado-Startups/legallas/issues/${c.evidence}` : c.eval ? `https://github.com/Colorado-Startups/legallas/blob/main/${c.eval}` : undefined,
  })),
  linkKey: 'href',
  filter: true,
})}
</section>
<section>
${roadTo100({ baseline: { ...BASELINE }, now, fixes: road(list, context) })}
</section>`;
  return { body };
}
