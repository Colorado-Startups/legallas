// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { lagDays, titles } from './collect.ts';

test('change_lag counts from the first official change after the check, and is 0 with none', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  assert.equal(lagDays('2026-11-01', ['2026-10-02'], now), 0);
  assert.equal(lagDays('2026-11-01', ['2026-11-10', '2026-11-15'], now), 10);
  assert.equal(lagDays('2026-11-01', ['2026-12-01'], now), 0);
  assert.equal(lagDays('', ['2026-11-18'], now), 2);
});

test('titles reads the plan check date and each relied-on olls.info title once, never a rule on another host', () => {
  const plan = [
    'checked = "2026-11-01"',
    '',
    '[[unit]]\nid = "co-a"\nofficial_url = "https://olls.info/crs/crs2026-title-11.pdf"',
    '[[unit]]\nid = "co-b"\nofficial_url = "https://olls.info/crs/crs2026-title-11.pdf"',
    '[[unit]]\nid = "co-rules"\nofficial_url = "https://www.coloradosos.gov/CCR/DisplayRule.do?action=ruleinfo&ruleId=2207"',
    '[[unit]]\nid = "co-c"\nofficial_url = "https://olls.info/crs/crs2026-title-24.pdf"',
    '',
  ].join('\n');
  assert.deepEqual(titles(plan, new Set(['unit:co-a', 'unit:co-b', 'unit:co-rules', 'item:x'])), { checked: '2026-11-01', files: [{ title: '11', edition: 2026 }] });
  assert.deepEqual(titles(plan, new Set(['unit:co-gone'])).files, []);
});
