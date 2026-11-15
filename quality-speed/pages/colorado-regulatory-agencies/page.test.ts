// SPDX-License-Identifier: Apache-2.0
// Every need on the reviewed list belongs to one of the department's divisions, and the infographic counts it there, held
// only when law.json says so, so a new need can't go unseen and a missing view never reads as good.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { LawView } from '../../core/law/law.ts';
import { byDivision, division, DIVISIONS } from './page.ts';

const { needs } = JSON.parse(readFileSync(new URL('./needs.json', import.meta.url), 'utf8')) as { needs: { id: string }[] };

test('every need on the list sits in a division, and a need with none fails', () => {
  for (const n of needs) assert.ok(division(n.id) in DIVISIONS, n.id);
  assert.throws(() => division('licensing-x'), /no division/);
});

test('the infographic counts each division\'s needs, held only when the view says so, and no view reads red', () => {
  const view = { rows: needs.map((n, i) => ({ id: n.id, covered: i === 0 })) } as unknown as LawView;
  const html = byDivision(view);
  assert.equal(html.match(/qs-pictogram/g)?.length, Object.keys(DIVISIONS).length);
  assert.equal(html.match(/is-on/g)?.length, 1);
  assert.equal(html.match(/qs-pic /g)?.length, needs.length);
  assert.match(byDivision(null), /is-missing/);
});
