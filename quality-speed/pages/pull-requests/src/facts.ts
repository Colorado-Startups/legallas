// Per pull request facts, from raw GitHub REST objects. Pure: no network, no
// clock. Output holds numbers, booleans, dates, PR numbers, commit ids and
// codes from closed lists only: no titles, bodies, logins or file names leave
// this file.

/** The fields this page reads from a pull request. */
export interface RawPull {
  number: number;
  title: string | null;
  body: string | null;
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
  draft?: boolean;
  user: { type: string } | null;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
}

export interface RawFile {
  filename: string;
  additions: number;
  deletions: number;
  /** Unified diff; GitHub leaves it out for binary and very large files. */
  patch?: string;
}

export interface RawEvent {
  event: string;
  created_at?: string;
}

export interface RawComment {
  body: string | null;
  user: { type: string } | null;
}

/** A conversation comment, as the issue comments listing gives it. */
export interface RawIssueComment extends RawComment {
  author_association: string;
}

export interface RawRun {
  id: number;
  path: string;
  head_sha: string;
  run_attempt: number;
  conclusion: string | null;
  created_at: string;
}

export interface RawStep {
  name: string;
  conclusion: string | null;
}

export interface RawJob {
  name: string;
  run_attempt?: number;
  conclusion: string | null;
  started_at?: string | null;
  completed_at: string | null;
  steps?: RawStep[];
}

export interface RawCommit {
  commit: { message: string };
}

/** Repository rules a pull request was written against, read at its base commit. */
export interface Rules {
  /** Sections of .github/pull_request_template.md, in order: `## ` headings, or the first cell of a table row. */
  templateHeadings: string[];
  /** Number of checklist lines in the template. */
  templateBoxes: number;
  /** Checklist lines that state a "No ..." fact: these must be ticked. */
  templateAttestations: number;
  /** linguist-generated patterns from .gitattributes. */
  generated: string[];
}

/** Everything read for one closed pull request. */
export interface PullInput {
  pull: RawPull;
  files: RawFile[];
  timeline: RawEvent[];
  reviewComments: RawComment[];
  commits: RawCommit[];
  /** Workflow runs of this pull request's branch while it was open. */
  runs: RawRun[];
  /** First-attempt conclusion for runs whose run_attempt is above 1. */
  firstAttempt: Record<number, string | null>;
  /** Jobs of every attempt of each review run, by run id. */
  reviewJobs: Record<number, RawJob[]>;
  rules: Rules;
  /** Commits main had that the merged head lacked; null when unknown or not merged. */
  behindMain: number | null;
  /** The merged head carries the same change as a head that drew a Blocking verdict (an empty commit, or main merged in). */
  blockingSameChange: boolean;
  /** Earlier merges, within REWORK_DAYS before this one, whose lines it rewrites (src/rework.ts). */
  fixes: number[];
  /** Git could not read this merge, so `fixes` holds every earlier merge in its window. */
  reworkUnknown: boolean;
  /** The body was edited after the passing review on the merged head started (GraphQL lastEditedAt); null when not checked. */
  editedAfterReview: boolean | null;
  /** Conversation comments: the orchestrator's review verdicts are among them. */
  issueComments: RawIssueComment[];
  /** Another pull request targets this one's branch: the bottom of a stack. */
  stackBase: boolean;
}

/** Bumped whenever the facts a pull request yields change meaning. */
export const FACTS_VERSION = 8;

/** Why the required gates did not hold on the merged head. Closed list. */
export const GATE_MISSES = [
  "review_not_run",
  "blocking_verdict",
  "review_workflow_changed",
  "ci_not_green",
  "dco_not_green",
  "behind_main",
] as const;
export type GateMiss = (typeof GATE_MISSES)[number];

export interface PullFacts {
  v: number;
  number: number;
  state: "merged" | "closed";
  created_at: string;
  /** merged_at, or closed_at for one closed without merging. */
  ended_at: string;
  /** When it became ready for review; null if it never left draft. */
  ready_at: string | null;
  merge_sha: string | null;
  /** Left out of the metrics: another base branch, or only this site's own files. */
  excluded: null | "base_not_main" | "site_only";
  bot: boolean;
  /** Lines added plus deleted, leaving out lock, generated and this site's own files. */
  size_lines: number;
  /** Merged only: what failed among the required gates on the merged head; [] when all held. */
  gate_misses: GateMiss[] | null;
  /** Null if it never left draft. */
  ci_green_first_time: boolean | null;
  /** Null if it never left draft. */
  drew_blocking: boolean | null;
  /** Null for bot pull requests and ones closed without merging. */
  template_complete: boolean | null;
  /** Whether the body was checked for edits after the review read it. An unchecked body never counts as complete. */
  edit_checked: boolean;
  /** Opening to merge, or to close. */
  open_minutes: number;
  /** Trigger to result, per review run; runs with no verdict count as REVIEW_TIMEOUT_MINUTES. */
  review_result_minutes: number[];
  /** Earlier merges, within REWORK_DAYS before this one, whose lines this one deletes or changes. */
  fixes: number[];
  /** Commit ids this pull request's commits say they revert. */
  reverts: string[];
  /** Git could not read this merge; `fixes` counts every earlier merge in its window. */
  rework_unknown: boolean;
  /** Merged only: minutes in the merge queue, each add to the removal or merge that ended it, summed. Null if never queued. */
  queue_minutes: number | null;
  /** Removed from the merge queue without merging at least once. Null if never queued. */
  queue_ejected: boolean | null;
  /** Heads CI ran on: one per push. */
  ci_heads: number;
  /** Merged only: the merged head's first run to the merge. Null if no run on it. */
  final_push_minutes: number | null;
  /** Review verdicts posted (the merging skill's `Review: MERGE|BLOCK at <sha>`): one per round. */
  verdicts: number;
  /** Each verdict's second line, `Tokens: n`, where it has one. */
  review_tokens: number[];
  /** A layer of a stack: retargeted (base_ref_changed), or another pull request targets its branch. */
  stacked: boolean;
}

export const REVIEW_WORKFLOW = ".github/workflows/claude-review.yml";
export const CI_WORKFLOW = ".github/workflows/ci.yml";
export const DCO_WORKFLOW = ".github/workflows/dco.yml";
export const REVIEW_JOB = "claude-review";
/** The review job's timeout-minutes: a run with no verdict counts this long. */
export const REVIEW_TIMEOUT_MINUTES = 30;
export const REWORK_DAYS = 7;

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Package.resolved",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
]);

const SITE_PREFIX = "quality-speed/";
/** Every site workflow: `quality-speed.yml`, `quality-speed-screens.yml` and any later one. */
const SITE_WORKFLOW = /^\.github\/workflows\/quality-speed[\w-]*\.yml$/;

/** This site's own folder and workflows: never counted on this page (quality-speed/BRIEF.md). */
export function isSite(path: string): boolean {
  return path.startsWith(SITE_PREFIX) || SITE_WORKFLOW.test(path);
}

function minutesBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 60000;
}

/** A .gitattributes pattern as a test on a repo path: no slash matches the file name at any depth. */
function patternTest(pattern: string): (path: string) => boolean {
  const anchored = pattern.includes("/");
  const body = pattern
    .replace(/^\//, "")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*$/, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  const re = new RegExp(`^${body}$`);
  return (path) => re.test(anchored ? path : path.slice(path.lastIndexOf("/") + 1));
}

/** True when a path is a lock file or matches a linguist-generated pattern. */
export function isGenerated(path: string, generated: string[]): boolean {
  if (LOCKFILES.has(path.slice(path.lastIndexOf("/") + 1))) return true;
  return generated.some((p) => patternTest(p)(path));
}

/** Reads linguist-generated patterns out of a .gitattributes file. */
export function parseGitattributes(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [pattern, ...attrs] = t.split(/\s+/);
    if (pattern && attrs.some((a) => a === "linguist-generated" || a === "linguist-generated=true")) out.push(pattern);
  }
  return out;
}

/** A table row's first cell and the rest, or null for a non-row, the header row or a separator. */
function tableRow(line: string): { label: string; rest: string } | null {
  const m = /^\|([^|]*)\|(.*)\|\s*$/.exec(line.trim());
  const label = m?.[1]?.trim();
  if (!m || !label || /^:?-+:?$/.test(label)) return null;
  return { label, rest: (m[2] ?? "").replace(/\|/g, "").trim() };
}

/** Reads the sections (headings or table rows) and checklist lines of the pull request template. */
export function parseTemplate(text: string): { headings: string[]; boxes: number; attestations: number } {
  const lines = text.split("\n");
  return {
    headings: lines.flatMap((l) => (/^## \S/.test(l) ? [l.slice(3).trim()] : (tableRow(l)?.label ?? []))),
    boxes: lines.filter((l) => /^\s*- \[ \]/.test(l)).length,
    attestations: lines.filter((l) => /^\s*- \[ \] No /.test(l)).length,
  };
}

/**
 * A body is complete when every template section is present with some text
 * that is not an HTML comment (under a heading, or in a table row's other
 * cells), it carries at least as many checklist lines as the template, and
 * every "No ..." line is ticked. Other lines may stay unticked: "D1 migration
 * included? No" is a correct answer.
 */
export function templateComplete(body: string | null, rules: Rules): boolean {
  if (!body) return false;
  const text = body.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  const lines = text.split("\n");
  for (const heading of rules.templateHeadings) {
    const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
    if (start < 0) {
      if (!lines.some((l) => { const r = tableRow(l); return r?.label === heading && r.rest !== ""; })) return false;
      continue;
    }
    let end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l));
    if (end < 0) end = lines.length;
    if (!lines.slice(start + 1, end).some((l) => l.trim() !== "")) return false;
  }
  const boxes = lines.filter((l) => /^\s*- \[[ xX]\]/.test(l)).length;
  const attested = lines.filter((l) => /^\s*- \[[xX]\] No /.test(l)).length;
  const unattested = lines.filter((l) => /^\s*- \[ \] No /.test(l)).length;
  return boxes >= rules.templateBoxes && unattested === 0 && attested >= rules.templateAttestations;
}

/** Commit ids named by "This reverts commit <sha>" in the commit messages. */
export function revertedShas(commits: RawCommit[]): string[] {
  const out = new Set<string>();
  for (const c of commits) {
    for (const m of c.commit.message.matchAll(/This reverts commit ([0-9a-f]{7,40})/g)) if (m[1]) out.add(m[1]);
  }
  return [...out];
}

/**
 * When the pull request became ready for review: created_at if it was opened
 * ready, else its first ready_for_review event, else null (never left draft).
 */
export function readyAt(pull: RawPull, timeline: RawEvent[]): string | null {
  const marks = timeline
    .filter((e) => (e.event === "ready_for_review" || e.event === "convert_to_draft") && e.created_at)
    .sort((a, b) => Date.parse(a.created_at!) - Date.parse(b.created_at!));
  const first = marks[0];
  if (!first) return pull.draft ? null : pull.created_at;
  return first.event === "convert_to_draft" ? pull.created_at : first.created_at!;
}

/** One attempt of the review job: whether it ran, and its verdict. */
export interface ReviewAttempt {
  attempt: number;
  ran: boolean;
  /** "pass": Review and Verdict succeeded. "blocking": Review succeeded, Verdict failed. "none": no verdict. */
  verdict: "pass" | "blocking" | "none";
  cancelled: boolean;
  completed_at: string | null;
}

/** Every attempt of the review job in one run. A renamed step reads as no verdict: fails closed. */
export function reviewAttempts(jobs: RawJob[] | undefined): ReviewAttempt[] {
  return (jobs ?? [])
    .filter((j) => j.name === REVIEW_JOB)
    .map((j) => {
      const step = (n: string) => (j.steps ?? []).find((s) => s.name === n)?.conclusion ?? null;
      const review = step("Review");
      const verdict = step("Verdict");
      const ran = j.conclusion !== "skipped" && review !== null && review !== "skipped";
      const v =
        ran && review === "success" && verdict === "success" && j.conclusion === "success"
          ? "pass"
          : ran && review === "success" && verdict === "failure"
            ? "blocking"
            : "none";
      return { attempt: j.run_attempt ?? 1, ran, verdict: v, cancelled: j.conclusion === "cancelled", completed_at: j.completed_at };
    });
}

function firstConclusion(run: RawRun, firstAttempt: Record<number, string | null>): string | null {
  return run.run_attempt > 1 ? (firstAttempt[run.id] ?? null) : run.conclusion;
}

const FAILED = new Set(["failure", "timed_out", "action_required", "startup_failure", "stale"]);

/**
 * A workflow passed first time on a commit when some run of it there
 * succeeded on its first attempt and none failed on its first attempt.
 * Cancelled runs (superseded) count neither way. `skippedPasses` lets the
 * DCO job's by-design skip for bot pull requests count as a pass.
 */
function passedFirstTime(input: PullInput, path: string, sha: string, skippedPasses: boolean): boolean {
  const firsts = input.runs
    .filter((r) => r.path === path && r.head_sha === sha)
    .map((r) => firstConclusion(r, input.firstAttempt));
  if (firsts.some((c) => c !== null && FAILED.has(c))) return false;
  return firsts.some((c) => c === "success" || (skippedPasses && c === "skipped"));
}

/** The newest run of a workflow on a commit passed (its latest attempt), as the required check reads it. */
function greenOnHead(input: PullInput, path: string, sha: string, skippedPasses: boolean): boolean {
  const runs = input.runs
    .filter((r) => r.path === path && r.head_sha === sha)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const newest = runs[0];
  if (!newest) return false;
  const c = newest.conclusion;
  return c === "success" || (skippedPasses && c === "skipped");
}

function byCreated(a: RawRun, b: RawRun): number {
  return Date.parse(a.created_at) - Date.parse(b.created_at);
}

/** What failed among the required gates on the merged head. */
export function gateMisses(input: PullInput, bot: boolean): GateMiss[] {
  const head = input.pull.head.sha;
  const attempts = input.runs
    .filter((r) => r.path === REVIEW_WORKFLOW && r.head_sha === head)
    .flatMap((r) => reviewAttempts(input.reviewJobs[r.id]));
  const out: GateMiss[] = [];
  if (!attempts.some((a) => a.verdict === "pass")) out.push("review_not_run");
  if (attempts.some((a) => a.verdict === "blocking") || input.blockingSameChange) out.push("blocking_verdict");
  if (input.files.some((f) => f.filename === REVIEW_WORKFLOW)) out.push("review_workflow_changed");
  if (!greenOnHead(input, CI_WORKFLOW, head, false)) out.push("ci_not_green");
  if (!greenOnHead(input, DCO_WORKFLOW, head, bot)) out.push("dco_not_green");
  if (input.behindMain !== 0) out.push("behind_main");
  return out;
}

/**
 * Minutes from the event that started each review run to the review job's
 * verdict, first attempt. A run that ran with no verdict (crash, timeout,
 * manual cancel) counts as the job's timeout. A run cancelled because a newer
 * review run of the same pull request started is left out.
 */
export function reviewResultMinutes(input: PullInput): number[] {
  const runs = input.runs.filter((r) => r.path === REVIEW_WORKFLOW).sort(byCreated);
  const out: number[] = [];
  for (const run of runs) {
    if (run.conclusion === "skipped") continue;
    const first = reviewAttempts(input.reviewJobs[run.id]).find((a) => a.attempt === 1);
    if (first && !first.ran) continue;
    const end = first?.completed_at ?? null;
    const superseded = runs.some(
      (r) => r.id !== run.id && Date.parse(r.created_at) > Date.parse(run.created_at) && (end === null || Date.parse(r.created_at) <= Date.parse(end)),
    );
    const cancelled = run.conclusion === "cancelled" || first?.cancelled === true;
    if (cancelled && superseded) continue;
    if (first && first.verdict !== "none" && end) out.push(minutesBetween(run.created_at, end));
    else out.push(REVIEW_TIMEOUT_MINUTES);
  }
  return out;
}

export function pullFacts(input: PullInput): PullFacts {
  const { pull, rules } = input;
  const merged = pull.merged_at !== null && pull.merge_commit_sha !== null;
  const ended = pull.merged_at ?? pull.closed_at;
  if (!ended) throw new Error(`#${pull.number} is still open`);
  const bot = pull.user?.type === "Bot";
  const siteOnly = input.files.length > 0 && input.files.every((f) => isSite(f.filename));
  const excluded = pull.base.ref !== "main" ? "base_not_main" : siteOnly ? "site_only" : null;

  const counted = input.files.filter((f) => !isGenerated(f.filename, rules.generated) && !isSite(f.filename));
  const ready = readyAt(pull, input.timeline);
  const reviewRuns = input.runs.filter((r) => r.path === REVIEW_WORKFLOW).sort(byCreated);

  // The head at "ready for review": the head of the first review run started
  // at or after that moment (opened, or ready_for_review).
  const firstReady = ready === null ? undefined : reviewRuns.find((r) => Date.parse(r.created_at) >= Date.parse(ready) - 5000);
  const ciFirst =
    ready === null
      ? null
      : firstReady !== undefined &&
        passedFirstTime(input, CI_WORKFLOW, firstReady.head_sha, false) &&
        passedFirstTime(input, DCO_WORKFLOW, firstReady.head_sha, bot);

  const blockingVerdict = reviewRuns.some((r) => reviewAttempts(input.reviewJobs[r.id]).some((a) => a.verdict === "blocking"));
  const blockingComment = input.reviewComments.some((c) => c.user?.type === "Bot" && /^\W*Blocking:/i.test(c.body ?? ""));

  return {
    v: FACTS_VERSION,
    number: pull.number,
    state: merged ? "merged" : "closed",
    created_at: pull.created_at,
    ended_at: ended,
    ready_at: ready,
    merge_sha: merged ? pull.merge_commit_sha : null,
    excluded,
    bot,
    size_lines: counted.reduce((n, f) => n + f.additions + f.deletions, 0),
    gate_misses: merged ? gateMisses(input, bot) : null,
    ci_green_first_time: ciFirst,
    drew_blocking: ready === null ? null : blockingVerdict || blockingComment,
    template_complete: !merged || bot ? null : input.editedAfterReview !== true && templateComplete(pull.body, rules),
    edit_checked: input.editedAfterReview !== null,
    open_minutes: minutesBetween(pull.created_at, ended),
    review_result_minutes: reviewResultMinutes(input),
    fixes: merged ? [...input.fixes].sort((a, b) => a - b) : [],
    reverts: revertedShas(input.commits),
    rework_unknown: merged && input.reworkUnknown,
    ...queueFacts(input.timeline, merged ? pull.merged_at : null),
    ...pushFacts(input, merged),
  };
}

/** The merging skill's verdict line, as ci-overview's `MARKER` (Git Crafter `github-reviews.mjs`). */
export const VERDICT = /^Review: (MERGE|BLOCK) at [0-9a-f]{40}$/;
/** Its optional second line: the reviewer's tokens. */
export const TOKENS = /^Tokens: ([\d,]+)$/;
/** Who can post one: a person with access to the private repository; bots are out. */
const VERDICT_AUTHORS = new Set(["OWNER", "MEMBER", "COLLABORATOR", "CONTRIBUTOR"]);

/** The verdicts among the comments, each with its tokens, or null without a `Tokens:` line. */
export function verdicts(comments: RawIssueComment[]): (number | null)[] {
  return comments.flatMap((c) => {
    if (c.user?.type !== "User" || !VERDICT_AUTHORS.has(c.author_association)) return [];
    const [first, second] = String(c.body ?? "").replace(/\r/g, "").split("\n");
    if (!VERDICT.test(first ?? "")) return [];
    const t = TOKENS.exec(second ?? "")?.[1];
    return [t === undefined ? null : Number(t.replace(/,/g, ""))];
  });
}

const QUEUE_EVENTS = new Set(["added_to_merge_queue", "removed_from_merge_queue"]);
/** How far from the merge the removal GitHub logs with it can fall. */
const MERGE_SLACK = 60000;

/**
 * The merge queue, from the timeline's added_to_merge_queue and removed_from_merge_queue events. Minutes run from each add
 * to the removal that ends it, or to the merge, summed, for a merged pull request. GitHub logs a removal with each merge, in
 * the same second and often listed after it, so the last queue event, a removal within a minute of the merge, is the merge.
 * Every other removal is an ejection. Nothing after the merge counts: a merged pull request can be queued again to no
 * effect. Both null if never queued before the merge.
 */
export function queueFacts(timeline: RawEvent[], mergedAt: string | null): Pick<PullFacts, "queue_minutes" | "queue_ejected"> {
  const end = mergedAt === null ? null : Date.parse(mergedAt);
  const events = timeline
    .filter((e) => e.created_at && QUEUE_EVENTS.has(e.event) && (end === null || Date.parse(e.created_at) <= end))
    .sort((a, b) => Date.parse(a.created_at!) - Date.parse(b.created_at!));
  if (!events.some((e) => e.event === "added_to_merge_queue")) return { queue_minutes: null, queue_ejected: null };
  const last = events[events.length - 1]!;
  const mergeRemoval = end !== null && last.event === "removed_from_merge_queue" && end - Date.parse(last.created_at!) <= MERGE_SLACK ? last : null;
  let since: number | null = null;
  let ms = 0;
  let ejected = false;
  for (const e of events) {
    const t = Date.parse(e.created_at!);
    if (e.event === "added_to_merge_queue") {
      since ??= t;
      continue;
    }
    if (since !== null) ms += t - since;
    since = null;
    if (e !== mergeRemoval) ejected = true;
  }
  // Still in the queue at the merge: its removal fell after it.
  if (end !== null && since !== null) ms += end - since;
  return { queue_minutes: end === null ? null : ms / 60000, queue_ejected: ejected };
}

/** Pushes, the final push's time to merge, review rounds and their tokens, and whether it was a stack layer. */
export function pushFacts(input: PullInput, merged: boolean): Pick<PullFacts, "ci_heads" | "final_push_minutes" | "verdicts" | "review_tokens" | "stacked"> {
  const onHead = input.runs.filter((r) => r.head_sha === input.pull.head.sha).map((r) => Date.parse(r.created_at));
  const v = verdicts(input.issueComments);
  return {
    ci_heads: new Set(input.runs.filter((r) => r.path === CI_WORKFLOW).map((r) => r.head_sha)).size,
    final_push_minutes: merged && onHead.length > 0 ? (Date.parse(input.pull.merged_at!) - Math.min(...onHead)) / 60000 : null,
    verdicts: v.length,
    review_tokens: v.filter((t): t is number => t !== null),
    stacked: input.stackBase || input.timeline.some((e) => e.event === "base_ref_changed"),
  };
}

/** One completed merge_group run: what testing a queue entry cost. */
export interface QueueRun {
  id: number;
  run_attempt: number;
  /** The pull request whose entry it tested, from main's `gh-readonly-queue/main/pr-<n>-<sha>` branch; null for any other. */
  pull: number | null;
  created_at: string;
  /** Job minutes over every attempt, each job rounded up to the minute as GitHub bills it; skipped jobs count 0. */
  minutes: number;
}

/** The pull request a merge_group run tested, from its branch name; null outside main's queue. */
export function queuePull(branch: string | null): number | null {
  const m = /^gh-readonly-queue\/main\/pr-(\d+)-/.exec(branch ?? "");
  return m ? Number(m[1]) : null;
}

/** Job minutes of a run, each job rounded up to the whole minute as GitHub bills it. A skipped job ran for none. */
export function jobMinutes(jobs: RawJob[]): number {
  return jobs.reduce((n, j) => {
    if (j.conclusion === "skipped" || !j.started_at || !j.completed_at) return n;
    return n + Math.ceil(Math.max(0, Date.parse(j.completed_at) - Date.parse(j.started_at)) / 60000);
  }, 0);
}

/** A commit on main within the window that no merged pull request produced. */
export interface DirectPush {
  sha: string;
  at: string;
}
