// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Manifest, MetricRecord } from '../../contract/format.ts';
import { validateRecords } from '../../contract/validate.ts';
import { laneRecord } from './collect.ts';

const NOW = new Date('2026-11-04T06:10:00Z');
const CI = { GITHUB_RUN_ID: '123', GH_TOKEN: 'invented', LANE: 'minutes' };
const MANIFEST: Manifest = {
  page: 'sec',
  signoff_comment: 1,
  metrics: [{ id: 'lane_minutes', lens: 'consumption', unit: 'minutes', direction: 'lower', floor: 10, goal: 1, weight: 1, max_age_hours: 48, min_samples: 1 }],
  changes: [],
};
const MISSING = { id: 'lane_minutes', page: 'sec', value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null };
const passes = (record: MetricRecord) => assert.deepEqual(validateRecords([record], MANIFEST, NOW).errors, []);
const answers = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

test('a found job reads its minutes so far, rounded up, from this run\'s jobs', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', answers({ jobs: [{ name: 'sec (law)', started_at: '2026-11-04T06:00:00Z' }, { name: 'sec (minutes)', started_at: '2026-11-04T06:07:30Z' }] }));
  const record = await laneRecord('sec', CI, NOW);
  assert.deepEqual(record, { ...MISSING, value: 3, status: 'ok', measured_at: '2026-11-04T06:10:00Z', source_url: 'https://github.com/Colorado-Startups/legallas/actions/runs/123', sample_size: 1 });
  passes(record);
  assert.match(String(fetch.mock.calls[0]?.arguments[0]), /\/repos\/Colorado-Startups\/legallas\/actions\/runs\/123\/jobs\?/);
});

test('a missing job, or one not started, reads missing, never 0', async (t) => {
  t.mock.method(globalThis, 'fetch', answers({ jobs: [{ name: 'sec (law)', started_at: '2026-11-04T06:00:00Z' }, { name: 'tax (minutes)', started_at: '2026-11-04T06:00:00Z' }] }));
  assert.deepEqual(await laneRecord('sec', CI, NOW), MISSING);
  t.mock.method(globalThis, 'fetch', answers({ jobs: [{ name: 'sec (minutes)', started_at: null }] }));
  assert.deepEqual(await laneRecord('sec', CI, NOW), MISSING);
  passes(MISSING as MetricRecord);
});

test('a failed read, or no run, token or lane to read with, reads missing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }));
  assert.deepEqual(await laneRecord('sec', CI, NOW), MISSING);
  t.mock.method(globalThis, 'fetch', async () => new Response('not json', { status: 200 }));
  assert.deepEqual(await laneRecord('sec', CI, NOW), MISSING);
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('offline');
  });
  assert.deepEqual(await laneRecord('sec', CI, NOW), MISSING);
  assert.equal(fetch.mock.callCount(), 1);
  for (const unset of ['GITHUB_RUN_ID', 'GH_TOKEN', 'LANE'] as const) {
    assert.deepEqual(await laneRecord('sec', { ...CI, [unset]: undefined }, NOW), MISSING);
  }
  assert.equal(fetch.mock.callCount(), 1);
});
