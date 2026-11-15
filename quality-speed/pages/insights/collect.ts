// SPDX-License-Identifier: Apache-2.0
// The Insights collector: reads merged history from GitHub's REST API, runs the planted drill, and writes the page's
// records and drill-down rows. Any error writes every metric as missing, never a number (PLAN.md, "Metrics").
//
//   node quality-speed/pages/insights/collect.ts --out <records.json> [--now <UTC time>]
//
// As the daily workflow runs it (core/collect.ts, lanes.json): the records go to --out, and the drill-down rows to
// $DETAIL_DIR/page/detail.json, which the workflow puts beside page.ts before the build. Run by hand, with no $DETAIL_DIR,
// the rows and the readings (what the run read, which a run by hand can't score) go beside the records file instead.
// Numbers, dates and pull request numbers only. After a good read, lane_minutes is core/lane's laneRecord(): this lane's job
// minutes so far, read last so they cover every read.
//
// The token is read from GH_TOKEN, as the workflow passes it, or GITHUB_TOKEN. In a cloud session the proxy signs
// requests instead, and Node needs NODE_USE_ENV_PROXY=1 to use it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAY_MS,
  FETCH_DAYS,
  REPO_FULL,
  analyze,
  type History,
  type PullFacts,
  type RawPull,
  type RawRun,
  type Reviewed,
} from './delivery.ts';
import { laneRecord } from '../../core/lane/collect.ts';
import { drill } from './drill.ts';
import { GitHubError, reader, type Reader } from './github.ts';
import {
  allMissing,
  buildDetail,
  buildRecords,
  readAll,
  readingsFile,
  utc,
  type Detail,
  type MetricReading,
  type RunContext,
} from './records.ts';

const REPO = `/repos/${REPO_FULL}`;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

interface RawIssue {
  number: number;
  pull_request?: unknown;
  labels: ({ name: string } | string)[];
}
interface RawCommit {
  commit: { author: { date: string } | null; committer: { date: string } | null };
}
interface RawFile {
  filename: string;
  previous_filename?: string;
}
interface RunsPage {
  total_count: number;
  workflow_runs: RawRun[];
}

async function facts(gh: Reader, number: number): Promise<PullFacts> {
  const commits = await gh.pages<RawCommit>(`${REPO}/pulls/${number}/commits?per_page=100`);
  const times = commits
    .map((c) => c.commit.author?.date ?? c.commit.committer?.date)
    .filter((d): d is string => typeof d === 'string')
    .map((d) => Date.parse(d));
  const files = await gh.pages<RawFile>(`${REPO}/pulls/${number}/files?per_page=100`);
  return {
    firstCommitAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    files: files.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename])),
  };
}

/** CI runs on pushes to main, a week at a time: a filtered query returns at most 1,000 runs. */
async function ciRuns(gh: Reader, now: number): Promise<RawRun[]> {
  const runs: RawRun[] = [];
  for (let end = now; end > now - (FETCH_DAYS + 1) * DAY_MS; end -= 7 * DAY_MS) {
    const range = `${day(end - 6 * DAY_MS)}..${day(end)}`;
    let total = -1;
    const got = await gh.pages<RawRun>(
      `${REPO}/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=100&created=${range}`,
      (body) => {
        const page = body as RunsPage;
        if (!Array.isArray(page.workflow_runs)) throw new GitHubError('runs page without workflow_runs');
        total = page.total_count;
        return page.workflow_runs;
      },
    );
    if (got.length !== total || total >= 1000) throw new GitHubError('CI runs read short');
    runs.push(...got);
  }
  return [...new Map(runs.map((r) => [r.id, r])).values()];
}

export async function readHistory(gh: Reader, now: number): Promise<History> {
  // As things stood at `now`: later pull requests did not exist yet, and later merges had not happened.
  const pulls = (await gh.pages<RawPull>(`${REPO}/pulls?state=all&per_page=100&sort=created&direction=desc`))
    .filter((p) => Date.parse(p.created_at) <= now)
    .map((p) => (p.merged_at !== null && Date.parse(p.merged_at) > now ? { ...p, merged_at: null, merge_commit_sha: null } : p));
  const issues = await gh.pages<RawIssue>(`${REPO}/issues?state=all&per_page=100`);
  const onlyIssues = issues.filter((i) => i.pull_request === undefined);
  const since = now - FETCH_DAYS * DAY_MS;
  const recent = pulls.filter(
    (p) => p.base.ref === 'main' && p.merged_at !== null && Date.parse(p.merged_at) >= since && Date.parse(p.merged_at) <= now,
  );
  const factMap = new Map<number, PullFacts>();
  for (const p of recent) factMap.set(p.number, await facts(gh, p.number));
  return {
    pulls,
    facts: factMap,
    runs: (await ciRuns(gh, now)).filter((r) => Date.parse(r.created_at) <= now),
    issues: new Set(onlyIssues.map((i) => i.number)),
    bugIssues: new Set(
      onlyIssues.filter((i) => i.labels.some((l) => (typeof l === 'string' ? l : l.name) === 'bug')).map((i) => i.number),
    ),
  };
}

/** The reviewed list beside this file (PLAN.md, "Metrics"). */
export function loadReviewed(file = fileURLToPath(new URL('reviewed.json', import.meta.url))): Reviewed {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Reviewed;
  const whole = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
  const ok =
    typeof raw.reviewed_through === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw.reviewed_through) &&
    Array.isArray(raw.repairs) &&
    raw.repairs.every((r) => whole(r.pr) && whole(r.repairs)) &&
    Array.isArray(raw.not_backlog_issues) &&
    raw.not_backlog_issues.every(whole) &&
    (raw.backlog_board === null || whole(raw.backlog_board));
  if (!ok) throw new GitHubError('reviewed.json does not hold numbers and a date only');
  return {
    reviewed_through: raw.reviewed_through,
    repairs: raw.repairs,
    not_backlog_issues: raw.not_backlog_issues,
    backlog_board: raw.backlog_board,
  };
}

export interface Collected {
  records: ReturnType<typeof allMissing>;
  /** What was read, for the summary a hand run prints: outside Actions every record is missing. */
  readings: MetricReading[];
  detail: Detail | null;
  drillChecks: Record<string, boolean>;
  calls: number;
  error: string | null;
}

export async function collect(gh: Reader, now: number, env: NodeJS.ProcessEnv, reviewedFile?: string): Promise<Collected> {
  try {
    const reviewed = loadReviewed(reviewedFile);
    // The head of main as it stood at `now`, so a run for an earlier time reads the history it would have read then.
    const heads = await gh.get<{ sha: string }[]>(`${REPO}/commits?sha=main&per_page=1&until=${utc(now)}`);
    const head = heads[0];
    if (!head || !/^[0-9a-f]{40}$/.test(head.sha)) throw new GitHubError('main has no commit SHA');
    const history = await readHistory(gh, now);
    const analysis = analyze(history, now, reviewed);
    const result = drill(history, analysis, now, reviewed);
    const runId = env.GITHUB_RUN_ID;
    const ctx: RunContext = {
      measuredAt: utc(now),
      commit: head.sha,
      runUrl:
        runId && /^[1-9]\d*$/.test(runId) && env.GITHUB_REPOSITORY === REPO_FULL
          ? `https://github.com/${REPO_FULL}/actions/runs/${runId}`
          : null,
    };
    return {
      records: buildRecords(analysis, result, ctx),
      readings: readAll(analysis, result),
      detail: buildDetail(analysis, ctx),
      drillChecks: result.checks,
      calls: gh.calls(),
      error: null,
    };
  } catch (e) {
    // Only our own messages, which name a status and a path, are printed; anything else could hold a response body.
    const error = e instanceof GitHubError ? e.message : 'the collector failed';
    return { records: allMissing(), readings: [], detail: null, drillChecks: {}, calls: gh.calls(), error };
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = arg('--out');
  if (!out) throw new Error('--out <records.json> is required');
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || undefined;
  // GitHub's next-page links may name this repository by id. A proxy that allows owner/name paths only refuses those,
  // so this repository's own id is mapped back to its path; any other id is left alone.
  // If the lookup fails, nothing is rewritten, and the collector's own reads fail and write every metric missing.
  const id = await reader({ token })
    .get<{ id: number }>(REPO)
    .then((r) => r.id)
    .catch(() => null);
  const byId = id === null ? null : `https://api.github.com/repositories/${id}/`;
  const gh = reader({
    token,
    rewrite: (url) => (byId !== null && url.startsWith(byId) ? `https://api.github.com${REPO}/${url.slice(byId.length)}` : url),
  });
  // --now replays an earlier time, such as the baseline's; the history after it is ignored.
  const nowArg = arg('--now');
  const now = nowArg ? Date.parse(nowArg) : Date.now();
  if (!Number.isFinite(now)) throw new Error('--now needs a UTC time such as 2026-11-02T04:38:11Z');
  const result = await collect(gh, now, process.env);
  const records = result.error ? result.records : [...result.records, await laneRecord('insights')];
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify(records, null, 2)}\n`);
  if (result.detail) {
    const lane = process.env.DETAIL_DIR;
    const rows = lane ? path.join(lane, 'page') : path.dirname(path.resolve(out));
    mkdirSync(rows, { recursive: true });
    writeFileSync(path.join(rows, 'detail.json'), `${JSON.stringify(result.detail)}\n`);
    if (!lane) writeFileSync(path.join(rows, 'readings.json'), `${JSON.stringify(readingsFile(result.detail, result.readings), null, 2)}\n`);
  }
  const failedChecks = Object.entries(result.drillChecks).filter(([, ok]) => !ok).map(([name]) => name);
  if (result.error) console.error(`insights: ${result.calls} GitHub calls; every metric missing: ${result.error}`);
  else console.error(`insights: ${result.calls} GitHub calls; drill ${failedChecks.length ? `failed: ${failedChecks.join(', ')}` : 'passed'}`);
  // Numbers only. Outside Actions the records are all missing, since a score needs a run link, so this is the reading.
  for (const r of result.readings) {
    const shown = r.withheld ? 'withheld (drill failed)' : r.noEvents ? 'no events' : r.value === null ? 'missing' : String(r.value);
    console.error(`  ${r.id}: ${shown} (${r.samples} samples)`);
  }
}
