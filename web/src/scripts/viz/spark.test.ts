// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparkPath } from './spark.ts';

test('the sparkline spans the box and ends on the last value', () => {
  const geo = sparkPath([1, 3, 2, 5], 100, 24);
  assert.match(geo.d, /^M4,20L/);
  assert.deepEqual(geo.end, { x: 96, y: 4 });
});

test('flat, empty and gappy series still draw sensibly', () => {
  assert.deepEqual(sparkPath([], 100, 24), { d: '', end: null });
  const flat = sparkPath([2, 2, 2], 100, 24);
  assert.equal(flat.end?.y, 12, 'a flat line sits mid-height');
  const gappy = sparkPath([1, Number.NaN, 3], 100, 24);
  assert.equal(gappy.end?.x, 96, 'x keeps the index, so a gap does not shift later points');
  assert.equal((gappy.d.match(/L/g) ?? []).length, 1);
});
