// SPDX-License-Identifier: Apache-2.0
// What would hurt a founder if it were wrong: a date, a gap that isn't one, or a document said to be in place when it isn't.
// Invented facts (Harbor Labs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildChecklist, parseMatchInput, type CompanyFacts, type MatchRow, type ServedItem } from './checklist.ts';

const CORP: CompanyFacts = { entityType: 'delaware-c-corporation', formationDate: '2026-02-10' };
const NONE: CompanyFacts = { entityType: null, formationDate: null };
const TODAY = '2026-11-01';

let next = 0;
function match(itemId: string, over: Partial<MatchRow> = {}): MatchRow {
  next += 1;
  return { id: `m${next}`, item_id: itemId, document_id: `doc-${next}`, name: `Harbor ${next}.pdf`, folder: 'Company', source: 'mirror', control_seq: null, removed_at: null, signed: 'yes', doc_date: null, next_date: null, parties: null, amount: null, matched_by: 'founder@example.test', ...over };
}

function item(company: CompanyFacts, id: string, matches: MatchRow[] = [], today = TODAY): ServedItem {
  const found = buildChecklist(company, matches, [], today).items.find((each) => each.id === id);
  assert.ok(found, id);
  return found;
}

const dates = (served: ServedItem) => served.dates.map((date) => date.date);

test('83(b): 30 days after each transfer, in calendar days', () => {
  const planted = item(CORP, 'founders.section-83b-election', [match('founders.stock-purchase-agreement', { doc_date: '2027-01-15' })], '2027-01-20');
  assert.deepEqual(dates(planted), ['2027-02-14'], 'never later than the true last day, which a weekend or holiday can only move later');
  assert.match(planted.dates[0]?.basis ?? '', /^30 days after 2027-01-15, the transfer date/);
  const stock = [match('founders.stock-purchase-agreement', { doc_date: '2026-10-20' }), match('founders.stock-purchase-agreement', { doc_date: '2026-10-22' })];
  assert.deepEqual(dates(item(CORP, 'founders.section-83b-election', stock)), ['2026-11-19', '2026-11-21']);
  assert.match(item(CORP, 'founders.section-83b-election', [match('founders.stock-purchase-agreement')]).dateHint ?? '', /Add the date on/);
  assert.match(planted.deadline ?? '', /weekend or legal holiday moves to the next business day/, 'the wording says a weekend or holiday may move the last day later');
});

test('83(b): signed is not filed. It is done only when filed by the date, for each transfer, and a late one says so', () => {
  const agreement = match('founders.stock-purchase-agreement', { doc_date: '2026-10-20' });
  const election = (over: Partial<MatchRow>) => item(CORP, 'founders.section-83b-election', [agreement, match('founders.section-83b-election', over)]);
  const undated = election({ signed: 'yes' });
  assert.equal(undated.status, 'check');
  assert.deepEqual(undated.dates.map((date) => date.state), ['soon']);
  const filed = election({ signed: 'yes', doc_date: '2026-10-25' });
  assert.equal(filed.status, 'in_place');
  assert.deepEqual(filed.dates.map((date) => date.state), ['done']);
  const late = item(CORP, 'founders.section-83b-election', [match('founders.stock-purchase-agreement', { doc_date: '2026-01-20' }), match('founders.section-83b-election', { doc_date: '2026-10-01' })]);
  assert.equal(late.status, 'check');
  assert.equal(late.dates[0]?.state, 'late');
  assert.match(late.dates[0]?.basis ?? '', /Filed 2026-10-01, after this date\./);
  assert.equal(item(CORP, 'founders.section-83b-election', [match('founders.stock-purchase-agreement', { doc_date: '2026-02-12' })]).dates[0]?.state, 'passed');
});

test('83(b) with two founders: the room can\'t tell whose election is whose, so it never says done', () => {
  const agreements = [match('founders.stock-purchase-agreement', { doc_date: '2026-10-20' }), match('founders.stock-purchase-agreement', { doc_date: '2026-10-22' })];
  const elections = (...days: string[]) => item(CORP, 'founders.section-83b-election', [...agreements, ...days.map((doc_date) => match('founders.section-83b-election', { doc_date }))]);
  const twice = elections('2026-10-25', '2026-10-25');
  assert.equal(twice.status, 'check', 'a form and its proof of mailing are one filing');
  assert.deepEqual(twice.dates.map((date) => date.state), ['check', 'soon']);
  const distinct = elections('2026-10-25', '2026-10-26');
  assert.equal(distinct.status, 'check');
  assert.deepEqual(distinct.dates.map((date) => date.state), ['check', 'check']);
  assert.match(distinct.dateHint ?? '', /can't tell whose filing is whose/);
});

test('Form D: 15 days after the first sale of each kind of document, so a later offering has its own date', () => {
  const safes = [match('financing.safe', { doc_date: '2026-10-22' }), match('financing.safe', { doc_date: '2026-10-20' })];
  assert.deepEqual(dates(item(CORP, 'financing.form-d-and-state-notices', safes)), ['2026-11-04']);
  const later = item(CORP, 'financing.form-d-and-state-notices', [
    match('financing.safe', { doc_date: '2025-03-01' }),
    match('financing.form-d-and-state-notices', { doc_date: '2025-03-10' }),
    match('financing.preferred-stock-purchase-agreement', { doc_date: '2026-10-20' }),
  ]);
  assert.deepEqual(later.dates.map((date) => [date.date, date.state]), [['2025-03-16', 'done'], ['2026-11-04', 'soon']]);
  assert.equal(later.status, 'check');
});

test('any sale opens the financing filings, unless someone said the document is not signed', () => {
  const formD = (...matches: MatchRow[]) => item(CORP, 'financing.form-d-and-state-notices', matches);
  const signedPreferred = formD(match('financing.preferred-stock-purchase-agreement', { doc_date: '2026-10-25' }));
  assert.equal(signedPreferred.status, 'missing');
  assert.deepEqual(dates(signedPreferred), ['2026-11-09']);
  assert.deepEqual(dates(formD(match('financing.safe', { signed: null, doc_date: '2026-10-25' }))), ['2026-11-09'], 'not known opens it');
  const notSigned = formD(match('financing.safe', { signed: 'no', doc_date: '2026-10-25' }));
  assert.equal(notSigned.status, 'not_yet');
  assert.deepEqual(notSigned.dates, []);
});

test('409A: a year after the latest valuation, and a new one moves it on', () => {
  const valuation = (...days: string[]) => item(CORP, 'equity.section-409a-valuation', days.map((doc_date) => match('equity.section-409a-valuation', { doc_date })));
  assert.deepEqual(dates(valuation('2025-12-15', '2026-01-31')), ['2027-01-31']);
  assert.deepEqual(dates(valuation('2024-02-29')), ['2025-02-28'], 'a month with no such day ends on its last day');
});

test('yearly filings start the year after forming, show early, and say so when the date has passed unfiled', () => {
  const tax = (today: string, matches: MatchRow[] = []) => item(CORP, 'compliance-and-governance.delaware-franchise-tax', matches, today);
  assert.equal(tax('2026-11-01').status, 'not_yet');
  assert.deepEqual(dates(tax('2026-11-01')), ['2027-03-01']);
  const missed = tax('2027-03-02');
  assert.equal(missed.status, 'missing');
  assert.deepEqual(missed.dates.map((date) => [date.date, date.state]), [['2027-03-01', 'passed']]);
  const filed = tax('2027-03-02', [match('compliance-and-governance.delaware-franchise-tax', { doc_date: '2027-02-20' })]);
  assert.deepEqual(filed.dates.map((date) => [date.date, date.state]), [['2028-03-01', 'upcoming']]);
  assert.match(item({ ...CORP, formationDate: null }, 'compliance-and-governance.delaware-franchise-tax').dateHint ?? '', /Set the formation date/);
});

test('Colorado report: a five-month window around the formation month, from the year after forming', () => {
  const report = (formationDate: string, today: string) => item({ entityType: 'colorado-corporation', formationDate }, 'compliance-and-governance.colorado-periodic-report', [], today);
  const open = report('2025-06-15', '2026-05-01');
  assert.deepEqual(open.dates.map((date) => [date.opens, date.date]), [['2026-04-01', '2026-08-31']]);
  assert.equal(open.status, 'not_yet');
  const missed = report('2025-06-15', '2026-09-01');
  assert.equal(missed.status, 'missing');
  assert.deepEqual(missed.dates.map((date) => [date.opens, date.date, date.state]), [['2026-04-01', '2026-08-31', 'passed']]);
  // A window across the new year.
  assert.deepEqual(report('2024-12-05', '2026-02-10').dates.map((date) => [date.opens, date.date]), [['2025-10-01', '2026-02-28']]);
});

test('a day-one company sees formation gaps and not later stages, and only a signed document opens a stage, on its own', () => {
  const status = (id: string, matches: MatchRow[] = [], company = NONE) => buildChecklist(company, matches, [], TODAY).items.find((each) => each.id === id)?.status;
  assert.equal(status('founders.founder-agreement'), 'missing');
  assert.equal(status('financing.safe'), 'not_yet');
  assert.equal(status('formation.bylaws'), 'if_applies', 'no entity type: not called a gap');
  assert.equal(status('formation.bylaws', [], CORP), 'missing');
  assert.equal(status('people.form-i-9', [match('people.offer-letters')]), 'missing');
  assert.equal(status('financing.exemption-decision', [match('financing.safe', { signed: 'no' })]), 'not_yet', 'a document someone said is not signed opens nothing');
  assert.equal(status('financing.exemption-decision', [match('financing.safe', { signed: null })]), 'missing', 'not known opens it');
  assert.equal(status('people.form-i-9', [match('financing.safe')]), 'not_yet', 'a SAFE does not mean the company has hired');
  assert.equal(status('financing.exemption-decision', [match('financing.safe')]), 'missing');
});

test('a date must be a real day in a sensible year, and only a date filed can\'t be in the future', () => {
  const input = (over: Record<string, unknown>, itemId = 'formation.bylaws') => parseMatchInput({ itemId, documentId: 'doc-1', ...over }, TODAY);
  for (const date of ['0026-10-20', '2026-02-30']) assert.deepEqual(input({ date }), { ok: false, field: 'date' }, date);
  assert.deepEqual(input({ date: '2027-10-20' }, 'founders.section-83b-election'), { ok: false, field: 'date' }, 'a date filed');
  assert.ok(input({ date: '2026-11-01' }, 'founders.section-83b-election').ok);
  assert.ok(input({ date: '2027-10-20' }, 'founders.stock-purchase-agreement').ok, 'a planned transfer');
  assert.ok(input({ nextDate: '2030-01-01' }).ok, 'a renewal is in the future');
  const blank = input({});
  assert.ok(blank.ok);
  assert.deepEqual(blank.value.facts, {}, 'a fact left out is not a fact cleared');
});

test('a document counts as in place only if someone said it is signed or needs no signature, and only while it is in the room', () => {
  const statusWith = (over: Partial<MatchRow>) => item(CORP, 'formation.bylaws', [match('formation.bylaws', over)]).status;
  assert.equal(statusWith({ signed: 'yes' }), 'in_place');
  assert.equal(statusWith({ signed: 'not_needed' }), 'in_place');
  assert.equal(statusWith({ signed: 'no' }), 'check');
  assert.equal(statusWith({ signed: null }), 'check');
  assert.equal(statusWith({ removed_at: '2026-10-20T00:00:00.000Z' }), 'missing');
});

test('a template is offered only to the entity types it fits', () => {
  const offered = (entityType: string | null, id: string) => item({ entityType, formationDate: null }, id).templates.map((template) => template.href);
  assert.deepEqual(offered('colorado-llc', 'formation.organizational-consent'), ['/templates/founders/llc-initial-consent.md'], 'an LLC gets the member consent, not the board\'s');
  assert.deepEqual(offered('delaware-c-corporation', 'formation.organizational-consent'), ['/templates/founders/initial-board-consent.md']);
  assert.deepEqual(
    offered('delaware-llc', 'formation.operating-agreement'),
    ['/templates/founders/delaware-llc-agreement.md', '/templates/founders/delaware-llc-operating-agreement.md'],
    'a Delaware LLC gets only its own agreements',
  );
  assert.deepEqual(offered('delaware-c-corporation', 'formation.formation-document'), ['/templates/founders/delaware-corporation-certificate.md']);
  assert.deepEqual(offered('delaware-llc', 'formation.formation-document'), ['/templates/founders/delaware-llc-certificate.md']);
  assert.equal(offered(null, 'formation.formation-document').length, 4, 'no entity type: every one shows');
  const version = (id: string) => item(CORP, id).templates[0]?.version;
  assert.equal(version('founders.founder-agreement'), '1', 'from the file\'s own footer');
  assert.equal(version('formation.entity-choice'), null, 'a file with no footer shows none');
});

test('each match says where the document lives, with a link to open it', () => {
  const [served] = item(CORP, 'formation.bylaws', [match('formation.bylaws', { document_id: 'doc/1', name: 'Bylaws.pdf', folder: 'Company/Formation' })]).matches;
  assert.equal(served?.where, 'Company/Formation/Bylaws.pdf');
  assert.equal(served?.href, '/doc/?id=doc%2F1');
  const [gone] = item(CORP, 'formation.bylaws', [match('formation.bylaws', { removed_at: '2026-10-20T00:00:00.000Z' })]).matches;
  assert.equal(gone?.href, null);
});
