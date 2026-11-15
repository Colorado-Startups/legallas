// SPDX-License-Identifier: Apache-2.0
// The law page template. The build runs page code fenced inside quality-speed/, so this reads only the law.json the
// collector wrote beside the page, never the law files, and imports nothing from law.ts but its type. It draws what is
// particular to a law page with the chart kit; Road to 100 comes from the build's own scores.
import { readFileSync } from 'node:fs';
import type { PageContext } from '../build.ts';
import { dotMatrix, missingTile, pictogram, type PassState, type RoadFixProps } from '../charts/index.ts';
import type { LawView } from './law.ts';

const PATH_LABEL: Record<string, string> = {
  'startup-forms': 'Forming',
  'startup-raises': 'Raising',
  'angels-invest': 'Angels',
  'angels-create-groups': 'Groups',
  'vcs-invest': 'VCs',
  fights: 'Fights',
};
/** Short names for the kit's metrics, shared by bullets and Road to 100: a raw id like law_lookup_tokens_p95 costs four words. */
export const LAW_LABEL: Readonly<Record<string, string>> = {
  coverage: 'Coverage',
  flags: 'Deadlines',
  verified: 'Verified',
  fresh: 'Fresh',
  rights: 'Rights',
  change_lag: 'Catch-up',
  lane_minutes: 'Lane minutes',
  law_lookup_tokens_p95: 'Lookup tokens',
  search_p95: 'Search time',
};
const state = (ok: boolean | null): PassState => (ok === null ? 'na' : ok ? 'pass' : 'fail');

/**
 * The page's law.json, or null when there's none yet or it isn't the shape this kit writes: a stale copy from an older kit or
 * a cut-off file then reads as a red tile, instead of failing the build every page shares.
 */
export function readView(file: URL): LawView | null {
  try {
    const view = JSON.parse(readFileSync(file, 'utf8')) as Partial<LawView>;
    const rowOk = (r: LawView['rows'][number]) => typeof r?.need === 'string' && typeof r.checks === 'object' && r.checks !== null;
    return Array.isArray(view.byPath) && Array.isArray(view.rows) && view.rows.every(rowOk) ? (view as LawView) : null;
  } catch {
    return null;
  }
}

/** Needs held on each customer path, then every need against every check. No view reads as a red tile, never a guess. */
export function lawCharts(view: LawView | null): string {
  if (!view) return missingTile({ label: 'Needs' });
  const paths = view.byPath.map((p) => pictogram({ label: PATH_LABEL[p.path] ?? p.path, total: p.listed, filled: p.held })).join('');
  const grid = dotMatrix({
    caption: 'Needs',
    rows: view.rows.map((r) => r.need),
    cols: ['Held', 'Verified', 'Fresh', 'Rights', 'Flags'],
    states: view.rows.map((r) => [r.covered, r.checks.verified, r.checks.fresh, r.checks.rights, r.checks.flags].map(state)),
  });
  return `<div class="qs-grid qs-grid-3">${paths}</div>${grid}`;
}

/**
 * One fix per metric short of its goal, worth its share of its lens, from the build's scores.
 * Each row takes the page's own label, else the kit's, so a row reads like the bullet above it.
 */
export function roadFixes({ metrics, score }: Pick<PageContext, 'metrics' | 'score'>, labels: Readonly<Record<string, string>> = {}): RoadFixProps[] {
  const weight = (lens: string) => metrics.filter((m) => m.lens === lens).reduce((sum, m) => sum + m.weight, 0);
  return metrics.flatMap((m) => {
    const gap = 100 - (score.metrics.find((s) => s.id === m.id)?.score ?? 0);
    if (gap <= 0) return [];
    const points = (gap * m.weight) / weight(m.lens);
    // A fix that adds nothing draws no "+0" step.
    if (!(points > 0)) return [];
    return [{ id: m.id, label: labels[m.id] ?? LAW_LABEL[m.id] ?? m.id.replaceAll('_', ' '), q: m.lens === 'quality' ? points : 0, s: m.lens === 'speed' ? points : 0, c: m.lens === 'consumption' ? points : 0 }];
  });
}
