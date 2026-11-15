// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { EXPECTED_LINUX_SKIPS, WINDOWS_RUN_FILES, readJunit, testFlags, testGlobs } from './measure-web.ts';

test('the test globs are read from the npm test script', () => {
  const pkg = JSON.stringify({ scripts: { test: 'node --test "worker/**/*.test.ts" "mcp/**/*.test.ts"' } });
  assert.deepEqual(testGlobs(pkg), ['worker/**/*.test.ts', 'mcp/**/*.test.ts']);
  assert.throws(() => testGlobs(JSON.stringify({ scripts: { test: 'vitest' } })), /not `node --test/);
  const runner = JSON.stringify({ scripts: { test: 'node scripts/run-tests.ts --test-concurrency=4 $NODE_TEST_FLAGS "worker/**/*.test.ts"' } });
  assert.deepEqual([testGlobs(runner), testFlags(runner)], [['worker/**/*.test.ts'], ['--test-concurrency=4']]);
});

test('the runner flags are read from the npm test script, and its reporters are not', () => {
  const pkg = JSON.stringify({ scripts: { test: 'node --test --test-concurrency=3 --test-reporter=spec $NODE_TEST_FLAGS "worker/**/*.test.ts"' } });
  assert.deepEqual(testFlags(pkg), ['--test-concurrency=3']);
  assert.deepEqual(testFlags(JSON.stringify({ scripts: { test: 'node --test "worker/**/*.test.ts"' } })), []);
  const web = readFileSync(path.join(import.meta.dirname, '../../../../web/package.json'), 'utf8');
  assert.ok(testFlags(web).some((flag) => flag.startsWith('--test-concurrency=')), 'web/package.json sets a concurrency for this run to copy');
});

test('JUnit cases are counted even when a name holds a bare >, and skips beyond the allowance are failures', () => {
  const xml = [
    '<testsuites>',
    '<testcase name="a -> b" time="0.1" classname="test" file="/w/web/worker/a.test.ts"/>',
    '<testcase name="fails" time="0.1" classname="test" file="/w/web/worker/a.test.ts"><failure message="x"/></testcase>',
    '<testcase name="skip one" time="0" classname="test" file="/w/web/scripts/b.test.ts"><skipped type="skipped" message="macOS only"/></testcase>',
    '<testcase name="skip two" time="0" classname="test" file="/w/web/scripts/b.test.ts"><skipped type="todo" message="later"/></testcase>',
    '</testsuites>',
  ].join('\n');
  const r = readJunit(xml, '/w/web', { 'scripts/b.test.ts': 1, 'worker/a.test.ts': 5 });
  assert.equal(r.tests, 4);
  assert.equal(r.failures, 1);
  assert.equal(r.skips, 2);
  assert.equal(r.unexpectedSkips, 1);
  assert.deepEqual(r.skipsByFile, { 'scripts/b.test.ts': 2 });
});

test('every Windows-only allowance is a file the Windows CI job runs', () => {
  const ci = readFileSync(path.join(import.meta.dirname, '../../../../.github/workflows/ci.yml'), 'utf8');
  const run = /runs-on: windows-latest[\s\S]*?run: (node --test [^\n]+)/.exec(ci)?.[1] ?? '';
  for (const file of WINDOWS_RUN_FILES) {
    assert.ok(EXPECTED_LINUX_SKIPS[file], `${file} has no allowance`);
    assert.ok(run.split(' ').includes(file), `ci.yml's Windows job does not run ${file}`);
  }
});
