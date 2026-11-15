// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lagDays, sources } from './lag.ts';

const plan = `checked = "2026-11-01"

[[unit]]
id = "a"
citation = "C.R.S. 8-4-101 and following"
host = "olls"
official_url = "https://olls.info/crs/crs2026-title-08.pdf"
as_of = "C.R.S. 2026; amended by SB 25-083 on or after 2025-08-06"

[[unit]]
id = "b"
citation = "29 U.S.C. 213(a)(1); 29 CFR Part 541"
host = "ecfr-api"
as_of = "eCFR as of 2026-10-29"

[[unit]]
id = "c"
citation = "C.R.S. 8-2-113"
host = "olls"
official_url = "https://olls.info/crs/crs2026-title-08.pdf"
`;

test('each relied-on feed once: a C.F.R. part against its as_of date, a C.R.S. title against the plan check', () => {
  assert.deepEqual(sources(plan, new Set(['unit:a', 'unit:b', 'unit:c', 'item:x'])), [
    { kind: 'crs', year: 2026, title: '08', since: '2026-11-01' },
    { kind: 'cfr', title: '29', part: '541', since: '2026-10-29' },
  ]);
  assert.deepEqual(sources(plan, new Set(['unit:z'])), []);
});

test('lag runs from the earliest change the plan does not reflect, and ignores changes still to come', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  assert.equal(lagDays('2026-10-29', ['2024-07-01', '2026-05-15'], now), 0);
  assert.equal(lagDays('2026-10-01', ['2026-10-12', '2026-10-30'], now), 21);
  assert.equal(lagDays('2026-10-01', ['2027-01-01'], now), 0);
});
