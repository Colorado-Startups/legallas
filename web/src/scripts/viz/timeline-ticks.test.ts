// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from './timeline-dates.ts';
import { chooseTicks, LABEL_ROOM, tickLabelFits } from './timeline-ticks.ts';

const start = Date.UTC(2019, 0, 1);

test('a wide window over years shows years; narrowing it walks down to months, weeks and days', () => {
  assert.equal(chooseTicks(start, Date.UTC(2024, 0, 1), 400).name, 'year');
  assert.equal(chooseTicks(start, Date.UTC(2024, 0, 1), 1000).name, 'half');
  assert.equal(chooseTicks(start, Date.UTC(2020, 0, 1), 1000).name, 'month');
  assert.equal(chooseTicks(start, start + 60 * DAY_MS, 1000).name, 'week');
  assert.equal(chooseTicks(start, start + 9 * DAY_MS, 1000).name, 'day');
});

test('a narrow screen coarsens the same window', () => {
  assert.equal(chooseTicks(start, Date.UTC(2020, 0, 1), 1000).name, 'month');
  assert.equal(chooseTicks(start, Date.UTC(2020, 0, 1), 340).name, 'quarter');
  assert.equal(chooseTicks(start, Date.UTC(2029, 0, 1), 340).name, '2 years');
});

test('labels are ISO at the chosen precision and land on calendar boundaries', () => {
  const months = chooseTicks(start, Date.UTC(2019, 11, 31), 1000);
  assert.equal(months.ticks[0].label, '2019-01');
  assert.equal(months.ticks[1].value, Date.UTC(2019, 1, 1));
  assert.equal(months.ticks.length, 12);
  const days = chooseTicks(start, start + 5 * DAY_MS, 1000);
  assert.equal(days.ticks[2].label, '2019-01-03');
  const years = chooseTicks(start, Date.UTC(2023, 5, 1), 400);
  assert.deepEqual(years.ticks.map((tick) => tick.label), ['2019', '2020', '2021', '2022', '2023']);
});

test('the chosen labels fit side by side at the given width', () => {
  for (const width of [320, 390, 768, 1024, 1440]) {
    for (const days of [5, 40, 200, 800, 4000, 12000]) {
      const choice = chooseTicks(start, start + days * DAY_MS, width);
      if (choice.name === '25 years') continue;
      assert.ok(choice.ticks.length * LABEL_ROOM[choice.precision] <= width + LABEL_ROOM[choice.precision] * 2,
        `${days} days at ${width}px chose ${choice.name} with ${choice.ticks.length} ticks`);
    }
  }
});

test('a tick label that would clip at the right edge does not fit', () => {
  assert.equal(tickLabelFits(100, '2024-01', 400), true);
  assert.equal(tickLabelFits(370, '2024-01', 400), false);
});
