// SPDX-License-Identifier: Apache-2.0
// The Complaint guide and Filing guide, the pure half (track-guide-model.ts), on a fictional matter built here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServedCite } from '../../worker/matter-types.ts';
import {
  againstIdsOf, againstLabel, exhibitsOf, guideHeadings, guideTitle, inSentence, isCounselLink, partySentence, pointsLabel, trackGuide,
  uniqueCites,
} from './track-guide-model.ts';
import type { Track, TrackMatter, TrackViolation } from './track-model.ts';

const c = (doc: string, page: number | null, control: number | null = null): ServedCite => ({ doc, page, control });

const violation = (id: string, mark: string, extra: Partial<TrackViolation> = {}): TrackViolation => ({
  id, mark, title: `Violation ${mark}`, summary: 'One sentence.', period: { from: '2012', to: null },
  actors: [], entities: [], events: [], money: [], steps: [], figures: [], cites: [], ...extra,
});

const matter: TrackMatter = {
  version: 1,
  meta: { caption: 'Prior caption', court: 'Court', caseNumber: null, division: null, judge: null, filed: null, operativePleading: null, definedTerms: [], builtAt: '2026-10-01T00:00:00Z' },
  people: [
    { id: 'p-roe', name: 'Richard Roe', role: 'defendant', side: 'defendant', title: 'Owner and manager', orgs: ['o-harbor-labs'], cites: [c('d-roe', 2, 7)] },
    { id: 'p-note', name: 'Nina Note', role: 'defendant', side: 'defendant', title: null, orgs: ['o-commissary'], cites: [] },
    { id: 'p-doe', name: 'Jane Doe', role: 'plaintiff', side: 'client', title: 'Owner', orgs: ['o-doe-co'], cites: [c('d-doe', 1, 9)] },
    { id: 'p-teller', name: 'Pat Teller', role: 'witness', side: 'client', title: null, orgs: [], cites: [] },
    { id: 'p-law', name: 'Lisa Low', role: 'plaintiffCounsel', side: 'client', title: 'Counsel', orgs: [], cites: [] },
  ],
  orgs: [
    { id: 'o-harbor-labs', name: 'Harbor Labs, Inc.', kind: 'company', side: 'defendant', parent: null, formed: '2011-02-14', cites: [] },
    { id: 'o-commissary', name: 'Roe Commissary, LLC', kind: 'company', side: 'defendant', parent: 'o-harbor-labs', formed: '2011-09-15', cites: [c('d-permit', 1, 3)] },
    { id: 'o-cooler', name: 'Roe Commissary Cooler, LLC', kind: 'company', side: 'nominal', parent: 'o-commissary', formed: '2011-09-15', cites: [c('d-permit', 2, 3)] },
    { id: 'o-side', name: 'Roe Events, LLC', kind: 'company', side: 'defendant', parent: null, formed: null, cites: [] },
    { id: 'o-doe-co', name: 'Copperline Restaurant Group, Inc.', kind: 'company', side: 'client', parent: null, formed: null, cites: [] },
  ],
  links: [
    { from: 'p-roe', to: 'o-harbor-labs', label: 'manages', cites: [c('d-agree', 4, 5)] },
    { from: 'p-roe', to: 'p-doe', label: 'emailed', cites: [c('d-mail', 1, 12)] },
    { from: 'p-roe', to: 'o-commissary', label: 'signs for', cites: [c('d-permit', 1, 3)] },
  ],
  events: [
    { id: 'ev-form', date: '2011-09-15', title: 'Roe Commissary gets its permit', summary: 'Permit issued.', type: 'filing', actors: ['p-roe'], claims: [], cites: [c('d-permit', 1, 3)] },
    { id: 'ev-tell', date: '2012-04-11', title: 'Roe tells Doe payment follows Friday', summary: null, type: 'communication', actors: ['p-roe', 'p-doe', 'p-law'], claims: [], cites: [c('d-mail', 1, 12)] },
    { id: 'ev-ticket', date: '2012-07', title: 'The cooler repair ticket is opened', summary: null, type: 'milestone', actors: ['o-cooler'], claims: [], cites: [c('d-ticket', null)] },
    { id: 'ev-other', date: '2011-01-01', title: 'Unrelated', summary: null, type: 'order', actors: ['p-teller'], claims: [], cites: [] },
  ],
  claims: [], money: [],
  docs: {
    'd-permit': { date: '2011-09-15', type: 'Permit', from: [], to: [], summary: 'Commissary permit.', privileged: false, control: 3 },
    'd-mail': { date: '2012-04-11', type: 'Email', from: [], to: [], summary: 'The email.', privileged: false, control: 12 },
    'd-ticket': { date: '2012-07-10', type: 'Repair ticket', from: [], to: [], summary: 'The repair ticket.', privileged: false, control: null },
  },
  violations: [
    violation('v-c', 'C', {
      actors: ['p-roe', 'p-note'],
      entities: ['o-cooler', 'o-commissary'],
      events: ['ev-form', 'ev-tell', 'ev-ticket', 'ev-missing'],
      cites: [c('d-mail', 1, 12)],
      steps: [
        { id: 'st-1', date: '2011-09-15', label: 'Commissary formed', entities: ['o-commissary'], moves: [], cites: [c('d-permit', 2, 3)] },
        { id: 'st-2', date: '2012-04-11', label: 'Doe told payment follows Friday', entities: [], moves: [], cites: [c('d-mail', 1, 12)] },
        { id: 'st-3', date: '2012-08-14', label: 'Inspector logs the cooler failure', entities: ['o-cooler'], moves: [], cites: [c('d-log', 1, 20)] },
      ],
      figures: [{ id: 'f-1', label: 'Spoiled stock', value: 100, unit: 'usd', limit: null, note: null, cites: [c('d-fig', 1, 30)] }],
    }),
    violation('v-d', 'D', {
      entities: ['o-side', 'o-commissary'],
      events: ['ev-form'],
      steps: [{ id: 'st-d', date: '2011-09-15', label: 'Events entity formed', entities: [], moves: [], cites: [c('d-other', 1, 1)] }],
    }),
  ],
  tracks: [],
};

const track: Track = {
  id: 'tr-1', kind: 'complaint', title: 'Doe v. Roe', forum: 'District Court', against: ['p-roe', 'p-note', 'p-gone'],
  violations: ['v-c', 'v-d'],
  points: [
    { id: 'pt-1', violation: 'v-c', text: 'Harbor Labs signed the supply agreement.', authority: null, proof: [{ cite: c('d-permit', 1, 3), strength: 'direct', note: null }] },
    { id: 'pt-2', violation: 'v-c', text: 'The stock spoiled in the cooler.', authority: 'Statute 1', proof: [{ cite: c('d-ticket', 2), strength: 'gap', note: 'Why the cooler failed is not traced.' }] },
    { id: 'pt-3', violation: 'v-d', text: 'Roe told Doe payment follows Friday.', authority: null, proof: [{ cite: c('d-mail', 1, 12), strength: 'circumstantial', note: null }] },
    { id: 'pt-x', violation: 'v-x', text: 'Not on this track.', authority: null, proof: [] },
  ],
};

test('the caption is the track title, and the parties come from against and the client side', () => {
  const guide = trackGuide(track, matter);
  assert.equal(guide.caption, 'Doe v. Roe');
  assert.equal(guide.forum, 'District Court');
  assert.deepEqual(guide.against.map((p) => p.name), ['Richard Roe', 'Nina Note'], 'an unknown id is skipped');
  const roe = guide.against[0];
  assert.equal(roe.role, 'Owner and manager');
  assert.deepEqual(roe.controls.map((x) => [x.name, x.relation]), [['Harbor Labs, Inc.', 'manages'], ['Roe Commissary, LLC', 'signs for']],
    'links to orgs give the words; a link to a person is not control; the org list adds nothing new');
  assert.deepEqual(roe.cites.map((x) => x.doc), ['d-roe']);
  assert.deepEqual(roe.controls[0].cites.map((x) => x.doc), ['d-agree']);
  assert.deepEqual(guide.against[1].controls.map((x) => [x.name, x.relation]), [['Roe Commissary, LLC', null]], 'an org the person sits in, with no words');
  assert.deepEqual(guide.clientSide.map((p) => p.name), ['Jane Doe'],
    'client-side actors of the events count; counsel, an actor outside the track and a witness who never acts do not');
  assert.deepEqual(guide.clientSide[0].controls.map((x) => x.name), ['Copperline Restaurant Group, Inc.']);
});

test('an org party controls its children', () => {
  const guide = trackGuide({ ...track, against: ['o-harbor-labs'] }, matter);
  assert.deepEqual(guide.against[0].controls.map((x) => [x.name, x.relation]), [['Roe Commissary, LLC', 'owns or manages']]);
  assert.equal(guide.against[0].role, null);
});

test('counsel never stand as parties: by a counsel link, as a client-side law firm, or as a tie', () => {
  const withCounsel: TrackMatter = {
    ...matter,
    people: [...matter.people, { id: 'p-cou', name: 'Gwen Gray', role: 'witness', side: 'client', title: null, orgs: [], cites: [] }],
    orgs: [...matter.orgs, { id: 'o-firm', name: 'Old Firm LLP', kind: 'firm', side: 'client', parent: null, formed: null, cites: [] }],
    links: [
      ...matter.links,
      { from: 'p-cou', to: 'p-doe', label: 'counsel for', cites: [] },
      { from: 'p-doe', to: 'o-firm', label: 'represented by', cites: [] },
    ],
    events: matter.events.map((e) => (e.id === 'ev-tell' ? { ...e, actors: [...e.actors, 'p-cou', 'o-firm'] } : e)),
  };
  const guide = trackGuide(track, withCounsel);
  assert.deepEqual(guide.clientSide.map((p) => p.name), ['Jane Doe']);
  assert.deepEqual(guide.clientSide[0].controls.map((x) => x.name), ['Copperline Restaurant Group, Inc.'], 'a counsel tie is not a holding');
  assert.equal(isCounselLink('Counsel for'), true);
  assert.equal(isCounselLink('represents'), true);
  assert.equal(isCounselLink('represented by'), true);
  assert.equal(isCounselLink('manages'), false);
  assert.equal(isCounselLink(null), false);
});

test('a party reads as sentences: name, role, then what it holds or runs', () => {
  const guide = trackGuide(track, matter);
  assert.deepEqual(partySentence(guide.against[0]), {
    lead: 'Richard Roe', text: ', owner and manager. Manages Harbor Labs, Inc.; and signs for Roe Commissary, LLC.',
  });
  assert.deepEqual(partySentence(guide.against[1]), { lead: 'Nina Note', text: '. Tied to Roe Commissary, LLC.' });
  assert.deepEqual(partySentence({ name: 'Pat Teller', role: null, controls: [] }), { lead: 'Pat Teller', text: '.' });
  assert.equal(inSentence('Head chef'), 'head chef');
  assert.equal(inSentence('Bookkeeper, Ledger and Co.'), 'bookkeeper, Ledger and Co.');
  for (const kept of ['HVAC manager', "Roe's driver", 'Head Chef', 'Harbor Labs manager']) assert.equal(inSentence(kept), kept);
});

test('the entities run by date formed, parents first, undated last, each with its parent', () => {
  const guide = trackGuide(track, matter);
  assert.deepEqual(guide.entities.map((e) => [e.name, e.formed, e.parent?.name ?? null]), [
    ['Roe Commissary, LLC', '2011-09-15', 'Harbor Labs, Inc.'],
    ['Roe Commissary Cooler, LLC', '2011-09-15', 'Roe Commissary, LLC'],
    ['Roe Events, LLC', '', null],
  ]);
});

test('facts merge each step with the event that records it, in date order, numbered', () => {
  const guide = trackGuide(track, matter);
  assert.deepEqual(guide.facts.map((f) => [f.n, f.date, f.text, f.marks.join('')]), [
    [1, '2011-09-15', 'Roe Commissary gets its permit', 'CD'],
    [2, '2011-09-15', 'Events entity formed', 'D'],
    [3, '2012-04-11', 'Roe tells Doe payment follows Friday', 'C'],
    [4, '2012-07', 'The cooler repair ticket is opened', 'C'],
    [5, '2012-08-14', 'Inspector logs the cooler failure', 'C'],
  ]);
  const formed = guide.facts[0];
  assert.equal(formed.detail, 'Permit issued.');
  assert.deepEqual(formed.cites.map((x) => `${x.doc}@${x.page}`), ['d-permit@1', 'd-permit@2'], 'the event and step cites, each page once');
  assert.deepEqual(guide.facts[1].cites.map((x) => x.doc), ['d-other'],
    'a step on the same date with no document in common stays its own fact; the shared event joins only the first');
});

test('facts with no date go last; duplicate steps across violations read once', () => {
  const twin = violation('v-e', 'E', { steps: [{ id: 'st-e', date: '2012-08-14', label: 'Inspector logs the cooler failure', entities: [], moves: [], cites: [c('d-log', 2, 20)] }] });
  const undated = violation('v-f', 'F', { steps: [{ id: 'st-f', date: 'soon', label: 'No date', entities: [], moves: [], cites: [] }] });
  const m = { ...matter, violations: [...matter.violations, twin, undated] };
  const guide = trackGuide({ ...track, violations: ['v-c', 'v-e', 'v-f'] }, m);
  const moved = guide.facts.filter((f) => f.text === 'Inspector logs the cooler failure');
  assert.equal(moved.length, 1);
  assert.deepEqual(moved[0].marks, ['C', 'E']);
  assert.deepEqual(moved[0].cites.map((x) => x.page), [1, 2]);
  assert.equal(guide.facts.at(-1)?.text, 'No date');
  assert.equal(guide.facts.at(-1)?.date, '');
});

test('points keep track order and their strength; gaps carry the note on what is missing', () => {
  const guide = trackGuide(track, matter);
  assert.deepEqual(guide.points.map((p) => [p.id, p.mark, p.strength]), [
    ['pt-1', 'C', 'direct'], ['pt-2', 'C', 'gap'], ['pt-3', 'D', 'circumstantial'],
  ], 'a point for a violation the track does not show is left out');
  assert.deepEqual(guide.gaps, [{ id: 'pt-2', mark: 'C', text: 'The stock spoiled in the cooler.', note: 'Why the cooler failed is not traced.' }]);
});

test('key exhibits: every document the guide cites, once, by control number, unnumbered last', () => {
  const guide = trackGuide(track, matter);
  assert.deepEqual(guide.exhibits.map((x) => [x.control, x.doc]), [
    [1, 'd-other'], [3, 'd-permit'], [5, 'd-agree'], [7, 'd-roe'], [9, 'd-doe'], [12, 'd-mail'], [20, 'd-log'], [30, 'd-fig'], [null, 'd-ticket'],
  ]);
  const form = guide.exhibits.find((x) => x.doc === 'd-permit');
  assert.deepEqual(form?.pages, [1, 2]);
  assert.deepEqual(form?.cite, { doc: 'd-permit', page: null, control: 3 }, 'the chip opens the whole document');
  assert.equal(form?.type, 'Permit');
  assert.deepEqual(guide.exhibits.find((x) => x.doc === 'd-ticket')?.pages, [2], 'a whole-file cite adds no page');
});

test('exhibitsOf takes the control from the docs when the cites lack one', () => {
  const docs = { 'd-a': { date: '2012-01-01', type: 'Email', from: [], to: [], summary: 'A.', privileged: false, control: 4 } };
  assert.deepEqual(exhibitsOf([c('d-a', null), c('d-b', 3)], docs).map((x) => [x.doc, x.control, x.summary]), [['d-a', 4, 'A.'], ['d-b', null, '']]);
});

test('exhibitsOf shows the document type in words (doc-type.ts), so the printed Part 6 matches the room', () => {
  const doc = (type: string, control: number) => ({ date: '2012-01-01', type, from: [], to: [], summary: null, privileged: false, control });
  const docs = { 'd-inv': doc('Invoice-INV', 1), 'd-agree': doc('Supply-Agreement', 2), 'd-w9': doc('W-9', 3), 'd-none': doc('', 4) };
  const cites = [c('d-inv', 1), c('d-agree', 1), c('d-w9', 1), c('d-none', 1)];
  assert.deepEqual(exhibitsOf(cites, docs).map((x) => x.type), ['Invoice INV', 'Supply agreement', 'W-9', '']);
});

test('uniqueCites keeps the first of each document page', () => {
  assert.deepEqual(uniqueCites([c('a', 1), c('a', null)], [c('a', 1), c('b', 1)]).map((x) => `${x.doc}${x.page}`), ['a1', 'anull', 'b1']);
});

test('headings state what each section shows', () => {
  const guide = trackGuide(track, matter);
  assert.deepEqual(guideHeadings(guide), {
    parties: '2 defendants; 1 on the client side',
    entities: '3 entities',
    facts: '5 facts, Sept. 15, 2011 to Aug. 14, 2012',
    points: '1 of 3 points secured',
    exhibits: '9 documents cited',
    gaps: '1 point not yet in the record',
  });
  const dated = trackGuide({ ...track, violations: ['v-c'], against: ['o-harbor-labs'], points: [track.points[0]] }, matter);
  const h = guideHeadings({ ...dated, kind: 'regulator' });
  assert.equal(h.parties, '1 party named; 1 on the client side');
  assert.equal(h.entities, '2 entities, formed Sept. 15, 2011');
  assert.equal(h.gaps, 'Every point to prove has proof in the record');
  const bare = guideHeadings(trackGuide({ ...track, violations: [], points: [] }, matter));
  assert.equal(bare.points, 'No points to prove are listed yet');
  assert.equal(bare.facts, '0 facts');
  assert.equal(guideTitle('complaint'), 'Complaint guide');
  assert.equal(guideTitle('regulator'), 'Filing guide');
  assert.equal(againstLabel('regulator'), 'Against, per the record');
});

test('pointsLabel counts points to prove in words', () => {
  assert.equal(pointsLabel(2, 3), '2 of 3 points secured');
  assert.equal(pointsLabel(1, 1), '1 of 1 point secured');
  assert.equal(pointsLabel(0, 4), '0 of 4 points secured');
});

test('a complaint brief that pleads defendants sets who the outline is against', () => {
  const brief = (cast: { id: string; role: string; via: string | null }[]) =>
    ({ line: '', cast, hurdles: [], dates: [], exhibits: [], drafts: [] }) as unknown as NonNullable<Track['brief']>;
  const pleaded = brief([
    { id: 'p-doe', role: 'Plaintiff; supplied the food through her company', via: null },
    { id: 'p-roe', role: 'Defendant; owner and manager', via: null },
    { id: 'o-harbor-labs', role: 'Defendant, through Roe', via: null },
    { id: 'o-commissary', role: 'Relief defendant; holds the walk-in freezer', via: null },
    { id: 'p-note', role: "Defendant's counsel", via: null },
  ]);
  assert.deepEqual(againstIdsOf({ ...track, brief: pleaded }), ['p-roe', 'o-harbor-labs']);
  // The outline's Part 2 then counts what Who's who shows.
  assert.equal(guideHeadings(trackGuide({ ...track, brief: pleaded }, matter)).parties.split(';')[0], '2 defendants');
  // No defendant pleaded, no brief, or a filing: the track's own list.
  assert.deepEqual(againstIdsOf({ ...track, brief: brief([{ id: 'p-doe', role: 'Plaintiff', via: null }]) }), track.against);
  assert.deepEqual(againstIdsOf({ ...track, brief: undefined }), track.against);
  assert.deepEqual(againstIdsOf({ ...track, kind: 'regulator', brief: pleaded }), track.against);
});
