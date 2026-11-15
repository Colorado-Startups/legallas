// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { macLoopSample, median, runnerClass, summarize, treeKey, webLoopSample, type Job, type Run } from './ci.ts';

const run: Run = { id: 7, event: 'push', head_sha: 'a'.repeat(40), head_branch: 'main', status: 'completed', conclusion: 'success', created_at: '2030-01-10T00:00:00Z', html_url: 'https://github.com/o/r/actions/runs/7' };
const step = (name: string, secs: number, conclusion = 'success') => ({
  name,
  conclusion,
  started_at: '2030-01-10T00:00:00Z',
  completed_at: new Date(Date.parse('2030-01-10T00:00:00Z') + secs * 1000).toISOString(),
});
const checks = (steps: ReturnType<typeof step>[]): Job => ({ id: 1, run_id: 7, name: 'checks', conclusion: 'success', runner_name: 'blacksmith-2vcpu-ubuntu-2404-abc123', started_at: null, completed_at: '2030-01-10T00:05:00Z', steps });

test('runner classes separate Blacksmith sizes from GitHub-hosted runners', () => {
  assert.equal(runnerClass('blacksmith-2vcpu-ubuntu-2404-t6fifcxxbtsi4kfk'), 'blacksmith-2vcpu');
  assert.equal(runnerClass('GitHub Actions 1000001973'), 'github-hosted');
});

test('a web-loop sample needs all four steps by exact name, each successful', () => {
  const four = [step('Web check', 20), step('Web test', 80), step('Web build', 2), step('Worker dry runs', 3)];
  assert.equal(webLoopSample(checks(four), run)?.value, 105);
  assert.equal(webLoopSample(checks(four.slice(1)), run), undefined);
  assert.equal(webLoopSample(checks([...four.slice(0, 3), step('Worker dry runs', 0, 'skipped')]), run), undefined);
  assert.equal(webLoopSample(checks([step('Web checks', 20), ...four.slice(1)]), run), undefined);
});

test('the Mac sample is the longer job, and only when both passed', () => {
  const job = (name: string, secs: number, conclusion = 'success'): Job => ({ id: 2, run_id: 7, name, conclusion, runner_name: 'GitHub Actions 1', started_at: '2030-01-10T00:00:00Z', completed_at: new Date(Date.parse('2030-01-10T00:00:00Z') + secs * 1000).toISOString() });
  assert.equal(macLoopSample([job('swift', 150), job('swift-ocr', 60)], run)?.value, 150);
  assert.equal(macLoopSample([job('swift', 150), job('swift-ocr', 60, 'failure')], run), undefined);
  assert.equal(macLoopSample([job('swift', 150)], run), undefined);
});

test('summaries keep the newest runner class inside the window', () => {
  const now = new Date('2030-02-01T00:00:00Z');
  const s = (value: number, at: string, cls: string) => ({ value, at, runnerClass: cls, runId: 1, url: '' });
  const out = summarize([s(100, '2030-01-30T00:00:00Z', 'b'), s(300, '2030-01-29T00:00:00Z', 'g'), s(110, '2030-01-28T00:00:00Z', 'b'), s(5, '2029-11-01T00:00:00Z', 'b')], now, 30, 20);
  assert.equal(out?.runnerClass, 'b');
  assert.equal(out?.samples.length, 2);
  assert.equal(out?.value, 105);
  assert.equal(summarize([], now, 30, 20), undefined);
  assert.equal(median([3, 1, 2]), 2);
});

test('the Swift tree key changes with any Swift path and ignores the rest', () => {
  const base = [{ path: 'Sources', sha: '1' }, { path: 'Tests', sha: '2' }, { path: 'web', sha: '3' }];
  assert.equal(treeKey(base), treeKey([...base.slice(0, 2), { path: 'web', sha: '9' }]));
  assert.notEqual(treeKey(base), treeKey([{ path: 'Sources', sha: '8' }, ...base.slice(1)]));
});
