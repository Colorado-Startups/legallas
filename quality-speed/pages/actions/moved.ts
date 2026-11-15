// SPDX-License-Identifier: Apache-2.0
// Metrics moved here in the tab rescope (2026-11-09), their logic copied from the CI overview page (`gates_intact`,
// `repeat_runs_per_merge`) and the GitHub App page (`app_token_*`), plus the new `queue_seconds_p90`. They read the same
// run records as the rest of this page, so this site's own runs, pull requests and workflow stay out (BRIEF.md).
import { percentile, type Job, type PullRequest, type Reading, type Run } from './measure.ts';
import type { SourceFile } from './workflows.ts';

const DAY_MS = 86_400_000;
/** The CI overview's window: two days of merges. */
export const MERGE_DAYS = 2;
/** The GitHub App page's window. */
export const TOKEN_DAYS = 30;
/** The queue's window, as `queueDetail`'s. */
export const QUEUE_DAYS = 14;

const CI = '.github/workflows/ci.yml';
const DCO = '.github/workflows/dco.yml';
const ms = (time: string): number => Date.parse(time);

/** A branch rule as `GET /repos/{repo}/rules/branches/main` lists it. */
export interface Rule {
  type: string;
  parameters?: { required_status_checks?: { context: string }[] } | null;
}

const ok = (job: Job | undefined) => job?.conclusion === 'success' && !!job.started_at;

/** A run's job by name, from its latest attempt: a rerun that passed replaces the failure before it. */
const jobOf = (run: Run | undefined, name: string) =>
  run ? run.jobs.filter((j) => j.name === name).sort((a, b) => (b.run_attempt ?? 1) - (a.run_attempt ?? 1))[0] : undefined;

/** Merged pull requests in the window, each with its final head's latest CI and DCO runs. */
function mergedHeads(runs: readonly Run[], pulls: readonly PullRequest[], now: Date) {
  const from = now.getTime() - MERGE_DAYS * DAY_MS;
  const prRuns = runs.filter((r) => r.status === 'completed' && r.event === 'pull_request');
  const latest = (sha: string, path: string) => prRuns.filter((r) => r.head_sha === sha && r.path === path).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  return pulls
    .filter((p) => !!p.merged_at && ms(p.merged_at) >= from && ms(p.merged_at) <= now.getTime())
    .map((p) => ({ p, ci: latest(p.head_sha, CI), dco: latest(p.head_sha, DCO) }));
}

/**
 * The gates, in this order. The CI overview had eight; `claude-review` was retired in #555, so its two (required, ran)
 * are gone and six remain. Null with no merge in the window: nothing on a merged head to prove.
 */
export const GATES = ['ci-ok', 'dco', 'signed', 'scan', 'dco ran', 'lint'] as const;
export function gateStates(runs: readonly Run[], pulls: readonly PullRequest[], rules: readonly Rule[], ciYml: string, now: Date): boolean[] | null {
  const heads = mergedHeads(runs, pulls, now);
  if (!heads.length) return null;
  const required = new Set(rules.filter((r) => r.type === 'required_status_checks').flatMap((r) => r.parameters?.required_status_checks ?? []).map((c) => c.context));
  return [
    required.has('ci-ok'),
    required.has('dco'),
    rules.some((r) => r.type === 'required_signatures'),
    heads.every((h) => ok(jobOf(h.ci, 'ci-ok')) && ok(jobOf(h.ci, 'checks')) && !!jobOf(h.ci, 'checks')?.steps?.some((s) => s.name === 'Secret scan' && s.conclusion === 'success')),
    heads.every((h) => h.p.user_type === 'Bot' || ok(jobOf(h.dco, 'dco'))),
    /^\s+if: steps\.changed\.outputs\.workflows == 'true'\n\s+run: \.github\/scripts\/lint-workflows\.sh\s*$/m.test(ciYml),
  ];
}

export function gatesIntact(runs: readonly Run[], pulls: readonly PullRequest[], rules: readonly Rule[], ciYml: string, now: Date): Reading | null {
  const gates = gateStates(runs, pulls, rules, ciYml, now);
  return gates ? { value: gates.filter(Boolean).length, samples: 1 } : null;
}

/** Pull request runs in the window with a job on a runner, beyond the first per workflow and head, over the merges. */
export function repeatRunsPerMerge(runs: readonly Run[], pulls: readonly PullRequest[], now: Date): Reading | null {
  const from = now.getTime() - MERGE_DAYS * DAY_MS;
  const inWindow = (time: string) => ms(time) >= from && ms(time) <= now.getTime();
  const merges = pulls.filter((p) => p.merged_at && inWindow(p.merged_at)).length;
  if (!merges) return null;
  const pairs = new Map<string, number>();
  for (const r of runs) {
    if (r.status !== 'completed' || r.event !== 'pull_request' || !inWindow(r.created_at)) continue;
    if (!r.jobs.some((j) => j.conclusion !== 'skipped' && !!j.started_at)) continue;
    const key = `${r.path}\n${r.head_sha}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  const repeats = [...pairs.values()].reduce((sum, k) => sum + k - 1, 0);
  return { value: Math.round((repeats / merges) * 100) / 100, samples: merges };
}

/** Seconds from a job's creation to its start, p90, over jobs on a runner. GitHub's Actions performance metrics name it. */
export function queueSecondsP90(runs: readonly Run[], now: Date): Reading | null {
  const cutoff = now.getTime() - QUEUE_DAYS * DAY_MS;
  const waits = runs.flatMap((run) =>
    run.jobs.filter((j) => j.runner_name && j.created_at && j.started_at && ms(j.started_at) >= cutoff).map((j) => Math.max(0, (ms(j.started_at as string) - ms(j.created_at as string)) / 1000)),
  );
  const value = percentile(waits, 90);
  return value === null ? null : { value, samples: waits.length };
}

// The App's token, from the GitHub App page's collector.

/** A step that mints a token, and the App it mints for: its client id, a repository variable. */
const MINTS = /^\s*(?:-\s+)?uses:\s*(actions\/create-github-app-token@[^\s#]+)/;
const CLIENT_ID = 'vars.CS_APP_CLIENT_ID';
/** Jobs that ran to an answer. A skipped job (a branch run, which can't reach the key) or a cancelled one answered nothing. */
const ANSWERED = new Set(['success', 'failure', 'timed_out']);

export interface TokenJob {
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps?: { name?: unknown; conclusion?: unknown }[];
}

/** The steps in one workflow file that mint this App's token, by the name the jobs API gives each. */
export function tokenSteps(text: string): string[] {
  const lines = text.split('\n');
  return lines.flatMap((line, i) => {
    const action = MINTS.exec(line)?.[1];
    if (!action) return [];
    let start = i;
    while (start > 0 && !/^\s*-\s/.test(lines[start]!)) start--; // safe: in range
    const dash = lines[start]!.indexOf('-'); // safe: in range
    let end = start + 1;
    while (end < lines.length && !(/\S/.test(lines[end]!) && lines[end]!.search(/\S/) <= dash)) end++; // safe: in range
    const step = lines.slice(start, end).join('\n');
    if (!step.includes(CLIENT_ID)) return [];
    const name = /^\s*(?:-\s+)?name:\s*(.+?)\s*$/m.exec(step)?.[1]?.replace(/^(['"])(.*)\1$/, '$2');
    return [name ?? `Run ${action}`];
  });
}

/** The workflows, this site's own already left out by `readWorkflows`, with a step that mints the App's token. */
export function appWorkflows(workflows: readonly SourceFile[]): { file: string; steps: string[] }[] {
  return workflows.map((w) => ({ file: w.name, steps: tokenSteps(w.text) })).filter((w) => w.steps.length > 0);
}

const seconds = (j: TokenJob) => (Date.parse(j.completed_at ?? '') - Date.parse(j.started_at ?? '')) / 1000;

/** The share of answered jobs that passed and their median time in whole seconds, or null when none answered. */
export function tokenJobs(jobs: readonly TokenJob[]): { passing: Reading; p50: Reading } | null {
  const done = jobs.filter((j) => ANSWERED.has(j.conclusion ?? '') && seconds(j) >= 0);
  if (!done.length) return null;
  const s = done.map(seconds).sort((a, b) => a - b);
  const mid = s.length >> 1;
  const p50 = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2; // safe: at least one value
  const passing = Math.round((10_000 * done.filter((j) => j.conclusion === 'success').length) / done.length) / 100;
  return { passing: { value: passing, samples: done.length }, p50: { value: Math.round(p50), samples: done.length } };
}

/** Whether a job ran one of these steps: a step skipped, or never reached, minted nothing. */
export const ranStep = (job: TokenJob, names: readonly string[]): boolean =>
  job.steps?.some((s) => names.includes(s.name as string) && ANSWERED.has(s.conclusion as string)) === true;
