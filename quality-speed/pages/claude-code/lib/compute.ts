// Pure functions from a snapshot to the Claude Code page's measures. No reads
// here, so the tests can feed invented snapshots. A fact that could not be read
// makes its measure missing (value null); it never counts as a pass.

import { rerunAfterBlock } from "./reviews.ts";
import type { Fence, Measure, OpenIssue, Pull, PrFacts, Snapshot } from "./types.ts";

export const WINDOW_DAYS = 30;
export const MAX_PRS = 30;
const DAY = 86_400_000;
const EM_DASH = "\u2014";

const ms = (iso: string) => Date.parse(iso);
const pct = (part: number, whole: number) => (whole === 0 ? null : (100 * part) / whole);

class Unread extends Error {}

/** Runs a measure; any fact it needed that was not read makes it missing. */
function guarded(s: Snapshot, measure: () => Measure): Measure {
  try {
    return measure();
  } catch {
    return { value: null, sample: 0, source: null, time: s.takenAt };
  }
}

function need<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Unread();
  return value;
}

/** Nearest-rank percentile; null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
}

const inWindow = (iso: string | null, takenAt: string) => !!iso && ms(iso) >= ms(takenAt) - WINDOW_DAYS * DAY && ms(iso) <= ms(takenAt);

/** A merge into main in the window by a person or an agent, not a bot. */
export function isAgentMerge(p: Pull, takenAt: string): boolean {
  return p.baseRef === "main" && p.userType !== "Bot" && inWindow(p.mergedAt, takenAt);
}

/** The newest MAX_PRS agent merges whose facts were read, newest first: product, site and process maps alike. */
export function selectWindow(pulls: Pull[], facts: Record<string, PrFacts | null>, takenAt: string): number[] {
  return pulls
    .filter((p) => isAgentMerge(p, takenAt) && p.number in facts)
    .sort((a, b) => ms(b.mergedAt!) - ms(a.mergedAt!))
    .slice(0, MAX_PRS)
    .map((p) => p.number);
}

/** The window's merges, as the collector chose them. */
export function agentWindow(s: Snapshot): Pull[] {
  return s.window.map((n) => s.pulls.find((p) => p.number === n)).filter((p): p is Pull => !!p);
}

/**
 * Where the window starts: the oldest of its merges. Every other population
 * (bots' merges, unmerged pull requests, direct pushes) uses the same span, so
 * one event never outlives another of the same weight.
 */
export function spanStart(s: Snapshot): number {
  const merged = agentWindow(s).map((p) => ms(p.mergedAt!));
  return merged.length > 0 ? Math.min(...merged) : ms(s.takenAt) - WINDOW_DAYS * DAY;
}

const inSpan = (iso: string | null, s: Snapshot) => !!iso && ms(iso) >= spanStart(s) && ms(iso) <= ms(s.takenAt);

/** Bot merges into main in the span: an agent merged each one, so the merge-time rules apply. */
export function botMerges(s: Snapshot): Pull[] {
  return s.pulls.filter((p) => p.baseRef === "main" && p.userType === "Bot" && inSpan(p.mergedAt, s) && p.number in s.facts);
}

export function fenceEqual(a: Fence | null | undefined, b: Fence | null | undefined): boolean {
  return !!a && !!b && a.settings === b.settings && a.check === b.check && a.workflow === b.workflow && a.pin === b.pin;
}

/** 1 when a confinement run whose "Confinement check" step passed tested exactly the fence main has now; one sample, main's fence. */
export function fenceProven(s: Snapshot): Measure {
  return guarded(s, () => {
    const runs = need(s.confinementRuns);
    const main = need(s.fenceMain);
    const proof = runs
      .filter((r) => r.conclusion === "success" && fenceEqual(s.fenceAtRun[r.id], main))
      .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
      .find((r) => need(r.jobs).some((j) => j.steps.some((x) => x.name === "Confinement check" && x.conclusion === "success")));
    if (!proof) return { value: 0, sample: 1, source: null, time: s.takenAt };
    return { value: 1, sample: 1, source: proof.url, time: proof.createdAt };
  });
}

/**
 * The pull request template's Verified row holds the checks run and their results, its placeholder comment aside. Anthropic's
 * code review post (2026-10-15): Claude shows a check's output rather than claiming it is done.
 */
export function showsChecks(body: string): boolean {
  const text = body.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  const row = /^\|\s*\**Verified\**\s*\|(.*)\|\s*$/im.exec(text)?.[1] ?? "";
  return row.replaceAll("|", "").trim().length > 0;
}

/** The written rules a merge broke. Bots' merges answer only to the merge-time rules. Throws when a fact is unread. */
export function ruleBreaks(pr: Pull, f: PrFacts): string[] {
  const breaks: string[] = [];
  const bot = pr.userType === "Bot";
  if (!bot && !pr.headRef.startsWith("claude/")) breaks.push("branch");
  if (need(f.mainCommitParents) !== 1 || !need(f.mainCommitSubject).endsWith(`(#${pr.number})`)) breaks.push("squash");
  if (!bot) {
    const commits = need(f.commits);
    if (commits.length === 0 || commits.some((c) => !/^Signed-off-by: /m.test(c.message))) breaks.push("sign-off");
    if (commits.some((c) => !c.verified) || need(f.mainCommitVerified) !== true) breaks.push("signature");
    if ([pr.title, pr.body, ...commits.map((c) => c.message)].join("\n").includes(EM_DASH)) breaks.push("em-dash");
    if (!showsChecks(pr.body)) breaks.push("verified");
  }
  if (need(f.ciOk) !== "success") breaks.push("ci-ok");
  if (need(rerunAfterBlock(f))) breaks.push("rerun-after-block");
  return breaks;
}

/** Share of merges (agents' and bots') and direct pushes to main in the span that broke no written rule. */
export function ruleClean(s: Snapshot): Measure {
  return guarded(s, () => {
    const merges = [...agentWindow(s), ...botMerges(s)];
    const clean = merges.filter((p) => ruleBreaks(p, need(s.facts[p.number])).length === 0).length;
    const total = merges.length + need(s.directPushes).filter((c) => inSpan(c.at, s)).length;
    return { value: pct(clean, total), sample: total, source: null, time: s.takenAt };
  });
}

/** Repository paths and commands named in agent instruction files that do not exist. */
export function instructionBroken(s: Snapshot): Measure {
  return guarded(s, () => {
    const i = need(s.instructions);
    return { value: i.broken.length, sample: i.checked, source: null, time: s.takenAt };
  });
}

/** A session's line in a pull request's description, as session-line.ts writes it. */
const SESSION_LINE = /^Claude Code session ([0-9a-f]{8}): ([\d,]+) tokens, started (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/gm;

export interface SessionLine {
  session: string;
  tokens: number;
  started: string;
}

/** The session lines in a description. HTML comments and fenced code quote a line rather than report one, so they are skipped. */
export function sessionLines(body: string): SessionLine[] {
  const text = body.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?(?:-->|$)/g, " ").replace(/```[\s\S]*?(?:```|$)/g, " ");
  return [...text.matchAll(SESSION_LINE)].map((m) => ({ session: m[1]!, tokens: Number(m[2]!.replaceAll(",", "")), started: m[3]! }));
}

/**
 * Each merged pull request's Claude Code tokens and task start. A session's tokens are its highest count, split evenly over
 * the merged pull requests that carry its line, as Git Crafter's claude.tokens_per_merged_pr splits them; its start is its
 * earliest. A pull request several sessions worked on adds up their shares and starts at the first.
 */
export function sessionWork(s: Snapshot): Map<number, { tokens: number; started: string }> {
  const sessions = new Map<string, { tokens: number; started: string; prs: Set<number> }>();
  for (const p of s.pulls.filter((x) => x.mergedAt && x.baseRef === "main")) {
    for (const line of sessionLines(p.body)) {
      const e = sessions.get(line.session) ?? { tokens: 0, started: line.started, prs: new Set<number>() };
      e.tokens = Math.max(e.tokens, line.tokens);
      if (ms(line.started) < ms(e.started)) e.started = line.started;
      e.prs.add(p.number);
      sessions.set(line.session, e);
    }
  }
  const out = new Map<number, { tokens: number; started: string }>();
  for (const e of sessions.values()) {
    for (const n of e.prs) {
      const w = out.get(n) ?? { tokens: 0, started: e.started };
      w.tokens += e.tokens / e.prs.size;
      if (ms(e.started) < ms(w.started)) w.started = e.started;
      out.set(n, w);
    }
  }
  return out;
}

/** Mean Claude Code tokens per merged change, over the window's merges that carry a session line. */
export function tokensPerMergedChange(s: Snapshot): Measure {
  const work = sessionWork(s);
  const tokens = agentWindow(s).flatMap((p) => (work.has(p.number) ? [work.get(p.number)!.tokens] : []));
  const value = tokens.length === 0 ? null : Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length);
  return { value, sample: tokens.length, source: null, time: s.takenAt };
}

/**
 * Hours from each window merge's task start to its merge. The start is the earliest of its session lines' starts and its
 * commits' author times, so a merge without a line still counts. Throws when a merge's commits are unread.
 */
function taskHours(s: Snapshot): number[] {
  const work = sessionWork(s);
  return agentWindow(s).flatMap((p) => {
    const starts = need(need(s.facts[p.number]).commits).map((c) => ms(c.authorDate));
    const line = work.get(p.number);
    if (line) starts.push(ms(line.started));
    const hours = starts.length === 0 ? -1 : (ms(p.mergedAt!) - Math.min(...starts)) / 3_600_000;
    return hours >= 0 ? [hours] : [];
  });
}

const taskToMerge = (p: number) => (s: Snapshot): Measure =>
  guarded(s, () => {
    const hours = taskHours(s);
    return { value: percentile(hours, p), sample: hours.length, source: null, time: s.takenAt };
  });

const SEVERITY = /^Severity:/m;
const LANDED = /^Landed:\s*(.*)$/m;

/** A bug a merge shipped: filed with Severity and Landed lines, its Landed line naming a pull request or a commit, not "not yet". */
export function isShippedBug(i: OpenIssue): boolean {
  const landed = LANDED.exec(i.body)?.[1]?.trim() ?? "";
  if (!SEVERITY.test(i.body) || i.labels.includes("enhancement") || /^not\b/i.test(landed)) return false;
  return /#\d+\b/.test(landed) || /\b[0-9a-f]{7,40}\b/.test(landed);
}

/** Open bugs a merged change shipped: a state, so fixing them moves it at once, with no window to wait out (#846). */
export function shippedBugsOpen(s: Snapshot): Measure {
  return guarded(s, () => {
    const issues = need(s.openIssues);
    return { value: issues.filter(isShippedBug).length, sample: issues.length, source: null, time: s.takenAt };
  });
}

/** The lane's job minutes, which the snapshot can't hold: missing here, and collect.ts puts core/lane's laneRecord() in its place. */
export function laneMinutes(s: Snapshot): Measure {
  return { value: null, sample: 0, source: null, time: s.takenAt };
}

export const MEASURES: Record<string, (s: Snapshot) => Measure> = {
  fence_proven: fenceProven,
  shipped_bugs_open: shippedBugsOpen,
  rule_clean: ruleClean,
  instruction_broken: instructionBroken,
  task_to_merge_p50: taskToMerge(50),
  task_to_merge_p90: taskToMerge(90),
  tokens_per_merged_change: tokensPerMergedChange,
  lane_minutes: laneMinutes,
};

