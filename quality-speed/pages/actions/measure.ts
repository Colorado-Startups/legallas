// SPDX-License-Identifier: Apache-2.0
// The Actions page's arithmetic, from GitHub's run and job records (PLAN.md says why each number is here). Nothing here
// reads the network, so every rule has a test on invented records. A reading that can't be trusted is null, never 0.

export interface Job {
  name: string;
  run_attempt?: number;
  conclusion: string | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  runner_name?: string | null;
  labels?: string[];
  steps?: { name: string; conclusion: string | null }[];
}

export interface Run {
  id: number;
  path: string;
  event: string;
  status: string;
  conclusion: string | null;
  run_attempt: number;
  run_number: number;
  head_branch: string | null;
  head_sha: string;
  created_at: string;
  updated_at: string;
  head_commit?: { tree_id?: string } | null;
  jobs: Job[];
}

export interface PullRequest {
  number: number;
  head_ref: string;
  head_sha: string;
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
  files: string[];
  /** The author's account type: a bot's pull request needs no sign-off. */
  user_type?: string;
}

export interface Reading {
  value: number;
  samples: number;
}

/** One number behind a metric, in the shape the detail file takes: ids and numbers only. */
export interface DetailReading {
  value: number;
  limit: number | null;
  n: number;
}

/** A reading the page can't trust, such as a runner label with no known price. */
export class Unreadable extends Error {}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** What this page works to: the whole included $300, which the owner authorized on 2026-11-06 (PLAN.md). The $0 budget stops it. */
export const ALLOWANCE_USD = 300;
/** The price per minute, from GitHub's billing docs. */
export const PRICE_PER_MINUTE = { linux: 0.006, linux_slim: 0.002, linux_arm: 0.005, windows: 0.01, macos: 0.062 } as const;
export type Sku = keyof typeof PRICE_PER_MINUTE;

/** The windows, in days. Spend reads the whole billing month, so nothing shorter can hide a costly start to it. */
export const RECENT_DAYS = 14;
export const FLAKY_DAYS = 30;
export const BLACKSMITH_DAYS = 31;
export const PACE_DAYS = 7;

const CI = '.github/workflows/ci.yml';
/** The jobs that judge the files. `ci-ok` only repeats them, and `dco` judges the commit message, so an amend isn't a flake. */
const TREE_JOBS: readonly string[] = ['checks', 'swift', 'swift-ocr', 'office-mac'];
/** The required checks: the workflow, then the job whose result GitHub requires. */
const REQUIRED_JOBS: Record<string, string> = { [CI]: 'ci-ok', '.github/workflows/dco.yml': 'dco' };
/** The longest chain of job timeouts in ci.yml is 58 minutes, so a run still open at 2 hours has stalled. */
const STALLED_MS = 2 * HOUR_MS;
/** How close another required check must start to the CI run to belong to the same push, not a later ready_for_review. */
const SAME_PUSH_MS = 120_000;
/** A run still going counts at the most it can use on Blacksmith, as build_minutes_guard.py counts it: `checks` plus `ci-ok`. */
const WORST_CASE_MINUTES = 25;
/** The Swift paths from changed-paths.sh. If this drifts it can only ask for a job that didn't need to run, which shows as a fail. */
const SWIFT_PATH = /^(Package\.(swift|resolved)$|Sources\/|Tests\/|LegallasApp\/|\.swiftlint\.yml$|\.github\/ci\/)/;
const FAILED = new Set(['failure', 'timed_out']);

const ms = (time: string): number => Date.parse(time);

/** True for this site's own files. */
export function isSiteFile(file: string): boolean {
  return file.startsWith('quality-speed/') || file.startsWith('.github/workflows/quality-speed');
}

/** A pull request is the site's only if every file is, so one file under quality-speed/ can't hide a product change. */
export const isSitePull = (pull: PullRequest): boolean => pull.files.length > 0 && pull.files.every(isSiteFile);

/** Nearest rank, so the answer is a real sample. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
}

/** What a runner label costs: a price on GitHub, or free minutes on Blacksmith. Any other label is Unreadable, never a low guess. */
export function runnerOf(labels: readonly string[]): { sku: Sku } | { blacksmith: number } {
  for (const label of labels) {
    const blacksmith = /^blacksmith-(\d+)vcpu-ubuntu-\d+$/.exec(label);
    if (blacksmith) return { blacksmith: Number(blacksmith[1]) / 2 };
    if (label === 'ubuntu-slim') return { sku: 'linux_slim' };
    if (/^ubuntu-(latest|\d+\.\d+)$/.test(label)) return { sku: 'linux' };
    if (/^ubuntu-\d+\.\d+-arm$/.test(label)) return { sku: 'linux_arm' };
    if (/^windows-(latest|\d+|11-arm)$/.test(label)) return { sku: 'windows' };
    if (/^(macos-(latest|\d+)|xcode-\d+)$/.test(label)) return { sku: 'macos' };
  }
  throw new Unreadable('a job ran on a runner with no known price');
}

/** A job counts when a runner took it: GitHub rounds each job up to a whole minute. A skipped job has no runner and costs nothing. */
export function billedMinutes(job: Job): number {
  if (!job.runner_name || !job.started_at || !job.completed_at) return 0;
  return Math.ceil(Math.max(ms(job.completed_at) - ms(job.started_at), 1000) / 60_000);
}

const since = (runs: readonly Run[], cutoff: number): Run[] => runs.filter((run) => ms(run.created_at) >= cutoff);

function jobsSince(runs: readonly Run[], cutoff: number): { run: Run; job: Job }[] {
  return runs.flatMap((run) => run.jobs.filter((job) => billedMinutes(job) > 0 && ms(job.started_at as string) >= cutoff).map((job) => ({ run, job })));
}

/** A runner's word in the detail file. Ids are short there, and an underscore separates their parts. */
const skuName = (job: Job): string => {
  const runner = runnerOf(job.labels ?? []);
  return 'sku' in runner ? runner.sku.replace('linux_', '') : 'blacksmith';
};

function dollars(job: Job): number {
  const runner = runnerOf(job.labels ?? []);
  return 'sku' in runner ? billedMinutes(job) * PRICE_PER_MINUTE[runner.sku] : 0;
}

export function spendUsd(runs: readonly Run[], cutoff: number): number {
  return jobsSince(runs, cutoff).reduce((sum, { job }) => sum + dollars(job), 0);
}

/**
 * Dollars at the end of this month: what the month has spent, plus the last week's daily pace for the days left. The pace
 * crosses the start of a month, so day 1 doesn't read as nothing spent. A repository younger than a week divides by its
 * age, at least a day, so one busy hour doesn't read as a whole month's pace. The value counts every run, because that's
 * what is really left, and the samples only count product runs, so this site's jobs can't lift a quiet week over the minimum.
 */
export function allowanceForecast(all: readonly Run[], product: readonly Run[], now: Date): Reading | null {
  const nowMs = now.getTime();
  const started = jobsSince(all, 0).map(({ job }) => ms(job.started_at as string));
  if (!started.length) return null;
  const nextMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const paceFrom = nowMs - PACE_DAYS * DAY_MS;
  const days = Math.min(PACE_DAYS, Math.max(1, (nowMs - Math.min(...started)) / DAY_MS));
  const month = spendUsd(all, Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { value: month + (spendUsd(all, paceFrom) / days) * ((nextMonth - nowMs) / DAY_MS), samples: jobsSince(product, paceFrom).length };
}

/** Blacksmith's minutes over its window, weighted and rounded as build_minutes_guard.py counts them, running CI at its worst case, so a gate can't under-read. Samples as the forecast's. */
export function blacksmithMinutes(all: readonly Run[], product: readonly Run[], now: Date): Reading {
  const cutoff = now.getTime() - BLACKSMITH_DAYS * DAY_MS;
  let value = 0;
  for (const { job } of jobsSince(all, cutoff)) {
    const runner = runnerOf(job.labels ?? []);
    if ('blacksmith' in runner) value += billedMinutes(job) * runner.blacksmith;
  }
  for (const run of since(all, cutoff)) {
    if (run.path === CI && run.status !== 'completed') value += WORST_CASE_MINUTES * Math.max(run.run_attempt, 1);
  }
  return { value, samples: jobsSince(product, cutoff).length };
}

/** The longest id `core/detail.ts` accepts. One id past it would lose the whole file. */
const MAX_DETAIL_ID = 32;

/** A lowercase id for the detail file, whatever a workflow calls a job. */
export function detailId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Where this month's money went, by job and by day, for the spend table and the running total. Only jobs in `known` keep their names, so a branch's job name can't carry text to the site. */
export function spendDetail(runs: readonly Run[], now: Date, known: ReadonlySet<string>): Record<string, DetailReading> {
  const readings: Record<string, DetailReading> = {};
  const add = (id: string, value: number, limit: number | null = null) => {
    const reading = (readings[id] ??= { value: 0, limit, n: 0 });
    reading.value += value;
    reading.n += 1;
  };
  for (const { run, job } of jobsSince(runs, Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))) {
    const sku = skuName(job);
    const workflow = detailId(run.path.split('/').pop()?.replace(/\.ya?ml$/, '') ?? run.path);
    // A matrix job's name ends in its values, as `lab (forming)`, which is the same job for this table.
    const name = detailId(job.name.replace(/ \(.*\)$/, ''));
    const id = known.has(`${workflow}_${name}`) && `job_${name}_${sku}`.length <= MAX_DETAIL_ID ? name : 'other';
    add(`job_${id}_${sku}`, dollars(job));
    add(`min_${id}_${sku}`, billedMinutes(job));
    add(`day_${(job.started_at as string).slice(0, 10)}`, dollars(job));
    add('month_usd', dollars(job), ALLOWANCE_USD);
  }
  return readings;
}

/** Queue time by runner, shown beside the scored shared p90 (`queue_seconds_p90`), where a Mac wait would vanish. */
export function queueDetail(runs: readonly Run[], now: Date): Record<string, DetailReading> {
  const bySku = new Map<string, number[]>();
  for (const { job } of jobsSince(runs, now.getTime() - RECENT_DAYS * DAY_MS)) {
    if (!job.created_at) continue;
    const id = `queue_${skuName(job)}`;
    bySku.set(id, [...(bySku.get(id) ?? []), Math.max(0, (ms(job.started_at as string) - ms(job.created_at)) / 1000)]);
  }
  return Object.fromEntries([...bySku].map(([id, list]) => [id, { value: percentile(list, 95) as number, limit: null, n: list.length }]));
}

/** Which runs are this site's own: its workflow, or a pull request that is only the site's, before or after the merge. */
export function siteRunFilter(pulls: readonly PullRequest[]): (run: Run) => boolean {
  const site = pulls.filter(isSitePull);
  const merges = new Set(site.map((pull) => pull.merge_commit_sha).filter(Boolean));
  return (run) => {
    if (run.path.startsWith('.github/workflows/quality-speed')) return true;
    if (merges.has(run.head_sha)) return true;
    if (!run.head_branch || run.head_branch === 'main') return false;
    const at = ms(run.created_at);
    return site.some((pull) => pull.head_ref === run.head_branch && at >= ms(pull.created_at) && (!pull.closed_at || at <= ms(pull.closed_at) + DAY_MS));
  };
}

/**
 * CI on main that came out green first time. A rerun can't erase a red, so green only counts on the first attempt. A run
 * still open at 2 hours counts against main. Until each push to main got its own concurrency group (#242), GitHub cancelled
 * a pending run when a newer push queued: one with no jobs and a newer main run by its last update was replaced, and the
 * next run tested its tree, so it has no verdict. Such runs stay in the window for RECENT_DAYS.
 * This takes every run, because a site merge could replace a product run, and leaves out only this site's green ones: a
 * red main is a red main whoever caused it.
 */
export function mainGreen(runs: readonly Run[], isSite: (run: Run) => boolean, now: Date): Reading | null {
  const main = since(runs, now.getTime() - RECENT_DAYS * DAY_MS).filter((run) => run.path === CI && run.event === 'push' && run.head_branch === 'main');
  const replaced = (run: Run) =>
    run.conclusion === 'cancelled' && !run.jobs.length && main.some((other) => ms(other.created_at) > ms(run.created_at) && ms(other.created_at) <= ms(run.updated_at));
  const isGreen = (run: Run) => run.conclusion === 'success' && run.run_attempt === 1;
  const verdicts = main.filter((run) => (run.status === 'completed' ? !replaced(run) : now.getTime() - ms(run.created_at) > STALLED_MS) && !(isSite(run) && isGreen(run)));
  if (!verdicts.length) return null;
  const green = verdicts.filter(isGreen);
  return { value: (green.length / verdicts.length) * 100, samples: verdicts.length };
}

/** The steps of `checks` that gatesRan asks about. ledger.ts keeps one bit for each, and drops a ledger made with another list. */
export const GATE_STEPS = ['Secret scan', 'Web check', 'Web test', 'Web build', 'Worker dry runs', 'Lint workflows'] as const;
type GateStep = (typeof GATE_STEPS)[number];

/**
 * Of the product pull requests merged, how many ran what their files called for: the secret scan always, the web tests
 * when web/ changed, both Swift jobs on Swift paths, and the workflow lint on .github/. A step skipped or renamed away reads as not run.
 */
export function gatesRan(runs: readonly Run[], pulls: readonly PullRequest[], now: Date): Reading | null {
  const cutoff = now.getTime() - RECENT_DAYS * DAY_MS;
  const merged = pulls.filter((pull) => !isSitePull(pull) && pull.merged_at && ms(pull.merged_at) >= cutoff);
  if (!merged.length) return null;
  const ran = merged.filter((pull) => {
    const run = runs.find((r) => r.path === CI && r.event === 'pull_request' && r.head_sha === pull.head_sha && r.conclusion === 'success');
    if (!run) return false;
    const passed = (name: string) => run.jobs.filter((job) => job.name === name && job.runner_name && job.conclusion === 'success');
    const stepPassed = (name: GateStep) => passed('checks').some((job) => job.steps?.some((step) => step.name === name && step.conclusion === 'success'));
    const touches = (test: (file: string) => boolean) => pull.files.some(test);
    return (
      passed('ci-ok').length > 0 &&
      stepPassed('Secret scan') &&
      (!touches((f) => f.startsWith('web/')) || (['Web check', 'Web test', 'Web build', 'Worker dry runs'] as const).every(stepPassed)) &&
      (!touches((f) => SWIFT_PATH.test(f)) || (passed('swift').length > 0 && passed('swift-ocr').length > 0)) &&
      (!touches((f) => f.startsWith('.github/')) || stepPassed('Lint workflows'))
    );
  });
  return { value: (ran.length / merged.length) * 100, samples: merged.length };
}

/** Whether a job really ran a test. This site's own tests don't count. ledger.ts keeps the answer, so a change here needs a new LEDGER_VERSION. */
export const ranTests = (job: Job): boolean =>
  !!job.steps?.some((step) => /\btests?\b/i.test(step.name) && !/quality and speed/i.test(step.name) && (step.conclusion === 'success' || FAILED.has(step.conclusion ?? '')));

/**
 * A flake is a job that both passed and failed on the same files. A merged pull request that was up to date runs on the
 * same tree twice, on its branch and on main, so comparisons pile up with no rerun. A failed job always counts, since
 * failing before the tests is a likely flake, and a passed job only if its tests ran, so a push with no tests can't pad
 * the count. Only trees with something to compare count, one each, so a tree nobody compared can't read as clean.
 */
export function flakyShare(runs: readonly Run[], now: Date): Reading | null {
  const trees = new Map<string, Map<string, string[]>>();
  for (const run of since(runs, now.getTime() - FLAKY_DAYS * DAY_MS)) {
    const tree = run.head_commit?.tree_id;
    if (!tree || run.path !== CI) continue;
    for (const job of run.jobs) {
      const counts = FAILED.has(job.conclusion ?? '') || (job.conclusion === 'success' && ranTests(job));
      if (!TREE_JOBS.includes(job.name) || !counts) continue;
      const jobs = trees.get(tree) ?? new Map<string, string[]>();
      jobs.set(job.name, [...(jobs.get(job.name) ?? []), job.conclusion as string]);
      trees.set(tree, jobs);
    }
  }
  const compared = [...trees.values()].filter((jobs) => [...jobs.values()].some((list) => list.length >= 2));
  if (!compared.length) return null;
  const flaky = compared.filter((jobs) => [...jobs.values()].some((list) => list.includes('success') && list.some((c) => FAILED.has(c))));
  return { value: (flaky.length / compared.length) * 100, samples: compared.length };
}

/** A deleted run takes its spend and any red with it. GitHub numbers each workflow's runs in order, so a gap is a run someone deleted. */
export function deletedRuns(runs: readonly Run[]): Reading | null {
  const byWorkflow = new Map<string, number[]>();
  for (const run of runs) byWorkflow.set(run.path, [...(byWorkflow.get(run.path) ?? []), run.run_number]);
  if (!runs.length) return null;
  const gaps = [...byWorkflow.values()].map((numbers) => Math.max(...numbers) - Math.min(...numbers) + 1 - new Set(numbers).size);
  return { value: gaps.reduce((sum, gap) => sum + gap, 0), samples: runs.length };
}

/** Dollars per merged product pull request. The forecast alone could be met by merging nothing. */
export function usdPerMerge(runs: readonly Run[], pulls: readonly PullRequest[], now: Date): Reading | null {
  const cutoff = now.getTime() - RECENT_DAYS * DAY_MS;
  const merges = pulls.filter((pull) => !isSitePull(pull) && pull.merged_at && ms(pull.merged_at) >= cutoff).length;
  return merges ? { value: spendUsd(runs, cutoff) / merges, samples: merges } : null;
}

/** Billed runner minutes per merged product pull request, every runner counted alike: the time CI takes, whatever it costs. */
export function minutesPerMerge(runs: readonly Run[], pulls: readonly PullRequest[], now: Date): Reading | null {
  const cutoff = now.getTime() - RECENT_DAYS * DAY_MS;
  const merges = pulls.filter((pull) => !isSitePull(pull) && pull.merged_at && ms(pull.merged_at) >= cutoff).length;
  return merges ? { value: jobsSince(runs, cutoff).reduce((sum, { job }) => sum + billedMinutes(job), 0) / merges, samples: merges } : null;
}

/**
 * Minutes from a push to every required check green, for pushes that ran tests and passed first time. Failures have no
 * time to green, and a docs-only push would flatter the middle. A bot skips dco, and a later ready_for_review is a
 * separate event, not this push's wait.
 */
export function minutesToGreen(runs: readonly Run[], now: Date): number[] {
  const bySha = new Map<string, Run[]>();
  for (const run of since(runs, now.getTime() - RECENT_DAYS * DAY_MS)) {
    if (run.event === 'pull_request' && REQUIRED_JOBS[run.path]) bySha.set(run.head_sha, [...(bySha.get(run.head_sha) ?? []), run]);
  }
  const minutes: number[] = [];
  for (const group of bySha.values()) {
    const anchor = group.find((run) => run.path === CI);
    if (!anchor || !anchor.jobs.some(ranTests)) continue;
    const start = ms(anchor.created_at);
    const push = group.filter((run) => run.conclusion !== 'skipped' && Math.abs(ms(run.created_at) - start) <= SAME_PUSH_MS);
    const required = push.map((run) => run.jobs.find((job) => job.name === REQUIRED_JOBS[run.path] && (job.run_attempt ?? 1) === 1));
    if (required.every((job) => job?.conclusion === 'success' && job.completed_at)) {
      minutes.push((Math.max(...required.map((job) => ms(job?.completed_at as string))) - start) / 60_000);
    }
  }
  return minutes;
}

/** The slowest p95 among jobs a pull request waits on, over jobs with enough runs to have one. */
export function slowestJobMinutes(runs: readonly Run[], now: Date, minSamples = 3): Reading | null {
  const byJob = new Map<string, number[]>();
  for (const { run, job } of jobsSince(runs, now.getTime() - RECENT_DAYS * DAY_MS)) {
    if (run.event !== 'pull_request') continue;
    const key = `${run.path} ${job.name}`;
    byJob.set(key, [...(byJob.get(key) ?? []), (ms(job.completed_at as string) - ms(job.started_at as string)) / 60_000]);
  }
  const worst = [...byJob.values()].filter((list) => list.length >= minSamples).map((list) => percentile(list, 95) as number);
  if (!worst.length) return null;
  return { value: Math.max(...worst), samples: [...byJob.values()].reduce((sum, list) => sum + list.length, 0) };
}

/** A record in the site's format. Anything unproven is `missing`, with nothing that could read as a value. */
export function toRecord(id: string, reading: Reading | null, stage: 'lab' | 'live', measuredAt: string, sourceUrl: string | null) {
  if (!reading || !sourceUrl) return { id, page: 'actions', value: null, status: 'missing', stage, measured_at: null, source_url: null, sample_size: null };
  return { id, page: 'actions', value: Number(reading.value.toFixed(6)), status: 'ok', stage, measured_at: measuredAt, source_url: sourceUrl, sample_size: reading.samples };
}
