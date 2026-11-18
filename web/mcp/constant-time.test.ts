// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import { constantTimeEqual, type TimingSafeEqual } from './constant-time.ts';

const PAIRS: readonly [string, string, boolean][] = [
  ['abc', 'abc', true],
  ['abc', 'abd', false],
  ['abc', 'abcd', false],
  ['', '', true],
  ['', 'a', false],
  ['é', 'é', false],
];

test('equal strings match; any other pair, a different length included, does not (Node, no timingSafeEqual)', async () => {
  for (const [a, b, equal] of PAIRS) assert.equal(await constantTimeEqual(a, b), equal, JSON.stringify([a, b]));
});

test('where the runtime has timingSafeEqual (Workers), it gets the two 32-byte SHA-256 digests', async () => {
  const seen: number[][] = [];
  const workers: TimingSafeEqual = (a, b) => {
    seen.push([a.byteLength, b.byteLength]);
    return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
  };
  for (const [a, b, equal] of PAIRS) assert.equal(await constantTimeEqual(a, b, workers), equal, JSON.stringify([a, b]));
  assert.deepEqual(seen, PAIRS.map(() => [32, 32]), 'never the raw values, so never two lengths');
});
