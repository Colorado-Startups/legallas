// SPDX-License-Identifier: Apache-2.0
// The metric format (contract/README.md): the closed lists and the shapes. A page has two files: manifest.json, the
// reviewed list of what is measured and what good looks like, and metrics.json, what a collector measured.
import type { PageSlug } from './pages.ts';

/** Every page scores Quality, Speed and Consumption, a third each. Consumption is a resource used: tokens, minutes, dollars, CPU, bytes. */
export const LENSES = ['quality', 'speed', 'consumption'] as const;
/** The lenses a signed-off list must cover: all three. */
export const REQUIRED_LENSES = LENSES;
export const DIRECTIONS = ['higher', 'lower'] as const;
export const STATUSES = ['ok', 'stale', 'missing', 'no_events'] as const;
/** lab: a local copy or CI. live: the real thing. */
export const STAGES = ['lab', 'live'] as const;
export const UNITS = [
  'percent',
  'count',
  'pass',
  'ratio',
  'score',
  'ms',
  'seconds',
  'minutes',
  'hours',
  'days',
  'bytes',
  'usd',
  'per_week',
  'tokens',
] as const;
/** What a change-log entry may record: a metric's field, its retirement, or a group's weight. */
export const CHANGE_FIELDS = [
  'retired',
  'added',
  'goal',
  'floor',
  'weight',
  'min_samples',
  'max_age_hours',
  // Legacy: seven change logs record the gate's removal (#645). A new entry never names it.
  'critical',
  'direction',
  'unit',
  'lens',
  'coverage_metric',
  'group',
  'group_weight',
] as const;
export const CHANGE_REASONS = ['not_measurable', 'source_gone', 'superseded', 'wrong_basis', 'not_tied_to_ideal', 'weight_raised_on_failing_metric', 'added_toward_ideal'] as const;

export type Lens = (typeof LENSES)[number];
export type Direction = (typeof DIRECTIONS)[number];
export type Status = (typeof STATUSES)[number];
export type Stage = (typeof STAGES)[number];
export type Unit = (typeof UNITS)[number];
export type ChangeField = (typeof CHANGE_FIELDS)[number];
export type ChangeReason = (typeof CHANGE_REASONS)[number];

/** One line of a page's reviewed list. */
export interface MetricDef {
  id: string;
  lens: Lens;
  unit: Unit;
  direction: Direction;
  /** Scores 0 at or past this. */
  floor: number;
  /** Scores 100 at or past this. */
  goal: number;
  weight: number;
  max_age_hours: number;
  min_samples: number;
  /** The metric proving detection works, which lets this one read no_events. Omitted: it never may. */
  coverage_metric?: string;
  /** Required when the manifest has groups. */
  group?: string;
  /** Where the goal comes from: a public https page, as in Git Crafter's targets. Required once the list is signed off. */
  goal_source?: string;
}

export interface Group {
  id: string;
  /** Whole numbers adding up to 100 across the page. */
  weight: number;
}

/** The only way past the goal check: `from` and `to` must match the change exactly. */
export interface Change {
  date: string;
  /** A metric id, or a group id for group_weight. */
  metric: string;
  field: ChangeField;
  from: number | boolean | string | null;
  to: number | boolean | string | null;
  reason: ChangeReason;
  /** The issue or pull request behind the change. */
  issue: number;
  /** Optional: a pull request comment id about the change. */
  signoff_comment?: number;
}

export interface Manifest {
  page: PageSlug;
  /** A pull request comment id that starts the list. Only then does the list score, need every lens, a goal source on each metric and an ideal.json, and only tighten. */
  signoff_comment?: number;
  groups?: Group[];
  metrics: MetricDef[];
  changes: Change[];
}

/** A document an ideal state rests on, as in Git Crafter's `ideals/<tab>.json`. */
export interface IdealSource {
  title: string;
  /** A public https page. */
  url: string;
  /** YYYY-MM-DD: the document's published or updated date, or the day it was read when it shows none. */
  date: string;
}

/**
 * A page's `ideal.json`, in Git Crafter's shape (`quality/ideals/<tab>.json`) so a template file drops in: the end state the
 * page's metrics move toward, the documents it rests on, and what ideal looks like in each category.
 */
export interface Ideal {
  ideal: string;
  sources: IdealSource[];
  quality?: string;
  speed?: string;
  consumption?: string;
}

/** One measurement, as a collector writes it. */
export interface MetricRecord {
  id: string;
  page: PageSlug;
  value: number | null;
  status: Status;
  stage: Stage;
  measured_at: string | null;
  source_url: string | null;
  sample_size: number | null;
}

/** The whole metric as the site and its charts see it: the reviewed definition plus the measurement. */
export interface Metric extends MetricDef, Omit<MetricRecord, 'id'> {}

/** One line of the score history. The home page's line is worked out from these, never stored. */
export interface HistoryLine {
  at: string;
  page: PageSlug;
  quality: number;
  speed: number;
  /** Optional, so a line written before the consumption lens still validates. */
  consumption?: number;
  total: number;
}
