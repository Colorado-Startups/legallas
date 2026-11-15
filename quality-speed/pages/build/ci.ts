// SPDX-License-Identifier: Apache-2.0
// What CI's own job records say about the build: which build steps passed on each run and how long they took. No new
// timing: GitHub records every step's result and its start and end. ci.yml names the steps; a renamed step reads as
// missing here, never as a pass.

/** The build steps, by ci.yml job. Install is in: a fresh commit can't build without it. */
export const STEPS = {
  checks: ['Web install', 'Web build', 'Worker dry runs'],
  swift: ['Build (Debug)', 'Build (Release)', 'App bundle', 'LegallasCore for iOS'],
} as const;

/** The subset of GitHub's job record this page reads. */
export interface Job {
  name: string;
  steps?: { name: string; conclusion: string | null; started_at: string | null; completed_at: string | null }[];
}

export interface Run {
  id: number;
  head_sha: string;
  event: string;
  head_branch: string | null;
  created_at: string;
}

/** One CI run, as this page keeps it: ids, a time, a result per build step that ran, and the two build times. */
export interface RunFacts {
  id: number;
  sha: string;
  main: boolean;
  at: string;
  /** Step name to pass (1) or fail (0); steps skipped or cancelled are left out. */
  steps: Record<string, 0 | 1>;
  /** Whether the run built: 0 if a build step failed, 1 if every build step of a job ran and passed, null if unknown. */
  build: 0 | 1 | null;
  web: number | null;
  mac: number | null;
}

const seconds = (s: { started_at: string | null; completed_at: string | null }) =>
  s.started_at && s.completed_at ? (Date.parse(s.completed_at) - Date.parse(s.started_at)) / 1000 : NaN;

/** A job's build time: the sum of its build steps when every one passed, else null. */
function buildSeconds(job: Job | undefined, names: readonly string[]): number | null {
  const steps = names.map((n) => job?.steps?.find((s) => s.name === n));
  if (steps.some((s) => s?.conclusion !== 'success')) return null;
  const total = steps.reduce((sum, s) => sum + seconds(s!), 0);
  return Number.isFinite(total) ? total : null;
}

/**
 * A failed build step fails the run. Otherwise a job whose build steps all passed makes it a pass, and a job where some
 * ran and the rest were skipped (an earlier check failed) makes it unknown, never a pass.
 */
export function buildVerdict(jobs: Job[]): 0 | 1 | null {
  let verdict: 0 | 1 | null = null;
  let unknown = false;
  for (const [jobName, names] of Object.entries(STEPS)) {
    const job = jobs.find((j) => j.name === jobName);
    const results = names.map((n) => job?.steps?.find((s) => s.name === n)?.conclusion);
    if (results.includes('failure')) return 0;
    const passed = results.filter((c) => c === 'success').length;
    if (passed === names.length) verdict = 1;
    else if (passed > 0) unknown = true;
  }
  return unknown ? null : verdict;
}

export function runFacts(run: Run, jobs: Job[]): RunFacts {
  const steps: RunFacts['steps'] = {};
  for (const [jobName, names] of Object.entries(STEPS)) {
    const job = jobs.find((j) => j.name === jobName);
    for (const name of names) {
      const c = job?.steps?.find((s) => s.name === name)?.conclusion;
      if (c === 'success' || c === 'failure') steps[name] = c === 'success' ? 1 : 0;
    }
  }
  return {
    id: run.id,
    sha: run.head_sha,
    main: run.event === 'push' && run.head_branch === 'main',
    at: run.created_at,
    steps,
    build: buildVerdict(jobs),
    web: buildSeconds(jobs.find((j) => j.name === 'checks'), STEPS.checks),
    mac: buildSeconds(jobs.find((j) => j.name === 'swift'), STEPS.swift),
  };
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const at = (i: number) => s[i] ?? NaN;
  return s.length % 2 ? at(m) : (at(m - 1) + at(m)) / 2;
}

/** Newest first. Each window is the latest runs that count for it, however old: the Mac job runs only on Swift changes. */
export const WINDOWS = { main: 30, web: 10, mac: 5 } as const;

export interface CiReadings {
  /** Share of the latest main runs that built, of those whose result is known, in percent. */
  building: { value: number; n: number; run: number } | null;
  web: { value: number; n: number; run: number } | null;
  mac: { value: number; n: number; run: number } | null;
}

export function readings(facts: RunFacts[]): CiReadings {
  const newest = [...facts].sort((a, b) => b.id - a.id);
  const main = newest.filter((f) => f.main && f.build !== null).slice(0, WINDOWS.main);
  const web = newest.filter((f) => f.web !== null).slice(0, WINDOWS.web);
  const mac = newest.filter((f) => f.mac !== null).slice(0, WINDOWS.mac);
  const pick = (rows: RunFacts[], v: () => number) => (rows[0] ? { value: v(), n: rows.length, run: rows[0].id } : null);
  return {
    building: pick(main, () => (100 * main.filter((f) => f.build === 1).length) / main.length),
    web: pick(web, () => median(web.map((f) => f.web!))),
    mac: pick(mac, () => median(mac.map((f) => f.mac!))),
  };
}

/** Reads GitHub's REST API with the job's own read-only token. Any failure throws, so the caller writes missing. */
export type Get = (path: string) => Promise<unknown>;

export function github(repo: string, token: string, api = 'https://api.github.com'): Get {
  return async (path) => {
    const res = await fetch(`${api}/repos/${repo}/${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for a ${path.split('?')[0]} read`);
    return res.json();
  };
}

/** At most this many runs are read in one collection; with earlier facts, only the runs since. */
export const MAX_RUNS = 300;

/** Adds the completed CI runs newer than `known` to it, newest first, and keeps what the windows can still use. */
export async function collectFacts(get: Get, known: RunFacts[]): Promise<RunFacts[]> {
  const seen = new Set(known.map((f) => f.id));
  const fresh: RunFacts[] = [];
  let read = 0;
  for (let page = 1; read < MAX_RUNS; page++) {
    const { workflow_runs: runs } = (await get(`actions/workflows/ci.yml/runs?status=completed&per_page=100&page=${page}`)) as { workflow_runs: Run[] };
    if (!runs.length) break;
    let reachedKnown = false;
    for (const run of runs) {
      if (seen.has(run.id)) {
        reachedKnown = true;
        break;
      }
      if (++read > MAX_RUNS) break;
      const { jobs } = (await get(`actions/runs/${run.id}/jobs?per_page=100`)) as { jobs: Job[] };
      fresh.push(runFacts(run, jobs));
    }
    if (reachedKnown) break;
  }
  return trim([...fresh, ...known]);
}

/** Drops runs no window can reach. */
export function trim(facts: RunFacts[]): RunFacts[] {
  const newest = [...facts].sort((a, b) => b.id - a.id);
  const keep = new Set<number>();
  for (const [take, test] of [
    [WINDOWS.main, (f: RunFacts) => f.main && f.build !== null],
    [WINDOWS.web, (f: RunFacts) => f.web !== null],
    [WINDOWS.mac, (f: RunFacts) => f.mac !== null],
  ] as const) {
    for (const f of newest.filter(test).slice(0, take)) keep.add(f.id);
  }
  return newest.filter((f) => keep.has(f.id));
}
