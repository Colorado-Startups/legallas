// SPDX-License-Identifier: Apache-2.0
// The Build page's collector, run by core/collect.ts (lanes.json). Writes the contract's records to --out, and in
// $DETAIL_DIR (core/detail.ts): detail.json (the release checks and parts), page/runs.json (recent build steps and times,
// for the page) and facts/runs.json (the CI runs the windows use, back in $PREV_DIR next run, so only new runs are read).
// A source that fails writes missing for its metrics, never a good number.
//
//   node quality-speed/pages/build/collect.ts --out <records.json>
//
// Needs GH_TOKEN (read-only: actions), GITHUB_REPOSITORY, the full history and web/node_modules installed. Every record
// links the lane's own run (GITHUB_RUN_ID), on the commit being scored; run anywhere else, it writes missing.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';
import { laneRecord } from '../../core/lane/collect.ts';
import { collectFacts, github, readings, STEPS, type RunFacts } from './ci.ts';
import { buildAgain, buildRelease, checks, compare, editedMigrations, gzipParts, hashes, heaviest, CHECKS } from './release.ts';

const PAGE = 'build';
const REPO_URL = 'https://github.com/Colorado-Startups/legallas';

export interface Rec {
  id: string;
  page: typeof PAGE;
  value: number | null;
  status: 'ok' | 'missing';
  stage: 'lab';
  measured_at: string | null;
  source_url: string | null;
  sample_size: number | null;
}

/** A record, or missing. An ok record links the run that measured it, on the commit being scored (contract/README.md). */
export function record(id: string, value: number | null, n: number | null, run: string | null, at: string): Rec {
  const ok = value !== null && run !== null && /\/actions\/runs\/[1-9]\d*$/.test(run);
  return ok
    ? { id, page: PAGE, value, status: 'ok', stage: 'lab', measured_at: at, source_url: run, sample_size: n }
    : { id, page: PAGE, value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null };
}

const round = (n: number) => Math.round(n * 10) / 10;

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) throw new Error('usage: collect.ts --out <records.json>');
  const detailDir = process.env.DETAIL_DIR || null;
  const prevFacts = process.env.PREV_DIR ? path.join(process.env.PREV_DIR, 'facts', 'runs.json') : null;
  const repoDir = path.resolve(import.meta.dirname, '../../..');
  const at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const runUrl = process.env.GITHUB_RUN_ID ? `${REPO_URL}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const records: Rec[] = [];

  let facts: RunFacts[] = [];
  try {
    const known = prevFacts && existsSync(prevFacts) ? (JSON.parse(readFileSync(prevFacts, 'utf8')) as RunFacts[]) : [];
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    if (!token || !repo) throw new Error('GH_TOKEN and GITHUB_REPOSITORY are needed');
    facts = await collectFacts(github(repo, token), known);
    const r = readings(facts);
    records.push(
      record('main_commits_building', r.building && round(r.building.value), r.building?.n ?? null, runUrl, at),
      record('web_build_seconds_p50', r.web && r.web.value, r.web?.n ?? null, runUrl, at),
      record('mac_build_seconds_p50', r.mac && r.mac.value, r.mac?.n ?? null, runUrl, at),
    );
  } catch (e) {
    console.error(`build: CI records unread: ${(e as Error).message}`);
    for (const id of ['main_commits_building', 'web_build_seconds_p50', 'mac_build_seconds_p50']) records.push(record(id, null, null, null, at));
  }

  let release: { checks: Record<string, boolean>; parts: Record<string, number> } | null = null;
  const scratch = path.join(os.tmpdir(), 'qs-build');
  try {
    const first = buildRelease(repoDir);
    const check = checks(first, editedMigrations(repoDir));
    const parts = gzipParts(first);
    console.error(`build: heaviest files, gzipped bytes\n${heaviest(first, 40).join('\n')}`);
    const same = compare(hashes(first), hashes(buildAgain(repoDir, scratch)));
    const gaps = CHECKS.filter((c) => !check[c]).length;
    release = { checks: check, parts };
    records.push(
      record('release_reproducible', same.differ === 0 ? 1 : 0, 1, runUrl, at),
      record('release_gaps', gaps, 1, runUrl, at),
      record('release_gzip_bytes', Object.values(parts).reduce((a, b) => a + b, 0), 1, runUrl, at),
    );
  } catch (e) {
    console.error(`build: release unbuilt: ${(e as Error).message}`);
    for (const id of ['release_reproducible', 'release_gaps', 'release_gzip_bytes']) records.push(record(id, null, null, null, at));
  } finally {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', path.join(scratch, 'second-checkout')], { cwd: repoDir, stdio: 'ignore' });
    } catch {
      // nothing to remove
    }
    rmSync(path.join(repoDir, 'web', '.qs-release'), { recursive: true, force: true });
  }

  // Last, after both builds, so it times the whole lane.
  const all: (Rec | MetricRecord)[] = [...records, await laneRecord(PAGE)];
  writeFileSync(values.out, `[\n${all.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`);
  if (detailDir) writeDetail(detailDir, facts, release);
  console.log(`build: ${all.filter((r) => r.status === 'ok').length} of ${all.length} metrics measured`);
}

/** What the page draws beyond the records: short ids and numbers only, as core/detail.ts requires. */
export function writeDetail(dir: string, facts: RunFacts[], release: { checks: Record<string, boolean>; parts: Record<string, number> } | null): void {
  const put = (name: string, data: unknown) => {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), `${JSON.stringify(data)}\n`);
  };
  put('facts/runs.json', facts);
  const newest = [...facts].sort((a, b) => b.id - a.id);
  put('page/runs.json', {
    main: newest.filter((f) => f.main && f.build !== null).slice(0, 12).reverse().map((f) => ({ sha: f.sha.slice(0, 7), steps: f.steps })),
    web: newest.flatMap((f) => (f.web === null ? [] : [f.web])).slice(0, 10).reverse(),
    mac: newest.flatMap((f) => (f.mac === null ? [] : [f.mac])).slice(0, 10).reverse(),
    steps: [...STEPS.checks, ...STEPS.swift],
  });
  if (release) {
    const checks = Object.fromEntries(Object.entries(release.checks).map(([id, ok]) => [id, ok ? 1 : 0]));
    const readings = Object.fromEntries(Object.entries(release.parts).map(([id, bytes]) => [`part_${id}`, { value: bytes, limit: null, n: 1 }]));
    put('detail.json', { checks, readings });
  }
}

if (import.meta.main) await main();
