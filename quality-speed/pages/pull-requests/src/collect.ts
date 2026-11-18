// Collector for the Pull requests page.
//
//   node quality-speed/pages/pull-requests/src/collect.ts --out <records.json> [--git <clone>] [--now <iso>] [--repo owner/name]
//
// Run by core/collect.ts from lanes.json. Reads pull requests, their checks,
// merge_group runs and main's commits through the REST API (the job's GH_TOKEN with fetch in
// Actions, else `gh api`), and writes the records, one per metric in
// manifest.json, to --out. Per pull request facts go to
// $DETAIL_DIR/facts/facts.json, the lane's own memory, which is never published
// (beside --out when run by hand). Neither holds a title, body, login or file
// name. Rework is found with git blame in a clone with main's full history
// (--git, default: the checkout this file is in).
//
// The facts from the lane's last run ($PREV_DIR/facts/facts.json) are reused
// for any pull request already read (same number, end, merge commit and facts
// version), so a run reads only what closed since. A body counts as complete only when GraphQL (Actions only)
// shows no edit after the passing review on the merged head started; facts
// read without that check are read again in Actions.
//
// Any failed read writes every metric missing and exits 1: a broken collector
// shows as red tiles, never as good news. One exception: stopped by GitHub's
// rate limit, it keeps the facts read so far and exits 0, so core carries them
// and the next run starts there. Its metrics still read missing. After a good read, lane_minutes is
// core/lane's laneRecord(): this lane's job minutes so far, read last so they
// cover every read above.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { laneRecord } from "../../../core/lane/collect.ts";
import {
  type DirectPush,
  FACTS_VERSION,
  type PullFacts,
  type PullInput,
  type QueueRun,
  type RawComment,
  type RawCommit,
  type RawEvent,
  type RawFile,
  type RawIssueComment,
  type RawJob,
  type RawPull,
  type RawRun,
  REVIEW_WORKFLOW,
  REWORK_DAYS,
  type Rules,
  isSite,
  jobMinutes,
  parseGitattributes,
  parseTemplate,
  pullFacts,
  queuePull,
  readyAt,
  reviewAttempts,
} from "./facts.ts";
import { type Getter, type GraphQL, NotFound, RateLimited, fetchGetter, getAll, ghGetter, graphqlClient } from "./github.ts";
import { type Collected, type DeletedRun, type Manifest, type OpenPull, WINDOW_DAYS, failedRecords, records } from "./metrics.ts";
import { fixesByBlame, hasCommit } from "./rework.ts";

const here = dirname(fileURLToPath(import.meta.url));
const DAY = 86400000;
const SLACK = 60000;

interface ListedPull extends RawPull {
  updated_at: string;
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
}

/** Memoizes one async read per key for the length of a run. */
function memo<K, V>(read: (k: K) => Promise<V>): (k: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  return (k) => {
    if (!cache.has(k)) cache.set(k, read(k));
    return cache.get(k)!;
  };
}

async function fileAt(get: Getter, repo: string, path: string, ref: string): Promise<string> {
  const body = (await get(`repos/${repo}/contents/${path}?ref=${ref}`)) as { content?: string; encoding?: string };
  if (body.encoding !== "base64" || typeof body.content !== "string") throw new Error(`${path}: unexpected encoding`);
  return Buffer.from(body.content, "base64").toString("utf8");
}

/** A file at a commit, or null when it did not exist there. Any other failure throws. */
async function fileOrNull(get: Getter, repo: string, path: string, ref: string): Promise<string | null> {
  try {
    return await fileAt(get, repo, path, ref);
  } catch (e) {
    if (e instanceof NotFound) return null;
    throw e;
  }
}

/**
 * The template and .gitattributes as they were at a commit. A base with no
 * template (a repository's first commit) has nothing to complete: such a pull
 * request is left out of template_complete, and every other metric still reads.
 */
async function rulesAt(get: Getter, repo: string, sha: string): Promise<Rules> {
  const template = await fileOrNull(get, repo, ".github/pull_request_template.md", sha);
  const attributes = await fileOrNull(get, repo, ".gitattributes", sha);
  const generated = attributes === null ? [] : parseGitattributes(attributes);
  if (template === null) return { templateHeadings: [], templateBoxes: 0, templateAttestations: 0, hasTemplate: false, generated };
  const t = parseTemplate(template);
  if (t.headings.length === 0) throw new Error("pull request template has no headings");
  return { templateHeadings: t.headings, templateBoxes: t.boxes, templateAttestations: t.attestations, hasTemplate: true, generated };
}

/** Pull requests closed (merged or not) after `since`, newest update first. */
async function closedSince(get: Getter, repo: string, since: number): Promise<ListedPull[]> {
  const out: ListedPull[] = [];
  for (let page = 1; page <= 100; page++) {
    const batch = (await get(`repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`)) as ListedPull[];
    if (!Array.isArray(batch)) throw new Error("pulls: not a list");
    for (const p of batch) if (p.closed_at && Date.parse(p.closed_at) > since) out.push(p);
    // closed_at is never after updated_at, so once a page ends before `since`, nothing later qualifies.
    const last = batch[batch.length - 1];
    if (batch.length < 100 || !last || Date.parse(last.updated_at) <= since) return out;
  }
  throw new Error("pulls: more than 100 pages");
}

function siteOrBase(pull: RawPull, files: RawFile[]): OpenPull["excluded"] {
  if (pull.base.ref !== "main") return "base_not_main";
  return files.length > 0 && files.every((f) => isSite(f.filename)) ? "site_only" : null;
}

interface Readers {
  get: Getter;
  repo: string;
  filesOf: (n: number) => Promise<RawFile[]>;
  rulesOf: (sha: string) => Promise<Rules>;
  changeOf: (sha: string) => Promise<string>;
  graphql: GraphQL | null;
  git: string;
}

/** A head's whole change against main, as file names, states and blob ids: equal for an empty commit or main merged in. */
async function changeAt(get: Getter, repo: string, sha: string): Promise<string> {
  const cmp = (await get(`repos/${repo}/compare/main...${sha}`)) as { files?: { filename: string; status: string; sha: string }[] };
  if (!Array.isArray(cmp.files)) throw new Error("compare: no files");
  return cmp.files.map((f) => `${f.status} ${f.sha} ${f.filename}`).sort().join("\n");
}

/** Commits main had at the merge that the merged head lacked. */
async function behindMain(rd: Readers, pull: RawPull): Promise<number | null> {
  if (!pull.merge_commit_sha) return null;
  const merge = (await rd.get(`repos/${rd.repo}/commits/${pull.merge_commit_sha}`)) as { parents?: { sha: string }[] };
  const parent = merge.parents?.[0]?.sha;
  if (!parent) return null;
  const cmp = (await rd.get(`repos/${rd.repo}/compare/${parent}...${pull.head.sha}`)) as { behind_by?: number };
  return typeof cmp.behind_by === "number" ? cmp.behind_by : null;
}

/** The body was edited after `since` (when the passing review that read it started). */
async function editedAfter(rd: Readers, pull: RawPull, since: string): Promise<boolean | null> {
  if (!rd.graphql || !pull.merged_at) return null;
  const [owner, name] = rd.repo.split("/");
  const body = (await rd.graphql(
    "query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){lastEditedAt}}}",
    { o: owner, n: name, p: pull.number },
  )) as { data?: { repository?: { pullRequest?: { lastEditedAt: string | null } } } };
  const pr = body.data?.repository?.pullRequest;
  if (!pr) throw new Error("graphql: no pull request");
  return pr.lastEditedAt !== null && Date.parse(pr.lastEditedAt) > Date.parse(since);
}

async function pullInput(rd: Readers, pull: RawPull, listing: RawPull[], bases: Set<string>): Promise<PullInput> {
  const r = `repos/${rd.repo}`;
  const n = pull.number;
  const ended = Date.parse(pull.merged_at ?? pull.closed_at!);
  const created = `${iso(Date.parse(pull.created_at) - SLACK)}..${iso(ended + SLACK)}`;
  const [files, timeline, reviewComments, issueComments, commits, runs, rules] = await Promise.all([
    rd.filesOf(n),
    getAll<RawEvent>(rd.get, `${r}/issues/${n}/timeline`),
    getAll<RawComment>(rd.get, `${r}/pulls/${n}/comments`),
    getAll<RawIssueComment>(rd.get, `${r}/issues/${n}/comments`),
    getAll<RawCommit>(rd.get, `${r}/pulls/${n}/commits`),
    getAll<RawRun>(
      rd.get,
      `${r}/actions/runs?branch=${encodeURIComponent(pull.head.ref)}&event=pull_request&created=${created}`,
      (b) => (b as { workflow_runs: RawRun[] }).workflow_runs,
    ),
    rd.rulesOf(pull.base.sha),
  ]);
  const firstAttempt: Record<number, string | null> = {};
  for (const run of runs.filter((x) => x.run_attempt > 1)) {
    firstAttempt[run.id] = ((await rd.get(`${r}/actions/runs/${run.id}/attempts/1`)) as { conclusion: string | null }).conclusion;
  }
  const reviewJobs: Record<number, RawJob[]> = {};
  for (const run of runs.filter((x) => x.path === REVIEW_WORKFLOW)) {
    reviewJobs[run.id] = await getAll<RawJob>(rd.get, `${r}/actions/runs/${run.id}/jobs?filter=all`, (b) => (b as { jobs: RawJob[] }).jobs);
  }
  // Earlier merges into main within REWORK_DAYS: the ones this merge can rework.
  const earlier = new Map<string, number>();
  let fixes: number[] = [];
  let reworkUnknown = false;
  if (pull.merged_at && pull.merge_commit_sha) {
    const t = Date.parse(pull.merged_at);
    for (const a of listing) {
      if (a.number === n || !a.merged_at || !a.merge_commit_sha || a.base.ref !== "main") continue;
      const dt = t - Date.parse(a.merged_at);
      if (dt > 0 && dt <= REWORK_DAYS * DAY) earlier.set(a.merge_commit_sha, a.number);
    }
    if (pull.base.ref === "main") {
      try {
        fixes = fixesByBlame(rd.git, pull.merge_commit_sha, earlier, rules.generated);
      } catch {
        // One merge git cannot read fails closed on its own: every earlier
        // merge in its window counts as reworked, and the rest stays live.
        fixes = [...earlier.values()];
        reworkUnknown = true;
      }
    }
  }

  // A Blocking verdict on an earlier head carrying the same change as the
  // merged head (an empty commit, or main merged in) was rerun away.
  const reviewRuns = runs.filter((x) => x.path === REVIEW_WORKFLOW);
  const blockedHeads = new Set(
    reviewRuns.filter((x) => x.head_sha !== pull.head.sha && reviewAttempts(reviewJobs[x.id]).some((a) => a.verdict === "blocking")).map((x) => x.head_sha),
  );
  let blockingSameChange = false;
  if (pull.merged_at && blockedHeads.size > 0) {
    const merged = await rd.changeOf(pull.head.sha);
    for (const h of blockedHeads) if ((await rd.changeOf(h)) === merged) blockingSameChange = true;
  }

  // When the review that read the body started: the newest passing review on the merged head.
  const passing = reviewRuns
    .filter((x) => x.head_sha === pull.head.sha && reviewAttempts(reviewJobs[x.id]).some((a) => a.verdict === "pass"))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  return {
    pull,
    files,
    timeline,
    reviewComments,
    commits,
    runs,
    firstAttempt,
    reviewJobs,
    rules,
    behindMain: pull.merged_at ? await behindMain(rd, pull) : null,
    blockingSameChange,
    fixes,
    reworkUnknown,
    editedAfterReview: await editedAfter(rd, pull, passing?.created_at ?? pull.merged_at ?? pull.created_at),
    issueComments,
    stackBase: bases.has(pull.head.ref),
  };
}

/**
 * Pushes and force pushes to main since `since`, from the activity API, whose
 * times are the server's (a commit's own date can be set to anything). A merge
 * of a pull request is "pr_merge" and is not counted. A full page means at
 * least that many: all are misses, so the count is a lower bound.
 */
async function directPushes(rd: Readers, since: number): Promise<DirectPush[]> {
  const out: DirectPush[] = [];
  for (const type of ["push", "force_push"]) {
    const items = (await rd.get(`repos/${rd.repo}/activity?ref=refs/heads/main&activity_type=${type}&per_page=100`)) as {
      after: string;
      timestamp: string;
    }[];
    if (!Array.isArray(items)) throw new Error("activity: not a list");
    for (const i of items) if (Date.parse(i.timestamp) > since) out.push({ sha: i.after, at: i.timestamp });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const GATE_WORKFLOWS: [DeletedRun["workflow"], string][] = [
  ["ci", "ci.yml"],
  ["dco", "dco.yml"],
  ["review", "claude-review.yml"],
];

/**
 * Run numbers missing between the window's first and last run of each gate
 * workflow. Numbers count up per workflow with no gaps of GitHub's own, so a
 * missing one is a deleted run, which could hide a red result. A workflow the
 * repository does not have (a 404, as claude-review.yml since it was retired)
 * has no runs to delete: no events, not a failed read. Any other failure throws.
 */
async function deletedRuns(rd: Readers, since: number): Promise<DeletedRun[]> {
  const out: DeletedRun[] = [];
  for (const [workflow, file] of GATE_WORKFLOWS) {
    let runs: { run_number: number }[];
    try {
      runs = await getAll<{ run_number: number }>(
        rd.get,
        `repos/${rd.repo}/actions/workflows/${file}/runs?created=${encodeURIComponent(`>=${iso(since)}`)}`,
        (b) => (b as { workflow_runs: { run_number: number }[] }).workflow_runs,
      );
    } catch (e) {
      if (e instanceof NotFound) continue;
      throw e;
    }
    const seen = new Set(runs.map((r) => r.run_number));
    if (seen.size === 0) continue;
    for (let n = Math.min(...seen); n <= Math.max(...seen); n++) if (!seen.has(n)) out.push({ workflow, run_number: n });
  }
  return out;
}

interface RawQueueRun {
  id: number;
  run_attempt: number;
  status: string;
  conclusion: string | null;
  head_branch: string | null;
  created_at: string;
}

/** The runs list answers at most this many runs per query. */
const RUNS_PER_QUERY = 1000;

/**
 * Completed merge_group runs created in the window, each with its job minutes over every attempt. One query a day, since
 * a query lists at most 1,000 runs: a fuller day throws rather than reading short. A run already read at the same attempt
 * is reused; a skipped run ran no job.
 */
async function queueRuns(rd: Readers, start: number, end: number, prev: Map<number, QueueRun>, kept: QueueRun[] = []): Promise<QueueRun[]> {
  const listed = new Map<number, RawQueueRun>();
  for (let from = start; from < end; from += DAY) {
    const day = await getAll<RawQueueRun>(
      rd.get,
      `repos/${rd.repo}/actions/runs?event=merge_group&created=${iso(from)}..${iso(Math.min(from + DAY, end) - 1000)}`,
      (b) => (b as { workflow_runs: RawQueueRun[] }).workflow_runs,
    );
    if (day.length >= RUNS_PER_QUERY) throw new Error("merge_group runs: a day holds more than one query lists");
    for (const r of day) listed.set(r.id, r);
  }
  const out: QueueRun[] = [];
  for (const run of listed.values()) {
    if (run.status !== "completed") continue;
    const cached = prev.get(run.id);
    if (cached?.run_attempt === run.run_attempt) {
      out.push(cached);
      kept.push(cached);
      continue;
    }
    const jobs =
      run.conclusion === "skipped"
        ? []
        : await getAll<RawJob>(rd.get, `repos/${rd.repo}/actions/runs/${run.id}/jobs?filter=all`, (b) => (b as { jobs: RawJob[] }).jobs);
    const read: QueueRun = { id: run.id, run_attempt: run.run_attempt, pull: queuePull(run.head_branch), created_at: run.created_at, minutes: jobMinutes(jobs) };
    out.push(read);
    kept.push(read);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Runs `work` over `items`, `limit` at a time, keeping order. */
async function pool<T, U>(items: T[], limit: number, work: (t: T) => Promise<U>): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

/** Earlier facts still valid, by pull request number. */
export function reusable(prev: unknown): Map<number, PullFacts> {
  const out = new Map<number, PullFacts>();
  const pulls = (prev as { pulls?: unknown } | null)?.pulls;
  if (!Array.isArray(pulls)) return out;
  for (const f of pulls as PullFacts[]) {
    if (f && typeof f.number === "number" && f.v === FACTS_VERSION && typeof f.ended_at === "string") out.set(f.number, f);
  }
  return out;
}

/** merge_group runs read by an earlier run, by id. */
export function reusableRuns(prev: unknown): Map<number, QueueRun> {
  const out = new Map<number, QueueRun>();
  const runs = (prev as { queue_runs?: unknown } | null)?.queue_runs;
  if (!Array.isArray(runs)) return out;
  for (const r of runs as QueueRun[]) {
    if (r && typeof r.id === "number" && typeof r.run_attempt === "number" && typeof r.minutes === "number") out.set(r.id, r);
  }
  return out;
}

function stillValid(f: PullFacts | undefined, p: RawPull, editCheck: boolean): f is PullFacts {
  if (!f) return false;
  if (editCheck && p.merged_at !== null && !f.edit_checked) return false;
  return p.merged_at !== null
    ? f.state === "merged" && f.merge_sha === p.merge_commit_sha && f.ended_at === p.merged_at
    : f.state === "closed" && f.ended_at === p.closed_at;
}

export interface Options {
  prev?: unknown;
  graphql?: GraphQL | null;
  /** A clone with main's full history, for rework. */
  git: string;
  /** Whether the clone has a commit; defaults to asking git. */
  hasCommit?: (sha: string) => boolean;
  /** Filled as facts are read, so a run stopped by the rate limit can keep them for the next. */
  progress?: Pick<Collected, "pulls" | "queue_runs">;
}

/** A merge this recent may postdate the checkout; it is read on the next run. */
const IN_FLIGHT = 15 * 60000;

export async function collect(get: Getter, repo: string, now: Date, opts: Options): Promise<Collected> {
  const graphql = opts.graphql ?? null;
  const rd: Readers = {
    get,
    repo,
    filesOf: memo((n: number) => getAll<RawFile>(get, `repos/${repo}/pulls/${n}/files`, undefined, 30)),
    rulesOf: memo((sha: string) => rulesAt(get, repo, sha)),
    changeOf: memo((sha: string) => changeAt(get, repo, sha)),
    graphql,
    git: opts.git,
  };
  const end = now.getTime();
  const since = end - (WINDOW_DAYS + REWORK_DAYS) * DAY;
  const has = opts.hasCommit ?? ((sha: string) => hasCommit(opts.git, sha));
  const listing: ListedPull[] = [];
  for (const p of await closedSince(get, repo, since)) {
    if (Date.parse(p.closed_at!) > end) continue;
    if (p.merged_at && p.merge_commit_sha && p.base.ref === "main" && !has(p.merge_commit_sha)) {
      // Merged after the checkout: left for the next run. Anything older missing is an error.
      if (end - Date.parse(p.merged_at) <= IN_FLIGHT) continue;
      throw new Error("a merge commit is missing from the clone");
    }
    listing.push(p);
  }
  const cached = reusable(opts.prev ?? null);
  const fresh = listing.filter((p) => !stillValid(cached.get(p.number), p, graphql !== null));
  const progress = opts.progress ?? { pulls: [], queue_runs: [] };
  const kept = listing.filter((p) => !fresh.includes(p)).map((p) => cached.get(p.number)!);
  progress.pulls.push(...kept);
  // Open pull requests first: a branch another pull request targets is the bottom of a stack.
  const openPulls = (await getAll<RawPull>(get, `repos/${repo}/pulls?state=open`)).filter((x) => Date.parse(x.created_at) <= end);
  const bases = new Set([...listing, ...openPulls].map((p) => p.base.ref).filter((b) => b !== "main"));
  const read = await pool(fresh, 4, async (p) => {
    const f = pullFacts(await pullInput(rd, p, listing, bases));
    progress.pulls.push(f);
    return f;
  });
  const pulls = [...kept, ...read].sort((a, b) => a.number - b.number);

  const open: OpenPull[] = [];
  for (const p of openPulls) {
    const timeline = await getAll<RawEvent>(get, `repos/${repo}/issues/${p.number}/timeline`);
    open.push({
      number: p.number,
      created_at: p.created_at,
      ever_ready: readyAt(p, timeline) !== null,
      excluded: siteOrBase(p, await rd.filesOf(p.number)),
    });
  }

  const start = end - WINDOW_DAYS * DAY;
  const direct_pushes = (await directPushes(rd, start)).filter((p) => Date.parse(p.at) <= end);
  const deleted_runs = await deletedRuns(rd, start);
  const queue_runs = await queueRuns(rd, start, end, reusableRuns(opts.prev ?? null), progress.queue_runs);
  return { pulls, open, direct_pushes, deleted_runs, queue_runs };
}

async function sourceUrl(get: Getter, repo: string): Promise<string> {
  const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const run = process.env.GITHUB_RUN_ID;
  if (run) return `${server}/${repo}/actions/runs/${run}`;
  const main = (await get(`repos/${repo}/commits/main`)) as { sha: string };
  return `${server}/${repo}/commit/${main.sha}`;
}

async function main() {
  const { values } = parseArgs({
    options: { out: { type: "string" }, git: { type: "string" }, now: { type: "string" }, repo: { type: "string" } },
  });
  if (!values.out) throw new Error("--out <records.json> is required");
  const repo = values.repo ?? process.env.GITHUB_REPOSITORY ?? "Colorado-Startups/legallas";
  const now = values.now ? new Date(values.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("--now is not a date");
  const manifest = JSON.parse(readFileSync(join(here, "..", "manifest.json"), "utf8")) as Manifest;
  // The job's token inside Actions (the workflow passes it as GH_TOKEN); elsewhere the signed-in gh.
  const token = process.env.GITHUB_ACTIONS === "true" ? (process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN) : undefined;
  const get = token ? fetchGetter(token) : ghGetter();
  const graphql = token ? graphqlClient(token) : null;
  if (!graphql) console.log("pull-requests: outside Actions, so body edits after merge are not checked");
  const factsDir = process.env.DETAIL_DIR ? join(process.env.DETAIL_DIR, "facts") : dirname(values.out);
  const prevFile = process.env.PREV_DIR ? join(process.env.PREV_DIR, "facts", "facts.json") : join(factsDir, "facts.json");
  mkdirSync(factsDir, { recursive: true });
  mkdirSync(dirname(values.out), { recursive: true });
  const progress: Pick<Collected, "pulls" | "queue_runs"> = { pulls: [], queue_runs: [] };
  try {
    const prev = existsSync(prevFile) ? JSON.parse(readFileSync(prevFile, "utf8")) : null;
    const gitDir = values.git ?? execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    const data = await collect(get, repo, now, { prev, graphql, git: gitDir, progress });
    const url = await sourceUrl(get, repo);
    writeFileSync(join(factsDir, "facts.json"), `${JSON.stringify(data)}\n`);
    const lane = await laneRecord("pull-requests");
    const measured = records(data, manifest, now, url).map((r) => (r.id === lane.id ? lane : r));
    writeFileSync(values.out, `${JSON.stringify(measured, null, 1)}\n`);
    console.log(
      `pull-requests: ${data.pulls.length} closed, ${data.open.length} open, ${data.direct_pushes.length} direct pushes, ${data.deleted_runs.length} deleted gate runs, ${data.queue_runs.length} queue runs`,
    );
  } catch (err) {
    writeFileSync(values.out, `${JSON.stringify(failedRecords(manifest), null, 1)}\n`);
    console.error(`pull-requests: read failed, every metric missing: ${(err as Error).message}`);
    if (err instanceof RateLimited && progress.pulls.length + progress.queue_runs.length > 0) {
      // Out of API budget mid-read: keep what was read, so the next run starts there. The lane exits 0 only so core keeps
      // these facts; every metric still reads missing.
      writeFileSync(join(factsDir, "facts.json"), `${JSON.stringify({ ...progress, open: [], direct_pushes: [], deleted_runs: [] })}\n`);
      console.log(`pull-requests: kept ${progress.pulls.length} pull requests and ${progress.queue_runs.length} queue runs for the next run`);
    } else {
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
