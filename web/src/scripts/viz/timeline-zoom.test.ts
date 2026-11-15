// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from './timeline-dates.ts';
import {
  brushGrip, clampDomain, dragBrush, ensureVisible, fullExtent, MIN_SPAN, msToPx, panDomain, pxToMs, zoomDomain,
} from './timeline-zoom.ts';

const extent = { start: 0, end: 1000 * DAY_MS };

test('the full extent pads the data, and a single day still gets a month of room', () => {
  assert.equal(fullExtent([]), null);
  const wide = fullExtent([{ start: 0, end: 100 * DAY_MS }])!; // safe: non-empty input
  assert.equal(wide.start, -3 * DAY_MS);
  assert.equal(wide.end, 103 * DAY_MS);
  const one = fullExtent([{ start: 0, end: DAY_MS }])!; // safe: non-empty input
  assert.ok(one.end - one.start >= 30 * DAY_MS);
});

test('zooming in halves the window and keeps the anchor at the same screen position', () => {
  const domain = { start: 200 * DAY_MS, end: 600 * DAY_MS };
  const at = 300 * DAY_MS;
  const zoomed = zoomDomain(domain, 2, at, extent);
  assert.equal(zoomed.end - zoomed.start, 200 * DAY_MS);
  const before = (at - domain.start) / (domain.end - domain.start);
  const after = (at - zoomed.start) / (zoomed.end - zoomed.start);
  assert.ok(Math.abs(before - after) < 1e-9);
});

test('zoom stops at a week in and at the full extent out, and never leaves the extent', () => {
  let domain = { ...extent };
  for (let i = 0; i < 20; i++) domain = zoomDomain(domain, 2, 999 * DAY_MS, extent);
  assert.equal(domain.end - domain.start, MIN_SPAN);
  assert.ok(domain.end <= extent.end && domain.start >= extent.start);
  for (let i = 0; i < 20; i++) domain = zoomDomain(domain, 0.5, 10 * DAY_MS, extent);
  assert.deepEqual(domain, extent);
});

test('an extent narrower than a week is shown whole', () => {
  const small = { start: 0, end: 3 * DAY_MS };
  assert.deepEqual(clampDomain({ start: 1, end: 2 }, small), small);
});

test('panning stops at the edges without changing the width', () => {
  const domain = { start: 100 * DAY_MS, end: 200 * DAY_MS };
  assert.deepEqual(panDomain(domain, -500 * DAY_MS, extent), { start: 0, end: 100 * DAY_MS });
  assert.deepEqual(panDomain(domain, 5000 * DAY_MS, extent), { start: 900 * DAY_MS, end: 1000 * DAY_MS });
});

test('ensureVisible leaves a visible item alone and pans the least to show a hidden one', () => {
  const domain = { start: 100 * DAY_MS, end: 200 * DAY_MS };
  const inside = { start: 150 * DAY_MS, end: 151 * DAY_MS };
  assert.equal(ensureVisible(domain, inside, extent), domain);
  const later = ensureVisible(domain, { start: 300 * DAY_MS, end: 301 * DAY_MS }, extent);
  assert.equal(later.end - later.start, 100 * DAY_MS);
  assert.ok(later.end >= 301 * DAY_MS && later.end - 301 * DAY_MS < 10 * DAY_MS);
  const earlier = ensureVisible(domain, { start: 20 * DAY_MS, end: 21 * DAY_MS }, extent);
  assert.ok(earlier.start <= 20 * DAY_MS && 20 * DAY_MS - earlier.start < 10 * DAY_MS);
});

test('pixels and time map both ways', () => {
  const domain = { start: 0, end: 100 };
  assert.equal(msToPx(25, domain, 100, 500), 200);
  assert.equal(pxToMs(200, domain, 100, 500), 25);
});

test('the brush: edges resize, the inside moves, the track draws a new window', () => {
  const windowPx = { x0: 100, x1: 200 };
  assert.equal(brushGrip(96, windowPx), 'start');
  assert.equal(brushGrip(205, windowPx), 'end');
  assert.equal(brushGrip(150, windowPx), 'move');
  assert.equal(brushGrip(20, windowPx), 'new');
  assert.equal(brushGrip(150, windowPx, true), 'new', 'a window showing everything cannot move, so a press draws');
  assert.equal(brushGrip(96, windowPx, true), 'start', 'its edges still resize');
  const start = { start: 100 * DAY_MS, end: 200 * DAY_MS };
  assert.deepEqual(dragBrush('move', start, 150 * DAY_MS, 170 * DAY_MS, extent), { start: 120 * DAY_MS, end: 220 * DAY_MS });
  assert.deepEqual(dragBrush('end', start, 200 * DAY_MS, 400 * DAY_MS, extent), { start: 100 * DAY_MS, end: 400 * DAY_MS });
  assert.deepEqual(dragBrush('start', start, 100 * DAY_MS, 50 * DAY_MS, extent), { start: 50 * DAY_MS, end: 200 * DAY_MS });
  assert.deepEqual(dragBrush('new', start, 600 * DAY_MS, 500 * DAY_MS, extent), { start: 500 * DAY_MS, end: 600 * DAY_MS });
  const tiny = dragBrush('new', start, 600 * DAY_MS, 601 * DAY_MS, extent);
  assert.equal(tiny.end - tiny.start, MIN_SPAN, 'a click on the track gives the narrowest window, not a sliver');
});
