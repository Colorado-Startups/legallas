// SPDX-License-Identifier: Apache-2.0
// The quick lane: whether every recent commit on main went through CI's secret scan, from GitHub's job records.
import { execFileSync } from 'node:child_process';
import { finish, githubList, reading, record, repository, runContext } from './lane.ts';
import { gateCoverage } from './readings.ts';

const COMMITS = 50;
/** A run this new may not have started yet, so its commit has no answer. */
const NEW_COMMIT_S = 3600;

interface Run {
  id: number;
  status: string;
}

interface Job {
  name: string;
  steps?: { name: string; conclusion: string | null }[];
}

const runsOf = (sha: string, event: string) =>
  githubList<Run>(`/repos/${repository()}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=${event}&per_page=20`, 'workflow_runs', 1);

/** How a run's secret scan ended: its conclusion, or `none` if the run has no such step. */
async function scanConclusion(runId: number): Promise<string> {
  const jobs = await githubList<Job>(`/repos/${repository()}/actions/runs/${runId}/jobs?per_page=100`, 'jobs', 2);
  return jobs.find((job) => job.name === 'checks')?.steps?.find((step) => step.name === 'Secret scan')?.conclusion ?? 'none';
}

async function anyPassed(runs: readonly Run[]): Promise<boolean> {
  for (const run of runs) {
    if (run.status === 'completed' && (await scanConclusion(run.id)) === 'success') return true;
  }
  return false;
}

/**
 * Whether the commit's pull request passed the scan, which is the gate that keeps a secret out. Each push to main has a
 * concurrency group of its own, so a burst of merges no longer cancels a main run. A commit may still have no scan of its
 * own: its push skips `checks` when CI already passed it (`tested` in ci.yml), and a burst cancelled some older runs while
 * main shared one group. Its pull request's scan still counts, and the nightly scan reads the whole history anyway.
 */
async function pullRequestScanned(sha: string): Promise<boolean> {
  const pulls = await githubList<{ head: { sha: string } }>(`/repos/${repository()}/commits/${sha}/pulls`);
  for (const pull of pulls) {
    if (await anyPassed(await runsOf(pull.head.sha, 'pull_request'))) return true;
  }
  return false;
}

/** The scan's result on each recent commit of main: `success`, what it found instead, or null when it is too new to say. */
export async function secretScanConclusions(nowS: number): Promise<(string | null)[]> {
  if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() !== 'false') throw new Error('a shallow checkout proves nothing');
  const log = execFileSync('git', ['log', '--first-parent', `--max-count=${COMMITS}`, '--format=%H %ct', 'HEAD'], { encoding: 'utf8' });
  const conclusions: (string | null)[] = [];
  for (const line of log.split('\n').filter(Boolean)) {
    const [sha, committed] = line.split(' ') as [string, string];
    const runs = await runsOf(sha, 'push');
    if (runs.some((run) => run.status !== 'completed') || (runs.length === 0 && nowS - Number(committed) < NEW_COMMIT_S)) {
      conclusions.push(null);
    } else if (await anyPassed(runs)) {
      conclusions.push('success');
    } else {
      conclusions.push((await pullRequestScanned(sha)) ? 'success' : 'none');
    }
  }
  return conclusions;
}

if (import.meta.main) {
  const gate = await reading('the secret scan gate', async () => gateCoverage(await secretScanConclusions(Math.floor(Date.now() / 1000))));
  finish([record(runContext(), 'secret_scan_gate_coverage', gate?.percent ?? null, gate?.sample ?? 1)], { checks: {}, readings: {} });
}
