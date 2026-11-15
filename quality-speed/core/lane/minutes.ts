// SPDX-License-Identifier: Apache-2.0
// A lane's job minutes, from the run's own jobs, with the lane's read-only token. The law kit and collect.ts here read it.
import { REPO } from '../../contract/pages.ts';

/**
 * The minutes this lane's job has run, rounded up to the whole minute as GitHub bills a job, read from the run's own jobs
 * (`GET /actions/runs/{id}/jobs`). The collector is the job's last long step, so this is the job's time to within its
 * upload. null when the job isn't listed or hasn't started.
 */
export function laneMinutes(jobs: unknown, name: string, now: Date): { value: number; samples: number } | null {
  const list = (jobs as { jobs?: { name?: unknown; started_at?: unknown }[] } | null)?.jobs;
  const started = Array.isArray(list) ? list.find((j) => j.name === name)?.started_at : undefined;
  const ms = typeof started === 'string' ? now.getTime() - Date.parse(started) : Number.NaN;
  return Number.isFinite(ms) && ms >= 0 ? { value: Math.max(1, Math.ceil(ms / 60_000)), samples: 1 } : null;
}

/** This run's jobs, with the lane's read-only token. Outside CI, or on any failure, null: the metric reads missing. */
export async function runJobs(run: string | undefined, token: string | undefined): Promise<unknown> {
  if (!run || !token) return null;
  try {
    const response = await fetch(`https://api.github.com/repos/Colorado-Startups/${REPO}/actions/runs/${run}/jobs?filter=latest&per_page=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
