// SPDX-License-Identifier: Apache-2.0
// CI overview collector. Reads the window's workflow runs and the jobs its readings need, pull requests, merged ones'
// timelines, review verdicts and main's rules through the REST API with the job's own read-only token, or a saved dump
// with --input, and writes:
//   <out>                        records in the shared format (quality-speed/contract)
//   $DETAIL_DIR/page/rows.json   the drill-down: each job's runner, time and cost, and a typical push per path
// Any failed read, or a runner the price list doesn't know, makes every record "missing": never good news.
//
//   GH_TOKEN=... DETAIL_DIR=<dir> node quality-speed/pages/ci-overview/collect.ts --out <records.json>
//   DETAIL_DIR=<dir> node quality-speed/pages/ci-overview/collect.ts --out <records.json> --input <dump.json> --now <utc> --source <commit url>

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Manifest, MetricRecord } from '../../contract/format.ts';
import { laneRecord } from '../../core/lane/collect.ts';
import { DAY, EVENTS, jobReads, readings, rows, Unknown, verdictOf, type Comment, type Config, type Dump, type Reading, type Run } from './compute.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = 'Colorado-Startups/legallas';
const MAX_PAGES = 100;
/** Reads in flight at once. GitHub's secondary limit is 900 REST points a minute; ten reads of about a second each stay
 * near 600 (docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api). */
const CONCURRENCY = 10;
const ATTEMPTS = 3;

export class ReadError extends Error {}

/** One REST page: its body and the next page's URL. Tests pass a fake. */
export type Get = (path: string) => Promise<{ body: any; next: string | null }>;

/** A GitHub REST reader. A 5xx, a 429, or a 403 that says when to retry is tried again, up to three times, waiting what
 * GitHub asks (at most a minute) or 2 and 4 seconds: one blip in 1,500 reads must not empty the page for a day. */
export function httpGet(token: string, fetcher: typeof fetch = fetch, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Get {
  return async (path) => {
    const url = new URL(path.startsWith('https:') ? path : `https://api.github.com${path}`);
    // The token goes to GitHub's API only, whatever a Link header names.
    if (url.protocol !== 'https:' || url.host !== 'api.github.com') throw new ReadError('read failed: not api.github.com');
    for (let attempt = 1; ; attempt++) {
      const res = await fetcher(url, {
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' },
      });
      if (res.status === 200) return { body: await res.json(), next: /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] ?? null };
      const after = Number(res.headers.get('retry-after'));
      const again = res.status >= 500 || res.status === 429 || (res.status === 403 && Number.isFinite(after) && after > 0);
      if (!again || attempt >= ATTEMPTS) throw new ReadError(`read failed: HTTP ${res.status}`);
      await res.body?.cancel();
      await wait(Number.isFinite(after) && after > 0 ? Math.min(after, 60) * 1000 : 2 ** attempt * 1000);
    }
  };
}

/** `work` on every item, `n` at a time. The first failure stops the rest and is thrown. */
export async function pool<T>(items: readonly T[], n: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (!failed && next < items.length) {
        const item = items[next++] as T;
        try {
          await work(item);
        } catch (e) {
          failed = true;
          throw e;
        }
      }
    }),
  );
}

/** Every page of a listing. It asks for page=N on the same path rather than following GitHub's next link, which names the
 * repository by number, a form some proxies refuse. */
async function pages<T>(get: Get, path: string, pick: (b: any) => T[], stop: (x: T) => boolean = () => false): Promise<T[]> {
  const out: T[] = [];
  for (let n = 1; ; n++) {
    if (n > MAX_PAGES) throw new ReadError(`read failed: more than ${MAX_PAGES} pages`);
    const page = await get(`${path}&page=${n}`);
    const items = pick(page.body);
    if (!Array.isArray(items)) throw new ReadError('read failed: not a list');
    out.push(...items);
    if (page.next === null || items.some(stop)) return out;
  }
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z';

/** One event's runs created in [start, end), whole seconds. GitHub's filtered listing caps at 1,000 and can lose runs
 * across pages, so a listing is never paged: a range holding more than one page is halved until each half fits, and a
 * page must hold exactly the runs it counts. */
export async function listRuns(get: Get, event: string, start: number, end: number): Promise<Run[]> {
  const page = await get(`/repos/${REPO}/actions/runs?event=${event}&created=${encodeURIComponent(`${iso(start)}..${iso(end - 1000)}`)}&per_page=100`);
  const total = Number(page.body?.total_count);
  const runs: unknown = page.body?.workflow_runs;
  if (!Array.isArray(runs) || !Number.isInteger(total)) throw new ReadError('read failed: not a run listing');
  if (total <= 100) {
    if (runs.length !== total) throw new ReadError('read failed: a run listing came back incomplete');
    return runs as Run[];
  }
  if (end - start <= 1000) throw new ReadError('read failed: more than 100 runs in one second');
  const mid = start + Math.floor((end - start) / 2000) * 1000;
  return [...(await listRuns(get, event, start, mid)), ...(await listRuns(get, event, mid, end))];
}

/** A merged head's pull request runs, by SHA: one page, which must hold every run it counts. */
async function runsOn(get: Get, sha: string): Promise<Run[]> {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new ReadError('read failed: not a commit SHA');
  const page = await get(`/repos/${REPO}/actions/runs?event=pull_request&head_sha=${sha}&per_page=100`);
  const runs: unknown = page.body?.workflow_runs;
  if (!Array.isArray(runs) || runs.length !== Number(page.body?.total_count)) throw new ReadError('read failed: a run listing came back incomplete');
  return runs as Run[];
}

/** The window's reads, on GITHUB_TOKEN (15,000 an hour per repository on Enterprise Cloud). Runs are listed by event, so
 * the many skipped comment runs are never paged. A merged head with no CI run listed, pushed before the lookback, has its
 * runs read by SHA. Jobs are read only where a reading needs them (`jobReads`), capped; then one timeline per merged pull
 * request and the comment pages from the lookback's start, of which only review verdicts are kept. Reading every run's
 * jobs outgrew the 10-minute lane on 2026-11-06 (2,700 runs in two days); this is about 1,500 reads (an estimate). */
export async function read(get: Get, cfg: Config, at: number): Promise<Dump> {
  const now = Math.floor(at / 1000) * 1000;
  const from = now - cfg.window_days * DAY;
  const back = from - cfg.lookback_days * DAY;
  const runs = (await Promise.all(EVENTS.map((event) => listRuns(get, event, back, now)))).flat();
  const pulls = await pages<Dump['pulls'][number] & { updated_at: string }>(get, `/repos/${REPO}/pulls?state=all&sort=updated&direction=desc&per_page=100`, (b) => b, (p) => Date.parse(p.updated_at) < from);
  const merged = pulls.filter((p) => p.merged_at && Date.parse(p.merged_at) >= from && Date.parse(p.merged_at) <= now);

  const withCi = new Set(runs.filter((r) => r.event === 'pull_request' && r.name === 'CI').map((r) => r.head_sha));
  const known = new Set(runs.map((r) => r.id));
  await pool([...new Set(merged.map((p) => p.head.sha).filter((sha) => !withCi.has(sha)))], CONCURRENCY, async (sha) => {
    for (const r of await runsOn(get, sha)) {
      if (known.has(r.id)) continue;
      known.add(r.id);
      runs.push(r);
    }
  });

  const { ids, drill_from } = jobReads(runs, merged, cfg, now);
  if (ids.length > cfg.max_job_reads) throw new ReadError(`more than ${cfg.max_job_reads} runs to read`);
  const jobs: Dump['jobs'] = {};
  await pool(ids, CONCURRENCY, async (id) => {
    jobs[String(id)] = await pages(get, `/repos/${REPO}/actions/runs/${id}/jobs?filter=all&per_page=100`, (b) => b.jobs);
  });
  const timelines: Dump['timelines'] = {};
  await pool(merged, CONCURRENCY, async (p) => {
    timelines[String(p.number)] = await pages(get, `/repos/${REPO}/issues/${p.number}/timeline?per_page=100`, (b) => b);
  });
  // `since` is by last update, so a verdict posted before the lookback and edited later comes too; the verdict is timed
  // by when it was posted.
  const comments = await pages<Comment>(get, `/repos/${REPO}/issues/comments?since=${iso(back)}&sort=created&direction=asc&per_page=100`, (b) => b);
  const verdicts = comments.flatMap((c) => verdictOf(c) ?? []);
  const rules = (await get(`/repos/${REPO}/rules/branches/main`)).body as Dump['rules'];
  const ciYml = readFileSync(join(here, '..', '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  return { runs, jobs, pulls, timelines, rules, ciYml, verdicts, drill_from };
}

/** The shared format's records. Without a run link a reading can't prove it ran, so it is written as missing. */
export function records(values: ReturnType<typeof readings> | null, m: Manifest, now: number, runUrl: string | null, stage: 'lab' | 'live' = 'live'): MetricRecord[] {
  return m.metrics.map((def) => {
    const v = (values as Record<string, Reading | undefined> | null)?.[def.id];
    const ok = v !== undefined && v.value !== null && runUrl !== null;
    return {
      id: def.id,
      page: m.page,
      value: ok ? v.value : null,
      status: ok ? 'ok' : 'missing',
      stage,
      measured_at: ok ? new Date(now).toISOString().slice(0, 19) + 'Z' : null,
      source_url: ok ? runUrl : null,
      sample_size: ok ? v.samples : null,
    };
  });
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** Two days of merges, runs listed a day further back for merged heads, a cap on job reads, and the drill-down's newest
 * 600 runs (about 11 hours at 6 November's pace of 1,333 runs a day). */
export const CONFIG: Config = { window_days: 2, lookback_days: 1, max_job_reads: 4000, drill_runs: 600 };

/** The lane (core/collect.ts) runs `node collect.ts --out <file>` with GH_TOKEN, GITHUB_RUN_ID and DETAIL_DIR set. */
async function main() {
  const out = arg('out');
  if (!out) throw new Error('--out <file> is required');
  const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8')) as Manifest;
  const cfg = CONFIG;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const now = arg('now') ? Date.parse(arg('now') as string) : Date.now();
  const run = process.env.GITHUB_RUN_ID;
  // A saved dump is a lab reading; --source names what it was read at (a commit), since no run measured it.
  const runUrl = run && /^[1-9]\d*$/.test(run) ? `https://github.com/${REPO}/actions/runs/${run}` : (arg('source') ?? null);
  let values = null;
  let drill = null;
  try {
    const input = arg('input');
    if (!input && !token) throw new ReadError('GH_TOKEN is not set');
    const dump: Dump = input ? JSON.parse(readFileSync(input, 'utf8')) : await read(httpGet(token as string), cfg, now);
    if (input) dump.ciYml ??= readFileSync(join(here, '..', '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
    values = readings(dump, cfg, now);
    drill = rows(dump, cfg, now);
  } catch (e) {
    // Only this collector's own fixed messages reach the log: an error can quote what it read.
    console.error(`ci-overview collector: ${e instanceof ReadError || e instanceof Unknown ? e.message : 'unexpected error'}; every metric is missing`);
  }
  // Last, after every read, so it times the whole lane: the lane's own minutes take lane_minutes' place on the list.
  const lane = await laneRecord('ci-overview');
  const list = records(values, manifest, now, runUrl, arg('input') ? 'lab' : 'live').map((r) => (r.id === lane.id ? lane : r));
  writeFileSync(out, JSON.stringify(list, null, 2) + '\n');
  // core/detail.ts copies page/<name>.json beside page.ts before the build: the page's drill-down.
  if (drill && process.env.DETAIL_DIR) {
    mkdirSync(join(process.env.DETAIL_DIR, 'page'), { recursive: true });
    writeFileSync(join(process.env.DETAIL_DIR, 'page', 'rows.json'), JSON.stringify(drill) + '\n');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
