// SPDX-License-Identifier: Apache-2.0
// The Reliability page's collector (PLAN.md says why each metric). It reads bug issues and failed runs on main with the
// job's token, and prints ids and counts only. A failed read leaves every metric missing, the drill reads 0 and the job
// fails, so a broken read can never pass for a good number or a green job.
//
//   node quality-speed/pages/reliability/collect.ts --out <file>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { billedMinutes, CANARY_ISSUE, detectionDrill, landedSha, measure, METRIC_IDS, toRecord, WINDOW_DAYS, type Bug, type FailedRun, type MetricId, type Reading, type Review } from './measure.ts';

const API = 'https://api.github.com';
const FAILED_STATES = ['failure', 'timed_out', 'startup_failure'];
/** This site's own workflows are not the product's failures, and the replica eval is never read. */
const SKIPPED_WORKFLOWS = new Set(['.github/workflows/quality-speed.yml', '.github/workflows/quality-speed-screens.yml', '.github/workflows/replica-eval.yml']);
const BUG_LABEL = 'bug';

const ISSUES = `query ($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number state stateReason createdAt closedAt body
        labels(first: 20) { nodes { name } }
        timelineItems(first: 50, itemTypes: [REOPENED_EVENT, UNLABELED_EVENT, MARKED_AS_DUPLICATE_EVENT]) {
          nodes {
            __typename
            ... on ReopenedEvent { createdAt }
            ... on UnlabeledEvent { createdAt label { name } }
            ... on MarkedAsDuplicateEvent { createdAt canonical { ... on Issue { number } } }
          }
        }
        closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { nodes { merged files(first: 100) { nodes { path } } } }
      }
    }
  }
}`;

export interface IssueNode extends Omit<Bug, 'reopenedAt' | 'unlabeledAt' | 'closedBy' | 'landedAt' | 'duplicateOf'> {
  labels: { nodes: { name: string }[] };
  timelineItems: { nodes: { __typename: string; createdAt: string; label?: { name: string }; canonical?: { number?: number } | null }[] };
  closedByPullRequestsReferences: { nodes: { merged: boolean; files: { nodes: { path: string }[] } }[] };
}

interface RunRow {
  id: number;
  created_at: string;
  head_branch: string;
  path: string;
  event: string;
}

function github(token: string) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const response = await fetch(`${API}${url}`, { ...init, headers });
    // 404 and 422 are a commit this repository does not have, which the caller reads as an unknown sha.
    if (!response.ok && response.status !== 404 && response.status !== 422) throw new Error(`GitHub answered ${response.status}`);
    return response;
  };
}

type Get = ReturnType<typeof github>;

async function readIssues(get: Get, owner: string, name: string): Promise<IssueNode[]> {
  const nodes: IssueNode[] = [];
  let after: string | null = null;
  for (;;) {
    const response = await get('/graphql', { method: 'POST', body: JSON.stringify({ query: ISSUES, variables: { owner, name, after } }) });
    const { data, errors } = (await response.json()) as {
      data?: { repository: { issues: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: IssueNode[] } } };
      errors?: unknown[];
    };
    if (!data || errors?.length) throw new Error('GitHub answered with errors');
    const { issues } = data.repository;
    nodes.push(...issues.nodes);
    if (!issues.pageInfo.hasNextPage) return nodes;
    after = issues.pageInfo.endCursor;
  }
}

/** The date of a commit a Landed line names, or null for a sha this repository does not have. */
async function commitDate(get: Get, repo: string, sha: string, known: Map<string, string | null>): Promise<string | null> {
  if (!known.has(sha)) {
    const response = await get(`/repos/${repo}/commits/${sha}`);
    known.set(sha, response.ok ? ((await response.json()) as { commit: { committer: { date: string } } }).commit.committer.date : null);
  }
  return known.get(sha) ?? null;
}

async function listRuns(get: Get, repo: string, query: string): Promise<RunRow[]> {
  const rows: RunRow[] = [];
  for (let page = 1; ; page += 1) {
    const response = await get(`/repos/${repo}/actions/runs?branch=main&${query}&per_page=100&page=${page}`);
    if (!response.ok) throw new Error('The runs list is missing');
    const { workflow_runs: found } = (await response.json()) as { workflow_runs: RunRow[] };
    rows.push(...found);
    if (found.length < 100) return rows;
  }
}

/** A run's minutes over every attempt's jobs, or null when its list can't be read, so only that metric reads missing. */
async function runMinutes(get: Get, repo: string, id: number): Promise<number | null> {
  const jobs: { started_at: string | null; completed_at: string | null }[] = [];
  for (let page = 1; ; page += 1) {
    const response = await get(`/repos/${repo}/actions/runs/${id}/jobs?filter=all&per_page=100&page=${page}`).catch(() => null);
    if (!response?.ok) return null;
    const { jobs: found } = (await response.json()) as { jobs: { started_at: string | null; completed_at: string | null }[] };
    jobs.push(...found);
    if (found.length < 100) return billedMinutes(jobs);
  }
}

async function readFailedRuns(get: Get, repo: string, now: Date): Promise<FailedRun[]> {
  const from = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const runs: FailedRun[] = [];
  for (const state of FAILED_STATES) {
    const rows = await listRuns(get, repo, `status=${state}&created=%3E%3D${from}`);
    for (const row of rows.filter((row) => !SKIPPED_WORKFLOWS.has(row.path) && row.event !== 'pull_request')) {
      runs.push({ id: row.id, createdAt: row.created_at, minutes: await runMinutes(get, repo, row.id) });
    }
  }
  return runs;
}

/** Whether the runs list still answers for main: one completed run is enough, so this reads one page of one run. */
async function runsListed(get: Get, repo: string): Promise<boolean> {
  const response = await get(`/repos/${repo}/actions/runs?branch=main&status=completed&per_page=1`);
  if (!response.ok) return false;
  const { workflow_runs: rows } = (await response.json()) as { workflow_runs: RunRow[] };
  return rows[0]?.head_branch === 'main';
}

const hasBugLabel = (node: IssueNode) => node.labels.nodes.some((label) => label.name === BUG_LABEL);
const eventsOf = (node: IssueNode, type: string) => node.timelineItems.nodes.filter((event) => event.__typename === type);

/** An issue as the page reads it. The `bug` label coming off is kept: until it goes back on, the issue still counts. */
export function bugOf(node: IssueNode, landedAt: string | null): Bug {
  const off = eventsOf(node, 'UnlabeledEvent').filter((event) => event.label?.name === BUG_LABEL).map((event) => event.createdAt).sort();
  return {
    number: node.number,
    state: node.state,
    stateReason: node.stateReason,
    duplicateOf: eventsOf(node, 'MarkedAsDuplicateEvent').at(-1)?.canonical?.number ?? null,
    createdAt: node.createdAt,
    closedAt: node.closedAt,
    body: node.body,
    reopenedAt: eventsOf(node, 'ReopenedEvent').map((event) => event.createdAt),
    unlabeledAt: hasBugLabel(node) ? null : (off.at(-1) ?? null),
    closedBy: node.closedByPullRequestsReferences.nodes.filter((pull) => pull.merged).map((pull) => pull.files.nodes.map((file) => file.path)),
    landedAt,
  };
}

/**
 * Which issues count: those with the `bug` label, or that lost it. Only the canary is left out, by number, because a label
 * would be a way out for a real bug. It counts as the canary only while it carries `bug`, so a renamed label fails the drill.
 */
export function sortIssues(nodes: readonly IssueNode[]): { bugs: IssueNode[]; canary: IssueNode | undefined } {
  const lostBugLabel = (node: IssueNode) => eventsOf(node, 'UnlabeledEvent').some((event) => event.label?.name === BUG_LABEL);
  return {
    bugs: nodes.filter((node) => node.number !== CANARY_ISSUE && (hasBugLabel(node) || lostBugLabel(node))),
    canary: nodes.find((node) => node.number === CANARY_ISSUE && hasBugLabel(node)),
  };
}

/** Every reading, and what the drill needs from the live reads. */
async function read(token: string, repo: string, reviews: readonly Review[], now: Date) {
  const [owner = '', name = ''] = repo.split('/');
  const get = github(token);
  const sorted = sortIssues(await readIssues(get, owner, name));
  const known = new Map<string, string | null>();
  const read = async (node: IssueNode) => {
    const sha = landedSha(node.body);
    return bugOf(node, sha ? await commitDate(get, repo, sha, known) : null);
  };
  const bugs: Bug[] = [];
  for (const node of sorted.bugs) bugs.push(await read(node));
  const canary = sorted.canary ? await read(sorted.canary) : undefined;
  return { readings: measure(bugs, await readFailedRuns(get, repo, now), reviews, now), canary, listed: await runsListed(get, repo) };
}

export async function main(args = process.argv.slice(2), readLive = read): Promise<void> {
  const { values } = parseArgs({ args, options: { out: { type: 'string' } } });
  const { GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (!values.out) throw new Error('usage: collect.ts --out <file>');
  const repo = GITHUB_REPOSITORY ?? 'Colorado-Startups/legallas';
  const now = new Date();
  const measuredAt = `${now.toISOString().slice(0, 19)}Z`;
  const sourceUrl = GITHUB_RUN_ID ? `https://github.com/${repo}/actions/runs/${GITHUB_RUN_ID}` : null;
  const { reviews } = JSON.parse(readFileSync(new URL('./reviews.json', import.meta.url), 'utf8')) as { reviews: Review[] };

  let readings: Partial<Record<MetricId, Reading>> = {};
  let drill = detectionDrill(undefined, false);
  let failed = false;
  try {
    const live = await readLive(GH_TOKEN ?? '', repo, reviews, now);
    readings = live.readings;
    drill = detectionDrill(live.canary, live.listed);
  } catch (error) {
    console.error(`read failed: ${error instanceof Error ? error.constructor.name : 'unknown'}`);
    failed = true;
  }
  readings.detection_drill = { value: drill, samples: 1 };

  const records = METRIC_IDS.map((id) => toRecord(id, readings[id] ?? null, measuredAt, sourceUrl));
  mkdirSync(path.dirname(values.out), { recursive: true });
  writeFileSync(values.out, `${JSON.stringify(records, null, 1)}\n`);
  console.log(`${records.filter((record) => record.status !== 'missing').length} of ${records.length} metrics measured, drill ${drill}`);
  if (failed) process.exitCode = 1;
}

if (import.meta.main) await main();
