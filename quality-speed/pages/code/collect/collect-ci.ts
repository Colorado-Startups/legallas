// SPDX-License-Identifier: Apache-2.0
// The metrics read from CI's records: the web loop's median step time, the Mac jobs' wall time and pass or fail on
// today's Swift tree (part of the checks gate).
import { execFileSync } from 'node:child_process';
import {
  MAC_JOBS,
  SWIFT_TREE_PATHS,
  ciRuns,
  latestMacRunOnTree,
  macLoopSample,
  median,
  pullHeadsFor,
  runJobs,
  runsForSha,
  summarize,
  treeKey,
  webLoopSample,
  type Sample,
} from './ci.ts';
import type { Context } from './main.ts';
import type { Measurement } from './records.ts';

const WEB_WINDOW_DAYS = 30;
const WEB_SAMPLES = 20;

async function webLoop(ctx: Context, measured: Map<string, Measurement>, details: Record<string, unknown>) {
  const runs = (await ciRuns(ctx.api, ctx.repo, 2)).filter(
    (r) => ctx.now.getTime() - Date.parse(r.created_at) <= WEB_WINDOW_DAYS * 86_400_000,
  );
  const samples: Sample[] = [];
  for (const run of runs) {
    if (samples.length >= WEB_SAMPLES * 2) break;
    const checks = (await runJobs(ctx.api, ctx.repo, run.id)).find((j) => j.name === 'checks');
    const sample = checks && webLoopSample(checks, run);
    if (sample) samples.push(sample);
  }
  const summary = summarize(samples, ctx.now, WEB_WINDOW_DAYS, WEB_SAMPLES);
  details.webLoop = summary ?? { samples: [] };
  if (!summary) return;
  measured.set('web_loop_seconds', {
    value: summary.value,
    time: summary.samples[0]?.at ?? '',
   
    sampleSize: summary.samples.length,
  });
}

const MAC_WINDOW_DAYS = 90;
const MAC_SAMPLES = 5;

/**
 * Mac wall-time samples from runs before `newestRunId`, newest first: the runs of the last few main commits that
 * changed Swift paths, and of their pull requests' heads. One VM timing is too noisy to carry 40 % of Speed alone.
 */
async function olderMacSamples(ctx: Context, newestRunId: number): Promise<Sample[]> {
  const commits = execFileSync('git', ['-C', ctx.root, 'log', '-n', '8', '--format=%H', 'HEAD', '--', ...SWIFT_TREE_PATHS], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const seen = new Set<number>([newestRunId]);
  const samples: Sample[] = [];
  for (const commit of commits) {
    const shas = [commit, ...(await pullHeadsFor(ctx.api, ctx.repo, commit))];
    for (const sha of shas) {
      for (const run of await runsForSha(ctx.api, ctx.repo, sha)) {
        if (seen.has(run.id)) continue;
        seen.add(run.id);
        const sample = macLoopSample(await runJobs(ctx.api, ctx.repo, run.id), run);
        if (sample) samples.push(sample);
      }
    }
    if (samples.length >= MAC_SAMPLES) break;
  }
  return samples.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

async function macJobs(ctx: Context, measured: Map<string, Measurement>, details: Record<string, unknown>) {
  const swiftCommit = execFileSync('git', ['-C', ctx.root, 'log', '-1', '--format=%H', 'HEAD', '--', ...SWIFT_TREE_PATHS], { encoding: 'utf8' }).trim();
  const entries = execFileSync('git', ['-C', ctx.root, 'ls-tree', 'HEAD', ...SWIFT_TREE_PATHS], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [meta = '', path = ''] = line.split('\t');
      return { path, sha: meta.split(' ')[2] ?? '' };
    });
  const found = await latestMacRunOnTree(ctx.api, ctx.repo, swiftCommit, treeKey(entries));
  if (!found) throw new Error('no CI run of the Mac jobs on the current Swift tree');
  const failed = MAC_JOBS.filter((name) => found.jobs.find((j) => j.name === name)?.conclusion !== 'success');
  details.macGate = { run: found.run.html_url, failed };
  const gate = measured.get('checks_failing');
  if (gate) measured.set('checks_failing', { ...gate, value: gate.value + failed.length });

  const newest = macLoopSample(found.jobs, found.run);
  if (newest) {
    const samples = [newest, ...(await olderMacSamples(ctx, found.run.id))];
    const recent = samples.filter((s) => ctx.now.getTime() - Date.parse(s.at) <= MAC_WINDOW_DAYS * 86_400_000).slice(0, MAC_SAMPLES);
    details.macLoop = { samples: recent };
    measured.set('mac_loop_seconds', { value: median(recent.map((s) => s.value)), time: newest.at, sampleSize: recent.length });
  }
}

export async function measureCi(ctx: Context, measured: Map<string, Measurement>, details: Record<string, unknown>) {
  const errors: string[] = [];
  for (const part of [webLoop, macJobs]) {
    try {
      await part(ctx, measured, details);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length > 0) throw new Error(errors.join('; '));
}
