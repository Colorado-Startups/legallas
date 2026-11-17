// SPDX-License-Identifier: Apache-2.0
// The page's arithmetic, on invented run and job records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Manifest } from '../../contract/format.ts';
import { validateRecords } from '../../contract/validate.ts';
import { isDetail } from '../../core/detail.ts';
import {
  allowanceForecast,
  billedMinutes,
  blacksmithMinutes,
  deletedRuns,
  detailId,
  flakyShare,
  gatesRan,
  isSiteFile,
  isSitePull,
  mainGreen,
  minutesToGreen,
  percentile,
  queueDetail,
  runnerOf,
  siteRunFilter,
  slowestJobMinutes,
  spendDetail,
  spendUsd,
  toRecord,
  Unreadable,
  usdPerMerge,
  minutesPerMerge,
  type Job,
  type PullRequest,
  type Run,
} from './measure.ts';
import { localPlants } from './drill.ts';
import { jobBlocks, knownJobs, readWorkflows } from './workflows.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const NOW = new Date('2026-11-16T12:00:00Z');
const AT = '2026-11-16T10:00:00Z';
const after = (time: string, seconds: number) => new Date(Date.parse(time) + seconds * 1000).toISOString();
const CI = '.github/workflows/ci.yml';
const DCO = '.github/workflows/dco.yml';
const REVIEW = '.github/workflows/claude-review.yml';
const SHA = 'a'.repeat(40);
const RAN_TESTS = [{ name: 'Web test', conclusion: 'success' }];

const job = (more: Partial<Job> = {}): Job => ({
  name: 'checks',
  run_attempt: 1,
  conclusion: 'success',
  created_at: AT,
  started_at: after(AT, 5),
  completed_at: after(AT, 65),
  runner_name: 'runner',
  labels: ['ubuntu-latest'],
  steps: [],
  ...more,
});
const run = (more: Partial<Run> = {}): Run => ({
  id: 1,
  path: CI,
  event: 'pull_request',
  status: 'completed',
  conclusion: 'success',
  run_attempt: 1,
  run_number: 1,
  head_branch: 'claude/a',
  head_sha: SHA,
  created_at: AT,
  updated_at: after(AT, 120),
  head_commit: { tree_id: 't1' },
  jobs: [job()],
  ...more,
});
const pull = (more: Partial<PullRequest> = {}): PullRequest => ({
  number: 1,
  head_ref: 'claude/a',
  head_sha: SHA,
  created_at: '2026-11-16T09:00:00Z',
  closed_at: null,
  merged_at: null,
  merge_commit_sha: null,
  files: ['web/a.ts'],
  ...more,
});
const MERGED = { closed_at: AT, merged_at: AT };

test('each job is rounded up to a whole minute, and a job with no runner costs nothing', () => {
  assert.equal(billedMinutes(job({ completed_at: after(AT, 6) })), 1);
  assert.equal(billedMinutes(job({ completed_at: after(AT, 66) })), 2);
  assert.equal(billedMinutes(job({ completed_at: after(AT, 5) })), 1);
  assert.equal(billedMinutes(job({ runner_name: null })), 0);
  assert.equal(billedMinutes(job({ started_at: null })), 0);
});

test('a label with no known price is unreadable, never a low guess', () => {
  assert.deepEqual(runnerOf(['ubuntu-latest']), { sku: 'linux' });
  assert.deepEqual(runnerOf(['ubuntu-slim']), { sku: 'linux_slim' });
  assert.deepEqual(runnerOf(['ubuntu-24.04-arm']), { sku: 'linux_arm' });
  assert.deepEqual(runnerOf(['windows-11-arm']), { sku: 'windows' });
  assert.deepEqual(runnerOf(['macos-26']), { sku: 'macos' });
  assert.deepEqual(runnerOf(['xcode-27']), { sku: 'macos' });
  assert.deepEqual(runnerOf(['blacksmith-4vcpu-ubuntu-2404']), { blacksmith: 2 });
  for (const labels of [['macos-26-xlarge'], ['self-hosted'], ['linux-4-core'], []]) {
    assert.throws(() => runnerOf(labels), Unreadable);
  }
});

test('spend prices each job by its runner, and Blacksmith costs nothing on this allowance', () => {
  const runs = [
    run({
      jobs: [
        job({ labels: ['ubuntu-latest'] }),
        job({ labels: ['xcode-27'], completed_at: after(AT, 125) }),
        job({ labels: ['blacksmith-2vcpu-ubuntu-2404'] }),
        job({ labels: ['xcode-27'], runner_name: null, conclusion: 'skipped' }),
      ],
    }),
  ];
  assert.ok(Math.abs(spendUsd(runs, 0) - (0.006 + 2 * 0.062)) < 1e-9);
  assert.deepEqual(blacksmithMinutes(runs, runs, NOW), { value: 1, samples: 3 });
});

test('the forecast adds the last week\'s pace to what the month has spent', () => {
  // One 16-minute Mac job on each of the month's first 16 days.
  const daily = Array.from({ length: 16 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 10, i + 1, 6)).toISOString();
    return run({ created_at: day, jobs: [job({ labels: ['macos-26'], created_at: day, started_at: day, completed_at: after(day, 60 * 16) })] });
  });
  const spentPerDay = 16 * 0.062;
  const reading = allowanceForecast(daily, daily, NOW);
  assert.ok(reading);
  const remaining = (Date.UTC(2026, 11, 1) - NOW.getTime()) / 86_400_000;
  assert.ok(Math.abs(reading.value - (16 * spentPerDay + spentPerDay * remaining)) < 1e-9);
  assert.equal(reading.samples, 7);
});

test('the forecast reads last month\'s pace on the first of the month, and nothing with no jobs', () => {
  const lastWeek = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 10, 24 + i, 6)).toISOString();
    return run({ created_at: day, jobs: [job({ created_at: day, started_at: day, completed_at: after(day, 60) })] });
  });
  const reading = allowanceForecast(lastWeek, lastWeek, new Date('2026-12-01T01:00:00Z'));
  assert.ok(reading);
  assert.ok(reading.value > 0);
  assert.equal(allowanceForecast([], [], NOW), null);
  assert.equal(allowanceForecast([run({ jobs: [job({ runner_name: null })] })], [], NOW), null);
});

test('a young repository divides by its age, at least a day', () => {
  const hour = new Date(NOW.getTime() - 3_600_000).toISOString();
  const runs = [run({ created_at: hour, jobs: [job({ created_at: hour, started_at: hour, completed_at: after(hour, 60) })] })];
  const reading = allowanceForecast(runs, runs, NOW);
  const remaining = (Date.UTC(2026, 11, 1) - NOW.getTime()) / 86_400_000;
  assert.ok(reading);
  assert.ok(Math.abs(reading.value - (0.006 + 0.006 * remaining)) < 1e-9);
});

test('the site\'s jobs count in the dollars but can\'t lift a quiet week over the sample minimum', () => {
  const site = [run({ path: '.github/workflows/quality-speed.yml', jobs: [job(), job(), job()] })];
  const forecast = allowanceForecast(site, [], NOW);
  assert.ok(forecast);
  assert.ok(forecast.value > 0);
  assert.equal(forecast.samples, 0);
  assert.deepEqual(blacksmithMinutes([run({ jobs: [job({ labels: ['blacksmith-2vcpu-ubuntu-2404'] })] })], [], NOW), { value: 1, samples: 0 });
  // With Blacksmith turned off, product jobs on other runners still prove the zero was read.
  assert.deepEqual(blacksmithMinutes([run()], [run()], NOW), { value: 0, samples: 1 });
});

test('a CI run still going counts at the guard\'s worst case, so the gate can\'t under-read', () => {
  const going = run({ status: 'in_progress', conclusion: null, jobs: [] });
  assert.equal(blacksmithMinutes([going], [], NOW).value, 25);
  assert.equal(blacksmithMinutes([{ ...going, run_attempt: 2 }], [], NOW).value, 50);
  assert.equal(blacksmithMinutes([{ ...going, path: DCO }], [], NOW).value, 0);
  assert.equal(blacksmithMinutes([{ ...going, created_at: '2026-10-01T00:00:00Z' }], [], NOW).value, 0);
});

test('only this site\'s folder and workflow count as its own', () => {
  assert.ok(isSiteFile('quality-speed/pages/actions/PLAN.md'));
  assert.ok(isSiteFile('.github/workflows/quality-speed.yml'));
  assert.equal(isSiteFile('web/src/quality-speed.ts'), false);
  assert.equal(isSiteFile('.github/workflows/ci.yml'), false);
});

test('a pull request is the site\'s only if every file is, so one file can\'t hide a product change', () => {
  assert.ok(isSitePull(pull({ files: ['quality-speed/a.ts', '.github/workflows/quality-speed.yml'] })));
  assert.equal(isSitePull(pull({ files: ['quality-speed/a.ts', '.github/workflows/ci.yml'] })), false);
  assert.equal(isSitePull(pull({ files: [] })), false);
});

test('a site pull request\'s runs are found on its branch and after the merge', () => {
  const filter = siteRunFilter([
    pull({ head_ref: 'claude/site', files: ['quality-speed/a.ts'], ...MERGED, closed_at: '2026-11-16T11:00:00Z', merge_commit_sha: 'b'.repeat(40) }),
    pull({ number: 2, head_ref: 'claude/product' }),
    pull({ number: 3, head_ref: 'claude/mixed', files: ['quality-speed/a.ts', 'web/a.ts'] }),
  ]);
  assert.ok(filter(run({ path: '.github/workflows/quality-speed.yml', head_branch: 'main' })));
  assert.ok(filter(run({ head_branch: 'claude/site' })));
  assert.ok(filter(run({ head_branch: 'main', event: 'push', head_sha: 'b'.repeat(40) })));
  assert.equal(filter(run({ head_branch: 'claude/product' })), false);
  assert.equal(filter(run({ head_branch: 'claude/mixed' })), false);
  assert.equal(filter(run({ head_branch: 'main', event: 'push' })), false);
  // A later pull request that reuses a site branch's name is not the site's.
  assert.equal(filter(run({ head_branch: 'claude/site', created_at: '2026-11-20T00:00:00Z' })), false);
});

const main = (more: Partial<Run>) => run({ event: 'push', head_branch: 'main', ...more });

const noSite = () => false;

test('main\'s verdict counts a real cancel against it', () => {
  const reading = mainGreen([main({}), main({ conclusion: 'failure' }), main({ conclusion: 'cancelled' }), main({ created_at: '2026-10-01T00:00:00Z', conclusion: 'failure' }), run({ conclusion: 'failure' })], noSite, NOW);
  assert.ok(reading);
  assert.equal(reading.samples, 3);
  assert.ok(Math.abs(reading.value - 100 / 3) < 1e-9);
  assert.equal(mainGreen([], noSite, NOW), null);
});

test('only a run a newer one really replaced has no verdict', () => {
  const replaced = main({ conclusion: 'cancelled', jobs: [], created_at: AT, updated_at: after(AT, 30) });
  const newer = main({ created_at: after(AT, 29) });
  assert.deepEqual(mainGreen([replaced, newer], noSite, NOW), { value: 100, samples: 1 });
  // Cancelled by hand, with nothing newer by then: it counts against main, and the run after it can't excuse it.
  assert.deepEqual(mainGreen([replaced, main({ created_at: after(AT, 3600) })], noSite, NOW), { value: 50, samples: 2 });
  assert.deepEqual(mainGreen([replaced], noSite, NOW), { value: 0, samples: 1 });
});

test('this site\'s green runs leave main\'s count, its reds stay, and a site merge can still replace a product run', () => {
  const site = 'b'.repeat(40);
  const isSite = (r: Run) => r.head_sha === site;
  assert.equal(mainGreen([main({ head_sha: site })], isSite, NOW), null);
  assert.deepEqual(mainGreen([main({ head_sha: site, conclusion: 'failure' })], isSite, NOW), { value: 0, samples: 1 });
  assert.deepEqual(mainGreen([main({ head_sha: site, conclusion: 'cancelled' })], isSite, NOW), { value: 0, samples: 1 });
  const replaced = main({ conclusion: 'cancelled', jobs: [], updated_at: after(AT, 30) });
  assert.deepEqual(mainGreen([main({}), replaced, main({ head_sha: site, created_at: after(AT, 29) })], isSite, NOW), { value: 100, samples: 1 });
});

test('a rerun can\'t erase a red on main', () => {
  assert.deepEqual(mainGreen([main({ run_attempt: 2 })], noSite, NOW), { value: 0, samples: 1 });
});

test('a main run still open at two hours counts against main, and one that just started doesn\'t', () => {
  const open = { status: 'in_progress', conclusion: null, jobs: [] };
  assert.deepEqual(mainGreen([main({ ...open, created_at: '2026-11-16T09:00:00Z' })], noSite, NOW), { value: 0, samples: 1 });
  assert.equal(mainGreen([main({ ...open, created_at: '2026-11-16T11:30:00Z' })], noSite, NOW), null);
});

test('a merge has to have run what its files called for', () => {
  const steps = (...names: string[]) => names.map((name) => ({ name, conclusion: 'success' }));
  const ok = job({ name: 'ci-ok' });
  const ciRun = (sha: string, jobs: Job[]) => run({ head_sha: sha, jobs: [...jobs, ok] });
  const merged = (sha: string, files: string[]) => pull({ ...MERGED, head_sha: sha, files });
  const checks = (...names: string[]) => job({ steps: steps(...names) });
  const passes = (runs: Run[], files: string[]) => gatesRan(runs, [merged('s', files)], NOW)?.value;

  const web = ['Web check', 'Web test', 'Web build', 'Worker dry runs'];
  assert.equal(passes([ciRun('s', [checks('Secret scan', ...web)])], ['web/a.ts']), 100);
  assert.equal(passes([ciRun('s', [checks('Secret scan')])], ['web/a.ts']), 0, 'web changed and its tests were skipped');
  assert.equal(passes([ciRun('s', [checks('Secret scan', 'Web test', 'Web build', 'Worker dry runs')])], ['web/a.ts']), 0, 'web changed and its type check was skipped');
  assert.equal(passes([ciRun('s', [checks(...web)])], ['web/a.ts']), 0, 'no secret scan');
  assert.equal(passes([ciRun('s', [checks('Secret scan')])], ['docs/a.md']), 100, 'docs need only the scan');
  assert.equal(passes([ciRun('s', [checks('Secret scan')])], ['Sources/A/a.swift']), 0, 'Swift changed and no Swift job ran');
  assert.equal(passes([ciRun('s', [checks('Secret scan'), job({ name: 'swift' })])], ['Sources/A/a.swift']), 0, 'no swift-ocr');
  assert.equal(passes([ciRun('s', [checks('Secret scan'), job({ name: 'swift' }), job({ name: 'swift-ocr' })])], ['Sources/A/a.swift']), 100);
  assert.equal(passes([ciRun('s', [checks('Secret scan')])], ['.github/workflows/ci.yml']), 0, 'a workflow changed and no lint ran');
  assert.equal(passes([ciRun('s', [checks('Secret scan', 'Lint workflows')])], ['.github/workflows/ci.yml']), 100);
  assert.equal(passes([run({ head_sha: 's', jobs: [checks('Secret scan')] })], ['docs/a.md']), 0, 'no ci-ok');
  assert.equal(passes([], ['docs/a.md']), 0, 'no CI run on its head');
  assert.equal(gatesRan([], [pull(), pull({ ...MERGED, files: ['quality-speed/a.ts'] })], NOW), null, 'nothing merged but the site');
});

test('a flake is a job that both passed and failed on the same files', () => {
  const tested = (conclusion: string) => job({ conclusion, steps: [{ name: 'Web test', conclusion }] });
  const twice = (tree: string, first: Job, second: Job) => [run({ head_commit: { tree_id: tree }, jobs: [first] }), run({ head_commit: { tree_id: tree }, jobs: [second] })];
  const reading = flakyShare(
    [
      ...twice('t1', tested('success'), tested('success')),
      ...twice('t2', tested('failure'), tested('success')),
      ...twice('t3', tested('failure'), tested('failure')),
      ...twice('t4', tested('cancelled'), tested('success')),
      ...twice('t5', job({ name: 'ci-ok', conclusion: 'failure', steps: RAN_TESTS }), job({ name: 'ci-ok', steps: RAN_TESTS })),
      // A job that went red before its tests still counts: failing at an install is a likely flake.
      ...twice('t6', job({ conclusion: 'failure', steps: [{ name: 'Web install', conclusion: 'failure' }] }), tested('success')),
      // This site's own tests don't count as tests here.
      ...twice('t7', job({ steps: [{ name: 'Quality and Speed tests', conclusion: 'success' }] }), job({ steps: [{ name: 'Quality and Speed tests', conclusion: 'success' }] })),
      run({ head_commit: { tree_id: 't8' }, jobs: [tested('failure')] }),
      run({ path: DCO, head_commit: { tree_id: 't9' }, jobs: [job({ name: 'dco', conclusion: 'failure', steps: RAN_TESTS }), job({ name: 'dco', steps: RAN_TESTS })] }),
    ],
    NOW,
  );
  assert.deepEqual(reading, { value: 50, samples: 4 });
});

test('a pass with no tests can\'t pad the count', () => {
  const noTests = job({ steps: [{ name: 'Secret scan', conclusion: 'success' }] });
  assert.equal(flakyShare([run({ jobs: [noTests, noTests] })], NOW), null);
});

test('two jobs on one tree are one comparison, and a rerun inside one run counts', () => {
  const tested = (name: string, conclusion = 'success') => job({ name, conclusion, steps: [{ name: 'Test', conclusion }] });
  assert.deepEqual(flakyShare([run({ jobs: [tested('checks'), tested('checks'), tested('swift'), tested('swift')] })], NOW), { value: 0, samples: 1 });
  assert.deepEqual(flakyShare([run({ jobs: [tested('checks', 'failure'), { ...tested('checks'), run_attempt: 2 }] })], NOW), { value: 100, samples: 1 });
});

test('nothing compared is no reading, not a clean one', () => {
  assert.equal(flakyShare([run({ jobs: [job({ steps: RAN_TESTS })] })], NOW), null);
});

test('a gap in one workflow\'s run numbers is a deleted run, and workflows number apart', () => {
  const numbered = (path: string, ...numbers: number[]) => numbers.map((run_number) => run({ path, run_number }));
  assert.deepEqual(deletedRuns([...numbered(CI, 7, 8, 9), ...numbered(DCO, 3, 4)]), { value: 0, samples: 5 });
  assert.deepEqual(deletedRuns([...numbered(CI, 7, 9, 12), ...numbered(DCO, 3, 5)]), { value: 4, samples: 5 });
  assert.equal(deletedRuns([]), null);
});

test('dollars per merge leaves out the site\'s merges, and no merges is no reading', () => {
  const runs = [run({ jobs: [job({ labels: ['macos-26'] })] })];
  assert.deepEqual(usdPerMerge(runs, [pull(MERGED), pull({ ...MERGED, number: 2 }), pull({ ...MERGED, number: 3, files: ['quality-speed/a.ts'] })], NOW), { value: 0.031, samples: 2 });
  assert.equal(usdPerMerge(runs, [pull({ ...MERGED, files: ['quality-speed/a.ts'] })], NOW), null);
});

const ciOk = (more: Partial<Job> = {}) => [job({ steps: RAN_TESTS }), job({ name: 'ci-ok', completed_at: after(AT, 60), ...more })];

test('time to green runs from the push to the last required check of that push', () => {
  const mins = minutesToGreen(
    [
      run({ jobs: [job({ steps: RAN_TESTS }), job({ name: 'ci-ok', completed_at: after(AT, 120) })] }),
      run({ path: DCO, jobs: [job({ name: 'dco', completed_at: after(AT, 300) })] }),
    ],
    NOW,
  );
  assert.deepEqual(mins, [5]);
});

test('the required checks are ci-ok and dco: retired claude-review is never waited on', () => {
  const retired = run({ path: REVIEW, jobs: [job({ name: 'claude-review', completed_at: after(AT, 600) })] });
  assert.deepEqual(minutesToGreen([run({ jobs: ciOk() }), retired], NOW), [1]);
  assert.deepEqual(minutesToGreen([run({ jobs: ciOk() }), { ...retired, jobs: [job({ name: 'claude-review', conclusion: 'failure' })] }], NOW), [1]);
});

test('a skipped dco really is skipped, the way GitHub records it, with no jobs to read', () => {
  assert.deepEqual(minutesToGreen([run({ jobs: ciOk() }), run({ path: DCO, conclusion: 'skipped', jobs: [] })], NOW), [1]);
});

test('a later ready_for_review isn\'t this push\'s wait', () => {
  const later = after(AT, 7200);
  assert.deepEqual(minutesToGreen([run({ jobs: ciOk() }), run({ path: DCO, created_at: later, jobs: [job({ name: 'dco', completed_at: after(later, 60) })] })], NOW), [1]);
});

test('a failed check, a second attempt or a push with no tests has no time to green', () => {
  assert.deepEqual(minutesToGreen([run({ jobs: ciOk({ conclusion: 'failure' }) })], NOW), []);
  assert.deepEqual(minutesToGreen([run({ jobs: ciOk() }), run({ path: DCO, jobs: [job({ name: 'dco', conclusion: 'failure' })] })], NOW), []);
  assert.deepEqual(minutesToGreen([run({ jobs: ciOk({ run_attempt: 2 }) })], NOW), []);
  assert.deepEqual(minutesToGreen([run({ jobs: [job({ name: 'ci-ok' })] })], NOW), []);
});

test('queue time shows by runner, so a Mac wait can\'t hide in a shared number', () => {
  const late = job({ labels: ['macos-26'], started_at: after(AT, 3600), completed_at: after(AT, 3660) });
  assert.deepEqual(queueDetail([run({ jobs: [job(), job({ runner_name: null }), late] })], NOW), {
    queue_linux: { value: 5, limit: null, n: 1 },
    queue_macos: { value: 3600, limit: null, n: 1 },
  });
});

test('the slowest job is the worst p95 among jobs a pull request waits on, and a rare job still counts', () => {
  const mins = (name: string, minutes: number) => job({ name, completed_at: after(after(AT, 5), minutes * 60) });
  const runs = [
    run({ jobs: [mins('checks', 1), mins('checks', 2), mins('checks', 3), mins('swift', 4), mins('swift', 5), mins('swift', 6), mins('office', 99)] }),
    run({ event: 'push', jobs: [mins('checks', 500)] }),
  ];
  assert.deepEqual(slowestJobMinutes(runs, NOW), { value: 6, samples: 7 });
  assert.equal(slowestJobMinutes([run()], NOW), null);
});

test('percentiles are real samples', () => {
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  assert.equal(percentile([1, 2, 3, 4], 95), 4);
  assert.equal(percentile([], 50), null);
});

test('the spend detail adds up by job and day, in ids the detail file accepts', () => {
  const known = new Set(['ci_swift-ocr', 'dco_dco']);
  const detail = spendDetail(
    [
      run({ jobs: [job({ name: 'Swift OCR', labels: ['macos-26'] }), job({ name: 'swift-ocr', labels: ['macos-26'] })] }),
      run({ path: DCO, jobs: [job({ name: 'dco' }), job({ name: 'dco', labels: ['blacksmith-2vcpu-ubuntu-2404'] })] }),
      run({ created_at: '2026-10-31T00:00:00Z', jobs: [job({ started_at: '2026-10-31T00:00:00Z', completed_at: '2026-10-31T00:01:00Z' })] }),
    ],
    NOW,
    known,
    500,
  );
  assert.ok(Math.abs((detail['job_swift-ocr_macos']?.value ?? 0) - 0.124) < 1e-9);
  assert.equal(detail['job_swift-ocr_macos']?.n, 2);
  assert.equal(detail['min_swift-ocr_macos']?.value, 2);
  assert.equal(detail.job_dco_blacksmith?.value, 0);
  assert.ok(Math.abs((detail['day_2026-11-16']?.value ?? 0) - 0.13) < 1e-9);
  assert.ok(Math.abs((detail.month_usd?.value ?? 0) - 0.13) < 1e-9);
  assert.equal(detail.month_usd?.limit, 500);
  assert.equal(detail.month_usd?.n, 4);
  assert.ok(isDetail({ checks: {}, readings: detail }), 'one bad id would lose the whole file');
});

test('a matrix job counts under its job, whatever its values are', () => {
  const detail = spendDetail([run({ path: DCO, jobs: [job({ name: 'lab (forming)' }), job({ name: 'lab (dispute)' })] })], NOW, new Set(['dco_lab']));
  assert.equal(detail.job_lab_linux?.n, 2);
  assert.equal(detail.month_usd?.limit, null, 'with no allowance passed in, no ceiling');
});

test('a known job with too long a name reads as other, so it can\'t lose the whole detail file', () => {
  const long = 'a-job-with-a-name-too-long-to-fit-in-an-id';
  const detail = spendDetail([run({ path: DCO, jobs: [job({ name: long })] })], NOW, new Set([`dco_${long}`]));
  assert.ok(detail.job_other_linux);
  assert.ok(isDetail({ checks: {}, readings: detail }));
});

test('every job and runner in this repository fits the detail file, and so does the drill', () => {
  const all = (['ubuntu-slim', 'ubuntu-latest', 'macos-26', 'windows-latest', 'blacksmith-2vcpu-ubuntu-2404'] as const).flatMap((label) =>
    readWorkflows(ROOT).flatMap((file) => [...jobBlocks(file.text).keys()].map((name) => run({ path: `.github/workflows/${file.name}`, jobs: [job({ name, labels: [label] })] }))),
  );
  const readings = { ...spendDetail(all, NOW, knownJobs(readWorkflows(ROOT))), ...queueDetail(all, NOW) };
  assert.ok(Object.keys(readings).length > 20);
  assert.ok(!('job_other_macos' in readings), 'a real job was too long to keep its name');
  const checks = Object.fromEntries(localPlants(ROOT).map((plant) => [plant.name, plant.caught ? (1 as const) : (0 as const)]));
  assert.ok(isDetail({ checks, readings }));
});

test('a job name not in the checkout never reaches the detail file', () => {
  const detail = spendDetail([run({ path: '.github/workflows/branch-only.yml', jobs: [job({ name: 'Some text from a branch' })] })], NOW, new Set());
  assert.deepEqual(Object.keys(detail).filter((id) => /^(job|min)_/.test(id)).sort(), ['job_other_linux', 'min_other_linux']);
  assert.doesNotMatch(JSON.stringify(Object.keys(detail)), /branch|text/);
});

test('a detail id keeps only what the file allows', () => {
  assert.equal(detailId('Swift OCR (macOS)'), 'swift-ocr-macos');
  assert.equal(detailId('---x---'), 'x');
});

test('every record the collector can write passes the site\'s validator', () => {
  const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')) as Manifest;
  const RUN_URL = 'https://github.com/Colorado-Startups/legallas/actions/runs/42';
  const measured = `${new Date().toISOString().slice(0, 19)}Z`;
  const good = manifest.metrics.map((m) => toRecord(m.id, { value: m.goal, samples: m.min_samples }, 'live', measured, RUN_URL));
  // The validator only keeps a signed-off list's readings.
  const signedOff = { ...manifest, signoff_comment: 1 };
  const checked = validateRecords(good, signedOff);
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.records.length, manifest.metrics.length);
  const bad = manifest.metrics.map((m) => toRecord(m.id, null, 'live', measured, RUN_URL));
  assert.deepEqual(validateRecords(bad, signedOff).errors, []);
  assert.equal(toRecord('a', { value: 1, samples: 1 }, 'live', measured, null).status, 'missing');
});

test('minutes per merge counts every runner alike and leaves out the site\'s merges; no merges is no reading', () => {
  const runs = [run({ jobs: [job({ labels: ['macos-26'] }), job({ labels: ['blacksmith-2vcpu-ubuntu-2404'] })] })];
  const one = billedMinutes(job({ labels: ['macos-26'] }));
  assert.deepEqual(minutesPerMerge(runs, [pull(MERGED), pull({ ...MERGED, number: 2 }), pull({ ...MERGED, number: 3, files: ['quality-speed/a.ts'] })], NOW), { value: one, samples: 2 });
  assert.equal(minutesPerMerge(runs, [pull({ ...MERGED, files: ['quality-speed/a.ts'] })], NOW), null);
});
