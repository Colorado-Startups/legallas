// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Manifest } from '../../../contract/format.ts';
import { buildRecords, checkRecords, DOC_IDS, laneIds, readManifest } from './records.ts';

const RUN = 'https://github.com/Colorado-Startups/legallas/actions/runs/123';
const now = new Date('2030-01-01T00:00:00Z');
const manifest: Manifest = {
  page: 'code',
  signoff_comment: 1,
  metrics: [
    { id: 'cov', lens: 'quality', unit: 'percent', direction: 'higher', floor: 60, goal: 90, weight: 1, max_age_hours: 48, min_samples: 5 },
    { id: 'loop', lens: 'speed', unit: 'seconds', direction: 'lower', floor: 600, goal: 60, weight: 1, max_age_hours: 48, min_samples: 1 },
  ],
  changes: [],
};
const ok = { value: 75.1234567, time: '2029-12-31T23:00:00.123Z', sampleSize: 5 };

test('a good measurement becomes an ok reading the contract accepts, with the run link', () => {
  const records = buildRecords(manifest, ['cov', 'loop'], new Map([['cov', ok]]), RUN, now);
  assert.deepEqual(records[0], { id: 'cov', page: 'code', value: 75.123457, status: 'ok', stage: 'lab', measured_at: '2029-12-31T23:00:00Z', source_url: RUN, sample_size: 5 });
  assert.equal(records[1]?.status, 'missing');
  checkRecords(records, manifest, now);
});

test('no run link, a bad value, too few samples or a future time is missing, never a number', () => {
  const cases: [Map<string, typeof ok>, string | null][] = [
    [new Map([['cov', ok]]), null],
    [new Map([['cov', ok]]), 'https://github.com/Colorado-Startups/legallas/commit/abc'],
    [new Map([['cov', { ...ok, value: Number.NaN }]]), RUN],
    [new Map([['cov', { ...ok, value: 101 }]]), RUN],
    [new Map([['cov', { ...ok, sampleSize: 4 }]]), RUN],
    [new Map([['cov', { ...ok, time: '2030-02-01T00:00:00Z' }]]), RUN],
  ];
  for (const [measured, run] of cases) {
    const [r] = buildRecords(manifest, ['cov'], measured, run, now);
    assert.equal(r?.status, 'missing');
    assert.equal(r?.value, null);
  }
});

test('the reviewed manifest passes the contract, and each metric is measured by exactly one lane', () => {
  const m = readManifest(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual([...laneIds(m, 'nightly'), ...laneIds(m, 'docs')].sort(), m.metrics.map((d) => d.id).sort());
  assert.deepEqual(laneIds(m, 'docs').sort(), [...DOC_IDS].sort(), 'every docs metric is on the list');
  assert.throws(() => laneIds(m, 'weekly'), /no lane/);
  assert.throws(() => laneIds(m, 'daily'), /no lane/);
});
