// The facts the Claude Code collector reads, and the records it writes. A snapshot
// may hold titles, bodies and commit messages so the rules can be checked, but
// it is never published: only MetricRecord values (numbers, times and links to
// this repository's runs, pull requests or commits) leave the collector.

export interface Pull {
  number: number;
  title: string;
  body: string;
  userType: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  createdAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  mergeSha: string | null;
}

export interface PrCommit {
  sha: string;
  message: string;
  authorDate: string;
  verified: boolean;
}

export interface Step {
  name: string;
  conclusion: string | null;
}

export interface Job {
  name: string;
  /** Which attempt of its run this job belongs to: a re-run is attempt 2 and up. */
  runAttempt: number;
  labels: string[];
  startedAt: string | null;
  completedAt: string | null;
  conclusion: string | null;
  steps: Step[];
}

export interface Run {
  id: number;
  workflow: string;
  headBranch: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  conclusion: string | null;
  url: string;
  /** Every attempt's jobs; null when they could not be read. */
  jobs: Job[] | null;
}

/**
 * What the collector read about one pull request. A field is null when it
 * could not be read, or was not needed for that pull request's role.
 */
export interface PrFacts {
  commits: PrCommit[] | null;
  /** Conclusion of the required `ci-ok` check on the merged head. */
  ciOk: string | null;
  mainCommitVerified: boolean | null;
  mainCommitSubject: string | null;
  mainCommitParents: number | null;
  /** Every workflow run on the branch while the pull request was open. */
  runs: Run[] | null;
  /** When the review bot posted a comment starting "Blocking:". */
  blockingAt: string[] | null;
}

/** The parts of the repository that make up Claude's fence in CI. */
export interface Fence {
  settings: string;
  check: string;
  workflow: string;
  pin: string;
}

/** An issue open at takenAt: its body and labels, read to find open bugs a merge shipped. Never published. */
export interface OpenIssue {
  number: number;
  body: string;
  labels: string[];
}

export interface Instructions {
  checked: number;
  broken: string[];
}

export interface Snapshot {
  repo: string;
  takenAt: string;
  /** The commit main pointed at, at takenAt. */
  mainSha: string;
  pulls: Pull[];
  /** The window's agent merges, by number: the newest MAX_PRS, the site's own included. */
  window: number[];
  /** Keyed by pull request number; null when its reads failed. */
  facts: Record<string, PrFacts | null>;
  confinementRuns: Run[] | null;
  fenceMain: Fence | null;
  /** Keyed by run id. */
  fenceAtRun: Record<string, Fence | null>;
  /** Commits on main in the last 30 days that no merged pull request produced (the root commit aside), with their commit times. */
  directPushes: { sha: string; at: string }[] | null;
  instructions: Instructions | null;
  /** Issues open at takenAt, pull requests left out. */
  openIssues: OpenIssue[] | null;
}

// The page's two files follow quality-speed/contract: manifest.json is the
// reviewed list, metrics.json the collector's readings.
export type { Lens, Manifest, MetricDef, MetricRecord, Status } from "../../../contract/format.ts";

/**
 * A measured value before it becomes a record. `source` is a link to this
 * repository's pull request, run or commit; null means use the collector's own
 * run. `time` is when the fact was established (a proof run's start, or now).
 */
export interface Measure {
  value: number | null;
  sample: number;
  source: string | null;
  time: string;
}
