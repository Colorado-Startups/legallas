// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MoneyFact } from '../../../worker/matter-types.ts';
import { citeHref, moneyTile, tileProblems } from './tile.ts';

const cite = { doc: 'b6a1c0de-0000-4000-8000-000000000412', page: 3 };

test('a cite links to the document at the page', () => {
  assert.equal(citeHref(cite), '/doc/?id=b6a1c0de-0000-4000-8000-000000000412#page=3');
  assert.equal(citeHref({ doc: 'a b', page: null }), '/doc/?id=a%20b');
});

test('money always carries its cite and is whole cents', () => {
  assert.deepEqual(tileProblems({ label: 'Spring invoices', value: 25_000_00, kind: 'usd', cite: { cite, text: 'DOE-000412 at 3' } }), []);
  assert.deepEqual(tileProblems({ label: 'Spring invoices', value: 25_000_00, kind: 'usd' }), ['money needs a cite']);
  assert.ok(tileProblems({ label: 'X', value: 10.5, kind: 'usd', cite: { cite, text: 't' } }).includes('money must be whole cents'));
  assert.deepEqual(tileProblems({ label: 'Documents', value: 918, kind: 'count' }), [], 'counts need no cite');
  assert.ok(tileProblems({ label: 'Documents', value: Number.NaN, kind: 'count' }).length > 0);
});

test('a money tile sums one series, cites its first entry and refuses the other series', () => {
  const m = (id: string, date: string, amountCents: number, kind: MoneyFact['kind']): MoneyFact => ({ id, date, amountCents, kind, from: 'a', to: 'b', label: '', cites: [{ doc: id, page: 2 }] });
  const tile = moneyTile('Invoices due', [m('k1', '2012-02', 40_000_00, 'call'), m('k2', '2013-07', 10_000_00, 'commitment'), m('n', '2011', 5_00, undefined)], 'promises', (c) => `DOE-${c.doc} at ${c.page}`);
  assert.equal(tile.value, 50_000_00);
  assert.equal(tile.note, '2012-02 to 2013-07');
  assert.equal(tile.cite?.text, 'DOE-k1 at 2');
  assert.deepEqual(tileProblems(tile), []);
  assert.throws(() => moneyTile('Mixed', [m('k1', '2012', 1, 'call'), m('f', '2012', 1, 'fee')], 'promises', () => ''), /movements, not promises/);
});
