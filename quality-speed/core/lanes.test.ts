// SPDX-License-Identifier: Apache-2.0
// What a page may declare and which lanes a run takes. Every lanes.json on main passes here, so a bad one can't land.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isPublicLane, PAGES, PRIVATE_LANES, PUBLIC_PAGES, type PageSlug } from '../contract/pages.ts';
import { loadLanes, matrixFor, planOutputs, runsNow, touchedPages } from './lanes.ts';

const MANIFEST = readFileSync(new URL('../contract/example/manifest.json', import.meta.url), 'utf8');
const good = { id: 'github', runner: 'linux', cadence: 'daily', collector: 'collect.ts' };

/** A pages folder holding this page, with this lanes.json and an empty collector. */
function page(lanes: unknown, slug: PageSlug = 'code'): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lanes-test-'));
  mkdirSync(path.join(dir, slug));
  writeFileSync(path.join(dir, slug, 'manifest.json'), MANIFEST.replace('"code"', `"${slug}"`));
  writeFileSync(path.join(dir, slug, 'collect.ts'), '');
  writeFileSync(path.join(dir, slug, 'lanes.json'), JSON.stringify(lanes));
  return dir;
}

test('every lanes.json in the repository passes', () => {
  for (const slug of PAGES) assert.deepEqual(loadLanes(slug).errors, [], `pages/${slug}`);
});

test('a good lane reads back, with admin off unless asked for', () => {
  const dir = page([good]);
  assert.deepEqual(loadLanes('code', dir), { lanes: [{ ...good, args: [], install: false, admin: false }], errors: [] });
  rmSync(dir, { recursive: true });
});

test('anything outside the closed rules refuses the whole file', () => {
  const refused = [
    { ...good, runner: 'self-hosted' },
    { ...good, runner: 'constructor' },
    { ...good, cadence: 'hourly' },
    { ...good, id: '../up' },
    { ...good, collector: '../settings/collect.ts' },
    { ...good, collector: '../../contract/validate.ts' },
    { ...good, collector: 'folder/../../settings/collect.ts' },
    { ...good, args: ['--evil; rm -rf /'] },
    { ...good, args: 'code' },
    { ...good, install: 'yes' },
    { ...good, collector: '/etc/collect.ts' },
    { ...good, collector: 'collect.sh' },
    { ...good, collector: 'absent.ts' },
    { ...good, secret: 'X' },
    null,
  ];
  for (const lane of refused) {
    const dir = page([{ ...good, id: 'other' }, lane]);
    const { lanes, errors } = loadLanes('code', dir);
    assert.deepEqual(lanes, [], JSON.stringify(lane));
    assert.equal(errors.length > 0, true, JSON.stringify(lane));
    rmSync(dir, { recursive: true });
  }
  const repeat = page([good, good]);
  assert.deepEqual(loadLanes('code', repeat).errors, ['lanes: an id repeats']);
  rmSync(repeat, { recursive: true });
});

test('a lane can use a collector in a folder or a shared kit, with arguments and an install', () => {
  const dir = page([{ ...good, collector: 'collect.ts', args: ['employment-law'], install: true }]);
  mkdirSync(path.join(dir, 'code', 'collect'));
  writeFileSync(path.join(dir, 'code', 'collect', 'main.ts'), '');
  assert.deepEqual(loadLanes('code', dir).errors, []);
  assert.deepEqual(matrixFor('push', 3, dir).rows[0]?.install, true);
  writeFileSync(path.join(dir, 'code', 'lanes.json'), JSON.stringify([{ ...good, collector: 'collect/main.ts' }]));
  assert.deepEqual(loadLanes('code', dir).errors, []);
  rmSync(dir, { recursive: true });
});

test('a lane goes to one job by its runner, and every lane stays in the full list', () => {
  const rows = [{ runner: 'choose-runner' }, { runner: 'ubuntu-latest' }, { runner: 'macos-26' }];
  assert.deepEqual(planOutputs(rows), [
    `matrix=${JSON.stringify({ include: rows })}`,
    `blacksmith=${JSON.stringify({ include: [rows[0]] })}`,
    `hosted=${JSON.stringify({ include: [rows[1], rows[2]] })}`,
  ]);
  assert.deepEqual(planOutputs([]).slice(1), ['blacksmith={"include":[]}', 'hosted={"include":[]}']);
});

test('each runner name maps to one exact runner, and none is self-hosted', () => {
  const lanes = [
    { ...good, id: 'a' },
    { ...good, id: 'b', runner: 'linux-hosted' },
    { ...good, id: 'c', runner: 'macos', cadence: 'weekly' },
    { ...good, id: 'd', runner: 'windows', cadence: 'weekly' },
  ];
  const { rows, errors } = matrixFor('workflow_dispatch', 3, page(lanes));
  assert.deepEqual(errors, []);
  assert.deepEqual(rows.map((row) => row.runner), ['choose-runner', 'ubuntu-latest', 'macos-26', 'windows-2025']);
});

test('macOS and Windows lanes run weekly and no more often', () => {
  for (const runner of ['macos', 'windows']) {
    for (const cadence of ['daily', 'nightly']) assert.notDeepEqual(loadLanes('code', page([{ ...good, runner, cadence }])).errors, [], `${runner} ${cadence}`);
    assert.deepEqual(loadLanes('code', page([{ ...good, runner, cadence: 'weekly' }])).errors, []);
  }
});

test('only the admin-lane pages may read the admin output, of every page there is', () => {
  const admin = { ...good, runner: 'linux-hosted', admin: true };
  const allowed = PAGES.filter((slug) => loadLanes(slug, page([admin], slug)).errors.length === 0);
  assert.deepEqual(allowed.sort(), ['launch-readiness', 'projects', 'security', 'settings']);
});

test('a shared kit in core/ is the only collector outside the page folder', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lanes-test-'));
  const pagesDir = path.join(root, 'pages');
  const pageDir = path.join(pagesDir, 'code');
  mkdirSync(pageDir, { recursive: true });
  mkdirSync(path.join(root, 'core', 'law'), { recursive: true });
  mkdirSync(path.join(root, 'contract'));
  writeFileSync(path.join(root, 'core', 'law', 'collect.ts'), '');
  writeFileSync(path.join(root, 'contract', 'validate.ts'), '');
  writeFileSync(path.join(pageDir, 'manifest.json'), MANIFEST);
  const errorsFor = (collector: string) => {
    writeFileSync(path.join(pageDir, 'lanes.json'), JSON.stringify([{ ...good, collector, args: ['code'] }]));
    return loadLanes('code', pagesDir).errors;
  };
  assert.deepEqual(errorsFor('../../core/law/collect.ts'), []);
  assert.notDeepEqual(errorsFor('../../contract/validate.ts'), []);
  assert.notDeepEqual(errorsFor('../../core/../contract/validate.ts'), []);
  rmSync(root, { recursive: true });
});

test('lanes with no reviewed list are refused', () => {
  const dir = page([good]);
  rmSync(path.join(dir, 'code', 'manifest.json'));
  assert.deepEqual(loadLanes('code', dir).errors, ['lanes.json needs a valid manifest.json']);
  rmSync(dir, { recursive: true });
});

test('only the pages that need them may read the admin read-outs', () => {
  const wrong = page([{ ...good, runner: 'linux-hosted', admin: true }]);
  assert.deepEqual(loadLanes('code', wrong).errors, ['lanes[0]: this page may not read the admin read-outs']);
  rmSync(wrong, { recursive: true });
  const onBlacksmith = page([{ ...good, admin: true }], 'settings');
  assert.deepEqual(loadLanes('settings', onBlacksmith).errors, ['lanes[0]: a lane with the admin read-outs must be linux-hosted']);
  rmSync(onBlacksmith, { recursive: true });
  const right = page([{ ...good, runner: 'linux-hosted', admin: true }], 'settings');
  assert.deepEqual(loadLanes('settings', right).errors, []);
  rmSync(right, { recursive: true });
});

test('a merge takes only daily Linux lanes, because Mac minutes count 10x', () => {
  assert.equal(runsNow({ runner: 'linux', cadence: 'daily' }, 'push', 3), true);
  assert.equal(runsNow({ runner: 'linux-hosted', cadence: 'daily' }, 'push', 3), true);
  assert.equal(runsNow({ runner: 'linux', cadence: 'nightly' }, 'push', 3), false);
  assert.equal(runsNow({ runner: 'macos', cadence: 'daily' }, 'push', 3), false);
  assert.equal(runsNow({ runner: 'linux', cadence: 'weekly' }, 'push', 7), false);
});

test('the schedule takes daily and nightly lanes every day and weekly lanes on Sundays', () => {
  assert.equal(runsNow({ runner: 'macos', cadence: 'daily' }, 'schedule', 3), true);
  assert.equal(runsNow({ runner: 'linux', cadence: 'nightly' }, 'schedule', 3), true);
  assert.equal(runsNow({ runner: 'macos', cadence: 'weekly' }, 'schedule', 3), false);
  assert.equal(runsNow({ runner: 'macos', cadence: 'weekly' }, 'schedule', 7), true);
});

test('a manual run takes everything, and any other event takes nothing', () => {
  assert.equal(runsNow({ runner: 'windows', cadence: 'weekly' }, 'workflow_dispatch', 1), true);
  assert.equal(runsNow({ runner: 'linux', cadence: 'daily' }, 'pull_request', 1), false);
  assert.equal(runsNow({ runner: 'linux', cadence: 'daily' }, 'drill', 1), false);
});

test('the matrix names the real runner and leaves out a broken page', () => {
  const dir = page([good, { ...good, id: 'sync', runner: 'macos', cadence: 'weekly' }]);
  assert.deepEqual(matrixFor('schedule', 7, dir), {
    rows: [
      { slug: 'code', lane: 'github', runner: 'choose-runner', install: false, admin: false },
      { slug: 'code', lane: 'sync', runner: 'macos-26', install: false, admin: false },
    ],
    errors: [],
  });
  writeFileSync(path.join(dir, 'code', 'lanes.json'), 'not json');
  assert.deepEqual(matrixFor('schedule', 7, dir), { rows: [], errors: ['pages/code: lanes.json is not valid JSON'] });
  rmSync(dir, { recursive: true });
});

test('a merge remeasures only the pages it changed, unless it changed something they all use', () => {
  const pages = (...modified: string[]) => touchedPages({ added: [], modified, removed: [] });
  assert.deepEqual(pages('quality-speed/pages/code/collect.ts'), new Set(['code']));
  assert.deepEqual(pages('quality-speed/pages/code/a.ts', 'quality-speed/pages/issues/b.ts'), new Set(['code', 'issues']));
  assert.equal(pages('quality-speed/pages/code/a.ts', 'quality-speed/core/build.ts'), null);
  assert.equal(pages('.github/workflows/quality-speed.yml'), null);
  assert.equal(touchedPages(null), null);
  assert.equal(touchedPages({}), null);
  const dir = page([good]);
  assert.deepEqual(matrixFor('push', 3, dir, new Set(['issues'])).rows, []);
  assert.equal(matrixFor('push', 3, dir, new Set(['code'])).rows.length, 1);
  assert.equal(matrixFor('push', 3, dir, null).rows.length, 1);
  rmSync(dir, { recursive: true });
});

test('past the most the guard allows for, a Linux lane goes to GitHub-hosted', () => {
  const dir = page(Array.from({ length: 31 }, (_, i) => ({ ...good, id: `lane-${i}` })));
  const { rows } = matrixFor('schedule', 3, dir);
  assert.equal(rows.filter((row) => row.runner === 'choose-runner').length, 30);
  assert.equal(rows.at(-1)?.runner, 'ubuntu-latest');
  rmSync(dir, { recursive: true });
});

test('a private page plans no lane on any event, and a public page keeps its own', () => {
  for (const slug of ['agents', 'claude-code', 'claude-documentation', 'claude-settings', 'actions', 'ci-overview'] as const) {
    assert.equal(PUBLIC_PAGES.includes(slug), false, slug);
    const dir = page([good], slug);
    assert.deepEqual(matrixFor('workflow_dispatch', 7, dir), { rows: [], errors: [] }, slug);
    rmSync(dir, { recursive: true });
  }
  const broken = page('not a list', 'claude-code');
  assert.deepEqual(matrixFor('schedule', 7, broken).errors, ['pages/claude-code: lanes.json must be a list'], 'a private page is still checked');
  rmSync(broken, { recursive: true });
});

test('the real plan holds no private page, no private lane and no lane that takes the secret read-out', () => {
  const { rows, errors } = matrixFor('workflow_dispatch', 7);
  assert.deepEqual(errors, []);
  assert.ok(rows.length > 20);
  for (const row of rows) assert.ok(isPublicLane(row.slug, row.lane), `${row.slug}/${row.lane}`);
  assert.deepEqual(PRIVATE_LANES, ['security/keys']);
  assert.equal(rows.some((row) => row.slug === 'security' && row.lane === 'keys'), false);
  // quality-speed.yml's admin-read runs only for an admin lane outside the App's pages (.github/scripts/app_lanes.py).
  assert.deepEqual(rows.filter((row) => row.admin && !['settings', 'projects', 'github-app'].includes(row.slug)), []);
  // Fail closed: a page is public only by being named, so every page is one or the other.
  assert.equal(PUBLIC_PAGES.length, 29);
  assert.equal(PAGES.length - PUBLIC_PAGES.length, 6);
});
