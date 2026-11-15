// SPDX-License-Identifier: Apache-2.0
// change_lag counts only an amendment the plan's as_of doesn't reflect, and reads each stored title 17 part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lagDays, parts } from './collect.ts';

test('lag runs from the first amendment after as_of, and is 0 when the plan is current', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  assert.equal(lagDays('2026-10-29', ['2024-09-30', '2026-10-28'], now), 0);
  assert.equal(lagDays('2026-10-20', ['2026-10-28', '2026-10-30', '2026-12-01'], now), 5);
});

test('each relied-on CFR unit gives its parts and as_of date; statutes and other units give none', () => {
  const plan = [
    '[[unit]]', 'id = "a"', 'citation = "17 CFR Parts 232 and 239"', 'as_of = "eCFR as of 2026-10-29"',
    '[[unit]]', 'id = "b"', 'citation = "15 U.S.C. 77a et seq."', 'as_of = "Compilation through P.L. 119-27 (2025-07-18)"',
    '[[unit]]', 'id = "c"', 'citation = "17 CFR Part 230"', 'as_of = "eCFR as of 2026-10-29"',
  ].join('\n');
  assert.deepEqual(parts(plan, new Set(['unit:a', 'unit:b'])), [{ part: '232', asOf: '2026-10-29' }, { part: '239', asOf: '2026-10-29' }]);
});
