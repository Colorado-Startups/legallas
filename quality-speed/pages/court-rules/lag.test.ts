// SPDX-License-Identifier: Apache-2.0
// change_lag's two rules: where a change date comes from, and how a late change counts. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeDate, lagDays } from './lag.ts';

const day = (s: string) => Date.parse(`${s}T00:00:00Z`);

test('a change date comes from Last-Modified, else from a dated file name, else is unknown', () => {
  assert.equal(changeDate('Tue, 26 May 2026 19:08:41 GMT', null), Date.parse('2026-05-26T19:08:41Z'));
  assert.equal(changeDate(null, 'inline; filename="full set of chancery rules (6.1.2026).pdf'), day('2026-06-01'));
  assert.ok(Number.isNaN(changeDate(null, 'inline; filename="COMPS-1885.xml"')));
});

test('a change before its read day lags 0; one after counts days from the change; the longest wins', () => {
  const read = day('2026-11-02');
  const now = day('2026-11-21');
  assert.equal(lagDays([{ changed: day('2026-05-26'), read }, { changed: day('2026-09-04'), read }], now), 0);
  assert.equal(lagDays([{ changed: day('2026-05-26'), read }, { changed: day('2026-11-11'), read }, { changed: day('2026-11-06'), read }], now), 15);
});
