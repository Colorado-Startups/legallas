// SPDX-License-Identifier: Apache-2.0
// The Mac app page's collector. It walks main's commits, newest first, and looks up the `swift` job that ran on each one's
// code by head SHA: the commit itself (a push or manual run on main) and the pull request head that became it. That job
// already builds, tests and bundles the app on macOS, so this page spends no macOS minutes of its own. A skipped job means
// main's Swift code did not change, so the last answer still holds. A failed read leaves every metric missing. Last, it
// reads this lane's own job minutes so far (core/lane/collect.ts): lane_minutes.
//
//   GH_TOKEN=... node quality-speed/pages/mac-app/collect.ts --out <file>
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';
import { laneRecord } from '../../core/lane/collect.ts';

const API = 'https://api.github.com';
/** The last N answered swift jobs on main's code. */
export const JOBS = 20;
/** Pages of 100 main commits and merged pull requests walked to find them, since most commits skip the swift job. 7 covers the 600 commits main had on 2026-11-13: 3 found 6 jobs, one short of the 7 samples the metrics need. */
const PAGES = 7;
const BATCH = 10;
const WORKFLOW = 'CI';
const BUNDLE_STEP = 'App bundle';
export const METRIC_IDS = ['swift_jobs_passing', 'app_bundle_verified', 'swift_job_minutes_p50'] as const;

export interface Job {
  name: string;
  workflow_name: string;
  head_sha: string;
  conclusion: string | null;
  started_at: string;
  completed_at: string | null;
  steps?: { name: string; conclusion: string | null }[];
}
export interface Reading {
  value: number;
  samples: number;
}

/** Jobs that ran to an answer. A cancelled or skipped job answered nothing. */
const ANSWERED = new Set(['success', 'failure', 'timed_out']);
const answered = (j: { conclusion: string | null; completed_at: string | null }) => j.conclusion !== null && ANSWERED.has(j.conclusion) && j.completed_at !== null;

/**
 * The SHAs whose code is main's, newest first: each main commit, then the head of the pull request that merged as it.
 * A push to main usually skips the swift job because that head already ran it.
 */
export function mainHeads(commits: readonly string[], pulls: readonly { merge_commit_sha: string | null; merged_at: string | null; head: { sha: string } }[]): string[] {
  const headOf = new Map(pulls.filter((p) => p.merged_at && p.merge_commit_sha).map((p) => [p.merge_commit_sha!, p.head.sha])); // safe: filtered
  return [...new Set(commits.flatMap((sha) => [sha, ...(headOf.has(sha) ? [headOf.get(sha)!] : [])]))]; // safe: has()
}

/** A job counts only if CI's swift job ran on exactly this SHA, as the contract asks of another run's result. */
export const onSha = (job: Job, sha: string): boolean => job.name === 'swift' && job.workflow_name === WORKFLOW && job.head_sha === sha && answered(job);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2; // safe: called with at least one value
};
const minutes = (j: Job) => (Date.parse(j.completed_at!) - Date.parse(j.started_at)) / 60_000; // safe: answered jobs have an end

/** The three readings from main's newest answered swift jobs, newest first. Every answered job counts, pass or fail. */
export function measure(jobs: readonly Job[]): Record<(typeof METRIC_IDS)[number], Reading | null> {
  const sample = jobs.filter(answered).slice(0, JOBS);
  const bundle = sample.flatMap((j) => j.steps?.filter((s) => s.name === BUNDLE_STEP && (s.conclusion === 'success' || s.conclusion === 'failure')) ?? [])[0];
  if (!sample.length) return { swift_jobs_passing: null, app_bundle_verified: null, swift_job_minutes_p50: null };
  return {
    swift_jobs_passing: { value: (100 * sample.filter((j) => j.conclusion === 'success').length) / sample.length, samples: sample.length },
    app_bundle_verified: bundle ? { value: bundle.conclusion === 'success' ? 1 : 0, samples: 1 } : null,
    swift_job_minutes_p50: { value: Math.round(median(sample.map(minutes)) * 10) / 10, samples: sample.length },
  };
}

/** A record timed at the read and linked to this lane's run: main's last answer holds until its Swift code changes. */
export function toRecord(id: string, reading: Reading | null, measuredAt: string, sourceUrl: string | null): MetricRecord {
  const base = { id, page: 'mac-app', stage: 'live' } as const;
  if (!reading || !sourceUrl) return { ...base, status: 'missing', value: null, measured_at: null, source_url: null, sample_size: null };
  return { ...base, status: 'ok', value: reading.value, measured_at: measuredAt, source_url: sourceUrl, sample_size: reading.samples };
}

async function readJobs(token: string, repo: string): Promise<Job[]> {
  const get = async <T>(url: string): Promise<T> => {
    const response = await fetch(`${API}/repos/${repo}${url}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    return (await response.json()) as T;
  };
  const commits: string[] = [];
  const pulls: Parameters<typeof mainHeads>[1][number][] = [];
  for (let page = 1; page <= PAGES; page++) {
    commits.push(...(await get<{ sha: string }[]>(`/commits?sha=main&per_page=100&page=${page}`)).map((c) => c.sha));
    pulls.push(...(await get<Parameters<typeof mainHeads>[1][number][]>(`/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100&page=${page}`)));
  }
  const jobs: Job[] = [];
  const heads = mainHeads(commits, pulls);
  // BATCH reads at a time, newest first: the lane's minutes are the page's own consumption, and a serial walk of 600 commits is minutes.
  for (let at = 0; at < heads.length && jobs.length < JOBS; at += BATCH) {
    const found = await Promise.all(
      heads.slice(at, at + BATCH).map(async (sha) => {
        const { check_runs: runs } = await get<{ check_runs: { id: number; conclusion: string | null; completed_at: string | null; app?: { slug: string } }[] }>(`/commits/${sha}/check-runs?check_name=swift&filter=latest`);
        const mine: Job[] = [];
        for (const run of runs.filter((r) => r.app?.slug === 'github-actions' && answered(r))) {
          const job = await get<Job>(`/actions/jobs/${run.id}`);
          if (onSha(job, sha)) mine.push(job);
        }
        return mine;
      }),
    );
    jobs.push(...found.flat());
  }
  return jobs.sort((a, b) => Date.parse(b.completed_at!) - Date.parse(a.completed_at!)); // safe: onSha keeps answered jobs only
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) throw new Error('usage: collect.ts --out <file>');
  const { GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  const repo = GITHUB_REPOSITORY ?? 'Colorado-Startups/legallas';
  const measuredAt = `${new Date().toISOString().slice(0, 19)}Z`;
  const sourceUrl = GITHUB_RUN_ID ? `https://github.com/${repo}/actions/runs/${GITHUB_RUN_ID}` : null;
  let readings: Partial<ReturnType<typeof measure>> = {};
  try {
    if (!GH_TOKEN) throw new Error('GH_TOKEN is not set');
    readings = measure(await readJobs(GH_TOKEN, repo));
  } catch (error) {
    console.error(`mac app: read failed (${error instanceof Error ? error.constructor.name : 'unknown'}); every metric is missing`);
  }
  const records = METRIC_IDS.map((id) => toRecord(id, readings[id] ?? null, measuredAt, sourceUrl));
  // After every read, so it times the whole lane.
  records.push(await laneRecord('mac-app'));
  mkdirSync(path.dirname(values.out), { recursive: true });
  writeFileSync(values.out, `${JSON.stringify(records, null, 1)}\n`);
  console.log(`${records.filter((r) => r.status === 'ok').length} of ${records.length} metrics measured`);
}

if (import.meta.main) await main();
