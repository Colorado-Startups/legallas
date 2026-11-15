// SPDX-License-Identifier: Apache-2.0
// Track pages: the pure helpers behind /complaint/ and /regulator/ (track-model.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServedMatter } from '../../worker/matter-types.ts';
import {
  capChart, capX, isSecured, meterLabel, niceCeil, pickTrack, pointsFor, proofMeter, stepDate, stepKey, controlInputs,
  tracksOfKind, violationsOf, type Track, type TrackMatter, type TrackViolation,
} from './track-model.ts';

const cite = (page: number) => ({ doc: 'd-1', page, control: 1 });
const proof = (strength: 'direct' | 'corroborating' | 'circumstantial' | 'gap', page = 1) => ({ cite: cite(page), strength, note: null });

const violation = (id: string, mark: string, extra: Partial<TrackViolation> = {}): TrackViolation => ({
  id, mark, title: `Violation ${mark}`, summary: 'One sentence.', period: { from: '2012', to: null },
  actors: [], entities: [], events: [], money: [], steps: [], figures: [], cites: [], ...extra,
});

const base: ServedMatter = {
  version: 1,
  meta: { caption: 'Doe v. Roe', court: 'Court', caseNumber: null, division: null, judge: null, filed: null, operativePleading: null, definedTerms: [], builtAt: '2026-10-01T00:00:00Z' },
  events: [
    { id: 'ev-1', date: '2012-02-01', title: 'Doe delivers the first spring order', summary: null, type: 'filing', actors: [], claims: [], cites: [cite(2)] },
    { id: 'ev-2', date: '2012-03-01', title: 'Roe emails a change to the menu', summary: null, type: 'communication', actors: [], claims: [], cites: [] },
    { id: 'ev-3', date: '2011-01-01', title: 'Unrelated order', summary: null, type: 'order', actors: [], claims: [], cites: [] },
  ],
  people: [{ id: 'p-roe', name: 'Richard Roe', role: 'defendant', side: 'defendant', title: 'Owner', orgs: [], cites: [cite(4)] }],
  orgs: [
    { id: 'o-top', name: 'Harbor Labs, Inc.', kind: 'company', side: 'defendant', parent: null, cites: [], formed: null },
    { id: 'o-mid', name: 'Roe Commissary, LLC', kind: 'company', side: 'defendant', parent: 'o-top', cites: [cite(5)], formed: null },
    { id: 'o-leaf', name: 'Roe Commissary Cooler, LLC', kind: 'company', side: 'nominal', parent: 'o-mid', cites: [], formed: null },
    { id: 'o-other', name: 'Copperline Restaurant Group, Inc.', kind: 'company', side: 'client', parent: null, cites: [], formed: null },
  ],
  links: [], claims: [], money: [], docs: {}, tracks: [], violations: [],
};

const track = (id: string, kind: Track['kind'], violations: string[] = ['v-a']): Track => ({
  id, kind, title: `Track ${id}`, forum: 'Forum', against: ['p-roe', 'missing'], violations,
  points: [
    { id: 'pt-1', violation: 'v-a', text: 'Harbor Labs signed the supply agreement.', authority: null, proof: [proof('direct')] },
    { id: 'pt-2', violation: 'v-a', text: 'Harbor Labs cancelled the supply agreement.', authority: 'Example Rev. Stat. 5-1-501', proof: [proof('circumstantial')] },
    { id: 'pt-3', violation: 'v-b', text: 'Not proven yet.', authority: null, proof: [] },
  ],
});

test('tracksOfKind and pickTrack choose the page tracks and the linked tab', () => {
  const matter: TrackMatter = { ...base, tracks: [track('t-1', 'complaint'), track('t-2', 'regulator'), track('t-3', 'regulator')] };
  assert.deepEqual(tracksOfKind(matter, 'regulator').map((t) => t.id), ['t-2', 't-3']);
  assert.deepEqual(tracksOfKind(base, 'complaint'), [], 'a manifest built before tracks has none');
  assert.deepEqual(tracksOfKind({ ...base, tracks: undefined } as unknown as TrackMatter, 'complaint'), [], 'nor does one served without the key');
  const regs = tracksOfKind(matter, 'regulator');
  assert.equal(pickTrack(regs, 't-3')?.id, 't-3');
  assert.equal(pickTrack(regs, 'nope')?.id, 't-2', 'an unknown id falls back to the first');
  assert.equal(pickTrack(regs, null)?.id, 't-2');
  assert.equal(pickTrack([], 't-2'), null);
});

test('violationsOf keeps the track order and skips unknown ids; pointsFor filters by violation', () => {
  const matter: TrackMatter = { ...base, violations: [violation('v-a', 'A'), violation('v-b', 'B')] };
  const t = track('t', 'complaint', ['v-b', 'v-x', 'v-a']);
  assert.deepEqual(violationsOf(t, matter).map((v) => v.mark), ['B', 'A']);
  assert.deepEqual(violationsOf(t, base), []);
  assert.deepEqual(pointsFor(t, 'v-a').map((p) => p.id), ['pt-1', 'pt-2']);
});

test('proofMeter counts direct and corroborating proof as secured, never circumstantial or a gap', () => {
  assert.equal(isSecured('direct'), true);
  assert.equal(isSecured('corroborating'), true);
  assert.equal(isSecured('circumstantial'), false);
  assert.equal(isSecured('gap'), false);
  const meter = proofMeter([
    { proof: [proof('circumstantial'), proof('corroborating')] },
    { proof: [proof('circumstantial')] },
    { proof: [] },
    { proof: [proof('gap'), proof('direct')] },
  ]);
  assert.deepEqual(meter, { secured: 2, total: 4, pips: ['corroborating', 'circumstantial', 'gap', 'direct'] });
  assert.equal(meterLabel(meter), 'Proof secured 2 of 4');
  assert.equal(meterLabel(proofMeter([])), 'No points listed yet.');
});

test('stepKey moves along the stepper and stops at the ends', () => {
  assert.equal(stepKey('ArrowRight', 0, 3), 1);
  assert.equal(stepKey('ArrowRight', 2, 3), 2);
  assert.equal(stepKey('ArrowLeft', 0, 3), 0);
  assert.equal(stepKey('ArrowLeft', 2, 3), 1);
  assert.equal(stepKey('Home', 2, 3), 0);
  assert.equal(stepKey('End', 0, 3), 2);
  assert.equal(stepKey('Enter', 1, 3), null);
  assert.equal(stepKey('ArrowRight', 0, 0), null);
  assert.equal(stepDate({ date: '2012-01-01' }), '2012-01-01');
  assert.equal(stepDate({ date: '2012-03' }), '2012-03');
  assert.equal(stepDate({ date: 'soon' }), '');
});

test('capChart draws each figure against its own limit and never adds figures together', () => {
  assert.equal(capChart([]), null);
  const figure = (id: string, value: number, limit: number | null, unit: 'usd' | 'count' = 'count') => ({ id, label: id, value, unit, limit, note: null, cites: [cite(3)] });
  assert.equal(capChart([figure('value', 500_00, null, 'usd')]), null, 'no limit, no cap chart');
  const chart = capChart([figure('Harbor Street Grill', 9, 12), figure('Copperline Cafe', 4, 12), figure('value', 500_00, null, 'usd')]);
  assert.ok(chart);
  assert.equal(chart.unit, 'count');
  assert.deepEqual(chart.rows.map((r) => [r.label, r.value, r.limit]), [['Harbor Street Grill', 9, 12], ['Copperline Cafe', 4, 12]]);
  assert.deepEqual(chart.limits, [12], 'a shared limit is one rule');
  assert.equal(chart.max, 12, 'the axis reaches the limit, not the sum (13)');
  assert.equal(capChart([figure('over', 130, 100)])?.max, 140);
  assert.deepEqual(capChart([figure('a', 5, 99), figure('b', 7, 3)])?.limits, [3, 99]);
});

test('niceCeil and capX scale the cap chart axis', () => {
  assert.deepEqual([64, 70, 100, 101, 1234, 0.4, 0].map(niceCeil), [70, 70, 100, 120, 1400, 0.4, 1]);
  assert.equal(capX(50, 100, 300), 150);
  assert.equal(capX(150, 100, 300), 300, 'clamped to the plot');
  assert.equal(capX(-1, 100, 300), 0);
  assert.equal(capX(5, 0, 300), 0);
});

test('controlInputs: every party with its side and kind, every link with its statements or none', () => {
  const statement = { held: true, since: '2012', until: null, asOf: '2012-02-01', basis: 'filing' as const, share: null, direct: null, note: null, cites: [cite(2)] };
  const m: TrackMatter = {
    ...base,
    links: [
      { from: 'p-roe', to: 'o-top', label: 'manages', cites: [cite(1)], statements: [statement] },
      { from: 'o-top', to: 'o-mid', label: 'owner of', cites: [cite(1)] },
    ],
  };
  const { parties, links } = controlInputs(m);
  assert.deepEqual(parties.get('p-roe'), { id: 'p-roe', name: 'Richard Roe', side: 'defendant', kind: 'person', parent: null, formed: null });
  assert.equal(parties.get('o-leaf')?.parent, 'o-mid');
  assert.equal(parties.get('o-leaf')?.kind, 'org');
  assert.deepEqual(links.map((l) => [l.from, l.to, l.statements.length]), [['p-roe', 'o-top', 1], ['o-top', 'o-mid', 0]]);
});
