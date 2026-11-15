// SPDX-License-Identifier: Apache-2.0
// Delaware business law. Numbers come from render(), and the needs from the law.json the shared law collector writes
// beside this file (core/law/page.ts); before it has run there, the needs grid is a red tile. The grid of 40 needs opens
// on a page of its own, so the first view stays under the 100 KB limit.
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, markKey, metricBullet, roadTo100, totalOf } from '../../core/charts/index.ts';
import { lawCharts, readView, roadFixes } from '../../core/law/page.ts';

const LABEL: Record<string, string> = {
  coverage: 'Coverage',
  flags: 'Deadlines',
  verified: 'Verified',
  fresh: 'Fresh',
  rights: 'Rights',
  change_lag: 'Catch-up',
  lane_minutes: 'Lane minutes',
  law_lookup_tokens_p95: 'Lookup tokens',
};

/** The law kit's run on main before any fix (PLAN.md, Baseline). lane_minutes reads only in CI, so consumption starts at 0. */
const BASELINE = { q: 81.25, s: 100, c: 0, total: totalOf(81.25, 100, 0) };
const BASE: Record<string, number> = { coverage: 87.5, flags: 50, verified: 100, fresh: 100, rights: 87.5, change_lag: 0 };

export function render(context: PageContext): PageOutput {
  const { score, metrics } = context;
  const scored = new Map(score.metrics.map((s) => [s.id, s]));
  const lens = (want: 'quality' | 'speed' | 'consumption') =>
    metrics.flatMap((m) =>
      m.lens === want ? [metricBullet(m, LABEL[m.id] ?? m.id, { reading: scored.get(m.id)?.reading ?? 'missing', ...(m.id in BASE ? { baseline: BASE[m.id] } : {}) })] : [],
    );
  const now = { q: score.exact_quality, s: score.exact_speed, c: score.exact_consumption, total: score.total };
  const road = roadTo100({
    baseline: BASELINE,
    now,
    fixes: roadFixes(context, LABEL),
  });
  const view = readView(new URL('./law.json', import.meta.url));
  const more = '<p><a class="qs-btn" href="needs.html">Needs</a></p>';
  return {
    body: `${markKey()}${bullets('Quality', lens('quality'))}${bullets('Speed', lens('speed'))}${bullets('Consumption', lens('consumption'))}${more}${road}`,
    pages: { needs: `<nav><a href="index.html">Delaware business law</a></nav><main>${lawCharts(view)}</main>` },
  };
}
