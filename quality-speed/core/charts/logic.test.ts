// SPDX-License-Identifier: Apache-2.0
// The pure helpers in charts.js: the math a ring and a toggle share.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { builtRow, compareCells, replayRow, roadState, shareLoad, totalOf, wholeScore } from './charts.js';

test('shareLoad: a fast first drag makes one request, and every caller gets its result', async () => {
  let calls = 0;
  const rows = shareLoad(async () => {
    calls += 1;
    return ['row'];
  });
  const results = await Promise.all([rows(), rows(), rows()]);
  assert.equal(calls, 1);
  assert.deepEqual(results, [['row'], ['row'], ['row']]);
  await rows();
  assert.equal(calls, 1, 'a later drag reuses the loaded rows');
});

test('shareLoad: a failed load is not kept, so the next call tries again', async () => {
  let calls = 0;
  const rows = shareLoad(async () => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
    return ['row'];
  });
  const failures = await Promise.allSettled([rows(), rows()]);
  assert.deepEqual(failures.map((f) => f.status), ['rejected', 'rejected']);
  assert.equal(calls, 1, 'callers during the failed load share it');
  assert.deepEqual(await rows(), ['row']);
  assert.equal(calls, 2);
});

test('totalOf: all at goal is exactly 100, and it rounds down', () => {
  assert.equal(totalOf(100, 100, 100), 100);
  assert.equal(totalOf(0, 0, 0), 0);
  assert.equal(totalOf(99.9, 99.9, 99.9), 99);
  assert.equal(totalOf(72, 58, 71), 67);
  assert.equal(totalOf(100, 100), 66, 'a page with no Consumption reads 0 there, as in core/score.ts');
  assert.equal(totalOf(90, 30, Number.NaN), 40, 'a Consumption that is not a number counts as 0');
});

test('totalOf: a floating point sum just under a whole number still reads whole', () => {
  // 0.1 + 0.2 style drift: three thirds of a score must not lose a point.
  assert.equal(totalOf(100 - 1e-13, 100, 100), 100);
  assert.equal(totalOf(33.333333333333336, 33.33333333333333, 33.33333333333333), 33);
});

test('totalOf and wholeScore: 100 only at goal, as in core/score.ts', () => {
  assert.equal(totalOf(99.9999999, 100, 100), 99, 'rounds to 100 but is not at goal');
  assert.equal(totalOf(100, 100, 99.9999999), 99, 'Consumption a hair short is not at goal either');
  assert.equal(wholeScore(99.9999999), 99);
  assert.equal(wholeScore(100), 100);
  assert.equal(wholeScore(76.9999999), 77, 'below 100, rounding to 6 decimals still counts');
});

test('roadState: with no fix on, it is the real score, not a recalculation', () => {
  const real = { q: 76, s: 78, c: 76, total: 77 };
  assert.equal(totalOf(real.q, real.s, real.c), 76, 'recalculating from whole numbers would lose a point');
  assert.deepEqual(roadState(real, [{ id: 'a', q: 5, s: 5, c: 5 }], []), real);
  assert.deepEqual(roadState(real, [{ id: 'a', q: 5, s: 5, c: 5 }], ['unknown']), real);
});

test('roadState: a missing score stays missing, whatever is ticked', () => {
  const fixes = [{ id: 'a', q: 5, s: 5 }];
  for (const base of [{ q: null, s: null, total: null }, { q: 40, s: null, total: null }, { q: 40, s: 30, total: null }]) {
    assert.deepEqual(roadState(base, fixes, ['a']), base);
    assert.deepEqual(roadState(base, fixes, []), base);
  }
});

test('roadState: toggles add up, and clamp at 100', () => {
  const fixes = [{ id: 'a', q: 10, s: 0 }, { id: 'b', q: 0, s: 30 }, { id: 'c', q: 80, s: 80, c: 80 }];
  const base = { q: 40, s: 40, c: 40, total: 40 };
  assert.equal(roadState(base, fixes, ['a']).q, 50);
  assert.equal(roadState(base, fixes, ['a', 'b']).s, 70);
  assert.equal(roadState(base, fixes, ['a', 'b']).c, 40, 'fixes with no Consumption part leave it where it was');
  assert.equal(roadState(base, fixes, ['a', 'b', 'c']).c, 100);
  assert.equal(roadState(base, fixes, ['a', 'b', 'c']).total, 100);
  assert.equal(roadState(base, fixes, ['a', 'b', 'c']).q, 100);
});

test('roadState: adding many decimal fixes still reaches exactly 100', () => {
  assert.equal(roadState({ q: 38, s: 55.2, c: 60.3, total: 51 }, [{ id: 'a', q: 62, s: 44.8, c: 39.7 }], ['a']).total, 100);
  const parts = Array.from({ length: 10 }, (_, i) => ({ id: String(i), q: 0.1, s: 0.1, c: 0.1 }));
  assert.equal(roadState({ q: 99, s: 99, c: 99, total: 99 }, parts, parts.map((p) => p.id)).total, 100);
});

test('replayRow: every ring moves, and a ring with no score that day reads as missing', () => {
  const scored = fakeRing('scored', 95);
  const unscored = fakeRing('unscored', 95);
  replayRow([scored, unscored], { rings: { scored: { q: 40, s: 10, total: 30 } } });
  assert.equal(scored.parts.get('[data-num="total"]')?.textContent, 30);
  assert.equal(scored.parts.get('[data-arc="q"]')?.dash, '40 100');
  assert.equal(scored.classes.has('is-missing'), false);
  assert.equal(unscored.parts.get('[data-num="total"]')?.textContent, 0, 'it must not keep reading 95');
  assert.equal(unscored.parts.get('[data-arc="q"]')?.dash, '0 100');
  assert.equal(unscored.classes.has('is-missing'), true);
  assert.match(String(unscored.parts.get('svg')?.label), /no data/);
  replayRow([unscored], { rings: { unscored: { q: 50, s: 50, total: 50 } } });
  assert.equal(unscored.classes.has('is-missing'), false, 'a later day with a score clears it');
});

test('replayRow: a score with any part that is not a number reads as missing, never blank', () => {
  for (const score of [{ q: 40, s: 10, total: null }, { q: null, s: 80, total: 53 }, { q: null, s: null, total: null }]) {
    const fig = fakeRing('a', 95);
    replayRow([fig], { rings: { a: score } });
    assert.equal(fig.parts.get('[data-num="total"]')?.textContent, 0, JSON.stringify(score));
    assert.equal(fig.classes.has('is-missing'), true);
    assert.match(String(fig.parts.get('svg')?.label), /no data/);
  }
});

test('builtRow: the newest position gives back what the page was built with', () => {
  const never = fakeRing('never', 70);
  const brokenAtBuild = fakeRing('broken', 0);
  brokenAtBuild.classes.add('is-missing');
  const built = builtRow([never, brokenAtBuild]);
  replayRow([never, brokenAtBuild], { rings: {} });
  assert.equal(never.parts.get('[data-num="total"]')?.textContent, 0, 'not in that row, so it reads missing');
  replayRow([never, brokenAtBuild], built);
  assert.equal(never.parts.get('[data-num="total"]')?.textContent, 70, 'back on the newest position it must not stay red');
  assert.equal(never.classes.has('is-missing'), false);
  assert.equal(never.parts.get('[data-arc="q"]')?.dash, '70 100');
  assert.equal(brokenAtBuild.classes.has('is-missing'), true, 'a ring built as missing stays missing');
});

test('replayRow and builtRow: a third ring moves with Consumption, and a day from before it reads 0 there', () => {
  const three = fakeRing('three', 80, true);
  const two = fakeRing('two', 80);
  replayRow([three, two], { rings: { three: { q: 40, s: 10, c: 70, total: 30 }, two: { q: 40, s: 10, c: 70, total: 30 } } });
  assert.equal(three.parts.get('[data-arc="c"]')?.dash, '70 100');
  assert.equal(three.parts.get('[data-num="c"]')?.textContent, 70);
  assert.match(String(three.parts.get('svg')?.label), /Speed 10\. Consumption 70\./);
  assert.doesNotMatch(String(two.parts.get('svg')?.label), /Consumption/, 'a two-ring chart never speaks a third lens');
  assert.deepEqual(builtRow([three, two]).rings, { three: { q: 40, s: 10, c: 70, total: 30 }, two: { q: 40, s: 10, total: 30 } });
  replayRow([three], { rings: { three: { q: 40, s: 10, total: 30 } } });
  assert.equal(three.parts.get('[data-arc="c"]')?.dash, '0 100', 'an older line with no consumption reads 0, never the last number');
  replayRow([three], { rings: { three: { q: 40, s: 10, c: null as never, total: 30 } } });
  assert.equal(three.parts.get('[data-arc="c"]')?.dash, '0 100');
  assert.equal(three.classes.has('is-missing'), false, 'quality, speed and total still read');
});

test('compareCells: numbers as numbers, blanks last either way', () => {
  assert.ok(compareCells('9', '10', true, 'ascending') < 0);
  assert.ok(compareCells('9', '10', false, 'ascending') > 0, 'text compares as text');
  assert.ok(compareCells('9', '10', true, 'descending') > 0);
  assert.ok(compareCells('', '10', true, 'ascending') > 0);
  assert.ok(compareCells('', '10', true, 'descending') > 0);
  assert.equal(compareCells('', '', true, 'ascending'), 0);
});

test('the kit stays small enough for the 100 KB first view', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const css = gzipSync(readFileSync(join(here, 'charts.css'))).length;
  const js = gzipSync(readFileSync(join(here, 'charts.js'))).length;
  assert.ok(css + js < 10_000, `css ${css} + js ${js} bytes, gzipped`);
});

/** The few parts of a ring that replaying touches. The real page is checked in CI screenshots. */
function fakeRing(id: string, total: number, third = false) {
  type Part = { textContent?: unknown; dash?: string; label?: string; setAttribute: (name: string, value: string) => void; getAttribute: () => string | undefined };
  const parts = new Map<string, Part>();
  const lenses = third ? ['q', 's', 'c'] : ['q', 's'];
  for (const selector of [...lenses.flatMap((k) => [`[data-arc="${k}"]`, `[data-num="${k}"]`]), '[data-num="total"]', 'svg']) {
    const part: Part = {
      setAttribute(name, value) {
        if (name === 'stroke-dasharray') part.dash = value;
        if (name === 'aria-label') part.label = value;
      },
      getAttribute: () => part.dash,
    };
    parts.set(selector, part);
  }
  parts.get('[data-num="total"]')!.textContent = total;
  for (const k of lenses) parts.get(`[data-arc="${k}"]`)!.dash = `${total} 100`;
  const classes = new Set<string>();
  return {
    parts,
    classes,
    dataset: { qsRing: id },
    querySelector: (selector: string) => parts.get(selector),
    classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)), contains: (name: string) => classes.has(name) },
  };
}
