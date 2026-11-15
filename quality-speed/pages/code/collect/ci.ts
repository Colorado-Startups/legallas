// SPDX-License-Identifier: Apache-2.0
// What this page reads from the repository's own CI (`.github/workflows/ci.yml`) through the Actions REST API: the
// web feedback loop's step times, the Mac jobs' wall time, and whether the Mac jobs passed. Every read is a GET with the job's read-only token. An API error throws, so the
// metrics built on it are missing, never good news.

export type Api = (path: string) => Promise<unknown>;

export interface Step {
  name: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface Job {
  id: number;
  run_id: number;
  name: string;
  conclusion: string | null;
  runner_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  html_url?: string;
  steps?: Step[];
}

export interface Run {
  id: number;
  event: string;
  head_sha: string;
  head_branch: string | null;
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
}

/** The steps whose sum is the web loop: type check, tests, build and both Worker bundles. Names match exactly. */
export const WEB_LOOP_STEPS = ['Web check', 'Web test', 'Web build', 'Worker dry runs'];
export const MAC_JOBS = ['swift', 'swift-ocr'];

const seconds = (from: string | null, to: string | null) =>
  from && to ? (Date.parse(to) - Date.parse(from)) / 1000 : Number.NaN;

/** Blacksmith and GitHub-hosted runners differ in speed, so samples are compared within one class only. */
export function runnerClass(runnerName: string | null): string {
  if (!runnerName) return 'unknown';
  if (runnerName.startsWith('blacksmith-')) return runnerName.replace(/-[a-z0-9]+$/, '').replace(/-ubuntu.*$/, '');
  return 'github-hosted';
}

export interface Sample {
  value: number;
  at: string;
  runnerClass: string;
  runId: number;
  url: string;
}

/** One web-loop sample from a `checks` job: the four steps' total, or undefined unless all four succeeded. */
export function webLoopSample(job: Job, run: Run): Sample | undefined {
  if (job.name !== 'checks' || job.conclusion !== 'success') return undefined;
  let total = 0;
  for (const name of WEB_LOOP_STEPS) {
    const step = job.steps?.find((s) => s.name === name);
    if (!step || step.conclusion !== 'success') return undefined;
    const s = seconds(step.started_at, step.completed_at);
    if (!Number.isFinite(s) || s < 0) return undefined;
    total += s;
  }
  return { value: total, at: job.completed_at ?? run.created_at, runnerClass: runnerClass(job.runner_name), runId: run.id, url: run.html_url };
}

/** The Mac wall time of one run: the longer of `swift` and `swift-ocr`, when both succeeded. */
export function macLoopSample(jobs: Job[], run: Run): Sample | undefined {
  const mac = MAC_JOBS.map((name) => jobs.find((j) => j.name === name));
  if (mac.some((j) => !j || j.conclusion !== 'success')) return undefined;
  const durations = (mac as Job[]).map((j) => seconds(j.started_at, j.completed_at));
  if (durations.some((d) => !Number.isFinite(d) || d < 0)) return undefined;
  const later = (mac as Job[]).reduce((a, b) => (Date.parse(a.completed_at ?? '') >= Date.parse(b.completed_at ?? '') ? a : b));
  return { value: Math.max(...durations), at: later.completed_at ?? run.created_at, runnerClass: 'macos', runId: run.id, url: run.html_url };
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const at = (k: number) => sorted[k] ?? Number.NaN;
  return sorted.length % 2 === 1 ? at(mid) : (at(mid - 1) + at(mid)) / 2;
}

export interface Summary {
  value: number;
  samples: Sample[];
  runnerClass: string;
}

/**
 * The median of the newest `limit` samples within `windowDays`, all from the runner class of the newest sample.
 * Undefined when there are none; the caller compares the count with the metric's sample minimum.
 */
export function summarize(samples: Sample[], now: Date, windowDays: number, limit: number): Summary | undefined {
  const recent = samples
    .filter((s) => now.getTime() - Date.parse(s.at) <= windowDays * 86_400_000)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const cls = recent[0]?.runnerClass;
  if (cls === undefined) return undefined;
  const chosen = recent.filter((s) => s.runnerClass === cls).slice(0, limit);
  return { value: median(chosen.map((s) => s.value)), samples: chosen, runnerClass: cls };
}

/** Completed CI runs, newest first, up to `pages` pages of 100. */
export async function ciRuns(api: Api, repo: string, pages: number): Promise<Run[]> {
  const runs: Run[] = [];
  for (let page = 1; page <= pages; page++) {
    const body = (await api(`repos/${repo}/actions/workflows/ci.yml/runs?status=completed&per_page=100&page=${page}`)) as { workflow_runs?: Run[] };
    if (!Array.isArray(body.workflow_runs)) throw new Error('Actions API: no workflow_runs');
    runs.push(...body.workflow_runs);
    if (body.workflow_runs.length < 100) break;
  }
  return runs;
}

export async function runJobs(api: Api, repo: string, runId: number): Promise<Job[]> {
  const body = (await api(`repos/${repo}/actions/runs/${runId}/jobs?per_page=100`)) as { jobs?: Job[] };
  if (!Array.isArray(body.jobs)) throw new Error(`Actions API: no jobs for run ${runId}`);
  return body.jobs;
}

/** The top-level paths whose content is the Swift package: the `swift=` area of changed-paths.sh, as tree entries. */
export const SWIFT_TREE_PATHS = ['.swiftlint.yml', 'LegallasApp', 'Package.swift', 'Sources', 'Tests'];

/** A key that changes exactly when any Swift path changes: the tree entry hashes of SWIFT_TREE_PATHS at a commit. */
export async function swiftTreeKey(api: Api, repo: string, sha: string): Promise<string> {
  const commit = (await api(`repos/${repo}/git/commits/${sha}`)) as { tree?: { sha?: string } };
  if (!commit.tree?.sha) throw new Error(`git API: no tree for ${sha}`);
  const tree = (await api(`repos/${repo}/git/trees/${commit.tree.sha}`)) as { tree?: { path: string; sha: string }[]; truncated?: boolean };
  if (!Array.isArray(tree.tree) || tree.truncated) throw new Error(`git API: unreadable tree for ${sha}`);
  return treeKey(tree.tree);
}

export function treeKey(entries: { path: string; sha: string }[]): string {
  return SWIFT_TREE_PATHS.map((p) => `${p}:${entries.find((e) => e.path === p)?.sha ?? '-'}`).join(' ');
}

export interface MacRun {
  run: Run;
  jobs: Job[];
}

/** CI runs for one commit, newest first. */
export async function runsForSha(api: Api, repo: string, sha: string): Promise<Run[]> {
  const body = (await api(`repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&status=completed&per_page=100`)) as { workflow_runs?: Run[] };
  if (!Array.isArray(body.workflow_runs)) throw new Error(`Actions API: no runs list for ${sha}`);
  return [...body.workflow_runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/** Head commits of the pull requests that brought `sha` to main (a squash merge leaves the head off main). */
export async function pullHeadsFor(api: Api, repo: string, sha: string): Promise<string[]> {
  const body = (await api(`repos/${repo}/commits/${sha}/pulls`)) as { head?: { sha?: string } }[];
  if (!Array.isArray(body)) throw new Error(`API: no pull list for ${sha}`);
  return body.map((p) => p.head?.sha).filter((s): s is string => typeof s === 'string');
}

/**
 * The newest CI run whose Mac jobs ran (passed or failed, not skipped) on the same Swift tree as `headKey`.
 * `swiftCommit` is the newest main commit that changed a Swift path (git log). Mac jobs run only when Swift paths
 * change, and the push run of a squash merge skips them when its pull request's head already passed, so the
 * candidates are that commit's runs and its pull request head's runs. The tree is compared, never assumed.
 */
export async function latestMacRunOnTree(api: Api, repo: string, swiftCommit: string, headKey: string): Promise<MacRun | undefined> {
  const shas = [swiftCommit, ...(await pullHeadsFor(api, repo, swiftCommit))];
  const runs = (await Promise.all(shas.map((s) => runsForSha(api, repo, s)))).flat();
  runs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const keys = new Map<string, string>();
  for (const run of runs) {
    const jobs = await runJobs(api, repo, run.id);
    const ran = jobs.some((j) => MAC_JOBS.includes(j.name) && j.conclusion !== 'skipped' && j.conclusion !== null);
    if (!ran) continue;
    let key = keys.get(run.head_sha);
    if (key === undefined) {
      key = await swiftTreeKey(api, repo, run.head_sha);
      keys.set(run.head_sha, key);
    }
    if (key === headKey) return { run, jobs };
  }
  return undefined;
}

/** An Api over fetch with a bearer token, for the lane. */
export function fetchApi(token: string, base = 'https://api.github.com'): Api {
  return async (path) => {
    const res = await fetch(`${base}/${path}`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path.replace(/\?.*$/, '')}`);
    return res.json();
  };
}
