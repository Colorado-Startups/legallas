// SPDX-License-Identifier: Apache-2.0
// The scoring rule. contract/vectors.json holds worked cases, shared with any repository that copies this scoring. There is no cap: a total is the
// plain average of the three lenses. The tests after it cover what those cases can't. All metrics are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Group, Manifest, MetricDef, MetricRecord } from '../contract/format.ts';
import { PAGES, type PageSlug } from '../contract/pages.ts';
import { combine, scoreHome, scorePage, type ScoredRow } from './score.ts';

const NOW = new Date('2026-11-01T12:00:00Z');
const def = (more: Partial<MetricDef> & { id: string }): MetricDef => ({ lens: 'quality', unit: 'ratio', direction: 'higher', floor: 0, goal: 100, weight: 1, max_age_hours: 48, min_samples: 1, ...more });
const record = (more: Partial<MetricRecord> & { id: string }, now = NOW): MetricRecord => ({ page: 'code', value: 100, status: 'ok', stage: 'lab', measured_at: now.toISOString(), source_url: null, sample_size: 1, ...more });
const manifest = (metrics: MetricDef[], groups?: Group[]): Manifest => ({ page: 'code', signoff_comment: 9, metrics, changes: [], ...(groups ? { groups } : {}) });

interface Vector {
  name: string;
  now?: string;
  groups?: Group[];
  metrics: (Partial<MetricDef> & { id: string })[];
  records: (Partial<MetricRecord> & { id: string })[];
  expect: { quality: number; speed: number; consumption: number; raw: number; display: number };
}

const vectors = JSON.parse(readFileSync(new URL('../contract/vectors.json', import.meta.url), 'utf8')) as Vector[];
for (const v of vectors) {
  test(`shared case: ${v.name}`, () => {
    const now = new Date(v.now ?? NOW);
    const result = scorePage('code', manifest(v.metrics.map(def), v.groups), v.records.map((r) => record(r, now)), now);
    assert.equal(Number(result.exact_quality.toFixed(6)), v.expect.quality);
    assert.equal(Number(result.exact_speed.toFixed(6)), v.expect.speed);
    assert.equal(Number(result.exact_consumption.toFixed(6)), v.expect.consumption);
    const exact = Number(((result.exact_quality + result.exact_speed + result.exact_consumption) / 3).toFixed(6));
    assert.equal(exact, v.expect.raw);
    assert.equal(result.total, v.expect.display);
  });
}

const row = (id: string, lens: ScoredRow['lens'], weight: number, score: number): ScoredRow => ({ id, lens, weight, score });

test('all at goal reads exactly 100 with weights the plain form misses in floating point', () => {
  const result = combine([row('a', 'quality', 0.1, 100), row('b', 'quality', 0.2, 100), row('c', 'speed', 0.1, 100), row('d', 'speed', 0.2, 100), row('e', 'consumption', 0.1, 100), row('f', 'consumption', 0.2, 100)]);
  assert.notEqual((result.exact_quality + result.exact_speed + result.exact_consumption) / 3, 100);
  assert.deepEqual([result.quality, result.speed, result.consumption, result.total], [100, 100, 100, 100]);
});

test('100 means every metric is at goal: a hair short never rounds up', () => {
  const result = combine([row('a', 'quality', 100, 100), row('b', 'quality', 1, 99.99999), row('c', 'speed', 1, 100), row('d', 'consumption', 1, 100)]);
  assert.equal(Math.round(((result.exact_quality + result.exact_speed + result.exact_consumption) / 3) * 1e6) / 1e6, 100, 'this test no longer reaches the guard');
  assert.deepEqual([result.quality, result.speed, result.consumption, result.total], [99, 100, 100, 99]);
  assert.equal(combine([row('a', 'quality', 1, 50.9999), row('b', 'speed', 1, 50.9999), row('c', 'consumption', 1, 50.9999)]).total, 50);
  const shortUse = combine([row('a', 'quality', 1, 100), row('b', 'speed', 1, 100), row('c', 'consumption', 100, 100), row('d', 'consumption', 1, 99.99999)]);
  assert.deepEqual([shortUse.consumption, shortUse.total], [99, 99]);
});

test('errors never read as zero, even where zero would be perfect', () => {
  const metrics = [def({ id: 't', direction: 'lower', floor: 10, goal: 0 }), def({ id: 'q' }), def({ id: 's', lens: 'speed' })];
  const scoreOf = (more: Partial<MetricRecord>) => scorePage('code', manifest(metrics), [record({ id: 't', ...more })], NOW).metrics[0];
  assert.equal(scoreOf({ value: 0 })?.score, 100);
  for (const value of [null, undefined, Number.NaN, '0', false] as never[]) {
    assert.deepEqual(scoreOf({ value }), { id: 't', score: 0, reading: 'missing' }, String(value));
  }
  assert.equal(scoreOf({ value: 0, status: 'missing' })?.score, 0);
  assert.equal(scoreOf({ value: 0, status: 'stale' })?.score, 0);
  assert.equal(scoreOf({ value: 0, status: 'broken' as never })?.score, 0);
  assert.equal(scoreOf({ value: 0, measured_at: null })?.score, 0);
});

test('too few samples means a whole number at the minimum, and no_events needs its drill fully at goal', () => {
  const metrics = [def({ id: 't', lens: 'speed', direction: 'lower', floor: 100, goal: 1, coverage_metric: 'd' }), def({ id: 'd' }), def({ id: 'n', min_samples: 5 })];
  const scoreOf = (id: string, records: MetricRecord[]) => scorePage('code', manifest(metrics), records, NOW).metrics.find((m) => m.id === id);
  for (const sample_size of ['5', Number.NaN, null, 4] as never[]) assert.equal(scoreOf('n', [record({ id: 'n', sample_size })])?.reading, 'too_few_samples', String(sample_size));
  assert.equal(scoreOf('n', [record({ id: 'n', sample_size: 5 })])?.score, 100);
  const clean = record({ id: 't', status: 'no_events', value: null, sample_size: 0 });
  assert.deepEqual(scoreOf('t', [clean, record({ id: 'd', value: 50 })]), { id: 't', score: 0, reading: 'no_proof' });
  assert.equal(scoreOf('t', [clean, record({ id: 'd', value: 100 })])?.score, 100);
  assert.equal(scoreOf('t', [{ ...clean, measured_at: '2026-10-01T00:00:00.000Z' }, record({ id: 'd', value: 100 })])?.reading, 'stale');
});

test('each group gets its own scores for the page to show', () => {
  const lenses = (group: string) => (['quality', 'speed', 'consumption'] as const).map((lens) => def({ id: `${group}${lens[0]}`, lens, group }));
  const groups = [{ id: 'a', weight: 40 }, { id: 'b', weight: 60 }];
  const result = scorePage('code', manifest([...lenses('a'), ...lenses('b')], groups), [record({ id: 'aq' }), record({ id: 'as' }), record({ id: 'ac' })], NOW);
  assert.deepEqual(result.groups.map((g) => [g.id, g.weight, g.total]), [['a', 40, 100], ['b', 60, 0]]);
  assert.equal(result.total, 40);
  const noUse = scorePage('code', manifest([...lenses('a').slice(0, 2), ...lenses('b')], groups), [record({ id: 'aq' }), record({ id: 'as' })], NOW);
  assert.deepEqual([noUse.groups[0]?.consumption, noUse.groups[0]?.total], [0, 66], 'a group with no consumption metric scores Consumption 0');
});

test('a page with no signed-off list reads 0 and says so', () => {
  const { signoff_comment: _signoff, ...draft } = manifest([def({ id: 'q' }), def({ id: 's', lens: 'speed' })]);
  for (const list of [null, draft]) {
    const result = scorePage('code', list, [record({ id: 'q' }), record({ id: 's' })], NOW);
    assert.deepEqual([result.total, result.quality, result.speed, result.consumption, result.has_list], [0, 0, 0, 0, false]);
  }
});

test('the home score averages every page once, the data room included, and a page with no score counts as 0', () => {
  const all = Object.fromEntries(PAGES.map((p) => [p, 100])) as Record<PageSlug, number>;
  const parts = PAGES.length;
  assert.equal(scoreHome(all), 100);
  assert.equal(scoreHome({ ...all, 'data-room': 0 }), Math.floor(((parts - 1) * 100) / parts));
  assert.equal(scoreHome({ ...all, code: 0 }), Math.floor(((parts - 1) * 100) / parts));
  assert.equal(scoreHome({ ...all, code: Number.NaN }), Math.floor(((parts - 1) * 100) / parts));
  assert.equal(scoreHome({ ...all, code: 99.999999 }), 99);
  assert.equal(scoreHome({}), 0);
});

test('consumption scores like any lens and counts a third, and a page with none scores Consumption 0', () => {
  const metrics = [def({ id: 'q' }), def({ id: 's', lens: 'speed' }), def({ id: 'tokens', lens: 'consumption', direction: 'lower', floor: 1000, goal: 200, weight: 3 }), def({ id: 'minutes', lens: 'consumption', direction: 'lower', floor: 60, goal: 10 })];
  const records = [record({ id: 'q', value: 90 }), record({ id: 's', value: 60 }), record({ id: 'tokens', value: 600 }), record({ id: 'minutes', value: 5 })];
  const result = scorePage('code', manifest(metrics), records, NOW);
  assert.deepEqual([result.exact_consumption, result.consumption, result.total], [62.5, 62, 70]);
  const none = scorePage('code', manifest(metrics.slice(0, 2)), records.slice(0, 2), NOW);
  assert.deepEqual([none.exact_consumption, none.consumption, none.total], [0, 0, 50]);
  const short = scorePage('code', manifest(metrics), [record({ id: 'q' }), record({ id: 's' }), ...records.slice(2)], NOW);
  assert.deepEqual([short.total, short.consumption], [87, 62], 'consumption short of goal pulls the total down by a third of its gap');
});
