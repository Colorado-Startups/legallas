// SPDX-License-Identifier: Apache-2.0
// Delivery metrics from merged history (PLAN.md, "Metrics"). Pure functions over GitHub REST shapes, so the tests run on
// invented history and the planted drill runs on live history through the same code. A pull request's title and body are
// read here, in memory, only to find the numbers it references; no text leaves this module.

export const REPO_FULL = 'Colorado-Startups/legallas';
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
/** Every metric looks back this far. */
export const WINDOW_DAYS = 28;
/** A change repaired within this many days of its merge counts as failed, and its failure rate waits this long. */
export const REPAIR_DAYS = 7;
/** How far back per-change facts are fetched: the failure rate's matured window ends REPAIR_DAYS ago. */
export const FETCH_DAYS = WINDOW_DAYS + REPAIR_DAYS;
/** A merge younger than this may still have its CI run in progress, so the coverage check skips it. */
export const CI_GRACE_MS = 2 * HOUR_MS;
/** The workflow whose run on each push to main says whether that change broke main. */
export const CI_WORKFLOW_PATH = '.github/workflows/ci.yml';
const RED = new Set(['failure', 'timed_out', 'startup_failure']);
const DECIDED = new Set([...RED, 'success']);

/** The fields read from GET /repos/{owner}/{repo}/pulls. */
export interface RawPull {
  number: number;
  title: string;
  body: string | null;
  created_at: string;
  merged_at: string | null;
  merge_commit_sha: string | null;
  base: { ref: string };
  head: { ref: string };
  user: { type: string; login: string } | null;
}

/** The fields read from GET /repos/{owner}/{repo}/actions/runs. */
export interface RawRun {
  id: number;
  path: string;
  event: string;
  head_branch: string | null;
  head_sha: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
}

/** What one more call per pull request adds: its earliest commit time and the paths it changed. */
export interface PullFacts {
  firstCommitAt: string | null;
  files: string[];
}

export interface History {
  /** Every pull request, any state. Only numbers, dates, refs and the user are kept past parsing. */
  pulls: RawPull[];
  /** Facts for each merged pull request inside FETCH_DAYS. */
  facts: Map<number, PullFacts>;
  /** CI runs on pushes to main inside FETCH_DAYS, plus a margin. */
  runs: RawRun[];
  /** Numbers that are issues, not pull requests. */
  issues: Set<number>;
  /** Issues labelled `bug`. */
  bugIssues: Set<number>;
}

/** The reviewed list in reviewed.json: numbers and one date, signed off with the metric list. */
export interface Reviewed {
  /** The day every merged pull request up to it was read for repairs. Older than REVIEW_DAYS fails the drill. */
  reviewed_through: string;
  /** Real repairs, each to an earlier merged pull request, that the detector must find (the drill's recall check). */
  repairs: { pr: number; repairs: number }[];
  /** Issues that order or track the backlog rather than describe work, so naming them ties nothing. */
  not_backlog_issues: number[];
  /** The project number of the org's Legallas board, where features live (`CLAUDE.md`). Null until it exists: no card ties. */
  backlog_board: number | null;
}

/** Dependabot's updates follow its own schedule, not the backlog. */
export const DEPENDABOT = 'dependabot[bot]';

/** This site's own folder and workflow (MASTER-PLAN, "How scoring works"). */
export function isSitePath(file: string): boolean {
  return file.startsWith('quality-speed/') || /^\.github\/workflows\/quality-speed[\w.-]*\.ya?ml$/.test(file);
}

/** Files outside the site's folder that the site's own rollout also edits: CI areas, labels, review rules and docs. */
const SHARED_WITH_SITE = new Set([
  '.github/scripts/changed-paths.sh',
  '.github/workflows/ci.yml',
  '.github/workflows/claude-review.yml',
  '.github/labeler.yml',
  '.github/dependabot.yml',
  '.gitignore',
  'REVIEW.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
]);

/**
 * This site's own work: it touches the site's folder or a site workflow, every other file is on the shared list, and it
 * repairs no change that counts. A pull request that also changes the product counts like any other change, and so does
 * a site-only one that repairs a counted change; a site follow-up to site work does not.
 */
export function isSiteWork(files: string[], repairsCounted: boolean): boolean {
  return files.some(isSitePath) && files.every((f) => isSitePath(f) || SHARED_WITH_SITE.has(f)) && !repairsCounted;
}

const REF = String.raw`(?:${REPO_FULL}#|https://github\.com/${REPO_FULL}/(?:pull|issues)/|#)(\d+)\b`;
/** Words that say a change repairs an earlier one, directly before its number: "Reverts #12", "A follow-up to #12". */
const REPAIR_WORDS = String.raw`\b(?:revert(?:s|ed|ing)?|fix(?:es|ed|ing)?(?:\s+(?:for|to|on))?|hotfix(?:es)?(?:\s+for)?|follow(?:s|ed|ing)?(?:[- ]?ups?)?(?:\s+(?:to|on|for))?|repairs?(?:\s+for)?|corrects?)`;
const REF_RE = new RegExp(String.raw`(?<![\w/&.-])${REF}`, 'gi');
const REPAIR_RE = new RegExp(String.raw`${REPAIR_WORDS}:?\s+(?:(?:the\s+)?(?:PR|pull request)\s+)?${REF}`, 'gi');
/** "The same two fixes as #56": a change carrying fixes already made elsewhere. */
const SAME_FIX_RE = new RegExp(String.raw`\bsame\s+(?:\w+\s+)?fix(?:es)?\s+as\s+${REF}`, 'gi');
/** A sentence that calls itself a follow-up repairs the earlier change it names: "it would come in a follow-up". */
const FOLLOW_UP = /\bfollow[- ]?ups?\b/i;
/** GitHub's closing keywords, and the template's "Issue:" line, tie a change to an issue. */
const CLOSES_RE = new RegExp(String.raw`\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?):?\s+${REF}`, 'gi');
const ISSUE_LINE = /^[\s>*-]*Issue:(.*)$/gim;
/** A card on one of the org's Project boards; the number captured is the board's. */
const BOARD_CARD = /https:\/\/github\.com\/orgs\/Colorado-Startups\/projects\/(\d+)(?:\/views\/\d+)?\?\S*\bitemId=\d+/gi;
/** The template's "Repairs: a bug" line: a bug fix with no earlier pull request to name. */
const REPAIRS_BUG = /^[\s>*-]*Repairs:\s*(?:an?\s+)?bug\b/im;
/** GitHub's own revert button names the branch revert-<number>-<branch>. */
const REVERT_BRANCH = /^revert-(\d+)-/;
const REVERTS_COMMIT = /\bThis reverts commit ([0-9a-f]{40})\b/gi;

/** Removes HTML comments and fenced code, which hold template hints and pasted output rather than references. */
function prose(pull: RawPull): string {
  const body = (pull.body ?? '').replace(/<!--[\s\S]*?(?:-->|$)/g, ' ').replace(/```[\s\S]*?(?:```|$)/g, ' ');
  return `${pull.title}\n${body}`;
}

function numbers(text: string, re: RegExp): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(re)) out.add(Number(m[1]));
  return [...out];
}

export interface References {
  /** Every number referenced. */
  refs: number[];
  /** Numbers it says it repairs, reverts or follows up on. Which of them are merged pull requests is checked later. */
  repairs: number[];
  /** Numbers after a closing keyword or on its "Issue:" line. Which of them are issues is checked later. */
  closes: number[];
  /** Boards whose cards its "Issue:" line links, by project number. Which board is the backlog is checked later. */
  boardCards: number[];
  /** It says "Repairs: a bug". */
  repairsBug: boolean;
  revertsShas: string[];
}

/** What a pull request's title, body and branch say about the work it links to. */
export function references(pull: RawPull): References {
  const text = prose(pull);
  const repairs = new Set([...numbers(text, REPAIR_RE), ...numbers(text, SAME_FIX_RE)]);
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (FOLLOW_UP.test(sentence)) for (const n of numbers(sentence, REF_RE)) repairs.add(n);
  }
  const branch = REVERT_BRANCH.exec(pull.head.ref);
  if (branch) repairs.add(Number(branch[1]));
  const closes = new Set(numbers(text, CLOSES_RE));
  const boardCards = new Set<number>();
  for (const line of text.matchAll(ISSUE_LINE)) {
    for (const n of numbers(line[1] ?? '', REF_RE)) closes.add(n);
    for (const n of numbers(line[1] ?? '', BOARD_CARD)) boardCards.add(n);
  }
  const self = (n: number) => n !== pull.number;
  return {
    refs: numbers(text, REF_RE).filter(self),
    repairs: [...repairs].filter(self),
    closes: [...closes].filter(self),
    boardCards: [...boardCards],
    repairsBug: REPAIRS_BUG.test(text),
    revertsShas: [...text.matchAll(REVERTS_COMMIT)].map((m) => (m[1] ?? '').toLowerCase()),
  };
}

const ms = (iso: string) => Date.parse(iso);

/** A pull request merged into main: the repository's equivalent of a deployment (PLAN.md, "Ideal state"). */
export interface Change {
  number: number;
  mergedAt: number;
  /** The earlier of its first commit and its opening. */
  startedAt: number;
  mergeSha: string;
  /** Opened by Dependabot. */
  dependabot: boolean;
  /** Earlier merged pull requests (into any branch) it repairs, reverts or follows up on. */
  repairs: number[];
  /** It closes an issue labelled `bug`, or says "Repairs: a bug". */
  bugFix: boolean;
  /** Tied to the backlog: an issue by a closing keyword or its "Issue:" line, a Legallas board card on that line, or by repairing a change that is. */
  tied: boolean;
}

/** Unplanned work: rework, as the 2024 State of DevOps report defines it (p. 11). */
export const isRework = (c: Change) => c.repairs.length > 0 || c.bugFix;

export interface Failure {
  number: number;
  mergedAt: number;
  byRepair: boolean;
  byCi: boolean;
  /** When main was whole again, or null while it is still open. */
  recoveredAt: number | null;
}

export interface Analysis {
  now: number;
  /** Merged into main inside FETCH_DAYS, this site's own work left out, oldest first. */
  changes: Change[];
  /** Merged into main inside FETCH_DAYS but left out as this site's own work. */
  excluded: number[];
  /** What every merged pull request, of any age and into any branch, repairs: the recall check reads this. */
  repairsOf: Map<number, number[]>;
  failures: Failure[];
  /** Changes merged at least CI_GRACE_MS ago with no CI result on main for them or after them. */
  ciUnresolved: number[];
  /** The first day (UTC midnight) with a change on main. */
  firstMergeDay: number | null;
}

type Merged = RawPull & { merged_at: string; merge_commit_sha: string };
const isMerged = (pull: RawPull): pull is Merged => pull.merged_at !== null && pull.merge_commit_sha !== null;

/** The reviewed list must be refreshed this often, or the drill fails. */
export const REVIEW_DAYS = 35;

export const NO_REVIEW: Reviewed = { reviewed_through: '2031-03-20', repairs: [], not_backlog_issues: [], backlog_board: null };

export function analyze(history: History, now: number, reviewed: Reviewed = NO_REVIEW): Analysis {
  const merged = history.pulls.filter(isMerged).sort((a, b) => ms(a.merged_at) - ms(b.merged_at));
  const toMain = merged.filter((p) => p.base.ref === 'main');
  const mergedAtOf = new Map(merged.map((p) => [p.number, ms(p.merged_at)]));
  const numberOfSha = new Map(merged.map((p) => [p.merge_commit_sha.toLowerCase(), p.number]));
  const backlog = (n: number) => history.issues.has(n) && !reviewed.not_backlog_issues.includes(n);

  // Every merged pull request's links, oldest first, so a repaired one is always settled before its repair.
  const repairsOf = new Map<number, number[]>();
  const tiedOf = new Map<number, boolean>();
  const linked = new Map<number, References>();
  for (const pull of merged) {
    const refs = references(pull);
    linked.set(pull.number, refs);
    const mergedAt = ms(pull.merged_at);
    const targets = new Set(refs.repairs);
    for (const sha of refs.revertsShas) {
      const n = numberOfSha.get(sha);
      if (n !== undefined) targets.add(n);
    }
    const valid = [...targets].filter((n) => (mergedAtOf.get(n) ?? Infinity) < mergedAt).sort((a, b) => a - b);
    repairsOf.set(pull.number, valid);
    const card = reviewed.backlog_board !== null && refs.boardCards.includes(reviewed.backlog_board);
    tiedOf.set(pull.number, refs.closes.some(backlog) || card || valid.some((n) => tiedOf.get(n) === true));
  }

  const since = now - FETCH_DAYS * DAY_MS;
  const changes: Change[] = [];
  const excluded: number[] = [];
  const counted = new Set<number>();
  for (const pull of toMain) {
    const mergedAt = ms(pull.merged_at);
    if (mergedAt < since || mergedAt > now) continue;
    const facts = history.facts.get(pull.number);
    if (!facts) throw new Error(`no facts for merged pull request ${pull.number}`);
    const refs = linked.get(pull.number) as References;
    const repairs = repairsOf.get(pull.number) ?? [];
    // Oldest first, so whether each repaired change counts is already settled.
    if (isSiteWork(facts.files, repairs.some((n) => counted.has(n)))) {
      excluded.push(pull.number);
      continue;
    }
    const opened = ms(pull.created_at);
    changes.push({
      number: pull.number,
      mergedAt,
      startedAt: facts.firstCommitAt === null ? opened : Math.min(opened, ms(facts.firstCommitAt)),
      mergeSha: pull.merge_commit_sha.toLowerCase(),
      dependabot: pull.user?.login === DEPENDABOT,
      repairs,
      bugFix: refs.repairsBug || refs.closes.some((n) => history.bugIssues.has(n)),
      tied: tiedOf.get(pull.number) ?? false,
    });
    counted.add(pull.number);
  }

  const ciRuns = history.runs
    .filter((r) => r.path.split('@')[0] === CI_WORKFLOW_PATH && r.event === 'push' && r.head_branch === 'main')
    .sort((a, b) => ms(a.created_at) - ms(b.created_at) || a.id - b.id);
  const runOf = new Map<string, RawRun>();
  for (const run of ciRuns) runOf.set(run.head_sha.toLowerCase(), run); // the latest run for a commit wins

  const failures: Failure[] = [];
  for (const change of changes) {
    const repairsOfIt = changes.filter(
      (c) => c.repairs.includes(change.number) && c.mergedAt - change.mergedAt <= REPAIR_DAYS * DAY_MS,
    );
    const run = runOf.get(change.mergeSha);
    const byCi = run !== undefined && run.status === 'completed' && RED.has(run.conclusion ?? '');
    if (repairsOfIt.length === 0 && !byCi) continue;
    const ends: number[] = repairsOfIt.map((c) => c.mergedAt);
    if (byCi && run) {
      const green = ciRuns.find(
        (r) => ms(r.created_at) > ms(run.created_at) && r.status === 'completed' && r.conclusion === 'success',
      );
      if (green) ends.push(ms(green.updated_at));
    }
    const recoveredAt = ends.length ? Math.min(...ends) : null;
    failures.push({
      number: change.number,
      mergedAt: change.mergedAt,
      byRepair: repairsOfIt.length > 0,
      byCi,
      recoveredAt: recoveredAt !== null && recoveredAt <= now ? recoveredAt : null,
    });
  }

  const ciUnresolved = changes
    .filter((c) => c.mergedAt <= now - CI_GRACE_MS)
    .filter((c) => {
      const own = runOf.get(c.mergeSha);
      if (own && own.status === 'completed' && DECIDED.has(own.conclusion ?? '')) return false;
      return !ciRuns.some(
        (r) => ms(r.created_at) >= c.mergedAt && r.status === 'completed' && DECIDED.has(r.conclusion ?? ''),
      );
    })
    .map((c) => c.number);

  const first = toMain[0];
  return {
    now,
    changes,
    excluded,
    repairsOf,
    failures,
    ciUnresolved,
    firstMergeDay: first ? Math.floor(ms(first.merged_at) / DAY_MS) * DAY_MS : null,
  };
}

/** A measured value, or why there is none. */
export type Reading = { value: number; samples: number } | { value: null; samples: number };

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] as number;
  return sorted.length % 2 ? hi : ((sorted[mid - 1] as number) + hi) / 2;
}

/** Rounds for display and stable tests: hours to 3 places, percents and rates to 2. */
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

const inWindow = (a: Analysis) => a.changes.filter((c) => c.mergedAt >= a.now - WINDOW_DAYS * DAY_MS);

/** Days with at least one change, per week, over the last WINDOW_DAYS completed UTC days. Samples are days observed. */
export function changeFrequency(a: Analysis): Reading {
  const today = Math.floor(a.now / DAY_MS) * DAY_MS;
  if (a.firstMergeDay === null) return { value: null, samples: 0 };
  const start = Math.max(today - WINDOW_DAYS * DAY_MS, a.firstMergeDay);
  const days = Math.round((today - start) / DAY_MS);
  if (days <= 0) return { value: null, samples: 0 };
  const active = new Set(
    a.changes.filter((c) => c.mergedAt >= start && c.mergedAt < today).map((c) => Math.floor(c.mergedAt / DAY_MS)),
  );
  return { value: round((active.size / days) * 7, 2), samples: days };
}

/** Median hours from a change's first commit (or its opening, if earlier) to its merge into main. */
export function leadTime(a: Analysis): Reading {
  const hours = inWindow(a).map((c) => (c.mergedAt - c.startedAt) / HOUR_MS);
  const m = median(hours);
  return m === null ? { value: null, samples: 0 } : { value: round(m, 3), samples: hours.length };
}

/** Percent of matured changes (merged REPAIR_DAYS to FETCH_DAYS ago) that needed a repair or broke main. */
export function changeFailureRate(a: Analysis): Reading {
  const from = a.now - FETCH_DAYS * DAY_MS;
  const to = a.now - REPAIR_DAYS * DAY_MS;
  const matured = a.changes.filter((c) => c.mergedAt >= from && c.mergedAt < to);
  if (matured.length === 0) return { value: null, samples: 0 };
  const failed = new Set(a.failures.map((f) => f.number));
  const n = matured.filter((c) => failed.has(c.number)).length;
  return { value: round((n / matured.length) * 100, 2), samples: matured.length };
}

/** Percent of changes in the window that are unplanned: repairing, reverting or following up on an earlier change, or fixing a bug. */
export function reworkRate(a: Analysis): Reading {
  const recent = inWindow(a);
  if (recent.length === 0) return { value: null, samples: 0 };
  const n = recent.filter(isRework).length;
  return { value: round((n / recent.length) * 100, 2), samples: recent.length };
}

/**
 * Median hours from a failed change's merge to main being whole again, over recoveries inside the window. A failure still
 * open counts at its age so far, so a main that stays red can never read as "no events".
 */
export function recoveryTime(a: Analysis): Reading {
  const start = a.now - WINDOW_DAYS * DAY_MS;
  const hours = a.failures
    .filter((f) => f.recoveredAt === null || f.recoveredAt >= start)
    .map((f) => ((f.recoveredAt ?? a.now) - f.mergedAt) / HOUR_MS);
  const m = median(hours);
  return m === null ? { value: null, samples: 0 } : { value: round(m, 3), samples: hours.length };
}

/** Percent of changes in the window tied to the backlog (an issue or a board card), Dependabot's left out. */
export function mergesTiedToIssue(a: Analysis): Reading {
  const people = inWindow(a).filter((c) => !c.dependabot);
  if (people.length === 0) return { value: null, samples: 0 };
  const n = people.filter((c) => c.tied).length;
  return { value: round((n / people.length) * 100, 2), samples: people.length };
}
