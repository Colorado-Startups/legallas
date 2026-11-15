// SPDX-License-Identifier: Apache-2.0
// Federal tax law. Numbers come from render(), and the needs from the law.json the shared law collector writes beside
// this file (core/law/page.ts); before it has run there, the needs grid is a red tile. The grid of 41 needs is about 53 KB,
// so it opens on a page of its own and the first view stays under the 100 KB limit, as on the SEC page.
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
  lane_minutes: 'Lane',
  law_lookup_tokens_p95: 'Lookup tokens',
};

/** The law kit and lag.ts on main before any fix (PLAN.md, Baseline). Consumption reads only in CI, so 0; the total by core's own rule. */
const BASELINE = { q: 62.446, s: 100, total: totalOf(62.446, 100) };
const BASE: Record<string, number> = { coverage: 60.97, flags: 25, verified: 66.66, fresh: 100, rights: 100, change_lag: 0 };

export function render(context: PageContext): PageOutput {
  const { score, metrics } = context;
  const scored = new Map(score.metrics.map((s) => [s.id, s]));
  const lens = (want: 'quality' | 'speed' | 'consumption') =>
    metrics.flatMap((m) =>
      m.lens === want ? [metricBullet(m, LABEL[m.id] ?? m.id, { reading: scored.get(m.id)?.reading ?? 'missing', ...(m.id in BASE ? { baseline: BASE[m.id] } : {}) })] : [],
    );
  const now = { q: score.exact_quality, s: score.exact_speed, total: score.total, c: score.exact_consumption };
  const road = roadTo100({
    baseline: BASELINE,
    now,
    fixes: roadFixes(context, LABEL),
  });
  const view = readView(new URL('./law.json', import.meta.url));
  const more = '<p><a class="qs-btn" href="needs.html">Needs</a></p>';
  return {
    body: `${markKey()}${bullets('Quality', lens('quality'))}${bullets('Speed', lens('speed'))}${bullets('Consumption', lens('consumption'))}${more}${road}`,
    pages: { needs: `<nav><a href="index.html">Federal tax law</a></nav><main>${lawCharts(view)}</main>` },
  };
}
