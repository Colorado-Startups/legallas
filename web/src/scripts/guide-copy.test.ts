// SPDX-License-Identifier: Apache-2.0
// The guide's words: every page has a briefing that needs no matter, placeholders fill only when every value is
// there, counts are numerals, and a partial list of names is never shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_COPY, GUIDE_PAGES, briefingFor, count, fill, guideValues, isGuidePage, listOf, pick } from './guide-copy.ts';

const SLOT = /\{\w+\}/;

test('every page ends its briefing with a plain sentence and offers two or three orders', () => {
  for (const page of GUIDE_PAGES) {
    const { brief, orders } = GUIDE_COPY[page];
    assert.ok(brief.length > 0, page);
    assert.doesNotMatch(brief.at(-1)!, SLOT, `${page}: the last briefing needs no values`);
    assert.ok(orders.length >= 1 && orders.length <= 3, `${page}: ${orders.length} orders`);
    for (const text of [...brief, ...orders.flatMap((o) => [o.label, ...o.question])]) {
      assert.doesNotMatch(text, /!|—|\bLegallas is\b|\belf\b/i, `${page}: ${text}`);
      assert.ok(text.length <= 200, `${page}: one sentence, ${text.length} characters`);
    }
  }
});

test('fill needs every value; pick takes the first candidate that fills', () => {
  assert.equal(fill('{a} and {b}', { a: 'X', b: 'Y' }), 'X and Y');
  assert.equal(fill('{a} and {b}', { a: 'X' }), null);
  assert.equal(fill('{a}', { a: '' }), null, 'an empty value counts as missing');
  assert.equal(fill('No slots.', {}), 'No slots.');
  assert.equal(pick(['{a} first', 'plain'], {}), 'plain');
  assert.equal(pick(['{a} first', 'plain'], { a: 'A' }), 'A first');
  assert.equal(pick(['{a}'], {}), null);
});

test('counts are numerals; lists name at most three, all or none', () => {
  assert.equal(count(1, 'track', 'tracks'), '1 track');
  assert.equal(count(3, 'track', 'tracks'), '3 tracks');
  assert.equal(count(214, 'dated event', 'dated events'), '214 dated events');
  for (const none of [0, -1, 1.5, Number.NaN]) assert.equal(count(none, 'a', 'b'), '', String(none));
  assert.equal(listOf(['A']), 'A');
  assert.equal(listOf(['A', 'B']), 'A and B');
  assert.equal(listOf(['A', 'B', 'C']), 'A, B and C');
  assert.equal(listOf(['A', 'B', 'C', 'D']), '');
  assert.equal(listOf(['A', '']), '', 'a name that did not resolve drops the whole list');
  assert.equal(listOf([]), '');
});

test('without a matter every page falls back to its plain briefing and the orders that need nothing', () => {
  const values = guideValues(null);
  for (const page of GUIDE_PAGES) {
    const { brief, orders } = briefingFor(page, values);
    assert.equal(brief, GUIDE_COPY[page].brief.at(-1), page);
    for (const order of orders) assert.doesNotMatch(order.question, SLOT, page);
  }
  assert.deepEqual(briefingFor('doc', values).orders, [], 'doc orders need the page title');
});

test('values fill from the served matter: tracks, violations, names against, counts', () => {
  const matter = {
    people: [{ id: 'p-roe', name: 'Richard Roe' }],
    orgs: [{ id: 'o-co', name: 'Harbor Labs, Inc.' }],
    events: Array.from({ length: 12 }, () => ({})),
    tracks: [
      { kind: 'complaint', against: ['p-roe', 'o-co'], violations: ['v-c'] },
      { kind: 'regulator', violations: ['v-a', 'v-b'] },
      { kind: 'regulator', violations: ['v-c'] },
    ],
    violations: [{ id: 'v-a', mark: 'A' }, { id: 'v-b', mark: 'B' }, { id: 'v-c', mark: 'C' }, { id: 'v-x', mark: 'bad' }],
  };
  const values = guideValues(matter, { title: 'DOE-000412' });
  assert.equal(values.tracks, '3 tracks');
  assert.equal(values.violations, 'violations A, B and C');
  assert.equal(values.complaintViolations, 'violation C', "the complaint's own violations, singular for one");
  assert.equal(values.against, 'Richard Roe and Harbor Labs, Inc.');
  assert.equal(values.regulatorFilings, '2 filings');
  assert.equal(values.events, '12 dated events');
  assert.equal(values.people, '1 person');
  assert.equal(values.entities, '1 entity');
  assert.equal(briefingFor('overview', values).brief, 'The case runs on 3 tracks, built on violations A, B and C; each card shows what is proved and what is still missing.');
  assert.equal(briefingFor('complaint', values).brief.startsWith('The complaint against Richard Roe and Harbor Labs, Inc. on one page:'), true);
  assert.equal(briefingFor('complaint', values).orders[0]?.question, 'Who controls the entities in violation C, according to the record?');
  assert.equal(briefingFor('doc', values).orders[0]?.question, 'Summarize DOE-000412 in three sentences, with cites.');
});

test('an against id or violation id that does not resolve, or a value with control characters or too long, is not used', () => {
  const values = guideValues(
    { people: [], violations: [{ id: 'v-a', mark: 'A' }], tracks: [{ kind: 'complaint', against: ['missing'], violations: ['v-a', 'v-gone'] }] },
    { title: 'x'.repeat(121) },
  );
  assert.equal(values.against, '');
  assert.equal(values.complaintViolations, '');
  assert.equal(values.title, '');
  assert.equal(guideValues(null, { title: 'Menu\u0000 of\n2012' }).title, 'Menu of 2012');
  assert.equal(briefingFor('complaint', values).brief, GUIDE_COPY.complaint.brief.at(-1));
});

test('isGuidePage accepts the page keys only', () => {
  assert.equal(isGuidePage('overview'), true);
  assert.equal(isGuidePage('ask'), false);
  assert.equal(isGuidePage(undefined), false);
});
