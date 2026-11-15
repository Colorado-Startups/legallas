// SPDX-License-Identifier: Apache-2.0
// Ask's public-records cards (records-card-model.ts) and the approval page's helpers (checks-model.ts): what came over
// the wire is checked again, a link survives only to a source's own https host or the room's own approval page, and
// the notices travel with every check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIdFrom, stateSentence, type CheckView } from './checks-model.ts';
import { approvalHref, recordHref, recordsCard, recordsCards } from './records-card-model.ts';
import { chunkEvents, PARTS } from './research-wire.ts';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';

test('approval links become the room\'s own page; anything else is dropped', () => {
  assert.equal(approvalHref(`https://room.example.com/checks/?id=${ID}`), `/checks/?id=${ID}`);
  assert.equal(approvalHref(`https://room.example.com/elsewhere/?id=${ID}`), null);
  assert.equal(approvalHref('https://room.example.com/checks/?id=bad id'), null);
  assert.equal(approvalHref(`javascript:alert(1)//checks/?id=${ID}`), null);
});

test('record links survive only as https links to the sources\' own hosts', () => {
  assert.equal(recordHref('https://www.sec.gov/Archives/edgar/data/1/x-index.htm'), 'https://www.sec.gov/Archives/edgar/data/1/x-index.htm');
  assert.equal(recordHref('http://www.sec.gov/'), null);
  assert.equal(recordHref('https://www.sec.gov.evil.example/'), null);
  assert.equal(recordHref('https://user:pass@www.sec.gov/'), null);
  assert.equal(recordHref('javascript:alert(1)'), null);
});

test('cards: an approval request, a decline and a check; unknown shapes dropped', () => {
  const cards = recordsCards([
    { status: 'approval_needed', name: 'Jane Doe', kind: 'person', approve_at: `https://room.example.com/checks/?id=${ID}`, would_send_to: [{ source: 'SEC EDGAR full-text search', host: 'efts.sec.gov' }], notice: 'Not a consumer report.' },
    { status: 'declined', name: 'Jane Doe', kind: 'person', message: 'Declined.', notice: 'Not a consumer report.' },
    {
      status: 'checked',
      name: 'Harbor Labs, Inc.',
      kind: 'company',
      checked: '2026-11-01T14:05:00.000Z',
      notice: 'Not a consumer report.',
      records_not_conclusions: 'Records, not conclusions.',
      not_a_lawyer: 'Not a lawyer.',
      sources: [
        { source: 'CourtListener dockets', operator: 'Free Law Project', status: 'searched', checked: '2026-11-01T14:05:00.000Z', note: '1 record found.', link: 'https://www.courtlistener.com/', coverage: 'Federal dockets.', look_for: 'x', findings: [{ title: 'Doe v. Harbor Labs, Inc.', date: '2026-04-01', details: ['Court: D. Colo.'], link: 'https://evil.example/', checked: '2026-11-01T14:05:00.000Z' }] },
        { source: 'FINRA BrokerCheck', operator: 'FINRA', status: 'link_only', checked: null, note: 'Not searched automatically.', link: 'https://brokercheck.finra.org/', coverage: 'Brokers.', look_for: 'Disclosures.', findings: [] },
        { source: 'Delaware', operator: 'DE', status: 'not_applicable', checked: null, note: 'Not searched: it covers companies, not people.', link: 'https://icis.corp.delaware.gov/', coverage: 'Entities.', look_for: null, findings: [] },
      ],
    },
    { status: 'something_else', name: 'x' },
    'junk',
  ]);
  assert.deepEqual(cards.map((c) => c.kind), ['approval', 'declined', 'checked']);
  const approval = cards[0];
  assert.equal(approval.kind === 'approval' && approval.approveHref, `/checks/?id=${ID}`);
  const checked = cards[2];
  if (checked.kind !== 'checked') return assert.fail('a checked card');
  assert.deepEqual(checked.groups.map((g) => g.heading), ['Searched', 'Search these by hand (the name was not sent to them)']);
  assert.equal(checked.groups[0].sources[0].findings[0].href, null, 'a link off the sources\' hosts is dropped, the record kept');
  assert.deepEqual(checked.notApplicable, ['Delaware: Not searched: it covers companies, not people.']);
  assert.deepEqual(checked.notices, ['Records, not conclusions.', 'Not a consumer report.', 'Not a lawyer.']);
  assert.equal(recordsCard({ status: 'checked' }), null);
});

test('the research wire carries the records part to the page', () => {
  const checks = [{ status: 'declined', name: 'Jane Doe', kind: 'person', message: 'm', notice: 'n' }];
  assert.deepEqual(chunkEvents({ type: PARTS.records, id: 'records', data: { checks } }), [{ event: 'records', data: { checks } }]);
  assert.deepEqual(chunkEvents({ type: PARTS.records, id: 'records', data: { checks: 'nope' } }), []);
});

test('the approval page: the id from the URL, and what it says in each state', () => {
  assert.equal(checkIdFrom(`?id=${ID}`), ID);
  assert.equal(checkIdFrom('?id=short'), null);
  assert.equal(checkIdFrom(''), null);
  const now = new Date('2026-11-01T14:05:00.000Z');
  const view: CheckView = { id: ID, name: 'Jane Doe', kind: 'person', state: 'pending', via: 'Claude', createdAt: now.toISOString(), decidedAt: null, expiresAt: '2026-11-01T14:35:00.000Z', approvedMinutes: 60, sendsTo: [], byHand: [] };
  assert.equal(stateSentence(view, now), 'Waiting for your decision. This request lapses in 30 minutes; an approval lasts 60 minutes.');
  assert.equal(stateSentence({ ...view, state: 'approved', expiresAt: '2026-11-01T15:05:00.000Z' }, now), 'Approved. Ask your AI to run the check now; the approval lasts 60 more minutes.');
  assert.equal(stateSentence({ ...view, state: 'declined' }, now), 'Declined. The name was not sent anywhere.');
});
