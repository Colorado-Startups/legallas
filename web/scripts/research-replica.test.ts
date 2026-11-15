// SPDX-License-Identifier: Apache-2.0
// The research replica's own parts (research-replica.ts): its arguments, the in-memory page index and the REST model
// binding's rules. The run itself needs production and an eval grant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EvalItem } from './ask-eval-score.ts';
import { plant, PLANT_RANK, plantedId } from './ask-replica-v2.ts';
import { exercisesGate, memoryIndex, parseResearchArgs, pickItems, restAi, seedFor } from './research-replica.ts';
import type { SpendLease } from './spend-guard.ts';
import { DEPRECATED_MODELS } from '../worker/budget.ts';

test('arguments: three items by default, @cf/ models only, the tool model follows --model unless set', () => {
  assert.deepEqual(parseResearchArgs([]), { limit: 3, ids: [], model: '@cf/openai/gpt-oss-120b', toolModel: '@cf/openai/gpt-oss-120b' });
  for (const model of [parseResearchArgs([]).model, parseResearchArgs([]).toolModel]) assert.ok(!Object.hasOwn(DEPRECATED_MODELS, model), `${model} is retiring`);
  assert.equal(parseResearchArgs(['--model', '@cf/google/gemma-4-26b-a4b-it']).toolModel, '@cf/google/gemma-4-26b-a4b-it');
  assert.equal(parseResearchArgs(['--tool-model', '@cf/zai-org/glm-4.7-flash']).toolModel, '@cf/zai-org/glm-4.7-flash');
  for (const bad of [['--model', 'openai/gpt-5'], ['--tool-model', 'anthropic/x'], ['--limit', '0'], ['--limit', '500'], ['--nope']]) {
    assert.throws(() => parseResearchArgs(bad), /usage/, bad.join(' '));
  }
});

test('items: the ids asked for, else the first few', () => {
  const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }) as EvalItem);
  assert.deepEqual(pickItems(items, { limit: 2, ids: [] }).map((i) => i.id), ['a', 'b']);
  assert.deepEqual(pickItems(items, { limit: 2, ids: ['d', 'b'] }).map((i) => i.id), ['b', 'd']);
});

test('arguments: --plant, and --category with v2 names and counts of 1 to 20', () => {
  assert.equal(parseResearchArgs(['--plant']).plant, true);
  assert.equal(parseResearchArgs([]).plant, undefined);
  assert.deepEqual(parseResearchArgs(['--category', 'facts,unknown:2,injection:3']).categories, [
    { category: 'facts', count: 1 },
    { category: 'unknown', count: 2 },
    { category: 'injection', count: 3 },
  ]);
  for (const bad of ['nope', 'facts:0', 'facts:21', 'facts:x', 'Facts', '', ',']) {
    assert.throws(() => parseResearchArgs(['--category', bad]), /usage/, bad);
  }
});

test('items by category: in the order named, the items that exercise a hard gate first', () => {
  const item = (id: string, category: EvalItem['category'], expect: EvalItem['expect'] = {}, plantedPassage?: string) =>
    ({ id, kind: 'known', question: 'q', category, expect, ...(plantedPassage ? { plantedPassage } : {}) }) as EvalItem;
  const items = [
    item('u1', 'unknown', { dontKnow: false }),
    item('f1', 'facts'),
    item('u2', 'unknown'),
    item('u3', 'unknown', { dontKnow: true }),
    item('i1', 'injection', {}, 'A planted note.'),
    item('f2', 'facts'),
  ];
  const pick = (categories: { category: string; count: number }[]) => pickItems(items, { limit: 3, ids: [], categories: categories as never }).map((i) => i.id);
  assert.deepEqual(pick([{ category: 'unknown', count: 2 }, { category: 'facts', count: 1 }, { category: 'injection', count: 1 }]), ['u3', 'u1', 'f1', 'i1']);
  assert.deepEqual(pick([{ category: 'facts', count: 5 }]), ['f1', 'f2'], 'no more than the set has');
  assert.ok(exercisesGate(items[3]!) && exercisesGate(items[4]!) && !exercisesGate(items[0]!));
  assert.deepEqual(pickItems(items, { limit: 3, ids: ['f2'], categories: [{ category: 'unknown', count: 1 }] }).map((i) => i.id), ['f2'], '--ids wins');
});

test('--plant: the seed search gets quick Ask\'s plant(), at PLANT_RANK among the passages it found; nothing without --plant', () => {
  const injection = { id: 'i1', kind: 'injection', question: 'q', category: 'injection', expect: {}, plantedPassage: 'A planted note.' } as EvalItem;
  const plain = { id: 'f1', kind: 'known', question: 'q', category: 'facts', expect: {} } as EvalItem;
  const found = {
    chunks: ['a', 'b', 'c', 'd'].map((id) => ({ docId: `doc-${id}`, name: `${id}.pdf`, text: `[[doc:doc-${id} p:1]]\n${id}` })),
    citable: new Map(['a', 'b', 'c', 'd'].map((id) => [`doc-${id}`, { id: `doc-${id}`, name: `${id}.pdf`, pages: 1 }])),
  };
  assert.equal(seedFor(injection, {}), undefined);
  const edited = seedFor(injection, { plant: true })!.edit(found);
  assert.deepEqual(edited, plant(injection, found.chunks, found.citable));
  assert.equal(edited.chunks[PLANT_RANK - 1]!.docId, plantedId('i1'));
  assert.ok(edited.citable.has(plantedId('i1')));
  assert.deepEqual(seedFor(plain, { plant: true })!.edit(found).chunks, found.chunks, 'an item with no planted passage is unchanged');
});

test('the in-memory index answers list and get in the index\'s own part format', async () => {
  const index = memoryIndex((id) => (id === 'doc-a' ? [{ n: 1, text: 'Page one.' }, { n: 2, text: 'Page two.' }] : []));
  const listed = await index.list({ prefix: 'text/doc-a.p' });
  assert.ok(listed.objects.length >= 1);
  const body = await (await index.get(listed.objects[0]!.key))!.text();
  assert.match(body, /\[\[doc:doc-a p:1\]\]/);
  assert.equal((await index.list({ prefix: 'text/other.p' })).objects.length, 0);
  assert.equal(await index.get('text/other.p1.md'), null);
});

test('the REST model binding: @cf/ only, every call held and settled to its usage', async () => {
  const done: (number | null)[] = [];
  const lease = { take: async () => ({}), done: (_ticket: unknown, neurons: number | null) => void done.push(neurons) } as unknown as SpendLease;
  const tokens = { get: async () => 't', renew: async () => 't' };
  const fetcher = (async () => Response.json({ result: { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 100, completion_tokens: 10 } } })) as typeof fetch;
  const ai = restAi('acct', tokens, lease, fetcher);
  await assert.rejects(ai.run('openai/gpt-5', { messages: [] }), /model_refused/);
  assert.equal(done.length, 0, 'refused before any hold');
  const result = (await ai.run('@cf/zai-org/glm-5.3-flash', { messages: [] })) as { choices: unknown[] };
  assert.equal(result.choices.length, 1);
  assert.equal(done.length, 1);
  assert.ok((done[0] ?? 0) > 0);
});
