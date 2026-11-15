// Reads the Claude Code snapshot from GitHub's REST API and the local checkout. Each
// fact is read on its own: one that fails becomes null, and only the measures
// that need it go missing. `asOf` replays the repository as it stood at a past
// moment (pull requests, runs, main and its instruction files), so a baseline
// can be read again later.

import type { Api } from "./github.ts";
import { MAX_PRS, WINDOW_DAYS, isAgentMerge, selectWindow } from "./compute.ts";
import { git, parentCount, subject } from "./git.ts";
import { checkInstructions } from "./instructions.ts";
import { REVIEW_WORKFLOW, isBlockingComment } from "./reviews.ts";
import type { Fence, Job, OpenIssue, Pull, PrFacts, Run, Snapshot } from "./types.ts";

type Json = Record<string, any>;
const ms = (iso: string) => Date.parse(iso);
const DAY = 86_400_000;
const REVIEW_BOT = "claude[bot]";

const EMPTY: PrFacts = {
  commits: null, ciOk: null, mainCommitVerified: null, mainCommitSubject: null,
  mainCommitParents: null, runs: null, blockingAt: null,
};

function toPull(p: Json, asOf: string): Pull {
  const at = (iso: string | null) => (iso && ms(iso) <= ms(asOf) ? iso : null);
  const mergedAt = at(p.merged_at);
  return {
    number: p.number, title: p.title ?? "", body: p.body ?? "", userType: p.user?.type ?? "",
    headRef: p.head?.ref ?? "", headSha: p.head?.sha ?? "", baseRef: p.base?.ref ?? "",
    createdAt: p.created_at, closedAt: at(p.closed_at), mergedAt, mergeSha: mergedAt ? p.merge_commit_sha : null,
  };
}

function toJob(j: Json): Job {
  return {
    name: j.name ?? "", runAttempt: j.run_attempt ?? 1, labels: j.labels ?? [], startedAt: j.started_at ?? null,
    completedAt: j.completed_at ?? null, conclusion: j.conclusion ?? null,
    steps: (j.steps ?? []).map((x: Json) => ({ name: x.name, conclusion: x.conclusion ?? null })),
  };
}

const verdictFailed = (runs: Run[]) =>
  runs.some((r) => r.workflow === REVIEW_WORKFLOW && (r.jobs ?? []).some((j) => j.steps.some((x) => x.name === "Verdict" && x.conclusion === "failure")));

export class Reader {
  readonly errors: string[] = [];
  private jobCache = new Map<number, Job[]>();
  private api: Api;
  private repo: string;
  private repoDir: string;
  private asOf: string;

  constructor(api: Api, repo: string, repoDir: string, asOf: string) {
    this.api = api;
    this.repo = repo;
    this.repoDir = repoDir;
    this.asOf = asOf;
  }

  /** A fact, or null with the reason kept for the run's log. */
  async attempt<T>(read: () => Promise<T> | T): Promise<T | null> {
    try {
      return await read();
    } catch (e) {
      this.errors.push(String((e as Error).message ?? e));
      return null;
    }
  }

  private r(path: string) {
    return `/repos/${this.repo}${path}`;
  }

  private async jobs(runId: number): Promise<Job[]> {
    const hit = this.jobCache.get(runId);
    if (hit) return hit;
    const jobs = (await this.api.list(this.r(`/actions/runs/${runId}/jobs?filter=all`), { key: "jobs" })).map((j) => toJob(j as Json));
    this.jobCache.set(runId, jobs);
    return jobs;
  }

  /** Runs as of asOf, each with every attempt's jobs (null when they could not be read). */
  async toRuns(raw: Json[]): Promise<Run[]> {
    const out: Run[] = [];
    for (const r of raw.filter((x) => ms(x.created_at) <= ms(this.asOf))) {
      const done = r.status === "completed" && ms(r.updated_at) <= ms(this.asOf);
      const jobs = done && r.conclusion !== "skipped" ? await this.attempt(() => this.jobs(r.id)) : [];
      out.push({
        id: r.id, workflow: r.name ?? "", headBranch: r.head_branch ?? "", headSha: r.head_sha ?? "", createdAt: r.created_at,
        updatedAt: r.updated_at, status: done ? "completed" : "in_progress", conclusion: done ? (r.conclusion ?? null) : null,
        url: r.html_url ?? "", jobs,
      });
    }
    return out;
  }

  /** Pull requests updated since the window opened, newest first: every merge in it was updated then. */
  async pulls(since: string): Promise<Pull[]> {
    const raw = (await this.api.list(this.r("/pulls?state=all&sort=updated&direction=desc"), {
      stop: (last) => ms((last as Json).updated_at) < ms(since),
    })) as Json[];
    return raw.filter((p) => ms(p.created_at) <= ms(this.asOf)).map((p) => toPull(p, this.asOf));
  }

  /** Issues open at asOf: open now and created by then, or closed after it. Pull requests left out. */
  async openIssues(): Promise<OpenIssue[]> {
    const open = (await this.api.list(this.r("/issues?state=open"))) as Json[];
    const closedSince = (await this.api.list(this.r(`/issues?state=closed&since=${encodeURIComponent(this.asOf)}`))) as Json[];
    return [...open, ...closedSince.filter((i) => i.closed_at && ms(i.closed_at) > ms(this.asOf))]
      .filter((i) => !i.pull_request && ms(i.created_at) <= ms(this.asOf))
      .map((i) => ({ number: i.number, body: i.body ?? "", labels: (i.labels ?? []).map((l: Json) => String(l.name ?? "")) }));
  }

  async commits(n: number) {
    return (await this.api.list(this.r(`/pulls/${n}/commits`))).map((c: any) => ({
      sha: c.sha as string, message: (c.commit?.message ?? "") as string, authorDate: c.commit?.author?.date as string,
      verified: c.commit?.verification?.verified === true,
    }));
  }

  /** Every run on the branch while the pull request was open. */
  async runs(pr: Pull): Promise<Run[]> {
    const raw = (await this.api.list(this.r(`/actions/runs?branch=${encodeURIComponent(pr.headRef)}`), { key: "workflow_runs", cap: 1000 })) as Json[];
    const open = ms(pr.createdAt) - 60_000;
    const close = ms(pr.mergedAt ?? pr.closedAt ?? this.asOf) + 60_000;
    return this.toRuns(raw.filter((r) => ms(r.created_at) >= open && ms(r.created_at) <= close));
  }

  /** When the review bot posted a comment carrying "Blocking:", inline or as its summary. */
  async blockingAt(n: number): Promise<string[]> {
    const inline = (await this.api.list(this.r(`/pulls/${n}/comments`))) as Json[];
    const summary = (await this.api.list(this.r(`/issues/${n}/comments`))) as Json[];
    return [...inline, ...summary]
      .filter((c) => c.user?.login === REVIEW_BOT && isBlockingComment(String(c.body ?? "")) && ms(c.created_at) <= ms(this.asOf))
      .map((c) => c.created_at as string);
  }

  /** What the merge looked like on main: ci-ok, its commit's signature and shape. The merge queue tests a head merged onto main, so how far it was behind is no rule. */
  async merge(pr: Pull, f: PrFacts): Promise<void> {
    const sha = pr.mergeSha!;
    f.ciOk = await this.attempt(async () => {
      const body = (await this.api.get(this.r(`/commits/${pr.headSha}/check-runs?check_name=ci-ok&filter=latest`))) as Json;
      return (body.check_runs?.[0]?.conclusion as string | undefined) ?? "absent";
    });
    f.mainCommitVerified = await this.attempt(async () => ((await this.api.get(this.r(`/commits/${sha}`))) as Json).commit?.verification?.verified === true);
    f.mainCommitSubject = await this.attempt(() => subject(this.repoDir, sha));
    f.mainCommitParents = await this.attempt(() => parentCount(this.repoDir, sha));
  }

  /** The review bot's Blocking comments, read only when a review attempt's Verdict step failed. */
  async blockingIfNeeded(n: number, f: PrFacts): Promise<void> {
    if (!f.runs) return;
    f.blockingAt = verdictFailed(f.runs) ? await this.attempt(() => this.blockingAt(n)) : [];
  }

  /** Blob shas of the fence files and the claude-code-action pin, at a commit. claude.yml is the one workflow that runs it since #555. */
  async fence(ref: string): Promise<Fence> {
    const get = async (path: string) => (await this.api.get(this.r(`/contents/${path}?ref=${ref}`))) as Json;
    const pins = new Set<string>();
    const text = Buffer.from((await get(".github/workflows/claude.yml")).content ?? "", "base64").toString("utf8");
    for (const m of text.matchAll(/anthropics\/claude-code-action@([0-9a-f]{40})/g)) pins.add(m[1]!);
    return {
      settings: (await get(".github/scripts/claude-settings.sh")).sha, check: (await get(".github/scripts/claude-confinement-check.sh")).sha,
      workflow: (await get(".github/workflows/claude-confinement.yml")).sha, pin: [...pins].sort().join(","),
    };
  }

  /** A workflow's runs since a date, newest first, at most `cap` as of asOf. */
  async workflowRuns(file: string, since: string, cap: number): Promise<Run[]> {
    const raw = (await this.api.list(this.r(`/actions/workflows/${file}/runs?created=%3E%3D${since.slice(0, 10)}`), { key: "workflow_runs", cap: cap + 100, sample: true })) as Json[];
    return this.toRuns(raw.filter((r) => ms(r.created_at) <= ms(this.asOf)).slice(0, cap));
  }

  mainAt(): string {
    return git(this.repoDir, ["rev-list", "-1", `--before=${this.asOf}`, "--first-parent", "origin/main"]).trim()
      || git(this.repoDir, ["rev-parse", "HEAD"]).trim();
  }

  /** First-parent commits on main since a time, with commit times, leaving out the root commit, which no pull request can make. */
  mainCommitsSince(since: string, until: string): { sha: string; at: string }[] {
    return git(this.repoDir, ["log", "--first-parent", "--format=%H %cI %P", `--since=${since}`, until])
      .split("\n").map((l) => l.trim().split(/\s+/)).filter((f) => f.length > 2)
      .map((f) => ({ sha: f[0]!, at: new Date(f[1]!).toISOString().replace(/\.\d+Z$/, "Z") }));
  }
}

/** Facts for the window's agent merges: the newest MAX_PRS, the site's own included. */
async function readAgentMerges(rd: Reader, pulls: Pull[], asOf: string, facts: Record<string, PrFacts | null>) {
  const merges = pulls.filter((p) => isAgentMerge(p, asOf)).sort((a, b) => ms(b.mergedAt!) - ms(a.mergedAt!)).slice(0, MAX_PRS);
  for (const pr of merges) {
    const f: PrFacts = { ...EMPTY, commits: await rd.attempt(() => rd.commits(pr.number)) };
    facts[pr.number] = f;
    f.runs = await rd.attempt(() => rd.runs(pr));
    await rd.merge(pr, f);
    await rd.blockingIfNeeded(pr.number, f);
  }
}

/** Bot merges in the window: an agent merged them, so the merge-time rules apply. */
async function readBots(rd: Reader, pulls: Pull[], since: string, facts: Record<string, PrFacts | null>) {
  for (const pr of pulls.filter((p) => p.baseRef === "main" && p.userType === "Bot" && !!p.mergedAt && ms(p.mergedAt) >= ms(since))) {
    const f: PrFacts = { ...EMPTY, runs: await rd.attempt(() => rd.runs(pr)) };
    await rd.merge(pr, f);
    await rd.blockingIfNeeded(pr.number, f);
    facts[pr.number] = f;
  }
}

export async function readSnapshot(api: Api, repo: string, repoDir: string, asOf: string): Promise<{ snapshot: Snapshot; errors: string[] }> {
  const rd = new Reader(api, repo, repoDir, asOf);
  const since = new Date(ms(asOf) - WINDOW_DAYS * DAY).toISOString();
  const pulls = await rd.pulls(since);
  const facts: Record<string, PrFacts | null> = {};
  await readAgentMerges(rd, pulls, asOf, facts);
  const window = selectWindow(pulls, facts, asOf);
  await readBots(rd, pulls, since, facts);

  const confinementRuns = await rd.attempt(() => rd.workflowRuns("claude-confinement.yml", "2000-01-01", 50));
  const fenceAtRun: Record<string, Fence | null> = {};
  for (const r of (confinementRuns ?? []).filter((x) => x.conclusion === "success").slice(0, 5)) {
    fenceAtRun[r.id] = await rd.attempt(() => rd.fence(r.headSha));
  }
  const mainSha = rd.mainAt();
  const fenceMain = await rd.attempt(() => rd.fence(mainSha));
  const merged = new Set(pulls.filter((p) => p.mergeSha).map((p) => p.mergeSha!));
  const directPushes = await rd.attempt(() => rd.mainCommitsSince(since, mainSha).filter((c) => !merged.has(c.sha)));
  const instructions = await rd.attempt(() => checkInstructions(repoDir, mainSha));
  const openIssues = await rd.attempt(() => rd.openIssues());

  const snapshot: Snapshot = {
    repo, takenAt: asOf, mainSha, pulls, window, facts, confinementRuns, fenceMain, fenceAtRun, directPushes, instructions, openIssues,
  };
  return { snapshot, errors: rd.errors };
}
