// SPDX-License-Identifier: Apache-2.0
// Reliability's numbers, from bug issues, failed runs on main and the review ledger. Pure, so the drill can run the same
// code on invented events. An issue's body is read for three lines (Severity, Landed, a run link) and never kept.
import type { MetricRecord } from '../../contract/format.ts';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** How far back bugs, fixes, reopened bugs and failed runs on main count. */
export const WINDOW_DAYS = 90;
/** How a bug with no landing commit to read counts for time to find: the metric's floor, so leaving it off never helps. */
const UNKNOWN_FIND_DAYS = 90;

/** The areas reviews must keep covering, and how old a review may be. Here, so the goal check's reviewers see any change. */
export const RISKY_AREAS = ['who-can-see-what', 'citations', 'sync-and-save-back', 'migrations', 'pii-guard', 'spend-guard', 'connector-contract'] as const;
export const AREA_AGE_LIMIT_DAYS = 14;

/** The invented issue every collection reads, to prove each field still parses: #28 in this repository, closed by the pull request that set it. */
export const CANARY_ISSUE = 28;
const CANARY_RUN = 1;

export interface Bug {
  number: number;
  state: 'OPEN' | 'CLOSED';
  /** COMPLETED, NOT_PLANNED, REOPENED or DUPLICATE. */
  stateReason: string | null;
  /** The issue it was marked a duplicate of, or null. */
  duplicateOf: number | null;
  createdAt: string;
  closedAt: string | null;
  body: string;
  reopenedAt: string[];
  /** When the `bug` label came off an issue that no longer has it, or null. */
  unlabeledAt: string | null;
  /** The paths of each merged pull request that closed it. */
  closedBy: string[][];
  /** The date of the commit named by its Landed line, or null. */
  landedAt: string | null;
}

export interface FailedRun {
  id: number;
  createdAt: string;
  /** Runner minutes: each job of every attempt rounded up to a whole minute, as GitHub bills it. Null when its jobs couldn't be read. */
  minutes: number | null;
}

/** A run's billed minutes from its jobs: each job that ran counts its time rounded up to a whole minute. */
export function billedMinutes(jobs: readonly { started_at: string | null; completed_at: string | null }[]): number {
  return jobs.reduce((sum, job) => {
    if (!job.started_at || !job.completed_at) return sum;
    return sum + Math.ceil(Math.max(0, Date.parse(job.completed_at) - Date.parse(job.started_at)) / 60_000);
  }, 0);
}

export interface Review {
  date: string;
  areas: string[];
  bugs: number[];
}

export const METRIC_IDS = [
  'open_bugs_critical_high',
  'bugs_found_first',
  'reopened_bugs_90d',
  'failed_main_runs_with_issue',
  'risky_areas_reviewed_in_time',
  'fixes_with_test',
  'detection_drill',
  'time_to_find_p90',
  'time_to_fix_high_p90',
  'time_to_fix_other_p90',
  'error_to_issue_p90',
  'failed_main_run_minutes_90d',
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

/** A value with its sample size; `no_events` when nothing happened to measure; null when it could not be read. */
export type Reading = { value: number; samples: number } | 'no_events' | null;

export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** The Severity line. A bug with none counts as high, so leaving it off never helps. */
export function severityOf(body: string): Severity {
  const found = /^Severity:\s*(critical|high|medium|low)\s*$/im.exec(body)?.[1]?.toLowerCase();
  return (found as Severity | undefined) ?? 'high';
}

/** The commit a Landed line names, or null. */
export function landedSha(body: string): string | null {
  return /^Landed:\s*([0-9a-f]{7,40})\s*$/im.exec(body)?.[1] ?? null;
}

/** The ids of the runs an issue's body links to. */
export function linkedRuns(body: string): Set<number> {
  return new Set([...body.matchAll(/\/actions\/runs\/([1-9]\d*)/g)].map((match) => Number(match[1])));
}

/** A closing pull request proves a fix only if it changed a test. Testing owns whether the test is any good. */
const IS_TEST = /\.test\.(ts|js|py)$|_test\.py$|(^|\/)Tests\//;
const changedTest = (bug: Bug) => bug.closedBy.some((paths) => paths.some((path) => IS_TEST.test(path)));

/** The nearest-rank 90th percentile. */
export function p90(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)]!; // safe: callers pass at least one value
}

const round2 = (n: number) => Number(n.toFixed(2));
const percentile = (values: readonly number[]): Reading => (values.length === 0 ? 'no_events' : { value: round2(p90(values)), samples: values.length });
const share = (part: number, whole: number): Reading => (whole === 0 ? 'no_events' : { value: round2((part / whole) * 100), samples: whole });

/** Only a merged pull request closing a bug as done fixes it. */
const isFixed = (bug: Bug) => bug.state === 'CLOSED' && bug.stateReason === 'COMPLETED' && bug.closedBy.length > 0;

/**
 * Whether a bug still counts as open. Closed as not planned, closed with no merged pull request, or stripped of its label,
 * it counts for WINDOW_DAYS after that, so none of those is a way to make a bug go away.
 */
function isOpen(bug: Bug, since: number): boolean {
  if (isFixed(bug)) return false;
  if (bug.state === 'OPEN' && bug.unlabeledAt === null) return true;
  const left = bug.unlabeledAt ?? bug.closedAt;
  return left !== null && Date.parse(left) >= since;
}

/** Every metric but the drill. `bugs` holds every bug issue, and `runs` the failed runs on main. */
export function measure(bugs: readonly Bug[], runs: readonly FailedRun[], reviews: readonly Review[], now: Date): Record<Exclude<MetricId, 'detection_drill'>, Reading> {
  const at = now.getTime();
  const since = at - WINDOW_DAYS * DAY_MS;
  const after = (time: string) => Date.parse(time) >= since;
  // A duplicate leaves the counts only when it names another bug, which counts instead. Otherwise it is as not planned.
  const numbers = new Set(bugs.map((bug) => bug.number));
  const real = bugs.filter((bug) => !(bug.stateReason === 'DUPLICATE' && bug.duplicateOf !== null && bug.duplicateOf !== bug.number && numbers.has(bug.duplicateOf)));
  const open = real.filter((bug) => isOpen(bug, since));
  const count = (value: number): Reading => ({ value, samples: bugs.length });
  const urgent = (severity: Severity) => severity === 'critical' || severity === 'high';

  const completed = real.filter((bug) => bug.state === 'CLOSED' && bug.stateReason === 'COMPLETED' && bug.closedAt !== null && after(bug.closedAt));
  const fixed = completed.filter(isFixed);
  // An open bug counts at its age so far, so leaving one open never looks fast.
  const ages = [...open, ...fixed].map((bug) => ({ severity: severityOf(bug.body), ms: (isFixed(bug) ? Date.parse(bug.closedAt!) : at) - Date.parse(bug.createdAt) })); // safe: a fixed bug has closedAt

  const filed = real.filter((bug) => after(bug.createdAt));
  const failedRuns = new Set(runs.map((run) => run.id));
  const foundFirst = filed.filter(
    (bug) => [...linkedRuns(bug.body)].some((id) => failedRuns.has(id)) || reviews.some((review) => review.bugs.includes(bug.number) && Math.abs(Date.parse(bug.createdAt) - Date.parse(`${review.date}T00:00:00Z`)) <= DAY_MS),
  );
  const daysToFind = (bug: Bug) => {
    const landed = bug.landedAt === null ? Number.NaN : Date.parse(bug.landedAt);
    const created = Date.parse(bug.createdAt);
    return landed <= created ? (created - landed) / DAY_MS : UNKNOWN_FIND_DAYS;
  };

  const recent = runs.filter((run) => after(run.createdAt));
  const naming = (run: FailedRun) => bugs.filter((bug) => linkedRuns(bug.body).has(run.id)).map((bug) => Date.parse(bug.createdAt));
  // A run no issue names counts at its age so far, and only an issue created after the run stops its clock.
  const toIssue = recent.map((run) => (Math.min(...naming(run).filter((time) => time >= Date.parse(run.createdAt)), at) - Date.parse(run.createdAt)) / HOUR_MS);

  const reviewedAt = (area: string) => Math.max(0, ...reviews.filter((review) => review.areas.includes(area)).map((review) => Date.parse(`${review.date}T00:00:00Z`)));
  const inTime = RISKY_AREAS.filter((area) => reviewedAt(area) >= at - AREA_AGE_LIMIT_DAYS * DAY_MS);
  // A row dated in the future could hold an area in time for ever, so it proves nothing.
  const ledgerGood = reviews.every((review) => Date.parse(`${review.date}T00:00:00Z`) <= at);

  return {
    open_bugs_critical_high: count(open.filter((bug) => urgent(severityOf(bug.body))).length),
    bugs_found_first: share(foundFirst.length, filed.length),
    reopened_bugs_90d: count(real.filter((bug) => bug.reopenedAt.some(after)).length),
    failed_main_runs_with_issue: share(recent.filter((run) => naming(run).length > 0).length, recent.length),
    risky_areas_reviewed_in_time: ledgerGood ? share(inTime.length, RISKY_AREAS.length) : null,
    fixes_with_test: share(completed.filter(changedTest).length, completed.length),
    time_to_find_p90: percentile(filed.map(daysToFind)),
    time_to_fix_high_p90: percentile(ages.filter((age) => urgent(age.severity)).map((age) => age.ms / HOUR_MS)),
    time_to_fix_other_p90: percentile(ages.filter((age) => !urgent(age.severity)).map((age) => age.ms / DAY_MS)),
    error_to_issue_p90: percentile(toIssue),
    // Runner time a failure on main threw away. A window with no failed run has nothing to add, which the drill proves.
    // One run with unread jobs makes the total unknown, so only this metric reads missing, never a low number.
    failed_main_run_minutes_90d:
      recent.length === 0 ? 'no_events' : recent.some((run) => run.minutes === null) ? null : { value: recent.reduce((sum, run) => sum + (run.minutes ?? 0), 0), samples: recent.length },
  };
}

/** Whether the canary read back whole: a closed bug with its severity, landing commit, run link, reopening and merged pull request. */
export function canaryRead(bug: Bug | undefined): boolean {
  return bug !== undefined && isFixed(bug) && changedTest(bug) && bug.landedAt !== null && bug.reopenedAt.length > 0 && severityOf(bug.body) === 'low' && linkedRuns(bug.body).has(CANARY_RUN);
}

/** Invented events with one of everything: what `measure` must find in them is written out here. */
const DRILL_NOW = new Date('2026-06-15T00:00:00Z');
const DRILL_BUG: Bug = { number: 1, state: 'OPEN', stateReason: null, duplicateOf: null, createdAt: '2026-06-14T00:00:00Z', closedAt: null, body: 'Severity: high', reopenedAt: [], unlabeledAt: null, closedBy: [], landedAt: null };
const done = { state: 'CLOSED' as const, stateReason: 'COMPLETED' };
const DRILL_BUGS: Bug[] = [
  DRILL_BUG,
  { ...DRILL_BUG, number: 2, body: 'No severity line, and it names /actions/runs/7', createdAt: '2026-06-10T01:00:00Z' },
  { ...DRILL_BUG, ...done, number: 3, body: 'Severity: low', closedAt: '2026-06-12T00:00:00Z', createdAt: '2026-06-11T00:00:00Z', closedBy: [['web/x.test.ts']], landedAt: '2026-06-09T00:00:00Z' },
  { ...DRILL_BUG, ...done, number: 4, body: 'Severity: medium', closedAt: '2026-06-13T00:00:00Z', createdAt: '2026-06-12T00:00:00Z', closedBy: [['web/x.ts']], reopenedAt: ['2026-06-12T12:00:00Z'], landedAt: '2026-06-20T00:00:00Z' },
  { ...DRILL_BUG, number: 5, state: 'CLOSED', stateReason: 'NOT_PLANNED', body: 'Severity: critical', closedAt: '2026-06-13T00:00:00Z', createdAt: '2026-06-12T00:00:00Z' },
  { ...DRILL_BUG, number: 6, createdAt: '2026-06-13T00:00:00Z', unlabeledAt: '2026-06-13T12:00:00Z' },
  { ...DRILL_BUG, ...done, number: 7, closedAt: '2026-06-14T00:00:00Z', createdAt: '2026-06-13T00:00:00Z' },
  { ...DRILL_BUG, number: 8, state: 'CLOSED', stateReason: 'DUPLICATE', duplicateOf: 1, body: 'Severity: critical', closedAt: '2026-06-13T00:00:00Z' },
  { ...DRILL_BUG, number: 9, state: 'CLOSED', stateReason: 'DUPLICATE', duplicateOf: 99, body: 'Severity: critical', closedAt: '2026-06-13T00:00:00Z', createdAt: '2026-06-12T00:00:00Z' },
];
const DRILL_RUNS: FailedRun[] = [{ id: 7, createdAt: '2026-06-10T00:00:00Z', minutes: 3 }, { id: 8, createdAt: '2026-06-14T00:00:00Z', minutes: 5 }];
const DRILL_REVIEWS: Review[] = [{ date: '2026-06-14', areas: RISKY_AREAS.slice(1), bugs: [1, 2, 4] }, { date: '2026-01-01', areas: [RISKY_AREAS[0]], bugs: [] }];
const DRILL_WANT: Record<Exclude<MetricId, 'detection_drill'>, Reading> = {
  open_bugs_critical_high: { value: 6, samples: 9 },
  bugs_found_first: { value: 25, samples: 8 },
  reopened_bugs_90d: { value: 1, samples: 9 },
  failed_main_runs_with_issue: { value: 50, samples: 2 },
  risky_areas_reviewed_in_time: { value: 85.71, samples: 7 },
  fixes_with_test: { value: 33.33, samples: 3 },
  time_to_find_p90: { value: 90, samples: 8 },
  time_to_fix_high_p90: { value: 119, samples: 6 },
  time_to_fix_other_p90: { value: 1, samples: 2 },
  error_to_issue_p90: { value: 24, samples: 2 },
  failed_main_run_minutes_90d: { value: 8, samples: 2 },
};

/**
 * 1 when detection works from end to end: `measure` finds exactly what the invented events hold, the canary issue came
 * back as a bug and whole, and the runs list returned a run. A renamed label or branch would otherwise read as nothing to report.
 */
export function detectionDrill(canary: Bug | undefined, runsListed: boolean): number {
  const logic = JSON.stringify(measure(DRILL_BUGS, DRILL_RUNS, DRILL_REVIEWS, DRILL_NOW)) === JSON.stringify(DRILL_WANT);
  return logic && canaryRead(canary) && runsListed ? 1 : 0;
}

/** A reading as the format's record. Errors and gaps are written as missing, never as a good number. */
export function toRecord(id: MetricId, reading: Reading, measuredAt: string, sourceUrl: string | null): MetricRecord {
  const base = { id, page: 'reliability' as MetricRecord['page'], stage: 'live' as const };
  if (reading === null || sourceUrl === null) return { ...base, value: null, status: 'missing', measured_at: null, source_url: null, sample_size: null };
  if (reading === 'no_events') return { ...base, value: null, status: 'no_events', measured_at: measuredAt, source_url: sourceUrl, sample_size: 0 };
  return { ...base, value: reading.value, status: 'ok', measured_at: measuredAt, source_url: sourceUrl, sample_size: reading.samples };
}
