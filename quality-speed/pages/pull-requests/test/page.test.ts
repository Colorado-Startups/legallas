// The page on invented facts only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { joinMetrics } from '../../../contract/validate.ts';
import type { PageContext } from '../../../core/build.ts';
import { frameWords } from '../../../core/build.ts';
import { countWords, MAX_WORDS } from '../../../core/guard.ts';
import { scorePage } from '../../../core/score.ts';
import { fixGains, render } from '../page.ts';
import type { PullFacts } from '../src/facts.ts';
import { type Collected, type Manifest, type MetricRecord, failedRecords, records } from '../src/metrics.ts';

// Scored as if signed off, so the page shows readings.
const manifest = { ...(JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as Manifest), signoff_comment: 1 };
const NOW = new Date('2030-03-01T00:00:00Z');
const DAY = 86400000;
const URL_ = 'https://github.com/Colorado-Startups/legallas/actions/runs/1';

function fact(n: number, daysAgo: number, over: Partial<PullFacts> = {}): PullFacts {
  const ended = new Date(NOW.getTime() - daysAgo * DAY).toISOString();
  return {
    v: 6,
    number: n,
    state: 'merged',
    created_at: new Date(Date.parse(ended) - 20 * 60000).toISOString(),
    ended_at: ended,
    ready_at: ended,
    merge_sha: `sha${n}0000000`,
    excluded: null,
    bot: false,
    size_lines: 100,
    gate_misses: [],
    ci_green_first_time: true,
    drew_blocking: false,
    template_complete: true,
    edit_checked: true,
    open_minutes: 20,
    review_result_minutes: [2],
    fixes: [],
    reverts: [],
    rework_unknown: false,
    queue_minutes: 2,
    queue_ejected: false,
    ci_heads: 1,
    final_push_minutes: 2,
    verdicts: 1,
    review_tokens: [30000],
    stacked: false,
    ...over,
  };
}

function data(count = 50): Collected {
  const pulls = Array.from({ length: count }, (_, i) => fact(i + 1, i < count / 2 ? 2 : 12, i % 7 === 0 ? { size_lines: 900, gate_misses: ['ci_not_green'] } : {}));
  return { pulls, open: [], direct_pushes: [], deleted_runs: [], queue_runs: [] };
}

function context(rs: MetricRecord[]): PageContext {
  return { score: scorePage('pull-requests', manifest, rs, NOW), metrics: joinMetrics(manifest, rs), history: [], others: {}, detail: null };
}

test('page: within the word budget, no em dashes, the four sections and Road to 100 present', () => {
  const { body } = render(context(records(data(), manifest, NOW, URL_)));
  assert.ok(countWords(body) <= MAX_WORDS - frameWords('pull-requests'), `visible words: ${countWords(body)}`);
  assert.doesNotMatch(body, /<time/, 'no date per row');
  assert.equal(body.includes(String.fromCharCode(0x2014)), false);
  for (const h of ['Pull requests', 'Review', 'Merge queue', 'Stacks']) assert.ok(body.includes(`<h2>${h}</h2>`), h);
  assert.ok(body.includes('Gates') && body.includes('Road to 100'));
});

test('page: a failed collection shows every metric missing, never a number', () => {
  const { body } = render(context(failedRecords(manifest)));
  assert.ok(countWords(body) <= MAX_WORDS - frameWords('pull-requests'), `visible words: ${countWords(body)}`);
  assert.ok((body.match(/Missing/g) ?? []).length >= manifest.metrics.length);
});

test('road: fixes add exactly the points left in each Quality metric', () => {
  const ctx = context(records(data(), manifest, NOW, URL_));
  const gains = fixGains(ctx.metrics, ctx.score.metrics);
  for (const g of gains) assert.equal(g.s, 0, 'every fix today is a Quality fix');
  const failed = context(failedRecords(manifest));
  const total = fixGains(failed.metrics, failed.score.metrics).reduce((n, g) => n + g.q, 0);
  // With every metric at 0, the fixes cover every Quality metric's weight share: the whole ring.
  assert.ok(Math.abs(total - 100) < 0.5, `sum ${total}`);
});

test('road: merges that missed a required gate lower Quality but cap nothing (#645)', () => {
  const ctx = context(records(data(), manifest, NOW, URL_));
  assert.ok((ctx.score.metrics.find((m) => m.id === 'required_gates_on_merged_head')?.score ?? 100) < 100);
  assert.doesNotMatch(render(ctx).body, /qs-cap/);
});
