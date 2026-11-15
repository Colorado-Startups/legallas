// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTap, readingOf, recordsOf, wordingBreaks, type Evidences, type LabReport } from './evaluate.ts';
import { ROWS } from './list.ts';

const nothing: Evidences = { report: null, tests: new Map(), wordingBreaks: null, answers: {} };
const run = { sourceUrl: 'https://github.com/Colorado-Startups/legallas/actions/runs/1', measuredAt: '2026-11-02T06:00:00Z', stage: 'lab' as const };

test('with no evidence every row reads missing, never a good number', () => {
  for (const record of recordsOf(ROWS, nothing, run)) {
    assert.equal(record.status, 'missing', record.id);
    assert.equal(record.value, null, record.id);
  }
});

test('a row waiting on an issue reads missing whatever else ran', () => {
  const report = { journeys: [], browser: { requests: 5, csp: 0, external: 0 }, seed: { status: 'ok', documents: 1, documentsExpected: 1, indexed: 1, indexedExpected: 1 }, failed: false } satisfies LabReport;
  assert.equal(readingOf({ after: ['checklist'] }, { ...nothing, report }), null);
});

test('a timing reports its stat and sample, and an unfinished journey reads missing', () => {
  const report: LabReport = {
    journeys: [{ id: 'j', series: { s: { n: 20, p75: 1, p95: 120 }, empty: { n: 0, p75: null, p95: null } } }],
    browser: { requests: 5, csp: 0, external: 0 },
    seed: { status: 'ok', documents: 1, documentsExpected: 1, indexed: 1, indexedExpected: 1 },
    failed: false,
  };
  assert.deepEqual(readingOf({ journey: 'j', series: 's', stat: 'p95' }, { ...nothing, report }), { value: 120, n: 20 });
  assert.equal(readingOf({ journey: 'j', series: 'empty', stat: 'p95' }, { ...nothing, report }), null);
  assert.equal(readingOf({ journey: 'gone', series: 's', stat: 'p95' }, { ...nothing, report }), null);
});

test('a browser count only passes when the browser really loaded something, so a dead run can\'t pass a safety gate', () => {
  const report = (requests: number, external: number): LabReport => ({ journeys: [{ id: 'connector-search', series: {} }], browser: { requests, csp: 0, external }, seed: { status: 'ok', documents: 5, documentsExpected: 5, indexed: 5, indexedExpected: 5 }, failed: false });
  assert.equal(readingOf({ browser: 'external' }, { ...nothing, report: report(0, 0) }), null);
  assert.deepEqual(readingOf({ browser: 'external' }, { ...nothing, report: report(9, 0) }), { value: 1, n: 9 });
  assert.deepEqual(readingOf({ browser: 'external' }, { ...nothing, report: report(9, 1) }), { value: 0, n: 9 });
});

test('a failed run passes nothing: a clean count and a timing read missing, and a break it saw still fails its gate', () => {
  const report = (external: number): LabReport => ({
    journeys: [{ id: 'load-overview', series: { lcp: { n: 20, p75: 1000, p95: 1200 } } }, { id: 'load-chronology', series: { lcp: { n: 0, p75: null, p95: null } } }],
    browser: { requests: 3, csp: 0, external },
    seed: { status: 'ok', documents: 5, documentsExpected: 5, indexed: 5, indexedExpected: 5 },
    failed: true,
  });
  assert.equal(readingOf({ browser: 'external' }, { ...nothing, report: report(0) }), null);
  assert.equal(readingOf({ browser: 'csp' }, { ...nothing, report: report(0) }), null);
  assert.deepEqual(readingOf({ browser: 'external' }, { ...nothing, report: report(1) }), { value: 0, n: 3 });
  assert.equal(readingOf({ journey: 'load-overview', series: 'lcp', stat: 'p95' }, { ...nothing, report: report(0) }), null);
});

test('a browser count the report doesn\'t have reads missing, so a renamed field can\'t read as clean', () => {
  const report = (browser: object) => ({ journeys: [], browser, seed: { status: 'ok', documents: 5, documentsExpected: 5, indexed: 5, indexedExpected: 5 }, failed: false }) as unknown as LabReport;
  assert.equal(readingOf({ browser: 'csp' }, { ...nothing, report: report({ requests: 3, external: 0 }) }), null);
  assert.equal(readingOf({ browser: 'csp' }, { ...nothing, report: report({ requests: 3, csp: null, external: 0 }) }), null);
  assert.equal(readingOf({ browser: 'external' }, { ...nothing, report: report({ csp: 0, external: 0 }) }), null);
  assert.deepEqual(readingOf({ browser: 'csp' }, { ...nothing, report: report({ requests: 3, csp: 0, external: 0 }) }), { value: 1, n: 3 });
});

test('a short seed reads as failed', () => {
  const report = (documents: number): LabReport => ({ journeys: [], browser: { requests: 5, csp: 0, external: 0 }, seed: { status: 'ok', documents, documentsExpected: 5, indexed: 5, indexedExpected: 5 }, failed: documents < 5 });
  assert.deepEqual(readingOf({ lab: 'seed' }, { ...nothing, report: report(5) }), { value: 1, n: 1 });
  assert.deepEqual(readingOf({ lab: 'seed' }, { ...nothing, report: report(4) }), { value: 0, n: 1 });
});

test('a test name matches by its start, so R1 never matches R10', () => {
  const read = (tests: { name: string; ok: boolean }[]) => readingOf({ test: 'f', names: ['R1'] }, { ...nothing, tests: new Map([['f', tests]]) })?.value;
  assert.equal(read([{ name: 'R10: other', ok: true }]), 0);
  assert.equal(read([{ name: 'R1: first', ok: true }, { name: 'R10: other', ok: false }]), 1);
  assert.equal(read([{ name: 'R1: first', ok: true }, { name: 'R1: second', ok: false }]), 0);
});

test('every named test must be found and pass, so a deleted or skipped one fails', () => {
  const read = (tests: { name: string; ok: boolean }[]) => readingOf({ test: 'f', names: ['a', 'b'] }, { ...nothing, tests: new Map([['f', tests]]) })?.value;
  assert.equal(read([{ name: 'a one', ok: true }, { name: 'b one', ok: true }]), 1);
  assert.equal(read([{ name: 'a one', ok: true }]), 0);
  assert.equal(read(parseTap('ok 1 - a one\nok 2 - b one # SKIP not today\n')), 0);
});

test('a test file that ran nothing reads missing, not failed or passed', () => {
  assert.equal(readingOf({ test: 'f', names: ['a'] }, { ...nothing, tests: new Map([['f', []]]) }), null);
});

test('a skipped or todo test hasn\'t passed', () => {
  assert.deepEqual(parseTap('ok 1 - a # SKIP\nok 2 - b # TODO later\nok 3 - c\n'), [{ name: 'a', ok: false }, { name: 'b', ok: false }, { name: 'c', ok: true }]);
});

test('only top-level TAP lines count', () => {
  assert.deepEqual(parseTap('# Subtest: a\nok 1 - a\n    not ok 1 - inner\nnot ok 2 - b\n1..2\n'), [{ name: 'a', ok: true }, { name: 'b', ok: false }]);
});

test('gate tests stay lab readings, even once the journeys are live', () => {
  const records = recordsOf([{ id: 'a', rule: '', source: '', evidence: { test: 'f', names: ['x'] } }, { id: 'b', rule: '', source: '', evidence: { journey: 'j', series: 's', stat: 'p95' } }], { ...nothing, tests: new Map([['f', [{ name: 'x', ok: true }]]]) }, { ...run, stage: 'live' });
  assert.deepEqual(records.map((r) => r.stage), ['lab', 'live']);
});

test('wording counts every banned word and missing line', () => {
  const pages = (...texts: string[]) => texts.map((text, i) => ({ page: `p${i}/index.html`, text }));
  assert.equal(wordingBreaks(pages('AI agent. not a lawyer', 'your legal agent'), ['not a lawyer'], [/your legal agent/i]), 2);
  assert.equal(wordingBreaks(pages('not a lawyer'), ['not a lawyer'], [/your legal agent/i]), 0);
});

test('the front door owes no short line, since no agent speaks there, but its banned words count (product notices A2)', () => {
  const door = (text: string) => [{ page: 'welcome/denied/index.html', text }];
  assert.equal(wordingBreaks(door('Private. By invitation only.'), ['not a lawyer'], [/your legal agent/i]), 0);
  assert.equal(wordingBreaks(door('your legal agent'), ['not a lawyer'], [/your legal agent/i]), 1);
  assert.equal(wordingBreaks([{ page: 'welcome.html', text: '' }, { page: 'documents/welcome/index.html', text: '' }], ['not a lawyer'], []), 2);
});

test('a lane reads its own run time in minutes, and no time is no reading', () => {
  const none = { report: null, tests: new Map(), wordingBreaks: null, answers: {} };
  assert.deepEqual(readingOf({ lane: 'minutes' }, { ...none, laneMinutes: 9.5 }), { value: 9.5, n: 1 });
  assert.equal(readingOf({ lane: 'minutes' }, none), null);
});

test('a tally reads as a percent from a finished run; a found unwrapped text counts from any run, none only from a finished one', () => {
  const report = (failed: boolean, tallies: Record<string, number>): LabReport => ({
    journeys: [{ id: 'connector-search', series: {}, tallies }],
    browser: { requests: 0, csp: 0, external: 0 },
    seed: { status: 'ok', documents: 5, documentsExpected: 5, indexed: 5, indexedExpected: 5 },
    failed,
  });
  const share = { tally: 'connector-search', ok: 'rightDocumentTop5', of: 'asked' } as const;
  const count = { tally: 'connector-search', count: 'unwrapped', of: 'texts' } as const;
  const from = (r: LabReport): Evidences => ({ ...nothing, report: r });
  assert.deepEqual(readingOf(share, from(report(false, { asked: 60, rightDocumentTop5: 54 }))), { value: 90, n: 60 });
  assert.equal(readingOf(share, from(report(true, { asked: 60, rightDocumentTop5: 60 }))), null, 'a failed run passes nothing');
  assert.equal(readingOf(share, from(report(false, { asked: 0, rightDocumentTop5: 0 }))), null, 'nothing asked is no evidence');
  assert.equal(readingOf(share, from(report(false, {}))), null, 'a renamed tally is no evidence');
  assert.deepEqual(readingOf(count, from(report(true, { texts: 300, unwrapped: 2 }))), { value: 2, n: 300 });
  assert.equal(readingOf(count, from(report(true, { texts: 300, unwrapped: 0 }))), null);
  assert.deepEqual(readingOf(count, from(report(false, { texts: 300, unwrapped: 0 }))), { value: 0, n: 300 });
});
