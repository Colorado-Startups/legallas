// SPDX-License-Identifier: Apache-2.0
// Which copies of the history a run may trust, and what counts as shrinking. Ids and dates are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { commitOnMain, extendsHistory, isTrustedRun, MAX_QUOTA_WAIT_MS, prunePrivate, publicHistory, quotaWait, trustedCopies, type Artifact, type Run } from './history-fetch.ts';

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

const day = (n: number) => `{"at":"2031-03-0${n}T08:00:00Z","page":"code","quality":${n},"speed":1,"consumption":1,"total":1}\n`;

test('history extends when every older byte is there, in order', () => {
  const older = Buffer.from(day(1) + day(2));
  assert.equal(extendsHistory(older, Buffer.from(day(1) + day(2) + day(3))), true);
  assert.equal(extendsHistory(older, older), true);
});

test('history that shrank or changed does not extend', () => {
  const older = Buffer.from(day(1) + day(2));
  assert.equal(extendsHistory(older, Buffer.from(day(1))), false);
  assert.equal(extendsHistory(older, Buffer.alloc(0)), false);
  assert.equal(extendsHistory(older, Buffer.from(day(1) + day(9) + day(3))), false);
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

test('an earlier state loses every private page, lane, measurement and detail before it is uploaded again, and nothing public', () => {
  const state = mkdtempSync(path.join(tmpdir(), 'history-prune-'));
  const put = (file: string, value: unknown) => {
    mkdirSync(path.dirname(path.join(state, file)), { recursive: true });
    writeFileSync(path.join(state, file), typeof value === 'string' ? value : JSON.stringify(value));
  };
  const line = (page: string) => `{"at":"2031-03-01T08:00:00Z","page":"${page}","quality":1,"speed":1,"consumption":1,"total":1}`;
  put('history.jsonl', `${line('code')}\n${line('claude-code')}\n${line('documentation')}\n${line('agents')}\n`);
  put('records/claude-code.json', [{ id: 'tokens_per_merged_change' }]);
  const rec = (page: string, id: string, value: number) => ({ id, page, value, status: 'ok', stage: 'live', measured_at: '2031-03-01T08:00:00Z', source_url: 'x', sample_size: 3 });
  put('records/actions.json', [rec('actions', 'usd_per_merge', 0.4), rec('actions', 'main_green_pct', 99)]);
  put('lanes/actions/records.json', [rec('actions', 'usd_per_merge', 0.4), rec('actions', 'main_green_pct', 99)]);
  put('lanes/actions/records/detail.json', { readings: { month_usd: { value: 12 } } });
  put('records/code.json', [{ id: 'long_files' }]);
  put('records/security.json', [{ id: 'key_age_max_days' }, { id: 'sast_findings_open' }]);
  put('lanes/claude-code/claude-code.json', [{ id: 'tokens_per_merged_change' }]);
  put('lanes/claude-code/claude-code/detail.json', {});
  put('lanes/security/keys.json', [{ id: 'key_age_max_days' }]);
  put('lanes/security/keys/facts/names.json', {});
  put('lanes/security/scan.json', [{ id: 'sast_findings_open' }]);
  put('lanes/code/nightly.json', [{ id: 'long_files' }]);
  assert.equal(prunePrivate(state), 9, '5 files or folders, 2 score lines, 2 private measurements');
  for (const gone of ['records/claude-code.json', 'lanes/claude-code', 'lanes/security/keys.json', 'lanes/security/keys', 'lanes/actions/records']) {
    assert.equal(existsSync(path.join(state, gone)), false, gone);
  }
  for (const kept of ['records/code.json', 'lanes/code/nightly.json', 'lanes/security/scan.json']) assert.ok(existsSync(path.join(state, kept)), kept);
  assert.deepEqual(JSON.parse(readFileSync(path.join(state, 'records/security.json'), 'utf8')), [{ id: 'sast_findings_open' }]);
  for (const file of ['records/actions.json', 'lanes/actions/records.json']) {
    const [usd, green] = JSON.parse(readFileSync(path.join(state, file), 'utf8'));
    assert.deepEqual([usd.value, usd.status, green.value], [null, 'missing', 99], file);
  }
  assert.equal(readFileSync(path.join(state, 'history.jsonl'), 'utf8'), `${line('code')}\n${line('documentation')}\n`, 'public lines kept in order, a renamed page included');
  assert.equal(prunePrivate(state), 0, 'a clean state is left as it is');
  rmSync(state, { recursive: true });
});

test('a page turning private never reads as the history shrinking, but a changed public line still does', () => {
  const line = (page: string, total = 1) => `{"at":"2031-03-01T08:00:00Z","page":"${page}","quality":1,"speed":1,"consumption":1,"total":${total}}\n`;
  const before = Buffer.from(line('code') + line('claude-code') + line('agents'));
  const pruned = Buffer.from(line('code') + line('issues'));
  assert.equal(publicHistory(before), line('code'));
  assert.equal(extendsHistory(before, pruned), true);
  assert.equal(extendsHistory(before, Buffer.from(line('code', 2))), false, 'a public score changed');
  assert.equal(extendsHistory(before, Buffer.from(line('issues'))), false, 'a public line went missing');
  assert.equal(publicHistory('not json\n{"page":7}\n'), '', 'an unreadable line fails closed');
});
