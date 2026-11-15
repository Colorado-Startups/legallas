// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveFocus, type NavPoint } from './timeline-nav.ts';

// Three lanes; lane 1 is empty, so Up and Down skip it.
const points: NavPoint[] = [
  { id: 'a', lane: 0, t: 10 },
  { id: 'b', lane: 2, t: 12 },
  { id: 'c', lane: 0, t: 30 },
  { id: 'd', lane: 3, t: 31 },
  { id: 'e', lane: 2, t: 50 },
];

test('Left and Right step through the record in date order and stop at the ends', () => {
  assert.equal(moveFocus(points, 'a', 'ArrowRight'), 'b');
  assert.equal(moveFocus(points, 'b', 'ArrowRight'), 'c');
  assert.equal(moveFocus(points, 'e', 'ArrowRight'), 'e');
  assert.equal(moveFocus(points, 'c', 'ArrowLeft'), 'b');
  assert.equal(moveFocus(points, 'a', 'ArrowLeft'), 'a');
});

test('Up and Down go to the nearest event in time in the next lane that has one', () => {
  assert.equal(moveFocus(points, 'c', 'ArrowDown'), 'b', 'lane 1 is empty; lane 2 nearest to t=30 is b (12) not e (50)');
  assert.equal(moveFocus(points, 'e', 'ArrowUp'), 'c');
  assert.equal(moveFocus(points, 'e', 'ArrowDown'), 'd');
  assert.equal(moveFocus(points, 'd', 'ArrowDown'), 'd', 'bottom lane stays put');
  assert.equal(moveFocus(points, 'a', 'ArrowUp'), 'a', 'top lane stays put');
});

test('Home and End; any key starts at the beginning when nothing is focused; empty gives null', () => {
  assert.equal(moveFocus(points, 'c', 'Home'), 'a');
  assert.equal(moveFocus(points, 'c', 'End'), 'e');
  assert.equal(moveFocus(points, null, 'ArrowRight'), 'a');
  assert.equal(moveFocus(points, 'gone', 'ArrowDown'), 'a', 'a filtered-out id restarts at the first');
  assert.equal(moveFocus(points, null, 'End'), 'e');
  assert.equal(moveFocus([], null, 'Home'), null);
});
