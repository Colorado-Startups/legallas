// SPDX-License-Identifier: Apache-2.0
// Delaware tax law. Numbers come from render(), and the needs from the law.json the shared law collector writes beside
// this file (core/law/page.ts); before it has run there, the needs grid is a red tile.
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

/** The kit and lag.ts on main before any fix (PLAN.md, Baseline). lane_minutes needs a CI run, so it reads 0 here. */
const BASELINE = { q: 75, s: 100, c: 0, total: totalOf(75, 100, 0) };
const BASE: Record<string, number> = { coverage: 100, flags: 0, verified: 100, fresh: 100, rights: 100, change_lag: 0 };

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
  return { body: `${markKey()}${lawCharts(view)}${bullets('Quality', lens('quality'))}${bullets('Speed', lens('speed'))}${bullets('Consumption', lens('consumption'))}${road}` };
}
