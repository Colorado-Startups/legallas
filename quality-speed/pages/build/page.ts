// SPDX-License-Identifier: Apache-2.0
// The Build page body, for core/build.ts: render(context) gets the scored metrics and the lane's detail, and returns the
// body under the build's title and ring. Every word is a fixed label here; the data adds only numbers, dates and short
// commit ids. The release's checks and parts come from the lane's detail.json, the recent builds from runs.json, which the
// build copies beside this file; without them the parts come from baseline/release.json, dated.
import { readFileSync } from 'node:fs';
import type { Metric, MetricRecord } from '../../contract/format.ts';
import { bullets, dotMatrix, fmtDate, markKey, metricBullet, metricTile, roadTo100, tileRow } from '../../core/charts/index.ts';
import type { RoadFixProps } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { combine, lineScore } from '../../core/score.ts';
import { CHECKS, PARTS, type CheckId, type PartId } from './release.ts';

const LABELS: Record<string, string> = {
  main_commits_building: 'Commits build',
  release_reproducible: 'Same twice',
  release_gaps: 'Release gaps',
  web_build_seconds_p50: 'Web build',
  mac_build_seconds_p50: 'Mac build',
  lane_minutes: 'Lane minutes',
  release_gzip_bytes: 'Release size',
};
const PART_LABELS: Record<PartId, string> = {
  site: 'Site', pdfjs: 'pdf.js', rive: 'Rive', liberation: 'Liberation', maps: 'Source maps', worker_mcp: 'MCP Worker', worker_web: 'Room Worker', other: 'Other',
};
const CHECK_LABELS: Record<CheckId, string> = {
  migrations_numbered: 'Migrations in order', migrations_unchanged: 'Migrations unchanged', third_party_notices: 'Third-party notices',
  no_gpl_fonts: 'No GPL fonts', cloudflare_limits: 'Cloudflare limits',
};
const STEP_LABELS: Record<string, string> = {
  'Web install': 'Install', 'Web build': 'Site', 'Worker dry runs': 'Workers',
  'Build (Debug)': 'Debug', 'Build (Release)': 'Release', 'App bundle': 'App', 'LegallasCore for iOS': 'iOS',
};
/** The issue behind a metric's fix, where one exists. */
const FIX_ISSUE: Record<string, number> = { release_gaps: 31 };
const REPO = 'https://github.com/Colorado-Startups/legallas';

interface Runs { main: { sha: string; steps: Record<string, 0 | 1> }[]; steps: string[]; web: number[]; mac: number[] }

const json = <T>(name: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8')) as T;
  } catch {
    return undefined;
  }
};
const baseline = json<MetricRecord[]>('baseline/metrics.json') ?? [];
const baselineRelease = json<{ measured_at?: string; parts?: Record<PartId, number> }>('baseline/release.json');

/**
 * One row per metric short of goal: what reaching it adds to each ring, ranked by what it adds to the total under core's own
 * weights. A metric that adds nothing to the total there has no row.
 */
export function roadFixes({ score, metrics }: Pick<PageContext, 'score' | 'metrics'>): RoadFixProps[] {
  const rows = metrics.map((m, i) => ({ id: m.id, lens: m.lens, weight: m.weight, score: score.metrics[i]?.score ?? 0 }));
  const now = combine(rows);
  return rows
    .filter((r) => r.score < 100)
    .map((r) => {
      const after = combine(rows.map((x) => (x.id === r.id ? { ...x, score: 100 } : x)));
      const issue = FIX_ISSUE[r.id];
      return {
        id: r.id,
        label: LABELS[r.id] ?? r.id,
        q: after.exact_quality - now.exact_quality,
        s: after.exact_speed - now.exact_speed,
        c: after.exact_consumption - now.exact_consumption,
        ...(issue ? { ref: `#${issue}`, href: `${REPO}/issues/${issue}` } : {}),
      };
    })
    .filter((f) => fixGain(f) > 0)
    .sort((a, b) => fixGain(b) - fixGain(a));
}

/** The release as one bar, part by part, with the goal marked; the parts a fix removes are outlined. */
function anatomy(parts: Partial<Record<PartId, number>>, goal: number, when: string): string {
  const total = Object.values(parts).reduce((a, b) => a + (b ?? 0), 0);
  const scale = Math.max(total, goal) * 1.02;
  let x = 0;
  const rects = PARTS.filter((id) => (parts[id] ?? 0) > 0).map((id) => {
    const bytes = parts[id] ?? 0;
    const w = (100 * bytes) / scale;
    const cut = id === 'rive' || id === 'liberation';
    const r = `<rect class="${cut ? 'qs-seg-s' : 'qs-fill-s'}" x="${x.toFixed(2)}%" y="8" width="${Math.max(0, w - 0.3).toFixed(2)}%" height="24" rx="2" data-tl="${PART_LABELS[id]}" data-tv="${(bytes / 1e6).toFixed(2)} MB"></rect>`;
    x += w;
    return r;
  });
  const g = ((100 * goal) / scale).toFixed(2);
  return `<figure class="qs-chart"><figcaption>Release${when}</figcaption><svg width="100%" height="40" role="img" aria-label="Release parts against the goal">${rects.join('')}<line class="qs-goal-line" x1="${g}%" x2="${g}%" y1="2" y2="38"></line></svg></figure>`;
}

export function render({ score, metrics, detail }: PageContext): PageOutput {
  const reading = (i: number) => score.metrics[i]?.reading ?? 'missing';
  const baseOf = (m: Metric) => baseline.find((r) => r.id === m.id)?.value;
  const runs = json<Runs>('runs.json');
  const tile = (id: string, spark?: number[]) => {
    const i = metrics.findIndex((m) => m.id === id);
    return i < 0 ? '' : metricTile(metrics[i] as Metric, LABELS[id] ?? id, { reading: reading(i), ...(spark && spark.length > 1 ? { spark } : {}) });
  };
  // Exact lenses, so the fixes add up to 100; the kit rounds what it shows. The consumption ring's score too: a variable, so it
  // type-checks before core's RoadScore takes `c`.
  const ring = { q: score.exact_quality, s: score.exact_speed, total: score.total, c: score.exact_consumption };
  const baseRing = combine(metrics.map((m) => ({ id: m.id, lens: m.lens, weight: m.weight, score: typeof baseOf(m) === 'number' ? lineScore(m, baseOf(m) as number) : 0 })));
  const size = metrics.find((m) => m.id === 'release_gzip_bytes');

  // The lane's parts, measured with the size metric; else the baseline's, with its date.
  const laneParts = Object.fromEntries(PARTS.flatMap((id) => (detail?.readings[`part_${id}`] ? [[id, detail.readings[`part_${id}`]!.value]] : [])));
  const parts = Object.keys(laneParts).length ? laneParts : baselineRelease?.parts;
  const when = Object.keys(laneParts).length ? (size?.measured_at ? `, ${fmtDate(size.measured_at)}` : '') : baselineRelease?.measured_at ? `, ${fmtDate(baselineRelease.measured_at)}` : '';
  const checks = detail && CHECKS.every((c) => c in detail.checks)
    ? dotMatrix({ caption: 'Release checks', rows: CHECKS.map((c) => CHECK_LABELS[c]), cols: ['Now'], states: CHECKS.map((c) => [detail.checks[c] === 1 ? 'pass' : 'fail']) })
    : '';
  // The newest five, so the matrix fits a phone's width even before #308's fix.
  const shown = runs?.main.slice(-5) ?? [];
  const builds = runs && shown.length
    ? dotMatrix({
        caption: 'Main builds',
        rows: runs.steps.map((s) => STEP_LABELS[s] ?? s),
        cols: shown.map((r) => r.sha),
        states: runs.steps.map((s) => shown.map((r) => (r.steps[s] === 1 ? 'pass' : r.steps[s] === 0 ? 'fail' : 'na'))),
      })
    : '';

  return {
    body: [
      markKey(),
      bullets(
        'Against goal',
        metrics.map((m, i) => {
          const b = baseOf(m);
          return metricBullet(m, LABELS[m.id] ?? m.id, { reading: reading(i), ...(typeof b === 'number' ? { baseline: b } : {}) });
        }),
      ),
      size && parts ? anatomy(parts, size.goal, when) : '',
      builds || checks ? `<div class="qs-grid qs-grid-2">${builds}${checks}</div>` : '',
      tileRow([tile('web_build_seconds_p50', runs?.web), tile('mac_build_seconds_p50', runs?.mac), tile('release_reproducible')]),
      roadTo100({ baseline: { q: baseRing.exact_quality, s: baseRing.exact_speed, total: baseRing.total }, now: ring, fixes: roadFixes({ score, metrics }) }),
    ].join(''),
  };
}
