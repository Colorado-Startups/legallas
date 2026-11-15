// SPDX-License-Identifier: Apache-2.0
// Only main's code counts: each main commit and the merged pull request head that became it, each job checked by head SHA.
// Every answered job counts; a record is timed at the read and linked to this lane's run; nothing found is missing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mainHeads, measure, onSha, toRecord, type Job } from './collect.ts';

const RUN = 'https://github.com/Colorado-Startups/legallas/actions/runs/7';
const job = (conclusion: string | null, minutes: number, bundle?: string | null, head_sha = 'h'): Job => ({
  name: 'swift', workflow_name: 'CI', head_sha, conclusion, started_at: '2026-11-04T10:00:00Z',
  completed_at: new Date(Date.parse('2026-11-04T10:00:00Z') + minutes * 60_000).toISOString(),
  steps: bundle === undefined ? [] : [{ name: 'App bundle', conclusion: bundle }],
});

test("main commits and merged heads are main's code; an open or closed-unmerged head is not", () => {
  const pulls = [
    { merge_commit_sha: 'm2', merged_at: '2026-11-04T10:00:00Z', head: { sha: 'merged-head' } },
    { merge_commit_sha: 'x', merged_at: null, head: { sha: 'closed-head' } },
  ];
  assert.deepEqual(mainHeads(['m2', 'm1'], pulls), ['m2', 'merged-head', 'm1']);
});

test('a job counts only from CI, on exactly the SHA looked up, with an answer', () => {
  assert.equal(onSha(job('success', 3), 'h'), true);
  assert.equal(onSha(job('success', 3, undefined, 'other'), 'h'), false);
  assert.equal(onSha({ ...job('success', 3), workflow_name: 'Fixture room' }, 'h'), false);
  assert.equal(onSha(job('skipped', 0), 'h'), false);
});

test('every answered job counts toward pass rate and time, pass or fail', () => {
  const r = measure([job('cancelled', 1), job('success', 8, 'success'), job('failure', 3, 'skipped'), job('success', 12, 'success'), job('skipped', 0)]);
  assert.deepEqual(r.swift_jobs_passing, { value: (100 * 2) / 3, samples: 3 });
  assert.deepEqual(r.swift_job_minutes_p50, { value: 8, samples: 3 });
  assert.deepEqual(r.app_bundle_verified, { value: 1, samples: 1 });
});

test('the bundle reading is the newest job that ran the step', () => {
  assert.equal(measure([job('failure', 5, 'skipped'), job('failure', 5, 'failure'), job('success', 5, 'success')]).app_bundle_verified?.value, 0);
});

test("a record is timed at the read and linked to this lane's run; nothing found is missing", () => {
  const record = toRecord('swift_jobs_passing', { value: 100, samples: 4 }, '2026-11-05T06:00:00Z', RUN);
  assert.deepEqual([record.status, record.measured_at, record.source_url], ['ok', '2026-11-05T06:00:00Z', RUN]);
  assert.equal(toRecord('app_bundle_verified', measure([]).app_bundle_verified, '2026-11-05T06:00:00Z', RUN).status, 'missing');
  assert.equal(toRecord('swift_jobs_passing', { value: 100, samples: 4 }, '2026-11-05T06:00:00Z', null).status, 'missing');
});
