// Issues page collector (lanes.json), run by core/collect.ts as `node collect.ts --out <file>`. Reads issues through the
// REST API and their closers through GraphQL, or a saved dump with --input, and writes numbers and issue numbers only:
//   <file>                       records in the shared format (quality-speed/contract)
//   $DETAIL_DIR/detail.json      open issues by rank and severity, counts only (measure.ts detail), for the page
//   $DETAIL_DIR/facts/rows.json  the lane's memory, never published: { rows: one per open issue, excluded: issue numbers
//                                left out as this site's own }. Outside a lane, both land beside <file>.
// Only a workflow run proves a reading, so outside one every record is missing; the readings still print, for a
// baseline. Any failed read makes every record missing: an API error never reads as good news.
//
//   GH_TOKEN=... GITHUB_RUN_ID=... node quality-speed/pages/issues/collect.ts --out <file>
//   node quality-speed/pages/issues/collect.ts --out <file> --input <dump.json> [--now <utc>]
// Reads: the issue list, one GraphQL call per 50 completed closes since CONFIG.closes_since, one per 50 open issues
// (reopened), one for the labels' use counts, one for the milestones. Last, after a
// good read, lane_minutes: this lane's job minutes so far, from core/lane (laneRecord), so they cover every read above.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { laneRecord } from "../../core/lane/collect.ts";
import type { Detail } from "../../core/detail.ts";
import { CONFIG, closesSince, inScope, rows, type Row } from "./compute.ts";
import { allMissing, checkIssues, CollectError, detail, readings, records, type Manifest, type RepoFacts } from "./measure.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = "Colorado-Startups/legallas";
const MAX_PAGES = 50;

/** Calls this run has made to the API, printed at the end: the Consumption reading to come. */
let calls = 0;

/** A GET, or with `body` a POST of it as JSON (GraphQL). Throws on anything but 200. */
async function call(url: string, token: string, body?: unknown): Promise<Response> {
  calls++;
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (res.status !== 200) throw new CollectError(`read failed: HTTP ${res.status}`);
  return res;
}

/** Every issue and pull request in the repo, following the Link header. Throws on anything but 200. */
export async function fetchIssues(token: string): Promise<unknown[]> {
  const out: unknown[] = [];
  let url: string | null = `https://api.github.com/repos/${REPO}/issues?state=all&per_page=100`;
  for (let page = 0; url !== null && page < MAX_PAGES; page++) {
    const res: Response = await call(url, token);
    const batch: unknown = await res.json();
    if (!Array.isArray(batch)) throw new CollectError("issues read failed: not a list");
    out.push(...batch);
    url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null;
  }
  if (url !== null) throw new CollectError(`issues read failed: more than ${MAX_PAGES} pages`);
  return out;
}

/**
 * Whether an issue's latest close came from a merged pull request or a commit: GraphQL's `ClosedEvent.closer`, from one
 * issue's `timelineItems(itemTypes: [CLOSED_EVENT], last: 1)`. Not REST's `commit_id`: a merge-queue merge leaves it
 * null, so every close by a PR read as by hand. No close read is undefined: unmeasured, never a guess.
 */
export function closedByPr(issue: unknown): boolean | undefined {
  const nodes = (issue as { timelineItems?: { nodes?: unknown } } | null)?.timelineItems?.nodes;
  if (!Array.isArray(nodes)) throw new CollectError("closers read failed: no timeline");
  const last = nodes.at(-1) as { closer?: { __typename?: unknown } | null } | undefined;
  if (last === undefined) return undefined;
  const kind = last.closer?.__typename;
  return kind === "PullRequest" || kind === "Commit";
}

/** Issues per GraphQL call: one alias each. */
const CLOSERS_PER_CALL = 50;

/** One GraphQL query asking `selection` of each issue, one alias (`i<n>`) per issue. */
function perIssueQuery(numbers: readonly number[], selection: string): string {
  const [owner, name] = REPO.split("/");
  const fields = numbers.map((n) => {
    if (!Number.isSafeInteger(n) || n < 1) throw new CollectError("issue read failed: not an issue number");
    return `i${n}: issue(number: ${n}) { ${selection} }`;
  });
  return `query { repository(owner: "${owner}", name: "${name}") { ${fields.join(" ")} } }`;
}

/** The GraphQL query for these issues' latest closers. */
export const closersQuery = (numbers: readonly number[]) =>
  perIssueQuery(numbers, "timelineItems(itemTypes: [CLOSED_EVENT], last: 1) { nodes { ... on ClosedEvent { closer { __typename } } } }");

/** The GraphQL query for how often each of these issues was reopened. */
export const reopenedQuery = (numbers: readonly number[]) => perIssueQuery(numbers, "timelineItems(itemTypes: [REOPENED_EVENT]) { totalCount }");

/** The labels' use counts: issues and pull requests in any state. */
export const LABELS_QUERY = `query { repository(owner: "${REPO.split("/")[0]}", name: "${REPO.split("/")[1]}") { labels(first: 100) { pageInfo { hasNextPage } nodes { issues(states: [OPEN, CLOSED]) { totalCount } pullRequests(states: [OPEN, CLOSED, MERGED]) { totalCount } } } } }`;

/** A GraphQL answer's repository, or an error: GraphQL can answer 200 with errors beside part of the data, and a partial answer is no answer. */
async function repository(query: string, token: string): Promise<Record<string, unknown>> {
  const res = await call("https://api.github.com/graphql", token, { query });
  const body = (await res.json()) as { data?: { repository?: Record<string, unknown> | null }; errors?: unknown };
  if (body.errors !== undefined || !body.data?.repository) throw new CollectError("GraphQL read failed");
  return body.data.repository;
}

/** Open issues reopened at least once. */
async function fetchReopened(numbers: number[], token: string): Promise<Set<number>> {
  const out = new Set<number>();
  for (let i = 0; i < numbers.length; i += CLOSERS_PER_CALL) {
    const chunk = numbers.slice(i, i + CLOSERS_PER_CALL);
    const repo = await repository(reopenedQuery(chunk), token);
    for (const n of chunk) {
      const total = (repo[`i${n}`] as { timelineItems?: { totalCount?: unknown } } | null)?.timelineItems?.totalCount;
      if (!Number.isInteger(total)) throw new CollectError("reopened read failed");
      if ((total as number) > 0) out.add(n);
    }
  }
  return out;
}

/** Each label's uses, issues plus pull requests in any state. Numbers only: no label name leaves this function. */
export function labelUses(repo: Record<string, unknown>): number[] {
  const labels = repo.labels as { nodes?: unknown; pageInfo?: { hasNextPage?: unknown } } | undefined;
  if (!Array.isArray(labels?.nodes) || labels.pageInfo?.hasNextPage !== false) throw new CollectError("labels read failed");
  return labels.nodes.map((l: { issues?: { totalCount?: unknown }; pullRequests?: { totalCount?: unknown } } | null) => {
    const [a, b] = [l?.issues?.totalCount, l?.pullRequests?.totalCount];
    if (!Number.isInteger(a) || !Number.isInteger(b)) throw new CollectError("labels read failed");
    return (a as number) + (b as number);
  });
}

/** Every milestone's title, open or closed. */
async function fetchMilestones(token: string): Promise<string[]> {
  const res = await call(`https://api.github.com/repos/${REPO}/milestones?state=all&per_page=100`, token);
  const list: unknown = await res.json();
  if (!Array.isArray(list) || list.length >= 100 || !list.every((m) => typeof m?.title === "string")) throw new CollectError("milestones read failed");
  return list.map((m: { title: string }) => m.title);
}

async function fetchClosers(numbers: number[], token: string): Promise<Map<number, boolean>> {
  const out = new Map<number, boolean>();
  for (let i = 0; i < numbers.length; i += CLOSERS_PER_CALL) {
    const chunk = numbers.slice(i, i + CLOSERS_PER_CALL);
    const repo = await repository(closersQuery(chunk), token);
    for (const n of chunk) {
      const v = closedByPr(repo[`i${n}`]);
      if (v !== undefined) out.set(n, v);
    }
  }
  return out;
}

async function main() {
  const { values: args } = parseArgs({ options: { out: { type: "string" }, input: { type: "string" }, now: { type: "string" } } });
  if (!args.out) throw new Error("--out <file> is required");
  const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8")) as Manifest;
  const now = args.now ? Date.parse(args.now) : Date.now();
  const run = process.env.GITHUB_RUN_ID;
  const run_url = run && /^[1-9]\d*$/.test(run) ? `https://github.com/${REPO}/actions/runs/${run}` : null;

  let result;
  try {
    const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
    if (!args.input && !token) throw new CollectError("GH_TOKEN is not set");
    // A saved dump is for a baseline by hand: inside a run it could only write readings no read proved.
    if (args.input && run_url !== null) throw new CollectError("--input is refused inside a workflow run");
    // A saved dump is { issues, closers: { "<n>": true | false }, repo?: { reopened: [<n>], labelUses: [<count>], milestones: [<title>] } }.
    type Dump = { issues: unknown; closers: Record<string, boolean>; repo?: { reopened: number[]; labelUses: number[]; milestones: string[] } };
    const dump = args.input ? (JSON.parse(readFileSync(args.input, "utf8")) as Dump) : null;
    const issues = checkIssues(dump ? dump.issues : await fetchIssues(token as string));
    const since = closesSince(inScope(issues, CONFIG), CONFIG).map((i) => i.number);
    const closers = dump ? new Map(Object.entries(dump.closers ?? {}).map(([k, v]) => [Number(k), v === true] as const)) : await fetchClosers(since, token as string);
    const open = rows(issues, CONFIG, now).map((x) => x.n);
    const repo: RepoFacts | undefined = dump
      ? dump.repo && { ...dump.repo, reopened: new Set(dump.repo.reopened) }
      : {
          reopened: await fetchReopened(open, token as string),
          labelUses: labelUses(await repository(LABELS_QUERY, token as string)),
          milestones: await fetchMilestones(token as string),
        };
    const r = readings(issues, CONFIG, now, closers, repo);
    for (const [id, v] of r.values) console.log(`${id}\t${v.value}\t${v.sample}`);
    const lane = await laneRecord("issues");
    const measured = records(r.values, manifest, { run_url }, now).map((x) => (x.id === lane.id ? lane : x));
    result = { records: measured, rows: r.rows, excluded: r.excluded, detail: detail(r.rows) as Detail | null };
  } catch (e) {
    // A parse error can quote the input, so only this collector's own fixed messages reach the log.
    console.error(`issues collector: ${e instanceof CollectError ? e.message : "unexpected error; every metric is missing"}`);
    result = { records: allMissing(manifest), rows: [] as Row[], excluded: [] as number[], detail: null };
    // The missing records are written below, and the job still shows red.
    process.exitCode = 1;
  }
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(result.records, null, 2) + "\n");
  const out = process.env.DETAIL_DIR ?? dirname(args.out);
  const facts = process.env.DETAIL_DIR ? join(out, "facts") : out;
  mkdirSync(facts, { recursive: true });
  // A failed read writes no detail: the page then draws no rank table, never an empty one.
  if (result.detail) writeFileSync(join(out, "detail.json"), JSON.stringify(result.detail) + "\n");
  writeFileSync(join(facts, "rows.json"), JSON.stringify({ rows: result.rows, excluded: result.excluded }) + "\n");
  if (run_url === null) console.log("no workflow run: every record is written missing");
  console.log(`api_calls\t${calls}`);
}

if (import.meta.main) await main();
