// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridNext, heatGrid, levelOf, levelRanges, monthCounts } from './heatmap.ts';

test('partial dates count by month; year-only and bad dates are kept apart', () => {
  const c = monthCounts(['2023-10-17', '2023-10', '2023-01-02', '2022', 'Oct 2023', null, undefined, '2023-13-01']);
  assert.deepEqual([...c.months], [['2023-10', 2], ['2023-01', 1]]);
  assert.deepEqual([...c.yearOnly], [['2022', 1]]);
  assert.equal(c.undated, 4);
});

test('levels split the busiest month into four steps, and every count lands in exactly one range', () => {
  assert.equal(levelOf(0, 10), 0);
  assert.equal(levelOf(1, 10), 1);
  assert.equal(levelOf(3, 10), 2);
  assert.equal(levelOf(10, 10), 4);
  for (const max of [1, 2, 3, 7, 40]) {
    const ranges = levelRanges(max);
    for (let n = 1; n <= max; n += 1) {
      const hits = ranges.filter((r) => n >= r.lo && n <= r.hi);
      assert.equal(hits.length, 1, `max ${max}, n ${n}`);
      assert.equal(hits[0].level, levelOf(n, max), `max ${max}, n ${n}`);
    }
  }
});

test('the grid runs every month from the first year to the last', () => {
  const grid = heatGrid(new Map([['2021-03', 2], ['2023-12', 5]]));
  assert.deepEqual(grid.years, ['2021', '2022', '2023']);
  assert.equal(grid.cells.length, 36);
  assert.equal(grid.max, 5);
  assert.deepEqual(grid.cells[2], { month: '2021-03', count: 2, level: 2, row: 0, col: 2 });
  assert.deepEqual(heatGrid(new Map()), { years: [], cells: [], max: 0 });
});

test('arrows move between months that have documents', () => {
  const grid = heatGrid(new Map([['2021-03', 1], ['2021-09', 1], ['2022-08', 1], ['2023-02', 1]]));
  const at = (m: string) => grid.cells.findIndex((c) => c.month === m);
  assert.equal(gridNext(grid.cells, at('2021-03'), 'ArrowRight'), at('2021-09'));
  assert.equal(gridNext(grid.cells, at('2021-09'), 'ArrowRight'), at('2022-08'), 'Right wraps into the next year');
  assert.equal(gridNext(grid.cells, at('2021-03'), 'ArrowLeft'), -1);
  assert.equal(gridNext(grid.cells, at('2021-09'), 'ArrowDown'), at('2022-08'), 'nearest column in the next year');
  assert.equal(gridNext(grid.cells, at('2022-08'), 'ArrowUp'), at('2021-09'));
  assert.equal(gridNext(grid.cells, at('2023-02'), 'ArrowDown'), -1);
  assert.equal(gridNext(grid.cells, at('2023-02'), 'Enter'), -1);
});
