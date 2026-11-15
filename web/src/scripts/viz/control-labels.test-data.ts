// SPDX-License-Identifier: Apache-2.0
// A fictional busy control panel for the label tests: one restaurant group at the center of twenty-one dated
// ties (people, outside companies, the kitchens it runs), with denials a later source answers, parallel ties and
// long sources, so the busiest steps crowd the words around it. No real matter content.
import type { LinkStatement } from '../../../worker/matter-types.ts';
import type { ControlLink, ControlParty, ControlViolation } from './control-layout.ts';

const person = (id: string, name: string, side: ControlParty['side'] = 'defendant'): ControlParty =>
  ({ id, name, side, kind: 'person', parent: null, formed: null });
const org = (id: string, name: string, parent: string | null, formed: string | null, side: ControlParty['side'] = 'defendant'): ControlParty =>
  ({ id, name, side, kind: 'org', parent, formed });

/** The id of the org at the center of the dense control-label fixture. */
export const HUB = 'o-harbor-labs';

/** Fictional parties for the dense control-label fixture. */
export const DENSE_PARTIES = new Map<string, ControlParty>([
  person('p-roe', 'Richard Roe'),
  person('p-moe', 'Mark Moe', 'third'),
  person('p-note', 'Nina Note', 'nominal'),
  person('p-count', 'Carol Count', 'third'),
  person('p-dee', 'Dan Dee'),
  person('p-low', 'Lisa Low', 'client'),
  org('o-commissary', 'Roe Commissary, LLC', null, '2011-03-01', 'nominal'),
  org('o-moe-produce', 'Moe Produce, Inc.', null, null, 'third'),
  org('o-acme', 'Acme Bank, N.A.', null, null, 'third'),
  org('o-ledger', 'Ledger and Co.', null, null, 'third'),
  org(HUB, 'Harbor Labs, Inc.', null, '2011-02-14'),
  org('o-grill', 'Harbor Street Grill, LLC', HUB, '2011-06-01'),
  org('o-cafe', 'Copperline Cafe, LLC', HUB, '2012-04-01'),
  org('o-delivery', 'Roe Delivery, LLC', HUB, '2011-06-01', 'nominal'),
  org('o-events', 'Harbor Labs Events, LLC', HUB, '2011-09-01'),
  org('o-cooler-lease', 'Roe Cooler Leasing, LLC', HUB, '2012-01-10', 'nominal'),
  org('o-dishwasher', 'Roe Dishwasher Leasing, LLC', HUB, '2012-02-01', 'nominal'),
].map((p) => [p.id, p]));

const st = (over: Partial<LinkStatement>): LinkStatement => ({
  held: true, since: null, until: null, asOf: '2011-04-04', basis: 'document', share: null, direct: null, note: null, cites: [], ...over,
});
const tie = (from: string, to: string, label: string, ...statements: Partial<LinkStatement>[]): ControlLink =>
  ({ from, to, label, statements: statements.map(st) });

/** Fictional ties among the dense fixture's parties. */
export const DENSE_LINKS: ControlLink[] = [
  tie('p-roe', HUB, 'manager of',
    { since: '2011-02', asOf: '2011-02-14', note: 'Management agreement' },
    { since: '2011-02', asOf: '2013-03-07', basis: 'filing', note: 'Share sale' }),
  tie('p-roe', HUB, 'owner of', { since: '2011-03', asOf: '2011-03-01', note: 'Operating agreement', share: { min: 60, max: 60 } }),
  tie('p-moe', HUB, 'delivers produce to', { since: '2011-06', asOf: '2013-08-13', note: 'Delivery log' }),
  tie('p-note', HUB, 'officer of', { since: '2011', asOf: '2014-04-08', basis: 'pleadingOurs' }),
  tie('p-count', HUB, 'bookkeeper for', { since: '2011-09', asOf: '2011-09-01', basis: 'document', note: 'Engagement letter' }),
  tie('p-dee', HUB, 'outside counsel to', { since: '2011-02', asOf: '2013-01-10', basis: 'account' }),
  tie('p-low', HUB, 'demand letter to', { held: false, asOf: '2012-05-19', note: 'Low email: no letter sent' }),
  tie('o-commissary', HUB, 'owner of',
    { since: '2011-03', asOf: '2011-03-24', share: { min: 40, max: 40 }, note: 'Purchase ledger' },
    { since: '2011-03', asOf: '2013-03-07', basis: 'filing', share: { min: 20, max: 40 }, note: 'Share sale' }),
  tie('o-commissary', HUB, 'supplies', { since: '2011-04', asOf: '2011-04-04', note: 'Supply agreement' }),
  tie('o-moe-produce', HUB, 'invoices', { since: '2011-06', asOf: '2013-09-24', note: 'Spring invoice register' }),
  tie('o-acme', HUB, 'bank for',
    { held: false, asOf: '2012-03-01', note: 'Bank letter: no account' },
    { since: '2011-03', asOf: '2013-11-07', note: 'Account statement' }),
  tie('o-ledger', HUB, 'keeps the books of', { since: '2011-09', asOf: '2012-01-15', note: 'Engagement letter' }),
  tie(HUB, 'o-grill', 'supplies', { since: '2011-06', asOf: '2011-06-01', basis: 'document', note: 'Delivery schedule' }),
  tie(HUB, 'o-cafe', 'supplies', { since: '2012-04', asOf: '2012-04-11', basis: 'document', note: 'Delivery schedule' }),
  tie(HUB, 'o-delivery', 'sole member of', { since: '2011-06', asOf: '2011-06-01', note: 'Delivery company agreement' }),
  tie(HUB, 'o-events', 'manager of', { since: '2011-09', asOf: '2013-11-04', note: 'Wedding catering contract' }),
  tie(HUB, 'o-cooler-lease', 'manager of',
    { held: false, asOf: '2012-07-01', note: 'Cooler lease booklet' },
    { since: '2012-01', asOf: '2014-02-03', basis: 'filing', note: 'Annual report' }),
  tie(HUB, 'o-dishwasher', 'manager of', { since: '2012-02', asOf: '2014-04-08', basis: 'pleadingOurs' }),
  tie('p-roe', 'o-cafe', 'signed for', { since: '2012-04-11', asOf: '2012-04-11', note: 'Opening notice' }),
  tie('p-moe', 'o-moe-produce', 'owns', { since: '2011-03', asOf: '2011-03-01', basis: 'filing' }),
  tie('p-count', 'o-ledger', 'partner at', { since: '2011-01', asOf: '2011-01-03' }),
];

/** A fictional violation that touches many entities, for the dense label tests. */
export const DENSE_VIOLATION: ControlViolation = {
  actors: ['p-roe'],
  entities: [HUB, 'o-grill', 'o-cafe', 'o-delivery', 'o-events', 'o-cooler-lease', 'o-dishwasher'],
  steps: [
    { date: '2011-04-04', label: 'The supply agreement is signed', entities: [HUB], moves: [] },
    { date: '2012-04-11', label: 'Copperline Cafe opens', entities: [HUB, 'o-cafe'], moves: [] },
    { date: '2012-07-09', label: 'The walk-in cooler fails', entities: [HUB], moves: [] },
    { date: '2013-06-30', label: 'Public share sale recorded', entities: [HUB], moves: [] },
    { date: '2014-03-03', label: 'Annual report for Harbor Street Grill', entities: [HUB, 'o-grill'], moves: [] },
  ],
};
