// SPDX-License-Identifier: Apache-2.0
// The page renders with nothing measured, the list can reach 100 under the site's own scoring, and a measured gate miss caps it.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { Manifest, MetricRecord } from '../../contract/format.ts';
import { joinMetrics } from '../../contract/validate.ts';
import { roadState } from '../../core/charts/charts.js';
import { scorePage } from '../../core/score.ts';
import { render, roadFixes } from './page.ts';

/** The list as signed off, whatever the sign-off comment's id. */
const manifest: Manifest = { ...JSON.parse(await readFile(new URL('manifest.json', import.meta.url), 'utf8')), signoff_comment: 1 };
const NOW = new Date('2026-11-02T12:00:00Z');
const RUN = 'https://github.com/Colorado-Startups/legallas/actions/runs/1001';
const atGoal: MetricRecord[] = manifest.metrics.map((m) => ({
  id: m.id, page: manifest.page, value: m.goal, status: 'ok', stage: 'lab', measured_at: '2026-11-02T06:00:00Z', source_url: RUN, sample_size: m.min_samples,
}));
/** Only the metrics that used to be safety gates, each measured at its floor: a miss the site can see. */
const MISSED = ['mac_folder_unchanged', 'windows_folder_unchanged'];
const gatesMissed: MetricRecord[] = atGoal.flatMap((r) => {
  const def = manifest.metrics.find((m) => m.id === r.id);
  return def && MISSED.includes(r.id) ? [{ ...r, value: def.floor }] : [];
});
const page = (records: MetricRecord[]) => {
  const score = scorePage('sync', manifest, records, NOW);
  return { score, body: render({ score, metrics: joinMetrics(manifest, records), history: [], others: {}, detail: null }).body };
};

test('nothing measured reads 0 and renders; every metric at goal reads 100', () => {
  assert.equal(page([]).score.total, 0);
  assert.match(page([]).body, /The folder is home/);
  assert.equal(page(atGoal).score.total, 100);
  assert.equal(page(atGoal).score.consumption, 100, 'both computers\' lane minutes at goal');
  assert.match(page(atGoal).body, /The folder is home/);
});

test('with every fix on, Road to 100 reaches 100', () => {
  const { score } = page(gatesMissed);
  const rows = joinMetrics(manifest, gatesMissed).map((m, i) => ({ id: m.id, lens: m.lens, weight: m.weight, group: m.group, score: score.metrics[i]?.score ?? 0 }));
  const fixes = roadFixes(rows, score);
  const now = { q: score.exact_quality, s: score.exact_speed, total: score.total };
  assert.equal(roadState(now, fixes, fixes.map((f) => f.id)).total, 100);
});
