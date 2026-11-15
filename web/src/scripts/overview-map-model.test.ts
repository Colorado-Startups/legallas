// SPDX-License-Identifier: Apache-2.0
// The Overview campaign map's pure helpers: card order and links, the proof meter, the mini picture chosen from
// the data, the period bands and the violations' own events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServedMatter } from '../../worker/matter-types.ts';
import {
  capBar, meterLabel, structureOrgs, miniPicture, objectiveCards, orderedTracks, partialBound, phaseBands, proofMeter, scaleYears, trackHref,
  trackViolations, violationEventIds, yearScale,
} from './overview-map-model.ts';

type Violation = ServedMatter['violations'][number];
type Track = ServedMatter['tracks'][number];

const cite = { doc: 'd-1', page: 1, control: 1 };
const proof = (strength: 'direct' | 'corroborating' | 'circumstantial' | 'gap') => ({ cite, strength, note: null });

function violation(id: string, mark: string, extra: Partial<Violation> = {}): Violation {
  return {
    id, mark, title: `Violation ${mark}`, summary: 'One sentence.', period: { from: '2011-03', to: '2012-06' },
    actors: [], entities: [], events: [], money: [], steps: [], figures: [], cites: [], ...extra,
  };
}

function track(id: string, kind: Track['kind'], violations: string[], extra: Partial<Track> = {}): Track {
  return { id, kind, title: `Track ${id}`, forum: 'A forum', against: [], violations, points: [], ...extra };
}

const capsA = violation('v-a', 'A', {
  figures: [{ id: 'f-1', label: 'Days of notice', value: 2, unit: 'count', limit: 10, note: null, cites: [] }],
  events: ['ev-1', 'ev-2'],
  money: ['m-2'],
});
const saleC = violation('v-c', 'C', {
  period: { from: '2012-01-01', to: null },
  entities: ['o-1', 'o-2'],
  steps: [
    { id: 's-1', date: '2012-01-01', label: 'Purchase agreement signed', entities: ['o-1'], moves: [], cites: [] },
    { id: 's-2', date: '2013-08', label: 'Equipment line sold', entities: ['o-2'], moves: [{ from: 'o-2', to: 'o-1', label: 'sold to the buyer' }], cites: [] },
  ],
  events: ['ev-2', 'ev-3'],
  money: ['m-1'],
});

test('tracks: complaint first, links to its page or its regulator tab', () => {
  const tracks = [track('t-wages', 'regulator', []), track('t-court', 'complaint', [])];
  assert.deepEqual(orderedTracks(tracks).map((t) => t.id), ['t-court', 't-wages']);
  assert.equal(trackHref(tracks[1]!), '/complaint/');
  assert.equal(trackHref({ id: 't one&x', kind: 'regulator' }), '/regulator/?track=t%20one%26x');
  assert.deepEqual(trackViolations(track('t', 'regulator', ['v-c', 'v-missing', 'v-a']), [capsA, saleC]).map((v) => v.mark), ['C', 'A']);
});

test('the proof meter counts direct and corroborating proof as secured, never circumstantial or a gap', () => {
  const meter = proofMeter([
    { proof: [proof('direct')] },
    { proof: [proof('circumstantial'), proof('corroborating')] },
    { proof: [proof('circumstantial')] },
    { proof: [proof('gap')] },
    { proof: [] },
  ]);
  assert.deepEqual(meter, { pips: ['direct', 'corroborating', 'circumstantial', 'gap', 'gap'], secured: 2, total: 5 });
  assert.equal(meterLabel(meter), 'Proof secured 2 of 5');
  assert.equal(meterLabel(proofMeter([])), 'No points to prove yet');
});

test('the mini picture comes from the data: complaint structure, then limits, then a move, else structure', () => {
  assert.deepEqual(miniPicture({ kind: 'complaint' }, [saleC, capsA]), { kind: 'structure', entities: ['o-1', 'o-2'] });
  const caps = miniPicture({ kind: 'regulator' }, [capsA, saleC]);
  assert.equal(caps.kind, 'caps');
  assert.deepEqual(caps.kind === 'caps' && caps.figures.map((f) => f.id), ['f-1']);
  const move = miniPicture({ kind: 'regulator' }, [saleC]);
  assert.equal(move.kind === 'move' && move.step.id, 's-2', 'the first step with a move, not the first step');
  assert.deepEqual(miniPicture({ kind: 'regulator' }, [violation('v-x', 'X', { entities: ['o-9'] })]), { kind: 'structure', entities: ['o-9'] });
});

test('a cap bar puts a figure and its limit on the figure’s own scale', () => {
  assert.deepEqual(capBar({ value: 46, limit: 100 }), { fill: 0.46, limit: 1 });
  assert.deepEqual(capBar({ value: 120, limit: 100 }), { fill: 1, limit: 100 / 120 });
  assert.deepEqual(capBar({ value: 0, limit: 0 }), { fill: 0, limit: 0 });
});

test('objective cards name the parties from the record and skip unknown ids', () => {
  const matter = {
    tracks: [
      track('t-wages', 'regulator', ['v-a'], { against: ['p-roe', 'p-nobody'], points: [{ id: 'pt-1', violation: 'v-a', text: 'A point.', authority: null, proof: [proof('direct')] }] }),
      track('t-court', 'complaint', ['v-c'], { against: ['o-1'] }),
    ],
    violations: [capsA, saleC],
    people: [{ id: 'p-roe', name: 'Richard Roe', side: 'defendant' }],
    orgs: [{ id: 'o-1', name: 'Harbor Labs, Inc.', side: 'defendant' }],
  } as unknown as ServedMatter;
  const cards = objectiveCards(matter);
  assert.deepEqual(cards.map((c) => [c.id, c.href]), [
    ['t-court', '/complaint/'],
    ['t-wages', '/regulator/?track=t-wages'],
  ]);
  assert.deepEqual(cards[1]!.against.map((p) => p.name), ['Richard Roe']);
  assert.deepEqual(cards[1]!.meter, { pips: ['direct'], secured: 1, total: 1 });
  assert.equal(cards[0]!.picture.kind, 'structure');
});

test('violations name their own events; nothing else is kept', () => {
  assert.deepEqual([...violationEventIds([capsA, saleC])].sort(), ['ev-1', 'ev-2', 'ev-3']);
});

test('partial dates bound their whole period', () => {
  assert.equal(partialBound('2013', 'start'), Date.UTC(2013, 0, 1));
  assert.equal(partialBound('2013', 'end'), Date.UTC(2014, 0, 1) - 1);
  assert.equal(partialBound('2012-02', 'end'), Date.UTC(2012, 2, 1) - 1);
  assert.equal(partialBound('2012-02-10', 'end'), Date.UTC(2012, 1, 11) - 1);
  assert.equal(partialBound('soon', 'start'), null);
});

test('the year scale runs from the first violation to the latest end, event or today when one is still running', () => {
  const now = new Date(Date.UTC(2014, 9, 6));
  assert.deepEqual(yearScale([capsA, saleC], ['2011-05-01'], now), { first: 2011, last: 2014 });
  assert.deepEqual(yearScale([capsA], ['2013-01'], now), { first: 2011, last: 2013 });
  assert.equal(yearScale([], [], now), null);
  assert.deepEqual(scaleYears({ first: 2011, last: 2014 }), [2011, 2012, 2013, 2014]);
});

test('phase bands sit on the scale in mark order; a running violation reaches the end', () => {
  const bands = phaseBands([saleC, capsA], { first: 2011, last: 2014 });
  assert.deepEqual(bands.map((b) => b.mark), ['A', 'C']);
  const [a, c] = bands;
  const span = Date.UTC(2015, 0, 1) - Date.UTC(2011, 0, 1);
  assert.ok(Math.abs(a!.start - (Date.UTC(2011, 2, 1) - Date.UTC(2011, 0, 1)) / span) < 1e-9);
  assert.ok(a!.end > a!.start && a!.end < 0.5);
  assert.equal(c!.end, 1);
  assert.equal(c!.to, null);
  assert.deepEqual(phaseBands([violation('v-z', 'Z', { period: { from: 'later', to: null } })], { first: 2011, last: 2014 }), []);
});

test('a structure thumbnail draws the named entities and their owners, nothing else', () => {
  const orgs = [
    { id: 'o-top', parent: null }, { id: 'o-mid', parent: 'o-top' }, { id: 'o-leaf', parent: 'o-mid' },
    { id: 'o-other', parent: 'o-top' }, { id: 'o-loop', parent: 'o-loop' }, { id: 'o-orphan', parent: 'o-gone' },
  ];
  assert.deepEqual(structureOrgs(orgs, ['o-leaf']).map((o) => o.id), ['o-top', 'o-mid', 'o-leaf']);
  assert.deepEqual(structureOrgs(orgs, ['o-loop', 'o-orphan', 'o-missing']).map((o) => o.id), ['o-loop', 'o-orphan']);
  assert.deepEqual(structureOrgs(orgs, []), []);
});
