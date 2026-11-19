// From facts to metric records in the shared format (quality-speed/contract).
// Pure: the clock comes in as an argument. A metric with no samples, or whose
// facts could not be read, is "missing" with no value, so it scores 0 and
// never reads as good news; one with fewer than min_samples keeps its value
// and sample size, and core's scorer gives it 0.

import type { Manifest, MetricRecord } from "../../../contract/format.ts";
import { type DirectPush, type PullFacts, type QueueRun, REWORK_DAYS } from "./facts.ts";

export type { Manifest, MetricRecord };

/** An open pull request: its age so far is a lower bound on its time to merge. */
export interface OpenPull {
  number: number;
  created_at: string;
  /** Opened ready, or marked ready since. A draft never marked ready is work in progress. */
  ever_ready: boolean;
  excluded: null | "base_not_main" | "site_only";
}

export interface DeletedRun {
  workflow: "ci" | "dco" | "review";
  run_number: number;
}

export interface Collected {
  pulls: PullFacts[];
  open: OpenPull[];
  /** Pushes and force pushes to main (activity API, server time): each skipped every gate. */
  direct_pushes: DirectPush[];
  /** Run numbers of the gate workflows missing inside the window: a deleted run hides its result. */
  deleted_runs: DeletedRun[];
  /** Completed merge_group runs in the window, with their job minutes. */
  queue_runs: QueueRun[];
}

/** Pull requests merged (or closed) in the last 28 days count: four whole weeks. */
export const WINDOW_DAYS = 28;
/** Queue groups read over the last two weeks: the queue moved to groups of up to 10 on 2026-11-05. */
export const GROUP_DAYS = 14;
/** Review verdicts read over the last week: the merging skill's verdict comment began in November 2026. */
export const REVIEW_DAYS = 7;
/** The size reviewers handle well (SmartBear and Cisco; Google's small CLs). */
export const SMALL_MAX_LINES = 400;
const DAY = 86400000;

/** Nearest-rank percentile: the smallest value with at least q of the data at or below it. */
export function percentile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil(q * sorted.length)) - 1] ?? null;
}

function share(flags: boolean[]): number | null {
  if (flags.length === 0) return null;
  return (100 * flags.filter(Boolean).length) / flags.length;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function inRange(at: string, from: number, to: number): boolean {
  const t = Date.parse(at);
  return t > from && t <= to;
}

/**
 * Merged pull requests reworked within REWORK_DAYS of merging: a later merge
 * into main rewrote lines they added (named or not), or reverted their merge
 * commit.
 */
export function reworked(pulls: PullFacts[]): Set<number> {
  const out = new Set<number>();
  const onMain = pulls.filter((f) => f.state === "merged" && f.excluded !== "base_not_main");
  for (const a of onMain) {
    const t0 = Date.parse(a.ended_at);
    for (const b of onMain) {
      if (b.number === a.number) continue;
      const dt = Date.parse(b.ended_at) - t0;
      if (dt <= 0 || dt > REWORK_DAYS * DAY) continue;
      if (b.fixes.includes(a.number) || b.reverts.some((sha) => a.merge_sha!.startsWith(sha))) {
        out.add(a.number);
        break;
      }
    }
  }
  return out;
}

/** A reading: `none` is a measured window with nothing to count, written as no_events. */
export type Measured = { value: number | null; n: number; none?: true };

/** Values and sample sizes for every metric this page defines. */
export function measure(data: Collected, now: Date): Record<string, Measured> {
  const end = now.getTime();
  const start = end - WINDOW_DAYS * DAY;
  const pulls = data.pulls.filter((f) => f.excluded !== "base_not_main" && inRange(f.ended_at, start, end));
  const counted = pulls.filter((f) => f.excluded === null);
  const countedMerged = counted.filter((f) => f.state === "merged");
  // Closed without merging counts too, once it was ready: closing and
  // reopening must not hide a red first run or a Blocking finding.
  const submitted = counted.filter((f) => f.ready_at !== null);
  const firstRead = submitted.flatMap((f) => (f.ci_green_first_time === null ? [] : [f.ci_green_first_time]));

  // The gate: every merge into main but this site's own. Each push to main
  // without a pull request and each deleted CI, DCO or review run is a miss.
  const pushes = data.direct_pushes.filter((p) => inRange(p.at, start, end));
  const gates = [
    ...countedMerged.map((f) => f.gate_misses !== null && f.gate_misses.length === 0),
    ...pushes.map(() => false),
    ...data.deleted_runs.map(() => false),
  ];

  const rw = REWORK_DAYS * DAY;
  const matured = data.pulls.filter(
    (f) => f.state === "merged" && f.excluded === null && inRange(f.ended_at, start - rw, end - rw),
  );
  const redone = reworked(data.pulls);

  // Time to merge: merged pull requests. Ones closed unmerged after being
  // ready, and ready ones still open, are lower bounds: they may only raise a
  // percentile, never lower it (closing fast must not read as merging fast).
  const mergedTimes = countedMerged.map((f) => f.open_minutes);
  const bounds = [
    ...counted.filter((f) => f.state === "closed" && f.ready_at !== null).map((f) => f.open_minutes),
    ...data.open.filter((o) => o.excluded === null && o.ever_ready).map((o) => (end - Date.parse(o.created_at)) / 60000),
  ];
  const withBounds = [...mergedTimes, ...bounds];
  // A bound never stands in for a merge: no merges, no value; samples count merges only.
  const upper = (q: number): number | null => {
    const a = percentile(mergedTimes, q);
    return a === null ? null : Math.max(a, percentile(withBounds, q)!);
  };
  const reviews = counted.flatMap((f) => f.review_result_minutes);
  const humans = countedMerged.filter((f) => f.template_complete !== null);

  // The merge queue: merges that went through it, pull requests ever added to it, and the minutes its runs took. A run
  // for a pull request this page leaves out (this site's own, another base) is left out too.
  const queueWaits = countedMerged.flatMap((f) => (f.queue_minutes === null ? [] : [f.queue_minutes]));
  const queued = counted.filter((f) => f.queue_ejected !== null);
  const left = new Set([...data.pulls, ...data.open].filter((p) => p.excluded !== null).map((p) => p.number));
  const queueRuns = data.queue_runs.filter((r) => r.pull !== null && !left.has(r.pull) && inRange(r.created_at, start, end));
  // A group is the pull requests one queue merge landed: main moves once, so they share a merge second. Each entry still
  // gets its own merge_group run, so grouping saves wait, not minutes.
  const groups = new Map<string, number>();
  for (const f of countedMerged) {
    if (f.queue_minutes !== null && inRange(f.ended_at, end - GROUP_DAYS * DAY, end)) groups.set(f.ended_at, (groups.get(f.ended_at) ?? 0) + 1);
  }
  const groupSizes = [...groups.values()];
  // No run read is no reading, never zero minutes.
  const perMerge = queueWaits.length === 0 || queueRuns.length === 0 ? null : queueRuns.reduce((n, r) => n + r.minutes, 0) / queueWaits.length;

  // Pushes and review rounds per merge: every counted pull request's pushes and verdicts, closed unmerged ones too, over
  // the merges. A merge with no CI run, or (in the review window) no verdict, proves nothing: the reading is missing.
  const per = (x: number, merges: PullFacts[], proven: boolean): Measured => ({ value: merges.length > 0 && proven ? x / merges.length : null, n: merges.length });
  const pushed = per(sum(counted.map((f) => f.ci_heads)), countedMerged, countedMerged.every((f) => f.ci_heads > 0));
  const finals = countedMerged.flatMap((f) => (f.final_push_minutes === null ? [] : [f.final_push_minutes]));
  const recent = counted.filter((f) => inRange(f.ended_at, end - REVIEW_DAYS * DAY, end));
  const recentMerged = recent.filter((f) => f.state === "merged");
  const rounds = per(sum(recent.map((f) => f.verdicts)), recentMerged, recentMerged.every((f) => f.verdicts > 0));
  const tokens = recent.flatMap((f) => f.review_tokens);
  // Stacks: a merge over the size goal, or a stack layer. Stacked ones count; a lone big merge is a miss. None of either:
  // nothing was big, which small_changes proves.
  const big = countedMerged.filter((f) => f.stacked || f.size_lines > SMALL_MAX_LINES);
  const stacked: Measured = big.length === 0 ? { value: null, n: 0, none: true } : { value: share(big.map((f) => f.stacked)), n: big.length };

  return {
    required_gates_on_merged_head: { value: share(gates), n: gates.length },
    // No CI run after "ready" is no reading, never a miss.
    ci_green_first_time: { value: share(firstRead), n: firstRead.length },
    no_blocking_findings: { value: share(submitted.map((f) => f.drew_blocking === false)), n: submitted.length },
    no_rework_7d: { value: share(matured.map((f) => !redone.has(f.number))), n: matured.length },
    small_changes: { value: share(countedMerged.map((f) => f.size_lines <= SMALL_MAX_LINES)), n: countedMerged.length },
    // A body never checked for edits after its review does not count as complete.
    template_complete: { value: share(humans.map((f) => f.template_complete === true && f.edit_checked)), n: humans.length },
    open_to_merge_p50: { value: upper(0.5), n: mergedTimes.length },
    open_to_merge_p90: { value: upper(0.9), n: mergedTimes.length },
    review_result_p90: { value: percentile(reviews, 0.9), n: reviews.length },
    queue_wait_p50: { value: percentile(queueWaits, 0.5), n: queueWaits.length },
    queue_wait_p90: { value: percentile(queueWaits, 0.9), n: queueWaits.length },
    queue_ejections_pct: { value: share(queued.map((f) => f.queue_ejected === true)), n: queued.length },
    queue_minutes_per_merge: { value: perMerge, n: queueWaits.length },
    queue_prs_per_group_p50: { value: percentile(groupSizes, 0.5), n: groupSizes.length },
    pushes_per_merge: pushed,
    final_push_to_merge_p50: { value: percentile(finals, 0.5), n: finals.length },
    review_rounds: rounds,
    review_tokens_p50: { value: percentile(tokens, 0.5), n: tokens.length },
    big_changes_stacked: stacked,
    // The lane's job minutes, which no fact holds: missing here, and collect.ts puts core/lane's laneRecord() in its place.
    lane_minutes: { value: null, n: 0 },
  };
}

/** Records for metrics.json, in the manifest's order. */
export function records(data: Collected, manifest: Manifest, now: Date, sourceUrl: string): MetricRecord[] {
  const values = measure(data, now);
  return manifest.metrics.map((def) => {
    const v = values[def.id];
    if (!v) throw new Error(`no measure for ${def.id}`);
    const ok = v.value !== null;
    const none = v.none === true;
    return {
      id: def.id,
      page: manifest.page,
      value: ok ? round6(v.value!) : null,
      status: ok ? "ok" : none ? "no_events" : "missing",
      stage: "live",
      measured_at: ok || none ? now.toISOString().replace(/\.\d+Z$/, "Z") : null,
      source_url: ok || none ? sourceUrl : null,
      sample_size: ok ? v.n : none ? 0 : null,
    };
  });
}

/** Records for a run whose reads failed: every metric missing, none skipped. */
export function failedRecords(manifest: Manifest): MetricRecord[] {
  return manifest.metrics.map((def) => ({
    id: def.id,
    page: manifest.page,
    value: null,
    status: "missing",
    stage: "live",
    measured_at: null,
    source_url: null,
    sample_size: null,
  }));
}

export function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}
