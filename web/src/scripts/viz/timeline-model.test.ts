// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFilters, buildItems, buildLanes, COPY_SEP, describeEvent, directory, laneName, LITIGATION_TYPES, markFor, OTHER_LANE,
  periodSpans, uniqueItems,
} from './timeline-model.ts';
import { DOE_DATA } from './timeline-fixture.test-data.ts';

test('side lanes follow the encoding order and add a lane for events with no party', () => {
  const lanes = buildLanes(DOE_DATA, 'side');
  assert.deepEqual(lanes.map((lane) => lane.key), ['client', 'defendant', 'nominal', 'court', 'third', '_none']);
  assert.deepEqual(lanes.map((lane) => lane.side), ['client', 'defendant', 'nominal', 'court', 'third', null]);
});

test('an event goes in its lead actor lane; undated or impossible dates are skipped; order is chronological', () => {
  const lanes = buildLanes(DOE_DATA, 'side');
  const items = buildItems(DOE_DATA, lanes, 'side');
  assert.equal(items.some((item) => item.id === 'ev-bad'), false);
  assert.equal(items.length, DOE_DATA.events.length - 1);
  assert.equal(items.find((item) => item.id === 'ev-04')?.lane, 'defendant');
  assert.equal(items.find((item) => item.id === 'ev-09')?.lane, '_none');
  const starts = items.map((item) => item.span.start);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  assert.equal(items[0].id, 'ev-01', 'the 2011 year span starts first');
});

test('filings and orders wear the outline square whoever made them; others wear the lead side', () => {
  const dir = directory(DOE_DATA);
  const byId = new Map(DOE_DATA.events.map((event) => [event.id, event]));
  assert.equal(markFor(byId.get('ev-10')!, dir), 'filing'); // safe: fixture id
  assert.equal(markFor(byId.get('ev-08')!, dir), 'filing'); // safe: fixture id
  assert.equal(markFor(byId.get('ev-04')!, dir), 'defendant'); // safe: fixture id
  assert.equal(markFor(byId.get('ev-01')!, dir), 'nominal'); // safe: fixture id
  assert.equal(markFor(byId.get('ev-09')!, dir), 'filing', 'no actor falls back to the neutral outline'); // safe: fixture id
});

test('type lanes keep a fixed order and only list types present', () => {
  const lanes = buildLanes(DOE_DATA, 'type');
  assert.deepEqual(lanes.map((lane) => lane.key), ['pleading', 'filing', 'order', 'discovery', 'communication', 'meeting', 'milestone', 'custom']);
  assert.equal(lanes[0].label, 'Pleadings');
});

test('actor lanes rank by activity, fold the tail into Others, and sort by side', () => {
  const lanes = buildLanes(DOE_DATA, 'actor', 3);
  assert.deepEqual(lanes.map((lane) => lane.key), ['p-doe', 'p-roe', '_others', '_none']);
  assert.equal(lanes[0].label, 'Jane Doe');
  const items = buildItems(DOE_DATA, lanes, 'actor');
  assert.equal(items.find((item) => item.id === 'ev-05')?.lane, '_others');
  assert.equal(items.find((item) => item.id === 'ev-02')?.lane, 'p-doe');
  const roomy = buildLanes(DOE_DATA, 'actor', 10);
  assert.equal(roomy.some((lane) => lane.key === '_others'), false);
});

test('lanes do not depend on filters, so filtering never repaints or reorders', () => {
  const lanes = buildLanes(DOE_DATA, 'side');
  const items = buildItems(DOE_DATA, lanes, 'side');
  const filtered = applyFilters(items, { people: ['p-tech'] });
  assert.deepEqual(filtered.map((item) => item.id), ['ev-04', 'ev-05']);
  assert.deepEqual(filtered.map((item) => item.lane), ['defendant', 'third']);
});

test('filters combine: people, claims, types and a date range on partial spans', () => {
  const lanes = buildLanes(DOE_DATA, 'side');
  const items = buildItems(DOE_DATA, lanes, 'side');
  const ids = (filters: Parameters<typeof applyFilters>[1]) => applyFilters(items, filters).map((item) => item.id);
  assert.equal(ids({}).length, items.length);
  assert.equal(ids({ people: [], claims: [], types: [] }).length, items.length, 'empty lists do not filter');
  assert.deepEqual(ids({ claims: ['count-3'] }), ['ev-04', 'ev-07']);
  assert.deepEqual(ids({ claims: ['count-2'], people: ['p-doe'] }), ['ev-07']);
  assert.deepEqual(ids({ types: ['order', 'filing'] }), ['ev-08', 'ev-10']);
  assert.deepEqual(ids({ from: '2014-04-15', to: '2014-06' }), ['ev-09'], 'the April 2014 span overlaps a mid-April start');
  assert.deepEqual(ids({ to: '2011' }), ['ev-01', 'ev-02']);
  assert.deepEqual(ids({ from: '2014-10-17' }), ['ev-10']);
});

test('the spoken form gives prose date, precision, title, kind, parties and sources', () => {
  const lanes = buildLanes(DOE_DATA, 'side');
  const items = buildItems(DOE_DATA, lanes, 'side');
  const byId = new Map(items.map((item) => [item.id, item]));
  assert.equal(describeEvent(byId.get('ev-04')!), // safe: fixture id
    'July 9, 2012. Roe inspects the failed cooler. Meeting. Richard Roe, Pat Teller. 1 source.');
  assert.equal(describeEvent(byId.get('ev-09')!), // safe: fixture id
    'Apr. 2014 (date known to the month). Records exchange begins. Discovery. 1 source.');
  assert.equal(describeEvent(byId.get('ev-01')!).startsWith('2011 (date known to the year). Roe Commissary opens its kitchen.'), true); // safe: fixture id
});

// Violations: membership comes from each violation's events list; an event can sit in several lanes.
const WITH_VIOLATIONS = {
  ...DOE_DATA,
  violations: [
    { id: 'v-b', mark: 'B', title: 'Stock spoiled after the roof leaked', events: ['ev-04', 'ev-05'], period: { from: '2012-07', to: '2012-08' } },
    { id: 'v-a', mark: 'A', title: 'Gutter repair ran past the estimate', events: ['ev-03', 'ev-04', 'ev-gone'], period: { from: '2012', to: null } },
    { id: 'v-z', mark: 'Z', title: 'Covers no event here', events: ['ev-gone'], period: { from: 'soon', to: null } },
  ],
};

test('violation lanes come in letter order, skip a violation with no event, and end with Other', () => {
  const lanes = buildLanes(WITH_VIOLATIONS, 'violation');
  assert.deepEqual(lanes.map((lane) => lane.key), ['v-a', 'v-b', OTHER_LANE]);
  assert.deepEqual(lanes.map((lane) => lane.letter), ['A', 'B', undefined]);
  assert.deepEqual(lanes.map(laneName), ['A Gutter repair ran past the estimate', 'B Stock spoiled after the roof leaked', 'Other']);
  assert.deepEqual(buildLanes(DOE_DATA, 'violation').map((lane) => lane.key), [OTHER_LANE], 'no violations: one Other lane');
});

test('an event in two violations sits in both lanes; the first copy keeps the event id', () => {
  const lanes = buildLanes(WITH_VIOLATIONS, 'violation');
  const items = buildItems(WITH_VIOLATIONS, lanes, 'violation');
  const copies = items.filter((item) => item.event.id === 'ev-04');
  assert.deepEqual(copies.map((item) => [item.id, item.lane]), [['ev-04', 'v-a'], [`ev-04${COPY_SEP}v-b`, 'v-b']]);
  assert.equal(items.find((item) => item.id === 'ev-01')?.lane, OTHER_LANE);
  assert.equal(items.length, DOE_DATA.events.length - 1 + 1, 'one extra copy, the bad date still skipped');
  const unique = uniqueItems(items);
  assert.equal(unique.length, DOE_DATA.events.length - 1);
  assert.deepEqual(unique.filter((item) => item.event.id === 'ev-04').map((item) => item.id), ['ev-04']);
});

test('every item knows its violations in every lane mode, and the spoken form names them', () => {
  const items = buildItems(WITH_VIOLATIONS, buildLanes(WITH_VIOLATIONS, 'side'), 'side');
  const byId = new Map(items.map((item) => [item.id, item]));
  assert.deepEqual(byId.get('ev-04')?.violations, ['v-a', 'v-b']);
  assert.deepEqual(byId.get('ev-04')?.letters, ['A', 'B']);
  assert.deepEqual(byId.get('ev-01')?.letters, []);
  assert.equal(describeEvent(byId.get('ev-04')!), // safe: fixture id
    'July 9, 2012. Roe inspects the failed cooler. Meeting. Richard Roe, Pat Teller. Violations A, B. 1 source.');
  assert.match(describeEvent(byId.get('ev-05')!), /\. Violation B\. 1 source\.$/); // safe: fixture id
});

test('the violation filter keeps covered events; hideTypes drops kinds', () => {
  const items = buildItems(WITH_VIOLATIONS, buildLanes(WITH_VIOLATIONS, 'side'), 'side');
  const ids = (filters: Parameters<typeof applyFilters>[1]) => applyFilters(items, filters).map((item) => item.id);
  assert.deepEqual(ids({ violations: ['v-a'] }), ['ev-03', 'ev-04']);
  assert.deepEqual(ids({ violations: ['v-b'], people: ['p-tech'] }), ['ev-04', 'ev-05']);
  assert.deepEqual(ids({ violations: [] }).length, items.length, 'an empty list does not filter');
  assert.deepEqual(ids({ hideTypes: [...LITIGATION_TYPES] }), ['ev-01', 'ev-02', 'ev-03', 'ev-04', 'ev-05', 'ev-06', 'ev-09']);
  assert.deepEqual(ids({ hideTypes: ['communication'], violations: ['v-b'] }), ['ev-04']);
});

test('periodSpans gives each violation\'s period in letter order, open when it has no end', () => {
  const spans = periodSpans(WITH_VIOLATIONS);
  assert.deepEqual(spans.map((span) => [span.letter, span.from, span.to]), [['A', '2012', null], ['B', '2012-07', '2012-08']],
    'Z has an unreadable start and is skipped');
  assert.equal(spans[0].start, Date.UTC(2012, 0, 1));
  assert.equal(spans[0].end, null);
  assert.equal(spans[1].end, Date.UTC(2012, 8, 1), 'the end month is included');
  assert.deepEqual(periodSpans(WITH_VIOLATIONS, ['v-b']).map((span) => span.letter), ['B']);
  assert.deepEqual(periodSpans(DOE_DATA), []);
});
