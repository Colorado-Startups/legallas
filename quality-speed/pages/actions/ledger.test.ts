// SPDX-License-Identifier: Apache-2.0
// The runs ledger (#240), on invented run and job records. GitHub is a fake fetch, so nothing here reads the network.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { Github } from './github.ts';
import { cachedJobs, emptyLedger, encodeLedger, LEDGER_FILE, LEDGER_VERSION, loadLedger, MAX_LEDGER_BYTES, saveLedger, type Ledger } from './ledger.ts';
import {
  allowanceForecast,
  billedMinutes,
  blacksmithMinutes,
  deletedRuns,
  flakyShare,
  gatesRan,
  mainGreen,
  minutesPerMerge,
  minutesToGreen,
  queueDetail,
  runnerOf,
  siteRunFilter,
  slowestJobMinutes,
  spendDetail,
  spendUsd,
  Unreadable,
  usdPerMerge,
  type Job,
  type PullRequest,
  type Run,
} from './measure.ts';

const NOW = new Date('2026-11-16T12:00:00Z');
const AT = '2026-11-16T10:00:00Z';
const after = (time: string, seconds: number) => new Date(Date.parse(time) + seconds * 1000).toISOString();
const CI = '.github/workflows/ci.yml';
const SHA = 'a'.repeat(40);
const OK = 'success';

// The job() and run() helpers from measure.test.ts.
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

const tempDir = (t: TestContext): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'actions-ledger-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** Runs again with the jobs the ledger kept, through the gzipped file and back. */
function roundTrip(t: TestContext, runs: Run[]): Run[] {
  const dir = tempDir(t);
  saveLedger(dir, encodeLedger(runs));
  const ledger = loadLedger(dir);
  return runs.map((r) => {
    const jobs = cachedJobs(ledger, r);
    assert.ok(jobs, `run ${r.id} came back`);
    return { ...r, jobs };
  });
}

/** A fake GitHub serving one listing and its jobs. Returns the run ids whose jobs were read. */
function fakeGithub(t: TestContext, listing: Run[], failing: readonly number[] = []): number[] {
  const jobReads: number[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(String(input));
    const jobsOf = /\/actions\/runs\/(\d+)\/jobs$/.exec(url.pathname);
    if (!jobsOf) return Response.json({ total_count: listing.length, workflow_runs: listing.map(({ jobs: _, ...fields }) => fields) });
    const id = Number(jobsOf[1]);
    jobReads.push(id);
    if (failing.includes(id)) return new Response('', { status: 404 });
    const jobs = listing.find((r) => r.id === id)?.jobs ?? [];
    return Response.json({ total_count: jobs.length, jobs });
  });
  return jobReads;
}

const pass = (ledger: Ledger, reads = 0) => {
  const github = new Github('token', 'owner/repo');
  github.reads = reads;
  return github.runsSince(new Date('2026-10-16T00:00:00Z'), NOW, ledger);
};

test('every measure reads the same on kept jobs as on the originals', (t) => {
  const gates = ['Secret scan', 'Web check', 'Web test', 'Web build', 'Worker dry runs', 'Lint workflows'].map((name) => ({ name, conclusion: OK }));
  const runs: Run[] = [
    // A pull request's push: every gate, the Swift jobs on macOS, a job skipped with no runner, one on Blacksmith.
    run({
      id: 10,
      run_number: 10,
      jobs: [
        job({ steps: [...gates, { name: 'Quality and speed tests', conclusion: OK }, { name: 'Set up job', conclusion: OK }] }),
        job({ name: 'ci-ok', labels: ['ubuntu-slim'], started_at: after(AT, 300), completed_at: after(AT, 304) }),
        job({ name: 'swift', labels: ['macos-15'], started_at: after(AT, 40), completed_at: after(AT, 280), steps: [{ name: 'Swift tests', conclusion: OK }] }),
        job({ name: 'swift-ocr', labels: ['macos-latest'], started_at: after(AT, 42), completed_at: after(AT, 200) }),
        job({ name: 'office-mac', conclusion: 'skipped', runner_name: '', started_at: null, completed_at: null, labels: ['macos-latest'] }),
        job({ name: 'changes', labels: ['blacksmith-2vcpu-ubuntu-2404'], created_at: null, started_at: '2026-11-16T10:00:01.250Z', completed_at: after(AT, 20) }),
      ],
    }),
    run({ id: 11, run_number: 4, path: '.github/workflows/dco.yml', jobs: [job({ name: 'dco', labels: ['ubuntu-slim'], completed_at: after(AT, 30) })] }),
    run({ id: 12, run_number: 5, path: '.github/workflows/claude-review.yml', jobs: [job({ name: 'claude-review', completed_at: after(AT, 400) })] }),
    // The same tree on main: a failed first attempt that ran its tests, then a pass, so the tree is flaky.
    run({
      id: 20,
      run_number: 11,
      event: 'push',
      head_branch: 'main',
      head_sha: 'b'.repeat(40),
      conclusion: 'success',
      run_attempt: 2,
      created_at: after(AT, 600),
      updated_at: after(AT, 2000),
      jobs: [
        job({ created_at: after(AT, 601), started_at: after(AT, 610), completed_at: after(AT, 700), conclusion: 'failure', steps: [{ name: 'Unit tests', conclusion: 'failure' }] }),
        job({ run_attempt: 2, created_at: after(AT, 1500), started_at: after(AT, 1510), completed_at: after(AT, 1900), steps: [{ name: 'Web test', conclusion: OK }] }),
      ],
    }),
    // A main run replaced before it started, and a stalled one.
    run({ id: 21, run_number: 12, event: 'push', head_branch: 'main', conclusion: 'cancelled', created_at: after(AT, 500), updated_at: after(AT, 650), jobs: [] }),
    run({ id: 22, run_number: 14, event: 'push', head_branch: 'main', status: 'in_progress', conclusion: null, created_at: '2026-11-16T08:00:00Z', jobs: [] }),
    // Other runners, a site run, and one from last month on Blacksmith.
    run({
      id: 30,
      run_number: 3,
      path: '.github/workflows/fixture-room.yml',
      event: 'workflow_dispatch',
      head_branch: 'main',
      jobs: [job({ name: 'room', labels: ['ubuntu-24.04-arm'] }), job({ name: 'win', labels: ['windows-latest'], completed_at: after(AT, 905) })],
    }),
    run({ id: 31, run_number: 9, path: '.github/workflows/quality-speed.yml', event: 'schedule', head_branch: 'main', jobs: [job({ name: 'lane', completed_at: after(AT, 1200) })] }),
    run({
      id: 32,
      run_number: 2,
      head_branch: 'claude/b',
      head_sha: 'c'.repeat(40),
      created_at: '2026-10-20T10:00:00Z',
      updated_at: '2026-10-20T10:30:00Z',
      head_commit: { tree_id: 't9' },
      jobs: [job({ labels: ['blacksmith-4vcpu-ubuntu-2404'], created_at: '2026-10-20T10:00:00Z', started_at: '2026-10-20T10:01:00Z', completed_at: '2026-10-20T10:21:00Z' })],
    }),
  ];
  const pulls: PullRequest[] = [
    { number: 1, head_ref: 'claude/a', head_sha: SHA, created_at: '2026-11-16T09:00:00Z', closed_at: after(AT, 700), merged_at: after(AT, 700), merge_commit_sha: 'b'.repeat(40), files: ['web/a.ts', 'Package.swift', '.github/workflows/ci.yml'] },
    { number: 2, head_ref: 'claude/site', head_sha: 'd'.repeat(40), created_at: AT, closed_at: AT, merged_at: AT, merge_commit_sha: 'e'.repeat(40), files: ['quality-speed/a.ts'] },
  ];
  const kept = roundTrip(t, runs);
  const isSite = siteRunFilter(pulls);
  const known = new Set(['ci_checks', 'ci_ci-ok', 'ci_swift', 'dco_dco']);
  const measures = (all: Run[]) => {
    const product = all.filter((r) => !isSite(r));
    return {
      forecast: allowanceForecast(all, product, NOW),
      blacksmith: blacksmithMinutes(all, product, NOW),
      deleted: deletedRuns(all),
      main: mainGreen(all, isSite, NOW),
      gates: gatesRan(product, pulls, NOW),
      flaky: flakyShare(product, NOW),
      usd: usdPerMerge(product, pulls, NOW),
      minutes: minutesPerMerge(product, pulls, NOW),
      green: minutesToGreen(product, NOW),
      slowest: slowestJobMinutes(product, NOW, 1),
      spend: spendDetail(all, NOW, known),
      queue: queueDetail(product, NOW),
      billed: all.map((r) => r.jobs.map(billedMinutes)),
      runners: all.map((r) => r.jobs.filter((j) => j.runner_name).map((j) => runnerOf(j.labels ?? []))),
    };
  };
  const before = measures(runs);
  // Each rule is exercised, so a match can't come from two nulls or two empty lists.
  for (const key of ['forecast', 'blacksmith', 'deleted', 'main', 'gates', 'flaky', 'usd', 'minutes', 'slowest'] as const) assert.ok(before[key], key);
  assert.equal(before.gates?.value, 100);
  assert.equal(before.flaky?.value, 100);
  assert.equal(before.green.length, 1);
  assert.ok(Object.keys(before.queue).length >= 2);
  assert.deepEqual(measures(kept), before);
  // Every field a measure reads comes back, the times exact to the millisecond.
  kept.forEach((r, i) =>
    r.jobs.forEach((j, k) => {
      const original = runs[i]?.jobs[k] as Job;
      const time = (value: string | null | undefined) => (value ? Date.parse(value) : value);
      for (const field of ['created_at', 'started_at', 'completed_at'] as const) assert.equal(time(j[field]), time(original[field]));
      assert.deepEqual([j.name, j.run_attempt, j.conclusion, !!j.runner_name, j.labels], [original.name, original.run_attempt, original.conclusion, !!original.runner_name, original.labels]);
    }),
  );
});

test('a run is read only when it is new, rerun or updated', async (t) => {
  const listing = [run({ id: 1 }), run({ id: 2, run_number: 2 })];
  const reads = fakeGithub(t, listing);
  const cold = await pass(emptyLedger());
  assert.deepEqual([cold.complete, cold.cached, cold.read, reads.sort()], [true, 0, 2, [1, 2]]);
  assert.deepEqual(Object.keys(cold.ledger.runs), ['1', '2']);

  reads.length = 0;
  const warm = await pass(cold.ledger);
  assert.deepEqual([warm.complete, warm.cached, warm.read, reads], [true, 2, 0, []]);
  assert.deepEqual(warm.runs.map((r) => r.jobs.length), [1, 1]);

  (listing[1] as Run).updated_at = after(AT, 900);
  const updated = await pass(warm.ledger);
  assert.deepEqual([updated.cached, updated.read, reads], [1, 1, [2]]);

  reads.length = 0;
  Object.assign(listing[0] as Run, { run_attempt: 2, updated_at: after(AT, 1000) });
  const rerun = await pass(updated.ledger);
  assert.deepEqual([rerun.cached, rerun.read, reads], [1, 1, [1]]);
  assert.deepEqual(rerun.ledger.runs['1']?.slice(0, 2), [after(AT, 1000), 2]);
});

test('a run still going or skipped is never read or kept', async (t) => {
  const listing = [run({ id: 1 }), run({ id: 2, status: 'in_progress', conclusion: null }), run({ id: 3, status: 'queued', conclusion: null }), run({ id: 4, conclusion: 'skipped' })];
  const reads = fakeGithub(t, listing);
  const read = await pass(emptyLedger());
  assert.deepEqual(reads, [1]);
  assert.deepEqual(Object.keys(read.ledger.runs), ['1']);
  // They're still listed, with no jobs, as before the ledger.
  assert.deepEqual(read.runs.map((r) => [r.id, r.jobs.length]), [[1, 1], [2, 0], [3, 0], [4, 0]]);
  assert.equal(read.complete, true);
});

test('runs no longer listed drop out of the ledger', async (t) => {
  const old = encodeLedger([run({ id: 99 }), run({ id: 1 })]);
  const reads = fakeGithub(t, [run({ id: 1 })]);
  const read = await pass(old);
  assert.deepEqual(reads, []);
  assert.deepEqual(Object.keys(read.ledger.runs), ['1']);
});

test('a pass that leaves a run unread is incomplete but keeps what it read', async (t) => {
  const failing = [2];
  const reads = fakeGithub(t, [run({ id: 1 }), run({ id: 2 }), run({ id: 3 })], failing);
  const failed = await pass(emptyLedger());
  assert.equal(failed.complete, false);
  assert.deepEqual(Object.keys(failed.ledger.runs), ['1', '3']);

  // Past the read budget, what's left waits for the next pass.
  reads.length = 0;
  failing.length = 0;
  const budget = await pass(failed.ledger, 10_000);
  assert.deepEqual([budget.complete, budget.cached, reads, Object.keys(budget.ledger.runs)], [false, 2, [], ['1', '3']]);

  const next = await pass(budget.ledger);
  assert.deepEqual([next.complete, next.cached, reads], [true, 2, [2]]);
  assert.deepEqual(Object.keys(next.ledger.runs), ['1', '2', '3']);
});

test('a bad ledger, or one of another version, loads as a cold start', (t) => {
  const good = encodeLedger([run({ id: 1 }), run({ id: 2 })]);
  const cases: [string, Buffer | string][] = [
    ['not gzip', JSON.stringify(good)],
    ['not JSON', gzipSync('{"version":')],
    ['another version', gzipSync(JSON.stringify({ ...good, version: LEDGER_VERSION + 1 }))],
    ['other gate steps', gzipSync(JSON.stringify({ ...good, gates: ['Secret scan'] }))],
    ['an extra field', gzipSync(JSON.stringify({ ...good, note: 1 }))],
    ['one index past its table', gzipSync(JSON.stringify({ ...good, runs: { ...good.runs, 2: ['x', 1, [[7, 1, 0, 0, 5, 65, 1, 0, 0]]] } }))],
    ['one tuple too short', gzipSync(JSON.stringify({ ...good, runs: { ...good.runs, 2: ['x', 1, [[0, 1, 0, 0, 5, 65, 1, 0]]] } }))],
    ['a run id that is not one', gzipSync(JSON.stringify({ ...good, runs: { ...good.runs, abc: ['x', 1, []] } }))],
  ];
  assert.deepEqual(loadLedger(null), emptyLedger());
  assert.deepEqual(loadLedger(tempDir(t)), emptyLedger(), 'no file');
  for (const [name, bytes] of cases) {
    const dir = tempDir(t);
    writeFileSync(path.join(dir, LEDGER_FILE), bytes);
    assert.deepEqual(loadLedger(dir), emptyLedger(), name);
  }
  const dir = tempDir(t);
  saveLedger(dir, good);
  assert.deepEqual(loadLedger(dir), good, 'a good one loads whole');
});

test('40,000 runs gzip under 2 MiB', (t) => {
  let seed = 240;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const names = ['checks', 'ci-ok', 'swift', 'swift-ocr', 'office-mac', 'dco', 'changes', 'claude-review', 'lane', 'site', 'room', 'lab (forming)', 'lab (sealed)', 'merge', 'pages'];
  const labelSets = [['ubuntu-latest'], ['ubuntu-slim'], ['macos-15'], ['blacksmith-2vcpu-ubuntu-2404'], ['blacksmith-4vcpu-ubuntu-2404'], ['ubuntu-24.04']];
  const steps = ['Secret scan', 'Web check', 'Web test', 'Web build', 'Worker dry runs', 'Lint workflows', 'Unit tests'];
  const start = Date.parse('2026-10-16T00:00:00Z');
  const runs: Run[] = Array.from({ length: 40_000 }, (_, i) => {
    const created = new Date(start + Math.floor(random() * 31 * 86_400) * 1000).toISOString();
    const attempt = random() < 0.05 ? 2 : 1;
    const jobs = Array.from({ length: 1 + Math.floor(random() * 8) }, () => {
      const queued = after(created, Math.floor(random() * 30));
      const begun = after(queued, Math.floor(random() * 600));
      const ran = random() < 0.85;
      return job({
        name: pick(names),
        run_attempt: random() < 0.9 ? 1 : attempt,
        conclusion: ran ? pick([OK, OK, OK, 'failure', 'cancelled']) : 'skipped',
        created_at: queued,
        started_at: ran ? begun : null,
        completed_at: ran ? after(begun, 10 + Math.floor(random() * 1500)) : null,
        runner_name: ran ? 'GitHub Actions 7' : '',
        labels: pick(labelSets),
        steps: steps.filter(() => random() < 0.3).map((name) => ({ name, conclusion: OK })),
      });
    });
    return run({ id: 42_000_000_000 + i * 37 + Math.floor(random() * 37), run_attempt: attempt, created_at: created, updated_at: after(created, Math.floor(random() * 4000)), jobs });
  });
  const dir = tempDir(t);
  const bytes = saveLedger(dir, encodeLedger(runs));
  t.diagnostic(`${runs.length} runs, ${runs.reduce((n, r) => n + r.jobs.length, 0)} jobs: ${bytes} bytes`);
  assert.ok(bytes < MAX_LEDGER_BYTES, `${bytes} bytes`);
  assert.equal(Object.keys(loadLedger(dir).runs).length, 40_000);
});

test('a kept job with an unknown label still throws', (t) => {
  const odd = run({ jobs: [job({ labels: ['self-hosted', 'gpu-box'] })] });
  const [kept] = roundTrip(t, [odd]);
  assert.deepEqual(kept?.jobs[0]?.labels, ['self-hosted', 'gpu-box']);
  assert.throws(() => runnerOf(kept?.jobs[0]?.labels ?? []), Unreadable);
  assert.throws(() => spendUsd(kept ? [kept] : [], 0), Unreadable);
});
