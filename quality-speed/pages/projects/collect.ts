// SPDX-License-Identifier: Apache-2.0
// The Projects page's collector (lanes.json, the admin lane), run as `node collect.ts --out <file>`. It reads the board
// from the admin job's read-out (board.ts), and its only API call is core/lane's laneRecord(), one read of this run's jobs:
// with a board, lane_minutes is this lane's job minutes so far. The same read-out holds the saved views (views_correct). Only a workflow run proves a reading, so outside one, or
// with no read-out, every record is missing. The stage strip's counts go to $DETAIL_DIR/detail.json (board.ts stageDetail).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Manifest, MetricRecord } from '../../contract/format.ts';
import { laneRecord } from '../../core/lane/collect.ts';
import { cards, parseReadOut, readings, READ_OUT, stageDetail, views, type Reading } from './board.ts';

const RUN_URL = /^https:\/\/github\.com\/Colorado-Startups\/legallas\/actions\/runs\/[1-9]\d*$/;
const utc = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Records in the shared format. No run link, or no value, is missing: never good news. `lane`, core/lane's laneRecord(),
 * stands for lane_minutes, which no board reading holds.
 */
export function records(values: Map<string, Reading>, m: Manifest, runUrl: string | null, now: number, lane?: MetricRecord): MetricRecord[] {
  const run = runUrl !== null && RUN_URL.test(runUrl) ? runUrl : null;
  return m.metrics.map((d) => {
    if (run !== null && lane?.id === d.id) return lane;
    const r = values.get(d.id);
    if (run === null || !r || r.value === null || !Number.isFinite(r.value)) {
      return { id: d.id, page: m.page, value: null, status: 'missing', stage: 'live', measured_at: null, source_url: null, sample_size: null };
    }
    return { id: d.id, page: m.page, value: r.value, status: 'ok', stage: 'live', measured_at: utc(now), source_url: run, sample_size: r.sample };
  });
}

if (import.meta.main) {
  const { values: args } = parseArgs({ options: { out: { type: 'string' } } });
  if (!args.out) throw new Error('--out <file> is required');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const manifest = JSON.parse(readFileSync(path.join(here, 'manifest.json'), 'utf8')) as Manifest;
  const now = Date.now();
  const run = process.env.GITHUB_RUN_ID;
  const runUrl = run && /^[1-9]\d*$/.test(run) ? `https://github.com/Colorado-Startups/legallas/actions/runs/${run}` : null;
  const file = path.join(process.env.KEY_JOB_OUTPUT_DIR ?? '', 'admin-read', READ_OUT);
  const readOut = process.env.KEY_JOB_OUTPUT_DIR && existsSync(file) ? parseReadOut(readFileSync(file, 'utf8')) : null;
  const board = cards(readOut, now);
  if (board === null) console.log('projects collector: no board read-out that proves the whole board; every metric is missing');
  const ageGoal = manifest.metrics.find((m) => m.id === 'oldest_active_hours')?.goal;
  if (board !== null && ageGoal !== undefined && process.env.DETAIL_DIR) {
    writeFileSync(path.join(process.env.DETAIL_DIR, 'detail.json'), `${JSON.stringify(stageDetail(board, now, ageGoal))}\n`);
  }
  const lane = board === null ? undefined : await laneRecord('projects');
  mkdirSync(path.dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(records(readings(board, now, views(readOut, now)), manifest, runUrl, now, lane), null, 2) + '\n');
}
