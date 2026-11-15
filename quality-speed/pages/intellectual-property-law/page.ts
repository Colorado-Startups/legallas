// SPDX-License-Identifier: Apache-2.0
// The Intellectual property law page: the IP map (the infographic: each right against each step a founder or investor
// takes, held only when every need there is held with its deadlines stated), the law kit's needs charts, a bullet per
// metric with its baseline, and Road to 100. The build runs it fenced, so it reads only this folder: needs.json, the
// reviewed list, and the law.json the law kit's collector writes. PLAN.md has the metrics.
import { readFileSync } from 'node:fs';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, dotMatrix, metricBullet, missingTile, roadTo100, totalOf, type PassState } from '../../core/charts/index.ts';
import type { LawView, NeedsList } from '../../core/law/law.ts';
import { lawCharts, readView, roadFixes } from '../../core/law/page.ts';

export const RIGHTS = ['Patent', 'Trademark', 'Copyright', 'Trade secret', 'Trade name'];
export const STEPS = ['Own', 'Protect', 'Deadlines', 'Check', 'Fight'];

const OWN: [string, string][] = [['Patent', 'Own'], ['Copyright', 'Own']];
const CHECK: [string, string][] = [['Patent', 'Check'], ['Copyright', 'Check']];
const RECORDS: [string, string][] = [['Patent', 'Check'], ['Trademark', 'Check']];

/** Where each need sits on the map: one or more [right, step] cells. */
export const MAP: Record<string, [string, string][]> = {
  'founder-prior-work': OWN,
  'founder-new-work': OWN,
  'employee-assignment': OWN,
  'contractor-copyright': [['Copyright', 'Own']],
  'trade-secret-notice': [['Trade secret', 'Own']],
  'trademark-clearance': [['Trademark', 'Protect']],
  'trademark-basis': [['Trademark', 'Protect']],
  'colorado-trade-name': [['Trade name', 'Protect']],
  'trade-secret-elements': [['Trade secret', 'Protect']],
  'colorado-trade-secrets': [['Trade secret', 'Protect']],
  'provisional-application': [['Patent', 'Protect'], ['Patent', 'Deadlines']],
  'trademark-statement-of-use': [['Trademark', 'Deadlines']],
  'trademark-office-action': [['Trademark', 'Deadlines']],
  'trademark-maintenance': [['Trademark', 'Deadlines']],
  'patent-grace-period': [['Patent', 'Deadlines']],
  'patent-assignment-recording': [['Patent', 'Deadlines']],
  'patent-maintenance': [['Patent', 'Deadlines']],
  'angels-ip-assignments': CHECK,
  'groups-ip-screening': CHECK,
  'angels-uspto-records': RECORDS,
  'vc-chain-of-title': RECORDS,
  'fights-trade-secrets': [['Trade secret', 'Fight']],
  'fights-joint-owners': [['Patent', 'Fight']],
};

/** The baseline: the law kit and lag.ts on main at dcb1a8e, 2026-11-05 (PLAN.md, Baseline), with no lane minutes outside CI. */
export const BASELINE = { q: 66.01375, s: 100, total: totalOf(66.01375, 100) };
const BASE: Record<string, number> = { coverage: 78.26, verified: 100, fresh: 93.33, rights: 100, flags: 0, change_lag: 0 };

const LABEL: Record<string, string> = { change_lag: 'Catch-up', lane_minutes: 'Lane minutes', law_lookup_tokens_p95: 'Lookup tokens' };
const label = (id: string) => LABEL[id] ?? `${id[0]!.toUpperCase()}${id.slice(1)}`;

/**
 * A cell passes when every need in it is held and each of its deadlines is stated in the product's own words, fails when
 * any isn't, and is hatched when no need belongs there. Before the collector has run it is a red tile, never a guess.
 */
export function ipMap(list: NeedsList, view: LawView | null): string {
  if (!view) return missingTile({ label: 'IP map' });
  const cells = new Map<string, boolean[]>();
  for (const need of list.needs) {
    const places = MAP[need.id];
    if (!places) throw new Error(`${need.id}: a need with no place on the IP map`);
    const row = view.rows.find((r) => r.id === need.id);
    const held = row?.covered === true && row.checks.flags !== false;
    for (const [right, step] of places) cells.set(`${right}|${step}`, [...(cells.get(`${right}|${step}`) ?? []), held]);
  }
  const state = (held: boolean[] | undefined): PassState => (!held ? 'na' : held.every(Boolean) ? 'pass' : 'fail');
  return dotMatrix({ caption: 'IP map', rows: RIGHTS, cols: STEPS, states: RIGHTS.map((r) => STEPS.map((s) => state(cells.get(`${r}|${s}`)))) });
}

export function render(context: PageContext): PageOutput {
  const { score, metrics } = context;
  const list = JSON.parse(readFileSync(new URL('./needs.json', import.meta.url), 'utf8')) as NeedsList;
  const view = readView(new URL('./law.json', import.meta.url));
  const scored = new Map(score.metrics.map((s) => [s.id, s]));
  const rows = metrics.map((m) => metricBullet(m, label(m.id), { reading: scored.get(m.id)?.reading ?? 'missing', ...(m.id in BASE ? { baseline: BASE[m.id] } : {}) }));
  // The exact lens scores, so the fixes, which close each metric's exact gap, end at 100 with no rounding remainder.
  const now = { q: score.exact_quality, s: score.exact_speed, total: score.total, c: score.exact_consumption };
  return { body: `${ipMap(list, view)}${lawCharts(view)}${bullets('Metrics', rows)}${roadTo100({ baseline: BASELINE, now, fixes: roadFixes(context) })}` };
}
