// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyze } from './delivery.ts';
import { history, NOW, run } from './fixture.ts';
import { METRIC_IDS, allMissing, buildDetail, buildRecords, checkDetail, readAll, readingsFile, utc, type RunContext } from './records.ts';

const ctx: RunContext = {
  measuredAt: utc(NOW),
  commit: 'c'.repeat(40),
  runUrl: 'https://github.com/Colorado-Startups/legallas/actions/runs/123',
};
const passed = { passed: true, checks: { invented: true } };

describe('records', () => {
  it('writes one record per metric, in order, with a measured value or a reason', () => {
    const a = analyze(history([{ number: 1, mergedDaysAgo: 2, body: 'Closes #50.' }], { issues: [50] }), NOW);
    const records = buildRecords(a, passed, ctx);
    assert.deepEqual(records.map((r) => r.id), [...METRIC_IDS]);
    const by = Object.fromEntries(records.map((r) => [r.id, r]));
    assert.equal(by.change_failure_rate?.status, 'missing'); // nothing old enough yet
    assert.equal(by.change_failure_rate?.value, null);
    assert.deepEqual([by.rework_rate?.status, by.rework_rate?.value, by.rework_rate?.sample_size], ['ok', 0, 1]);
    assert.deepEqual([by.merges_tied_to_issue?.value, by.failure_drill?.value], [100, 1]);
    assert.deepEqual([by.recovery_time_p50?.status, by.recovery_time_p50?.value, by.recovery_time_p50?.sample_size], ['no_events', null, 0]);
    assert.equal(by.lead_time_p50?.source_url, ctx.runUrl);
    assert.equal(by.lead_time_p50?.stage, 'live');
    for (const r of records) assert.deepEqual(Object.keys(r).sort(), ['id', 'measured_at', 'page', 'sample_size', 'source_url', 'stage', 'status', 'value']);
  });

  it('scores nothing without an Actions run link, but keeps the reading for the summary', () => {
    const a = analyze(history([{ number: 1, mergedDaysAgo: 2 }]), NOW);
    const byHand = { ...ctx, runUrl: null };
    for (const r of buildRecords(a, passed, byHand)) {
      assert.deepEqual([r.status, r.value, r.measured_at, r.source_url], ['missing', null, ctx.measuredAt, `https://github.com/Colorado-Startups/legallas/commit/${'c'.repeat(40)}`]);
    }
    const lead = readAll(a, passed).find((r) => r.id === 'lead_time_p50');
    assert.deepEqual([lead?.value, lead?.samples], [1, 1]);
  });

  it('writes a failed drill as 0, and then every metric that rests on finding failures as missing', () => {
    const a = analyze(history([{ number: 1, mergedDaysAgo: 2 }]), NOW);
    const by = Object.fromEntries(buildRecords(a, { passed: false, checks: {} }, ctx).map((r) => [r.id, r]));
    assert.deepEqual([by.failure_drill?.status, by.failure_drill?.value], ['ok', 0]);
    for (const id of ['change_failure_rate', 'rework_rate', 'recovery_time_p50']) assert.equal(by[id]?.status, 'missing', id);
    assert.equal(by.lead_time_p50?.status, 'ok');
  });

  it('writes every metric missing, with no time, commit or link, when the history could not be read', () => {
    for (const r of allMissing()) {
      assert.deepEqual([r.status, r.value, r.measured_at, r.source_url, r.sample_size], ['missing', null, null, null, null]);
    }
  });

  it('keeps the drill-down to numbers, times and pull request numbers', () => {
    const a = analyze(
      history(
        [
          { number: 1, mergedDaysAgo: 3, title: 'An invented title that must not leak' },
          { number: 2, mergedDaysAgo: 2.5, body: 'Reverts #1' },
          { number: 3, mergedDaysAgo: 2 },
          { number: 4, mergedDaysAgo: 1, files: ['quality-speed/pages/insights/PLAN.md'] },
        ],
        { greenRuns: false, runs: [run(1, 1, 3, 'success'), run(2, 2, 2.5, 'success'), run(3, 3, 2 - 1 / 1440, 'failure')] },
      ),
      NOW,
    );
    const detail = buildDetail(a, ctx);
    assert.deepEqual(checkDetail(detail), []);
    assert.deepEqual(detail.excluded, [4]);
    assert.deepEqual(detail.recoveries, [
      { pr: 1, repaired_by: 2, merged_at: utc(NOW - 3 * 86_400_000), hours: 12, open: 0 },
      { pr: 3, repaired_by: null, merged_at: utc(NOW - 2 * 86_400_000), hours: 48, open: 1 },
    ]);
    assert.ok(!JSON.stringify(detail).includes('invented'));
    assert.deepEqual(checkDetail({ page: 'insights', title: 'words' }), ['title: a string that is not a time, the page, a metric or the commit']);
    assert.equal(checkDetail({ n: -1, s: 'x' }).length, 2);
    assert.deepEqual(checkDetail(readingsFile(detail, readAll(a, passed))), []);
    assert.equal(checkDetail({ readings: [{ id: 'not_a_metric' }] }).length, 1);
  });
});
