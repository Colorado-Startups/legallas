// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { codeDate, lagDays, unitDates } from './lag.ts';

const day = (d: string) => Date.parse(`${d}T00:00:00Z`);

test('the Code date is read from the home page text, and a page without it reads null', () => {
  assert.equal(codeDate('<p>This version includes all acts enacted as of <b>October 01, 2026</b>, up to and including 85 Del. Laws, c. 550.</p>'), day('2026-10-01'));
  assert.equal(codeDate('<p>Welcome</p>'), null);
});

test('units give their Enacted through date, an absent unit is skipped, and one with no date reads null', () => {
  const plan = '[[unit]]\nid = "de-a"\nas_of = "Enacted through 2026-08-01; HB 1"\n\n[[unit.on_path]]\npath = "x"\n\n[[unit]]\nid = "de-b"\nas_of = "No date"\n';
  assert.deepEqual(unitDates(plan, ['de-a', 'de-missing']), [day('2026-08-01')]);
  assert.equal(unitDates(plan, ['de-a', 'de-b']), null);
});

test("the lag is the oldest unit's gap, 0 when every unit is current, and null with no unit or one dated after the Code", () => {
  assert.equal(lagDays(day('2026-10-01'), [day('2026-10-01'), day('2026-08-01')]), 61);
  assert.equal(lagDays(day('2026-10-01'), [day('2026-10-01')]), 0);
  assert.equal(lagDays(day('2026-10-01'), [day('2026-10-01'), day('2026-11-01')]), null);
  assert.equal(lagDays(day('2026-10-01'), []), null);
});
