// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FIRST, parse, part, plan, pool } from './run-tests.ts';

const reader = (files: Record<string, string>) => (f: string) => files[f] ?? null;
// As npm test starts it. Under node --test, NODE_TEST_CONTEXT makes every nested run report to its parent, not to a reporter.
const outsideTests = { ...process.env };
delete outsideTests.NODE_TEST_CONTEXT;

test('a file that changes what other files see runs alone; one that only reads, or calls a CLI, shares', () => {
  const files: Record<string, string> = {
    'a.test.ts': `test('x', () => { globalThis.fetch = () => undefined; });`,
    'b.test.ts': `test('x', (t) => { t.mock.method(console, 'error'); });`,
    'c.test.ts': `import { mock, test } from 'node:test';\ntest('x', () => {});`,
    'd.test.ts': `beforeEach(() => {});\ntest('x', () => {});`,
    'e.test.ts': `describe('x', () => {\n  beforeEach(() => {});\n});`,
    'f.test.ts': `test('x', () => { process.on('exit', () => {}); });`,
    'g.test.ts': `import { quiet } from './helper.ts';\ntest('x', () => quiet());`,
    'helper.ts': `export function quiet() { console.log = () => undefined; }`,
    'h.test.ts': `import { main } from './cli.ts';\nconst LOCAL: Intl.DateTimeFormatOptions = {};\ntest('x', () => fetch);`,
    'cli.ts': `if (import.meta.main) process.exitCode = 1;`,
    'i.test.ts': `test('x', (t) => { t.mock.timers.enable(); });`,
    // The forms CI's first shared run met (#926): a cast, an alias, Object.assign.
    'j.test.ts': `test('x', () => { (globalThis as Record<string, unknown>).ROOM_TOOL_PREFIX = 'acme_'; });`,
    'k.test.ts': `test('x', () => { const g = globalThis as { window?: unknown };\n  g.window = {}; });`,
    'l.test.ts': `Object.assign(globalThis, { a: 1 });`,
  };
  const alone = Object.keys(files).filter((f) => f.endsWith('.test.ts') && pool(f, reader(files)) === null);
  assert.deepEqual(alone, ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts', 'f.test.ts', 'g.test.ts', 'i.test.ts', 'j.test.ts', 'k.test.ts', 'l.test.ts']);
  assert.equal(pool('h.test.ts', reader(files)), '', 'shares with every file that loads no registry');
});

test('a file that loads a registry when imported, at any depth, shares only with files that load the same ones', () => {
  const files: Record<string, string> = {
    'pro.ts': `import { extendMcp } from './extensions.ts';\nextendMcp({ pages: [] });`,
    'extensions.ts': `export function extendMcp() {}`,
    'route.ts': `import './pro.ts';\nexport const route = 1;`,
    'a.test.ts': `import { route } from './route.ts';\ntest('x', () => route);`,
    'b.test.ts': `import {\n  route,\n} from './route.ts';`,
    'c.test.ts': `import type { route } from './route.ts';\nimport { extendMcp } from './extensions.ts';`,
    'd.test.ts': `test('x', async () => { await import('./route.ts'); });`,
  };
  assert.deepEqual(['a', 'b', 'c', 'd'].map((f) => pool(`${f}.test.ts`, reader(files))), ['pro.ts', 'pro.ts', '', null]);
});

test('the slowest files start first, then the shared processes of neighbouring files, a pool at a time, then the files that run alone', () => {
  const files = ['z/b.test.ts', 'z/a.test.ts', 'y/c.test.ts', 'lone.test.ts', ...FIRST, 'x/d.test.ts', 'x/e.test.ts', 'w/pro.test.ts'];
  const jobs = plan(files, (f) => (f === 'lone.test.ts' ? null : f === 'w/pro.test.ts' ? 'pro.ts' : ''), 2);
  assert.deepEqual(jobs, [
    ...FIRST.map((f) => ({ files: [f], alone: true })),
    { files: ['x/d.test.ts', 'x/e.test.ts'], alone: false },
    { files: ['y/c.test.ts', 'z/a.test.ts', 'z/b.test.ts'], alone: false },
    { files: ['w/pro.test.ts'], alone: false },
    { files: ['lone.test.ts'], alone: true },
  ]);
  assert.deepEqual(plan(['a.test.ts'], () => '', 8), [{ files: ['a.test.ts'], alone: false }], 'never more processes than files');
});

test('the flags: concurrency is processes at once, reporters keep their order, the rest go to every process', () => {
  const args = parse(['--test-reporter=spec', '--test-reporter', 'r.ts', '--test-reporter-destination=stdout', '--test-reporter-destination', 'out.ndjson', '--test-concurrency=3', '--test-name-pattern=x', '$NODE_TEST_FLAGS', 'w/**/*.test.ts']);
  assert.equal(args.concurrency, 3);
  assert.deepEqual([args.reporters, args.destinations, args.flags, args.globs], [['spec', 'r.ts'], ['stdout', 'out.ndjson'], ['--test-name-pattern=x'], ['$NODE_TEST_FLAGS', 'w/**/*.test.ts']]);
  assert.deepEqual([part('stdout', 2), part('out.ndjson', 2)], ['stdout', 'out.ndjson.2']);
});

test('a run: every file reports to the one destination, and a failure in a shared process fails it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'run-tests-'));
  try {
    writeFileSync(path.join(dir, 'a.test.mjs'), `import { test } from 'node:test';\ntest('a', () => {});\n`);
    writeFileSync(path.join(dir, 'b.test.mjs'), `import { test } from 'node:test';\ntest('b', () => { throw new Error('no'); });\n`);
    writeFileSync(path.join(dir, 'c.test.mjs'), `import { test } from 'node:test';\ntest('c', () => { globalThis.c = 1; });\n`);
    const run = spawnSync(process.execPath, [path.join(import.meta.dirname, 'run-tests.ts'), '--test-concurrency=2', '--test-reporter=tap', '--test-reporter-destination=out.tap', '*.test.mjs'], { cwd: dir, encoding: 'utf8', env: outsideTests });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /3 files in 3 processes \(1 alone, 2 shared\), 1 failed/);
    const tap = readFileSync(path.join(dir, 'out.tap'), 'utf8');
    assert.deepEqual(['ok 1 - a', 'not ok 1 - b', 'ok 1 - c'].map((line) => tap.indexOf(line) >= 0), [true, true, true], tap);
    assert.ok(tap.indexOf('ok 1 - a') < tap.indexOf('not ok 1 - b') && tap.indexOf('not ok 1 - b') < tap.indexOf('ok 1 - c'), 'joined in the order the processes started');
    assert.equal(existsSync(path.join(dir, 'out.tap.0')), false, 'the parts are removed once joined');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
