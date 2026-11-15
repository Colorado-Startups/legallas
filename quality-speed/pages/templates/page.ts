// SPDX-License-Identifier: Apache-2.0
// The templates page: a bullet per metric, coverage by path as rows of documents, and Road to 100. The build adds the
// title and the ring and runs this fenced, so the numbers come from render()'s validated readings, and the rows of
// documents from needed.json, the reviewed list beside this file.
import { readFileSync } from 'node:fs';
import { bullets, markKey, metricBullet, pictogram, roadTo100 } from '../../core/charts/index.ts';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { combine, lineScore, type ScoredRow } from '../../core/score.ts';

const LABELS: Record<string, string> = {
  coverage: 'Coverage',
  right_to_ship: 'Right to ship',
  fields_work: 'Fields',
  wording: 'Wording',
  fill_ms_p95: 'Render time',
  lane_minutes: 'Lane minutes',
  template_part_tokens_max: 'Largest read',
};
const GROUPS: Record<string, string> = {
  'startup-forms': 'Forming',
  'startup-raises': 'Raising',
  'running-the-company': 'Running',
  'angels-invest': 'Angels',
  'angels-create-groups': 'Groups',
  'vcs-invest': 'VCs',
};

/** PLAN.md's baseline, taken before any fix. */
export const BASELINE = { q: 55.92, s: 0, total: 37 };

interface Fix {
  id: string;
  label: string;
  href?: string;
  sets?: Record<string, number>;
  /** Needed documents this fix adds; the last one covers the rest. */
  covers?: number;
}

const ISSUES = 'https://github.com/Colorado-Startups/legallas/issues/';

/** Road to 100 in backlog order. */
export const FIXES: Fix[] = [
  { id: 'wording', label: 'Notices', sets: { wording: 100 } },
  { id: 'ship', label: 'Right to ship', sets: { right_to_ship: 100 } },
  { id: 'forms', label: 'Public forms', href: `${ISSUES}16`, covers: 9 },
  { id: 'founder', label: 'Founder drafts', href: `${ISSUES}16`, covers: 61 },
  { id: 'investor', label: 'Investor drafts', href: `${ISSUES}26`, covers: Infinity },
  { id: 'render', label: 'Render time', sets: { fill_ms_p95: 100 } },
  { id: 'tokens', label: 'Shorter reads', sets: { template_part_tokens_max: 10_000 } },
];

interface Needed {
  path: string;
  templates: string[];
  gap?: string;
}

const needed: Needed[] = JSON.parse(readFileSync(new URL('needed.json', import.meta.url), 'utf8')).needed;

/** Each fix's Quality, Speed and Consumption points, applied in order on top of today's scores. */
export function road(ctx: PageContext) {
  const rows: ScoredRow[] = ctx.metrics.map((m, i) => ({ ...m, score: ctx.score.metrics[i]?.score ?? 0 }));
  const coverage = ctx.metrics.find((m) => m.id === 'coverage');
  let covered = coverage?.status === 'ok' && coverage.value !== null ? Math.round((coverage.value * needed.length) / 100) : 0;
  let before = combine(rows);
  return FIXES.flatMap((fix) => {
    const sets = { ...fix.sets };
    if (fix.covers !== undefined) {
      covered = Math.min(needed.length, covered + fix.covers);
      sets.coverage = (100 * covered) / needed.length;
    }
    for (const row of rows) {
      const def = ctx.metrics.find((m) => m.id === row.id);
      const value = sets[row.id];
      if (def && value !== undefined) row.score = Math.max(row.score, lineScore(def, value));
    }
    const after = combine(rows);
    const out = {
      id: fix.id,
      label: fix.label,
      ...(fix.href ? { href: fix.href } : {}),
      q: after.exact_quality - before.exact_quality,
      s: after.exact_speed - before.exact_speed,
      c: after.exact_consumption - before.exact_consumption,
    };
    before = after;
    return out.q + out.s + out.c > 0 ? [out] : [];
  });
}

export function render(ctx: PageContext): PageOutput {
  const now = { q: ctx.score.exact_quality, s: ctx.score.exact_speed, c: ctx.score.exact_consumption, total: ctx.score.total };
  const measured = ctx.score.metrics[ctx.metrics.findIndex((m) => m.id === 'coverage')]?.reading === 'measured';
  const groups = Object.keys(GROUPS).map((id) => {
    const rows = needed.filter((n) => n.path === id);
    return pictogram({ label: GROUPS[id] ?? id, total: rows.length, filled: rows.filter((n) => n.templates.length > 0 && !n.gap).length });
  });
  const body = `${markKey()}
${bullets('Against goal', ctx.metrics.map((m, i) => metricBullet(m, LABELS[m.id] ?? m.id, { reading: ctx.score.metrics[i]?.reading ?? 'missing' })))}
${measured ? `<section><h2>Coverage by path</h2>${groups.join('')}</section>` : ''}
${roadTo100({ baseline: BASELINE, now, fixes: road(ctx) })}`;
  return { body };
}
