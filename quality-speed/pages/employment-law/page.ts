// SPDX-License-Identifier: Apache-2.0
// The Employment law page: what a first hire rests on (the infographic), the law kit's charts, Consumption bullets and Road to 100. It reads
// only its own folder, as the build's fence requires: needs.json, the reviewed list, and law.json, which the collector
// writes. PLAN.md has the metrics.
import { readFileSync } from 'node:fs';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, dotMatrix, metricBullet, missingTile, roadTo100, totalOf, type PassState } from '../../core/charts/index.ts';
import type { LawView, NeedsList } from '../../core/law/law.ts';
import { lawCharts, readView, roadFixes } from '../../core/law/page.ts';

/** The first-hire checklist items this page scores, as a founder meets them. */
export const FIRST_HIRE: [item: string, label: string][] = [
  ['people.job-postings', 'Job posting'],
  ['people.offer-letters', 'Offer letter'],
  ['people.restrictive-covenants', 'Non-compete'],
  ['people.form-i-9', 'Form I-9'],
  ['people.new-hire-reports', 'New hire report'],
  ['people.colorado-wage-rules', 'Pay rules'],
  ['people.paid-sick-leave', 'Sick leave'],
  ['people.family-and-medical-leave-insurance', 'FAMLI'],
  ['people.unemployment-insurance-account', 'Unemployment'],
  ['compliance-and-governance.workers-compensation-insurance', "Workers' comp"],
  ['people.workplace-posters', 'Notices'],
  ['people.contractor-agreements', 'Contractors'],
];

/**
 * The baseline, retaken with the law kit on main at 23a5a4c, 2026-11-04; lag.ts from its last real run (PLAN.md, Baseline). No
 * consumption metric yet; the total by core's own rule.
 */
export const BASELINE = { q: 61.9, s: 100, total: totalOf(61.9, 100) };

/** The law levels a need rests on: from its units' ids, or from its source when it names no unit. */
function levels(need: NeedsList['needs'][number]): Set<'co' | 'us'> {
  const units = need.covered_by.filter((r) => r.startsWith('unit:')).map((r) => (r.startsWith('unit:co-') ? 'co' : 'us'));
  if (units.length) return new Set(units);
  return new Set([/^https:\/\/(olls\.info|cdle\.colorado\.gov)\//.test(need.source) ? 'co' : 'us']);
}

/** The infographic: each first-hire item against Colorado and federal law, held when every need behind it at that level is. */
export function firstHire(list: NeedsList, view: LawView | null): string {
  if (!view) return missingTile({ label: 'A first hire' });
  const states = FIRST_HIRE.map(([item]): PassState[] => {
    const needs = list.needs.filter((n) => n.covered_by.includes(`item:${item}`));
    if (!needs.length) throw new Error(`${item}: a first-hire item no need relies on`);
    return (['co', 'us'] as const).map((level) => {
      const rows = needs.filter((n) => levels(n).has(level)).map((n) => view.rows.find((r) => r.id === n.id));
      return rows.length === 0 ? 'na' : rows.every((r) => r?.covered) ? 'pass' : 'fail';
    });
  });
  return dotMatrix({ caption: 'A first hire', rows: FIRST_HIRE.map(([, label]) => label), cols: ['Colorado', 'Federal'], states });
}

const USE_LABEL: Record<string, string> = { lane_minutes: 'Lane minutes', law_lookup_tokens_p95: 'Lookup tokens' };

export function render(context: PageContext): PageOutput {
  const list = JSON.parse(readFileSync(new URL('./needs.json', import.meta.url), 'utf8')) as NeedsList;
  const view = readView(new URL('./law.json', import.meta.url));
  // The exact lens scores, so the fixes add up to 100; the ring and its label keep the rounded-down total.
  // The consumption ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: context.score.exact_quality, s: context.score.exact_speed, total: context.score.total, c: context.score.exact_consumption };
  const scored = new Map(context.score.metrics.map((s) => [s.id, s]));
  const use = context.metrics.flatMap((m) => (m.lens === 'consumption' ? [metricBullet(m, USE_LABEL[m.id] ?? m.id, { reading: scored.get(m.id)?.reading ?? 'missing' })] : []));
  return { body: `${firstHire(list, view)}${lawCharts(view)}${bullets('Consumption', use)}${roadTo100({ baseline: BASELINE, now, fixes: roadFixes(context) })}` };
}
