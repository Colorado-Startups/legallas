// SPDX-License-Identifier: Apache-2.0
// The page as the build calls it, on the baseline: inside the word budget the guard counts, and Road to 100 counting
// only changes the readings don't already hold.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Manifest, MetricRecord } from '../../contract/format.ts';
import { joinMetrics } from '../../contract/validate.ts';
import { countWords } from '../../core/guard.ts';
import { scorePage } from '../../core/score.ts';
import { render, roadFixes, type Change } from './page.ts';

const read = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
// Scored as a signed-off list: an unsigned list takes no readings and scores 0.
const manifest = { ...read('./manifest.json'), signoff_comment: 1 } as Manifest;
const baseline = read('./baseline/metrics.json') as MetricRecord[];
const changes = read('./changes.json').changes as Change[];
const metrics = joinMetrics(manifest, baseline);

test('the baseline page fits the budget with the title, ring and nav the build adds', () => {
  const score = scorePage('ci-overview', manifest, baseline, new Date('2026-11-02T04:56:00Z'));
  const { body } = render({ score, metrics, history: [], others: {}, detail: null });
  // The build adds "Home", "CI overview" and the ring's "Quality" and "Speed": 5 words.
  assert.ok(countWords(body) + 5 <= 80, `visible words: ${countWords(body)} + 5`);
  // Quality 33.98 (gates 0, pushes 70, reviews 45, repeats 21), Speed 94, Consumption 0 (no lane reading yet), to a hundredth:
  // a third each is 42.
  const exact = { q: score.exact_quality, s: score.exact_speed, c: score.exact_consumption };
  assert.deepEqual([exact.q, exact.s, exact.c].map((v) => Math.round(v * 100) / 100), [33.98, 94, 0]);
  assert.equal(score.total, 42);
  assert.match(body, /<details open><summary>Docs/);
});

test('Road to 100: measured effects score; a change already in the readings does not', () => {
  const repeat = roadFixes(metrics, changes).find((f) => f.id === 'ready-rerun');
  // Repeats 0.789 to 0.078, floor 1 and goal 0, weight 1 of 4 quality: about 18 points.
  assert.ok(repeat && repeat.q > 17 && repeat.q < 19);
  const later = joinMetrics(manifest, baseline.map((r) => ({ ...r, measured_at: '2026-11-03T00:00:00Z' })));
  assert.ok(!roadFixes(later, changes).some((f) => f.id === 'slim-small'));
});
