// SPDX-License-Identifier: Apache-2.0
// The checklist's "today" is the room's calendar day, not the UTC one (#196).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomToday } from './routes/checklist.ts';

// 8 PM on 2026-11-04 in Colorado is already 2026-11-05 in UTC.
const EVENING_IN_COLORADO = new Date('2026-11-05T03:00:00.000Z');

test('today is the day in the room\'s time zone', () => {
  assert.equal(roomToday('America/Denver', EVENING_IN_COLORADO), '2026-11-04');
  assert.equal(roomToday('Europe/London', EVENING_IN_COLORADO), '2026-11-05');
});

test('an unset, empty or unknown zone reads UTC', () => {
  for (const zone of [undefined, '', 'Mountain', 'Not/AZone']) assert.equal(roomToday(zone, EVENING_IN_COLORADO), '2026-11-05', String(zone));
});
