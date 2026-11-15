// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY_ACTIONS } from '../../worker/audit.ts';
import { ACTION_LABELS, actionLabel, filterActions, dailyCounts, formatWhen, SPARK_DAYS, sparkSummary, sparkValues, tickStatus } from './activity-model.ts';

test('every activity action has a human label, Key included', () => {
  for (const action of ACTIVITY_ACTIONS) assert.ok(Object.hasOwn(ACTION_LABELS, action), action);
  for (const label of Object.values(ACTION_LABELS)) assert.match(label, /^[A-Z][A-Za-z ]+$/);
  assert.equal(actionLabel('key'), 'Marked key');
  assert.equal(actionLabel('unkey'), 'Unmarked key');
  assert.equal(actionLabel('comment'), 'Commented');
});

test('AI connect actions are labelled ahead of their migration, but only accepted actions are filter choices', () => {
  assert.equal(actionLabel('ai_search'), 'Searched via AI');
  assert.equal(actionLabel('ai_read'), 'Read via AI');
  assert.equal(actionLabel('ai_connect'), 'Connected an AI app');
  assert.equal(actionLabel('ai_disconnect'), 'Disconnected an AI app');
  const choices = filterActions(ACTIVITY_ACTIONS).map(([action]) => action);
  assert.deepEqual([...choices].sort(), [...ACTIVITY_ACTIONS].sort());
  assert.deepEqual(filterActions(['key', 'ai_read']), [['key', 'Marked key'], ['ai_read', 'Read via AI']]);
});

test('an action the page does not know yet shows as its raw value', () => {
  assert.equal(actionLabel('archive'), 'archive');
  assert.equal(actionLabel('toString'), 'toString');
});

test('timestamps read in ISO order in local time', () => {
  assert.equal(formatWhen(new Date(2026, 9, 1, 9, 5)), '2026-10-01 09:05');
});

test('daily counts cover thirty UTC days ending today, oldest first', () => {
  const days = dailyCounts(
    ['2026-10-01T23:59:59.000Z', '2026-10-01T00:00:00.000Z', '2026-09-30T12:00:00.000Z', '2026-08-01T00:00:00Z', 'nonsense'],
    '2026-10-01',
    false,
  );
  assert.equal(days.length, SPARK_DAYS);
  assert.equal(days[0]!.day, '2026-09-02');
  assert.deepEqual(days.at(-1), { day: '2026-10-01', count: 2, complete: true });
  assert.equal(days.at(-2)!.count, 1);
  assert.equal(days.reduce((sum, d) => sum + d.count, 0), 3, 'rows outside the window are not counted');
  assert.ok(days.every((d) => d.complete));
});

test('while older rows remain, days up to the oldest loaded day are incomplete', () => {
  const days = dailyCounts(['2026-10-01T10:00:00Z', '2026-09-28T10:00:00Z'], '2026-10-01', true);
  const complete = days.filter((d) => d.complete).map((d) => d.day);
  assert.deepEqual(complete, ['2026-09-29', '2026-09-30', '2026-10-01']);
  assert.equal(days.find((d) => d.day === '2026-09-28')!.complete, false);
  assert.ok(dailyCounts([], '2026-10-01', true).every((d) => !d.complete));
});

test('the series leaves incomplete days out of the line', () => {
  const days = dailyCounts(['2026-10-01T01:00:00Z', '2026-10-01T02:00:00Z', '2026-09-30T01:00:00Z'], '2026-10-01', true);
  const values = sparkValues(days);
  assert.equal(values.length, SPARK_DAYS);
  assert.deepEqual(values.slice(-2), [Number.NaN, 2], 'the oldest loaded day may still grow, so it is a gap');
  assert.ok(values.slice(0, -1).every(Number.isNaN));
  assert.deepEqual(sparkValues(dailyCounts([], '2026-10-01', false)), Array<number>(SPARK_DAYS).fill(0));
});

test('the summary names the total, the busiest day and any gap in coverage', () => {
  const full = dailyCounts(['2026-10-01T01:00:00Z', '2026-09-30T01:00:00Z', '2026-09-30T02:00:00Z'], '2026-10-01', false);
  assert.equal(sparkSummary(full, 'sign-ins'), '3 sign-ins in the last 30 days, most on 2026-09-30 (2).');
  assert.equal(sparkSummary(dailyCounts([], '2026-10-01', false), 'entries'), '0 entries in the last 30 days.');
  const partial = dailyCounts(['2026-10-01T01:00:00Z', '2026-09-30T01:00:00Z'], '2026-10-01', true);
  assert.equal(
    sparkSummary(partial, 'entries'),
    '2 entries in the last 30 days, most on 2026-09-30 (1). Complete from 2026-10-01; load older activity to fill the rest.',
  );
  assert.match(sparkSummary(dailyCounts([], '2026-10-01', true), 'entries'), /still to load\.$/);
});

test('the Full notice panel says whether each member ticked the current version', () => {
  assert.equal(tickStatus({ version: 'A3-0123abcd', current: true }), 'Current');
  assert.equal(tickStatus({ version: 'A3-00000000', current: false }), 'Earlier version: asked again at next visit');
  assert.equal(tickStatus({ version: null, current: false }), 'Not yet ticked');
});
