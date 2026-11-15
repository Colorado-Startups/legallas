// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lagDays, titles } from './lag.ts';

test('change_lag counts from the first official change after the check, and is 0 with none', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  assert.equal(lagDays('2026-11-01', ['2026-10-20'], now), 0);
  assert.equal(lagDays('2026-11-01', ['2026-11-15', '2026-11-10'], now), 10);
  assert.equal(lagDays('2026-11-01', ['2026-12-01'], now), 0);
});

test('titles reads the plan check date and each relied-on Delaware Code title once', () => {
  const plan = [
    'checked = "2026-11-01"',
    '',
    '[[unit]]', 'id = "de-a"', 'official_url = "https://delcode.delaware.gov/title8/c001/index.html"',
    '[[unit]]', 'id = "de-b"', 'official_url = "https://delcode.delaware.gov/title8/c005/index.html"',
    '[[unit]]', 'id = "de-c"', 'official_url = "https://delcode.delaware.gov/title6/c018/index.html"',
    '[[unit]]', 'id = "de-d"', 'official_url = "https://regulations.delaware.gov/AdminCode/title6/Rules"',
  ].join('\n');
  assert.deepEqual(titles(plan, new Set(['unit:de-a', 'unit:de-b', 'unit:de-d', 'item:x'])), { checked: '2026-11-01', titles: ['8'] });
  assert.deepEqual(titles(plan, new Set(['unit:de-c', 'unit:de-a'])), { checked: '2026-11-01', titles: ['8', '6'] });
});
