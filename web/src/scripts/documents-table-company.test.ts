// SPDX-License-Identifier: Apache-2.0
// The Documents table with no matter: dates and parties from the checklist or the file name, and the columns a company
// room leaves out. File names are the company fixture's (scripts/dev-fixture-company.ts); every fact is invented.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checklistFacts, hiddenColumns, keyFacts, nameDate, nameParty, type ChecklistDocs } from './documents-table-company.ts';
import { joinRows, type ListedRow, type ListedTree } from './documents-table-data.ts';
import type { ServedMatter } from './doc-facts.ts';

const BYLAWS = 'Bylaws__20110609__Harbor-Labs.pdf';
const RIGHTS = 'Investor-Rights-Agreement__20110621__Alder-Peak.pdf';
const CAP_TABLE = 'Cap-Table__20111231__Ledger-and-Co.pdf';

test('a convention name gives its date and its party', () => {
  assert.equal(nameDate(BYLAWS), '2011-06-09');
  assert.equal(nameParty(BYLAWS), 'Harbor Labs');
  assert.equal(nameParty(CAP_TABLE), 'Ledger and Co');
  assert.equal(nameDate('Wire__20110601-20110613__Acme-Bank.pdf'), '2011-06-13', 'a range dates the file by its last day');
  assert.equal(nameParty('Wire__20110601-20110613__Acme-Bank.pdf'), 'Acme Bank');
  assert.equal(nameParty('Claim_Chart__WP__20110812__Harbor-Labs.xlsx'), 'Harbor Labs', 'a work-product mark is not a party');
  assert.equal(nameParty('Stock-Agreement__2011__Harbor-Labs__Signed.pdf'), 'Harbor Labs', 'a year is a date, and the qualifier comes after the party');
});

test('a name outside the convention gives a day written in it, and no party', () => {
  assert.equal(nameDate('Bylaws signed 2011-06-09.pdf'), '2011-06-09');
  assert.equal(nameDate('Card policy 20110711 final.pdf'), '2011-07-11');
  assert.equal(nameParty('Bylaws signed 2011-06-09.pdf'), '');
  assert.equal(nameDate('Bylaws.pdf'), '');
  assert.equal(nameDate('Invoice 2011-02-30.pdf'), '', 'not a real day');
  assert.equal(nameDate('Order 120110609.pdf'), '', 'not inside a longer number');
  assert.equal(nameDate('Scan 1811-06-09.pdf'), '', 'outside 1900 to 2099');
  assert.equal(nameDate('Bylaws__2011-13-01__Harbor-Labs.pdf'), '', 'a bad month is no date');
  assert.equal(nameParty('Bylaws__2011-13-01__Harbor-Labs.pdf'), 'Harbor Labs', 'nor a party');
});

const checklist: ChecklistDocs = {
  items: [
    { matches: [{ documentId: 'b1', href: '/doc/?id=b1', date: '2011-06-10', parties: null }] },
    { matches: [{ documentId: 'b1', href: '/doc/?id=b1', date: '2011-06-11', parties: 'Harbor Labs, Inc. board' }] },
    { matches: [{ documentId: 'gone', href: null, date: '2011-01-01', parties: 'Alder Peak' }] },
  ],
};

test('the checklist keeps the first date and parties a person entered, and skips a file that left', () => {
  const facts = checklistFacts(checklist);
  assert.deepEqual(facts.get('b1'), { date: '2011-06-10', parties: 'Harbor Labs, Inc. board' });
  assert.equal(facts.has('gone'), false);
  assert.equal(checklistFacts(null).size, 0, 'the checklist is off or did not load');
});

test('key facts: the checklist first, then the file name', () => {
  const facts = checklistFacts(checklist);
  assert.deepEqual(keyFacts('b1', BYLAWS, facts), { date: '2011-06-10', parties: 'Harbor Labs, Inc. board' });
  assert.deepEqual(keyFacts('r1', RIGHTS, facts), { date: '2011-06-21', parties: 'Alder Peak' });
  assert.deepEqual(keyFacts('x1', 'Notes.pdf', facts), { date: '', parties: '' });
});

function file(id: string, name: string, extra: Partial<ListedRow> = {}): ListedRow {
  return { id, name, kind: 'pdf', size: 10, pages: 2, updated_at: '2026-09-30T00:00:00Z', source: 'mirror', ...extra };
}

const tree: ListedTree = {
  path: '', name: '', guide: null, count: 0, size: 0, folders: [],
  files: [file('b1', BYLAWS, { control_seq: 1 }), file('r1', RIGHTS, { control_seq: 2 })],
};

test('with no matter, rows read the checklist and the file names', () => {
  const rows = joinRows({ root: tree, matter: null, discussed: new Set(), prefix: 'DOE', checklist: checklistFacts(checklist) });
  assert.deepEqual(rows.map((r) => [r.id, r.date, r.parties]), [
    ['b1', '2011-06-10', 'Harbor Labs, Inc. board'],
    ['r1', '2011-06-21', 'Alder Peak'],
  ]);
});

test('with a matter, rows are the matter facts alone', () => {
  const matter = {
    people: [], orgs: [{ id: 'alder', name: 'Alder Peak Partners' }],
    docs: { r1: { date: '2011-06-22', type: 'Agreement', from: ['alder'], to: [], summary: null, privileged: false, control: 2 } },
  } as unknown as ServedMatter;
  const rows = joinRows({ root: tree, matter, discussed: new Set(), prefix: 'DOE', checklist: checklistFacts(checklist) });
  assert.deepEqual(rows.map((r) => [r.id, r.date, r.parties]), [
    ['b1', '', ''],
    ['r1', '2011-06-22', 'Alder Peak Partners'],
  ]);
});

test('a company room leaves out the case columns and empty ones; a case room shows every column', () => {
  const full = { date: '2011-06-09', parties: 'Harbor Labs', pages: 2 };
  const bare = { date: '', parties: '', pages: null };
  assert.deepEqual(hiddenColumns([full, bare], true), ['control', 'privilege', 'bates']);
  assert.deepEqual(hiddenColumns([bare, bare], true), ['control', 'privilege', 'bates', 'date', 'parties', 'pages']);
  assert.deepEqual(hiddenColumns([], true), ['control', 'privilege', 'bates', 'date', 'parties', 'pages']);
  assert.deepEqual(hiddenColumns([bare], false), [], 'a room with a matter is unchanged');
});
