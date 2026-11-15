// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { MetricDef, MetricRecord } from '../contract/format.ts';
import { stepMetrics, toDef, toEntry } from './adapt.ts';

const def: MetricDef = { id: 'pushes_per_merge', lens: 'quality', unit: 'ratio', direction: 'lower', floor: 6, goal: 2, weight: 1, max_age_hours: 48, min_samples: 10 };
const now = Date.parse('2026-11-05T12:00:00Z');
const rec = (o: Partial<MetricRecord>): MetricRecord => ({ id: def.id, page: 'ci-overview', value: 2.4, status: 'ok', stage: 'live', measured_at: '2026-11-05T06:00:00Z', source_url: 'https://github.com/Colorado-Startups/legallas/actions/runs/1', sample_size: 50, ...o });

test('a manifest metric becomes a Git Crafter definition with its goal and floor', () => {
  const d = toDef('ci-overview', def);
  assert.deepEqual([d.id, d.kind, d.goal, d.near, d.direction], ['legallas.ci-overview.pushes_per_merge', 'quality', 2, 6, 'lower']);
  assert.equal(d.goal_source, 'quality-speed/pages/ci-overview/manifest.json');
});

test('only a fresh ok reading with enough samples carries a value', () => {
  assert.equal((toEntry(def, rec({}), now) as { value: number }).value, 2.4);
  for (const r of [undefined, rec({ status: 'missing', value: null }), rec({ status: 'no_events', value: null }), rec({ measured_at: '2026-11-01T00:00:00Z' }), rec({ sample_size: 3 })]) {
    assert.ok('could_not_check' in toEntry(def, r, now));
  }
});

test('every map step names one metric, at most 6 steps a map', () => {
  const maps = JSON.parse(readFileSync(new URL('maps.json', import.meta.url), 'utf8'));
  for (const m of maps.maps) {
    const steps = Object.values(m.steps as Record<string, { metric?: string }>);
    assert.ok(steps.length <= 6, m.id ?? m.use);
    if (m.id) for (const s of steps) assert.match(s.metric ?? '', /^legallas\.[a-z-]+\.[a-z0-9_]+$/);
  }
  assert.ok(stepMetrics(maps).length >= 15);
});
