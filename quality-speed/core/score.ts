// SPDX-License-Identifier: Apache-2.0
// The scoring rule. A metric scores on a straight line from floor (0) to goal (100); Quality, Speed and Consumption are
// weighted averages, and a lens with no metric scores 0; the total is (Q + S + C) / 3, a third each, as in Git Crafter's
// master() (quality/render/model.mjs), rounded to 6 decimals and then rounded down, because the plain form can come to
// 99.99999999999999 in floating point. Anything unproven scores 0 and stays on the page, so a broken check can't lift
// a score. No value is ever coerced to a number: null must never read as a zero. Nothing caps or locks a total.
import type { Group, Lens, Manifest, Metric, MetricDef, MetricRecord } from '../contract/format.ts';
import { HOME_WEIGHTS, PAGES, type PageSlug } from '../contract/pages.ts';
import { isTime, joinMetrics } from '../contract/validate.ts';

const HOUR_MS = 3_600_000;

/** Why a metric has its score. Everything except measured and no_events scores 0. */
export type Reading = 'measured' | 'no_events' | 'missing' | 'stale' | 'too_few_samples' | 'no_proof';

export interface MetricScore {
  id: string;
  score: number;
  reading: Reading;
}

/** What combining needs from a metric, so a chart can try a score out with this same rule. */
export interface ScoredRow {
  id: string;
  lens: Lens;
  weight: number;
  group?: string | undefined;
  score: number;
}

export interface Combined {
  /** Whole numbers as shown. */
  quality: number;
  speed: number;
  consumption: number;
  total: number;
  exact_quality: number;
  exact_speed: number;
  exact_consumption: number;
}

export interface GroupScore extends Combined {
  id: string;
  weight: number;
}

export interface PageScore extends Combined {
  page: PageSlug;
  /** False until the page has a signed-off list. Such a page reads 0. */
  has_list: boolean;
  metrics: MetricScore[];
  groups: GroupScore[];
}

/** Where a value sits between floor and goal. At or past the goal is exactly 100. */
export function lineScore(def: Pick<MetricDef, 'floor' | 'goal' | 'direction'>, value: number): number {
  const { floor, goal, direction } = def;
  if (direction === 'higher' ? value >= goal : value <= goal) return 100;
  if (direction === 'higher' ? value <= floor : value >= floor) return 0;
  return ((value - floor) / (goal - floor)) * 100;
}

/** What a validated record proves at this moment, whatever its status claims. A coverage check comes after this. */
function readingOf(m: Metric, now: number): Reading {
  if (m.status === 'stale') return 'stale';
  if ((m.status !== 'ok' && m.status !== 'no_events') || !isTime(m.measured_at)) return 'missing';
  if (now - Date.parse(m.measured_at) > m.max_age_hours * HOUR_MS) return 'stale';
  if (m.status === 'no_events') return m.coverage_metric === undefined ? 'no_proof' : 'no_events';
  if (!Number.isFinite(m.value)) return 'missing';
  return !Number.isInteger(m.sample_size) || (m.sample_size as number) < m.min_samples ? 'too_few_samples' : 'measured';
}

/** Scores every metric. no_events reads 100 only while its coverage metric is measured and at goal. */
export function scoreMetrics(metrics: readonly Metric[], now: Date): MetricScore[] {
  const time = now.getTime();
  const plain = new Map(
    metrics.map((m) => {
      const reading = readingOf(m, time);
      const score = reading === 'measured' ? lineScore(m, m.value as number) : 0;
      return [m.id, { id: m.id, score, reading }] satisfies [string, MetricScore];
    }),
  );
  return metrics.map((m) => {
    const own = plain.get(m.id) as MetricScore;
    if (own.reading !== 'no_events') return own;
    const proof = m.coverage_metric === undefined ? undefined : plain.get(m.coverage_metric);
    return proof?.reading === 'measured' && proof.score === 100 ? { ...own, score: 100 } : { ...own, reading: 'no_proof' };
  });
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** A score as shown: rounded down, and never 100 unless everything behind it is at goal. */
function wholeScore(exact: number, allAtGoal: boolean): number {
  const whole = Math.floor(round6(exact));
  return whole >= 100 && !allAtGoal ? 99 : whole;
}

function weightedAverage(rows: readonly ScoredRow[]): number {
  const weight = rows.reduce((sum, r) => sum + r.weight, 0);
  return weight > 0 ? rows.reduce((sum, r) => sum + r.weight * r.score, 0) / weight : 0;
}

function lensAverage(rows: readonly ScoredRow[], lens: Lens, groups: readonly Group[] | undefined): number {
  const inLens = rows.filter((r) => r.lens === lens);
  if (!groups) return weightedAverage(inLens);
  const parts = groups.reduce((sum, g) => sum + g.weight * weightedAverage(inLens.filter((r) => r.group === g.id)), 0);
  return parts / groups.reduce((sum, g) => sum + g.weight, 0);
}

/** The rule across a set of scores. A page with groups combines them by group weight, each with its own lenses. */
export function combine(rows: readonly ScoredRow[], groups?: readonly Group[]): Combined {
  const exact_quality = lensAverage(rows, 'quality', groups);
  const exact_speed = lensAverage(rows, 'speed', groups);
  const exact_consumption = lensAverage(rows, 'consumption', groups);
  const atGoal = (list: readonly ScoredRow[]) => list.every((r) => r.score === 100);
  const lensAtGoal = (lens: Lens) => atGoal(rows.filter((r) => r.lens === lens));
  const quality = wholeScore(exact_quality, lensAtGoal('quality'));
  const speed = wholeScore(exact_speed, lensAtGoal('speed'));
  const consumption = wholeScore(exact_consumption, lensAtGoal('consumption'));
  const total = wholeScore((exact_quality + exact_speed + exact_consumption) / 3, atGoal(rows));
  return { quality, speed, consumption, total, exact_quality, exact_speed, exact_consumption };
}

const EMPTY: Combined = { quality: 0, speed: 0, consumption: 0, total: 0, exact_quality: 0, exact_speed: 0, exact_consumption: 0 };

/**
 * Scores a page from its reviewed list and validated records. A page with no signed-off list reads 0, and a metric with
 * no record reads as missing: nothing is skipped.
 */
export function scorePage(page: PageSlug, manifest: Manifest | null, records: readonly MetricRecord[], now: Date): PageScore {
  if (manifest?.signoff_comment === undefined) return { ...EMPTY, page, has_list: false, metrics: [], groups: [] };
  const metrics = scoreMetrics(joinMetrics(manifest, records), now);
  const rows: ScoredRow[] = manifest.metrics.map((def, i) => ({
    id: def.id,
    lens: def.lens,
    weight: def.weight,
    group: def.group,
    score: (metrics[i] as MetricScore).score,
  }));
  const groups = (manifest.groups ?? []).map((g) => ({ ...combine(rows.filter((r) => r.group === g.id)), id: g.id, weight: g.weight }));
  return { ...combine(rows, manifest.groups), page, has_list: true, metrics, groups };
}

/** The home score: the average of every page as shown, with the weights in pages.ts. A page with no score counts as 0. */
export function scoreHome(totals: Partial<Record<PageSlug, number>>): number {
  let sum = 0;
  let weight = 0;
  let allAtGoal = true;
  for (const page of PAGES) {
    const w = HOME_WEIGHTS[page] ?? 1;
    const total = totals[page];
    const score = Number.isFinite(total) ? (total as number) : 0;
    if (score !== 100) allAtGoal = false;
    sum += w * score;
    weight += w;
  }
  return wholeScore(sum / weight, allAtGoal);
}
