// SPDX-License-Identifier: Apache-2.0
// What a plan says it deletes, and how much of an upload a month can hold. Nothing reaches Cloudflare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_KEY, deletionLines, planUpload, stagePlan } from './plan.ts';

test('a plan that deletes names every unit it takes out', () => {
  assert.deepEqual(deletionLines([]), []);
  const plan = planUpload({ [CATALOG_KEY]: 'a' }, { [CATALOG_KEY]: 'a', 'law/both/crs-7-80-404~1.md': 'b', 'law/both/crs-7-80-404~2.md': 'c', 'law/civil/usc-15-77a.md': 'd' });
  assert.deepEqual(deletionLines(plan.remove), ['This plan DELETES 3 parts of 2 law units from the library:', '  crs-7-80-404 (2 parts)', '  usc-15-77a (1 part)']);
});

test('a room that loses its packs.json sees every unit its dry run would delete, not just a count', () => {
  const before = { [CATALOG_KEY]: 'a', 'law/civil/case-1-p3d-1.md': 'b', 'law/regulator/ccr-704-1-r51-4-1.md': 'c' };
  const lines = deletionLines(planUpload({ [CATALOG_KEY]: 'z' }, before).remove);
  assert.ok(lines.some((line) => line.includes('case-1-p3d-1')) && lines.some((line) => line.includes('ccr-704-1-r51-4-1')));
});

const keys = (n: number) => Array.from({ length: n }, (_, i) => `law/both/usc-15-${i + 1}.md`);
const built = (order: readonly string[]) => Object.fromEntries([...order, CATALOG_KEY].map((key) => [key, 'x']));
const byPartCount = async (batch: readonly string[]) => batch.length;
const oneAct = () => 'an-act';
/** Acts of two parts each: the first two keys are act 0, the next two act 1. */
const actOfTwo = (order: readonly string[]) => (key: string) => `act-${Math.floor(order.indexOf(key) / 2)}`;

test('an upload that fits goes up whole', async () => {
  const order = keys(3);
  const plan = planUpload(built(order), {});
  const stage = await stagePlan(plan, order, {}, oneAct, byPartCount, async () => true);
  assert.deepEqual(stage.plan.put, plan.put);
  assert.deepEqual(stage.later, []);
  assert.deepEqual(stage.laterActs, []);
});

test('an upload past the allowance takes whole acts in build order, keeps the catalog, and names what waits', async () => {
  const order = keys(6).reverse(); // build order, which the sorted plan does not keep
  const plan = planUpload(built(order), {});
  const held: number[] = [];
  const stage = await stagePlan(plan, order, {}, actOfTwo(order), byPartCount, async (chars) => {
    if (held.length === 1) return false;
    held.push(chars);
    return true;
  });
  assert.deepEqual(held, [2]);
  assert.deepEqual(stage.plan.put, [...order.slice(0, 2), CATALOG_KEY].sort());
  assert.deepEqual(stage.later, order.slice(2));
  assert.deepEqual(stage.laterActs, ['act-1', 'act-2']);
});

test('no act is ever split, and once one waits the later ones wait too, even if they would fit', async () => {
  const order = keys(4);
  const plan = planUpload(built(order), {});
  const answers = [false, true];
  const stage = await stagePlan(plan, order, {}, actOfTwo(order), byPartCount, async () => answers.shift() ?? true);
  assert.deepEqual(stage.plan.put, []);
  assert.deepEqual(stage.laterActs, ['act-0', 'act-1']);
  assert.equal(answers.length, 1, 'asked again after the first refusal');
});

test('a later run plans only what is left', async () => {
  const order = keys(4);
  const firstDone = { [order[0]!]: 'x', [order[1]!]: 'x', [CATALOG_KEY]: 'x' };
  const plan = planUpload(built(order), firstDone);
  const stage = await stagePlan(plan, order, firstDone, oneAct, byPartCount, async () => true);
  assert.deepEqual(stage.plan.put, [order[2]!, order[3]!].sort());
});

test('a month with no room uploads no parts and no catalog', async () => {
  const order = keys(2);
  const plan = planUpload(built(order), {});
  const stage = await stagePlan(plan, order, {}, oneAct, byPartCount, async () => false);
  assert.deepEqual(stage.plan.put, []);
  assert.equal(stage.later.length, 2);
});

test('a re-split section goes up before its old part is deleted, or nothing does', async () => {
  const uploaded = { [CATALOG_KEY]: 'old', 'law/both/usc-15-77a.md': 'old' };
  const order = ['law/both/usc-15-77a~1.md', 'law/both/usc-15-77a~2.md', 'law/both/usc-15-78a.md'];
  const plan = planUpload(built(order), uploaded);
  assert.deepEqual(plan.remove, ['law/both/usc-15-77a.md']);
  await assert.rejects(stagePlan(plan, order, uploaded, oneAct, byPartCount, async () => false), /changes whole or not at all/);
  const answers = [true, false];
  const stage = await stagePlan(plan, order, uploaded, oneAct, byPartCount, async () => answers.shift() ?? false);
  assert.deepEqual(stage.plan.put, [CATALOG_KEY, 'law/both/usc-15-77a~1.md', 'law/both/usc-15-77a~2.md'].sort());
  assert.deepEqual(stage.plan.remove, ['law/both/usc-15-77a.md']);
  assert.deepEqual(stage.later, ['law/both/usc-15-78a.md']);
});

test('an amended part already in the library is never held back under a new catalog', async () => {
  const uploaded = { [CATALOG_KEY]: 'old', 'law/both/usc-15-1.md': 'old text' };
  const order = keys(1);
  const plan = planUpload(built(order), uploaded);
  await assert.rejects(stagePlan(plan, order, uploaded, oneAct, byPartCount, async () => false), /changes whole or not at all/);
});

test('a planned part the order leaves out is an error, never dropped', async () => {
  const plan = planUpload(built(keys(2)), {});
  await assert.rejects(stagePlan(plan, keys(1), {}, oneAct, byPartCount, async () => true), /leaves out 1 planned parts/);
});
