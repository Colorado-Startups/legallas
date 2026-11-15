// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { childCpuSeconds, fileTimes, flaky, percent, percentile } from './stats.ts';

test('percentile is nearest rank, and null with no values', () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([5, 1, 3, 2, 4], 95), 5);
  assert.equal(percentile([], 50), null);
});

test('a test is flaky only when it both passed and failed', () => {
  const runs = [
    [{ key: 'a', passed: true }, { key: 'b', passed: false }, { key: 'c', passed: true }],
    [{ key: 'a', passed: false }, { key: 'b', passed: false }, { key: 'c', passed: true }],
  ];
  assert.deepEqual(flaky(runs), ['a']);
});

test('percent never divides by zero', () => {
  assert.equal(percent(1, 3), 33.3);
  assert.equal(percent(0, 0), null);
});

test('child CPU reads cutime and cstime, even when the name holds spaces and parentheses', () => {
  // Fields 3 to 17 of proc(5): cutime 1500 and cstime 300 ticks, at 100 a second.
  const stat = '4242 (node (lab) x) S 1 4242 4242 0 -1 4194560 900 0 0 0 250 40 1500 300 20 0 11 0 99 0';
  assert.equal(childCpuSeconds(stat, 100), 18);
  assert.equal(childCpuSeconds('no name here', 100), null);
  assert.equal(childCpuSeconds('1 (x) S 1', 100), null);
});

test("a file's time is its summary, or in a shared process the sum of its top-level tests", () => {
  const lines = [
    { file: 'alone.ts', name: '0:a', passed: true, ms: 1 },
    { file: 'alone.ts', ms: 900 },
    { file: 'shared.ts', name: '0:b', passed: true, ms: 300 },
    { file: 'shared.ts', name: '1:b inner', passed: true, ms: 250 },
    { file: 'shared.ts', name: '0:c', passed: false, ms: 700 },
  ];
  assert.deepEqual(fileTimes(lines), [{ file: 'shared.ts', ms: 1000 }, { file: 'alone.ts', ms: 900 }]);
});
