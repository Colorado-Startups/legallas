// SPDX-License-Identifier: Apache-2.0
// Card P2 (Chronology page). The page's pure logic: filters, options, order, deep links and the Ask question.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RoomEvent, ServedMatter } from './matter-api.ts';
import {
  activeChips, activeFilterCount, askHref, countLabel, EMPTY_FILTERS, eventFromSearch, firstStep, inViewLine,
  isLitigation, kindsPresent, LANE_MODES, litigationCount, orderedEvents, personFromSearch, personOptions, positionOf,
  radioStep, roman, selectedLine, stepKey, summaryLine, toggleKinds, toTimelineFilters, validFilterDate,
  violationFromSearch, violationOptions, violationsOf, withEventParam, withParam, type ChronMatter,
} from './chronology-model.ts';

function ev(id: string, date: string, over: Partial<RoomEvent> = {}): RoomEvent {
  return { id, date, title: `Event ${id}`, summary: null, type: 'meeting', actors: [], claims: [], cites: [], ...over };
}

const matter: ChronMatter & Pick<ServedMatter, 'claims'> = {
  events: [
    ev('ev-3', '2012-07-09', { type: 'communication', actors: ['p-roe'], claims: ['count-3'] }),
    ev('ev-1', '2011', { type: 'milestone', actors: ['o-co'] }),
    ev('ev-2', '2012-05', { type: 'filing', actors: ['p-doe'], claims: ['count-1'] }),
    ev('ev-4', '2014-01-02', { type: 'order', actors: ['o-court'] }),
  ],
  people: [
    { id: 'p-roe', name: 'Richard Roe', role: 'defendant', side: 'defendant', title: null, orgs: [], cites: [] },
    { id: 'p-doe', name: 'Jane Doe', role: 'plaintiff', side: 'client', title: null, orgs: [], cites: [] },
    { id: 'p-idle', name: 'Ann Idle', role: 'witness', side: 'third', title: null, orgs: [], cites: [] },
  ],
  orgs: [
    { id: 'o-co', name: 'Roe Commissary, LLC', kind: 'company', side: 'nominal', parent: null, formed: null, cites: [] },
    { id: 'o-court', name: 'District Court', kind: 'court', side: 'court', parent: null, formed: null, cites: [] },
  ],
  claims: [
    { id: 'count-3', count: 3, type: 'unjustEnrichment', label: 'Unjust enrichment', against: [], elements: [], cites: [] },
    { id: 'count-1', count: 1, type: 'breachContract', label: 'Breach of contract', against: [], elements: [], cites: [] },
  ],
  // Listed out of letter order on purpose; ev-3 sits in both, ev-4 in none.
  violations: [
    { id: 'v-b', mark: 'B', title: 'Stock spoiled after the roof leaked', events: ['ev-3'], period: { from: '2012', to: null } },
    { id: 'v-a', mark: 'A', title: 'Gutter repair ran past the estimate', events: ['ev-1', 'ev-3'], period: { from: '2011', to: '2012' } },
  ],
};

test('roman numbers counts as the pleading does', () => {
  assert.deepEqual([1, 3, 4, 9, 14, 40, 1999].map(roman), ['I', 'III', 'IV', 'IX', 'XIV', 'XL', 'MCMXCIX']);
  for (const bad of [0, -1, 2.5, Number.NaN]) assert.equal(roman(bad), '', String(bad));
  assert.equal(countLabel({ count: 3, label: 'Unjust enrichment' }), 'III Unjust enrichment');
  assert.equal(countLabel({ count: 0, label: 'Unnumbered' }), 'Unnumbered');
});

test('violationOptions lists the chips in letter order; an old manifest has none', () => {
  assert.deepEqual(violationOptions(matter), [
    { id: 'v-a', mark: 'A', title: 'Gutter repair ran past the estimate' },
    { id: 'v-b', mark: 'B', title: 'Stock spoiled after the roof leaked' },
  ]);
  assert.deepEqual(violationOptions({ events: [] }), []);
  assert.deepEqual(violationOptions({ events: [], violations: 'nonsense' as never }), [], 'a malformed list reads as none');
});

test('violationsOf derives membership from each violation\'s events list', () => {
  assert.deepEqual(violationsOf(matter, 'ev-3').map((v) => v.mark), ['A', 'B']);
  assert.deepEqual(violationsOf(matter, 'ev-1').map((v) => v.mark), ['A']);
  assert.deepEqual(violationsOf(matter, 'ev-4'), []);
  assert.deepEqual(violationsOf({ events: [] }, 'ev-3'), []);
});

test('?v= names a known violation, and sits beside the other parameters', () => {
  const options = violationOptions(matter);
  assert.equal(violationFromSearch('?v=v-b', options), 'v-b');
  assert.equal(violationFromSearch('?event=ev-3&v=v-a', options), 'v-a');
  assert.equal(violationFromSearch('?v=v-z', options), null);
  assert.equal(violationFromSearch('', options), null);
  assert.equal(withParam('https://x.test/chronology/?event=ev-3', 'v', 'v-a'), '/chronology/?event=ev-3&v=v-a');
  assert.equal(withParam('https://x.test/chronology/?v=v-a&event=ev-3', 'v', null), '/chronology/?event=ev-3');
});

test('the Litigation chip covers filings, pleadings, orders and service, and the Kind toggles leave them out', () => {
  assert.deepEqual(['filing', 'pleading', 'order', 'service', 'meeting', 'discovery'].map((type) => isLitigation({ type } as RoomEvent)),
    [true, true, true, true, false, false]);
  assert.equal(litigationCount(matter.events), 2);
  assert.deepEqual(toggleKinds(matter.events), ['communication', 'milestone']);
});

test('the lane modes add By violation after Side, Person and Kind', () => {
  assert.deepEqual(LANE_MODES.map((lane) => lane.mode), ['side', 'actor', 'type', 'violation']);
});

test('personOptions keeps actors only, client side first, then by name', () => {
  assert.deepEqual(personOptions(matter).map((p) => p.id), ['p-doe', 'p-roe', 'o-co', 'o-court']);
});

test('kindsPresent follows the timeline order and skips absent kinds', () => {
  assert.deepEqual(kindsPresent(matter.events), ['filing', 'order', 'communication', 'milestone']);
});

test('validFilterDate takes partial ISO dates and blanks only', () => {
  for (const ok of ['', '  ', '2012', '2012-04', '2012-04-30']) assert.ok(validFilterDate(ok), ok);
  for (const bad of ['12', '2012-13', '2012-02-30', 'April', '2012/04/01']) assert.ok(!validFilterDate(bad), bad);
});

test('toTimelineFilters maps the row: litigation hidden by default, hidden kinds dropped, one violation', () => {
  assert.deepEqual(toTimelineFilters(EMPTY_FILTERS), {
    people: [], violations: [], hideTypes: ['pleading', 'filing', 'order', 'service'], from: null, to: null,
  });
  const state = { ...EMPTY_FILTERS, person: 'p-roe', violation: 'v-a', hiddenKinds: ['meeting' as const], from: ' 2012 ', to: '2013-13' };
  assert.deepEqual(toTimelineFilters(state), {
    people: ['p-roe'], violations: ['v-a'], hideTypes: ['pleading', 'filing', 'order', 'service', 'meeting'], from: '2012', to: null,
  });
  assert.deepEqual(toTimelineFilters({ ...EMPTY_FILTERS, litigation: true }).hideTypes, [], 'Litigation on hides nothing');
});

test('activeFilterCount counts the folding row only, a date range once', () => {
  assert.equal(activeFilterCount(EMPTY_FILTERS), 0);
  assert.equal(activeFilterCount({ ...EMPTY_FILTERS, violation: 'v-a', litigation: true, from: '2012', to: '2013' }), 1);
  assert.equal(activeFilterCount({ ...EMPTY_FILTERS, person: 'p', hiddenKinds: ['meeting'], to: '2013' }), 3);
});

test('orderedEvents sorts by date and applies the filters like the timeline', () => {
  assert.deepEqual(orderedEvents(matter, {}).map((e) => e.id), ['ev-1', 'ev-2', 'ev-3', 'ev-4']);
  assert.deepEqual(orderedEvents(matter, { from: '2012', to: '2013' }).map((e) => e.id), ['ev-2', 'ev-3']);
  assert.deepEqual(orderedEvents(matter, { people: ['p-roe'] }).map((e) => e.id), ['ev-3']);
  assert.deepEqual(orderedEvents(matter, { types: ['filing', 'order'] }).map((e) => e.id), ['ev-2', 'ev-4']);
  assert.deepEqual(orderedEvents(matter, toTimelineFilters(EMPTY_FILTERS)).map((e) => e.id), ['ev-1', 'ev-3'], 'litigation off');
  assert.deepEqual(orderedEvents(matter, { violations: ['v-b'] }).map((e) => e.id), ['ev-3']);
  assert.deepEqual(orderedEvents(matter, { violations: ['v-a'] }).map((e) => e.id), ['ev-1', 'ev-3']);
  const all = { ...matter, violations: undefined };
  assert.deepEqual(orderedEvents(all, { violations: ['v-a'] }), [], 'a violation filter on a manifest without violations keeps nothing');
});

test('j and k step only inside the work area, never while typing or with a modifier', () => {
  const key = (k: string, over: Partial<KeyboardEvent> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...over });
  assert.equal(stepKey(key('j'), false, true), 1);
  assert.equal(stepKey(key('k'), false, true), -1);
  assert.equal(stepKey(key('x'), false, true), null);
  assert.equal(stepKey(key('j'), false, false), null, 'outside the area (R80)');
  assert.equal(stepKey(key('j'), true, true), null, 'while typing');
  assert.equal(stepKey(key('j', { ctrlKey: true }), false, true), null);
  assert.equal(firstStep([{ id: 'a' }, { id: 'b' }], 1), 'a');
  assert.equal(firstStep([{ id: 'a' }, { id: 'b' }], -1), 'b');
  assert.equal(firstStep([], 1), null);
});

test('the violation radios: arrows move the choice and wrap, Home and End go to the ends', () => {
  const key = (k: string, over: Partial<KeyboardEvent> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...over });
  // All, A, B, C
  assert.equal(radioStep(key('ArrowRight'), 0, 4), 1);
  assert.equal(radioStep(key('ArrowDown'), 2, 4), 3);
  assert.equal(radioStep(key('ArrowRight'), 3, 4), 0, 'wraps from the last to All');
  assert.equal(radioStep(key('ArrowLeft'), 0, 4), 3, 'wraps from All to the last');
  assert.equal(radioStep(key('ArrowUp'), 2, 4), 1);
  assert.equal(radioStep(key('Home'), 2, 4), 0);
  assert.equal(radioStep(key('End'), 0, 4), 3);
  assert.equal(radioStep(key('ArrowRight'), 0, 1), 0, 'All alone stays put');
  for (const other of ['Tab', ' ', 'Enter', 'j', 'k', 'Escape']) assert.equal(radioStep(key(other), 1, 4), null, other);
  for (const mod of ['metaKey', 'ctrlKey', 'altKey'] as const) assert.equal(radioStep(key('ArrowRight', { [mod]: true }), 1, 4), null, mod);
  assert.equal(radioStep(key('ArrowRight'), -1, 4), null, 'focus is not on a radio');
  assert.equal(radioStep(key('ArrowRight'), 0, 0), null, 'no radios');
});

test('the violation chips are a radio group and Litigation a toggle (DESIGN.md section 7, Selection)', () => {
  const web = join(import.meta.dirname, '..', '..');
  const page = readFileSync(join(web, 'src/pages/chronology/index.astro'), 'utf8');
  const filters = readFileSync(join(web, 'src/scripts/chronology-filters.ts'), 'utf8');
  const group = page.slice(page.indexOf('<div class="chron-marks__group"'), page.indexOf('</div>', page.indexOf('<div class="chron-marks__group"')));
  assert.match(group, /^<div class="chron-marks__group" role="radiogroup" aria-label="Violation" data-chron-violations hidden>/);
  assert.match(group, /<button type="button" role="radio" [^>]*aria-checked="true" tabindex="0" data-chron-v="">All<\/button>/);
  assert.doesNotMatch(group, /aria-pressed/);
  assert.match(page, /<button\s+type="button"\s+class="c-button chron-vchip chron-vchip--litigation c-select"\s+aria-pressed="false"\s+data-chron-litigation/);
  assert.match(filters, /role: 'radio', class: 'c-button chron-vchip c-select', 'aria-checked': 'false', tabindex: '-1',/);
  assert.match(filters, /radio\.setAttribute\('aria-checked', String\(on\)\);\s*radio\.tabIndex = on \? 0 : -1;/);
  assert.doesNotMatch(filters, /'aria-pressed', String\(chip\.dataset\.chronV/, 'no violation chip is a toggle');
});

test('positionOf gives the place and the neighbours, or 0 when filtered out', () => {
  const order = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(positionOf(order, 'a'), { index: 1, total: 3, previous: null, next: 'b' });
  assert.deepEqual(positionOf(order, 'b'), { index: 2, total: 3, previous: 'a', next: 'c' });
  assert.deepEqual(positionOf(order, 'c'), { index: 3, total: 3, previous: 'b', next: null });
  assert.deepEqual(positionOf(order, 'z'), { index: 0, total: 3, previous: null, next: null });
});

test('positionOf steps from a hidden event to the nearest kept events', () => {
  const all = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const kept = [{ id: 'a' }, { id: 'd' }];
  assert.deepEqual(positionOf(kept, 'b', all), { index: 0, total: 2, previous: 'a', next: 'd' });
  assert.deepEqual(positionOf([{ id: 'd' }], 'b', all), { index: 0, total: 1, previous: null, next: 'd' });
  assert.deepEqual(positionOf(kept, 'zz', all), { index: 0, total: 2, previous: null, next: null });
});

test('deep links name a known event, and the URL keeps its other parameters', () => {
  assert.equal(eventFromSearch('?event=ev-2', matter.events), 'ev-2');
  assert.equal(eventFromSearch('?event=ev-404', matter.events), null);
  assert.equal(eventFromSearch('', matter.events), null);
  assert.equal(withEventParam('https://x.test/chronology/?a=1#t', 'ev-2'), '/chronology/?a=1&event=ev-2#t');
  assert.equal(withEventParam('https://x.test/chronology/?event=ev-2', null), '/chronology/');
});

test('?p= presets a person or org from the Person options, and stays beside ?event=', () => {
  const options = personOptions(matter);
  assert.equal(personFromSearch('?p=p-roe', options), 'p-roe');
  assert.equal(personFromSearch('?p=o-co&event=ev-3', options), 'o-co');
  assert.equal(personFromSearch('?p=p-idle', options), null, 'named in no event, so not an option');
  assert.equal(personFromSearch('?p=nobody', options), null);
  assert.equal(personFromSearch('', options), null);
  const linked = withParam('https://x.test/chronology/?p=p-roe', 'event', 'ev-3');
  assert.equal(linked, '/chronology/?p=p-roe&event=ev-3');
  assert.equal(withParam(`https://x.test${linked}`, 'p', null), '/chronology/?event=ev-3');
});

test('activeChips gives one removable chip per filter that is set', () => {
  const names = { person: (id: string) => (id === 'p-roe' ? 'Richard Roe' : id), violation: () => 'A', kind: (k: string) => k };
  assert.deepEqual(activeChips(EMPTY_FILTERS, names), []);
  assert.deepEqual(activeChips({ ...EMPTY_FILTERS, litigation: true }, names), [], 'Litigation on narrows nothing');
  const state = { person: 'p-roe', violation: 'v-a', hiddenKinds: ['meeting' as const, 'discovery' as const], litigation: false, from: '2012', to: '2013' };
  assert.deepEqual(activeChips(state, names), [
    { facet: 'violation', label: 'Violation A' },
    { facet: 'person', label: 'Person: Richard Roe' },
    { facet: 'kinds', label: 'Without meeting, discovery' },
    { facet: 'dates', label: '2012 to 2013' },
  ]);
  assert.deepEqual(activeChips({ ...EMPTY_FILTERS, from: '2012' }, names), [{ facet: 'dates', label: 'From 2012' }]);
  assert.deepEqual(activeChips({ ...EMPTY_FILTERS, to: '2013-04' }, names), [{ facet: 'dates', label: 'To 2013-04' }]);
  assert.deepEqual(activeChips({ ...EMPTY_FILTERS, from: '2012-13' }, names), [], 'an invalid date sets no filter');
});

test('askHref asks about the event with its prose date', () => {
  const href = askHref({ title: 'Roe signs the supply agreement', date: '2011-04-04' });
  assert.ok(href.startsWith('/ask/?q='));
  assert.equal(
    new URLSearchParams(href.slice('/ask/'.length)).get('q'),
    'What does the record show about this event: Roe signs the supply agreement, Apr. 4, 2011?',
  );
});

test('summaryLine states the range, or how many of the events are shown', () => {
  assert.equal(summaryLine(matter.events, 4), '4 events, 2011 to Jan. 2, 2014.');
  assert.equal(summaryLine(matter.events, 2), '2 of 4 events shown.');
  assert.equal(summaryLine(matter.events, 2, true), '2 of 4 events shown, litigation hidden.');
  assert.equal(summaryLine(matter.events, 4, true), '4 events, 2011 to Jan. 2, 2014.', 'nothing hidden, nothing said');
  assert.equal(summaryLine([ev('x', '2012-03-04')], 1), '1 event, Mar. 4, 2012.');
  assert.equal(summaryLine([], 0), '0 events.');
});

test('copy stays inside the voice guide', () => {
  const text = [askHref(matter.events[0]!), summaryLine(matter.events, 4), summaryLine(matter.events, 1)].join(' '); // safe: fixture
  assert.doesNotMatch(decodeURIComponent(text), /[\u2014!]|\bscrolls?\b|\belf\b|\bmagic\b/i);
});

// R83: one polite line when a reader picks an event.
test('selectedLine names the event and its prose date once', () => {
  assert.equal(selectedLine({ title: 'Copperline Cafe opens', date: '2011-05-01' }), 'Selected: Copperline Cafe opens, May 1, 2011.');
  assert.equal(selectedLine({ title: 'Menu reprint ordered.', date: '2012-01' }), 'Selected: Menu reprint ordered, Jan. 2012.');
  assert.equal(selectedLine({ title: 'Undated meeting', date: '' }), 'Selected: Undated meeting.');
});

test('the In view line counts the window and names its days (R59)', () => {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  assert.equal(inViewLine({ start: day('2012-03-01'), end: day('2013-06-30') }, 12), '12 events, 2012-03-01 to 2013-06-30');
  assert.equal(inViewLine({ start: day('2012-03-01'), end: day('2012-03-08') }, 1), '1 event, 2012-03-01 to 2012-03-08');
});
