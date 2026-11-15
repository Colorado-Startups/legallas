// SPDX-License-Identifier: Apache-2.0
// The page's arithmetic on an invented dump: two merged pull requests, their runs, jobs and review verdicts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billed, jobCost, jobReads, readings, rows, runnerOf, verdictOf, type Dump, type Job, type Run, type Verdict } from './compute.ts';

const cfg = { window_days: 2, lookback_days: 1, max_job_reads: 4000, drill_runs: 600 };
const now = Date.parse('2026-03-10T12:00:00Z');
const at = (min: number) => new Date(now - 60 * 60_000 + min * 60_000).toISOString();
const CI_YML = "      - name: Lint workflows\n        if: steps.changed.outputs.workflows == 'true'\n        run: .github/scripts/lint-workflows.sh\n";
const SHA = 'a'.repeat(40);

let id = 0;
function run(name: string, sha: string, min: number, conclusion = 'success', event = 'pull_request'): Run {
  return { id: ++id, name, event, status: 'completed', conclusion, head_sha: sha, head_branch: 'b', created_at: at(min), updated_at: at(min + 2) };
}
function job(name: string, label: string, min: number, secs: number, conclusion = 'success', extra: Partial<Job> = {}): Job {
  return { name, labels: [label], started_at: at(min), completed_at: new Date(Date.parse(at(min)) + secs * 1000).toISOString(), conclusion, ...extra };
}
const passedChecks = (min: number) => job('checks', 'blacksmith-2vcpu-ubuntu-2404', min, 30, 'success', { steps: [{ name: 'Secret scan', conclusion: 'success' }] });
const verdict = (issue: number, min: number, v: Verdict['verdict'] = 'MERGE'): Verdict => ({ issue, created_at: at(min), verdict: v, sha: SHA });

function dump(): Dump {
  id = 0;
  const runs = [run('CI', 'a1', 0), run('CI', 'a2', 10), run('DCO', 'a2', 10), run('DCO', 'a2', 11), run('Claude review', 'a2', 10), run('CI', 'b1', 20), run('DCO', 'b1', 20), run('Claude review', 'b1', 20)];
  const jobs: Dump['jobs'] = {
    1: [job('choose-runner', 'ubuntu-slim', 0, 10), passedChecks(0), job('ci-ok', 'ubuntu-slim', 1, 3)],
    2: [job('choose-runner', 'ubuntu-slim', 10, 10), passedChecks(10), job('swift', 'xcode-27', 11, 150), job('ci-ok', 'ubuntu-slim', 14, 3)],
    3: [job('dco', 'ubuntu-slim', 10, 6)],
    4: [job('dco', 'ubuntu-slim', 11, 6)],
    5: [job('claude-review', 'ubuntu-latest', 10, 70, 'failure', { run_attempt: 1 }), job('claude-review', 'ubuntu-latest', 13, 70, 'success', { run_attempt: 2 })],
    6: [job('choose-runner', 'ubuntu-slim', 20, 10), passedChecks(20), job('ci-ok', 'ubuntu-slim', 21, 3)],
    7: [job('dco', 'ubuntu-slim', 20, 6)],
    8: [job('claude-review', 'ubuntu-latest', 20, 50)],
  };
  const pulls = [
    { number: 1, merged_at: at(16), head: { ref: 'b', sha: 'a2' }, user: { type: 'User' } },
    { number: 2, merged_at: at(25), head: { ref: 'c', sha: 'b1' }, user: { type: 'User' } },
  ];
  const timelines = { 1: [{ event: 'head_ref_force_pushed', created_at: at(10), commit_id: 'a2' }], 2: [] };
  const rules = [{ type: 'required_signatures' }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci-ok' }, { context: 'dco' }, { context: 'claude-review' }] } }];
  // A block and a merge on #1, a merge on #2, a block on #9, which never merged: four reviews.
  const verdicts = [verdict(1, 12, 'BLOCK'), verdict(1, 15), verdict(2, 24), verdict(9, 5, 'BLOCK')];
  return { runs, jobs, pulls, timelines, rules, ciYml: CI_YML, verdicts };
}

test('runners: list prices by label, Blacksmith by vCPU, an unknown label throws', () => {
  assert.deepEqual(runnerOf(['ubuntu-slim']), { kind: 'slim', factor: 1 });
  assert.deepEqual(runnerOf(['xcode-27']), { kind: 'mac', factor: 1 });
  assert.deepEqual(runnerOf(['blacksmith-4vcpu-ubuntu-2404']), { kind: 'blacksmith', factor: 2 });
  assert.throws(() => runnerOf(['macos-26-xlarge']));
  assert.equal(billed(job('x', 'ubuntu-latest', 0, 61)), 2);
  assert.deepEqual(jobCost(job('x', 'ubuntu-latest', 0, 5, 'skipped')), { kind: null, usd: 0, minutes: 0 });
});

test('readings: per merge, the latest attempt, repeats, reviews from verdicts and the speed', () => {
  const v = readings(dump(), cfg, now);
  assert.equal(v.gates_intact.value, 8);
  // slim: 2 CI jobs in each of 3 runs and 3 DCO = 9 x $0.002; Blacksmith 3 x $0.006; Mac 3 x $0.062; review 2+2+1 x $0.006
  assert.equal(v.ci_usd_per_merge.value, Math.round(((9 * 0.002 + 3 * 0.006 + 3 * 0.062 + 5 * 0.006) / 2) * 1000) / 1000);
  assert.equal(v.pushes_per_merge.value, 1.5);
  assert.deepEqual(v.reviews_per_merge, { value: 2, samples: 2 });
  assert.equal(v.repeat_runs_per_merge.value, 0.5);
  assert.deepEqual(v.final_push_to_merge_p50, { value: 5.5, samples: 2 });
});

test('a failed gate, a quiet window and an unreviewed merge never read as good', () => {
  const d = dump();
  d.jobs[8] = [job('claude-review', 'ubuntu-latest', 20, 0, 'skipped')];
  assert.equal(readings(d, cfg, now).gates_intact.value, 7);
  d.ciYml = d.ciYml.replace("== 'true'", "== 'never'");
  assert.equal(readings(d, cfg, now).gates_intact.value, 6);
  assert.equal(readings(d, cfg, now + 30 * 86_400_000).gates_intact.value, null);
  // #2 merged with no verdict: missing, not 1.5 reviews a merge.
  d.verdicts = (d.verdicts ?? []).filter((v) => v.issue !== 2);
  assert.equal(readings(d, cfg, now).reviews_per_merge.value, null);
  // A verdict before the window proves #2 was reviewed, but counts toward no window's reviews.
  d.verdicts.push({ ...verdict(2, 0), created_at: new Date(now - 3 * 86_400_000).toISOString() });
  assert.equal(readings(d, cfg, now).reviews_per_merge.value, 1.5);
  // A dump read before verdicts were: missing.
  delete d.verdicts;
  assert.equal(readings(d, cfg, now).reviews_per_merge.value, null);
});

test('a merged head with no CI run reads pushes missing', () => {
  const d = dump();
  d.runs = d.runs.filter((r) => !(r.name === 'CI' && r.head_sha === 'b1'));
  assert.equal(readings(d, cfg, now).pushes_per_merge.value, null);
});

test('verdicts: a person with access, the first line exactly the marker', () => {
  const c = (body: string, author_association = 'MEMBER', type = 'User') => ({ issue_url: 'https://api.github.com/repos/o/r/issues/12', created_at: at(0), author_association, user: { type }, body });
  assert.deepEqual(verdictOf(c(`Review: MERGE at ${SHA}\r\nAll green.`)), { issue: 12, created_at: at(0), verdict: 'MERGE', sha: SHA });
  // A private org member reads as CONTRIBUTOR to the job's token.
  assert.equal(verdictOf(c(`Review: BLOCK at ${SHA}`, 'CONTRIBUTOR'))?.verdict, 'BLOCK');
  assert.equal(verdictOf(c(`Review: MERGE at ${SHA}`, 'NONE')), null);
  assert.equal(verdictOf(c(`Review: MERGE at ${SHA}`, 'MEMBER', 'Bot')), null);
  assert.equal(verdictOf(c(`Review: MERGE at ${SHA} after the fix`)), null);
  assert.equal(verdictOf(c(`Review: MERGE at ${SHA.slice(0, 7)}`)), null);
  assert.equal(verdictOf(c(`Review: MERGE at ${SHA.toUpperCase()}`)), null);
  assert.equal(verdictOf(c(`Fixed.\nReview: MERGE at ${SHA}`)), null);
  assert.equal(verdictOf({ ...c(`Review: MERGE at ${SHA}`), body: null }), null);
});

test('jobReads: the gates on merged heads, repeated runs and the newest runs, nothing else', () => {
  const d = dump();
  // Run 9: CI on merged head a2 in the lookback, read for the gates. Run 10: a skipped DCO run, never read.
  d.runs.push({ ...run('CI', 'a2', 0), id: 9, created_at: new Date(now - 2.5 * 86_400_000).toISOString() }, { ...run('DCO', 'b1', 22, 'skipped'), id: 10 });
  const r = jobReads(d.runs, d.pulls, { ...cfg, drill_runs: 2 }, now);
  // Gates: 2, 3, 4, 6, 7, 9. Repeats: DCO on a2 twice (3, 4). Newest two runs: those at minute 20 (6, 7, 8).
  assert.deepEqual(r.ids.sort((a, b) => a - b), [2, 3, 4, 6, 7, 8, 9]);
  assert.equal(r.drill_from, at(20).slice(0, 19) + 'Z');
  // A quiet window: the drill-down is the window.
  assert.equal(jobReads(d.runs, d.pulls, cfg, now).drill_from, new Date(now - 2 * 86_400_000).toISOString().slice(0, 19) + 'Z');
});

test('rows: typical push per path, and every job priced', () => {
  const r = rows(dump(), cfg, now);
  assert.equal(r.merges, 2);
  assert.equal(r.rebases_per_merge, 0.5);
  assert.deepEqual(r.paths.map((p) => [p.path, p.runs]), [['docs', 2], ['web', 0], ['swift', 1]]);
  assert.ok(r.paths.find((p) => p.path === 'swift')?.bars.some((b) => b.job === 'swift' && b.kind === 'mac'));
  assert.equal(r.jobs[0]?.job, 'swift');
});

test('the drill-down covers its own span; merges and gates keep the window', () => {
  const d = { ...dump(), drill_from: at(20) };
  const r = rows(d, cfg, now);
  assert.equal(r.merges, 2);
  assert.ok(r.gates);
  assert.deepEqual(r.paths.map((p) => [p.path, p.runs]), [['docs', 1], ['web', 0], ['swift', 0]]);
  assert.equal(r.span_hours, round1((now - Date.parse(at(20))) / 3_600_000));
  assert.ok(!r.jobs.some((j) => j.job === 'swift'));
  // Dollars over the span's one merge (#2): two slim CI jobs, Blacksmith, slim DCO, the review on ubuntu-latest.
  assert.equal(readings(d, cfg, now).ci_usd_per_merge.value, Math.round((3 * 0.002 + 0.006 + 0.006) * 1000) / 1000);
});

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
