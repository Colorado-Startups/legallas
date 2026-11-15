// SPDX-License-Identifier: Apache-2.0
// The complaint brief, the pure half (brief/model.ts), on a fictional matter built here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServedCite } from '../../../worker/matter-types.ts';
import { docTypeWords as roomDocTypeWords } from '../doc-type.ts';
import type { Track, TrackFigure, TrackMatter, TrackViolation } from '../track-model.ts';
import {
  againstLine, barLength, beforeAfter, briefPlan, castBySide, castCards, castGroups, castTerm, claimsMap, countLine, countWord, dateRows, docTypeWords, downloadLabel,
  exhibitCards, mapLabel, moneyView, pleadedRole, stepAt, stepsHeading, storySteps,
} from './model.ts';

const c = (doc: string, page: number | null, control: number | null = 1): ServedCite => ({ doc, page, control });

const violation = (extra: Partial<TrackViolation> = {}): TrackViolation => ({
  id: 'v-c', mark: 'C', title: 'Harbor Labs cancelled the supply deal', summary: 'One sentence.', period: { from: '2012', to: null },
  actors: [], entities: [], events: [], money: [], steps: [], figures: [], cites: [], ...extra,
});

const step = (id: string, date: string, extra: Partial<TrackViolation['steps'][number]> = {}) => ({
  id, date, label: `Step ${id}`, entities: [], moves: [], cites: [c(`d-${id}`, 1), c('d-extra', 2)], ...extra,
});

const figure = (id: string, value: number, extra: Partial<TrackFigure> = {}): TrackFigure => ({
  id, label: `Figure ${id}`, value, unit: 'usd', limit: null, note: null, cites: [c(`d-${id}`, 1)], ...extra,
});

const matter: TrackMatter = {
  version: 1,
  meta: { caption: 'Doe v. Roe', court: 'Court', caseNumber: null, division: null, judge: null, filed: null, operativePleading: null, definedTerms: [], builtAt: '2026-10-01T00:00:00Z' },
  people: [
    { id: 'p-doe', name: 'Jane Doe', role: 'plaintiff', side: 'client', title: null, orgs: [], cites: [] },
    { id: 'p-roe', name: 'Richard Roe', role: 'defendant', side: 'defendant', title: null, orgs: [], cites: [] },
  ],
  orgs: [
    { id: 'o-harbor-labs', name: 'Harbor Labs, Inc.', kind: 'company', side: 'defendant', parent: null, formed: null, cites: [] },
    { id: 'o-commissary', name: 'Roe Commissary, LLC', kind: 'company', side: 'nominal', parent: 'o-harbor-labs', formed: null, cites: [] },
  ],
  links: [], events: [], claims: [], money: [], violations: [], tracks: [],
  docs: { 'd-ex': { date: '2012-04-10', type: 'Email', from: [], to: [], summary: null, privileged: false, control: 9 } },
};

const track = (extra: Partial<Track> = {}): Track => ({
  id: 'tr', kind: 'complaint', title: 'Doe v. Roe', forum: 'Court', against: ['p-roe'], violations: ['v-c'],
  points: [
    { id: 'pt-1', violation: 'v-c', text: 'Harbor Labs signed the agreement.', authority: null, proof: [{ cite: c('d-a', 3), strength: 'corroborating', note: 'Signature page.' }, { cite: c('d-b', 1), strength: 'direct', note: 'The agreement.' }] },
    { id: 'pt-2', violation: 'v-c', text: 'Harbor Labs kept the invoices.', authority: null, proof: [{ cite: c('d-c', 1), strength: 'gap', note: 'Payment not traced.' }] },
    { id: 'pt-3', violation: 'v-c', text: 'Roe said the food was late.', authority: null, proof: [{ cite: c('d-d', 4), strength: 'circumstantial', note: null }] },
  ],
  ...extra,
});

test('the cast resolves names and sides, drops unknown ids, and groups by side in a fixed order', () => {
  const cards = castCards({
    cast: [
      { id: 'o-commissary', role: 'The commissary', via: 'o-harbor-labs' },
      { id: 'p-roe', role: ' Owner and manager ', via: 'o-harbor-labs' },
      { id: 'p-gone', role: 'Nobody', via: null },
      { id: 'p-doe', role: 'Plaintiff', via: 'o-gone' },
      { id: 'o-harbor-labs', role: 'Restaurant group', via: 'o-harbor-labs' },
    ],
  }, matter);
  assert.deepEqual(cards.map((card) => [card.name, card.role, card.via?.name ?? null]), [
    ['Roe Commissary, LLC', 'The commissary', 'Harbor Labs, Inc.'],
    ['Richard Roe', 'Owner and manager', 'Harbor Labs, Inc.'],
    ['Jane Doe', 'Plaintiff', null],
    ['Harbor Labs, Inc.', 'Restaurant group', null],
  ], 'an unknown via is dropped, and a party is never through itself');
  assert.deepEqual(castBySide(cards).map((g) => [g.side, g.cards.map((card) => card.id)]), [
    ['client', ['p-doe']], ['defendant', ['p-roe', 'o-harbor-labs']], ['nominal', ['o-commissary']],
  ]);
});

test('a cast role opens with its pleaded role, read case-insensitively as a whole phrase', () => {
  assert.equal(pleadedRole('Plaintiff; supplied the food through her company'), 'plaintiff');
  assert.equal(pleadedRole(' Defendant; owner and manager'), 'defendant');
  assert.equal(pleadedRole('DEFENDANT, through Harbor Labs'), 'defendant');
  assert.equal(pleadedRole('Defendant'), 'defendant');
  assert.equal(pleadedRole('relief defendant; holds the walk-in freezer'), 'relief');
  assert.equal(pleadedRole('Nominal defendant (named for the lease)'), 'nominal');
  assert.equal(pleadedRole('Not a defendant; outside counsel'), 'other');
  assert.equal(pleadedRole("Defendants' outside counsel"), null, 'a plural is not a pleaded role');
  assert.equal(pleadedRole("Defendant's outside counsel"), null, 'nor is a possessive');
  assert.equal(pleadedRole('Defendant\u2019s outside counsel'), null);
  assert.equal(pleadedRole('Defendantless'), null);
  assert.equal(pleadedRole('Owner of Harbor Labs'), null);
  assert.equal(pleadedRole('Third-party defendant'), null);
  assert.equal(pleadedRole(''), null);
});

const castMatter: TrackMatter = {
  ...matter,
  people: [...matter.people, { id: 'p-gc', name: 'Dan Dee', role: 'witness', side: 'defendant', title: null, orgs: [], cites: [] }],
  orgs: [
    ...matter.orgs,
    { id: 'o-doe-co', name: 'Copperline Restaurant Group, Inc.', kind: 'company', side: 'client', parent: null, formed: null, cites: [] },
    { id: 'o-bank', name: 'Acme Bank', kind: 'company', side: 'third', parent: null, formed: null, cites: [] },
  ],
};

test('the cast groups by pleaded role, whatever the side, in a fixed order', () => {
  const cards = castCards({
    cast: [
      { id: 'o-commissary', role: 'Relief defendant; holds the walk-in freezer', via: 'o-harbor-labs' },
      { id: 'p-gc', role: 'Not a defendant; outside counsel to Harbor Labs', via: 'o-harbor-labs' },
      { id: 'o-bank', role: 'Kept the commissary account', via: null },
      { id: 'o-harbor-labs', role: 'Relief defendant; restaurant group', via: null },
      { id: 'p-roe', role: 'Defendant; owner and manager', via: 'o-harbor-labs' },
      { id: 'o-doe-co', role: 'Her company, the supplier', via: null },
      { id: 'p-doe', role: 'Plaintiff', via: 'o-doe-co' },
    ],
  }, castMatter);
  assert.deepEqual(castGroups(cards).map((g) => [g.key, g.label, g.cards.map((card) => card.id)]), [
    ['plaintiff', 'Plaintiff side', ['o-doe-co', 'p-doe']],
    ['defendant', 'Defendants', ['p-roe']],
    ['relief', 'Relief defendants', ['o-commissary', 'o-harbor-labs']],
    ['other', 'Others named', ['p-gc', 'o-bank']],
  ], 'relief defendants sit together across sides, and "Not a defendant" never sits with the defendants');
  assert.deepEqual(cards.find((card) => card.id === 'o-harbor-labs')?.side, 'defendant', 'each card keeps its side for the shape');
  const nominal = castCards({ cast: [{ id: 'o-commissary', role: 'Nominal defendant', via: null }, { id: 'p-roe', role: 'Defendant', via: null }] }, castMatter);
  assert.deepEqual(castGroups(nominal).map((g) => g.label), ['Defendants', 'Nominal defendants']);
});

test('a cast that pleads no defendant role groups by side, under the side words', () => {
  const cards = castCards({
    cast: [
      { id: 'o-commissary', role: 'The commissary', via: 'o-harbor-labs' },
      { id: 'p-roe', role: 'Owner and manager', via: 'o-harbor-labs' },
      { id: 'p-doe', role: 'Plaintiff', via: null },
    ],
  }, castMatter);
  assert.deepEqual(castGroups(cards).map((g) => [g.key, g.label, g.cards.map((card) => card.id)]), [
    ['client', 'Client side', ['p-doe']], ['defendant', 'Defendants', ['p-roe']], ['nominal', 'Company and nominal parties', ['o-commissary']],
  ], 'a plaintiff alone does not switch the grouping, so the defendants are not swept into the others');
  assert.deepEqual(castGroups([]), []);
});

test('steps keep story order with one cite each, and the heading counts them over their months', () => {
  const steps = storySteps(violation({ steps: [step('1', '2012-01-01', { note: ' Why it matters. ' }), step('2', '2013-06'), step('3', 'soon')] }));
  assert.deepEqual(steps.map((s) => [s.n, s.iso, s.note, s.cite?.doc]), [[1, '2012-01-01', 'Why it matters.', 'd-1'], [2, '2013-06', null, 'd-2'], [3, '', null, 'd-3']]);
  assert.equal(stepsHeading(steps), 'Three dated steps, Jan. 2012 to June 2013');
  assert.equal(stepsHeading(steps.slice(0, 1)), 'One dated step, Jan. 2012');
  assert.equal(stepsHeading([{ iso: '' }]), 'One dated step');
  assert.equal(countWord(12), '12');
});

test('the ownership switch compares the told and filed dates, else the first and last steps', () => {
  const steps = [step('1', '2012-01-01'), step('2', '2012-04-10'), step('3', '2012-05'), step('4', '2013-06-15')];
  const contrast: TrackViolation['contrast'] = [
    { heading: 'Told Doe', date: '2012-04-11', speaker: null, quote: 'Payment follows Friday.', cites: [c('d-t', 1)] },
    { heading: 'Suit filed', date: '2013-06-15', speaker: null, quote: 'Doe sues for the unpaid invoices.', cites: [c('d-f', 1)] },
  ];
  assert.deepEqual(beforeAfter(violation({ steps, contrast })), [
    { index: 1, label: 'Told Doe, Apr. 11, 2012' }, { index: 3, label: 'Suit filed, June 15, 2013' },
  ], 'each side at the last step on or before its date');
  assert.deepEqual(beforeAfter(violation({ steps })), [{ index: 0, label: 'Step 1, Jan. 1, 2012' }, { index: 3, label: 'Step 4, June 15, 2013' }]);
  const early: TrackViolation['contrast'] = [{ ...contrast[0], date: '2012-01-01' }, contrast[1]];
  assert.deepEqual(beforeAfter(violation({ steps, contrast: early }))?.map((p) => p.index), [0, 3], 'a told date before every step falls back');
  assert.equal(beforeAfter(violation({ steps: steps.slice(0, 1) })), null);
  assert.equal(stepAt(steps, '2012-05'), 2, 'a month covers its whole period');
  assert.equal(stepAt(steps, '2012'), 2);
  assert.equal(stepAt(steps, 'never'), null);
});

test('money: dollar figures in their groups on one scale, counts apart, nothing summed', () => {
  const view = moneyView([
    figure('a', 1_184_020, { group: 'Spring invoices' }),
    figure('b', 1_842_055, { group: 'Spoiled stock' }),
    figure('n', 37, { unit: 'count' }),
    figure('c', 650_375, { group: 'Spring invoices' }),
    figure('bad', 12.5),
  ]);
  assert.ok(view);
  assert.deepEqual(view.groups.map((g) => [g.label, g.bars.map((b) => b.id)]), [['Spring invoices', ['a', 'c']], ['Spoiled stock', ['b']]]);
  assert.equal(view.max, 2_000_000, 'the axis ends on a round number above the largest amount');
  assert.deepEqual(view.others.map((f) => f.id), ['n']);
  assert.deepEqual(moneyView([figure('x', 100)])?.groups.map((g) => g.label), ['']);
  assert.equal(moneyView([]), null);
  assert.equal(barLength(300, 600, 1), 0.5);
  assert.equal(barLength(900, 600, 200), 200);
  assert.equal(barLength(5, 0, 200), 0);
});

test('the claims map takes each element from the strongest proof of its points; gaps carry what is missing', () => {
  const map = claimsMap(track({
    counts: [
      {
        id: 'cnt-1', title: 'Breach of the supply agreement', against: ['p-roe', 'o-harbor-labs', 'p-gone'], basis: 'Contract', kind: 'direct',
        elements: [
          { id: 'e-1', text: 'Agreement.', points: ['pt-1', 'pt-3'] },
          { id: 'e-2', text: 'Payment.', points: ['pt-2'] },
          { id: 'e-3', text: 'No points yet.', points: ['pt-missing'] },
        ],
      },
      { id: 'cnt-2', title: 'Claim for the commissary', against: [], basis: '', kind: 'derivative', elements: [{ id: 'e-4', text: 'Said.', points: ['pt-3'] }] },
    ],
  }), matter);
  assert.ok(map);
  const [first, second] = map.rows;
  assert.deepEqual(first.cells.map((cell) => [cell.n, cell.strength, cell.cite?.doc ?? null, cell.note]), [
    [1, 'direct', 'd-b', 'The agreement.'],
    [2, 'gap', null, 'Payment not traced.'],
    [3, 'gap', null, null],
  ]);
  assert.deepEqual(first.against.map((p) => p.name), ['Richard Roe', 'Harbor Labs, Inc.']);
  assert.equal(countLine(first), 'Direct; against Richard Roe and Harbor Labs, Inc.');
  assert.equal(countLine(second), 'Derivative');
  assert.equal(againstLine(first.against), 'Against Richard Roe and Harbor Labs, Inc.');
  assert.equal(againstLine([{ name: 'A' }, { name: 'B' }, { name: 'C' }]), 'Against A; B and C');
  assert.equal(againstLine([]), '');
  assert.deepEqual(second.cells.map((cell) => cell.strength), ['circumstantial']);
  assert.deepEqual([map.secured, map.total, map.columns], [1, 4, 3]);
  assert.deepEqual(map.pips, ['direct', 'gap', 'gap', 'circumstantial']);
  assert.equal(mapLabel(map), 'Proof secured 1 of 4 elements');
  assert.equal(mapLabel({ secured: 0, total: 0 }), 'No elements listed yet.');
  assert.equal(claimsMap(track(), matter), null, 'a track without counts has no map');
});

test('dates run oldest first; exhibits keep the brief order, each page once, with the document facts', () => {
  const cite = c('d-ex', 3);
  assert.deepEqual(dateRows({
    dates: [
      { date: '2013-06-15', text: 'Filed.', cites: [cite] },
      { date: '2012-04', text: 'Told.', cites: [cite] },
    ],
  }).map((row) => row.iso), ['2012-04', '2013-06-15']);
  assert.deepEqual(exhibitCards({
    exhibits: [
      { cite, proves: 'Roe confirmed the order.' },
      { cite: c('d-new', null), proves: 'Unknown document.' },
      { cite, proves: 'Again.' },
    ],
  }, matter.docs).map((card) => [card.cite.doc, card.type, card.date, card.proves]), [
    ['d-ex', 'Email', '2012-04-10', 'Roe confirmed the order.'],
    ['d-new', '', '', 'Unknown document.'],
  ]);
  assert.equal(downloadLabel('Draft complaint'), 'Download draft complaint');
  assert.equal(downloadLabel('W-9 form'), 'Download W-9 form');
});

test('the plan leaves out what the track does not have', () => {
  const bare = briefPlan(track(), matter, [violation()]);
  assert.deepEqual(
    [bare.line, bare.cast.length, bare.hurdles.length, bare.dates.length, bare.exhibits.length, bare.drafts.length, bare.map, bare.money],
    [null, 0, 0, 0, 0, 0, null, null],
  );
  const full = briefPlan(track({
    brief: {
      line: ' The theory. ', cast: [{ id: 'p-doe', role: 'Plaintiff', via: null }], hurdles: [], dates: [], exhibits: [],
      drafts: [{ label: 'Draft complaint', doc: 'd-draft', control: 13 }],
    },
  }), matter, [violation({ figures: [figure('a', 100)] })]);
  assert.equal(full.line, 'The theory.');
  assert.deepEqual(full.drafts.map((d) => d.doc), ['d-draft']);
  assert.equal(full.money?.groups.length, 1);
});

test('docTypeWords: a filename DocType reads as words; digits keep their hyphen; plain types stay', () => {
  assert.equal(docTypeWords('Supply-Agreement'), 'Supply agreement');
  assert.equal(docTypeWords('Invoice-INV'), 'Invoice INV');
  assert.equal(docTypeWords('Exhibit-B'), 'Exhibit B');
  assert.equal(docTypeWords('W-9'), 'W-9');
  assert.equal(docTypeWords('Email'), 'Email');
  assert.equal(docTypeWords('Repair-ticket'), 'Repair ticket');
  assert.equal(docTypeWords('Supply agreement'), 'Supply agreement');
  assert.equal(docTypeWords(''), '');
});

test("one rule: the brief uses the room's docTypeWords (doc-type.ts), the function the file titles use", () => {
  assert.equal(docTypeWords, roomDocTypeWords);
});

test('castTerm: the defined term whose definition names the party in full', () => {
  const terms = [
    { term: 'Doe', means: 'Plaintiff Jane Doe, co-founder and former CEO of Harbor Labs' },
    { term: 'Harbor Labs', means: 'Defendant Harbor Labs, Inc., the company' },
    { term: 'Roe', means: 'Defendant Richard Roe, co-founder and CTO of Harbor Labs' },
    { term: 'the Commissary', means: 'Roe Commissary, LLC, a nominal defendant' },
  ];
  assert.equal(castTerm('Jane Doe', terms), 'Doe');
  assert.equal(castTerm('Richard Roe', terms), 'Roe');
  assert.equal(castTerm('Harbor Labs, Inc.', terms), 'Harbor Labs');
  assert.equal(castTerm('Roe Commissary, LLC', terms), 'the Commissary');
  // No term names it; a name that is itself a term needs no label (and never borrows one that merely mentions it).
  assert.equal(castTerm('Mark Moe', terms), null);
  assert.equal(castTerm('Harbor Labs', terms), null);
  // Whole names only: "Richard Roe" is not inside "Richard Roeberts".
  assert.equal(castTerm('Richard Roe', [{ term: 'Roeberts', means: 'Richard Roeberts, a witness' }]), null);
  assert.equal(castTerm('', terms), null);
});

test('exhibitCards: the document type reads as words', () => {
  const cards = exhibitCards({ exhibits: [{ cite: c('d-ex', 1), proves: 'P.' }] }, {
    'd-ex': { date: '2012-04-10', type: 'Invoice-INV', from: [], to: [], summary: null, privileged: false, control: 9 },
  });
  assert.equal(cards[0]?.type, 'Invoice INV');
});
