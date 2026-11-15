// SPDX-License-Identifier: Apache-2.0
// The page renders with nothing measured, and Road to 100 reaches 100 once every fix is on.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { Manifest, MetricRecord } from '../../contract/format.ts';
import { joinMetrics } from '../../contract/validate.ts';
import { roadState } from '../../core/charts/charts.js';
import { scorePage } from '../../core/score.ts';
import { fixes, render } from './page.ts';

/** The list as signed off, whatever the sign-off comment's id. */
const manifest: Manifest = { ...JSON.parse(await readFile(new URL('manifest.json', import.meta.url), 'utf8')), signoff_comment: 1 };
const NOW = new Date('2026-11-04T12:00:00Z');
const RUN = 'https://github.com/Colorado-Startups/legallas/actions/runs/1001';
const atGoal: MetricRecord[] = manifest.metrics.map((m) => ({
  id: m.id, page: manifest.page, value: m.goal, status: 'ok', stage: 'lab', measured_at: '2026-11-04T06:00:00Z', source_url: RUN, sample_size: m.min_samples,
}));
/** The unsupported-AI check measured at its floor: a miss the site can see. */
const gateMissed: MetricRecord[] = atGoal.filter((r) => r.id === 'unsupported_ai_refused').map((r) => ({ ...r, value: manifest.metrics.find((m) => m.id === r.id)!.floor }));
const page = (records: MetricRecord[]) => {
  const score = scorePage('ai-connectors', manifest, records, NOW);
  const metrics = joinMetrics(manifest, records);
  return { score, metrics, body: render({ score, metrics, history: [], others: {}, detail: null }).body };
};

test('nothing measured reads 0 and renders; every metric at goal reads 100', () => {
  assert.equal(page([]).score.total, 0);
  assert.match(page([]).body, /Connector contract|Blocked/);
  assert.equal(page(atGoal).score.total, 100);
  assert.equal(page(atGoal).score.consumption, 100, 'lane minutes at goal');
});

test('with every fix on Road to 100 reaches 100, and the deny fix counts like any other', () => {
  // Today's state: every supported AI connects (#157, merged), so no fix is left for it, and the check reads its floor.
  const { score, metrics } = page([...atGoal.filter((r) => r.id === 'supported_ais_connecting'), ...gateMissed]);
  const scored = metrics.map((m, i) => ({ ...m, score: score.metrics[i]!.score, reading: score.metrics[i]!.reading }));
  const road = fixes(scored);
  assert.ok(road.some((f) => f.id === 'deny'));
  const now = { q: score.exact_quality, s: score.exact_speed, total: score.total };
  assert.equal(roadState(now, road, road.map((f) => f.id)).total, 100);
});
