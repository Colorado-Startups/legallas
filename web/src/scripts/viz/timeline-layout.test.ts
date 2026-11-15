// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTimeline, METRICS, PERIOD_STRIP, PERIOD_TAG, placePeriods } from './timeline-layout.ts';
import { buildItems, buildLanes, type PeriodSpan } from './timeline-model.ts';
import { fullExtent } from './timeline-zoom.ts';
import { DOE_DATA } from './timeline-fixture.test-data.ts';

const lanes = buildLanes(DOE_DATA, 'side');
const items = buildItems(DOE_DATA, lanes, 'side');
const domain = fullExtent(items.map((item) => item.span))!; // safe: fixture has events

test('lanes stack without gaps and every mark sits inside its lane and the plot', () => {
  const layout = layoutTimeline(lanes, items, domain, 1200, 'full');
  assert.equal(layout.lanes.length, lanes.length);
  for (let i = 1; i < layout.lanes.length; i++) {
    assert.equal(layout.lanes[i].y, layout.lanes[i - 1].y + layout.lanes[i - 1].height);
  }
  assert.equal(layout.marks.length, items.length);
  for (const mark of layout.marks) {
    const lane = layout.lanes[mark.lane];
    assert.ok(mark.cy - mark.size / 2 >= lane.y && mark.cy + mark.size / 2 <= lane.y + lane.height, mark.id);
    assert.ok(mark.cx >= layout.plotX0 - 0.5 && mark.cx <= layout.plotX1 + 0.5, mark.id);
  }
  assert.ok(layout.height >= layout.bottom);
});

test('month and year dates become bands with the mark in the middle; day dates are points', () => {
  const layout = layoutTimeline(lanes, items, domain, 1200, 'full');
  const year = layout.marks.find((mark) => mark.id === 'ev-01')!; // safe: fixture id
  const day = layout.marks.find((mark) => mark.id === 'ev-04')!; // safe: fixture id
  const in2014 = layoutTimeline(lanes, items, { start: Date.UTC(2014, 0, 1), end: Date.UTC(2015, 0, 1) }, 1200, 'full');
  const month = in2014.marks.find((mark) => mark.id === 'ev-09')!; // safe: fixture id
  assert.ok(year.band && year.band.x1 - year.band.x0 > 100, 'a year is wide at this scale');
  assert.ok(month.band && month.band.x1 > month.band.x0);
  assert.equal(month.cx, (month.band!.x0 + month.band!.x1) / 2); // safe: asserted above
  assert.equal(day.band, null);
});

test('a month too narrow at this zoom to show its band is drawn as a plain mark at the month middle', () => {
  const layout = layoutTimeline(lanes, items, domain, 300, 'full');
  const month = layout.marks.find((mark) => mark.id === 'ev-09')!; // safe: fixture id
  assert.equal(month.band, null);
  const year2014 = { start: Date.UTC(2014, 0, 1), end: Date.UTC(2015, 0, 1) };
  const wide = layoutTimeline(lanes, items, year2014, 1200, 'full').marks.find((mark) => mark.id === 'ev-09')!; // safe: fixture id
  assert.ok(wide.band, 'zoomed to the year, the month band shows');
});

test('marks that would collide in a lane move to separate rows', () => {
  const layout = layoutTimeline(lanes, items, domain, 900, 'full');
  const marks = layout.marks;
  for (let i = 0; i < marks.length; i++) {
    for (let j = i + 1; j < marks.length; j++) {
      if (marks[i].lane !== marks[j].lane || marks[i].cy !== marks[j].cy) continue;
      assert.ok(Math.abs(marks[i].cx - marks[j].cx) >= marks[i].size, `${marks[i].id} and ${marks[j].id} overlap`);
    }
  }
});

test('narrow screens move lane labels off the side column', () => {
  const wide = layoutTimeline(lanes, items, domain, 1200, 'full');
  const narrow = layoutTimeline(lanes, items, domain, 390, 'full');
  assert.equal(wide.sideLabels, true);
  assert.equal(narrow.sideLabels, false);
  assert.ok(narrow.plotX0 < wide.plotX0);
  assert.ok(narrow.lanes[0].height >= METRICS.full.laneHead + METRICS.full.rowH);
});

test('the ribbon is one row a lane, no titles, axis below', () => {
  const ribbon = layoutTimeline(lanes, items, domain, 800, 'ribbon');
  assert.ok(ribbon.lanes.every((lane) => lane.rows === 1));
  assert.ok(ribbon.marks.every((mark) => mark.label === ''));
  assert.equal(ribbon.axisY, ribbon.bottom);
  assert.ok(ribbon.height < layoutTimeline(lanes, items, domain, 800, 'full').height);
});

test('zooming in drops marks outside the window and clips a band that crosses its edge', () => {
  const window = { start: Date.UTC(2012, 6, 1), end: Date.UTC(2012, 7, 1) };
  const layout = layoutTimeline(lanes, items, window, 1200, 'full');
  assert.deepEqual(layout.marks.map((mark) => mark.id).sort(), ['ev-04', 'ev-05', 'ev-06']);
  assert.ok(layout.ticks.every((tick) => tick.value >= window.start && tick.value <= window.end));
  assert.ok(layout.ticks.every((tick) => tick.x >= layout.plotX0 && tick.x <= layout.plotX1));
  const edge = layoutTimeline(lanes, items, { start: Date.UTC(2011, 6, 1), end: Date.UTC(2012, 6, 1) }, 1200, 'full');
  const year = edge.marks.find((mark) => mark.id === 'ev-01')!; // safe: 2011 overlaps the window
  assert.equal(year.band?.x0, edge.plotX0, 'the 2011 band starts at the plot edge');
  assert.ok(year.cx > edge.plotX0 && year.cx < year.band!.x1, 'its mark sits in the visible part'); // safe: asserted above
});

test('an axis label that would run off the right edge is dropped, its tick kept', () => {
  const layout = layoutTimeline(lanes, items, domain, 1200, 'full');
  for (const tick of layout.ticks) {
    if (tick.label) assert.ok(tick.x + 4 + tick.label.length * 7.2 <= layout.width, tick.label);
  }
});

test('titles show where they fit, cut with an ellipsis where they do not', () => {
  const layout = layoutTimeline(lanes, items, domain, 1400, 'full');
  const labelled = layout.marks.filter((mark) => mark.label !== '');
  assert.ok(labelled.length > 0);
  for (const mark of labelled) {
    assert.ok(mark.item.event.title.startsWith(mark.label.replace(/…$/, '')), mark.id);
  }
});

// Violation periods: a strip above the lanes holds the letters; the fields clip to the window.
const PERIODS: PeriodSpan[] = [
  { key: 'v-a', letter: 'A', title: 'A', from: '2012', to: null, start: Date.UTC(2012, 0, 1), end: null },
  { key: 'v-b', letter: 'B', title: 'B', from: '2012-01', to: '2013-06', start: Date.UTC(2012, 0, 1), end: Date.UTC(2013, 6, 1) },
  { key: 'v-c', letter: 'C', title: 'C', from: '2030', to: null, start: Date.UTC(2030, 0, 1), end: null },
];

test('periods add a strip above the lanes, clip to the plot and keep their tags apart', () => {
  const plain = layoutTimeline(lanes, items, domain, 1200, 'full');
  const layout = layoutTimeline(lanes, items, domain, 1200, 'full', PERIODS);
  assert.equal(layout.top, plain.top + PERIOD_STRIP);
  assert.equal(layout.periodTop, plain.top);
  assert.equal(plain.periodTop, plain.top);
  assert.equal(layout.axisY, plain.axisY, 'the axis stays on top; the strip sits between it and the lanes');
  const ribbon = layoutTimeline(lanes, items, domain, 1200, 'ribbon', PERIODS);
  assert.equal(ribbon.periodTop, 0);
  assert.equal(ribbon.axisY, ribbon.bottom, 'the ribbon keeps its axis below');
  assert.deepEqual(layout.periods.map((period) => period.letter), ['A', 'B'], 'C starts after the window');
  const [a, b] = layout.periods;
  assert.equal(a.x1, layout.plotX1, 'an open period runs to the plot end');
  assert.ok(b.x1 < layout.plotX1 && b.x1 > b.x0);
  assert.ok(a.edge && b.edge);
  assert.ok(b.tagX >= a.tagX + PERIOD_TAG, 'two periods starting together do not stack their letters');
});

test('a period that began before the window starts at the plot edge with no start rule', () => {
  const late = { start: Date.UTC(2014, 0, 1), end: domain.end };
  const [a] = placePeriods(PERIODS.slice(0, 1), late, (ms) => (ms - late.start) / 1e9, 10, 500);
  assert.deepEqual([a.x0, a.x1, a.edge, a.tagX], [10, 500, false, 10]);
  const end = placePeriods([{ ...PERIODS[2], start: late.end - 1 }], late, () => 499.9, 10, 500)[0];
  assert.equal(end.tagX, 500 - PERIOD_TAG, 'a tag at the far right stays inside the plot');
});
