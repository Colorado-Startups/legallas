// SPDX-License-Identifier: Apache-2.0
// Writes a law page's metrics.json and law.json from its needs.json (README.md). Only metrics on the page's manifest get
// a record; one the kit can't measure, such as the questions with no eval report, gets none and so reads missing.
// law.json is what the page draws: the build runs page code fenced inside quality-speed/, where the law files can't be read.
// As a lane's collector (core/collect.ts), records go to --out and law.json to $DETAIL_DIR/page/, which the build copies
// beside page.ts. Run by hand, both land in the page's folder, and every record reads missing: an ok reading needs the run's link.
// The report is --eval, else the newest the law-eval job left in $KEY_JOB_OUTPUT_DIR/law-eval/eval/. Each question's newest
// turn with the model goes to $DETAIL_DIR/facts/law-runs.json and comes back in $PREV_DIR next run: the job answers a slice a day.
//
//   node quality-speed/core/law/collect.ts <slug> [--eval <law-eval report>] [--out <records file>]
//                                  the report's law folder must hold the library it searched, out/, for the tokens
//   node quality-speed/core/law/collect.ts --questions     every law page's questions, in the law eval's format
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';
import type { PageSlug } from '../../contract/pages.ts';
import { REPO } from '../../contract/pages.ts';
import { laneMinutes, runJobs } from '../lane/minutes.ts';
import { answerRuns, carryRuns, evalSpend, lawLibrary, lawView, lookupTokens, questionsPassed, ROOT, searchP95, type AnswerRun, type Value } from './law.ts';

interface Run {
  at: string;
  /** The CI run's link, or null outside CI. */
  url: string | null;
}

/** The records for the manifest's metrics that the kit measured. Outside CI there is no run link, so each reads missing. */
export function records(page: PageSlug, ids: readonly string[], values: Record<string, Value & { at?: string }>, run: Run): MetricRecord[] {
  return ids.flatMap((id): MetricRecord[] => {
    const v = values[id];
    if (!v) return [];
    if (v.value === null || run.url === null) return [{ id, page, value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null }];
    return [{ id, page, value: v.value, status: 'ok', stage: 'lab', measured_at: v.at ?? run.at, source_url: run.url, sample_size: v.samples }];
  });
}

/** Each question's newest turn with the model, in the lane's facts/ (core/detail.ts), back in $PREV_DIR next run. */
const RUNS_FILE = 'law-runs.json';

/** The newest law eval report in `dir`, by name (eval.ts names each by its time), or null. */
export function newestReport(dir: string | undefined): string | null {
  if (!dir || !existsSync(dir)) return null;
  const names = readdirSync(dir).filter((name) => /^law-eval-[\dT-]+Z\.json$/.test(name)).sort();
  return names.length ? path.join(dir, names.at(-1)!) : null;
}

/** What the lane's last run carried, or nothing: the file is only ever the lane's own, and carryRuns drops what it can't read. */
function carried(prevDir: string | undefined): unknown {
  try {
    return prevDir ? JSON.parse(readFileSync(path.join(prevDir, 'facts', RUNS_FILE), 'utf8')) : [];
  } catch {
    return [];
  }
}

/** The pages with a needs.json. */
export function lawPages(root = ROOT): string[] {
  const dir = path.join(root, 'quality-speed/pages');
  return existsSync(dir) ? readdirSync(dir).filter((slug) => existsSync(path.join(dir, slug, 'needs.json'))) : [];
}

async function main(): Promise<void> {
  const { values: flags, positionals } = parseArgs({ allowPositionals: true, options: { eval: { type: 'string' }, out: { type: 'string' }, questions: { type: 'boolean' } } });
  if (flags.questions) {
    console.log(JSON.stringify(lawPages().flatMap((slug) => lawView(slug).list.questions ?? []), null, 1));
    return;
  }
  const [slug] = positionals;
  if (!slug || positionals.length > 1) throw new Error('usage: collect.ts <slug> [--eval <law-eval report>] [--out <records file>] | --questions');
  const keyJob = process.env.KEY_JOB_OUTPUT_DIR;
  const report = flags.eval ?? newestReport(keyJob && path.join(keyJob, 'law-eval', 'eval'));
  const { list, ...view } = lawView(slug);
  const values: Record<string, Value & { at?: string }> = { ...view.values };
  if (list.questions?.length) {
    let fresh: AnswerRun[] = [];
    if (report) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(report, 'utf8'));
        fresh = answerRuns(parsed);
        // eval.ts writes its report to <law folder>/eval/, beside the library it searched in <law folder>/out.
        values.law_lookup_tokens_p95 = lookupTokens(list.questions, parsed, lawLibrary(path.dirname(path.dirname(path.resolve(report)))));
        values.search_p95 = searchP95(list.questions, parsed);
      } catch (error) {
        console.error(`the eval report: ${(error as Error).message}; what it would measure reads missing`);
      }
    }
    const runs = carryRuns(list.questions, fresh, carried(process.env.PREV_DIR), new Date());
    if (runs.length) {
      values.questions = questionsPassed(list.questions, runs);
      values.eval_usd = evalSpend(list.questions, runs);
    }
    if (process.env.DETAIL_DIR) {
      mkdirSync(path.join(process.env.DETAIL_DIR, 'facts'), { recursive: true });
      writeFileSync(path.join(process.env.DETAIL_DIR, 'facts', RUNS_FILE), `${JSON.stringify(runs)}\n`);
    }
  }
  const run = process.env.GITHUB_RUN_ID;
  const job = `${slug} (${process.env.LANE ?? 'law'})`;
  const minutes = laneMinutes(await runJobs(run, process.env.GH_TOKEN), job, new Date());
  if (minutes) values.lane_minutes = minutes;
  else if (run) console.error(`lane_minutes reads missing: no GH_TOKEN, a failed jobs call, or no started job named "${job}" (from LANE) in this run's first 100`);
  const pageDir = path.join(ROOT, 'quality-speed/pages', slug);
  const manifest = JSON.parse(readFileSync(path.join(pageDir, 'manifest.json'), 'utf8')) as { metrics: { id: string }[] };
  const out = records(slug as PageSlug, manifest.metrics.map((m) => m.id), values, {
    at: `${new Date().toISOString().slice(0, 19)}Z`,
    url: run ? `https://github.com/Colorado-Startups/${REPO}/actions/runs/${run}` : null,
  });
  const viewDir = process.env.DETAIL_DIR ? path.join(process.env.DETAIL_DIR, 'page') : pageDir;
  mkdirSync(viewDir, { recursive: true });
  writeFileSync(flags.out ?? path.join(pageDir, 'metrics.json'), `${JSON.stringify(out, null, 1)}\n`);
  writeFileSync(path.join(viewDir, 'law.json'), `${JSON.stringify({ ...view, values })}\n`);
  for (const r of out) console.log(`${r.id.padEnd(12)} ${r.value ?? r.status}`);
  for (const f of view.fixes) console.log(`fix: ${f.metric} +${f.gain.toFixed(2)} ${f.what}`);
}

if (import.meta.main) await main();
