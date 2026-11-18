// SPDX-License-Identifier: Apache-2.0
// Carries the site's state between runs with no write access to the repository. The state is one artifact: history.jsonl,
// which only ever grows, and each lane's last records. Every run takes the newest copy, appends to it and uploads it again,
// which also renews its 90-day retention.
//
//   node quality-speed/core/history-fetch.ts --out <dir>
//
// It trusts only a copy made by this workflow on main in this repository, because anyone who can push a branch can upload
// an artifact with this name. It refuses a copy that does not extend the one before it, and names the artifact to delete
// to fall back. An API error stops the run: it must never look like "no history yet" and start an empty one. A spent
// quota is the one error it waits out, once: busy CI can use up the repository's hourly quota before the run starts.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { isPublicLane, isPublicPage, isPublicMetric, PRIVATE_DETAIL, RENAMED } from '../contract/pages.ts';

const ARTIFACT = 'quality-speed-history';
export const HISTORY_FILE = 'history.jsonl';
/** An allow list: a new kind of event stays untrusted until someone reads what it can do. */
const TRUSTED_EVENTS = new Set(['schedule', 'push', 'workflow_dispatch']);

/** The fields read from GitHub's artifact list. */
export interface Artifact {
  id: number;
  created_at: string;
  expired: boolean;
  workflow_run: { id: number; head_branch: string | null; repository_id: number; head_repository_id: number } | null;
}

/** The fields read from a workflow run. */
export interface Run {
  event: string;
  path: string;
  head_branch: string | null;
  head_sha: string;
}

export function isTrustedRun(run: Run): boolean {
  return TRUSTED_EVENTS.has(run.event) && run.path === '.github/workflows/quality-speed.yml' && run.head_branch === 'main';
}

/**
 * The two newest copies from different trusted runs, newest first. A run can hold several copies, because a name doesn't
 * conflict across jobs or attempts, and only its newest counts: two from one run forked from the same state, and a lane could
 * have made the older. This run's own copy from an earlier attempt doesn't count, so a re-run appends once. A run on a tag
 * called main reads as branch main, so its commit must really be on main too.
 */
export function trustedCopies(artifacts: readonly Artifact[], runOf: (id: number) => Run, currentRun: number, onMain: (sha: string) => boolean): Artifact[] {
  const copies: Artifact[] = [];
  const seen = new Set<number>();
  for (const artifact of [...artifacts].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    const made = artifact.workflow_run;
    if (artifact.expired || !made || made.id === currentRun || seen.has(made.id)) continue;
    if (made.head_branch !== 'main' || made.head_repository_id !== made.repository_id) continue;
    const run = runOf(made.id);
    if (!isTrustedRun(run) || !onMain(run.head_sha)) continue;
    seen.add(made.id);
    copies.push(artifact);
    if (copies.length === 2) break;
  }
  return copies;
}

/**
 * The history's lines for public pages only (pages.ts), in order and byte for byte. A line whose page is private, or that
 * can't be read, is left out: it fails closed. A renamed page's old lines count under its new slug.
 */
export function publicHistory(text: Uint8Array | string): string {
  const kept = Buffer.from(text)
    .toString('utf8')
    .split('\n')
    .filter((line) => {
      if (!line) return false;
      try {
        const page = (JSON.parse(line) as { page?: unknown } | null)?.page;
        if (typeof page !== 'string') return false;
        return isPublicPage(Object.hasOwn(RENAMED, page) ? (RENAMED[page] as string) : page);
      } catch {
        return false;
      }
    });
  return kept.length ? `${kept.join('\n')}\n` : '';
}

/**
 * True when `newer` holds all of `older`, unchanged and in order, with anything new after it. Only public pages' lines
 * count, so dropping a page that turned private never reads as the history shrinking.
 */
export function extendsHistory(older: Uint8Array, newer: Uint8Array): boolean {
  const before = Buffer.from(publicHistory(older));
  const after = Buffer.from(publicHistory(newer));
  return after.length >= before.length && Buffer.compare(before, after.subarray(0, before.length)) === 0;
}

/**
 * Whether a commit is in main's history. The status says how main stands against the commit: `ahead` and `identical` mean the
 * commit is in it, while `behind` and `diverged` mean the commit has work main doesn't.
 */
export function commitOnMain(compare: (request: string) => { status: string }, repo: string, sha: string): boolean {
  return ['ahead', 'identical'].includes(compare(`repos/${repo}/compare/${sha}...main?per_page=1`).status);
}

/** The longest a run waits for the token's hourly REST quota to come back: inside the history job's timeout. */
export const MAX_QUOTA_WAIT_MS = 61 * 60_000;

/**
 * How long to wait before the one retry after a failed call: until the quota resets, plus 5 seconds, when the token
 * has no REST calls left. Null for any other failure, or a reset past `maxMs`, so that error stops the run as before.
 */
export function quotaWait(core: { remaining: number; reset: number }, nowMs: number, maxMs = MAX_QUOTA_WAIT_MS): number | null {
  if (core.remaining > 0) return null;
  const wait = Math.max(core.reset * 1000 - nowMs + 5_000, 0);
  return wait <= maxMs ? wait : null;
}

const gh = (args: string[]) => execFileSync('gh', ['api', ...args], { encoding: 'buffer', maxBuffer: 2 ** 28, stdio: ['ignore', 'pipe', 'inherit'] });

/** One REST call. A run sharing the repository's quota with busy CI waits out a spent quota once instead of failing. */
function api(...args: string[]): Buffer {
  try {
    return gh(args);
  } catch (error) {
    // GitHub doesn't count a rate_limit read against the quota.
    const { core } = (JSON.parse(gh(['rate_limit']).toString()) as { resources: { core: { remaining: number; reset: number } } }).resources;
    const wait = quotaWait(core, Date.now());
    if (wait === null) throw error;
    console.log(`::notice title=Quality and Speed history::GitHub API quota spent; waiting ${Math.ceil(wait / 60_000)} min for it to reset.`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    return gh(args);
  }
}

/** Downloads one copy and unpacks it into `dir`. `unzip` refuses paths that climb out of it. */
function unpack(repo: string, id: number, dir: string): void {
  const zip = path.join(mkdtempSync(path.join(tmpdir(), 'quality-speed-')), 'state.zip');
  writeFileSync(zip, api(`repos/${repo}/actions/artifacts/${id}/zip`));
  execFileSync('unzip', ['-q', '-o', zip, '-d', dir], { stdio: ['ignore', 'ignore', 'inherit'] });
}

/**
 * Takes everything private out of an unpacked state (pages.ts, PUBLIC_PAGES and PRIVATE_LANES), before the workflow
 * uploads it again as `state-in`, which anyone can download: a private page's records and lanes, and a private lane's
 * file, detail and the records it reported, and a private page's score lines in history.jsonl.
 * Returns how many files, folders and score lines it removed.
 */
/** Rewrites a list of records with each private measurement's value taken out. Returns how many it changed. */
function blankPrivate(file: string): number {
  try {
    const list = JSON.parse(readFileSync(file, 'utf8')) as { id?: unknown; page?: unknown; value?: unknown }[];
    let changed = 0;
    const kept = list.map((r) => {
      if (typeof r?.id !== 'string' || typeof r.page !== 'string' || isPublicMetric(r.page, r.id) || r.value === null) return r;
      changed += 1;
      return { ...r, value: null, status: 'missing', measured_at: null, source_url: null, sample_size: null };
    });
    if (changed) writeFileSync(file, `${JSON.stringify(kept)}\n`);
    return changed;
  } catch {
    // Unreadable: it goes, and merge.ts rebuilds the page's list from its lanes.
    rmSync(file, { force: true });
    return 1;
  }
}

export function prunePrivate(state: string): number {
  let removed = 0;
  const drop = (target: string) => {
    rmSync(target, { recursive: true, force: true });
    removed += 1;
  };
  const names = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);
  const historyFile = path.join(state, HISTORY_FILE);
  if (existsSync(historyFile)) {
    const all = readFileSync(historyFile, 'utf8');
    const kept = publicHistory(all);
    if (kept !== all) {
      removed += all.split('\n').filter(Boolean).length - kept.split('\n').filter(Boolean).length;
      writeFileSync(historyFile, kept);
    }
  }
  const records = path.join(state, 'records');
  for (const name of names(records)) if (!isPublicPage(name.replace(/\.json$/, ''))) drop(path.join(records, name));
  const lanes = path.join(state, 'lanes');
  for (const slug of names(lanes)) {
    if (!isPublicPage(slug)) {
      drop(path.join(lanes, slug));
      continue;
    }
    const gone = new Set<string>();
    for (const name of names(path.join(lanes, slug))) {
      const file = path.join(lanes, slug, name);
      // A private page detail folder goes; a public lane file loses its private measurements' values.
      if (!name.endsWith('.json') && PRIVATE_DETAIL.includes(slug)) {
        drop(file);
        continue;
      }
      if (isPublicLane(slug, name.replace(/\.json$/, ''))) {
        if (name.endsWith('.json')) removed += blankPrivate(file);
        continue;
      }
      // The ids this lane reported, so its records leave the page's merged list too. An unreadable file names none.
      try {
        if (name.endsWith('.json')) for (const r of JSON.parse(readFileSync(path.join(lanes, slug, name), 'utf8')) as { id?: unknown }[]) if (typeof r?.id === 'string') gone.add(r.id);
      } catch {
        // Removed below either way.
      }
      drop(path.join(lanes, slug, name));
    }
    const merged = path.join(records, `${slug}.json`);
    if (existsSync(merged)) removed += blankPrivate(merged);
    if (!gone.size || !existsSync(merged)) continue;
    try {
      const kept = (JSON.parse(readFileSync(merged, 'utf8')) as { id?: unknown }[]).filter((r) => typeof r?.id !== 'string' || !gone.has(r.id));
      writeFileSync(merged, `${JSON.stringify(kept)}\n`);
    } catch {
      // A merged list that can't be read can't be filtered, so it goes: merge.ts rebuilds it from the lanes.
      drop(merged);
    }
  }
  return removed;
}

function fetchState(out: string, repo: string, currentRun: number): string {
  const pages = JSON.parse(api('--paginate', '--slurp', `repos/${repo}/actions/artifacts?name=${ARTIFACT}&per_page=100`).toString()) as { artifacts: Artifact[] }[];
  const runOf = (id: number) => JSON.parse(api(`repos/${repo}/actions/runs/${id}`).toString()) as Run;
  const onMain = (sha: string) => commitOnMain((request) => JSON.parse(api(request).toString()) as { status: string }, repo, sha);
  const [newest, previous] = trustedCopies(pages.flatMap((page) => page.artifacts), runOf, currentRun, onMain);

  mkdirSync(out, { recursive: true });
  if (!newest) return '::warning title=Quality and Speed history::No earlier copy from main, so this starts a new history. Expected only on the first run.';
  unpack(repo, newest.id, out);
  const refusal = `To fall back to the copy before it, delete it: gh api -X DELETE repos/${repo}/actions/artifacts/${newest.id}`;
  if (!existsSync(path.join(out, HISTORY_FILE))) throw new Error(`Artifact ${newest.id} holds no ${HISTORY_FILE}. ${refusal}`);
  if (previous) {
    const dir = mkdtempSync(path.join(tmpdir(), 'quality-speed-'));
    unpack(repo, previous.id, dir);
    if (!extendsHistory(readFileSync(path.join(dir, HISTORY_FILE)), readFileSync(path.join(out, HISTORY_FILE)))) {
      throw new Error(`Artifact ${newest.id} does not extend artifact ${previous.id}: history shrank or changed. ${refusal}`);
    }
  }
  const pruned = prunePrivate(out);
  return `History from artifact ${newest.id}.${pruned ? ` ${pruned} private files, folders or score lines left out.` : ''}`;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const { GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run } = process.env;
  if (!values.out || !repo || !run) throw new Error('usage: GITHUB_REPOSITORY=... GITHUB_RUN_ID=... history-fetch.ts --out <dir>');
  console.log(fetchState(values.out, repo, Number(run)));
}
