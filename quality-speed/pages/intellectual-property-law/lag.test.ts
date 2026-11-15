// SPDX-License-Identifier: Apache-2.0
// change_lag's three rules: where a change date comes from, which sources are watched from which day, and how a late
// change counts. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeDay, lagDays, watched } from './lag.ts';

test('a change date comes from Last-Modified, else the USPTO page, else the MPEP line, else is unknown', () => {
  assert.equal(changeDay('Fri, 02 Oct 2026 21:44:40 GMT', ''), '2026-10-02');
  assert.equal(changeDay(null, '<meta name="dcterms.modified" content="2023-12-15T16:49:00Z">'), '2023-12-15');
  assert.equal(changeDay(null, '<div> Last Modified: \n    03/09/2026 20:50:51 </div>'), '2026-03-09');
  assert.equal(changeDay(null, '<html></html>'), '');
});

test('each read source is watched once, from its earliest read day; an unread one is left out', () => {
  const needs = [
    { id: 'a', source: 'https://www.uspto.gov/x', checked: '2026-11-05' },
    { id: 'b', source: 'https://www.uspto.gov/x', checked: '2026-11-02' },
    { id: 'c', source: 'https://www.copyright.gov/y', checked: null },
  ];
  assert.deepEqual(watched(needs), [{ url: 'https://www.uspto.gov/x', read: '2026-11-02' }]);
});

test('a change on or before its read day lags 0; one after counts days from the change; the longest wins', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  assert.equal(lagDays([{ changed: '2026-11-05', read: '2026-11-05' }, { changed: '2023-12-15', read: '2026-11-05' }], now), 0);
  assert.equal(lagDays([{ changed: '2026-11-11', read: '2026-11-05' }, { changed: '2026-11-06', read: '2026-11-05' }, { changed: '2026-12-01', read: '2026-11-05' }], now), 15);
});
