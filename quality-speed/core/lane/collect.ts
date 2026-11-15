// SPDX-License-Identifier: Apache-2.0
// One record, lane_minutes: the minutes the job "<slug> ($LANE)" has run when this ends, read as the law kit reads it. Outside
// CI, with no token, on a failed read, or with no such job started, it reads missing, never 0. The page's manifest lists
// lane_minutes, or the record is dropped. A page's own collector can call laneRecord() too, to time its own lane.
//
//   node quality-speed/core/lane/collect.ts <slug> --out <records file>
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';
import { PAGES, REPO, type PageSlug } from '../../contract/pages.ts';
import { laneMinutes, runJobs } from './minutes.ts';

export async function laneRecord(page: PageSlug, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<MetricRecord> {
  const run = env.GITHUB_RUN_ID;
  const job = `${page} (${env.LANE})`;
  const minutes = run && env.LANE ? laneMinutes(await runJobs(run, env.GH_TOKEN), job, now) : null;
  const id = 'lane_minutes';
  if (!minutes) {
    if (run) console.error(`lane_minutes reads missing: no GH_TOKEN or LANE, a failed jobs call, or no started job named "${job}" in this run's first 100`);
    return { id, page, value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null };
  }
  const source_url = `https://github.com/Colorado-Startups/${REPO}/actions/runs/${run}`;
  return { id, page, value: minutes.value, status: 'ok', stage: 'lab', measured_at: `${now.toISOString().slice(0, 19)}Z`, source_url, sample_size: minutes.samples };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' } } });
  const [slug] = positionals;
  if (!slug || positionals.length > 1 || !(PAGES as readonly string[]).includes(slug) || !values.out) throw new Error('usage: collect.ts <slug> --out <records file>');
  const record = await laneRecord(slug as PageSlug);
  writeFileSync(values.out, `${JSON.stringify([record], null, 1)}\n`);
  console.log(`lane_minutes ${record.value ?? record.status}`);
}
