// SPDX-License-Identifier: Apache-2.0
// The Actions page's collector (PLAN.md lists each metric and why). One part failing leaves its metrics missing and the
// rest measured, so a broken read can never pass for a good number. It prints only ids and counts.
//
//   node quality-speed/pages/actions/collect.ts --out <file>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { lintDrill, localPlants, secretScanPlants, type Plant } from './drill.ts';
import { Github } from './github.ts';
import { loadLedger, MAX_LEDGER_BYTES, saveLedger } from './ledger.ts';
import {
  allowanceForecast,
  blacksmithMinutes,
  deletedRuns,
  BLACKSMITH_DAYS,
  flakyShare,
  gatesRan,
  isSitePull,
  mainGreen,
  minutesToGreen,
  percentile,
  queueDetail,
  siteRunFilter,
  slowestJobMinutes,
  spendDetail,
  toRecord,
  Unreadable,
  usdPerMerge,
  minutesPerMerge,
  type DetailReading,
  type Reading,
  type Run,
} from './measure.ts';
import { appWorkflows, gatesIntact, queueSecondsP90, repeatRunsPerMerge, tokenJobs, TOKEN_DAYS } from './moved.ts';
import { jobsWithTimeout, knownJobs, NEVER_RUN_HERE, readScripts, readWorkflows, unpinnedDependencies } from './workflows.ts';

const DAY_MS = 24 * 3_600_000;
/** Long enough for a by-hand workflow that only runs when its area changes, and short enough that a broken one shows. */
const PROVEN_DAYS = 90;

type Stage = 'lab' | 'live';
type Measure = () => Reading | null | Promise<Reading | null>;

function fromSamples(values: readonly number[], p: number): Reading | null {
  const value = percentile(values, p);
  return value === null ? null : { value, samples: values.length };
}

async function collect(out: string): Promise<number> {
  const root = process.cwd();
  const { GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  const repo = GITHUB_REPOSITORY ?? '';
  const now = new Date();
  const measuredAt = `${now.toISOString().slice(0, 19)}Z`;
  const sourceUrl = GITHUB_RUN_ID ? `https://github.com/${repo}/actions/runs/${GITHUB_RUN_ID}` : null;
  const records: unknown[] = [];

  const record = (id: string, reading: Reading | null, stage: Stage) => records.push(toRecord(id, reading, stage, measuredAt, sourceUrl));
  const take = async (id: string, stage: Stage, measure: Measure) => {
    let reading: Reading | null = null;
    try {
      reading = await measure();
    } catch (error) {
      console.error(`${id}: ${error instanceof Error ? error.constructor.name : 'failed'}`);
    }
    record(id, reading, stage);
  };

  // The workflow files, read from the commit this run checked out.
  const workflows = readWorkflows(root);
  await take('jobs_with_timeout_pct', 'live', () => jobsWithTimeout(workflows));
  await take('unpinned_dependencies', 'live', () => unpinnedDependencies(workflows, readScripts(root)));

  // The drill. Every plant must come back caught, and one that can't be run makes the reading missing.
  let lint: { real: boolean; plant: Plant } | null = null;
  try {
    lint = lintDrill(root, workflows);
  } catch (error) {
    console.error(`the lint drill: ${error instanceof Error ? error.message : 'failed'}`);
  }
  await take('workflow_lint_pass', 'live', () => (lint ? { value: lint.real ? 1 : 0, samples: 1 } : null));
  const checks: Record<string, 0 | 1> = {};
  await take('planted_failures_caught_pct', 'lab', () => {
    if (!lint) return null;
    const plants = [...localPlants(root), ...secretScanPlants(root), lint.plant];
    for (const plant of plants) checks[plant.name] = plant.caught ? 1 : 0;
    for (const plant of plants.filter((p) => !p.caught)) console.error(`not caught: ${plant.name}`);
    return { value: (plants.filter((p) => p.caught).length / plants.length) * 100, samples: plants.length };
  });

  // The records. Spend reads a whole billing month, so this reads back past the longest window. The ledger keeps the jobs
  // of runs already read, so only new and rerun runs are read (#240). A pass that leaves a run unread measures none, never
  // an estimate, but keeps what it read. A failed listing keeps the old ledger as it was.
  let ledger = loadLedger(process.env.PREV_DIR ? path.join(process.env.PREV_DIR, 'facts') : null);
  let runs: Run[] | null = null;
  let product: Run[] = [];
  let isSite: (run: Run) => boolean = () => false;
  let pulls: Awaited<ReturnType<Github['pullsSince']>> = [];
  const github = new Github(GH_TOKEN ?? '', repo);
  const since = new Date(now.getTime() - BLACKSMITH_DAYS * DAY_MS);
  if (GH_TOKEN) {
    try {
      const listed = await github.runsSince(since, now, ledger);
      ledger = listed.ledger;
      console.log(`${listed.cached} runs came from the ledger and ${listed.read} were read.`);
      if (!listed.complete) throw new Unreadable('some runs were left unread, so no run is measured');
      runs = listed.runs;
      pulls = await github.pullsSince(since);
      isSite = siteRunFilter(pulls);
      product = runs.filter((run) => !isSite(run));
      console.log(`Read ${runs.length} runs and ${pulls.length} pull requests in ${github.reads} reads; ${runs.length - product.length} runs are this site's own.`);
    } catch (error) {
      runs = null;
      console.error(`the records: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }
  if (process.env.DETAIL_DIR) {
    const bytes = saveLedger(path.join(process.env.DETAIL_DIR, 'facts'), ledger);
    console.log(`The ledger keeps ${Object.keys(ledger.runs).length} runs in ${bytes} bytes.`);
    if (bytes > MAX_LEDGER_BYTES) console.error('the ledger is past what facts/ keeps, so the next pass starts cold');
  }
  const fromRuns = (measure: (all: Run[]) => Reading | null): Measure => () => (runs ? measure(runs) : null);

  // Every dollar and Blacksmith minute counts here, the site's too: this is what's really left, and they can only lower it.
  await take('allowance_forecast_usd', 'live', fromRuns((all) => allowanceForecast(all, product, now)));
  await take('blacksmith_minutes_31d', 'live', fromRuns((all) => blacksmithMinutes(all, product, now)));
  await take('runs_deleted', 'live', fromRuns((all) => deletedRuns(all)));
  // Main reads every run, since a red main is red whoever caused it. Everything else leaves out the site's own runs.
  await take('main_green_pct', 'live', fromRuns((all) => mainGreen(all, isSite, now)));
  await take('gates_ran_pct', 'live', fromRuns(() => gatesRan(product, pulls, now)));
  await take('flaky_trees_pct', 'live', fromRuns(() => flakyShare(product, now)));
  await take('usd_per_merge', 'live', fromRuns(() => usdPerMerge(product, pulls, now)));
  await take('billed_minutes_per_merge', 'live', fromRuns(() => minutesPerMerge(product, pulls, now)));
  await take('green_minutes_p50', 'live', fromRuns(() => fromSamples(minutesToGreen(product, now), 50)));
  await take('green_minutes_p95', 'live', fromRuns(() => fromSamples(minutesToGreen(product, now), 95)));
  await take('slowest_job_minutes_p95', 'live', fromRuns(() => slowestJobMinutes(product, now)));
  await take('workflows_proven_pct', 'live', async () => {
    if (!GH_TOKEN) return null;
    const list = workflows.filter((file) => !NEVER_RUN_HERE.includes(file.name));
    const after = new Date(now.getTime() - PROVEN_DAYS * DAY_MS);
    let proven = 0;
    for (const file of list) {
      if (await github.provenSince(file.name, after)) proven += 1;
      else console.log(`Not proven in ${PROVEN_DAYS} days: ${file.name}`);
    }
    return list.length ? { value: (proven / list.length) * 100, samples: list.length } : null;
  });

  // Moved from the CI overview and GitHub App pages (moved.ts), on product runs, pull requests and workflows only.
  const productPulls = pulls.filter((pull) => !isSitePull(pull));
  await take('gates_intact', 'live', async () => {
    if (!runs || !GH_TOKEN) return null;
    const ciYml = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    return gatesIntact(product, productPulls, await github.rulesOnMain(), ciYml, now);
  });
  await take('repeat_runs_per_merge', 'live', fromRuns(() => repeatRunsPerMerge(product, productPulls, now)));
  await take('queue_seconds_p90', 'live', fromRuns(() => queueSecondsP90(product, now)));
  let token: ReturnType<typeof tokenJobs> = null;
  try {
    const minting = appWorkflows(workflows);
    if (GH_TOKEN && minting.length) token = tokenJobs(await github.tokenJobs(minting, new Date(now.getTime() - TOKEN_DAYS * DAY_MS), now));
  } catch (error) {
    console.error(`the token jobs: ${error instanceof Error ? error.constructor.name : 'failed'}`);
  }
  await take('app_token_runs_passing', 'live', () => token?.passing ?? null);
  await take('app_token_job_seconds_p50', 'live', () => token?.p50 ?? null);

  writeFileSync(out, `${JSON.stringify(records, null, 1)}\n`);

  // What sits behind the numbers, for the page's tables. A failed read leaves it out, so the page shows no table, not a false one.
  if (process.env.DETAIL_DIR) {
    let readings: Record<string, DetailReading> = {};
    // The plan's included dollars, the gauge's ceiling: a repository variable the lane passes in, never a number in this tree.
    const included = Number(process.env.ACTIONS_INCLUDED_USD);
    try {
      readings = runs ? { ...spendDetail(runs, now, knownJobs(workflows), included > 0 ? included : null), ...queueDetail(product, now) } : {};
    } catch (error) {
      console.error(`the spend detail: ${error instanceof Error ? error.constructor.name : 'failed'}`);
    }
    mkdirSync(process.env.DETAIL_DIR, { recursive: true });
    writeFileSync(path.join(process.env.DETAIL_DIR, 'detail.json'), JSON.stringify({ checks, readings }));
  }
  return records.filter((r) => (r as { status: string }).status === 'missing').length;
}

const { values } = parseArgs({ options: { out: { type: 'string' } } });
if (!values.out) {
  console.error('usage: collect.ts --out <file>');
  process.exit(1);
}
const missing = await collect(values.out);
if (missing) console.error(`${missing} metrics are missing.`);
