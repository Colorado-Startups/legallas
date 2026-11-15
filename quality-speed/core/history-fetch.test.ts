// SPDX-License-Identifier: Apache-2.0
// Which copies of the history a run may trust, and what counts as shrinking. Ids and dates are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitOnMain, extendsHistory, isTrustedRun, MAX_QUOTA_WAIT_MS, quotaWait, trustedCopies, type Artifact, type Run } from './history-fetch.ts';

const mainRun: Run = { event: 'schedule', path: '.github/workflows/quality-speed.yml', head_branch: 'main', head_sha: 'a1' };
const onMain = () => true;
const CURRENT_RUN = 999;

const copy = (id: number, day: number, made: Partial<NonNullable<Artifact['workflow_run']>> = {}): Artifact => ({
  id,
  created_at: `2031-03-${String(day).padStart(2, '0')}T08:37:00Z`,
  expired: false,
  workflow_run: { id: id * 10, head_branch: 'main', repository_id: 1, head_repository_id: 1, ...made },
});

const ids = (copies: Artifact[]) => copies.map((c) => c.id);

test('only a scheduled, pushed or dispatched run of this workflow on main is trusted', () => {
  assert.equal(isTrustedRun(mainRun), true);
  assert.equal(isTrustedRun({ ...mainRun, event: 'push' }), true);
  assert.equal(isTrustedRun({ ...mainRun, event: 'workflow_dispatch' }), true);
  assert.equal(isTrustedRun({ ...mainRun, event: 'pull_request' }), false);
  assert.equal(isTrustedRun({ ...mainRun, event: 'pull_request_target' }), false);
  assert.equal(isTrustedRun({ ...mainRun, event: 'workflow_run' }), false);
  assert.equal(isTrustedRun({ ...mainRun, head_branch: 'claude/some-branch' }), false);
  assert.equal(isTrustedRun({ ...mainRun, head_branch: null }), false);
  assert.equal(isTrustedRun({ ...mainRun, path: '.github/workflows/ci.yml' }), false);
});

test('copies come back newest first, at most two, whatever order the API lists them in', () => {
  assert.deepEqual(ids(trustedCopies([copy(1, 1), copy(3, 3), copy(2, 2)], () => mainRun, CURRENT_RUN, onMain)), [3, 2]);
});

test('a copy from a branch, another repository or an expired copy is passed over', () => {
  const listed = [
    copy(5, 5, { head_branch: 'claude/some-branch' }),
    copy(4, 4, { head_repository_id: 2 }),
    { ...copy(3, 3), expired: true },
    { ...copy(2, 2), workflow_run: null },
    copy(1, 1),
  ];
  assert.deepEqual(ids(trustedCopies(listed, () => mainRun, CURRENT_RUN, onMain)), [1]);
});

test("a copy whose run turns out to be a pull request's or another workflow's is passed over", () => {
  const runs = new Map<number, Run>([
    [30, { ...mainRun, event: 'pull_request' }],
    [20, { ...mainRun, path: '.github/workflows/ci.yml' }],
    [10, mainRun],
  ]);
  assert.deepEqual(ids(trustedCopies([copy(3, 3), copy(2, 2), copy(1, 1)], (id) => runs.get(id) as Run, CURRENT_RUN, onMain)), [1]);
});

test("this run's own copy from an earlier attempt is left out, so a re-run appends once", () => {
  assert.deepEqual(ids(trustedCopies([copy(2, 2, { id: CURRENT_RUN }), copy(1, 1)], () => mainRun, CURRENT_RUN, onMain)), [1]);
});

test('a run on a tag called main reads as branch main, so its commit must really be on main', () => {
  const runs = new Map<number, Run>([[20, { ...mainRun, head_sha: 'from-a-tag' }], [10, mainRun]]);
  const really = (sha: string) => sha !== 'from-a-tag';
  assert.deepEqual(ids(trustedCopies([copy(2, 2), copy(1, 1)], (id) => runs.get(id) as Run, CURRENT_RUN, really)), [1]);
});

test('an error reading a run stops the fetch instead of skipping that copy', () => {
  const failing = () => {
    throw new Error('HTTP 502');
  };
  assert.throws(() => trustedCopies([copy(1, 1)], failing, CURRENT_RUN, onMain));
});

test('history extends when every older byte is there, in order', () => {
  const older = Buffer.from('{"day":1}\n{"day":2}\n');
  assert.equal(extendsHistory(older, Buffer.from('{"day":1}\n{"day":2}\n{"day":3}\n')), true);
  assert.equal(extendsHistory(older, older), true);
});

test('history that shrank or changed does not extend', () => {
  const older = Buffer.from('{"day":1}\n{"day":2}\n');
  assert.equal(extendsHistory(older, Buffer.from('{"day":1}\n')), false);
  assert.equal(extendsHistory(older, Buffer.alloc(0)), false);
  assert.equal(extendsHistory(older, Buffer.from('{"day":1}\n{"day":9}\n{"day":3}\n')), false);
});

test("a commit is on main only if it's in main's history, by GitHub's own compare statuses", () => {
  // compare/BASE...HEAD describes HEAD against BASE, as GitHub does: main with more commits than the base is `ahead`.
  const main = ['first', 'second', 'tip'];
  const onlyOffTip = new Set(['past-the-tip']);
  const compare = (request: string) => {
    const [, base, head] = /compare\/([^.]+)\.\.\.([^?]+)\?/.exec(request) ?? [];
    assert.equal(head, 'main');
    if (base === 'tip') return { status: 'identical' };
    if (main.includes(base ?? '')) return { status: 'ahead' };
    return { status: onlyOffTip.has(base ?? '') ? 'behind' : 'diverged' };
  };
  const onMainHere = (sha: string) => commitOnMain(compare, 'an-owner/a-repo', sha);
  assert.equal(onMainHere('first'), true);
  assert.equal(onMainHere('tip'), true);
  assert.equal(onMainHere('past-the-tip'), false);
  assert.equal(onMainHere('from-a-tag'), false);
});

test('a copy from an older commit on main stays trusted once main moves on', () => {
  const compare = () => ({ status: 'ahead' });
  const copies = trustedCopies([copy(2, 2), copy(1, 1)], () => mainRun, CURRENT_RUN, (sha) => commitOnMain(compare, 'an-owner/a-repo', sha));
  assert.deepEqual(ids(copies), [2, 1]);
});

test('a run holding two copies counts once, by its newest', () => {
  const copies = [copy(4, 4, { id: 40 }), copy(3, 3, { id: 40 }), copy(2, 2, { id: 20 }), copy(1, 1, { id: 10 })];
  assert.deepEqual(ids(trustedCopies(copies, () => mainRun, CURRENT_RUN, onMain)), [4, 2]);
});

test('a spent quota waits until its reset plus 5 seconds; any other failure does not wait', () => {
  const now = Date.parse('2031-03-04T08:10:00Z');
  const reset = Date.parse('2031-03-04T08:30:00Z') / 1000;
  assert.equal(quotaWait({ remaining: 0, reset }, now), 20 * 60_000 + 5_000);
  assert.equal(quotaWait({ remaining: 1, reset }, now), null);
  assert.equal(quotaWait({ remaining: 0, reset: now / 1000 - 60 }, now), 0);
});

test('a reset further off than the job can wait stops the run instead', () => {
  const now = Date.parse('2031-03-04T08:10:00Z');
  assert.equal(quotaWait({ remaining: 0, reset: (now + MAX_QUOTA_WAIT_MS) / 1000 }, now), null);
});
