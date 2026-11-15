// SPDX-License-Identifier: Apache-2.0
//   node --test quality-speed/pages/compliance/page.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Manifest, MetricRecord } from '../../contract/format.ts';
import { joinMetrics } from '../../contract/validate.ts';
import { frameWords, type PageContext } from '../../core/build.ts';
import type { Detail } from '../../core/detail.ts';
import { countWords, MAX_WORDS } from '../../core/guard.ts';
import { combine, scorePage, type ScoredRow } from '../../core/score.ts';
import { AREAS, attestations, detail, type Lookup, readPolicy } from './collect.ts';
import { areaStates, attestationStates, render, roadFixes } from './page.ts';

const now = new Date('2026-11-06T08:00:00Z');
const manifest: Manifest = JSON.parse(readFileSync(new URL('manifest.json', import.meta.url), 'utf8'));
const signed = { ...manifest, signoff_comment: 1 };
const run = 'https://github.com/Colorado-Startups/legallas/actions/runs/1';
const rec = (id: string, value: number, sample: number): MetricRecord => ({ id, page: 'compliance', value, status: 'ok', stage: 'live', measured_at: '2026-11-06T07:00:00Z', source_url: run, sample_size: sample });
const recs = [rec('policy_areas_covered', 85.71, 7), rec('evidence_refs_dead', 1, 108), rec('policy_review_age_days', 1, 7), rec('lane_minutes', 1, 1)];
const lookup: Lookup = (p) => (p === 'web/a.ts' ? 'export const a = 1;' : null);
// The first area has no policy; the rest alternate between a year and more since their last change, and a fresh one.
const policies = AREAS.map(({ id }, i) => readPolicy(id, i ? 'Version 1.0, 2026-11-05.\n`web/a.ts`' : null, lookup, i ? 400 * (i % 2) : null));
const d: Detail = detail(policies, attestations(null));
const context = (m: Manifest, det: Detail | null = d): PageContext => ({ score: scorePage('compliance', m, recs, now), metrics: joinMetrics(m, recs), history: [], others: {}, detail: det });

test('the body fits the words the frame leaves', () => {
  assert.ok(countWords(render(context(signed)).body) <= MAX_WORDS - frameWords('compliance'));
});

test('each area is written, true to the code and reviewed, from the detail alone', () => {
  const [written, code, reviewed] = areaStates(d);
  assert.deepEqual(written, ['fail', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
  assert.deepEqual(code, ['fail', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass'], 'the absent policy cites nothing');
  assert.deepEqual(reviewed, [undefined, 'fail', 'pass', 'fail', 'pass', 'fail', 'pass'], 'an unread age is missing, not passing');
  assert.ok(areaStates(null).flat().every((s) => s === undefined));
});

test('an attestation is never shown held without the lane saying so', () => {
  assert.deepEqual(attestationStates(d), ['fail', 'fail', 'fail', 'fail']);
  assert.deepEqual(attestationStates(null), [undefined, undefined, undefined, undefined]);
  assert.doesNotMatch(render(context(signed)).body, /data-tv="pass" data-tl="Held/);
});

test('Road to 100: the fixes take the score to exactly 100', () => {
  const ctx = context(signed);
  const rows: ScoredRow[] = ctx.metrics.map((m, i) => ({ id: m.id, lens: m.lens, weight: m.weight, score: ctx.score.metrics[i]?.score ?? 0 }));
  const fixes = roadFixes(rows, ctx.score);
  const start = combine(rows);
  const q = fixes.reduce((a, f) => a + f.q, start.exact_quality);
  const s = fixes.reduce((a, f) => a + f.s, start.exact_speed);
  const c = fixes.reduce((a, f) => a + (f.c ?? 0), start.exact_consumption);
  assert.equal(Math.floor(Number(((q + s + c) / 3).toFixed(6))), 100);
  assert.ok(fixes.some((f) => f.id === 'drill'), 'the missing drill is a fix');
});

test('an unsigned list and a lane with no detail still render', () => {
  assert.ok(render(context(manifest)).body.length > 0);
  assert.ok(render(context(signed, null)).body.length > 0);
});
