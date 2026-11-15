// SPDX-License-Identifier: Apache-2.0
// change_lag's rules: where an IRS change date comes from, and how a late change counts. A format slip must read as no
// date (missing), never as an old change (0 days). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amendedOn, dater, ecfrAmended, lagDays, pdfDate, reviewedOn } from './lag.ts';

const day = (s: string) => Date.parse(`${s}T00:00:00Z`);

test('a change date is the page date line or a real Last-Modified, else unknown', () => {
  assert.equal(reviewedOn('<p>Page Last Reviewed or Updated: 16-Oct-2026</p>'), day('2026-10-16'));
  assert.ok(Number.isNaN(reviewedOn('Page Last Reviewed or Updated: 16-Okt-2026')));
  assert.ok(Number.isNaN(reviewedOn('Updated recently')));
  assert.equal(pdfDate('Fri, 08 Aug 2025 02:10:10 GMT'), Date.parse('2025-08-08T02:10:10Z'));
  assert.ok(Number.isNaN(pdfDate('Thu, 01 Jan 1970 00:00:00 GMT')));
  assert.ok(Number.isNaN(pdfDate(null)));
});

test('a U.S. Code section dates from its latest amending law; an eCFR section from its latest amendment', () => {
  const credit = '<p class="source-credit" id="sourcecredit">(Added  Pub. L. 103-66, title XIII, § 13113(a) ,  Aug. 10, 1993 ,  <a href="/s">107 Stat. 422</a> ; Pub. L. 111-240, Sept. 27, 2010 ; Pub. L. 119-21, title VII ,  July 4, 2025 ,  139 Stat. 192.)</p><p>Current through Public Law 119-138 (November 3, 2026).</p>';
  assert.equal(amendedOn(credit), day('2025-07-04'));
  assert.ok(Number.isNaN(amendedOn('<p>Current through Public Law 119-138 (November 3, 2026).</p>')));
  assert.equal(ecfrAmended({ meta: { latest_amendment_date: '2016-05-18' } }), day('2016-05-18'));
  assert.ok(Number.isNaN(ecfrAmended({ meta: {} })));
  assert.ok(Number.isNaN(ecfrAmended(null)));
});

test('each host has its own dater; any other host has none', () => {
  assert.equal(dater('https://www.ecfr.gov/current/title-26/section-1.409A-1')?.url, 'https://www.ecfr.gov/api/versioner/v1/versions/title-26.json?section=1.409A-1');
  assert.equal(dater('https://uscode.house.gov/us/usc/t26/s1202/')?.method, 'GET');
  assert.equal(dater('https://www.irs.gov/pub/irs-pdf/f8832.pdf')?.method, 'HEAD');
  assert.equal(dater('https://www.law.cornell.edu/uscode/text/26/1202'), null);
});

test('a change before its check lags 0; one after counts days from the change; the longest wins', () => {
  const checked = day('2026-11-05');
  const now = day('2026-11-25');
  assert.equal(lagDays([{ changed: day('2026-10-16'), checked }, { changed: day('2026-04-30'), checked }], now), 0);
  assert.equal(lagDays([{ changed: day('2026-11-10'), checked }, { changed: day('2026-11-20'), checked }, { changed: day('2026-04-30'), checked }], now), 15);
});
