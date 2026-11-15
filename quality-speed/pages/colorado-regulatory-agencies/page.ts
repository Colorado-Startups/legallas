// SPDX-License-Identifier: Apache-2.0
// Colorado regulatory agencies: what founders, angels, groups and funds need from the Colorado Department of Regulatory
// Agencies. The infographic counts the needs held for each of its divisions on the list; then come a bullet per metric
// against its goal with the baseline marked, Road to 100, and the law kit's needs charts on a page of their own. The build
// runs it fenced, so it reads only the law.json the shared law collector writes beside this file (core/law/page.ts); before
// that has run there, the charts are red tiles. PLAN.md has the metrics.
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, markKey, metricBullet, missingTile, pictogram, roadTo100, totalOf, type PictogramProps } from '../../core/charts/index.ts';
import type { LawView } from '../../core/law/law.ts';
import { lawCharts, readView, roadFixes } from '../../core/law/page.ts';

/** The department's divisions on the list. Each need's id starts with one of these keys and a hyphen. */
export const DIVISIONS: Record<string, { label: string; glyph: PictogramProps['glyph'] }> = {
  securities: { label: 'Securities', glyph: 'doc' },
  'civil-rights': { label: 'Civil rights', glyph: 'person' },
};

const LABEL: Record<string, string> = {
  coverage: 'Coverage',
  flags: 'Deadlines',
  verified: 'Verified',
  fresh: 'Fresh',
  rights: 'Rights',
  change_lag: 'Catch-up',
  lane_minutes: 'Minutes',
  law_lookup_tokens_p95: 'Lookup tokens',
};

/** The law kit's run before any fix (PLAN.md, Baseline). Consumption reads missing outside CI, so it starts at 0. */
export const BASELINE = { q: 60.095, s: 100, total: totalOf(60.095, 100) };
const BASE: Record<string, number> = { coverage: 76.92, flags: 0, verified: 100, fresh: 100, rights: 50, change_lag: 0 };

/** The division a need belongs to, from its id. Throws for a need with none, so a new one can't go uncounted. */
export function division(id: string): string {
  const key = Object.keys(DIVISIONS).find((k) => id.startsWith(`${k}-`));
  if (!key) throw new Error(`${id}: a need with no division`);
  return key;
}

/** The infographic: needs held against needs listed, one pictogram per division. No view reads as a red tile. */
export function byDivision(view: LawView | null): string {
  if (!view) return missingTile({ label: 'Divisions' });
  const keys = view.rows.map((r) => division(r.id));
  const tiles = Object.entries(DIVISIONS).map(([key, { label, glyph }]) => {
    const rows = view.rows.filter((_, i) => keys[i] === key);
    return pictogram({ label, glyph, total: rows.length, filled: rows.filter((r) => r.covered).length });
  });
  return `<div class="qs-grid qs-grid-2">${tiles.join('')}</div>`;
}

export function render(context: PageContext): PageOutput {
  const { score, metrics } = context;
  const scored = new Map(score.metrics.map((s) => [s.id, s]));
  const lens = (want: 'quality' | 'speed' | 'consumption') =>
    metrics.flatMap((m) =>
      m.lens === want ? [metricBullet(m, LABEL[m.id] ?? m.id, { reading: scored.get(m.id)?.reading ?? 'missing', ...(m.id in BASE ? { baseline: BASE[m.id] } : {}) })] : [],
    );
  const now = { q: score.exact_quality, s: score.exact_speed, c: score.exact_consumption, total: score.total };
  const road = roadTo100({ baseline: BASELINE, now, fixes: roadFixes(context, LABEL) });
  const view = readView(new URL('./law.json', import.meta.url));
  // The kit's needs grid passes 50 KB here, so it opens on its own page and the first view stays under the 100 KB limit.
  const more = '<p><a class="qs-btn" href="needs.html">Needs</a></p>';
  return {
    body: `${byDivision(view)}${more}${markKey()}${bullets('Quality', lens('quality'))}${bullets('Speed', lens('speed'))}${bullets('Consumption', lens('consumption'))}${road}`,
    pages: { needs: `<nav><a href="index.html">Colorado regulatory agencies</a></nav><main>${lawCharts(view)}</main>` },
  };
}
