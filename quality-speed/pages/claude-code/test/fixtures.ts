// Invented pull requests, runs and fences for the Claude Code tests. Nothing here
// comes from a real repository: numbers, branches, dates and shas are made up.

import type { Fence, Job, Pull, PrFacts, Run, Snapshot } from "../lib/types.ts";

export const NOW = "2031-04-10T12:00:00Z";

export function pull(n: number, o: Partial<Pull> = {}): Pull {
  return {
    number: n, title: `Sample change ${n}`, body: "| Verified | node --test: 4 pass |", userType: "User", headRef: `claude/sample-${n}`, headSha: `head${n}`,
    baseRef: "main", createdAt: "2031-04-09T10:00:00Z", closedAt: "2031-04-09T11:00:00Z", mergedAt: "2031-04-09T11:00:00Z",
    mergeSha: `merge${n}`, ...o,
  };
}

export function job(review: string, verdictStep: string, o: Partial<Job> = {}): Job {
  return {
    name: "claude-review", runAttempt: 1, labels: ["ubuntu-latest"], startedAt: "2031-04-09T10:01:00Z", completedAt: "2031-04-09T10:02:00Z",
    conclusion: verdictStep === "failure" || review === "failure" ? "failure" : "success",
    steps: [{ name: "Review", conclusion: review }, { name: "Verdict", conclusion: verdictStep }], ...o,
  };
}

export function run(id: number, o: Partial<Run> = {}): Run {
  return {
    id, workflow: "Claude review", headBranch: "claude/sample-1", headSha: "head1", createdAt: "2031-04-09T10:01:00Z",
    updatedAt: "2031-04-09T10:02:00Z", status: "completed", conclusion: "success",
    url: `https://github.com/sample/repo/actions/runs/${id}`, jobs: [job("success", "success")], ...o,
  };
}

/** A clean merge's facts: signed, verified, squashed, up to date, reviewed on its head. */
export function facts(n: number, o: Partial<PrFacts> = {}): PrFacts {
  return {
    commits: [{ sha: `c${n}`, message: "Sample\n\nSigned-off-by: Sample <s@example.invalid>", authorDate: "2031-04-09T09:30:00Z", verified: true }],
    ciOk: "success", mainCommitVerified: true, mainCommitSubject: `Sample change (#${n})`, mainCommitParents: 1,
    runs: [run(n * 10, { headBranch: `claude/sample-${n}`, headSha: `head${n}` })], blockingAt: [], ...o,
  };
}

export const FENCE: Fence = { settings: "s1", check: "k1", workflow: "w1", pin: "p1" };

export function snapshot(o: Partial<Snapshot> = {}): Snapshot {
  return {
    repo: "sample/repo", takenAt: NOW, mainSha: "0".repeat(40), pulls: [], window: [], facts: {}, confinementRuns: [],
    fenceMain: FENCE, fenceAtRun: {}, directPushes: [], instructions: { checked: 30, broken: [] }, openIssues: [], ...o,
  };
}

/** A snapshot whose window is the given merges, each with clean facts unless overridden. */
export function windowOf(pulls: Pull[], over: Record<number, Partial<PrFacts> | null> = {}, o: Partial<Snapshot> = {}): Snapshot {
  const f: Record<string, PrFacts | null> = {};
  for (const p of pulls) f[p.number] = over[p.number] === null ? null : facts(p.number, over[p.number] ?? {});
  return snapshot({ pulls, window: pulls.filter((p) => p.mergedAt && p.userType !== "Bot").map((p) => p.number), facts: f, ...o });
}
