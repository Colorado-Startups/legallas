// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { MetricDef, MetricRecord } from '../contract/format.ts';
import { isPublicPage, PAGE_GROUPS, PUBLIC_PAGES } from '../contract/pages.ts';
import { IDEAL_MAX_WORDS } from '../contract/validate.ts';
import { processLink } from '../core/guard.ts';
import { adapt, stepMetrics, toDef, toEntry } from './adapt.ts';

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
    if (m.id) for (const s of steps) assert.match(s.metric ?? '', /^legallas\.[a-z-]+\.[a-z0-9_]+(?:\.[a-z0-9_]+)*$/);
  }
  assert.ok(stepMetrics(maps).length >= 15);
});

test('every map of our own opens with an ideal of 25 words at most and a dated source', () => {
  const maps = JSON.parse(readFileSync(new URL('maps.json', import.meta.url), 'utf8'));
  const own = maps.maps.filter((m: { id?: string }) => m.id);
  assert.equal(own.length, 8);
  for (const m of own) {
    assert.ok(typeof m.ideal === 'string' && m.ideal.split(/\s+/).length <= IDEAL_MAX_WORDS, m.id);
    assert.ok(Array.isArray(m.sources) && m.sources.length > 0, m.id);
    for (const s of m.sources) assert.match(`${s.title}|${s.url}|${s.date}`, /^[^|]+\|https:\/\/[^|]+\|\d{4}-\d{2}-\d{2}$/, m.id);
  }
});

test('a library step is dropped only for want of a public measurement', () => {
  const maps = JSON.parse(readFileSync(new URL('maps.json', import.meta.url), 'utf8'));
  const dropped = maps.maps.flatMap((m: { id?: string; use?: string; steps: Record<string, { drop?: boolean }> }) =>
    m.id ? [] : Object.entries(m.steps ?? {}).filter(([, s]) => s.drop).map(([id]) => `${m.use}.${id}`),
  );
  assert.deepEqual(dropped, ['board.split', 'board.finish', 'contribute.review', 'contribute.merge', 'contribute.rebuild', 'adopt.copy', 'adopt.check', 'adopt.update']);
});

test('every step metric is defined by its page, no step names a private page, and every public page but the law pages sits on a map', () => {
  const state = mkdtempSync(path.join(tmpdir(), 'qs-process-'));
  const { defs, metrics } = adapt(state, path.join(state, 'out'));
  assert.equal(defs.length, Object.keys(metrics).length);
  assert.ok(defs.some((d) => d.id === 'legallas.data-room.forming.member.trust.exact_quotes'));
  assert.ok(Object.values(metrics).every((e) => 'could_not_check' in e), 'an empty state measures nothing');
  const mapped = new Set(defs.map((d) => String(d.id).split('.')[1] ?? ''));
  // A private page never runs in this public repository (contract/pages.ts), so no step may name one.
  assert.deepEqual([...mapped].filter((p) => !isPublicPage(p)), []);
  // The law pages share the `law` map through `sec`. actions, ci-overview and pull-requests lost their maps while they were
  // private (#20); they may be public again without one until a map is made for them.
  const mayLack: readonly string[] = [...PAGE_GROUPS.law.filter((p) => p !== 'sec' && p !== 'templates'), 'actions', 'ci-overview', 'pull-requests'];
  const unmapped = PUBLIC_PAGES.filter((p) => !mapped.has(p));
  assert.deepEqual(unmapped.filter((p) => !mayLack.includes(p)), []);
  for (const p of PAGE_GROUPS.law) if (p !== 'sec' && p !== 'templates') assert.ok(unmapped.includes(p), `${p} runs the law map through sec`);
});

test('every link the maps carry passes the publish guard, so the Process page can go out', () => {
  const text = readFileSync(new URL('maps.json', import.meta.url), 'utf8') + readFileSync(new URL('process.json', import.meta.url), 'utf8');
  const links = [...text.matchAll(/https:\/\/[^"\s]+/g)].map((m) => m[0]);
  assert.ok(links.length >= 10, `${links.length} links`);
  assert.deepEqual(links.filter((url) => !processLink(url)), []);
});
