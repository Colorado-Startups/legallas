// SPDX-License-Identifier: Apache-2.0
// The page's scores, from the core's rule (quality-speed/core/score.ts), in the shape page.ts draws from.
import type { Manifest, Metric, MetricRecord } from '../../contract/format.ts';
import { combine, scoreMetrics, scorePage, type Combined, type MetricScore, type PageScore as CorePageScore, type Reading } from '../../core/score.ts';

export type { Reading };

export interface PageScore {
  /** Whole numbers, as shown. */
  quality: number;
  speed: number;
  total: number;
  exactQuality: number;
  exactSpeed: number;
  exactConsumption: number;
  /** Each metric's score and the reason for it, by id. */
  scores: Map<string, number>;
  readings: Map<string, Reading>;
}

function shape(c: Combined, metrics: MetricScore[]): PageScore {
  return {
    quality: c.quality,
    speed: c.speed,
    total: c.total,
    exactQuality: c.exact_quality,
    exactSpeed: c.exact_speed,
    exactConsumption: c.exact_consumption,
    scores: new Map(metrics.map((m) => [m.id, m.score])),
    readings: new Map(metrics.map((m) => [m.id, m.reading])),
  };
}

/** The core's page score, as the build passes it to render(), in this page's shape. */
export function fromCore(p: CorePageScore): PageScore {
  return shape(p, p.metrics);
}

/** A run's records, scored by the core's own `scorePage`, as the site scores them. */
export function pageScore(m: Manifest, records: MetricRecord[], now: number): PageScore {
  const p = scorePage('insights', m, records, new Date(now));
  return shape(p, p.metrics);
}

/**
 * The baseline, measured by hand before the workflow ran this collector, so its records carry a commit link where a run
 * link would be and would fail the contract's validator. Scored by the same rule, at the time it was measured, from the
 * definitions and records directly; it draws the baseline marks only.
 */
export function baselineScore(m: Manifest, records: MetricRecord[], at: number): PageScore {
  const byId = new Map(records.map((r) => [r.id, r]));
  const metrics: Metric[] = m.metrics.map((d) => {
    const r = byId.get(d.id);
    return {
      ...d,
      page: 'insights',
      value: r?.value ?? null,
      status: r?.status ?? 'missing',
      stage: r?.stage ?? 'live',
      measured_at: r?.measured_at ?? null,
      source_url: r?.source_url ?? null,
      sample_size: r?.sample_size ?? null,
    };
  });
  const scored = scoreMetrics(metrics, new Date(at));
  const rows = m.metrics.map((d, i) => ({ id: d.id, lens: d.lens, weight: d.weight, group: d.group, score: scored[i]?.score ?? 0 }));
  return shape(combine(rows, m.groups), scored);
}
