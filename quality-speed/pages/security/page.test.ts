// SPDX-License-Identifier: Apache-2.0
// The Security page's own logic. The rendered page is checked in CI, through screenshots and the word count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandClass, layerScore, scorecardName, shield } from './page.ts';

test('a layer reads as its weakest metric', () => {
  const scores: Record<string, number> = { a: 100, b: 40, c: 70 };
  assert.equal(layerScore(['a'], (id) => scores[id] ?? 0), 100);
  assert.equal(layerScore(['a', 'b', 'c'], (id) => scores[id] ?? 0), 40);
  assert.equal(layerScore(['a', 'unknown'], (id) => scores[id] ?? 0), 0, 'a metric with no score holds its layer at 0');
});

test('a band is solid only at goal, and red only at 0', () => {
  assert.equal(bandClass(100), 'qs-dot-q');
  assert.equal(bandClass(99.9), 'qs-seg-q');
  assert.equal(bandClass(1), 'qs-seg-q');
  assert.equal(bandClass(0), 'qs-track-empty');
});

test('the shield says how many layers are at goal, and a layer at 0 looks broken', () => {
  const html = shield([{ label: 'Secrets', score: 100 }, { label: 'Keys', score: 0 }, { label: 'Code', score: 60 }]);
  assert.match(html, /aria-label="1 of 3 layers at goal/);
  assert.equal((html.match(/<path class="qs-track-empty"[^>]*stroke-dasharray/g) ?? []).length, 1);
  assert.equal((html.match(/<path /g) ?? []).length, 3);
});

test('the shield holds only what the publish guard lets through', () => {
  const html = shield([{ label: 'Secrets', score: 100 }, { label: 'Keys', score: 0 }]);
  assert.doesNotMatch(html, /\s(style|fill|stroke|font-size|font-weight)=/, 'paint comes from the kit\'s classes');
  assert.doesNotMatch(html, /#[0-9a-f]{3,8}\b/i);
});

test('a Scorecard check keeps its own spelling', () => {
  assert.equal(scorecardName('scorecard_cii_best_practices'), 'CII-Best-Practices');
  assert.equal(scorecardName('scorecard_sast'), 'SAST');
  assert.equal(scorecardName('scorecard_ci_tests'), 'CI-Tests');
  assert.equal(scorecardName('scorecard_pinned_dependencies'), 'Pinned-Dependencies');
});

test('a label is escaped', () => {
  assert.match(shield([{ label: 'a<b', score: 50 }]), /a&lt;b/);
});
