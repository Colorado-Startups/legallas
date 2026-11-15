// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyze, type History, type Reviewed } from './delivery.ts';
import { drill, plant } from './drill.ts';
import { NOW, history, run } from './fixture.ts';

const healthy = (): History =>
  history(
    [
      { number: 1, mergedDaysAgo: 20, body: 'Closes #50.' },
      { number: 2, mergedDaysAgo: 12, body: 'A follow-up to #1.' },
      { number: 3, mergedDaysAgo: 3 },
    ],
    { issues: [50] },
  );

const REVIEWED: Reviewed = { reviewed_through: '2031-03-10', repairs: [{ pr: 2, repairs: 1 }], not_backlog_issues: [], backlog_board: null };

describe('failure drill', () => {
  it('passes on a healthy history and leaves the real one untouched', () => {
    const h = healthy();
    const live = analyze(h, NOW);
    const result = drill(h, live, NOW, REVIEWED);
    assert.equal(result.passed, true, JSON.stringify(result.checks));
    assert.equal(h.pulls.length, 3);
    assert.equal(h.facts.size, 3);
  });

  it('plants three failures that the analysis finds with their recovery times', () => {
    const { planted, expect } = plant(healthy(), NOW);
    const a = analyze(planted, NOW);
    const found = a.failures.filter((f) => f.number > expect.top).map((f) => f.number);
    assert.deepEqual(found, Object.values(expect.failed).map(([n]) => n));
    assert.ok(Object.values(expect.failed).every(([n]) => n > 100_000));
  });

  it('fails when a real change has no CI result on main', () => {
    const h = healthy();
    h.runs = h.runs.slice(0, 2); // the latest change loses its run
    const result = drill(h, analyze(h, NOW), NOW, REVIEWED);
    assert.equal(result.passed, false);
    assert.equal(result.checks.ci_results_cover_window, false);
  });

  it('fails when no CI runs were read at all', () => {
    const h = history([{ number: 1, mergedDaysAgo: 3 }], { greenRuns: false });
    const result = drill(h, analyze(h, NOW), NOW, REVIEWED);
    assert.equal(result.passed, false);
  });

  it('fails when nothing has merged to shape the drill on', () => {
    const h = history([], { runs: [run(1, 1, 1, 'success')] });
    const result = drill(h, analyze(h, NOW), NOW, REVIEWED);
    assert.deepEqual(result, { passed: false, checks: { planted: false } });
  });

  it('checks every reviewed repair whatever its age, and fails on a miss or an empty list', () => {
    const h = history([
      { number: 1, mergedDaysAgo: 200 },
      { number: 2, mergedDaysAgo: 199, body: 'A follow-up to #1.' },
      { number: 3, mergedDaysAgo: 20 },
      { number: 4, mergedDaysAgo: 19, body: 'Tidies what #3 left.' },
    ]);
    const reviewed = (repairs: { pr: number; repairs: number }[]): Reviewed => ({ ...REVIEWED, repairs });
    const old = reviewed([{ pr: 2, repairs: 1 }]);
    assert.equal(drill(h, analyze(h, NOW, old), NOW, old).passed, true);
    for (const list of [reviewed([{ pr: 4, repairs: 3 }]), reviewed([{ pr: 900, repairs: 899 }]), reviewed([])]) {
      const result = drill(h, analyze(h, NOW, list), NOW, list);
      assert.equal(result.checks.recall_real_repairs, false, JSON.stringify(list.repairs));
      assert.equal(result.passed, false);
    }
  });

  it('fails once the reviewed list is more than 35 days old, or dated ahead', () => {
    const h = healthy();
    for (const [through, fresh] of [['2031-02-14', true], ['2031-02-12', false], ['2031-03-21', false]] as const) {
      const list = { ...REVIEWED, reviewed_through: through };
      assert.equal(drill(h, analyze(h, NOW, list), NOW, list).checks.review_fresh, fresh, through);
    }
  });
});
