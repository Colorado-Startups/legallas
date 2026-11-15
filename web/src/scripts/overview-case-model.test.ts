// SPDX-License-Identifier: Apache-2.0
// Card P1b. The Overview case picture's pure helpers: heading counts and strongest proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ServedMatter } from '../../worker/matter-types.ts';
import {
  capitalize, caseHeading, eventsSummary, plural, strongestProof,
} from './overview-case-model.ts';

const fixture = JSON.parse(readFileSync(new URL('../../fixtures/matter.example.json', import.meta.url), 'utf8')) as ServedMatter;
const cite = (page: number) => ({ doc: 'd-1', page, control: 1 });

test('plural writes counts the way the page reads', () => {
  assert.equal(plural(1, 'event'), '1 event');
  assert.equal(plural(41, 'event'), '41 events');
  assert.equal(plural(0, 'gap'), '0 gaps');
  assert.equal(plural(12, 'person', 'people'), '12 people');
});

test('strongestProof picks the strongest ring and treats no proof as a gap', () => {
  const p = (strength: 'direct' | 'corroborating' | 'circumstantial' | 'gap', page: number) => ({ cite: cite(page), strength, note: null });
  assert.equal(strongestProof({ proof: [p('circumstantial', 1), p('direct', 2), p('corroborating', 3)] }).proof?.cite.page, 2);
  assert.equal(strongestProof({ proof: [p('circumstantial', 1), p('corroborating', 3)] }).strength, 'corroborating');
  assert.equal(strongestProof({ proof: [p('gap', 4), p('circumstantial', 5)] }).strength, 'circumstantial', 'a gap entry never beats real proof');
  const gap = strongestProof({ proof: [p('gap', 4)] });
  assert.equal(gap.strength, 'gap');
  assert.equal(gap.proof?.cite.page, 4, 'the gap keeps its cite for the label');
  assert.deepEqual(strongestProof({ proof: [] }), { strength: 'gap', proof: null });
});

test('eventsSummary gives the count and the month range in prose', () => {
  assert.equal(eventsSummary([{ date: '2013-10-17' }, { date: '2011-03' }, { date: '2014-09-02' }]), '3 events, Mar. 2011 to Sept. 2014');
  assert.equal(eventsSummary([{ date: '2012-06-05' }, { date: '2012-06-26' }]), '2 events, June 2012');
  assert.equal(eventsSummary([{ date: '2012' }]), '1 event, 2012');
  assert.equal(eventsSummary([]), '0 events');
});

test('capitalize opens a sentence with the name', () => {
  assert.equal(capitalize('the Company'), 'The Company');
});

test('the heading leads with the current complaint and names the regulator filings', () => {
  const court = ['District Court', 'Case No. CV-2013-00317'];
  assert.deepEqual(caseHeading(fixture, court), {
    caption: fixture.tracks.find((t) => t.kind === 'complaint')!.title,
    line: ['Current complaint', 'One regulator filing'],
  });
  // The fixture has one regulator track: a second, in data of this test's own, makes the plural.
  const two = { ...fixture, tracks: [...fixture.tracks, { ...fixture.tracks[1]!, id: 'track-second' }] };
  assert.deepEqual(caseHeading(two, court).line, ['Current complaint', 'Two regulator filings']);
  const none = { ...fixture, tracks: [] };
  assert.deepEqual(caseHeading(none, court), { caption: fixture.meta.caption, line: court }, 'no tracks keeps the closed caption');
});
