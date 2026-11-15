// SPDX-License-Identifier: Apache-2.0
// The Compliance page: what a firm's security review would get today. Tiles per metric, each policy area written, true to
// the code and reviewed, the attestations the README says are held (none is ever assumed), Road to 100, and a table per area.
// Every state comes from the lane's detail; words come only from labels.
import type { PageContext, PageOutput } from '../../core/build.ts';
import { dataTable, dotMatrix, markKey, metricTile, roadTo100, tileRow } from '../../core/charts/index.ts';
import type { PassState, RoadFixProps } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';
import type { Detail } from '../../core/detail.ts';
import { combine, type PageScore, type ScoredRow } from '../../core/score.ts';
import { AREAS, ATTESTATIONS } from './collect.ts';

const LABELS: Record<string, string> = {
  policy_areas_covered: 'Areas',
  evidence_refs_dead: 'Dead refs',
  policy_review_age_days: 'Review age',
  restore_drill_age_days: 'Drill age',
  lane_minutes: 'Lane',
};
const AREA_NAMES: Record<string, string> = { ai: 'AI', access: 'Access', encryption: 'Encryption', data: 'Data', continuity: 'Continuity', incidents: 'Incidents', vulns: 'Vulnerabilities' };
const ATTESTATION_NAMES: Record<string, string> = { soc2: 'SOC 2', iso27001: 'ISO 27001', iso42001: 'ISO 42001', pentest: 'Pen test' };
/** The review interval every policy sets for itself (docs/security/README.md). */
const REVIEW_DAYS = 365;

/** The fixes left, in order (PLAN.md, Fixes): each brings these metrics to goal. */
const FIXES: { id: string; label: string; metrics: string[] }[] = [
  { id: 'policies', label: 'Policies', metrics: ['policy_areas_covered'] },
  { id: 'refs', label: 'Full paths', metrics: ['evidence_refs_dead'] },
  { id: 'drill', label: 'Drill', metrics: ['restore_drill_age_days'] },
  { id: 'review', label: 'Review', metrics: ['policy_review_age_days'] },
  { id: 'lane', label: 'Lane', metrics: ['lane_minutes'] },
];

const state = (pass: boolean | undefined): PassState | undefined => (pass === undefined ? undefined : pass ? 'pass' : 'fail');

/** Each area's three marks, from the lane's detail. With no detail, every mark reads missing. */
export function areaStates(detail: Detail | null): PassState[][] {
  const check = (id: string) => (detail && id in detail.checks ? detail.checks[id] === 1 : undefined);
  const reading = (id: string) => detail?.readings[id];
  const row = (mark: (area: string) => boolean | undefined) => AREAS.map(({ id }) => state(mark(id)) as PassState);
  return [
    row((id) => check(`area_${id}`)),
    // True to the code: it cites something, and every citation resolves.
    row((id) => {
      const dead = reading(`dead_${id}`);
      return dead === undefined ? undefined : dead.n > 0 && dead.value === 0;
    }),
    row((id) => {
      const age = reading(`age_${id}`);
      return age === undefined ? undefined : age.value <= REVIEW_DAYS;
    }),
  ];
}

/** Held only when the README's table says so. With no detail, each reads missing, never held. */
export const attestationStates = (detail: Detail | null): PassState[] =>
  ATTESTATIONS.map(({ id }) => state(detail && `attest_${id}` in detail.checks ? detail.checks[`attest_${id}`] === 1 : undefined) as PassState);

/** The fixes left: each in turn brings its metrics to goal, scored by the site's own rule. One that adds nothing draws no row. */
export function roadFixes(start: ScoredRow[], page: PageScore): RoadFixProps[] {
  let rows = start;
  let before = combine(rows);
  const fixes: RoadFixProps[] = [];
  for (const fix of FIXES) {
    rows = rows.map((r) => (fix.metrics.includes(r.id) ? { ...r, score: 100 } : r));
    const after = combine(rows);
    const props = {
      id: fix.id,
      label: fix.label,
      q: after.exact_quality - before.exact_quality,
      s: after.exact_speed - before.exact_speed,
      c: after.exact_consumption - before.exact_consumption,
    };
    if (fixGain(props) > 0) fixes.push(props);
    before = after;
  }
  return fixes;
}

function areaTable(detail: Detail | null): string {
  const value = (id: string) => detail?.readings[id]?.value ?? null;
  return dataTable({
    caption: 'Each policy',
    columns: [
      { key: 'area', label: 'Area' },
      { key: 'refs', label: 'Citations', type: 'num' },
      { key: 'dead', label: 'Dead', type: 'num' },
      { key: 'gaps', label: 'Gaps stated', type: 'num' },
      { key: 'age', label: 'Days since change', type: 'num' },
    ],
    rows: AREAS.map(({ id }) => ({ area: AREA_NAMES[id] ?? id, refs: detail?.readings[`dead_${id}`]?.n ?? null, dead: value(`dead_${id}`), gaps: value(`gaps_${id}`), age: value(`age_${id}`) })),
  });
}

export function render({ score: page, metrics, detail }: PageContext): PageOutput {
  const tiles = metrics.map((m, i) => metricTile(m, LABELS[m.id] ?? m.id, { reading: page.metrics[i]?.reading ?? 'missing' }));
  const rows: ScoredRow[] = metrics.map((m, i) => ({ id: m.id, lens: m.lens, weight: m.weight, group: m.group, score: page.metrics[i]?.score ?? 0 }));
  const areas = dotMatrix({ caption: 'Policies', rows: ['Written', 'True to code', 'Reviewed'], cols: AREAS.map(({ id }) => AREA_NAMES[id] ?? id), states: areaStates(detail) });
  const held = dotMatrix({ caption: 'Attestations held', rows: ['Held'], cols: ATTESTATIONS.map(({ id }) => ATTESTATION_NAMES[id] ?? id), states: [attestationStates(detail)] });
  const now = { q: page.exact_quality, s: page.exact_speed, c: page.exact_consumption, total: page.total };
  const road = roadTo100({ baseline: { q: 0, s: 0, c: 0, total: 0 }, now, fixes: roadFixes(rows, page) });
  return { body: [markKey(), tileRow(tiles), `<div class="qs-grid-2">${areas}${held}</div>`, road, `<details><summary>Table</summary>${areaTable(detail)}</details>`].join('\n') };
}
