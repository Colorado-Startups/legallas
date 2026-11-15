// SPDX-License-Identifier: Apache-2.0
// Doc lag: how long a doc stays wrong after the change that made it wrong.
// Replays main's first-parent history, runs the same checks on each commit's
// tree, and times every finding from the commit that introduced it to the
// commit that cleared it. One still open counts its age up to now.
//
// A commit's findings never change once its tree and the checks are fixed, so
// they are cached by commit, under a hash of the page's inputs and checks: a
// change to either starts the cache afresh.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus, trackedFiles } from './corpus.ts';
import { findingKeys } from './findings.ts';
import { INPUTS } from './inputs.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checks whose code decides a commit's findings. */
const CHECK_SOURCES = ['corpus.ts', 'links.ts', 'names.ts', 'questions.ts', 'findings.ts', 'inputs.ts'];

/** Each finding key once, and each commit's findings as indices into that list, so the cache stays small. */
export interface LagCache { config: string; keys: string[]; commits: Record<string, number[]> }

/** A hash of everything that decides findings: the config folder's inputs and the checks' code. */
export function configHash(configDir: string): string {
  const h = createHash('sha256');
  for (const f of ['questions.json', 'not-in-tree.json', 'inputs.json']) {
    const p = join(configDir, f);
    h.update(`${f}\0${existsSync(p) ? readFileSync(p) : ''}\0`);
  }
  for (const f of CHECK_SOURCES) h.update(`${f}\0${readFileSync(join(HERE, f))}\0`);
  return h.digest('hex');
}

export function readCache(path: string | undefined, config: string): LagCache {
  if (path && existsSync(path)) {
    try {
      const c = JSON.parse(readFileSync(path, 'utf8')) as LagCache;
      if (c.config === config && Array.isArray(c.keys) && c.commits && typeof c.commits === 'object') return c;
    } catch {
      // A broken cache is rebuilt, never trusted.
    }
  }
  return { config, keys: [], commits: {} };
}

/** Thrown when the replay can't be trusted (a shallow clone) or can't finish in its time: the reading is then missing. */
export class LagUnavailable extends Error {}

export interface Episode { key: string; opened: string; closed: string | null; hours: number }

interface Commit { sha: string; at: string }

function git(root: string, args: string[], input?: string): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 << 20, input });
}

/** First-parent commits on `ref`, oldest first, committed at or after `since` (ISO time). */
export function commitsSince(root: string, ref: string, since: string): Commit[] {
  const out = git(root, ['log', '--first-parent', '--reverse', `--since=${since}`, '--format=%H %cI', ref]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha = '', at = ''] = l.split(' ');
      return { sha, at: new Date(at).toISOString() };
    });
}

/** The keys of every finding on one commit's tree, from a scratch copy of that tree. */
export function keysAt(root: string, sha: string, configDir: string): Set<string> {
  const dir = mkdtempSync(join(tmpdir(), 'qs-docs-'));
  try {
    execFileSync('sh', ['-c', `git -C "$1" archive "$2" | tar -x -C "$3"`, 'sh', root, sha, dir]);
    const tracked = trackedFiles(root, sha);
    const corpus = loadCorpus(dir, tracked, root);
    return findingKeys(corpus, configDir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Episodes from a sequence of finding sets, one per commit in order. */
export function episodes(commits: Commit[], sets: Set<string>[], now: string): Episode[] {
  const open = new Map<string, string>();
  const out: Episode[] = [];
  commits.forEach((c, i) => {
    const keys = sets[i] ?? new Set<string>();
    for (const k of keys) if (!open.has(k)) open.set(k, c.at);
    for (const [k, at] of open) {
      if (!keys.has(k)) {
        out.push({ key: k, opened: at, closed: c.at, hours: hoursBetween(at, c.at) });
        open.delete(k);
      }
    }
  });
  for (const [k, at] of open) out.push({ key: k, opened: at, closed: null, hours: hoursBetween(at, now) });
  return out;
}

function hoursBetween(a: string, b: string): number {
  return Math.max(0, (Date.parse(b) - Date.parse(a)) / 3_600_000);
}

/**
 * Replays `ref` over twice the window and keeps episodes still open or closed within the window. A finding already
 * there at the first replayed commit dates from it: at least one window before the window starts, so past the floor.
 */
export function docLag(root: string, ref: string, configDir: string, now: string, cachePath?: string, deadline = Infinity, windowDays = INPUTS.lag_window_days): Episode[] {
  // A shallow clone holds only recent commits, so every finding would look newly opened: a lag that reads as good news.
  if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') throw new LagUnavailable('shallow clone');
  const commits = commitsSince(root, ref, new Date(Date.parse(now) - 2 * windowDays * 86_400_000).toISOString());
  const cache = readCache(cachePath, configHash(configDir));
  const index = new Map(cache.keys.map((k, i) => [k, i]));
  const save = () => {
    if (!cachePath) return;
    const keep = new Set(commits.map((c) => c.sha));
    for (const sha of Object.keys(cache.commits)) if (!keep.has(sha)) delete cache.commits[sha];
    writeFileSync(cachePath, `${JSON.stringify(cache)}\n`);
  };
  const sets: Set<string>[] = [];
  for (const c of commits) {
    const hit = cache.commits[c.sha];
    if (hit) {
      sets.push(new Set(hit.map((i) => cache.keys[i] ?? '')));
      continue;
    }
    // Out of time: keep what was replayed, so the next run starts further on, and read as missing.
    if (Date.now() > deadline) {
      save();
      throw new LagUnavailable('out of time');
    }
    const keys = keysAt(root, c.sha, configDir);
    cache.commits[c.sha] = [...keys].sort().map((k) => {
      if (!index.has(k)) {
        index.set(k, cache.keys.length);
        cache.keys.push(k);
      }
      return index.get(k) as number;
    });
    sets.push(keys);
  }
  save();
  const from = Date.parse(now) - windowDays * 86_400_000;
  return episodes(commits, sets, now).filter((e) => e.closed === null || Date.parse(e.closed) >= from);
}
