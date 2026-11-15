// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertStackable, BAR_MAX, barMax, barPath, layoutBars, type BarData } from './bar.ts';

const years: BarData = {
  categories: [{ id: '2012', label: '2012' }, { id: '2013', label: '2013' }, { id: '2014', label: '2014' }],
  series: [{ id: 'in', label: 'Invoiced', side: 'client' }, { id: 'out', label: 'Paid', side: 'defendant' }],
  values: [[100_000_00, 0], [50_000_00, 25_000_00], [0, 0]],
};

test('the largest bar end is the stack total when stacked, the single value otherwise', () => {
  assert.equal(barMax(years, true), 100_000_00);
  assert.equal(barMax({ ...years, values: [[60, 70]] }, true), 130);
  assert.equal(barMax({ ...years, values: [[60, 70]] }, false), 70);
  assert.equal(barMax({ ...years, values: [[-5, Number.NaN]] }, true), 0, 'negatives and NaN draw as nothing');
});

test('only the data end is rounded; the baseline stays square', () => {
  const right = barPath({ x: 0, y: 0, w: 100, h: 20 }, 'right');
  assert.match(right, /^M0 0H96A4 4 0 0 1 100 4/);
  assert.match(right, /H0Z$/, 'the baseline edge is a straight line');
  const top = barPath({ x: 10, y: 0, w: 20, h: 50 }, 'top');
  assert.match(top, /^M10 50V4A4 4 0 0 1 14 0/);
  assert.equal(barPath({ x: 0, y: 0, w: 4, h: 2 }, 'right').includes('A1 1'), true, 'radius shrinks to fit a short bar');
  assert.equal(barPath({ x: 0, y: 0, w: 10, h: 10 }, 'none'), 'M0 0H10V10H0Z');
});

test('horizontal stacked bars: capped thickness, a 2px gap inside the stack, totals at the tip', () => {
  const layout = layoutBars(years, { width: 600, orientation: 'horizontal', stacked: true, kind: 'usd' });
  assert.equal(layout.rects.length, 3, 'zero segments are not drawn');
  for (const r of layout.rects) assert.ok(r.hit.h >= 24, 'the hit area is at least 24px');
  const [a, b] = layout.rects.filter((r) => r.cat === 1);
  assert.ok(!a.d.includes('A'), 'the inner segment has square ends');
  assert.ok(b.d.includes('A'), 'the outer segment carries the rounded end');
  const innerEnd = Number(/H([\d.]+)/.exec(a.d)?.[1]);
  const outerStart = Number(/^M([\d.]+)/.exec(b.d)?.[1]);
  assert.ok(Math.abs(outerStart - innerEnd - 2) < 0.01, 'a 2px surface gap between segments');
  assert.equal(layout.totals.length, 2, 'no total for an empty category');
  assert.equal(layout.totals[0].text, '$100K');
  assert.ok(layout.plot.x + layout.plot.w <= 600);
  assert.equal(layout.ticks[0].value, 0);
});

test('grouped vertical bars sit side by side, each no thicker than 24px', () => {
  const layout = layoutBars(years, { width: 320, orientation: 'vertical', stacked: false, kind: 'usd', height: 200 });
  const pair = layout.rects.filter((r) => r.cat === 1);
  assert.equal(pair.length, 2);
  for (const r of pair) {
    const xs = [...r.d.matchAll(/[MH]([\d.]+)/g)].map((m) => Number(m[1]));
    assert.ok(Math.max(...xs) - Math.min(...xs) <= BAR_MAX + 0.01);
  }
  assert.ok(pair[0].hit.x < pair[1].hit.x);
  assert.equal(layout.totals.length, 0, 'grouped bars label nothing; the axis and tooltip carry values');
  assert.equal(layout.height, 18 + 200 + 24);
});

test('a single series is one color and labels every bar end', () => {
  const one: BarData = { categories: years.categories, series: [{ id: 'n', label: 'Documents' }], values: [[3], [9], [1]] };
  const layout = layoutBars(one, { width: 400, orientation: 'horizontal', stacked: false, kind: 'count' });
  assert.equal(layout.rects.length, 3);
  assert.deepEqual(layout.totals.map((t) => t.text), ['3', '9', '1']);
});

test('a stack never adds promises to movements; grouped bars may sit side by side', () => {
  const mixed: BarData = { ...years, series: [{ id: 'c', label: 'Orders', series: 'promises' }, { id: 'p', label: 'Payments', series: 'movements' }] };
  assert.throws(() => assertStackable(mixed, true), /cannot add promises to movements/);
  assert.throws(() => layoutBars(mixed, { width: 400, orientation: 'horizontal', stacked: true, kind: 'usd' }), /promises/);
  assert.doesNotThrow(() => layoutBars(mixed, { width: 400, orientation: 'horizontal', stacked: false, kind: 'usd' }));
  const sameSeries: BarData = { ...years, series: years.series.map((s) => ({ ...s, series: 'movements' as const })) };
  assert.doesNotThrow(() => assertStackable(sameSeries, true));
});
