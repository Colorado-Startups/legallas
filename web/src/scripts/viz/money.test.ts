// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MONEY_KINDS, type MoneyFact, type MoneyKind } from '../../../worker/matter-types.ts';
import { assertOneSeries, seriesOf, splitMoney, sumSeries, unchartedReason } from './money.ts';

const fact = (id: string, amountCents: number, kind?: MoneyKind, from: string | null = 'a', to: string | null = 'b'): MoneyFact => ({
  id, date: '2021-05', amountCents, kind, from, to, label: '', cites: [],
});

test('commitments and calls are promises; every other kind is a movement; no kind is no series', () => {
  for (const kind of MONEY_KINDS) assert.equal(seriesOf(kind), kind === 'commitment' || kind === 'call' ? 'promises' : 'movements', kind);
  assert.equal(seriesOf(undefined), null);
});

test('entries split by kind alone; null-ended entries keep their series and are marked not charted', () => {
  const split = splitMoney([
    fact('c', 100, 'commitment'), fact('k', 50, 'call'), fact('f', 7, 'fee'), fact('n', 9),
    fact('p', 3, 'payment', null, 'b'), fact('q', 4, 'payment', 'a', null),
  ]);
  assert.deepEqual(split.promises.map((f) => f.id), ['c', 'k']);
  assert.deepEqual(split.movements.map((f) => f.id), ['f', 'p', 'q']);
  assert.deepEqual(split.kindless.map((f) => f.id), ['n']);
  assert.equal(unchartedReason(fact('n', 9)), 'Kind not stated');
  assert.equal(unchartedReason(fact('p', 3, 'payment', null, 'b')), 'Payer not stated');
  assert.equal(unchartedReason(fact('q', 4, 'payment', 'a', null)), 'Payee not stated');
  assert.throws(() => splitMoney([fact('x', 0.5, 'fee')]), /whole cents/);
});

test('a sum covers one series and refuses the other; kindless entries are left out', () => {
  assert.equal(sumSeries([fact('c', 100, 'commitment'), fact('k', 50, 'call'), fact('n', 9)], 'promises'), 150);
  assert.throws(() => sumSeries([fact('c', 100, 'commitment'), fact('f', 7, 'fee')], 'promises'), /f is movements, not promises/);
  assert.doesNotThrow(() => assertOneSeries([fact('n', 1)], 'movements', 'x'));
});
