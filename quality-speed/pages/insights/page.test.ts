// SPDX-License-Identifier: Apache-2.0
// Invented data only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { Manifest, MetricRecord } from '../../contract/format.ts';
import { calendar, shade } from './calendar.ts';
import { analyze } from './delivery.ts';
import { history, NOW } from './fixture.ts';
import { joinMetrics } from '../../contract/validate.ts';
import { countWords } from '../../core/guard.ts';
import { scorePage } from '../../core/score.ts';
import { baselineRecords, body, loadDetail, render, roadFixes, type BaselineFile } from './page.ts';
import { buildDetail, buildRecords, checkDetail, METRIC_IDS, utc } from './records.ts';
import { baselineScore, fromCore, pageScore } from './score.ts';
import { daily, sinceFirst } from './series.ts';

// Scored as if signed off, so the tests see readings; the list's own sign-off comes on its pull request.
const manifest = { ...(JSON.parse(readFileSync(new URL('manifest.json', import.meta.url), 'utf8')) as Manifest), signoff_comment: 1 };
const AT = utc(NOW);
const RUN = 'https://github.com/Colorado-Startups/legallas/actions/runs/1001';
const def = (id: string) => manifest.metrics.find((d) => d.id === id);

const rec = (id: string, value: number | null, samples: number, status: MetricRecord['status'] = 'ok'): MetricRecord =>
  value === null && status !== 'no_events'
    ? { id, page: 'insights', value: null, status: 'missing', stage: 'live', measured_at: null, source_url: null, sample_size: null }
    : { id, page: 'insights', value, status, stage: 'live', measured_at: AT, source_url: RUN, sample_size: status === 'no_events' ? 0 : samples };

const atGoal = () => manifest.metrics.map((d) => rec(d.id, d.goal, d.min_samples));

const invented = () => {
  const a = analyze(
    history(
      [
        { number: 1, mergedDaysAgo: 20.5, body: 'Closes #50.', title: 'An invented title that must not reach the page' },
        { number: 2, mergedDaysAgo: 20.2, body: 'A follow-up to #1.' },
        { number: 3, mergedDaysAgo: 12.5, leadHours: 3 },
        { number: 4, mergedDaysAgo: 3.5, dependabot: true },
      ],
      { issues: [50] },
    ),
    NOW,
  );
  const ctx = { measuredAt: AT, commit: 'c'.repeat(40), runUrl: RUN };
  return { records: buildRecords(a, { passed: true, checks: {} }, ctx), detail: buildDetail(a, ctx) };
};

describe('scoring, through the core rule', () => {
  it('reads exactly 100 with every metric at goal, and 0 with nothing', () => {
    assert.equal(pageScore(manifest, atGoal(), NOW).total, 100);
    assert.equal(pageScore(manifest, atGoal(), NOW).exactConsumption, 100, 'lane_minutes at goal too');
    const none = pageScore(manifest, [], NOW);
    assert.deepEqual([none.quality, none.speed, none.total], [0, 0, 0]);
  });

  it('scores 0 for too few samples or a stale reading, and no events only while the drill passes', () => {
    const records = atGoal().map((r) => (r.id === 'change_frequency' ? { ...r, sample_size: 6 } : r));
    assert.equal(pageScore(manifest, records, NOW).scores.get('change_frequency'), 0);
    assert.equal(pageScore(manifest, atGoal(), NOW + 49 * 3_600_000).total, 0);
    const quiet = atGoal().map((r) => (r.id === 'recovery_time_p50' ? rec(r.id, null, 0, 'no_events') : r));
    assert.equal(pageScore(manifest, quiet, NOW).scores.get('recovery_time_p50'), 100);
    const noDrill = quiet.map((r) => (r.id === 'failure_drill' ? { ...r, value: 0 } : r));
    const s = pageScore(manifest, noDrill, NOW);
    assert.deepEqual([s.scores.get('recovery_time_p50'), s.readings.get('recovery_time_p50')], [0, 'no_proof']);
  });

  it('draws a straight line between floor and goal', () => {
    const records = atGoal().map((r) => (r.id === 'rework_rate' ? { ...r, value: 22.5 } : r));
    assert.equal(pageScore(manifest, records, NOW).scores.get('rework_rate'), 50);
    assert.equal(def('rework_rate')?.weight, 2);
  });
});

describe('series and calendar', () => {
  it('fills the last 28 completed days from the rows, oldest first', () => {
    const { detail } = invented();
    const days = daily(detail, NOW);
    assert.equal(days.length, 28);
    const busy = days.filter((d) => d.changes > 0);
    assert.deepEqual(
      busy.map((d) => [d.changes, d.failed, d.rework, d.tied]),
      [
        [2, 1, 50, 100],
        [1, 0, 0, 0],
        [1, 0, 0, null],
      ],
    );
    assert.equal(sinceFirst(days)[0]?.changes, 2);
    assert.deepEqual(checkDetail(detail), []);
  });

  it('shades by changes and marks a day whose changes later needed repair', () => {
    assert.deepEqual([0, 1, 4, 5, 14, 15].map(shade), [0, 1, 1, 2, 2, 3]);
    const html = calendar(daily(invented().detail, NOW), 'Change days');
    assert.equal((html.match(/<td><span class="qs-heat/g) ?? []).length, 28);
    assert.equal((html.match(/<tr><th scope="row">/g) ?? []).length, 4);
    assert.equal((html.match(/needed repair/g) ?? []).length, 1);
    assert.match(html, /3\/28/);
    assert.ok(!/style=|on\w+=|fill-opacity/.test(html));
  });
});

describe('page', () => {
  const pieces = (records: MetricRecord[], detail: ReturnType<typeof invented>['detail'] | null) => ({
    metrics: joinMetrics(manifest, records),
    score: pageScore(manifest, records, NOW),
    baseline: records,
    baseScore: baselineScore(manifest, records, NOW),
    detail,
    now: NOW,
  });

  it('stays within 80 visible words as the site counts them, with no inline styles or handlers and no text from the history', () => {
    const { records, detail } = invented();
    const html = body(pieces(records, detail));
    // The build adds the title, "Home" and the ring around the body.
    assert.ok(countWords(html) + 2 <= 80, `visible words: ${countWords(html)}`);
    assert.ok(!/style=|on\w+=|<h1/.test(html));
    assert.ok(!html.includes('invented'));
    assert.match(html, /Change days/);
  });

  it('shows a red tile for the drill-down when no rows are at hand, and renders with every metric missing', () => {
    const html = body(pieces([], null));
    assert.match(html, /Change days/);
    assert.ok(!html.includes('Recoveries'));
    assert.ok(countWords(html) + 2 <= 80);
    assert.equal(loadDetail({ changes: [], recoveries: [], title: 'words' }), null);
    assert.equal(loadDetail({ page: 'insights' }), null);
  });

  it('renders inside the build from the context it passes', () => {
    const records = atGoal();
    const output = render({ score: scorePage('insights', manifest, records, new Date(NOW)), metrics: joinMetrics(manifest, records), history: [], others: {}, detail: null });
    assert.ok(output.body.length > 0);
    assert.equal(fromCore(scorePage('insights', manifest, records, new Date(NOW))).total, 100);
  });

  it('Road to 100: the fixes add up to the points short, largest gain first, and none at goal', () => {
    const { records } = invented();
    const score = pageScore(manifest, records, NOW);
    const fixes = roadFixes(manifest, score);
    assert.ok(Math.abs(fixes.reduce((a, f) => a + f.q, 0) - (100 - score.exactQuality)) < 1e-6);
    assert.ok(Math.abs(fixes.reduce((a, f) => a + f.s, 0) - (100 - score.exactSpeed)) < 1e-6);
    assert.ok(Math.abs(fixes.reduce((a, f) => a + (f.c ?? 0), 0) - (100 - score.exactConsumption)) < 1e-6);
    // A third of each lens, as the total counts them.
    const gains = fixes.map((f) => (f.q + f.s + (f.c ?? 0)) / 3);
    assert.deepEqual(gains, [...gains].sort((a, b) => b - a));
    assert.deepEqual(roadFixes(manifest, pageScore(manifest, atGoal(), NOW)), []);
  });

  it('turns the committed baseline into records the page can mark', () => {
    const file = JSON.parse(readFileSync(new URL('baseline/readings.json', import.meta.url), 'utf8')) as BaselineFile;
    const records = baselineRecords(file);
    assert.deepEqual(records.map((r) => r.id), [...METRIC_IDS]);
    assert.deepEqual(checkDetail(file), []);
    assert.deepEqual(checkDetail(JSON.parse(readFileSync(new URL('baseline/detail.json', import.meta.url), 'utf8'))), []);
    // PLAN.md's lens scores, and a third each of them.
    const base = baselineScore(manifest, records, Date.parse(file.measured_at));
    const exact = { q: base.exactQuality, s: base.exactSpeed, c: base.exactConsumption };
    assert.deepEqual([exact.q, exact.s, exact.c].map((v) => Math.round(v * 10) / 10), [28.8, 60, 0]);
    assert.equal(base.total, 29);
  });
});
