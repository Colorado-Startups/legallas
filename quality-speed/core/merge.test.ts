// SPDX-License-Identifier: Apache-2.0
// What the state holds after a run, on invented pages and dates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MetricRecord } from '../contract/format.ts';
import { PUBLIC_PAGES as PAGES } from '../contract/pages.ts';
import { validateHistoryLine } from '../contract/validate.ts';
import { extendsHistory } from './history-fetch.ts';
import { loadLanes } from './lanes.ts';
import { laneAfterRun, laneArtifact, merge, plannedLanes } from './merge.ts';

const MANIFEST = readFileSync(new URL('../contract/example/manifest.json', import.meta.url), 'utf8');
const WORKFLOW = readFileSync(new URL('../../.github/workflows/quality-speed.yml', import.meta.url), 'utf8');
const BUILD_MINUTES_GUARD = readFileSync(new URL('../../.github/scripts/build_minutes_guard.py', import.meta.url), 'utf8');
const NOW = new Date('2025-03-04T08:37:00Z');
const RUN = 'https://github.com/Colorado-Startups/legallas/actions/runs/1001';

const reading = (id: string, measured_at: string, value = 72.5): MetricRecord => ({
  id,
  page: 'code',
  value,
  status: 'ok',
  stage: 'lab',
  measured_at,
  source_url: RUN,
  sample_size: 1,
});

const TODAY = '2025-03-04T08:00:00Z';
const LAST_WEEK = '2025-02-25T08:00:00Z';

const missing = (id: string): MetricRecord => ({
  id,
  page: 'code',
  value: null,
  status: 'missing',
  stage: 'lab',
  measured_at: null,
  source_url: null,
  sample_size: null,
});

/** Folders for one run, with the `code` page declaring a daily and a weekly lane. */
function setUp(): { root: string; pagesDir: string; fresh: string; state: string; out: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'merge-test-'));
  const pagesDir = path.join(root, 'pages');
  mkdirSync(path.join(pagesDir, 'code'), { recursive: true });
  writeFileSync(path.join(pagesDir, 'code', 'manifest.json'), MANIFEST);
  writeFileSync(path.join(pagesDir, 'code', 'collect.ts'), '');
  writeFileSync(
    path.join(pagesDir, 'code', 'lanes.json'),
    JSON.stringify([
      { id: 'daily', runner: 'linux', cadence: 'daily', collector: 'collect.ts' },
      { id: 'weekly', runner: 'macos', cadence: 'weekly', collector: 'collect.ts' },
    ]),
  );
  return { root, pagesDir, fresh: path.join(root, 'fresh'), state: path.join(root, 'state'), out: path.join(root, 'out') };
}

function put(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}

const records = (out: string) => JSON.parse(readFileSync(path.join(out, 'records', 'code.json'), 'utf8')) as MetricRecord[];
const historyLines = (out: string) => readFileSync(path.join(out, 'history.jsonl'), 'utf8').trim().split('\n');

test('a fresh lane replaces its last records', () => {
  assert.deepEqual(laneAfterRun([reading('a', TODAY)], [reading('a', LAST_WEEK)], true), [reading('a', TODAY)]);
});

test('a lane this run did not plan keeps its records and their original times', () => {
  assert.deepEqual(laneAfterRun(undefined, [reading('a', LAST_WEEK)], false), [reading('a', LAST_WEEK)]);
});

test('a planned lane with no file failed, so its metrics read as missing, never as an old number', () => {
  assert.deepEqual(laneAfterRun(undefined, [reading('a', LAST_WEEK)], true), [missing('a')]);
  assert.deepEqual(laneAfterRun(undefined, [], true), []);
});

test('the plan is read exactly, and an unreadable plan stops the run', () => {
  const planned = plannedLanes('{"include":[{"slug":"code","lane":"daily","runner":"ubuntu-latest"}]}');
  assert.deepEqual([...planned], ['code/daily']);
  assert.deepEqual([...plannedLanes('{"include":[]}')], []);
  assert.throws(() => plannedLanes(''));
  assert.throws(() => plannedLanes('{}'));
});

test('a first run with no state gives every page one score line, and no-list pages read 0', () => {
  const { root, pagesDir, fresh, state, out } = setUp();
  const { kept, dropped } = merge(fresh, state, out, new Set(), NOW, pagesDir);
  assert.deepEqual({ kept, dropped }, { kept: 0, dropped: 0 });
  const lines = historyLines(out);
  assert.equal(lines.length, PAGES.length);
  for (const line of lines) {
    const checked = validateHistoryLine(JSON.parse(line));
    assert.deepEqual(checked.errors, []);
    assert.equal(checked.value?.total, 0);
    assert.equal(checked.value?.consumption, 0, 'every new line carries consumption');
    assert.equal(checked.value?.at, '2025-03-04T08:37:00Z');
  }
  rmSync(root, { recursive: true });
});

test('fresh and carried lanes combine, and the page gets a real score', () => {
  const { root, pagesDir, fresh, state, out } = setUp();
  put(path.join(fresh, 'records-code-daily', 'code', 'daily.json'), [reading('line_coverage', TODAY, 90)]);
  put(path.join(state, 'lanes', 'code', 'weekly.json'), [{ ...reading('test_time_p50', LAST_WEEK, 120), sample_size: 5 }]);
  const { kept, dropped } = merge(fresh, state, out, new Set(['code/daily']), NOW, pagesDir);
  assert.deepEqual({ kept, dropped }, { kept: 2, dropped: 0 });
  assert.deepEqual(records(out).map((r) => r.id), ['line_coverage', 'test_time_p50']);
  assert.equal(records(out)[1]?.measured_at, LAST_WEEK);
  assert.equal(existsSync(path.join(out, 'lanes', 'code', 'weekly.json')), true);
  const code = historyLines(out).map((l) => JSON.parse(l)).find((l) => l.page === 'code');
  assert.equal(code.total > 0, true);
  rmSync(root, { recursive: true });
});

test('a failed lane lowers the score the same day', () => {
  const { root, pagesDir, fresh, state, out } = setUp();
  put(path.join(state, 'lanes', 'code', 'daily.json'), [reading('line_coverage', TODAY, 90)]);
  merge(fresh, state, out, new Set(['code/daily']), NOW, pagesDir);
  assert.deepEqual(records(out), [missing('line_coverage')]);
  const code = historyLines(out).map((l) => JSON.parse(l)).find((l) => l.page === 'code');
  assert.equal(code.total, 0);
  rmSync(root, { recursive: true });
});

test('a page with no sign-off yet keeps no records and reads 0, and that is no failure', () => {
  const { root, pagesDir, fresh, state, out } = setUp();
  const { signoff_comment: _signoff, ...unsigned } = JSON.parse(MANIFEST);
  writeFileSync(path.join(pagesDir, 'code', 'manifest.json'), JSON.stringify(unsigned));
  put(path.join(fresh, 'records-code-daily', 'code', 'daily.json'), [reading('line_coverage', TODAY, 90)]);
  const { kept } = merge(fresh, state, out, new Set(['code/daily']), NOW, pagesDir);
  assert.equal(kept, 0);
  assert.deepEqual(records(out), []);
  rmSync(root, { recursive: true });
});

test("a lane's detail goes with its records: fresh when it ran, carried when it wasn't planned, gone when it failed", () => {
  const { root, pagesDir, fresh, state, out } = setUp();
  const detail = { checks: { a: 1 }, readings: {} };
  put(path.join(fresh, 'records-code-daily', 'code', 'daily.json'), [reading('line_coverage', TODAY)]);
  put(path.join(fresh, 'records-code-daily', 'code', 'daily', 'detail.json'), detail);
  put(path.join(state, 'lanes', 'code', 'weekly', 'detail.json'), detail);
  merge(fresh, state, out, new Set(['code/daily']), NOW, pagesDir);
  assert.equal(existsSync(path.join(out, 'lanes', 'code', 'daily', 'detail.json')), true);
  assert.equal(existsSync(path.join(out, 'lanes', 'code', 'weekly', 'detail.json')), true);
  const next = path.join(root, 'next');
  merge(path.join(root, 'none'), out, next, new Set(['code/daily']), NOW, pagesDir);
  assert.equal(existsSync(path.join(next, 'lanes', 'code', 'daily', 'detail.json')), false);
  assert.equal(existsSync(path.join(next, 'lanes', 'code', 'weekly', 'detail.json')), true);
  rmSync(root, { recursive: true });
});

test("a carried number can't outrank this run's reading or its failure when two lanes report one metric", () => {
  const { root, pagesDir, fresh, state, out } = setUp();
  writeFileSync(
    path.join(pagesDir, 'code', 'lanes.json'),
    JSON.stringify([
      { id: 'weekly', runner: 'macos', cadence: 'weekly', collector: 'collect.ts' },
      { id: 'daily', runner: 'linux', cadence: 'daily', collector: 'collect.ts' },
    ]),
  );
  put(path.join(state, 'lanes', 'code', 'weekly.json'), [reading('line_coverage', LAST_WEEK, 11)]);
  put(path.join(state, 'lanes', 'code', 'daily.json'), [reading('line_coverage', LAST_WEEK, 50)]);
  put(path.join(fresh, 'records-code-daily', 'code', 'daily.json'), [reading('line_coverage', TODAY, 90)]);
  merge(fresh, state, out, new Set(['code/daily']), NOW, pagesDir);
  assert.equal(records(out)[0]?.value, 90);
  const failed = path.join(root, 'failed');
  merge(path.join(root, 'no-fresh'), state, failed, new Set(['code/daily']), NOW, pagesDir);
  assert.equal(records(failed)[0]?.status, 'missing');
  rmSync(root, { recursive: true });
});

test('a broken lane file reads as no file, and every other page still gets its line', () => {
  const { root, pagesDir, fresh, state, out } = setUp();
  put(path.join(fresh, 'records-code-daily', 'code', 'daily.json'), 'not json');
  put(path.join(state, 'lanes', 'code', 'weekly.json'), { not: 'a list' });
  const { kept } = merge(fresh, state, out, new Set(['code/daily']), NOW, pagesDir);
  assert.equal(kept, 0);
  assert.equal(historyLines(out).length, PAGES.length);
  rmSync(root, { recursive: true });
});

test("a lane's page files go with its records, and a failed lane keeps only its facts", () => {
  const { root, pagesDir, fresh, state, out } = setUp();
  put(path.join(fresh, 'records-code-daily', 'code', 'daily.json'), [reading('line_coverage', TODAY)]);
  put(path.join(fresh, 'records-code-daily', 'code', 'daily', 'page', 'view.json'), {});
  put(path.join(fresh, 'records-code-daily', 'code', 'daily', 'facts', 'seen.json'), {});
  merge(fresh, state, out, new Set(['code/daily']), NOW, pagesDir);
  assert.equal(existsSync(path.join(out, 'lanes', 'code', 'daily', 'page', 'view.json')), true);
  const failed = path.join(root, 'failed');
  merge(path.join(root, 'no-fresh'), out, failed, new Set(['code/daily']), NOW, pagesDir);
  assert.equal(existsSync(path.join(failed, 'lanes', 'code', 'daily', 'page', 'view.json')), false);
  assert.equal(existsSync(path.join(failed, 'lanes', 'code', 'daily', 'facts', 'seen.json')), true);
  rmSync(root, { recursive: true });
});

test('a record that fails the format scores nothing, however good it claims to be', () => {
  const totalFor = (records: MetricRecord[]) => {
    const { root, pagesDir, fresh, state, out } = setUp();
    put(path.join(fresh, 'records-code-daily', 'code', 'daily.json'), records);
    merge(fresh, state, out, new Set(['code/daily']), NOW, pagesDir);
    const lines = readFileSync(path.join(out, 'history.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    rmSync(root, { recursive: true });
    return lines.find((line) => line.page === 'code').total;
  };
  const best = reading('line_coverage', TODAY, 100);
  assert.ok(totalFor([best]) > totalFor([]), 'the good record has to score, or this proves nothing');
  assert.equal(totalFor([{ ...best, source_url: 'https://example.com/not-a-run' }]), totalFor([]));
});

test('a retired lane, a metric off the list and a repeat are all dropped', () => {
  const { root, pagesDir, fresh, state, out } = setUp();
  put(path.join(state, 'lanes', 'code', 'retired.json'), [reading('line_coverage', TODAY)]);
  put(path.join(state, 'lanes', 'code', 'daily.json'), [reading('line_coverage', TODAY), reading('not_on_the_list', TODAY)]);
  put(path.join(state, 'lanes', 'code', 'weekly.json'), [reading('line_coverage', TODAY)]);
  const { kept, dropped } = merge(fresh, state, out, new Set(), NOW, pagesDir);
  assert.deepEqual({ kept, dropped }, { kept: 1, dropped: 2 });
  assert.equal(existsSync(path.join(out, 'lanes', 'code', 'retired.json')), false);
  rmSync(root, { recursive: true });
});

test('the new history starts with every byte of the old one', () => {
  const { root, pagesDir, fresh, state, out } = setUp();
  const older = '{"at":"2025-03-03T08:37:00Z"}\n';
  put(path.join(state, 'history.jsonl'), older);
  merge(fresh, state, out, new Set(), NOW, pagesDir);
  const newer = readFileSync(path.join(out, 'history.jsonl'));
  assert.equal(extendsHistory(Buffer.from(older), newer), true);
  assert.equal(historyLines(out).length, PAGES.length + 1);
  rmSync(root, { recursive: true });
});

test('a record that fails the format never reaches the page list', () => {
  const { root, pagesDir, fresh, state, out } = setUp();
  put(path.join(fresh, 'records-code-daily', 'code', 'daily.json'), [{ ...reading('line_coverage', TODAY), title: 'words' }]);
  const { kept, dropped } = merge(fresh, state, out, new Set(['code/daily']), NOW, pagesDir);
  assert.deepEqual({ kept, dropped }, { kept: 0, dropped: 1 });
  assert.deepEqual(records(out), []);
  rmSync(root, { recursive: true });
});

test("a record uploaded in another lane's artifact isn't scored, and the same record in its own lane's is", () => {
  const totalFor = (folder: string) => {
    const { root, pagesDir, fresh, state, out } = setUp();
    put(path.join(fresh, folder, 'code', 'daily.json'), [reading('line_coverage', TODAY, 100)]);
    const { kept } = merge(fresh, state, out, new Set(['code/daily', 'code/weekly']), NOW, pagesDir);
    const code = historyLines(out).map((l) => JSON.parse(l)).find((l) => l.page === 'code');
    rmSync(root, { recursive: true });
    return { kept, total: code.total };
  };
  const own = totalFor('records-code-daily');
  assert.equal(own.kept, 1, 'the record has to score in its own lane, or this proves nothing');
  assert.ok(own.total > 0);
  // The code page's weekly lane, a lane of another page, and the old merged layout with no artifact folder.
  for (const folder of ['records-code-weekly', 'records-security-gate', '.']) assert.deepEqual(totalFor(folder), { kept: 0, total: 0 }, folder);
});

test('every declared lane uploads under a name no other lane has, so two lanes never share a folder', () => {
  const names = PAGES.flatMap((slug) => loadLanes(slug).lanes.map((lane) => laneArtifact(slug, lane.id)));
  assert.ok(names.length > 0);
  assert.equal(new Set(names).size, names.length);
});

test("site downloads each lane's artifact into a folder named for it, which merge.ts reads by", () => {
  const step = WORKFLOW.split("      - name: This run's records\n")[1]?.split('\n      - ')[0] ?? '';
  assert.match(step, /^ {10}pattern: records-\*$/m);
  assert.match(step, /^ {10}merge-multiple: false$/m);
  assert.match(WORKFLOW, /- name: A lone lane's records under its name\n/, 'download-artifact unpacks a lone match flat');
});

// Tripwire (#373). Even read by name, any lane's job can still upload an artifact under another lane's name, and a process
// outliving a lane could replace the pages artifact before `deploy`. The security page's PLAN.md accepts that only while
// every lane runs reviewed code on GitHub-hosted runners, which start fresh for each job.
test('tripwire: Blacksmith stays off for the lanes, which the accepted risk in the security PLAN.md rests on', () => {
  assert.match(
    BUILD_MINUTES_GUARD,
    /^BLACKSMITH_ALLOWED = False$/m,
    'Blacksmith is allowed again: read the accepted risk in quality-speed/pages/security/PLAN.md again before changing this test',
  );
});

test("a private page's last state is not carried, and it gets no score line", () => {
  const { root, pagesDir, fresh, state, out } = setUp();
  mkdirSync(path.join(pagesDir, 'claude-code'), { recursive: true });
  writeFileSync(path.join(pagesDir, 'claude-code', 'manifest.json'), MANIFEST.replace('"code"', '"claude-code"'));
  writeFileSync(path.join(pagesDir, 'claude-code', 'collect.ts'), '');
  writeFileSync(path.join(pagesDir, 'claude-code', 'lanes.json'), JSON.stringify([{ id: 'daily', runner: 'linux', cadence: 'daily', collector: 'collect.ts' }]));
  put(path.join(state, 'lanes', 'claude-code', 'daily.json'), [{ ...reading('a', TODAY), page: 'claude-code' }]);
  put(path.join(state, 'records', 'claude-code.json'), [{ ...reading('a', TODAY), page: 'claude-code' }]);
  put(path.join(fresh, 'records-claude-code-daily', 'claude-code', 'daily.json'), [{ ...reading('a', TODAY), page: 'claude-code' }]);
  merge(fresh, state, out, new Set(['claude-code/daily']), NOW, pagesDir);
  assert.equal(existsSync(path.join(out, 'records', 'claude-code.json')), false);
  assert.equal(existsSync(path.join(out, 'lanes', 'claude-code')), false);
  assert.equal(historyLines(out).some((line) => line.includes('claude-code')), false);
  assert.equal(historyLines(out).length, PAGES.length);
  rmSync(root, { recursive: true });
});
