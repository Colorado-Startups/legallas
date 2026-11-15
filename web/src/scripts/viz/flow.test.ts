// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MoneyFact, MoneyKind } from '../../../worker/matter-types.ts';
import { aggregateFlows, layoutFlow, NODE_W } from './flow.ts';
import type { MarkSide } from './core.ts';

const fact = (id: string, from: string | null, to: string | null, amountCents: number, kind: MoneyKind | undefined = 'payment'): MoneyFact => ({
  id, date: '2012-03', amountCents, kind, from, to, label: 'Payment', cites: [{ doc: 'd1', page: 1 }],
});
const movements = [
  fact('m-1', 'p-doe', 'o-harbor-labs', 250_000_00),
  fact('m-2', 'p-doe', 'o-harbor-labs', 50_000_00, 'transfer'),
  fact('m-3', 'o-harbor-labs', 'p-roe', 120_000_00, 'payment'),
  fact('m-4', null, 'p-roe', 1_00),
  fact('m-5', 'p-doe', 'p-roe', 0),
  { ...fact('m-6', 'p-doe', 'p-roe', 9_00), kind: undefined },
];
const sides: Record<string, MarkSide> = { 'p-doe': 'client', 'o-harbor-labs': 'nominal', 'p-roe': 'defendant' };
const sideOf = (id: string): MarkSide => sides[id] ?? 'none';

test('flows sum one series by payer and payee in cents and keep their fact ids', () => {
  const edges = aggregateFlows(movements, 'movements');
  assert.equal(edges.length, 2, 'zero, kindless and null-ended entries are not charted');
  assert.deepEqual(edges[0], { from: 'p-doe', to: 'o-harbor-labs', cents: 300_000_00, facts: ['m-1', 'm-2'] });
  assert.ok(!edges.some((e) => e.facts.includes('m-4') || e.facts.includes('m-6')));
  assert.throws(() => aggregateFlows([fact('m-9', 'a', 'b', 12.5)], 'movements'), /m-9: amount must be whole cents/);
});

test('a set mixing promises and movements is refused, whichever series is asked for', () => {
  const mixed = [...movements, fact('c-1', 'p-doe', 'o-harbor-labs', 500_000_00, 'commitment')];
  assert.throws(() => aggregateFlows(mixed, 'movements'), /c-1 is promises, not movements/);
  assert.throws(() => aggregateFlows(mixed, 'promises'), /is movements, not promises/);
  const promises = [fact('c-1', 'p-doe', 'o-harbor-labs', 500_000_00, 'commitment'), fact('c-2', 'p-doe', 'o-harbor-labs', 100_000_00, 'call')];
  assert.deepEqual(aggregateFlows(promises, 'promises')[0].cents, 600_000_00);
});

test('payers sit left and payees right, ordered by side, and ribbons stack without overlap', () => {
  const layout = layoutFlow(aggregateFlows(movements, 'movements'), 600, sideOf);
  const left = layout.nodes.filter((n) => n.column === 0).map((n) => n.id);
  const right = layout.nodes.filter((n) => n.column === 1).map((n) => n.id);
  assert.deepEqual(left, ['p-doe', 'o-harbor-labs'], 'client, then company');
  assert.deepEqual(right, ['o-harbor-labs', 'p-roe']);
  for (const n of layout.nodes) {
    const mine = layout.links.filter((l) => (n.column === 0 ? l.edge.from : l.edge.to) === n.id);
    const sum = mine.reduce((a, l) => a + l.width, 0);
    assert.ok(Math.abs(n.y1 - n.y0 - sum) < 0.001, `${n.id} is as tall as its ribbons`);
  }
  for (const l of layout.links) {
    assert.ok(l.width >= 2, 'a tiny payment stays visible');
    assert.ok(l.d.startsWith(`M${NODE_W},`), 'ribbons leave the payer node');
  }
  const big = layout.links.find((l) => l.edge.cents === 300_000_00);
  const mid = layout.links.find((l) => l.edge.cents === 120_000_00);
  assert.ok(big && mid && Math.abs(big.width / mid.width - 2.5) < 0.001, 'thickness is proportional to the amount');
});

test('an empty record lays out to nothing', () => {
  const layout = layoutFlow([], 400, sideOf);
  assert.deepEqual(layout.nodes, []);
  assert.deepEqual(layout.links, []);
});
