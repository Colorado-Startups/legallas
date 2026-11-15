// SPDX-License-Identifier: Apache-2.0
// The GitHub App page's collector, as core/collect.ts runs it. The App is Legallas Automation (expected.json). It reads the
// App's permissions as GitHub lists them (GET /apps/{slug}), and the last 30 days of the jobs that ran a step minting the App's
// token, found in the checkout's workflows by the App's client id variable. It reads with the lane's read-only token, and the
// permissions with QS_APP_TOKEN when the job has one (PLAN.md, "The App token"). It never sees the App's key. Anything it
// can't read writes missing, never 0. Last, lane_minutes: this lane's own job time (core/lane/collect.ts).
//
//   GH_TOKEN=... node quality-speed/pages/github-app/collect.ts --out records.json [--run-url <a run link of this repository>]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';
import { REPO } from '../../contract/pages.ts';
import { laneRecord } from '../../core/lane/collect.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PAGE = 'github-app' as const;
const API = `/repos/Colorado-Startups/${REPO}`;
/** A step that mints a token, and the App it mints for: its client id, a repository variable. */
const MINTS = /^\s*(?:-\s+)?uses:\s*(actions\/create-github-app-token@[^\s#]+)/;
const CLIENT_ID = 'vars.CS_APP_CLIENT_ID';
export const WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
/** Jobs that ran to an answer. A skipped job (a branch run, which can't reach the key) or a cancelled one answered nothing. */
const ANSWERED = new Set(['success', 'failure', 'timed_out']);
const LEVELS = new Set(['read', 'write', 'admin']);

export interface Expected {
  app: string;
  permissions: Record<string, string>;
}
export interface Job {
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps?: { name?: unknown; conclusion?: unknown }[];
}
export interface Workflow {
  file: string;
  /** The names the jobs API gives its steps that mint the App's token. */
  steps: string[];
}
export interface Run {
  now: string;
  /** The run on the commit being scored. */
  sourceUrl: string;
}
/** One GET of GitHub's REST API by path: the parsed body, or null on any failure. */
export type Get = (apiPath: string) => Promise<unknown>;

export const EXPECTED: Expected = JSON.parse(readFileSync(new URL('./expected.json', import.meta.url), 'utf8'));

/**
 * The steps in one workflow file that mint this App's token, by the name the jobs API gives each: its `name`, or GitHub's
 * `Run <action>` for a step with none. A step runs from its dash to the next line indented no deeper.
 */
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

/** The workflow files with a step that mints this App's token. */
export function appWorkflows(dir = path.join(ROOT, '.github/workflows')): Workflow[] {
  return readdirSync(dir)
    .filter((file) => /^[\w.-]+\.ya?ml$/.test(file))
    .sort()
    .map((file) => ({ file, steps: tokenSteps(readFileSync(path.join(dir, file), 'utf8')) }))
    .filter((w) => w.steps.length > 0);
}

/** The permissions whose level differs from the expected list: extra, missing or at another level, out of every name read. */
export function permissionsOff(want: Record<string, string>, have: Record<string, string>): { off: string[]; read: number } {
  const names = [...new Set([...Object.keys(want), ...Object.keys(have)])].sort();
  return { off: names.filter((n) => want[n] !== have[n]), read: names.length };
}

const seconds = (j: Job) => (Date.parse(j.completed_at ?? '') - Date.parse(j.started_at ?? '')) / 1000;
const answered = (j: Job) => ANSWERED.has(j.conclusion ?? '') && seconds(j) >= 0;

/** The share of answered jobs that passed and their median time in whole seconds, or null when none answered. */
export function measure(jobs: readonly Job[]): { passing: number; p50: number; n: number } | null {
  const done = jobs.filter(answered);
  if (!done.length) return null;
  const s = done.map(seconds).sort((a, b) => a - b);
  const mid = s.length >> 1;
  const p50 = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2; // safe: at least one value
  const passing = Math.round((10_000 * done.filter((j) => j.conclusion === 'success').length) / done.length) / 100;
  return { passing, p50: Math.round(p50), n: done.length };
}

/** The App's permissions as GitHub lists them, or null when it can't be read or isn't this App. */
export async function readPermissions(get: Get, slug: string): Promise<Record<string, string> | null> {
  const app = (await get(`/apps/${slug}`)) as { slug?: unknown; permissions?: unknown } | null;
  const p = app?.slug === slug ? app.permissions : null;
  const good = p !== null && typeof p === 'object' && !Array.isArray(p) && Object.values(p).every((v) => LEVELS.has(v as string));
  return good ? (p as Record<string, string>) : null;
}

/** Whether a job ran one of these steps: a step skipped, or never reached, minted nothing. */
const ranStep = (job: Job, names: readonly string[]) => job.steps?.some((s) => names.includes(s.name as string) && ANSWERED.has(s.conclusion as string)) === true;

/** Every attempt of every job that ran a token step, in these workflows' runs created in the window; null when any read fails. */
export async function readJobs(get: Get, workflows: readonly Workflow[], now: Date): Promise<Job[] | null> {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const jobs: Job[] = [];
  for (const { file, steps } of workflows) {
    const listed = (await get(`${API}/actions/workflows/${file}/runs?status=completed&created=%3E%3D${since}&per_page=100`)) as { workflow_runs?: { id?: unknown }[] } | null;
    if (!Array.isArray(listed?.workflow_runs)) return null;
    for (const { id } of listed.workflow_runs) {
      if (!Number.isSafeInteger(id)) return null;
      const run = (await get(`${API}/actions/runs/${id}/jobs?filter=all&per_page=100`)) as { jobs?: Job[] } | null;
      if (!Array.isArray(run?.jobs)) return null;
      jobs.push(...run.jobs.filter((job) => ranStep(job, steps)));
    }
  }
  return jobs;
}

const missing = (id: string): MetricRecord => ({ id, page: PAGE, value: null, status: 'missing', stage: 'live', measured_at: null, source_url: null, sample_size: null });
const ok = (id: string, value: number, sample: number, run: Run): MetricRecord => ({ id, page: PAGE, value, status: 'ok', stage: 'live', measured_at: run.now, source_url: run.sourceUrl, sample_size: sample });

/** The page's records from what was read: null for a read that failed, which writes missing. */
export function collect(permissions: Record<string, string> | null, jobs: readonly Job[] | null, run: Run): MetricRecord[] {
  const off = permissions && permissionsOff(EXPECTED.permissions, permissions);
  const done = jobs && measure(jobs);
  return [
    off ? ok('app_permissions_off', off.off.length, off.read, run) : missing('app_permissions_off'),
    done ? ok('app_token_runs_passing', done.passing, done.n, run) : missing('app_token_runs_passing'),
    done ? ok('app_token_job_seconds_p50', done.p50, done.n, run) : missing('app_token_job_seconds_p50'),
  ];
}

/** GETs with one token. No token, a refusal or a network failure reads null. */
export function getter(token: string | undefined): Get {
  return async (apiPath) => {
    if (!token) return null;
    try {
      const response = await fetch(`https://api.github.com${apiPath}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(15_000),
      });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, 'run-url': { type: 'string' } } });
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: id, GH_TOKEN, QS_APP_TOKEN } = process.env;
  const sourceUrl = values['run-url'] ?? (server && repo && id ? `${server}/${repo}/actions/runs/${id}` : undefined);
  if (!values.out || !sourceUrl) {
    console.error('usage: collect.ts --out <file> [--run-url <run link>]');
    process.exit(1);
  }
  const now = new Date();
  const workflows = appWorkflows();
  const permissions = await readPermissions(getter(QS_APP_TOKEN || GH_TOKEN), EXPECTED.app);
  const jobs = workflows.length ? await readJobs(getter(GH_TOKEN), workflows, now) : null;
  const records = collect(permissions, jobs, { now: `${now.toISOString().slice(0, 19)}Z`, sourceUrl });
  // Last, after every read, so it times the whole lane.
  records.push(await laneRecord(PAGE));
  writeFileSync(values.out, `${JSON.stringify(records)}\n`);
  console.log(`workflows minting the App's token: ${workflows.map((w) => w.file).join(' ') || 'none'}`);
  if (permissions) console.log(`permissions off: ${permissionsOff(EXPECTED.permissions, permissions).off.filter((n) => /^[a-z_]+$/.test(n)).join(' ') || 'none'}`);
  for (const r of records) console.log(`${r.id}: ${r.status}`);
}
