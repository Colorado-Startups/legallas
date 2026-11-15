// SPDX-License-Identifier: Apache-2.0
//   node --test quality-speed/pages/templates/page.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Manifest } from '../../contract/format.ts';
import { joinMetrics } from '../../contract/validate.ts';
import { countWords, MAX_WORDS } from '../../core/guard.ts';
import { combine, scorePage } from '../../core/score.ts';
import { collect, records } from './collect.ts';
import { render, road } from './page.ts';

const now = new Date('2026-11-02T06:00:00Z');
// Scored as if signed off: until a reviewer's comment id is set, the list takes no readings and every tile is missing.
const manifest: Manifest = { ...JSON.parse(readFileSync(new URL('manifest.json', import.meta.url), 'utf8')), signoff_comment: 1 };
const recs = records(collect().values, now, 'https://github.com/Colorado-Startups/legallas/actions/runs/1');
const ctx = { score: scorePage('templates', manifest, recs, now), metrics: joinMetrics(manifest, recs), history: [], others: {}, detail: null };

test('today\'s page stays within the visible word limit', () => {
  assert.ok(countWords(render(ctx).body) <= MAX_WORDS);
});

test('Road to 100: the fixes take today\'s score to exactly 100', () => {
  const fixes = road(ctx);
  const q = fixes.reduce((a, f) => a + f.q, ctx.score.exact_quality);
  const s = fixes.reduce((a, f) => a + f.s, ctx.score.exact_speed);
  assert.equal(Math.floor(Number(((2 * q + s) / 3).toFixed(6))), 100);
  assert.equal(combine([]).total, 0);
});

test('coverage by path shows only while coverage reads measured', () => {
  assert.match(render(ctx).body, /Coverage by path/);
  const missing = recs.map((r) => (r.id === 'coverage' ? { ...r, value: null, status: 'missing' as const, measured_at: null, source_url: null, sample_size: null } : r));
  const blind = { ...ctx, score: scorePage('templates', manifest, missing, now), metrics: joinMetrics(manifest, missing) };
  assert.doesNotMatch(render(blind).body, /Coverage by path/);
});

test('Road to 100: a metric short of goal lowers the total, and every fix on reaches 100', () => {
  const failing = recs.map((r) => (r.id === 'wording' ? { ...r, value: 80 } : r));
  const short = { ...ctx, score: scorePage('templates', manifest, failing, now), metrics: joinMetrics(manifest, failing) };
  const fixes = road(short);
  assert.ok(fixes.some((f) => f.id === 'wording'));
  let q = short.score.exact_quality;
  let s = short.score.exact_speed;
  for (const f of fixes) {
    q += f.q;
    s += f.s;
  }
  assert.equal(Math.floor(Number(((2 * q + s) / 3).toFixed(6))), 100);
});
