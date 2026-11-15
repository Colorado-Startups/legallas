// SPDX-License-Identifier: Apache-2.0
// The Code page's collector, as core/collect.ts runs it: `node quality-speed/pages/code/collect/main.ts nightly
// --out <file>`. It measures the current commit and writes <file>, the readings in the shared format, one per metric of
// that lane, missing where a measurement failed, and $DETAIL_DIR/facts/details.json, the drill-down for people
// (offenders and samples): lane memory in core/detail.ts's terms, kept in the state and never published. Each group of measurements fails on its own, so one broken API call
// or tool marks only its metrics missing. Outside a CI run there is no run link, so every reading is missing; the
// measured values still print, for a local look.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type * as TS from 'typescript';
import { laneRecord } from '../../../core/lane/collect.ts';
import { classify, type Classification, type RepoView } from './classify.ts';
import { fetchApi, type Api } from './ci.ts';
import { measureCi } from './collect-ci.ts';
import { measureDependencies } from './collect-deps.ts';
import { measureDeadCode, measureDuplication, measureShapes, type Shapes } from './measure-code.ts';
import { runWebCheck, runWebTests } from './measure-web.ts';
import { buildRecords, checkRecords, laneIds, readManifest, type Measurement } from './records.ts';

export interface Context {
  repo: string;
  root: string;
  head: string;
  now: Date;
  view: RepoView;
  ts: typeof TS;
  classes: Classification;
  api: Api;
  out: string;
}

const shapeCache = new WeakMap<Context, Shapes>();
function shapesOf(ctx: Context): Shapes {
  let shapes = shapeCache.get(ctx);
  if (!shapes) {
    shapes = measureShapes(ctx.ts, ctx.view, ctx.classes);
    shapeCache.set(ctx, shapes);
  }
  return shapes;
}

type Group = (ctx: Context, measured: Map<string, Measurement>, details: Record<string, unknown>) => void | Promise<void>;

const daily: Record<string, Group> = {
  tests: (ctx, measured, details) => {
    const run = runWebTests(ctx.root, ctx.out);
    const checkPassed = runWebCheck(ctx.root);
    // A non-zero exit with no failed test (a crash, a file that would not load) is one failure of its own.
    const crashed = run.exitCode !== 0 && run.report.failures === 0 ? 1 : 0;
    const failing = run.report.failures + run.report.unexpectedSkips + crashed + (checkPassed ? 0 : 1);
    details.tests = { ...run.report, exitCode: run.exitCode, seconds: run.seconds, checkPassed };
    // collect-ci.ts adds the Mac jobs' result; main() drops this record when it could not.
    measured.set('checks_failing', { value: failing, time: ctx.now.toISOString(), sampleSize: run.report.tests });
  },
  shapes: (ctx, measured, details) => {
    const shapes = shapesOf(ctx);
    const t = ctx.now.toISOString();
    const escapes = shapes.escapes.reduce((a, e) => a + e.count, 0);
    details.shapes = {
      files: shapes.files.length,
      functions: shapes.functions,
      longFunctions: shapes.longFunctions,
      longFiles: shapes.longFiles,
      escapes: shapes.escapes,
      productionCodeLines: shapes.productionCodeLines,
    };
    measured.set('long_functions', { value: shapes.longFunctions.length, time: t, sampleSize: shapes.functions });
    measured.set('long_files', { value: shapes.longFiles.length, time: t, sampleSize: shapes.files.length });
    measured.set('type_escapes', { value: escapes, time: t, sampleSize: shapes.productionCodeLines });
    const dup = measureDuplication(ctx.view, shapes);
    details.duplication = { ...dup, byFile: dup.byFile.slice(0, 50) };
    measured.set('duplication', { value: dup.percent, time: t, sampleSize: dup.codeLines });
  },
  dead: (ctx, measured, details) => {
    const findings = measureDeadCode(ctx.ts, ctx.root, ctx.view, ctx.classes);
    details.deadCode = findings;
    measured.set('dead_code', { value: findings.length, time: ctx.now.toISOString(), sampleSize: 1 });
  },
  dependencies: measureDependencies,
  ci: measureCi,
};


/** The one lane's groups. */
const LANES: Record<string, Record<string, Group>> = { nightly: daily };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

/** `gh api` as an Api, for runs outside CI where gh holds the login. */
function ghApi(): Api {
  return async (path) => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

async function main() {
  const lane = process.argv[2] ?? '';
  const groups = LANES[lane];
  if (!groups) throw new Error(`unknown lane ${lane}: use nightly`);
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel');
  const outFile = arg('out') ?? join(root, `quality-speed/pages/code/out/${lane}.json`);
  const detailDir = process.env.DETAIL_DIR ? join(process.env.DETAIL_DIR, 'facts') : dirname(outFile);
  mkdirSync(dirname(outFile), { recursive: true });
  mkdirSync(detailDir, { recursive: true });
  // Test reports are working files: they stay out of the kept detail.
  const out = mkdtempSync(join(tmpdir(), 'qs-code-'));
  const repo = process.env.GITHUB_REPOSITORY ?? 'Colorado-Startups/legallas';
  const head = git(root, 'rev-parse', 'HEAD');
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const run = process.env.GITHUB_RUN_ID ? `${server}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const api = token && process.env.QS_API !== 'gh' ? fetchApi(token) : ghApi();
  const files = git(root, 'ls-files').split('\n').filter(Boolean);
  const view: RepoView = { files, read: (p) => readFileSync(join(root, p), 'utf8') };
  const ts = createRequire(join(root, 'web/package.json'))('typescript') as typeof TS;
  const ctx: Context = { repo, root, head, now: new Date(), view, ts, classes: classify(ts, view), api, out };
  const page = join(root, 'quality-speed/pages/code');
  const manifest = readManifest(readFileSync(join(page, 'manifest.json'), 'utf8'));
  const ids = laneIds(manifest, lane);
  const measured = new Map<string, Measurement>();
  const details: Record<string, unknown> = { head, lane, entries: ctx.classes.entries, errors: {} as Record<string, string> };
  details.classes = Object.fromEntries(['production', 'test', 'helper', 'orphan'].map((k) => [k, [...ctx.classes.classes.values()].filter((v) => v === k).length]));
  // Helpers fall out of type escapes, so the list is published: a module that loses its last
  // production importer shows up here.
  details.helpers = [...ctx.classes.classes].filter(([, k]) => k === 'helper').map(([f]) => f).sort();
  for (const [name, group] of Object.entries(groups)) {
    try {
      await group(ctx, measured, details);
    } catch (error) {
      (details.errors as Record<string, string>)[name] = error instanceof Error ? error.message : String(error);
    }
  }
  // Last, after every group, so it times the whole lane: the lane's own minutes so far, or nothing, which reads missing.
  const minutes = await laneRecord('code');
  if (minutes.value !== null && minutes.measured_at !== null && minutes.sample_size !== null) {
    measured.set(minutes.id, { value: minutes.value, time: minutes.measured_at, sampleSize: minutes.sample_size });
  }
  // The gate covers the Mac jobs too: without their result the reading is missing, which scores 0.
  if (ids.includes('checks_failing') && details.macGate === undefined) measured.delete('checks_failing');
  // The raw values, for the drill-down and a local preview; the page scores only the validated readings.
  details.measured = Object.fromEntries([...measured].filter(([id]) => ids.includes(id)));
  const records = buildRecords(manifest, ids, measured, run, new Date());
  checkRecords(records, manifest, new Date());
  writeFileSync(outFile, `${JSON.stringify(records, null, 2)}\n`);
  writeFileSync(join(detailDir, 'details.json'), `${JSON.stringify(details, null, 2)}\n`);
  for (const id of ids) {
    const m = measured.get(id);
    const r = records.find((x) => x.id === id);
    console.log(`${r?.status === 'ok' ? 'ok     ' : 'missing'} ${id} ${m ? `${m.value} (n=${m.sampleSize})` : 'not measured'}`);
  }
  for (const [name, message] of Object.entries(details.errors as Record<string, string>)) console.log(`error in ${name}: ${message}`);
}

if (import.meta.main) await main();
