// SPDX-License-Identifier: Apache-2.0
// Turns an analysis into the page's records (contract/README.md, "metrics.json") and its drill-down rows. Numbers, dates
// and pull request numbers only: no title, body, branch or login is ever copied out.
import type { MetricRecord } from '../../contract/format.ts';
import {
  HOUR_MS,
  REPAIR_DAYS,
  WINDOW_DAYS,
  changeFailureRate,
  changeFrequency,
  isRework,
  leadTime,
  mergesTiedToIssue,
  recoveryTime,
  reworkRate,
  type Analysis,
  type Reading,
} from './delivery.ts';
import type { DrillResult } from './drill.ts';

export const PAGE = 'insights';
/** The ids this collector measures from the history, in the order the page shows them: the manifest's, but lane_minutes, core/lane's. */
export const METRIC_IDS = [
  'change_failure_rate',
  'rework_rate',
  'merges_tied_to_issue',
  'failure_drill',
  'change_frequency',
  'lead_time_p50',
  'recovery_time_p50',
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export interface RunContext {
  measuredAt: string;
  /** The head of main the history was read at: for the drill-down and the commit link. */
  commit: string;
  /** The Actions run that measured. Null when run by hand, and then nothing can be scored (contract: "run link"). */
  runUrl: string | null;
}

/** A UTC instant with whole seconds, as the format asks. */
export const utc = (t: number) => new Date(Math.floor(t / 1000) * 1000).toISOString().replace('.000Z', 'Z');

const commitUrl = (sha: string) => `https://github.com/Colorado-Startups/legallas/commit/${sha}`;

function missing(id: MetricId, ctx?: RunContext): MetricRecord {
  return {
    id,
    page: PAGE,
    value: null,
    status: 'missing',
    stage: 'live',
    measured_at: ctx?.measuredAt ?? null,
    source_url: ctx ? (ctx.runUrl ?? commitUrl(ctx.commit)) : null,
    sample_size: null,
  };
}

/** What a run read for one metric, before it becomes a record: the hand-run summary prints these. */
export interface MetricReading {
  id: MetricId;
  value: number | null;
  samples: number;
  /** Read as "no events": no failure to recover from. */
  noEvents: boolean;
  /** Withheld because the drill failed. */
  withheld: boolean;
}

/** Every metric missing: what a run writes when it could not read the history. */
export function allMissing(): MetricRecord[] {
  return METRIC_IDS.map((id) => missing(id));
}

/** The metrics that rest on finding failures and repairs: missing whenever the drill fails. */
const NEEDS_DRILL: readonly MetricId[] = ['change_failure_rate', 'rework_rate', 'recovery_time_p50'];

export function readAll(a: Analysis, drillResult: DrillResult): MetricReading[] {
  const readings: Record<MetricId, Reading> = {
    change_failure_rate: changeFailureRate(a),
    rework_rate: reworkRate(a),
    merges_tied_to_issue: mergesTiedToIssue(a),
    failure_drill: { value: drillResult.passed ? 1 : 0, samples: 1 },
    change_frequency: changeFrequency(a),
    lead_time_p50: leadTime(a),
    recovery_time_p50: recoveryTime(a),
  };
  return METRIC_IDS.map((id) => {
    const r = readings[id];
    const withheld = !drillResult.passed && NEEDS_DRILL.includes(id);
    // The collector ran and found no failure to recover from: "no events", which scores only while the drill passes.
    const noEvents = id === 'recovery_time_p50' && r.value === null;
    return { id, value: withheld ? null : r.value, samples: r.samples, noEvents: noEvents && !withheld, withheld };
  });
}

export function buildRecords(a: Analysis, drillResult: DrillResult, ctx: RunContext): MetricRecord[] {
  return readAll(a, drillResult).map((r) => {
    if (ctx.runUrl === null) return missing(r.id, ctx);
    const seen = { stage: 'live' as const, measured_at: ctx.measuredAt, source_url: ctx.runUrl };
    if (r.value !== null) return { id: r.id, page: PAGE, status: 'ok', value: r.value, ...seen, sample_size: r.samples };
    if (r.noEvents) return { id: r.id, page: PAGE, status: 'no_events', value: null, ...seen, sample_size: 0 };
    return missing(r.id, ctx);
  });
}

/** One merged change for the drill-down table and the trend charts. */
export interface ChangeRow {
  pr: number;
  merged_at: string;
  lead_hours: number;
  failed: 0 | 1;
  rework: 0 | 1;
  tied: 0 | 1;
  dependabot: 0 | 1;
}

export interface RecoveryRow {
  pr: number;
  /** The first change that repaired it, or null when main went green again without one, or while it is open. */
  repaired_by: number | null;
  merged_at: string;
  /** To recovery, or its age so far while open. */
  hours: number;
  open: 0 | 1;
}

export interface Detail {
  page: typeof PAGE;
  measured_at: string;
  commit: string;
  window_days: number;
  repair_days: number;
  changes: ChangeRow[];
  /** Merged into main but left out as this site's own work. */
  excluded: number[];
  recoveries: RecoveryRow[];
}

const bit = (b: boolean): 0 | 1 => (b ? 1 : 0);
const hours = (from: number, to: number) => Math.round(((to - from) / HOUR_MS) * 1000) / 1000;

export function buildDetail(a: Analysis, ctx: RunContext): Detail {
  const failed = new Set(a.failures.map((f) => f.number));
  return {
    page: PAGE,
    measured_at: ctx.measuredAt,
    commit: ctx.commit,
    window_days: WINDOW_DAYS,
    repair_days: REPAIR_DAYS,
    changes: a.changes.map((c) => ({
      pr: c.number,
      merged_at: utc(c.mergedAt),
      lead_hours: hours(c.startedAt, c.mergedAt),
      failed: bit(failed.has(c.number)),
      rework: bit(isRework(c)),
      tied: bit(c.tied),
      dependabot: bit(c.dependabot),
    })),
    excluded: a.excluded,
    recoveries: a.failures.map((f) => ({
      pr: f.number,
      repaired_by: a.changes.find((c) => c.repairs.includes(f.number) && c.mergedAt === f.recoveredAt)?.number ?? null,
      merged_at: utc(f.mergedAt),
      hours: hours(f.mergedAt, f.recoveredAt ?? a.now),
      open: bit(f.recoveredAt === null),
    })),
  };
}

/** What a run read, as page.ts's baseline reads it. */
export interface ReadingsFile {
  measured_at: string;
  commit: string;
  readings: { id: MetricId; value: number | null; samples: number; no_events: boolean }[];
}

export function readingsFile(detail: Detail, readings: MetricReading[]): ReadingsFile {
  return {
    measured_at: detail.measured_at,
    commit: detail.commit,
    readings: readings.map((r) => ({ id: r.id, value: r.value, samples: r.samples, no_events: r.noEvents })),
  };
}

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Problems with a detail or readings file: only the page id, metric ids, UTC times, a commit SHA, numbers and booleans. */
export function checkDetail(value: unknown): string[] {
  const errors: string[] = [];
  const walk = (v: unknown, at: string) => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || v < 0) errors.push(`${at}: not a number of zero or more`);
    } else if (typeof v === 'string') {
      const ok =
        v === PAGE ||
        TIME.test(v) ||
        (at === 'commit' && /^[0-9a-f]{40}$/.test(v)) ||
        (at.endsWith('.id') && (METRIC_IDS as readonly string[]).includes(v));
      if (!ok) errors.push(`${at}: a string that is not a time, the page, a metric or the commit`);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}[${i}]`));
    } else if (typeof v === 'object' && v !== null) {
      for (const [k, x] of Object.entries(v)) walk(x, at ? `${at}.${k}` : k);
    } else if (v !== null && typeof v !== 'boolean') {
      errors.push(`${at}: an unexpected kind of value`);
    }
  };
  walk(value, '');
  return errors;
}
