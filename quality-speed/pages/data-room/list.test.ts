// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { namesTest } from './evaluate.ts';
import { buildManifest, EXCLUDED, GOALS, laneOf, lensOf, metricsOfCell, READS, ROOMS, ROWS, SHARED_TIMINGS, USERS } from './list.ts';

/** A change here is a change to what the page scores, and belongs in review. */
const PINNED: { rows: number } & Record<string, unknown> = {"rows":131,"forming":[39,8,6],"vc":[47,5,1],"angel":[9,3,1],"dispute":[58,3,1]};

const committed = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const manifest = buildManifest(committed.signoff_comment);

test('manifest.json is what the list generates', () => {
  assert.deepEqual({ ...committed, changes: [] }, manifest);
});

test('every id says its room, user and goal, and repeats nowhere', () => {
  assert.equal(new Set(ROWS.map((r) => r.id)).size, ROWS.length);
  for (const { id } of ROWS) {
    assert.match(id, /^[a-z]+\.[a-z]+\.[a-z]+\.[a-z0-9_]+$/);
    const [room, user, goal] = id.split('.');
    assert.ok((ROOMS as readonly string[]).includes(room!), id);
    assert.ok(user === 'member' || (USERS as readonly string[]).includes(user!), id);
    assert.ok((GOALS as readonly string[]).includes(goal!), id);
  }
});

test('find is speed, cost is consumption, the rest is quality, and each room has all three', () => {
  for (const m of manifest.metrics) assert.equal(m.lens, { find: 'speed', cost: 'consumption' }[m.id.split('.')[2] as string] ?? 'quality', m.id);
  for (const room of ROOMS) {
    const rows = manifest.metrics.filter((m) => m.group === room);
    assert.ok(['quality', 'speed', 'consumption'].every((lens) => rows.some((m) => m.lens === lens)), room);
  }
});

test('the plan\'s shares hold', () => {
  assert.deepEqual(manifest.groups, [{ id: 'forming', weight: 40 }, { id: 'vc', weight: 20 }, { id: 'angel', weight: 20 }, { id: 'dispute', weight: 20 }]);
});

test('every human cell either reads metrics or is excluded with a reason, never both', () => {
  for (const room of ROOMS) for (const user of USERS.filter((u) => u !== 'ai')) for (const goal of GOALS) {
    const key = `${room}.${user}.${goal}`;
    assert.notEqual(metricsOfCell(key).length > 0, key in EXCLUDED, key);
  }
});

test('every metric feeds a cell, and a cell only reads its own goal', () => {
  const cells = ROOMS.flatMap((room) => USERS.flatMap((user) => GOALS.map((goal) => `${room}.${user}.${goal}`)));
  const fed = new Set(cells.flatMap((cell) => metricsOfCell(cell)));
  assert.deepEqual(ROWS.map((r) => r.id).filter((id) => !fed.has(id)), []);
  for (const cell of Object.keys(READS)) for (const id of metricsOfCell(cell)) assert.equal(id.split('.')[2], cell.split('.')[2], `${cell} reads ${id}`);
});

test('the list\'s size and each room\'s weights are pinned, so adding easy rows has to show in review', () => {
  const sum = (room: string, lens: string) => manifest.metrics.filter((m) => m.group === room && m.lens === lens).reduce((total, m) => total + m.weight, 0);
  assert.equal(ROWS.length, PINNED.rows);
  for (const room of ROOMS) assert.deepEqual([sum(room, 'quality'), sum(room, 'speed'), sum(room, 'consumption')], PINNED[room], room);
});

test('every test a row names is one file and at least one name, so a row can\'t point at a whole file', () => {
  for (const { id, evidence } of ROWS) if ('test' in evidence) assert.ok(evidence.names.length > 0 && evidence.names.every((n) => n !== ''), id);
});

/** The titles a test file declares, read from its source: a renamed test then fails here, not as a gate reading 0. */
function declaredTests(file: string): string[] {
  const source = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
  return [...source.matchAll(/\b(?:test|it|describe)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]!.replace(/\\(.)/g, '$1')); // safe: group 2 always takes part
}

test('every name a row gives finds a test in its file, as the lane matches it', () => {
  for (const { id, evidence } of ROWS) {
    if (!('test' in evidence)) continue;
    const tests = declaredTests(evidence.test);
    for (const name of evidence.names) assert.ok(tests.some((t) => namesTest(t, name)), `${id}: no test in ${evidence.test} starts "${name}"`);
  }
});

test('a row\'s weight is 1 or 3, and the lanes split the rows between them with none left out', () => {
  for (const m of manifest.metrics) assert.ok(m.weight === 1 || m.weight === 3, m.id);
  for (const id of SHARED_TIMINGS) assert.ok(ROWS.some((r) => r.id === id), id);
  for (const id of SHARED_TIMINGS) assert.equal(laneOf(id), 'dispute', id);
});

test('the weekly angel lane writes no gate test, which would go stale between its runs', () => {
  const lanes = JSON.parse(readFileSync(new URL('./lanes.json', import.meta.url), 'utf8')) as { args?: string[]; cadence: string }[];
  assert.equal(lanes.find((lane) => lane.args?.[0] === 'angel')?.cadence, 'weekly');
  assert.deepEqual(ROWS.filter((r) => laneOf(r.id) === 'angel' && 'test' in r.evidence).map((r) => r.id), []);
});

test('every goal source is a public https page, and every row carries one', () => {
  for (const m of manifest.metrics) if ('goal_source' in m) assert.match(String(m.goal_source), /^https:\/\/[a-z0-9.-]+\//, m.id);
  assert.ok(manifest.metrics.filter((m) => 'goal_source' in m).length >= 131);
});

test('the dispute room\'s own retrieval is written by the dispute lane, which seeds that room', () => {
  for (const { id } of ROWS) if (id.startsWith('dispute.member.trust.')) assert.equal(laneOf(id), 'dispute', id);
  for (const { id } of ROWS) if (id.startsWith('forming.member.trust.')) assert.equal(laneOf(id), 'forming', id);
});

test('nothing here scores what its own page scores: connected AI, sync and templates stay off this list', () => {
  for (const { id } of ROWS) assert.doesNotMatch(id, /\.ai\.|sync|connector|template_coverage/, id);
});
