// SPDX-License-Identifier: Apache-2.0
// The Testing page's collector. Needs Node 24 (as CI), web/'s install (npm ci --ignore-scripts in web/) and gh signed in.
//
//   node quality-speed/pages/testing/collect.ts [--runs 3] [--out <records.json>]
//
// 1. Runs the web suite --runs times: a test that passes in one run and fails in another is flaky. Each run's CPU minutes,
//    its processes' own from /proc, give suite_cpu_minutes.
// 2. Per risk (risks.ts): its tests must pass, then each planted break must fail one of them, then every mutant of its
//    risky functions, served from memory (hook.ts), is killed or survives. As Stryker runs a mutant: only the test files
//    that load its file, fastest first, stopping at the first that fails, each with Stryker's default timeout. A mutant
//    whose file and tests are unchanged since a run that tested it takes that run's outcome (cache.ts, at MUTANT_CACHE).
// 3. Reads the `Web test` step of the last 30 pull request CI runs on one runner label.
// 4. Last, reads this lane's own job minutes so far (core/lane/collect.ts): lane_minutes.
// Writes metrics.json (the contract's records: ids and numbers only) and prints what a person needs to act on.
// A risk is proven when every planted break fails one of its tests: risks_proven is the share proven, and each risk's own
// result goes to $DETAIL_DIR/detail.json as a check, for the page's risk map.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { laneRecord } from '../../core/lane/collect.ts';
import { contextKey, mutantKey, readOutcomes, toKeep, writeOutcomes, type Ran } from './cache.ts';
import { applyMutant, mutantsOf } from './mutants.ts';
import { RISKS, type Break, type Risk } from './risks.ts';
import { childCpuSeconds, fileTimes, flaky, percent, percentile, type Outcome } from './stats.ts';

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, '../../..');
const WEB = path.join(ROOT, 'web');
const REPO = process.env.GITHUB_REPOSITORY ?? 'Colorado-Startups/legallas';
const { values: args } = parseArgs({ options: { runs: { type: 'string', default: '3' }, out: { type: 'string', default: path.join(HERE, 'metrics.json') } } });
const report: string[] = [];

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or later, as CI uses: older versions fail web tests with no break');

// core/collect.ts stops a lane at 40 minutes and then keeps none of its records. This lane reached that limit on 6 Nov
// and wrote nothing; on 7 Nov it ran out of this budget with 189 of 788 mutants unrun. So no mutant starts after it: the
// mutation score then reads missing, and every other metric still lands. A started mutant has its own timeout, and the
// API reads after it take about a minute.
const MUTANT_BUDGET_MS = 30 * 60_000;
// CI's `Web test` step runs the whole suite in about 3 minutes. A run still going at 8 is stuck: it is stopped and counts
// no CPU, so three stuck runs can't use the whole lane, as three at node()'s default 20 minutes would.
const SUITE_RUN_TIMEOUT_MS = 8 * 60_000;
const STARTED = Date.now();
const overBudget = () => Date.now() - STARTED > MUTANT_BUDGET_MS;
/** Minutes since the collector started, for the job log. */
const at = () => `${((Date.now() - STARTED) / 60_000).toFixed(1)} min`;

// Earlier runs' outcomes. The lane restores this file before the run and saves it after, a stopped run too, so a run cut
// short by the budget finishes on the next (quality-speed.yml). Saved after each risk, so a lane killed at core's limit
// keeps what it ran.
const CACHE = process.env.MUTANT_CACHE ?? '';
const cached = CACHE ? readOutcomes(CACHE) : new Map<string, Ran>();
/** This run's outcomes, taken from the cache or run. */
const outcomes = new Map<string, Ran>();
let mutantsRun = 0;
/** Risks whose mutants have no keys yet: until each has them, the older outcomes stay. */
const unkeyed = new Set(RISKS.map((r) => r.id));
function saveOutcomes() {
  if (CACHE) writeOutcomes(CACHE, toKeep(cached, outcomes, unkeyed.size > 0));
}
// What changes every outcome at once: Node and the dependencies, which the tests' own files don't show.
const SALT = `${process.version}\n${contextKey(new Map([['web/package-lock.json', readFileSync(path.join(WEB, 'package-lock.json'), 'utf8')]]))}`;
const contents = new Map<string, string | null>();
/** A loaded file's path in the checkout and its text; null outside it (a test's temporary module) or when gone. */
function projectFile(url: string): [string, string] | null {
  const rel = path.relative(ROOT, fileURLToPath(url));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (!contents.has(rel)) {
    try {
      contents.set(rel, readFileSync(path.join(ROOT, rel), 'utf8'));
    } catch {
      contents.set(rel, null);
    }
  }
  const text = contents.get(rel);
  return text == null ? null : [rel, text];
}

/** Runs node with `argv` in web/; resolves the exit code, or null when it ran past `timeoutMs` and was killed. */
function node(argv: string[], env: Record<string, string> = {}, timeoutMs = 20 * 60_000): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argv, { cwd: WEB, env: { ...process.env, ...env }, stdio: 'ignore' });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve(signal === 'SIGKILL' ? null : (code ?? 1));
    });
  });
}

/** Runs `items` through `work`, `limit` at a time. */
async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]!);
    }
  }));
  return out;
}

/** The CPU seconds this process's exited children used. Linux only: elsewhere null, and the metric reads missing. */
function childCpu(): number | null {
  try {
    return childCpuSeconds(readFileSync('/proc/self/stat', 'utf8'), Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' })));
  } catch {
    return null;
  }
}

const testArgv = (tests: readonly string[]) => ['--test', '--test-concurrency=2', '--test-reporter=dot', ...tests.map((t) => path.join(ROOT, t))];

// 1. The whole suite, several times, with the globs npm test uses. Flakes count only when every run reported the same tests.
async function suiteRuns(runs: number, tmp: string): Promise<{ flakyKeys: string[] | null; slowShare: number | null; runs: number; cpuMinutes: number[] }> {
  // npm test's own arguments, so the runs match it: node <web/scripts/run-tests.ts or --test> <flags and patterns>.
  const script: string = JSON.parse(readFileSync(path.join(WEB, 'package.json'), 'utf8')).scripts.test;
  const [, test, ...rest] = (script.match(/"[^"]+"|\S+/g) ?? []).map((t) => t.replace(/^"|"$/g, ''));
  const all: Outcome[][] = [];
  let files: { file: string; ms: number }[] = [];
  const cpuMinutes: number[] = [];
  for (let i = 0; i < runs; i++) {
    const out = path.join(tmp, `run-${i}.ndjson`);
    // The suite runs alone here, so the CPU its processes used is the difference. A run killed at the timeout counts no CPU.
    const before = childCpu();
    // A compile cache new to each run, as ci.yml's `checks` job has: the CPU counted is one CI run's.
    const cache = { NODE_COMPILE_CACHE: path.join(tmp, `compile-cache-${i}`) };
    const code = await node([test ?? '--test', `--test-reporter=${path.join(HERE, 'reporter.ts')}`, `--test-reporter-destination=${out}`, ...rest], cache, SUITE_RUN_TIMEOUT_MS);
    const after = childCpu();
    if (code !== null && before !== null && after !== null) cpuMinutes.push((after - before) / 60);
    console.log(`testing lab: suite run ${i + 1} exited ${code ?? 'at its timeout'}, ${before !== null && after !== null ? ((after - before) / 60).toFixed(2) : '?'} CPU minutes, at ${at()}`);
    const lines = existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    all.push(lines.filter((l) => 'passed' in l).map((l) => ({ key: `${path.relative(ROOT, l.file)} ${l.name}`, passed: l.passed })));
    if (i === 0) files = fileTimes(lines).map((f) => ({ ...f, file: path.relative(ROOT, f.file) }));
  }
  console.log(`testing lab: slowest test files in run 1: ${files.slice(0, 10).map((f) => `${f.file} ${(f.ms / 1000).toFixed(1)} s`).join(', ')}`);
  const keys = all.map((run) => run.map((o) => o.key).sort().join('\n'));
  const comparable = all.length >= 2 && all[0]!.length > 0 && keys.every((k) => k === keys[0]);
  const sum = (list: { ms: number }[]) => list.reduce((a, f) => a + f.ms, 0);
  return { flakyKeys: comparable ? flaky(all) : null, slowShare: percent(sum(files.slice(0, 10)), sum(files)), runs: all.length, cpuMinutes };
}

// 2. Risks.
/** Runs `work` with `brk` written into the checkout, then puts the file back; undefined when `find` does not match once. */
async function withBreak<T>(brk: Break, work: () => Promise<T>): Promise<T | undefined> {
  const file = path.join(ROOT, brk.file);
  const created = brk.find === '' && !existsSync(file);
  const before = created ? '' : readFileSync(file, 'utf8');
  if (!created && before.split(brk.find).length !== 2) return undefined;
  writeFileSync(file, created ? brk.replace : before.replace(brk.find, brk.replace));
  try {
    return await work();
  } finally {
    if (created) rmSync(file);
    else writeFileSync(file, before);
  }
}

interface RiskResult {
  id: string;
  proven: boolean;
  mutants: number;
  killed: number;
  /** Of those killed, how many by running past their timeout rather than failing. */
  timedOut: number;
  /** In a file no test of the risk loads: never run, counted as survived (Stryker's "no coverage"). */
  uncovered: number;
  /** hook.ts failed a test with no mutant, so a killed mutant proves nothing. */
  hookFailed: boolean;
  /** Mutants left unrun when the budget ran out, so the score would read only part of them. */
  unrun: number;
  /** Of those killed or survived, how many took an earlier run's outcome. */
  cached: number;
}

/** One test file, alone, with no break or mutant: its time and the project files it loaded. */
interface TestRun {
  test: string;
  ms: number;
  loads: ReadonlySet<string>;
}

const HOOK = path.join(HERE, 'hook.ts');
const throughHook = (env: Record<string, string>) => ({ NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${HOOK}`.trim(), ...env });
/** Stryker's default timeout: 1.5 times the test's own time, plus 5 seconds. Past it, a mutant counts as killed. */
const timeoutFor = (ms: number) => Math.round(1.5 * ms) + 5_000;

/** Runs `tests` one file at a time, in order, and stops at the first that fails ('failed') or runs past its timeout. */
async function firstFailure(tests: readonly TestRun[], env?: Record<string, string>): Promise<'failed' | 'timeout' | null> {
  for (const t of tests) {
    const code = await node(testArgv([t.test]), env, timeoutFor(t.ms));
    if (code === null) return 'timeout';
    if (code !== 0) return 'failed';
  }
  return null;
}

/** Runs `test` alone through hook.ts, recording each project file it loads; null when it fails. */
async function baseline(test: string, tmp: string): Promise<TestRun | null> {
  const seen = path.join(tmp, `seen-${test.replaceAll('/', '_')}.txt`);
  const start = Date.now();
  const code = await node(testArgv([test]), throughHook({ MUTANT_SEEN: seen }));
  const ms = Date.now() - start;
  if (code !== 0) return null;
  return { test, ms, loads: new Set(existsSync(seen) ? readFileSync(seen, 'utf8').split('\n').filter(Boolean) : []) };
}

async function measureRisk(risk: Risk, tmp: string): Promise<RiskResult> {
  const begun = Date.now();
  const mutants = Object.entries(risk.code).flatMap(([file, names]) => {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    return mutantsOf(file, source, names).flatMap((mutant) => {
      const text = applyMutant(source, mutant);
      return text === null ? [] : [{ mutant, text }];
    });
  });
  // Until its tests pass with no break, a risk proves nothing and every mutant counts as survived.
  const result: RiskResult = { id: risk.id, proven: false, mutants: mutants.length, killed: 0, timedOut: 0, uncovered: 0, hookFailed: false, unrun: 0, cached: 0 };
  const missing = risk.tests.filter((t) => !existsSync(path.join(ROOT, t)));
  if (missing.length > 0) {
    report.push(`- ${risk.id}: its tests are missing (${missing.join(', ')}), so nothing is proven`);
    return result;
  }
  // Each test file alone, fastest first from here on, as Stryker orders them.
  const runs: TestRun[] = [];
  for (const test of risk.tests) {
    const run = await baseline(test, tmp);
    if (run) {
      runs.push(run);
      continue;
    }
    // A test that fails only through hook.ts means the hook is broken, and every mutant would count as killed.
    if ((await node(testArgv([test]))) === 0) {
      report.push(`- ${risk.id}: ${test} fails only through hook.ts, so the mutation score is missing`);
      result.hookFailed = true;
    } else report.push(`- ${risk.id}: ${test} fails with no break, so nothing is proven`);
    return result;
  }
  runs.sort((a, b) => a.ms - b.ms);

  let caught = 0;
  for (const brk of risk.breaks) {
    // Every test, not only those that load the file: a break can be in a file read rather than imported (a migration).
    const failed = await withBreak(brk, () => firstFailure(runs));
    if (failed === undefined) report.push(`- ${risk.id}: a planted break no longer matches ${brk.file}`);
    else if (failed === null) report.push(`- ${risk.id}: no test fails when ${brk.file} gets ${JSON.stringify(brk.replace.slice(0, 60))}`);
    else caught++;
  }
  result.proven = risk.breaks.length > 0 && caught === risk.breaks.length;

  // The tests that load each file, fastest first. Its fastest one must pass with the file served unchanged through
  // hook.ts, or a served file breaks tests and every mutant would count as killed.
  const covering = new Map<string, TestRun[]>();
  const context = new Map<string, string>();
  for (const file of Object.keys(risk.code)) {
    const real = realpathSync(path.join(ROOT, file));
    const tests = runs.filter((r) => r.loads.has(pathToFileURL(real).href));
    covering.set(file, tests);
    context.set(file, contextKey(new Map(tests.flatMap((t) => [...t.loads]).map(projectFile).filter((f): f is [string, string] => f !== null))));
    if (tests.length === 0) report.push(`- ${risk.id}: no test loads ${file}, so its mutants survive unrun`);
    else if ((await firstFailure(tests.slice(0, 1), throughHook({ MUTANT_FILE: real, MUTANT_SOURCE: real }))) !== null) {
      report.push(`- ${risk.id}: ${tests[0]!.test} fails with ${file} served unchanged through hook.ts, so the mutation score is missing`);
      result.hookFailed = true;
      return result;
    }
  }

  unkeyed.delete(risk.id);
  const found = await pool(mutants, availableParallelism(), async ({ mutant, text }) => {
    const tests = covering.get(mutant.file) ?? [];
    if (tests.length === 0) return 'uncovered';
    const key = mutantKey(SALT, context.get(mutant.file)!, text);
    // A cached outcome costs nothing, so it counts even after the budget runs out.
    let ran = cached.get(key);
    if (ran) result.cached++;
    else {
      if (overBudget()) return 'unrun';
      const source = path.join(tmp, `${risk.id}-${mutant.start}-${mutant.text.length}.ts`);
      writeFileSync(source, text);
      mutantsRun++;
      ran = (await firstFailure(tests, throughHook({ MUTANT_FILE: realpathSync(path.join(ROOT, mutant.file)), MUTANT_SOURCE: source }))) ?? 'survived';
    }
    outcomes.set(key, ran);
    if (ran === 'survived') report.push(`- ${risk.id}: survived ${mutant.file}:${mutant.line} -> ${JSON.stringify(mutant.text.slice(0, 40))}`);
    return ran;
  });
  const count = (o: string) => found.filter((x) => x === o).length;
  result.timedOut = count('timeout');
  result.killed = count('failed') + result.timedOut;
  result.uncovered = count('uncovered');
  result.unrun = count('unrun');
  if (result.unrun) report.push(`- ${risk.id}: the mutant budget ran out with ${result.unrun} of ${mutants.length} mutants unrun, so the mutation score is missing`);
  console.log(
    `testing lab: ${risk.id} killed ${result.killed} of ${mutants.length} mutants (${result.timedOut} by timeout, ${result.uncovered} uncovered, ${result.unrun} unrun; ${result.cached} cached, ${mutants.length - result.cached - result.uncovered - result.unrun} run) in ${((Date.now() - begun) / 60_000).toFixed(1)} min, at ${at()}`,
  );
  return result;
}

// 3. The `Web test` step of pull request CI runs, on the runner label of the newest one, so a runner change is not read
// as the suite getting slower or faster.
interface Job {
  name: string;
  labels: string[];
  steps: { name: string; conclusion: string | null; started_at: string | null; completed_at: string | null }[];
}
const gh = (route: string) => JSON.parse(execFileSync('gh', ['api', route], { encoding: 'utf8', maxBuffer: 64 << 20 }));

function webTestSteps(wanted = 30): number[] | null {
  try {
    const seconds: number[] = [];
    let label: string | undefined;
    for (let page = 1; page <= 5 && seconds.length < wanted; page++) {
      const { workflow_runs: runs } = gh(`repos/${REPO}/actions/workflows/ci.yml/runs?event=pull_request&status=completed&per_page=100&page=${page}`);
      if (runs.length === 0) break;
      for (const run of runs) {
        if (seconds.length >= wanted) break;
        const job = (gh(`repos/${REPO}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`).jobs as Job[]).find((j) => j.name === 'checks');
        const step = job?.steps.find((s) => s.name === 'Web test');
        if (!job || !step?.started_at || !step.completed_at || (step.conclusion !== 'success' && step.conclusion !== 'failure')) continue;
        label ??= job.labels.join(',');
        if (job.labels.join(',') === label) seconds.push((Date.parse(step.completed_at) - Date.parse(step.started_at)) / 1000);
      }
    }
    return seconds;
  } catch (error) {
    report.push(`- GitHub API unreadable (${error instanceof Error ? error.message.split('\n')[0] : 'unknown'}): speed metrics are missing`);
    return null;
  }
}

// Records. Outside CI there is no run to link, so a reading is written stale, which scores 0: only the CI run counts.
const runUrl = process.env.GITHUB_RUN_ID ? `https://github.com/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
const commitUrl = `https://github.com/${REPO}/commit/${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()}`;
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
function record(id: string, value: number | null, stage: 'lab' | 'live', samples: number) {
  if (value === null) return { id, page: 'testing', value: null, status: 'missing', stage, measured_at: null, source_url: null, sample_size: null };
  return { id, page: 'testing', value, status: runUrl ? 'ok' : 'stale', stage, measured_at: now, source_url: runUrl ?? commitUrl, sample_size: samples };
}

const tmp = mkdtempSync(path.join(tmpdir(), 'qs-testing-'));
try {
  // Written at once, so the lane's save step finds a file even if the lane stops in the suite runs.
  saveOutcomes();
  const suite = await suiteRuns(Number(args.runs), tmp);
  const risks: RiskResult[] = [];
  for (const risk of RISKS) {
    risks.push(await measureRisk(risk, tmp));
    saveOutcomes();
  }
  const total = (k: 'mutants' | 'cached' | 'unrun') => risks.reduce((a, r) => a + r[k], 0);
  console.log(`testing lab: mutants ${total('cached')} cached, ${mutantsRun} run, ${total('unrun')} unrun, of ${total('mutants')}, at ${at()}`);
  const steps = webTestSteps();
  const mutants = risks.reduce((a, r) => a + r.mutants, 0);
  const metrics = [
    record('risks_proven', percent(risks.filter((r) => r.proven).length, risks.length), 'lab', risks.length),
    record('risk_mutation_score', risks.some((r) => r.hookFailed || r.unrun > 0) ? null : percent(risks.reduce((a, r) => a + r.killed, 0), mutants), 'lab', mutants),
    record('flaky_tests', suite.flakyKeys?.length ?? null, 'lab', suite.runs),
    record('web_test_step_p50', steps && percentile(steps, 50), 'live', steps?.length ?? 0),
    record('web_test_step_p95', steps && percentile(steps, 95), 'live', steps?.length ?? 0),
    record('suite_cpu_minutes', suite.cpuMinutes.length ? Math.round(percentile(suite.cpuMinutes, 50)! * 100) / 100 : null, 'lab', suite.cpuMinutes.length),
    // After the suite runs and every mutant, so it times the whole lane.
    await laneRecord('testing'),
  ];
  writeFileSync(args.out, `${JSON.stringify(metrics, null, 2)}\n`);
  if (process.env.DETAIL_DIR) {
    mkdirSync(process.env.DETAIL_DIR, { recursive: true });
    const checks = Object.fromEntries(risks.map((r) => [r.id, r.proven ? 1 : 0]));
    writeFileSync(path.join(process.env.DETAIL_DIR, 'detail.json'), `${JSON.stringify({ checks, readings: {} })}\n`);
  }
  console.log(JSON.stringify({ risks, slowest10FileShare: suite.slowShare, flaky: suite.flakyKeys, suiteCpuMinutes: suite.cpuMinutes }, null, 2));
  console.log(['', 'To act on:', ...report].join('\n'));
} finally {
  saveOutcomes();
  rmSync(tmp, { recursive: true, force: true });
}
