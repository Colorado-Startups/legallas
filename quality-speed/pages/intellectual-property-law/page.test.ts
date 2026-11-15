// SPDX-License-Identifier: Apache-2.0
// Every need on the reviewed list has a place on the IP map, so a new one can't go unseen; a missing view never reads as
// good; and a held need whose deadline isn't stated fails its cell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { LawView, NeedsList } from '../../core/law/law.ts';
import { ipMap, MAP, RIGHTS, STEPS } from './page.ts';

const list = JSON.parse(readFileSync(new URL('./needs.json', import.meta.url), 'utf8')) as NeedsList;
const view = (flags: boolean) =>
  ({ rows: list.needs.map((n) => ({ id: n.id, covered: true, checks: { flags: n.flags?.length ? flags : null } })) }) as unknown as LawView;

test('every need sits on the map, in cells the map draws', () => {
  for (const n of list.needs) {
    assert.ok(MAP[n.id]?.length, `${n.id} has no place`);
    for (const [right, step] of MAP[n.id]!) assert.ok(RIGHTS.includes(right) && STEPS.includes(step), `${n.id}: ${right}, ${step}`);
  }
  assert.doesNotThrow(() => ipMap(list, view(true)));
});

test('with no view the map is a red tile; a deadline not stated fails its cell', () => {
  assert.match(ipMap(list, null), /is-missing/);
  assert.doesNotMatch(ipMap(list, null), /qs-dm-pass/);
  const pass = (html: string) => html.match(/qs-dm-pass/g)?.length ?? 0;
  assert.ok(pass(ipMap(list, view(false))) < pass(ipMap(list, view(true))));
});
