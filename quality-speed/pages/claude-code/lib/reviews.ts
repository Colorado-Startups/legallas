// What claude-review said, attempt by attempt. A run can be re-run on the same
// head, so each attempt is its own event: re-running a Blocking verdict on an
// unchanged head is a rule break.

import type { Job, PrFacts, Run } from "./types.ts";

export const REVIEW_WORKFLOW = "Claude review";
const ms = (iso: string) => Date.parse(iso);

export interface Attempt {
  run: Run;
  attempt: number;
  /** Null when a finished run has no job: it never started. */
  job: Job | null;
  start: string;
  end: string;
}

/** The attempts of a finished, not skipped run. Throws on unread jobs, so callers report missing. */
export function attempts(run: Run): Attempt[] {
  if (run.status !== "completed" || run.conclusion === "skipped") return [];
  if (!run.jobs) throw new Error(`jobs of run ${run.id} were not read`);
  if (run.jobs.length === 0) return [{ run, attempt: 1, job: null, start: run.createdAt, end: run.updatedAt }];
  const byAttempt = new Map<number, Job>();
  for (const job of run.jobs) byAttempt.set(job.runAttempt, job);
  return [...byAttempt.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([attempt, job]) => ({ run, attempt, job, start: job.startedAt ?? run.createdAt, end: job.completedAt ?? run.updatedAt }));
}

/**
 * A review comment that carries a Blocking finding: a line that starts with
 * "Blocking", as an inline comment ("Blocking: ...") or the summary's heading
 * ("**Blocking**") has it. "No blocking findings." does not.
 */
export function isBlockingComment(body: string): boolean {
  return /^\W*Blocking\b/m.test(body);
}

export type Verdict = "pass" | "block" | "error" | "none" | "unknown";

/**
 * One attempt's verdict. Its Review step runs the agent; its Verdict step
 * fails both on a Blocking finding and on no verdict at all, so a failure is
 * Blocking only when the review bot posted a "Blocking:" comment during the
 * attempt. Without those comments it is unknown.
 */
export function verdict(a: Attempt, blockingAt: string[] | null): Verdict {
  if (!a.job) return "error";
  if (a.job.conclusion === "skipped") return "none";
  const review = a.job.steps.find((x) => x.name === "Review")?.conclusion;
  const check = a.job.steps.find((x) => x.name === "Verdict")?.conclusion;
  if (review === "success" && check === "success") return "pass";
  if (review === "success" && check === "failure") {
    if (!blockingAt) return "unknown";
    const lo = ms(a.start) - 60_000;
    const hi = ms(a.end) + 300_000;
    return blockingAt.some((t) => ms(t) >= lo && ms(t) <= hi) ? "block" : "error";
  }
  return "error";
}

/** Review attempts on a pull request's branch while it was open, oldest first. */
export function reviewAttempts(f: PrFacts): Attempt[] {
  if (!f.runs) throw new Error("runs were not read");
  return f.runs
    .filter((r) => r.workflow === REVIEW_WORKFLOW)
    .flatMap(attempts)
    .sort((a, b) => ms(a.start) - ms(b.start));
}

/** A Blocking verdict followed by another review of the same head: a re-run instead of a fix. Null when unknown. */
export function rerunAfterBlock(f: PrFacts): boolean | null {
  const all = reviewAttempts(f).map((a) => ({ a, v: verdict(a, f.blockingAt) }));
  if (all.some(({ v }) => v === "unknown")) return null;
  return all.some(({ a, v }) => v === "block" && all.some(({ a: b }) => b.run.headSha === a.run.headSha && ms(b.start) > ms(a.end)));
}

