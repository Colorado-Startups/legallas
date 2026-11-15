// SPDX-License-Identifier: Apache-2.0
// Charts straight from a contract metric. The types are structural, so `Metric` from contract/format.ts fits as is.
// The reading from scoring is required: a record can say `ok` and still score 0, for instance a year-old one.

import type { BulletProps } from './bullet.ts';
import { safeHref } from './svg.ts';
import type { Lens, Stage, Status } from './svg.ts';
import { statTile } from './tiles.ts';
import type { StatTileProps } from './tiles.ts';

export interface MetricLike {
  lens: Lens;
  unit: string;
  floor: number;
  goal: number;
  value: number | null;
  stage: string;
  measured_at: string | null;
  source_url?: string | null;
}

/** Why a metric has its score, as `Reading` in core/score.ts has it. */
export type ReadingLike = 'measured' | 'no_events' | 'missing' | 'stale' | 'too_few_samples' | 'no_proof';

const READING_STATUS: Record<ReadingLike, Status> = {
  measured: 'ok',
  no_events: 'no_events',
  missing: 'missing',
  stale: 'stale',
  too_few_samples: 'few_samples',
  no_proof: 'no_proof',
};

function shared(metric: MetricLike, label: string, reading: ReadingLike) {
  return {
    label,
    value: metric.value,
    unit: metric.unit,
    lens: metric.lens,
    status: READING_STATUS[reading] ?? 'missing',
    time: metric.measured_at ?? undefined,
    stage: metric.stage as Stage,
    href: safeHref(metric.source_url ?? undefined) ?? undefined,
  };
}

/** Bullet props for a metric: floor, goal, value, when and how, and a link to the run that measured it. */
export function metricBullet(metric: MetricLike, label: string, options: { reading: ReadingLike; baseline?: number }): BulletProps {
  const props: BulletProps = { ...shared(metric, label, options?.reading), floor: metric.floor, goal: metric.goal };
  if (options?.baseline !== undefined) props.baseline = options.baseline;
  return props;
}

/** A stat tile for a metric. A reading that scores 0 becomes an empty red tile. */
export function metricTile(metric: MetricLike, label: string, options: { reading: ReadingLike; spark?: number[]; delta?: number }): string {
  const props: StatTileProps = { ...shared(metric, label, options?.reading), better: metric.goal < metric.floor ? 'down' : 'up' };
  if (options?.spark) props.spark = options.spark;
  if (options?.delta !== undefined) props.delta = options.delta;
  return statTile(props);
}
