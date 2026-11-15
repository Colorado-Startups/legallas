// SPDX-License-Identifier: Apache-2.0
//   node --test quality-speed/pages/launch-readiness/collect.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Manifest } from '../../contract/format.ts';
import { validateManifest, validateRecords } from '../../contract/validate.ts';
import { laneRecord } from '../../core/lane/collect.ts';
import { checks, type Conditions, daysToClear, detail, IDS, isScored, metAt, missing, NO_PACE_DAYS, records } from './collect.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const list: Conditions = json('conditions.json');
const manifest: Manifest = json('manifest.json');
const now = new Date('2026-11-20T06:00:00Z');
const run = 'https://github.com/Colorado-Startups/legallas/actions/runs/1';

test('the reviewed list: unique ids, known groups, and the sample minimums at the scored count', () => {
  const ids = new Set(list.conditions.map((c) => c.id));
  assert.equal(ids.size, list.conditions.length);
  for (const c of list.conditions) {
    assert.ok(list.groups.includes(c.group), c.id);
    if (c.after !== undefined) assert.ok(ids.has(c.after), c.id);
  }
  const scored = list.conditions.filter(isScored).length;
  assert.deepEqual(manifest.metrics.map((m) => m.id), ['conditions_met', 'days_to_clear', 'lane_minutes']);
  for (const id of IDS) assert.equal(manifest.metrics.find((m) => m.id === id)?.min_samples, scored, id);
  assert.ok(manifest.metrics.every((m) => m.goal_source?.startsWith('https://')));
  assert.equal(validateManifest(manifest, 'launch-readiness').errors.length, 0);
});

test('met only when merged into main, or closed as completed', () => {
  const pr = { pull_request: {}, state: 'closed', closed_at: '2026-11-10T00:00:00Z' };
  assert.equal(metAt(pr, { merged_at: '2026-11-10T00:00:00Z', base: { ref: 'main' } }), '2026-11-10T00:00:00Z');
  assert.equal(metAt(pr, { merged_at: '2026-11-10T00:00:00Z', base: { ref: 'claude/side' } }), null);
  assert.equal(metAt(pr, { merged_at: null, base: { ref: 'main' } }), null);
  assert.equal(metAt(pr), null);
  assert.equal(metAt({ state: 'closed', state_reason: null, closed_at: '2026-11-11T00:00:00Z' }), null);
  assert.equal(metAt({ state: 'closed', state_reason: 'duplicate', closed_at: '2026-11-11T00:00:00Z' }), null);
  assert.equal(metAt({ state: 'closed', state_reason: 'completed', closed_at: '2026-11-11T00:00:00Z' }), '2026-11-11T00:00:00Z');
  assert.equal(metAt({ state: 'closed', state_reason: 'not_planned', closed_at: '2026-11-11T00:00:00Z' }), null);
  assert.equal(metAt({ state: 'open', state_reason: 'reopened', closed_at: null }), null);
});

test('days to clear: the pace of the last 28 days, 0 when done, never past 365', () => {
  const row = (met_at: string | null, more: { scored?: boolean; waiting?: boolean } = {}) => ({ id: 'x', met: met_at !== null, met_at, evidence: met_at ? 1 : null, scored: true, waiting: false, ...more });
  const recent = row('2026-11-19T00:00:00Z');
  assert.equal(daysToClear([recent], now), 0);
  assert.equal(daysToClear([row(null), row('2026-10-01T00:00:00Z')], now), NO_PACE_DAYS);
  assert.equal(daysToClear([row(null), row(null), recent, row('2026-11-18T00:00:00Z')], now), 28);
  assert.equal(daysToClear([...Array.from({ length: 41 }, () => row(null)), recent], now), NO_PACE_DAYS);
  // The owner's conditions, and those waiting for the go-ahead, don't hold the pace back.
  assert.equal(daysToClear([recent, row(null, { scored: false }), row(null, { waiting: true })], now), 0);
});

test('card rows and the owner\'s are shown, never scored or read', () => {
  const cards = list.conditions.filter((c) => typeof c.evidence === 'object' && c.evidence !== null);
  assert.equal(cards.length, 4);
  assert.ok(cards.every((c) => !isScored(c)));
  const rows = detail(list, new Map());
  const ids = Object.keys(checks(rows).checks);
  assert.equal(ids.length, list.conditions.filter(isScored).length);
  assert.ok(cards.every((c) => !ids.includes(c.id)));
});

test('a condition waits until its after condition is met', () => {
  const two: Conditions = { ...list, conditions: [
    { id: 'go', group: 'third_party', label: 'Go', owner: true, from: 'gate', evidence: 7 },
    { id: 'read', group: 'security', label: 'Read', owner: false, from: 'gate', after: 'go', evidence: null },
  ] };
  assert.equal(detail(two, new Map([['issue:7', null]]))[1]?.waiting, true);
  assert.equal(detail(two, new Map([['issue:7', '2026-11-15T00:00:00Z']]))[1]?.waiting, false);
});

const daily = { ...manifest, signoff_comment: 1, metrics: manifest.metrics.filter((m) => (IDS as readonly string[]).includes(m.id)) };

test('nothing met yet: 0 % met and the records pass the format', () => {
  const recs = records(list, detail(list, new Map()), now, run);
  assert.equal(recs.find((r) => r.id === 'conditions_met')?.value, 0);
  assert.equal(recs.find((r) => r.id === 'days_to_clear')?.value, NO_PACE_DAYS);
  assert.deepEqual(validateRecords(recs, daily, now).errors, []);
});

test('every condition met reads 100 % and 0 days', () => {
  const evidence: Conditions = { ...list, conditions: list.conditions.map((c, i) => (isScored(c) ? { ...c, evidence: i + 1 } : c)) };
  const answers = new Map(evidence.conditions.filter(isScored).map((c) => [`issue:${c.evidence}`, '2026-11-15T00:00:00Z']));
  const recs = records(evidence, detail(evidence, answers), now, run);
  assert.equal(recs.find((r) => r.id === 'conditions_met')?.value, 100);
  assert.equal(recs.find((r) => r.id === 'days_to_clear')?.value, 0);
});

test("the owner's and card rows never count toward the share met", () => {
  const shown = list.conditions.filter((c) => !isScored(c)).map((c) => c.id);
  const rows = detail(list, new Map()).map((r) => (shown.includes(r.id) ? { ...r, met: true } : r));
  assert.equal(records(list, rows, now, run).find((r) => r.id === 'conditions_met')?.value, 0);
});

test('an error reads missing on every metric of the lane, never as progress', () => {
  const recs = missing();
  assert.deepEqual(recs.map((r) => r.id), [...IDS]);
  assert.ok(recs.every((r) => r.status === 'missing' && r.value === null));
  assert.deepEqual(validateRecords(recs, daily, now).errors, []);
});

test('lane_minutes reads missing outside CI, and passes the format', async () => {
  const rec = await laneRecord('launch-readiness', {}, now);
  assert.equal(rec.id, 'lane_minutes');
  assert.equal(rec.status, 'missing');
  assert.equal(rec.value, null);
  const lane = { ...manifest, signoff_comment: 1, metrics: manifest.metrics.filter((m) => m.id === 'lane_minutes') };
  assert.deepEqual(validateRecords([rec], lane, now).errors, []);
});
