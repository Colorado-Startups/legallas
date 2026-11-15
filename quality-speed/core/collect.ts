// SPDX-License-Identifier: Apache-2.0
// Runs one lane's collector and keeps only what passes the format.
//
//   node quality-speed/core/collect.ts --page <slug> --lane <id> --out <dir> [--state-in <dir>]
//
// The collector runs as `node <collector> <args> --out <file>` from the repository root and writes a JSON list of records
// (contract/README.md). $DETAIL_DIR takes anything else it keeps, and $PREV_DIR holds that folder from the lane's last run,
// if there was one (core/detail.ts). The good records land in <dir>/<slug>/<lane>.json. A bad record is dropped and reported,
// so that metric reads as missing while the rest of the page still shows. A collector that fails writes nothing. Either way
// this exits 1, so the job shows red; merge.ts marks a planned lane with no file as missing, whatever stopped it.
// Problems print as paths and rules only, never a measured value or anything a collector read.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PAGES, type PageSlug } from '../contract/pages.ts';
import { validateRecords } from '../contract/validate.ts';
import { loadLanes, loadManifest, PAGES_DIR } from './lanes.ts';

/** Under a GitHub-hosted job's own 45 minutes. A Blacksmith lane's job ends at 10, and merge.ts reads that the same way. */
const COLLECTOR_TIMEOUT_MS = 40 * 60_000;

const isPage = (name: string): name is PageSlug => (PAGES as readonly string[]).includes(name);

/** Runs the lane. Returns what went wrong; an empty list means every record passed. */
export function collectLane(slug: PageSlug, laneId: string, outDir: string, pagesDir = PAGES_DIR, timeoutMs = COLLECTOR_TIMEOUT_MS, stateIn = ''): string[] {
  const { lanes, errors } = loadLanes(slug, pagesDir);
  if (errors.length) return errors;
  const lane = lanes.find((l) => l.id === laneId);
  const manifest = loadManifest(slug, pagesDir);
  if (!lane || !manifest) return ['this lane is not declared'];

  const work = mkdtempSync(path.join(tmpdir(), 'quality-speed-'));
  try {
    const file = path.join(work, 'records.json');
    const collector = path.join(pagesDir, slug, lane.collector);
    const DETAIL_DIR = path.join(outDir, slug, lane.id);
    mkdirSync(DETAIL_DIR, { recursive: true });
    const PREV_DIR = stateIn && path.join(stateIn, 'lanes', slug, lane.id);
    const run = spawnSync(process.execPath, [collector, ...lane.args, '--out', file], { stdio: 'inherit', timeout: timeoutMs, env: { ...process.env, DETAIL_DIR, PREV_DIR } });
    if (run.error || run.status !== 0) return ['the collector failed or timed out'];
    if (!existsSync(file)) return ['the collector wrote no records'];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return ['the collector wrote invalid JSON'];
    }
    const checked = validateRecords(parsed, manifest);
    writeFileSync(path.join(outDir, slug, `${lane.id}.json`), `${JSON.stringify(checked.records)}\n`);
    return checked.errors;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { page: { type: 'string' }, lane: { type: 'string' }, out: { type: 'string' }, 'state-in': { type: 'string' } } });
  if (!values.page || !isPage(values.page) || !values.lane || !values.out) {
    console.error('usage: collect.ts --page <slug> --lane <id> --out <dir> [--state-in <dir>]');
    process.exit(1);
  }
  const errors = collectLane(values.page, values.lane, values.out, PAGES_DIR, COLLECTOR_TIMEOUT_MS, values['state-in'] ?? '');
  for (const error of errors) console.error(`::error title=Quality and Speed collector::pages/${values.page} ${values.lane}: ${error}`);
  if (errors.length) process.exit(1);
  console.log(`Collected pages/${values.page} ${values.lane}.`);
}
