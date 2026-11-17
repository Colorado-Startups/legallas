// SPDX-License-Identifier: Apache-2.0
// The page, on invented numbers: it stays inside the site's limits, shows every metric, and shows nothing it doesn't have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Manifest, Metric } from '../../contract/format.ts';
import { countWords, MAX_WORDS } from '../../core/guard.ts';
import { scorePage } from '../../core/score.ts';
import { gauge, render } from './page.ts';

const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')) as Manifest;
const NOW = new Date('2026-11-16T12:00:00Z');
const RUN = 'https://github.com/Colorado-Startups/legallas/actions/runs/42';

type Context = Parameters<typeof render>[0];

function context(records: 'measured' | 'missing', detail: Context['detail']): Context {
  const read = manifest.metrics.map((m) => ({
    id: m.id,
    page: 'actions' as const,
    value: records === 'measured' ? m.goal : null,
    status: records === 'measured' ? ('ok' as const) : ('missing' as const),
    stage: 'live' as const,
    measured_at: records === 'measured' ? '2026-11-16T08:37:00Z' : null,
    source_url: records === 'measured' ? RUN : null,
    sample_size: records === 'measured' ? m.min_samples : null,
  }));
  const metrics = manifest.metrics.map((m, i) => ({ ...m, ...read[i] })) as Metric[];
  return { score: scorePage('actions', { ...manifest, signoff_comment: 1 }, read, NOW), metrics, history: [], others: {}, detail };
}

const DETAIL: NonNullable<Context['detail']> = {
  checks: { ci_ok_checks_failed: 1, dco_missing_sign_off: 0, secret_in_history: 1 },
  readings: {
    month_usd: { value: 6.25, limit: 500, n: 784 },
    'day_2026-11-01': { value: 4.5, limit: null, n: 500 },
    'day_2026-11-02': { value: 1.75, limit: null, n: 284 },
    job_checks_blacksmith: { value: 0, limit: null, n: 99 },
    job_checks_linux: { value: 0.52, limit: null, n: 27 },
    min_checks_linux: { value: 81, limit: null, n: 27 },
    job_dco_linux: { value: 0.74, limit: null, n: 101 },
    queue_macos: { value: 3600, limit: null, n: 9 },
  },
};

test('a full page stays inside the word limit and shows every metric', () => {
  const { body } = render(context('measured', DETAIL));
  assert.ok(countWords(body) <= MAX_WORDS, `${countWords(body)} words`);
  assert.doesNotMatch(body, /\u2014|style=|on[a-z]+="/);
  for (const label of ['Main green', 'Gates', 'Plants', 'Flaky', 'Deleted', 'Unpinned', 'Lint', 'Timeouts', 'Proven', 'Intact', 'Repeats', 'Token', 'Queue p90', 'Token p50', 'Month end', 'Per merge', 'Blacksmith', 'Green p50', 'Green p95', 'Slowest']) {
    assert.ok(body.includes(label), label);
  }
  assert.ok(body.includes('checks') && body.includes('dco'), 'the spend table');
  assert.ok(body.includes('macos') && body.includes('3600'), 'the queue table');
});

test('with nothing measured the page still renders, with no invented numbers', () => {
  const { body } = render(context('missing', null));
  assert.doesNotMatch(body, /<figcaption>Allowance|qs-fill-q" width/);
  assert.ok(body.length > 0);
});

test('with no history the page shows no chart, not a red box that reads as a score of 0', () => {
  assert.doesNotMatch(render(context('measured', null)).body, /Too few|is-empty/);
});

test('the gauge stops at the ceiling and says so in numbers', () => {
  const html = gauge(6.25, 640, 300, 450, 500);
  assert.match(html, /aria-label="Heading for \$640 of \$500, \$6\.25 spent"/);
  assert.match(html, /▼ \$640/);
  assert.match(html, /qs-area-q" width="100\.00%"/);
  assert.match(html, /qs-fill-q" width="1\.25%"/);
});

test('with no ceiling in the spend detail the page draws no gauge, so no plan\'s dollars are invented', () => {
  const noCeiling = { ...DETAIL, readings: { ...DETAIL.readings, month_usd: { value: 6.25, limit: null, n: 784 } } };
  assert.doesNotMatch(render(context('measured', noCeiling)).body, /Allowance/);
  assert.match(render(context('measured', DETAIL)).body, /Allowance/);
});

test('with no spend detail the gauge still shows the forecast, with no invented spend', () => {
  const html = gauge(null, 90, 300, 450, 500);
  assert.match(html, /Missing/);
  assert.doesNotMatch(html, /qs-fill-q/);
});

test('a metric far over its floor lowers the total and caps nothing', () => {
  const base = context('measured', DETAIL);
  const over = manifest.metrics.map((m) => ({
    id: m.id,
    page: 'actions' as const,
    value: m.id === 'blacksmith_minutes_31d' ? m.floor + 100 : m.goal,
    status: 'ok' as const,
    stage: 'live' as const,
    measured_at: '2026-11-16T08:37:00Z',
    source_url: RUN,
    sample_size: m.min_samples,
  }));
  const score = scorePage('actions', { ...manifest, signoff_comment: 1 }, over, NOW);
  assert.ok(score.total < 100, `total ${score.total}`);
  const { body } = render({ ...base, score });
  assert.doesNotMatch(body, /"cap":/);
});
