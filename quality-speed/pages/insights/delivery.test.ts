// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DAY_MS,
  NO_REVIEW,
  analyze,
  changeFailureRate,
  changeFrequency,
  isSitePath,
  leadTime,
  median,
  mergesTiedToIssue,
  recoveryTime,
  references,
  reworkRate,
} from './delivery.ts';
import { NOW, history, pull, run, sha } from './fixture.ts';

const refsOf = (body: string, extra: Partial<Parameters<typeof pull>[0]> = {}) =>
  references(pull({ number: 900, mergedDaysAgo: 1, body, ...extra }));

describe('references', () => {
  it('reads bare, repository and link references to this repository only', () => {
    const r = refsOf(
      'See #12, Colorado-Startups/legallas#13 and https://github.com/Colorado-Startups/legallas/issues/14. ' +
        'Not Colorado-Startups/legallas-extra#15, other/repo#16, https://github.com/other/repo/pull/17, ' +
        'https://github.com/Colorado-Startups/legallas-extra/pull/18, it&#39;s or page#19.',
    );
    assert.deepEqual(r.refs.sort((a, b) => a - b), [12, 13, 14]);
    assert.deepEqual(r.repairs, []);
  });

  it('skips HTML comments, fenced code and the pull request itself', () => {
    const r = refsOf('<!-- Fixes #20 -->\n```\nReverts #21\n```\nThis is #900, after #22.');
    assert.deepEqual(r.refs, [22]);
    assert.deepEqual(r.repairs, []);
  });

  it('finds the words that say a change repairs an earlier one', () => {
    const cases: [string, number[]][] = [
      ['Reverts Colorado-Startups/legallas#31', [31]],
      ['A follow-up to Colorado-Startups/legallas#32, from review.', [32]],
      ['Follows #33, which merged before these fixes reached it.', [33]],
      ['A small follow-up to #34.', [34]],
      ['Fixes #35', [35]],
      ['Fix for #36 and a hotfix for #37', [36, 37]],
      ['Corrects https://github.com/Colorado-Startups/legallas/pull/38', [38]],
      ['Repairs: #42', [42]],
      ['The same two fixes as Colorado-Startups/legallas#43.', [43]],
      ['A reviewer suggested it on #44, and I said it would come in a follow-up.', [44]],
      ['See #39. Unlike #40, this adds a page. Builds on #41.', []],
    ];
    for (const [body, want] of cases) assert.deepEqual(refsOf(body).repairs.sort((a, b) => a - b), want, body);
  });

  it("reads GitHub's revert branch and a reverted commit", () => {
    assert.deepEqual(refsOf('', { head: 'revert-44-claude/invented' }).repairs, [44]);
    assert.deepEqual(refsOf(`This reverts commit ${sha(45)}.`).revertsShas, [sha(45)]);
  });
});

describe('analyze', () => {
  it("keeps merges into main and leaves this site's own work out", () => {
    const a = analyze(
      history([
        { number: 1, mergedDaysAgo: 3 },
        { number: 2, mergedDaysAgo: 3, files: ['quality-speed/pages/insights/PLAN.md'] },
        { number: 3, mergedDaysAgo: 3, files: ['.github/workflows/quality-speed-screens.yml', 'REVIEW.md', '.github/labeler.yml'] },
        { number: 7, mergedDaysAgo: 3, files: ['quality-speed/pages/insights/PLAN.md', 'web/src/invented.ts'] },
        { number: 8, mergedDaysAgo: 2, files: ['quality-speed/pages/insights/PLAN.md'], body: 'Reverts #1' },
        { number: 9, mergedDaysAgo: 1.5, files: ['quality-speed/core/build.ts', 'REVIEW.md'], body: 'Follow-ups to #2.' },
        { number: 4, mergedDaysAgo: 3, base: 'release/invented' },
        { number: 5, mergedDaysAgo: null },
        { number: 6, mergedDaysAgo: 40 },
      ]),
      NOW,
    );
    assert.deepEqual(a.changes.map((c) => c.number), [1, 7, 8]);
    assert.deepEqual(a.excluded, [2, 3, 9]);
    assert.equal(a.firstMergeDay, Math.floor((NOW - 40 * DAY_MS) / DAY_MS) * DAY_MS);
    assert.ok(isSitePath('quality-speed/core/x.ts'));
    assert.ok(!isSitePath('web/quality-speed/x.ts'));
    assert.ok(isSitePath('.github/workflows/quality-speed.yml') && isSitePath('.github/workflows/quality-speed-screens.yml'));
    assert.ok(!isSitePath('.github/workflows/ci.yml'));
  });

  it('refuses to guess when a merged change has no facts', () => {
    const h = history([{ number: 1, mergedDaysAgo: 3 }]);
    h.facts.clear();
    assert.throws(() => analyze(h, NOW), /no facts/);
  });

  it('starts lead time at the first commit or the opening, whichever is earlier', () => {
    const h = history([{ number: 1, mergedDaysAgo: 1, leadHours: 2 }]);
    h.facts.set(1, { firstCommitAt: new Date(NOW - DAY_MS - 5 * 3_600_000).toISOString(), files: ['a'] });
    assert.equal(leadTime(analyze(h, NOW)).value, 5);
    h.facts.set(1, { firstCommitAt: null, files: ['a'] });
    assert.equal(leadTime(analyze(h, NOW)).value, 2);
  });

  it('counts a repair only of an earlier merged change, never an issue or a later or open one', () => {
    const a = analyze(
      history(
        [
          { number: 1, mergedDaysAgo: 5 },
          { number: 2, mergedDaysAgo: 4, body: 'Fixes #1, fixes #3, fixes #9, fixes #50' },
          { number: 3, mergedDaysAgo: 3 },
          { number: 9, mergedDaysAgo: null },
        ],
        { issues: [50] },
      ),
      NOW,
    );
    assert.deepEqual(a.changes.find((c) => c.number === 2)?.repairs, [1]);
    assert.deepEqual(a.failures.map((f) => f.number), [1]);
  });

  it('maps a reverted commit to the change that merged it', () => {
    const a = analyze(
      history([
        { number: 1, mergedDaysAgo: 5 },
        { number: 2, mergedDaysAgo: 4.5, body: `This reverts commit ${sha(1)}.` },
      ]),
      NOW,
    );
    assert.deepEqual(a.changes.find((c) => c.number === 2)?.repairs, [1]);
  });

  it('marks a change failed when repaired within 7 days, and times its recovery to the first repair', () => {
    const a = analyze(
      history([
        { number: 1, mergedDaysAgo: 20 },
        { number: 2, mergedDaysAgo: 19.5, body: 'A follow-up to #1' },
        { number: 3, mergedDaysAgo: 19, body: 'Follows #1' },
        { number: 4, mergedDaysAgo: 18 },
        { number: 5, mergedDaysAgo: 9, body: 'Fixes #4' },
      ]),
      NOW,
    );
    assert.deepEqual(a.failures.map((f) => [f.number, f.byRepair, f.byCi]), [[1, true, false]]);
    assert.equal(recoveryTime(a).value, 12);
    assert.equal(reworkRate(a).value, 60);
  });

  it('marks a change failed when its CI run on main went red, recovering at the end of the next green run', () => {
    const h = history(
      [
        { number: 1, mergedDaysAgo: 10 },
        { number: 2, mergedDaysAgo: 9 },
      ],
      { greenRuns: false, runs: [run(1, 1, 10 - 1 / 1440, 'failure'), run(2, 2, 9 - 1 / 1440, 'success')] },
    );
    const a = analyze(h, NOW);
    assert.deepEqual(a.failures.map((f) => [f.number, f.byCi]), [[1, true]]);
    const hours = recoveryTime(a).value as number;
    // A day to the green run's start a minute after #2 merged, plus its 10 minutes.
    assert.ok(Math.abs(hours - (24 + 1 / 60 + 10 / 60)) < 0.001, String(hours));
  });

  it('ignores cancelled runs and takes the latest run of a commit', () => {
    const h = history([{ number: 1, mergedDaysAgo: 10 }, { number: 2, mergedDaysAgo: 9 }], {
      greenRuns: false,
      runs: [run(1, 1, 10, 'failure'), run(3, 1, 9.9, 'success'), run(2, 2, 9, 'cancelled'), run(4, 'f'.repeat(40), 8, 'success')],
    });
    const a = analyze(h, NOW);
    assert.deepEqual(a.failures, []);
    assert.deepEqual(a.ciUnresolved, []);
  });

  it('flags changes with no CI result on main for them or after them, over the whole 35 days, past a grace period', () => {
    const h = history(
      [
        { number: 1, mergedDaysAgo: 31 },
        { number: 2, mergedDaysAgo: 3 },
        { number: 3, mergedDaysAgo: 2 },
        { number: 4, mergedDaysAgo: 0.01 },
      ],
      { greenRuns: false, runs: [run(2, 2, 3, 'success'), run(3, 3, 2, 'cancelled')] },
    );
    assert.deepEqual(analyze(h, NOW).ciUnresolved, [3]);
    h.runs = [run(3, 3, 2, 'cancelled')];
    assert.deepEqual(analyze(h, NOW).ciUnresolved, [1, 2, 3]);
  });
});

describe('metrics', () => {
  it('counts days with a change per week over completed days since the first merge', () => {
    const today = Math.floor(NOW / DAY_MS) * DAY_MS;
    const at = (daysAgo: number) => (NOW - today) / DAY_MS + daysAgo; // so a change lands inside that UTC day
    const a = analyze(
      history([
        { number: 1, mergedDaysAgo: at(10) - 0.1 },
        { number: 2, mergedDaysAgo: at(10) - 0.2 },
        { number: 3, mergedDaysAgo: at(3) },
        { number: 4, mergedDaysAgo: 0.1 },
      ]),
      NOW,
    );
    // Day 10 (two changes) and day 3 count; today is not complete yet. 10 days observed.
    assert.deepEqual(changeFrequency(a), { value: 1.4, samples: 10 });
    assert.deepEqual(changeFrequency(analyze(history([]), NOW)), { value: null, samples: 0 });
  });

  it('caps the frequency window at 28 days', () => {
    const a = analyze(history([{ number: 1, mergedDaysAgo: 60 }, { number: 2, mergedDaysAgo: 2 }]), NOW);
    assert.equal(changeFrequency(a).samples, 28);
    assert.equal(changeFrequency(a).value, 0.25);
  });

  it('takes the median lead time inside the window', () => {
    const a = analyze(
      history([
        { number: 1, mergedDaysAgo: 1, leadHours: 1 },
        { number: 2, mergedDaysAgo: 1, leadHours: 3 },
        { number: 3, mergedDaysAgo: 1, leadHours: 10 },
        { number: 4, mergedDaysAgo: 30, leadHours: 100 },
      ]),
      NOW,
    );
    assert.deepEqual(leadTime(a), { value: 3, samples: 3 });
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([]), null);
  });

  it('rates failures only over changes old enough to have been repaired', () => {
    const a = analyze(
      history([
        { number: 1, mergedDaysAgo: 36 },
        { number: 2, mergedDaysAgo: 30 },
        { number: 3, mergedDaysAgo: 29, body: 'Reverts #2' },
        { number: 4, mergedDaysAgo: 8 },
        { number: 5, mergedDaysAgo: 6 },
      ]),
      NOW,
    );
    assert.deepEqual(changeFailureRate(a), { value: 33.33, samples: 3 });
    assert.deepEqual(changeFailureRate(analyze(history([{ number: 1, mergedDaysAgo: 2 }]), NOW)), { value: null, samples: 0 });
  });

  it('times recoveries that finished inside the window and has none when nothing broke', () => {
    const a = analyze(
      history([
        { number: 1, mergedDaysAgo: 32 },
        { number: 2, mergedDaysAgo: 31, body: 'Fixes #1' },
        { number: 3, mergedDaysAgo: 5 },
      ]),
      NOW,
    );
    assert.equal(a.failures.length, 1);
    assert.deepEqual(recoveryTime(a), { value: null, samples: 0 });
  });

  it('ties a change by a closing keyword, its Issue line (an issue or a board card) or a repair link, never by a passing mention', () => {
    const a = analyze(
      history(
        [
          { number: 1, mergedDaysAgo: 3, body: 'Closes #50.' },
          { number: 2, mergedDaysAgo: 2.9, body: 'A follow-up to #1.' },
          { number: 3, mergedDaysAgo: 2.8, body: 'What\n\nIssue: #51, #52' },
          { number: 4, mergedDaysAgo: 2.7, body: 'Works toward #50, like #1.' },
          { number: 5, mergedDaysAgo: 2.6, body: 'Issue: #33' },
          { number: 6, mergedDaysAgo: 2.5, body: 'Resolves #3' },
          { number: 8, mergedDaysAgo: 2.4, body: 'Issue: https://github.com/orgs/Colorado-Startups/projects/2/views/1?pane=issue&itemId=777' },
          { number: 11, mergedDaysAgo: 2.35, body: 'Issue: https://github.com/orgs/Colorado-Startups/projects/3?pane=issue&itemId=780' },
          { number: 9, mergedDaysAgo: 2.3, body: 'See https://github.com/orgs/Colorado-Startups/projects/2?itemId=778 for context.' },
          { number: 10, mergedDaysAgo: 2.2, body: 'Issue: https://github.com/orgs/Someone-Else/projects/2?itemId=779' },
          { number: 7, mergedDaysAgo: 1, dependabot: true },
        ],
        { issues: [33, 50, 51, 52] },
      ),
      NOW,
      { reviewed_through: '2031-03-20', repairs: [], not_backlog_issues: [33], backlog_board: 2 },
    );
    assert.deepEqual(
      a.changes.map((c) => [c.number, c.tied]),
      [[1, true], [2, true], [3, true], [4, false], [5, false], [6, false], [8, true], [11, false], [9, false], [10, false], [7, false]],
    );
    assert.deepEqual(mergesTiedToIssue(a), { value: 40, samples: 10 });
  });

  it('ties by a board card only once review has pinned the board', () => {
    const h = history([{ number: 1, mergedDaysAgo: 2, body: 'Issue: https://github.com/orgs/Colorado-Startups/projects/2?itemId=7' }]);
    assert.equal(analyze(h, NOW).changes[0]?.tied, false);
    assert.equal(analyze(h, NOW, { ...NO_REVIEW, backlog_board: 2 }).changes[0]?.tied, true);
  });

  it('counts a follow-up to a change merged elsewhere as rework, and a failure only on main', () => {
    const a = analyze(
      history([
        { number: 1, mergedDaysAgo: 4, base: 'release/invented' },
        { number: 2, mergedDaysAgo: 3, body: 'The same two fixes as #1, so main keeps them.' },
        { number: 3, mergedDaysAgo: 2.5 },
        { number: 4, mergedDaysAgo: 2, body: 'A reviewer suggested it on #3, and it comes in a follow-up.' },
      ]),
      NOW,
    );
    assert.deepEqual(a.changes.map((c) => [c.number, c.repairs]), [[2, [1]], [3, []], [4, [3]]]);
    assert.deepEqual(a.failures.map((f) => f.number), [3]);
    assert.equal(reworkRate(a).value, 66.67);
  });

  it('counts a bug fix as rework: a closed issue labelled bug, or "Repairs: a bug"', () => {
    const a = analyze(
      history(
        [
          { number: 1, mergedDaysAgo: 3, body: 'Fixes #60' },
          { number: 2, mergedDaysAgo: 2, body: 'Repairs: a bug' },
          { number: 3, mergedDaysAgo: 1, body: 'Fixes #61\nRepairs: none' },
        ],
        { issues: [61], bugIssues: [60] },
      ),
      NOW,
    );
    assert.deepEqual(a.changes.map((c) => c.bugFix), [true, true, false]);
    assert.deepEqual(a.failures, []);
    assert.equal(reworkRate(a).value, 66.67);
  });

  it('counts a failure still open at its age, so a red main never reads as no events', () => {
    const h = history([{ number: 1, mergedDaysAgo: 2 }], { greenRuns: false, runs: [run(1, 1, 2 - 1 / 1440, 'failure')] });
    const a = analyze(h, NOW);
    assert.deepEqual(a.failures.map((f) => [f.number, f.recoveredAt]), [[1, null]]);
    assert.deepEqual(recoveryTime(a), { value: 48, samples: 1 });
  });
});
