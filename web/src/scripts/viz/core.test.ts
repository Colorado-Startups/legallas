// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertCents, fitLabel, formatUsd, formatUsdCompact, formatValue, seriesSide, SHAPES, SIDE_WORDS } from './core.ts';
import { SIDES } from '../../../worker/matter-types.ts';

test('cents become USD only at the edge, with cents shown only when present', () => {
  assert.equal(formatUsd(125_000_00), '$125,000');
  assert.equal(formatUsd(125_040), '$1,250.40');
  assert.equal(formatUsd(5), '$0.05');
  assert.equal(formatUsd(Number.NaN), '');
  assert.equal(formatUsdCompact(1_250_000_00), '$1.3M');
  assert.equal(formatUsdCompact(25_000_00), '$25K');
  assert.equal(formatValue('count', 1284), '1,284');
  assert.equal(formatValue('usd', 100), '$1');
});

test('fractional or unsafe cents are refused, never rounded', () => {
  assert.doesNotThrow(() => assertCents(100, 'm-1'));
  for (const bad of [1.5, Number.NaN, Infinity, 2 ** 60]) assert.throws(() => assertCents(bad, 'm-1'), /whole cents/);
});

test('every side has a canonical shape and words, and series color follows input order', () => {
  for (const side of [...SIDES, 'filing', 'none'] as const) {
    assert.ok(SHAPES[side], side);
    assert.ok(SIDE_WORDS[side], side);
  }
  assert.equal(SHAPES.client.tag, 'circle');
  assert.equal(SHAPES.court.tag, 'rect');
  assert.equal(seriesSide(0), 'client');
  assert.equal(seriesSide(1), 'nominal');
  assert.equal(seriesSide(1, 'defendant'), 'defendant', 'a stated side wins');
  assert.equal(seriesSide(5), seriesSide(0));
});

test('long labels are cut with an ellipsis; short ones pass through', () => {
  assert.equal(fitLabel('Roe', 100), 'Roe');
  const cut = fitLabel('Harbor Labs, Inc., a Delaware corporation', 80);
  assert.ok(cut.endsWith('…'));
  assert.ok(cut.length < 20);
});
