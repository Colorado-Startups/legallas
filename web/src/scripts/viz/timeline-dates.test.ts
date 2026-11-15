// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSpans, DAY_MS, isoLabel, isSpan, midpoint, overlaps, parsePartialDate, proseDate } from './timeline-dates.ts';

test('a year, a month and a day each resolve to the span they cover', () => {
  assert.deepEqual(parsePartialDate('2023'), {
    start: Date.UTC(2023, 0, 1), end: Date.UTC(2024, 0, 1), precision: 'year',
  });
  assert.deepEqual(parsePartialDate('2023-10'), {
    start: Date.UTC(2023, 9, 1), end: Date.UTC(2023, 10, 1), precision: 'month',
  });
  assert.deepEqual(parsePartialDate('2023-12'), {
    start: Date.UTC(2023, 11, 1), end: Date.UTC(2024, 0, 1), precision: 'month',
  });
  assert.deepEqual(parsePartialDate('2023-10-17'), {
    start: Date.UTC(2023, 9, 17), end: Date.UTC(2023, 9, 17) + DAY_MS, precision: 'day',
  });
});

test('dates that are not on the calendar are refused, not rolled over', () => {
  for (const bad of ['2023-02-30', '2023-13', '2023-00', '2023-04-31', '2023-10-00', '23-10-11', '2023/10/11', '', 'soon', '2023-1-5']) {
    assert.equal(parsePartialDate(bad), null, bad);
  }
  assert.ok(parsePartialDate('2024-02-29'), 'leap day');
  assert.equal(parsePartialDate('2023-02-29'), null, 'not a leap year');
});

test('only month and year dates are drawn as bands; the mark sits at the middle', () => {
  const month = parsePartialDate('2023-10')!; // safe: literal
  const day = parsePartialDate('2023-10-17')!; // safe: literal
  assert.equal(isSpan(month), true);
  assert.equal(isSpan(day), false);
  assert.equal(midpoint(day), day.start + DAY_MS / 2);
  assert.ok(midpoint(month) > Date.UTC(2023, 9, 15) && midpoint(month) < Date.UTC(2023, 9, 17));
});

test('date order puts the wider span first when two start together', () => {
  const year = parsePartialDate('2023')!; // safe: literal
  const month = parsePartialDate('2023-01')!; // safe: literal
  const day = parsePartialDate('2023-01-01')!; // safe: literal
  const sorted = [day, month, year].sort(compareSpans);
  assert.deepEqual(sorted.map((span) => span.precision), ['year', 'month', 'day']);
});

test('overlap is half-open: a span ending at an instant does not overlap a range starting there', () => {
  const month = parsePartialDate('2023-10')!; // safe: literal
  assert.equal(overlaps(month, { start: Date.UTC(2023, 10, 1), end: Infinity }), false);
  assert.equal(overlaps(month, { start: Date.UTC(2023, 9, 31), end: Infinity }), true);
  assert.equal(overlaps(month, { start: -Infinity, end: Date.UTC(2023, 9, 1) }), false);
});

test('labels: ISO for axes and tables, the voice guide for prose', () => {
  const ms = Date.UTC(2023, 9, 17);
  assert.equal(isoLabel(ms, 'year'), '2023');
  assert.equal(isoLabel(ms, 'month'), '2023-10');
  assert.equal(isoLabel(ms, 'day'), '2023-10-17');
  assert.equal(proseDate(parsePartialDate('2023-10-17')!), 'Oct. 17, 2023'); // safe: literal
  assert.equal(proseDate(parsePartialDate('2023-09')!), 'Sept. 2023'); // safe: literal
  assert.equal(proseDate(parsePartialDate('2023-06-02')!), 'June 2, 2023'); // safe: literal
  assert.equal(proseDate(parsePartialDate('2023')!), '2023'); // safe: literal
});
