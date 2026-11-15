// SPDX-License-Identifier: Apache-2.0
// The goal check, on invented metrics only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Change, Manifest, MetricDef } from '../contract/format.ts';
import type { PageSlug } from '../contract/pages.ts';
import { baseManifest, compareManifests, findLoosenings, goalCheck, goalCheckEach } from './goal-check.ts';

const def = (id: string, more: Partial<MetricDef> = {}): MetricDef => ({
  id,
  lens: 'quality',
  unit: 'percent',
  direction: 'higher',
  floor: 40,
  goal: 90,
  weight: 2,
  max_age_hours: 48,
  min_samples: 3,
  ...more,
});
const lower = (id: string, more: Partial<MetricDef> = {}) => def(id, { lens: 'speed', unit: 'ms', direction: 'lower', floor: 1000, goal: 100, ...more });
const list = (a: MetricDef = def('a'), l: MetricDef = lower('l')): MetricDef[] => [a, def('b'), def('c'), l, lower('m')];
const manifest = (metrics: MetricDef[] = list(), more: Partial<Manifest> = {}): Manifest => ({ page: 'code', signoff_comment: 9, metrics, changes: [], ...more });
const compare = (head: Manifest, base: Manifest = manifest()) => compareManifests('code', base, head);
const fields = (head: Manifest, base: Manifest = manifest()) => findLoosenings(base, head).map((l) => `${l.metric}.${l.field}`);
const entry = (metric: string, field: Change['field'], from: Change['from'], to: Change['to']): Change => ({ date: '2026-11-01', metric, field, from, to, reason: 'wrong_basis', issue: 7, signoff_comment: 99 });

test('each loosening fails, in the right direction', () => {
  const cases: [string, Manifest][] = [
    ['a.goal', manifest(list(def('a', { goal: 80 })))],
    ['a.floor', manifest(list(def('a', { floor: 30 })))],
    ['l.goal', manifest(list(def('a'), lower('l', { goal: 200 })))],
    ['l.floor', manifest(list(def('a'), lower('l', { floor: 2000 })))],
    ['a.weight', manifest(list(def('a', { weight: 1 })))],
    ['a.weight', manifest(list(def('a', { weight: 3 })))],
    ['a.lens', manifest(list(def('a', { lens: 'speed' })))],
    ['a.group', manifest(list(def('a', { group: 'one' })))],
    ['a.min_samples', manifest(list(def('a', { min_samples: 2 })))],
    ['a.max_age_hours', manifest(list(def('a', { max_age_hours: 72 })))],
    ['b.retired', manifest(list().filter((m) => m.id !== 'b'))],
    ['a.unit', manifest(list(def('a', { unit: 'ratio' })))],
    ['l.coverage_metric', manifest(list(def('a'), lower('l', { coverage_metric: 'a' })))],
  ];
  for (const [expected, head] of cases) assert.deepEqual(fields(head), [expected], expected);
});

test('a new direction or unit cannot hide what happens to the goal and floor', () => {
  assert.deepEqual(fields(manifest(list(def('a', { direction: 'lower', floor: 90, goal: 40 })))), ['a.direction', 'a.goal', 'a.floor']);
  assert.deepEqual(fields(manifest(list(def('a', { unit: 'ratio', floor: 100, goal: 99 })))), ['a.unit', 'a.goal', 'a.floor']);
});

test('the same moves the other way pass', () => {
  for (const head of [
    manifest(list(def('a', { goal: 95 }))),
    manifest(list(def('a', { floor: 50 }))),
    manifest(list(def('a'), lower('l', { goal: 50 }))),
    manifest(list(def('a'), lower('l', { floor: 500 }))),
    manifest(list(def('a', { min_samples: 5 }))),
    manifest(list(def('a', { max_age_hours: 24 }))),
    manifest([...list(), def('new_one')]),
  ]) {
    assert.deepEqual(compare(head), []);
  }
  assert.deepEqual(compareManifests('code', null, manifest()), []);
});

test('a group weight changing fails, and so does removing a group', () => {
  const groups = [{ id: 'one', weight: 40 }, { id: 'two', weight: 60 }];
  assert.deepEqual(findLoosenings(manifest(list(), { groups }), manifest(list(), { groups: [{ id: 'one', weight: 40 }] })), [{ metric: 'two', field: 'group_weight', from: 60, to: null }]);
  assert.deepEqual(fields(manifest(list(), { groups: [{ id: 'one', weight: 50 }, { id: 'two', weight: 50 }] }), manifest(list(), { groups })), ['one.group_weight', 'two.group_weight']);
});

test('only a new entry stating the exact change gets past, and the log only grows', () => {
  const eased = list(def('a', { goal: 80 }));
  assert.match(compare(manifest(eased))[0] ?? '', /a goal 90 to 80 needs a change-log entry$/);
  assert.deepEqual(compare(manifest(eased, { changes: [entry('a', 'goal', 90, 80)] })), []);
  const { signoff_comment: _comment, ...noComment } = entry('a', 'goal', 90, 80);
  assert.deepEqual(compare(manifest(eased, { changes: [noComment] })), [], 'an entry needs no signoff_comment');
  assert.match(compare(manifest(eased, { changes: [entry('a', 'goal', 90, 85)] }))[0] ?? '', /needs a change-log entry/);
  assert.match(compare(manifest(eased, { changes: [entry('a', 'goal', 70, 80)] }))[0] ?? '', /needs a change-log entry/);
  const logged = entry('a', 'goal', 90, 80);
  const base = manifest(eased, { changes: [logged] });
  assert.match(compare(manifest(list(def('a', { goal: 70 })), { changes: [logged] }), base)[0] ?? '', /a goal 80 to 70 needs/);
  assert.match(compare(manifest(eased), base)[0] ?? '', /may only be added to/);
  assert.match(compare(manifest(eased, { changes: [logged] }), manifest(list(), { changes: [logged] }))[0] ?? '', /needs a change-log entry/);
  assert.match(compareManifests('code', manifest(), null)[0] ?? '', /removed/);
});

test('a list with no signoff_comment can change freely, and its signoff_comment cannot be removed', () => {
  const { signoff_comment: _signoff, ...draft } = manifest();
  assert.deepEqual(compareManifests('code', draft, manifest(list(def('a', { goal: 10 })))), []);
  assert.deepEqual(compareManifests('code', draft, null), []);
  assert.deepEqual(compareManifests('code', draft, { ...draft, metrics: [] }), []);
  assert.match(compare(draft)[0] ?? '', /signoff_comment can't be removed/);
});

test('a change may touch any pages and the shared code, but loosen only one page', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qs-goal-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  const write = (rel: string, body: string) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), body);
  };
  const page = (m: Manifest) => write(`quality-speed/pages/${m.page}/manifest.json`, JSON.stringify(m));
  const eased = (slug: PageSlug) => ({ ...manifest(list(def('a', { goal: 80 })), { changes: [entry('a', 'goal', 90, 80)] }), page: slug });
  const tight = (slug: PageSlug) => ({ ...manifest(list(def('a', { goal: 95 }))), page: slug });
  const commit = () => {
    git('add', '.');
    git('commit', '-qm', 'x');
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q');
    page(manifest());
    page({ ...manifest(), page: 'issues' });
    const base = commit();
    // Two pages plus core/, nothing loosened.
    page(tight('code'));
    page(tight('issues'));
    write('quality-speed/core/x.ts', '// x');
    commit();
    assert.deepEqual(goalCheck(dir, base), []);
    // Two pages loosened, each with its entry.
    page(eased('code'));
    page(eased('issues'));
    commit();
    assert.match(goalCheck(dir, base).join(), /loosen one page only/);
    // One page loosened with its entry, the other tightened.
    page(tight('issues'));
    commit();
    assert.deepEqual(goalCheck(dir, base), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the check runs against real commits', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qs-goal-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  const commit = (m: Manifest) => {
    mkdirSync(path.join(dir, 'quality-speed', 'pages', m.page), { recursive: true });
    writeFileSync(path.join(dir, 'quality-speed', 'pages', m.page, 'manifest.json'), JSON.stringify(m));
    git('add', '.');
    git('commit', '-qm', 'x');
  };
  try {
    git('init', '-q');
    commit({ ...manifest(), page: 'issues' });
    commit(manifest());
    const base = git('rev-parse', 'HEAD');
    assert.deepEqual(goalCheck(dir, base), []);
    commit(manifest(list(def('a', { goal: 80 }))));
    assert.match(goalCheck(dir, base).join(), /code: a goal 90 to 80 needs/);
    assert.throws(() => goalCheck(dir, 'not-a-commit'));
    assert.throws(() => baseManifest(dir, 'not-a-commit', 'code'));
    assert.ok(baseManifest(path.join(dir, 'quality-speed'), base, 'code'), 'read from below the top of the repository');
    assert.equal(baseManifest(dir, base, 'sec'), null);
    writeFileSync(path.join(dir, 'quality-speed', 'pages', 'code', 'manifest.json'), '{');
    git('add', '.');
    git('commit', '-qm', 'unreadable');
    const unreadable = git('rev-parse', 'HEAD');
    writeFileSync(path.join(dir, 'quality-speed', 'pages', 'code', 'manifest.json'), JSON.stringify(manifest()));
    assert.throws(() => goalCheck(dir, unreadable));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a page landed on main after the branch was cut never reads as retired', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qs-goal-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  const commit = (m: Manifest) => {
    mkdirSync(path.join(dir, 'quality-speed', 'pages', m.page), { recursive: true });
    writeFileSync(path.join(dir, 'quality-speed', 'pages', m.page, 'manifest.json'), JSON.stringify(m));
    git('add', '.');
    git('commit', '-qm', 'x');
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q', '-b', 'main');
    const cut = commit(manifest());
    git('switch', '-qc', 'work');
    commit(manifest(list(def('a', { goal: 95 }))));
    git('switch', '-q', 'main');
    const landed = commit({ ...manifest(), page: 'issues' });
    git('switch', '-q', '--detach', 'main');
    git('merge', '-q', '--no-ff', '-m', 'test merge', 'work');
    // What CI checks out on a pull request, against its first parent, and against an older event base.
    assert.deepEqual(goalCheck(dir, git('rev-parse', 'HEAD^1')), []);
    assert.deepEqual(goalCheck(dir, cut), []);
    // A base newer than what's checked out, as a branch behind main would see.
    git('switch', '-q', '--detach', 'work');
    assert.deepEqual(goalCheck(dir, landed), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a pull request with no base fails, and a manual run has nothing to compare', () => {
  const run = (event: string) => execFileSync(process.execPath, [new URL('./goal-check.ts', import.meta.url).pathname], { env: { ...process.env, GOAL_CHECK_BASE: '', EVENT_NAME: event }, stdio: 'pipe' });
  assert.throws(() => run('pull_request'));
  assert.throws(() => run('merge_group'));
  assert.doesNotThrow(() => run('workflow_dispatch'));
});

test('a push or merge group checks each squashed pull request against its own parent', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qs-goal-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  const file = (page: string) => path.join(dir, 'quality-speed', 'pages', page, 'manifest.json');
  const commit = (m: Manifest) => {
    mkdirSync(path.dirname(file(m.page)), { recursive: true });
    writeFileSync(file(m.page), JSON.stringify(m));
    git('add', '.');
    git('commit', '-qm', 'x');
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q');
    commit({ ...manifest(), page: 'issues' });
    const base = commit(manifest());
    assert.deepEqual(goalCheckEach(dir, base), [], 'nothing since the base');
    // Two pull requests, one page each, both tightening.
    commit(manifest(list(def('a', { goal: 95 }))));
    commit({ ...manifest(list(def('a', { goal: 95 }))), page: 'issues' });
    assert.deepEqual(goalCheck(dir, base), []);
    assert.deepEqual(goalCheckEach(dir, base), []);
    // A loosening in any one of them still fails, named by its commit.
    const eased = commit(manifest(list(def('a', { goal: 80 }))));
    assert.deepEqual(goalCheckEach(dir, base), [`${eased.slice(0, 12)}: code: a goal 95 to 80 needs a change-log entry`]);
    // A list removed in one and put back in the next reads as unchanged together, but not one at a time.
    const restart = commit(manifest(list(def('a', { goal: 95 }))));
    unlinkSync(file('code'));
    git('commit', '-qam', 'remove');
    const removed = git('rev-parse', 'HEAD');
    commit(manifest(list(def('a', { goal: 95 }))));
    assert.deepEqual(goalCheck(dir, restart), []);
    assert.deepEqual(goalCheckEach(dir, restart), [`${removed.slice(0, 12)}: code: the list was removed, and a change log can't excuse that`]);
    assert.throws(() => goalCheckEach(dir, 'not-a-commit'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
