// SPDX-License-Identifier: Apache-2.0
// What leaving something undone costs on this page: each of these would otherwise read as good news. Invented events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateManifest, validateRecords } from '../../contract/validate.ts';
import { bugOf, main, sortIssues, type IssueNode } from './collect.ts';
import { billedMinutes, CANARY_ISSUE, canaryRead, detectionDrill, landedSha, linkedRuns, measure, METRIC_IDS, p90, RISKY_AREAS, severityOf, toRecord, type Bug, type Review } from './measure.ts';

const NOW = new Date('2026-06-15T00:00:00Z');
const REVIEWS: Review[] = [{ date: '2026-06-14', areas: [...RISKY_AREAS], bugs: [] }];
const bug = (over: Partial<Bug>): Bug => ({ number: 1, state: 'OPEN', stateReason: null, duplicateOf: null, createdAt: '2026-06-14T00:00:00Z', closedAt: null, body: 'Severity: low', reopenedAt: [], unlabeledAt: null, closedBy: [], landedAt: null, ...over });
const closed = (reason: string, over: Partial<Bug> = {}) => bug({ state: 'CLOSED', stateReason: reason, closedAt: '2026-06-14T12:00:00Z', ...over });
const CANARY = closed('COMPLETED', { body: 'Severity: low\nRun: /actions/runs/1', landedAt: '2026-01-01T00:00:00Z', closedBy: [['a.test.ts']], reopenedAt: ['2026-01-02T00:00:00Z'] });

test('the drill proves the whole read: the logic, the canary and the runs list', () => {
  assert.equal(detectionDrill(CANARY, true), 1);
  assert.equal(detectionDrill(undefined, true), 0, 'a renamed label or a broken query loses the canary');
  assert.equal(detectionDrill(CANARY, false), 0, 'a renamed branch empties the runs list');
  for (const broken of [{ closedBy: [] }, { closedBy: [['a.ts']] }, { landedAt: null }, { reopenedAt: [] }, { body: 'Severity: high\nRun: /actions/runs/1' }, { body: 'Severity: low' }, { state: 'OPEN' as const }]) {
    assert.equal(canaryRead({ ...CANARY, ...broken }), false, JSON.stringify(broken));
  }
});

test('lines an issue carries: a missing severity counts as high, and only a whole line counts', () => {
  assert.equal(severityOf('no line here'), 'high');
  assert.equal(severityOf('Severity: Critical\nmore'), 'critical');
  assert.equal(severityOf('The Severity: low is not at the start'), 'high');
  assert.equal(landedSha('Landed: 24f9811\n'), '24f9811');
  assert.equal(landedSha('Landed: not a sha'), null);
  assert.deepEqual([...linkedRuns('see https://github.com/x/y/actions/runs/42/job/1 and /actions/runs/7')], [42, 7]);
});

test('closing a bug without fixing it, or taking its label off, does not make it go away for 90 days', () => {
  const high = { body: 'Severity: high' };
  const open = (one: Bug) => measure([one], [], REVIEWS, NOW).open_bugs_critical_high;
  assert.deepEqual(open(bug(high)), { value: 1, samples: 1 });
  assert.deepEqual(open(closed('NOT_PLANNED', high)), { value: 1, samples: 1 }, 'closed as not planned');
  assert.deepEqual(open(closed('COMPLETED', high)), { value: 1, samples: 1 }, 'closed with no merged pull request');
  assert.deepEqual(open(bug({ ...high, unlabeledAt: '2026-06-14T12:00:00Z' })), { value: 1, samples: 1 }, 'stripped of its label');
  assert.deepEqual(open(closed('COMPLETED', { ...high, closedBy: [['a.ts']] })), { value: 0, samples: 1 }, 'a merged pull request fixes it');
  assert.deepEqual(open(closed('DUPLICATE', high)), { value: 1, samples: 1 }, 'a duplicate of nothing is as not planned');
  assert.deepEqual(open(closed('DUPLICATE', { ...high, duplicateOf: 99 })), { value: 1, samples: 1 }, 'nor does a duplicate of something that is no bug leave');
  assert.deepEqual(measure([bug(high), closed('DUPLICATE', { ...high, number: 2, duplicateOf: 1 })], [], REVIEWS, NOW).open_bugs_critical_high, { value: 1, samples: 2 }, 'the original counts instead');
  assert.deepEqual(open(closed('NOT_PLANNED', { ...high, createdAt: '2026-01-01T00:00:00Z', closedAt: '2026-01-02T00:00:00Z' })), { value: 0, samples: 1 }, 'after 90 days it drops');
  assert.deepEqual(measure([closed('NOT_PLANNED', { ...high, createdAt: '2026-06-05T00:00:00Z' })], [], REVIEWS, NOW).time_to_fix_high_p90, { value: 240, samples: 1 }, 'its clock runs on too');
});

test('leaving a bug open never looks fast: it counts at its age so far', () => {
  const got = measure([bug({ body: 'Severity: high', createdAt: '2026-06-05T00:00:00Z' })], [], REVIEWS, NOW);
  assert.deepEqual(got.time_to_fix_high_p90, { value: 240, samples: 1 });
  assert.equal(got.time_to_fix_other_p90, 'no_events');
});

test('found first: a bug counts only if it links a failed run or a review filed it that day', () => {
  const found = (one: Bug, reviews: Review[] = REVIEWS) => measure([one], [{ id: 9, createdAt: '2026-06-13T00:00:00Z', minutes: 0 }], reviews, NOW).bugs_found_first;
  assert.deepEqual(found(bug({})), { value: 0, samples: 1 }, 'nobody says what found it');
  assert.deepEqual(found(bug({ body: 'see /actions/runs/9' })), { value: 100, samples: 1 });
  assert.deepEqual(found(bug({ body: 'see /actions/runs/8' })), { value: 0, samples: 1 }, 'a link to any other run proves nothing');
  assert.deepEqual(found(bug({ number: 5 }), [{ date: '2026-06-14', areas: [], bugs: [5] }]), { value: 100, samples: 1 });
  assert.deepEqual(found(bug({ number: 5 }), [{ date: '2026-06-01', areas: [], bugs: [5] }]), { value: 0, samples: 1 }, 'a row written long after proves nothing');
  assert.equal(measure([], [], REVIEWS, NOW).bugs_found_first, 'no_events');
});

test('time to find: no landing commit, an unknown one or one after filing counts at 90 days', () => {
  const find = (landedAt: string | null) => measure([bug({ landedAt })], [], REVIEWS, NOW).time_to_find_p90;
  assert.deepEqual(find('2026-06-12T00:00:00Z'), { value: 2, samples: 1 });
  assert.deepEqual(find(null), { value: 90, samples: 1 });
  assert.deepEqual(find('2026-06-14T12:00:00Z'), { value: 90, samples: 1 });
});

test('a fix with no merged pull request, or none that changed a test, does not count as tested', () => {
  const fixes = (closedBy: string[][]) => measure([closed('COMPLETED', { closedBy })], [], REVIEWS, NOW).fixes_with_test;
  assert.deepEqual(fixes([]), { value: 0, samples: 1 });
  assert.deepEqual(fixes([['web/worker/rooms.ts']]), { value: 0, samples: 1 });
  assert.deepEqual(fixes([['web/worker/rooms.ts', 'web/worker/rooms.test.ts']]), { value: 100, samples: 1 });
  assert.deepEqual(fixes([['Tests/LegallasCoreTests/CaseTests.swift']]), { value: 100, samples: 1 });
});

test('a failed run no issue names counts against both its metrics; only a later issue stops its clock', () => {
  const runs = [{ id: 9, createdAt: '2026-06-13T00:00:00Z', minutes: 0 }, { id: 1, createdAt: '2026-01-01T00:00:00Z', minutes: 0 }];
  const silent = measure([], runs, REVIEWS, NOW);
  assert.deepEqual(silent.failed_main_runs_with_issue, { value: 0, samples: 1 });
  assert.deepEqual(silent.error_to_issue_p90, { value: 48, samples: 1 });
  const named = measure([bug({ body: 'Severity: low\nhttps://github.com/x/y/actions/runs/9', createdAt: '2026-06-13T06:00:00Z' })], runs, REVIEWS, NOW);
  assert.deepEqual(named.failed_main_runs_with_issue, { value: 100, samples: 1 });
  assert.deepEqual(named.error_to_issue_p90, { value: 6, samples: 1 });
  const older = measure([bug({ body: '/actions/runs/9', createdAt: '2026-06-01T00:00:00Z' })], runs, REVIEWS, NOW);
  assert.deepEqual(older.error_to_issue_p90, { value: 48, samples: 1 }, 'an older issue edited to name it does not read as instant');
  assert.equal(measure([], [], REVIEWS, NOW).failed_main_runs_with_issue, 'no_events');
});

test('the ledger: a stale area is out of time, and a row dated after now reads as missing', () => {
  const part = measure([], [], [{ date: '2026-06-14', areas: RISKY_AREAS.slice(1), bugs: [] }, { date: '2026-05-01', areas: [RISKY_AREAS[0]], bugs: [] }], NOW);
  assert.deepEqual(part.risky_areas_reviewed_in_time, { value: 85.71, samples: 7 });
  assert.equal(measure([], [], [{ date: '2026-06-16', areas: [...RISKY_AREAS], bugs: [] }], NOW).risky_areas_reviewed_in_time, null);
});

test('p90 takes the nearest rank', () => {
  assert.equal(p90([5]), 5);
  assert.equal(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);
});

test('a failed read writes missing, never a good number, and the records pass the format', () => {
  const manifest = validateManifest({ ...JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')), signoff_comment: 1 }, 'reliability');
  assert.deepEqual(manifest.errors, []);
  const url = 'https://github.com/Colorado-Startups/legallas/actions/runs/1';
  const at = '2026-06-15T00:00:00Z';
  const records = METRIC_IDS.map((id, i) => toRecord(id, i === 0 ? null : i === 1 ? { value: 2, samples: 1 } : id === 'time_to_find_p90' ? 'no_events' : { value: 0, samples: 1 }, at, url));
  assert.equal(records[0]!.status, 'missing');
  assert.equal(records[0]!.value, null);
  assert.deepEqual(validateRecords(records, manifest.value!).errors, []);
  assert.equal(toRecord('detection_drill', { value: 1, samples: 1 }, at, null).status, 'missing', 'no run link: nothing proves the reading');
});

const node = (over: Partial<IssueNode>): IssueNode => ({
  number: 1,
  state: 'OPEN',
  stateReason: null,
  createdAt: '2026-06-14T00:00:00Z',
  closedAt: null,
  body: '',
  labels: { nodes: [{ name: 'bug' }] },
  timelineItems: { nodes: [] },
  closedByPullRequestsReferences: { nodes: [] },
  ...over,
});

test('which issues count: a label is no way out, and only the canary is left out, while it carries the bug label', () => {
  const numbers = (nodes: readonly IssueNode[]) => sortIssues(nodes).bugs.map((one) => one.number);
  const siteBug = node({ number: 2, labels: { nodes: [{ name: 'bug' }, { name: 'area:quality-speed' }] } });
  const stripped = node({ number: 3, labels: { nodes: [] }, timelineItems: { nodes: [{ __typename: 'UnlabeledEvent', createdAt: '2026-06-14T00:00:00Z', label: { name: 'bug' } }] } });
  const other = node({ number: 4, labels: { nodes: [{ name: 'enhancement' }] } });
  assert.deepEqual(numbers([node({}), siteBug, stripped, other, node({ number: CANARY_ISSUE })]), [1, 2, 3]);
  assert.equal(sortIssues([node({ number: CANARY_ISSUE })]).canary?.number, CANARY_ISSUE);
  assert.equal(sortIssues([node({ number: CANARY_ISSUE, labels: { nodes: [{ name: 'defect' }] } })]).canary, undefined, 'a renamed label fails the drill');
});

test('reading an issue: reopenings, a lost label, a duplicate and only merged pull requests', () => {
  const read = bugOf(
    node({
      labels: { nodes: [] },
      timelineItems: {
        nodes: [
          { __typename: 'ReopenedEvent', createdAt: '2026-06-01T00:00:00Z' },
          { __typename: 'UnlabeledEvent', createdAt: '2026-06-02T00:00:00Z', label: { name: 'other' } },
          { __typename: 'UnlabeledEvent', createdAt: '2026-06-03T00:00:00Z', label: { name: 'bug' } },
          { __typename: 'MarkedAsDuplicateEvent', createdAt: '2026-06-04T00:00:00Z', canonical: { number: 7 } },
        ],
      },
      closedByPullRequestsReferences: { nodes: [{ merged: false, files: { nodes: [{ path: 'open.ts' }] } }, { merged: true, files: { nodes: [{ path: 'a.test.ts' }] } }] },
    }),
    '2026-01-01T00:00:00Z',
  );
  assert.deepEqual(read.reopenedAt, ['2026-06-01T00:00:00Z']);
  assert.equal(read.unlabeledAt, '2026-06-03T00:00:00Z');
  assert.equal(read.duplicateOf, 7);
  assert.deepEqual(read.closedBy, [['a.test.ts']]);
  assert.equal(bugOf(node({ timelineItems: { nodes: [{ __typename: 'UnlabeledEvent', createdAt: '2026-06-03T00:00:00Z', label: { name: 'bug' } }] } }), null).unlabeledAt, null, 'it went back on');
});

test('minutes lost to failed runs: each job rounds up as GitHub bills it, and a job that never ran adds nothing', () => {
  const jobs = [
    { started_at: '2026-06-10T00:00:00Z', completed_at: '2026-06-10T00:00:01Z' },
    { started_at: '2026-06-10T00:00:00Z', completed_at: '2026-06-10T00:02:00Z' },
    { started_at: null, completed_at: null },
    { started_at: '2026-06-10T00:00:00Z', completed_at: null },
  ];
  assert.equal(billedMinutes(jobs), 3);
  const runs = [{ id: 1, createdAt: '2026-06-10T00:00:00Z', minutes: 4 }, { id: 2, createdAt: '2026-06-12T00:00:00Z', minutes: 6 }, { id: 3, createdAt: '2026-01-01T00:00:00Z', minutes: 50 }];
  assert.deepEqual(measure([], runs, REVIEWS, NOW).failed_main_run_minutes_90d, { value: 10, samples: 2 });
  assert.equal(measure([], [], REVIEWS, NOW).failed_main_run_minutes_90d, 'no_events');
  const unread = [...runs, { id: 4, createdAt: '2026-06-13T00:00:00Z', minutes: null }];
  assert.equal(measure([], unread, REVIEWS, NOW).failed_main_run_minutes_90d, null, 'an unread run makes only this metric missing');
  assert.deepEqual(measure([], unread, REVIEWS, NOW).failed_main_runs_with_issue, measure([], runs.concat({ id: 4, createdAt: '2026-06-13T00:00:00Z', minutes: 0 }), REVIEWS, NOW).failed_main_runs_with_issue);
});

test('a failed read writes every metric missing and fails the job', async () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'reliability-')), 'records.json');
  await main(['--out', out], async () => {
    throw new Error('refused');
  });
  try {
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = 0;
  }
  const records = JSON.parse(readFileSync(out, 'utf8')) as { id: string; status: string; value: number | null }[];
  assert.ok(records.filter((r) => r.id !== 'detection_drill').every((r) => r.status === 'missing'));
  assert.notEqual(records.find((r) => r.id === 'detection_drill')?.value, 1);
});
