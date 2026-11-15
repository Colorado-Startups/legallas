// SPDX-License-Identifier: Apache-2.0
// Card P4 (Claims & Proof): money kinds and the year bars. Promises and movements never share a series (R43), a
// label supplies a kind only when the reading is confident, and an entry without a payer or payee is never charted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { RoomMoney } from './matter-api.ts';
import { chartSeries, inferKind, kindWord, splitRoomMoney, withKinds, yearBars } from './claims-money-model.ts';

const fixture = JSON.parse(readFileSync(new URL('../../fixtures/matter.example.json', import.meta.url), 'utf8')) as {
  money: RoomMoney[];
};

function fact(over: Partial<RoomMoney>): RoomMoney {
  return { id: 'm', date: '2012-01-04', amountCents: 100, from: 'a', to: 'b', label: 'Wire', cites: [], ...over };
}

test('a label gives a kind only when exactly one kind reads from it', () => {
  assert.equal(inferKind(fact({ label: 'Seed account transfer' })), 'transfer');
  assert.equal(inferKind(fact({ label: 'Capital call notice' })), 'call');
  assert.equal(inferKind(fact({ label: 'Founder share contribution' })), 'contribution');
  assert.equal(inferKind(fact({ label: 'Partial distribution of sale receipts' })), 'distribution');
  assert.equal(inferKind(fact({ label: 'Committed seed deposit' })), 'commitment');
  assert.equal(inferKind(fact({ label: 'Bookkeeping fee paid' })), 'fee', 'a paid fee is a fee, not also a payment');
  assert.equal(inferKind(fact({ label: 'Payment to the bookkeeper' })), 'payment');
  assert.equal(inferKind(fact({ label: 'Contribution wired' })), null, 'two kinds read: not confident');
  assert.equal(inferKind(fact({ label: 'Yearly bookkeeping fee' })), null, 'a fee not stated as paid');
});

test('doubtful words, or a missing payer or payee, rule out any reading', () => {
  for (const label of ['Reported 2012 option allocation', 'Share value at conversion', 'Transfers admitted in filings',
    'Total distributions', 'Bookkeeping fee invoiced', 'Card repayment approved', 'Settlement payment offered']) {
    assert.equal(inferKind(fact({ label })), null, label);
  }
  assert.equal(inferKind(fact({ label: 'Wire transfer', from: null })), null);
  assert.equal(inferKind(fact({ label: 'Wire transfer', to: null })), null);
});

test('withKinds never overrides a recorded kind and marks every inferred one', () => {
  const recorded = fact({ id: 'r', kind: 'commitment', label: 'Wire transfer' });
  const bare = fact({ id: 'b', label: 'Wire transfer' });
  const doubtful = fact({ id: 'd', label: 'Reported balance' });
  const { money, inferred } = withKinds([recorded, bare, doubtful]);
  assert.equal(money[0], recorded);
  assert.equal(money[1].kind, 'transfer');
  assert.equal(money[2].kind, undefined);
  assert.deepEqual([...inferred], ['b']);
  assert.equal(kindWord(money[1], inferred), 'Transfer (from the label)');
  assert.equal(kindWord(money[0], inferred), 'Commitment');
  assert.equal(kindWord(money[2], inferred), 'Not stated');
});

test('chartSeries: promises, movements, and listed-only entries', () => {
  assert.equal(chartSeries(fact({ kind: 'call' })), 'promises');
  assert.equal(chartSeries(fact({ kind: 'fee' })), 'movements');
  assert.equal(chartSeries(fact({})), null);
  assert.equal(chartSeries(fact({ kind: 'transfer', from: null })), null);
});

test('the fixture splits into promises, movements and listed-only entries, one place each', () => {
  const { money, inferred } = withKinds(fixture.money);
  assert.deepEqual([...inferred], ['usd-12']);
  const split = splitRoomMoney(money);
  assert.equal(split.promises.length + split.movements.length + split.kindless.length, fixture.money.length);
  assert.deepEqual(split.promises.map((f) => f.id).sort(), ['usd-02', 'usd-06']);
  assert.deepEqual(split.kindless.map((f) => f.id).sort(), ['usd-05', 'usd-10', 'usd-11', 'usd-15']);
});

test('yearBars keeps one bar per payer on every year, and its cells sum to the series exactly', () => {
  const movements = splitRoomMoney(withKinds(fixture.money).money).movements;
  const bars = yearBars(movements, 'movements', (id) => ({ name: id, side: id === 'per-doe' ? 'client' : 'nominal' }));
  assert.deepEqual(bars.years, ['2011', '2012']);
  assert.deepEqual(bars.payers.map((p) => p.id), ['per-doe', 'org-alder-peak', 'org-copperline', 'org-harbor'], 'client side first');
  assert.equal(bars.values.flat().reduce((a, b) => a + b, 0), movements.filter((f) => f.from && f.to).reduce((a, f) => a + f.amountCents, 0));
  assert.equal(bars.values[0][0], 766_550, '2011, the client share purchase alone');
});

test('yearBars refuses the other series and skips listed-only, undated or fractional entries', () => {
  const none = () => ({ name: 'A', side: null });
  assert.throws(() => yearBars([fact({ kind: 'transfer' }), fact({ kind: 'commitment' })], 'movements', none));
  assert.deepEqual(yearBars([], 'movements', none), { years: [], payers: [], values: [] });
  const facts = [fact({ kind: 'fee', date: 'unknown' }), fact({ kind: 'fee', to: null }), fact({}),
    fact({ kind: 'fee', date: '2012-02', amountCents: 300 })];
  assert.deepEqual(yearBars(facts, 'movements', none), { years: ['2012'], payers: [{ id: 'a', name: 'A', side: null }], values: [[300]] });
});
