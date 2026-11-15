// SPDX-License-Identifier: Apache-2.0
// Every component renders correct, safe, accessible markup. The tests run in seconds, with no packages.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bullet, bulletPosition, dataTable, dayStrip, dotMatrix, esc, filmstrip, fmtDate, fmtValue, GOAL_AT, heatLegend, heatmap, historyRows, meter,
  metricBullet, metricTile, pictogram, ring, ringGrid, roadTo100, scoreBand, sparkline, statTile, timeline, trend,
} from './index.ts';
import type { MetricLike } from './index.ts';
import { safeHref } from './svg.ts';
import { EXAMPLES } from './examples/gallery.ts';
import { assertBalanced, assertSafe } from './markup-checks.ts';

for (const example of EXAMPLES) {
  test(`example: ${example.name}`, () => {
    assert.ok(example.html.length > 0);
    assertBalanced(example.html, example.name);
    assertSafe(example.html, example.name);
  });
}

test('text is escaped everywhere it can appear', () => {
  const evil = '<img src=x onerror=alert(1)>"\'';
  const outputs = [
    ring({ q: 1, s: 1, total: 1, label: evil, note: evil }),
    bullet({ label: evil, value: 1, floor: 0, goal: 2 }),
    trend({ label: evil, points: [{ t: '2026-11-01', v: 1 }, { t: '2026-11-02', v: 2 }] }),
    heatmap({ title: evil, rows: [{ id: 'r', label: evil }], cols: [{ id: 'c', label: evil }], cells: [{ row: 'r', col: 'c', score: 5 }] }),
    dataTable({ caption: evil, columns: [{ key: 'a', label: evil }], rows: [{ a: evil }] }),
    roadTo100({ title: evil, baseline: { q: 0, s: 0, total: 0 }, now: { q: 1, s: 1, total: 1 }, fixes: [{ id: evil, label: evil, q: 1, s: 1 }] }),
    filmstrip({ id: 'p', title: evil, frames: [{ label: evil, sketch: 'log', ms: 1 }] }),
    statTile({ label: evil, value: 1 }),
    pictogram({ label: evil, total: 1, filled: 1 }),
    dotMatrix({ caption: evil, rows: [evil], cols: [evil], states: [['pass']] }),
    meter({ label: evil, value: 1, limit: 2 }),
    dayStrip({ label: evil, days: [{ t: '2026-11-01', state: 'ok' }] }),
  ];
  for (const html of outputs) assert.doesNotMatch(html, /<img src=x/);
});

test('a JSON block cannot close its own script tag', () => {
  const html = roadTo100({ baseline: { q: 0, s: 0, total: 0 }, now: { q: 1, s: 1, total: 1 }, fixes: [{ id: '</script><b>', label: 'x', q: 1, s: 1 }] });
  assert.doesNotMatch(html, /<\/script><b>/);
  assert.match(html, /\\u003c\/script>/);
});

test('unsafe links are dropped, safe ones kept', () => {
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('JAVASCRIPT:alert(1)'), null);
  assert.equal(safeHref('data:text/html,x'), null);
  assert.equal(safeHref('//example.com/x'), null);
  assert.equal(safeHref('java\tscript:alert(1)'), null, 'browsers strip a tab, so this still runs');
  assert.equal(safeHref(' javascript:alert(1)'), null, 'browsers trim a leading space');
  assert.equal(safeHref('java\nscript:alert(1)'), null);
  assert.equal(safeHref('/\\evil.example'), null, 'browsers read a backslash as a slash, so this leaves the site');
  assert.equal(safeHref('https://example.com/x'), null);
  assert.equal(safeHref('#cell'), '#cell');
  assert.equal(safeHref('../code/'), '../code/');
  assert.equal(safeHref('https://github.com/Colorado-Startups/legallas/issues/18'), 'https://github.com/Colorado-Startups/legallas/issues/18');
  assert.doesNotMatch(ring({ q: 1, s: 1, total: 1, href: 'javascript:alert(1)' }), /<a /);
  assert.doesNotMatch(heatmap({ title: 't', rows: [{ id: 'r', label: 'R' }], cols: [{ id: 'c', label: 'C' }], cells: [{ row: 'r', col: 'c', score: 5, href: 'javascript:x' }] }), /<a /);
});

test('formats follow the contract units and never depend on the machine', () => {
  const cases: [number, string, string][] = [
    [840, 'ms', '840 ms'], [1500, 'ms', '1.5 s'], [12.34, 'seconds', '12.3 s'], [3, 'minutes', '3 min'], [2, 'hours', '2 h'], [4, 'days', '4 d'],
    [72.5, 'percent', '72.5%'], [84300, 'bytes', '84 KB'], [2_500_000, 'bytes', '2.5 MB'], [512, 'bytes', '512 B'], [13, 'usd', '$13'],
    [1, 'pass', 'Pass'], [0, 'pass', 'Fail'], [0.82, 'ratio', '0.82'], [3, 'per_week', '3/wk'], [1284, 'count', '1,284'], [12900, 'count', '12.9K'], [67, 'score', '67'],
  ];
  for (const [value, unit, expected] of cases) assert.equal(fmtValue(value, unit), expected);
  assert.equal(fmtDate('2026-11-02'), '2 Nov');
  assert.equal(fmtDate('2026-01-09T23:59:00Z'), '9 Jan');
  assert.equal(fmtDate(undefined), '');
  assert.equal(fmtDate('not a date'), '');
  assert.equal(esc(null), '');
  assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;', 'a quote left in would break out of an attribute');
});

test('score bands: 0 is empty, 100 is the only top band', () => {
  assert.deepEqual([0, 1, 24, 25, 49, 50, 74, 75, 99, 99.9, 100].map(scoreBand), [0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5]);
});

test('a value that is not a number never reads as good', () => {
  assert.equal(scoreBand(Number.NaN), 0, 'a 0/0 must not get the darkest tile and a check');
  assert.equal(scoreBand(Number.POSITIVE_INFINITY), 0);
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const row = bullet({ label: 'x', value, floor: 0, goal: 10 });
    assert.match(row, /is-empty/);
    assert.doesNotMatch(row, /M3 8\.5/, 'no check');
    assert.match(ring({ q: value, s: 1, total: 1 }), /is-missing/);
    assert.match(statTile({ label: 'x', value }), /is-missing/);
    assert.match(meter({ label: 'x', value, limit: 10 }), /is-over/);
    const cell = heatmap({ title: 't', rows: [{ id: 'r', label: 'R' }], cols: [{ id: 'c', label: 'C' }], cells: [{ row: 'r', col: 'c', score: value }] });
    assert.match(cell, /qs-h0 is-missing/);
    assertSafe(row + cell, 'not a number');
  }
  const gappy = trend({ label: 'x', points: [{ t: '2026-11-01', v: 1 }, { t: '2026-11-02', v: Number.NaN }, { t: '2026-11-03', v: 3 }] });
  assertSafe(gappy, 'trend with a gap');
  assert.match(trend({ label: 'x', points: [{ t: '2026-11-01', v: 1 }, { t: '2026-11-02', v: 3 }, { t: '2026-11-03', v: Number.NaN }] }), /qs-trend-empty/, 'a broken newest reading is not hidden');
});

test('typed values that arrive wrong cannot break out of the markup', () => {
  const evil = '"><img src=x>' as never;
  const outputs = [
    dotMatrix({ caption: 'c', rows: ['r'], cols: ['c'], states: [[evil]] }),
    ring({ q: 1, s: 1, total: evil }),
    ring({ q: 1, s: 1, total: 1, size: evil }),
    filmstrip({ id: 'j', title: 't', score: evil, frames: [{ label: 'a', ms: 1, state: evil }] }),
    pictogram({ label: 'x', total: 1, filled: evil }),
    pictogram({ label: 'x', total: evil, filled: 1 }),
    dayStrip({ label: 'x', days: [{ t: '2026-11-01', state: evil }] }),
    trend({ label: 'x', height: evil, points: [{ t: '2026-11-01', v: 1 }, { t: '2026-11-02', v: 2 }] }),
    roadTo100({ baseline: { q: 0, s: 0, total: evil }, now: { q: 1, s: 1, total: evil }, fixes: [] }),
  ];
  for (const html of outputs) assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(timeline({ main: 'a', history: [], src: 'javascript:x' }), /data-src/);
  assert.match(timeline({ main: 'a', history: [], src: 'javascript:x' }), /application\/json/, 'a refused source falls back to the page');
});

test('ring: says its numbers, and draws Quality twice as thick as Speed', () => {
  const html = ring({ q: 72.6, s: 58, total: 67, label: 'Code' });
  assert.match(html, /aria-label="Code: total 67 of 100\. Quality 72\. Speed 58\."/);
  assert.match(html, /data-arc="q"[^>]*r="84" stroke-width="20"/);
  assert.match(html, /data-arc="s"[^>]*r="58" stroke-width="10"/);
  assert.match(html, /role="img"/);
  assert.match(html, /Quality <b data-num="q">72<\/b>/);
});

test('ring: Consumption draws a third ring and key entry, and a ring without it draws as before', () => {
  const html = ring({ q: 72.6, s: 58, c: 41.2, total: 67, label: 'Code' });
  assert.match(html, /aria-label="Code: total 67 of 100\. Quality 72\. Speed 58\. Consumption 41\."/);
  assert.match(html, /data-arc="q"[^>]*r="86" stroke-width="12"/, 'a third each, so the same width');
  assert.match(html, /data-arc="s"[^>]*r="70" stroke-width="12"/);
  assert.match(html, /data-arc="c"[^>]*r="54" stroke-width="12"[^>]*stroke-dasharray="41\.2 100"/);
  assert.match(html, /qs-rt qs-rt-c/);
  assert.match(html, /Consumption <b data-num="c">41<\/b>/);
  assert.match(ring({ q: 50, s: 50, c: null, total: 50 }), /data-arc="c"[^>]*stroke-dasharray="0 100"/, 'an unmeasured lens draws empty, never full');
  assert.match(ring({ q: null, s: 50, c: 90, total: 50 }), /data-arc="c"[^>]*stroke-dasharray="0 100"/, 'a missing ring shows 0 in every lens');
  const two = ring({ q: 72.6, s: 58, total: 67 });
  assert.doesNotMatch(two, /data-arc="c"|Consumption/);
  assert.match(two, /data-arc="q"[^>]*r="84" stroke-width="20"/);
});

test('every lens has its own class on bullets, tiles, trends and day strips', () => {
  assert.match(bullet({ label: 'Tokens', value: 400, unit: 'tokens', floor: 1000, goal: 200, lens: 'consumption' }), /qs-fill-c/);
  assert.match(statTile({ label: 'Tokens', value: 400, unit: 'tokens', spark: [1, 2, 3], lens: 'consumption' }), /qs-spark-c/);
  assert.match(statTile({ label: 'Build', value: 4, unit: 'minutes', spark: [1, 2, 3], lens: 'speed' }), /qs-spark-s/);
  assert.match(statTile({ label: 'Cover', value: 4, unit: 'percent', spark: [1, 2, 3] }), /qs-spark-q/);
  assert.match(trend({ label: 'Tokens', lens: 'consumption', points: [{ t: '2026-11-01', v: 1 }, { t: '2026-11-02', v: 2 }] }), /qs-line-c/);
  assert.match(dayStrip({ label: 'Under budget', lens: 'consumption', days: [{ t: '2026-11-01', state: 'ok' }] }), /qs-fill-c/);
});

test('historyRows: a line with consumption carries it, and an older line has none', () => {
  const rows = historyRows([
    { at: '2026-11-01T06:00:00Z', page: 'code', quality: 80, speed: 60, total: 73 },
    { at: '2026-11-02T06:00:00Z', page: 'code', quality: 80, speed: 60, consumption: 40, total: 73 },
  ]);
  assert.deepEqual(rows.map((r) => r.rings.code), [{ q: 80, s: 60, total: 73 }, { q: 80, s: 60, c: 40, total: 73 }]);
});

test('ring: no data is 0 and red, never a blank that could read as fine', () => {
  const html = ring({ q: null, s: null, total: null, label: 'Projects' });
  assert.match(html, /is-missing/);
  assert.match(html, /data-num="total">0</);
  assert.match(html, /no data, scores 0/);
});

test('ring: a score with a part missing shows 0 everywhere, never a number beside "no data"', () => {
  for (const props of [{ q: null, s: 80, total: 53 }, { q: 80, s: null, total: 53 }, { q: 80, s: 80, total: null }]) {
    const html = ring(props);
    assert.match(html, /data-num="total">0</, JSON.stringify(props));
    assert.match(html, /no data, scores 0/);
    assert.match(html, /data-arc="q"[^>]*stroke-dasharray="0 100"/, 'no arc for a part that was measured either');
  }
});

test('ring: only 100 reads as full', () => {
  assert.match(ring({ q: 100, s: 100, total: 100 }), /is-full/);
  assert.doesNotMatch(ring({ q: 100, s: 98, total: 99 }), /is-full/);
});

test('ring: arcs are drawn to scale, and a zero draws nothing', () => {
  assert.match(ring({ q: 72.5, s: 0, total: 48 }), /data-arc="q"[^>]*stroke-dasharray="72\.5 100"/);
  assert.match(ring({ q: 72.5, s: 0, total: 48 }), /data-arc="s"[^>]*stroke-dasharray="0 100"/);
  assert.match(ring({ q: 250, s: -5, total: 48 }), /data-arc="q"[^>]*stroke-dasharray="100 100"/);
});

test('ringGrid: holds 26 sections in three groups that collapse, with the lead largest and the others small and linked', () => {
  const small = (i: number) => ({ q: i, s: i, total: i, label: `Section ${i}`, href: `#s${i}` });
  const group = (label: string, from: number, count: number) => ({ label, rings: Array.from({ length: count }, (_, i) => small(from + i)) });
  const html = ringGrid({ q: 1, s: 1, total: 1, label: 'Lead' }, [group('Product', 0, 4), group('Repo', 4, 11), group('Law', 15, 10)]);
  assertBalanced(html, 'ringGrid');
  assert.equal((html.match(/<figure /g) ?? []).length, 26);
  assert.equal((html.match(/qs-ring--xl/g) ?? []).length, 1);
  assert.equal((html.match(/qs-ring--sm/g) ?? []).length, 25);
  assert.match(html, /qs-home-lead"><figure class="qs-ring qs-ring--xl/);
  assert.equal((html.match(/<details class="qs-home-group" open>/g) ?? []).length, 3, 'every group starts open and can collapse');
  assert.match(html, /<h2>Law<\/h2> <span class="qs-home-count">10</);
  assert.equal((html.match(/<a class="qs-ring-link"/g) ?? []).length, 25);
  assert.match(html, /qs-home-lead[\s\S]*Quality <b[\s\S]*qs-home-groups/, 'the lead names Quality and Speed');
  assert.doesNotMatch(html.slice(html.indexOf('qs-home-groups')), /Quality <b/, 'small rings stay clear: the total and a label');
});

test('bullet: right is better in either direction, and the goal is at its tick', () => {
  assert.equal(bulletPosition(0, 0, 100), 0);
  assert.equal(bulletPosition(100, 0, 100), GOAL_AT);
  assert.equal(bulletPosition(3000, 3000, 500), 0);
  assert.equal(bulletPosition(500, 3000, 500), GOAL_AT);
  assert.ok(bulletPosition(840, 3000, 500) > bulletPosition(1900, 3000, 500));
  assert.equal(bulletPosition(9000, 3000, 500), 0, 'worse than the floor stays at the floor');
  assert.equal(bulletPosition(-5000, 3000, 500), 1, 'far past the goal stays on the bar');
  assert.equal(bulletPosition(5, 5, 5), GOAL_AT);
});

test('bullet: states read in words, never in color alone', () => {
  for (const [status, word] of [['missing', 'Missing'], ['stale', 'Stale'], ['few_samples', 'Too few'], ['no_proof', 'No proof']] as const) {
    const html = bullet({ label: 'x', value: 5, floor: 0, goal: 10, status });
    assert.match(html, /is-empty/);
    assert.match(html, new RegExp(`<span class="qs-state-word">${word}</span>`), 'the guard skips this exact span');
    assert.doesNotMatch(html, /qs-status/, 'qs-status is styled good: a state word must not wear it');
    assert.doesNotMatch(html, /qs-fill/, 'an empty bullet shows no measured fill');
  }
  assert.match(bullet({ label: 'x', value: null, floor: 0, goal: 10 }), /is-empty/);
  assert.match(bullet({ label: 'x', value: 10, floor: 0, goal: 10 }), /M3 8\.5/, 'at goal shows a check');
  const clean = bullet({ label: 'x', value: null, floor: 10, goal: 1, status: 'no_events' });
  assert.match(clean, /No events/);
  assert.doesNotMatch(clean, /is-empty/);
});

test('metric adapters take a contract metric as it is, and the reading decides', () => {
  const metric: MetricLike = { lens: 'speed', unit: 'ms', floor: 3000, goal: 500, value: 400, stage: 'lab', measured_at: '2025-01-01T06:17:00Z', source_url: 'https://github.com/Colorado-Startups/legallas/actions/runs/1' };
  const props = metricBullet(metric, 'Search', { reading: 'measured', baseline: 1900 });
  assert.equal(props.lens, 'speed');
  assert.equal(props.baseline, 1900);
  assert.equal(props.time, '2025-01-01T06:17:00Z');
  assert.match(bullet(props), /<a href="https:\/\/github\.com/);
  assert.match(bullet(props), /M3 8\.5/, 'measured and past the goal shows a check');
  const old = bullet(metricBullet(metric, 'Search', { reading: 'stale' }));
  assert.match(old, /is-empty/, 'a year-old record shows red, whatever its value');
  assert.doesNotMatch(old, /M3 8\.5/);
  assert.equal(metricBullet(metric, 'x', { reading: 'too_few_samples' }).status, 'few_samples');
  assert.equal(metricBullet({ ...metric, value: null }, 'x', { reading: 'missing' }).status, 'missing');
  assert.equal(metricBullet(metric, 'x', { reading: 'something else' as never }).status, 'missing', 'an unknown reading never reads as fine');
  const forgot = metricBullet as unknown as (metric: MetricLike, label: string) => { status: string };
  assert.equal(forgot(metric, 'x').status, 'missing', 'a call with no reading shows missing, and does not throw');
  const forgotTile = metricTile as unknown as (metric: MetricLike, label: string) => string;
  assert.match(forgotTile(metric, 'x'), /is-missing/);
  assert.equal(metricBullet({ ...metric, source_url: 'https://example.com/x' }, 'x', { reading: 'measured' }).href, undefined);
  assert.match(metricTile(metric, 'Search', { reading: 'stale' }), /is-missing/);
  assert.match(metricTile(metric, 'Search', { reading: 'measured', delta: -100 }), /is-good/, 'lower is better here, so a fall is good');
});

test('trend: a missing day breaks the line, stays in the table, and shows red', () => {
  const html = trend({ label: 'x', points: [{ t: '2026-11-01', v: 90 }, { t: '2026-11-02', v: Number.NaN }, { t: '2026-11-03', v: 95 }, { t: '2026-11-04', v: null }, { t: '2026-11-05', v: 96 }] });
  assertSafe(html, 'trend with gaps');
  const line = /qs-line-q" d="([^"]+)"/.exec(html)?.[1] ?? '';
  assert.equal((line.match(/M/g) ?? []).length, 3, `three stretches, not one straight run: ${line}`);
  assert.equal((html.match(/class="qs-gap"/g) ?? []).length, 2, 'each gap is marked in red');
  const rows = /<tbody>(.*?)<\/tbody>/.exec(html)?.[1] ?? '';
  assert.equal((rows.match(/<tr>/g) ?? []).length, 5, 'the table keeps every day');
  assert.equal((rows.match(/Missing/g) ?? []).length, 2);
  assert.match(html, /2 missing\./, 'the spoken summary says so too');
  assert.match(html, /data-tv="Missing" data-tl="2 Nov"/);
});

test('sparkline: its class is escaped, and a gap breaks its line', () => {
  assert.doesNotMatch(sparkline([1, 2], 'x" onload="alert(1)'), /onload="/);
  const line = /<path d="([^"]+)"/.exec(sparkline([1, Number.NaN, 2, 3]))?.[1] ?? '';
  assert.equal((line.match(/M/g) ?? []).length, 2, line);
});

test('trend: too few points says so instead of drawing a line', () => {
  assert.match(trend({ label: 'x', points: [] }), /Too few/);
  assert.match(trend({ label: 'x', points: [{ t: '2026-11-02', v: 1 }] }), /qs-trend-empty/);
  assert.match(trend({ label: 'x', status: 'missing', points: [{ t: '2026-11-01', v: 1 }, { t: '2026-11-02', v: 1 }] }), /Missing/);
});

test('trend: marks stay on one scale, with a table twin and a spoken summary', () => {
  const html = trend({ label: 'Total', domain: [0, 100], goal: 100, height: 146, points: [{ t: '2026-11-01', v: 0 }, { t: '2026-11-02', v: 100 }] });
  assert.match(html, /d="M1 124 98 24"/, 'bottom of the plot is 0, top is 100');
  assert.match(html, /aria-label="Total: 100 on 2 Nov, from 0 on 1 Nov\. Goal 100\."/);
  assert.match(html, /<details class="qs-tv">/);
  assert.match(html, /vector-effect="non-scaling-stroke"/);
});

test('trend: the baseline label sits on the side the line moves away from, so it stays clear of the line', () => {
  const place = (from: number, to: number) => {
    const html = trend({ label: 'x', domain: [0, 100], baseline: 50, points: [{ t: '2026-11-01', v: from }, { t: '2026-11-02', v: to }] });
    const line = Number(/qs-base-line" x1="0" x2="100%" y1="([\d.]+)"/.exec(html)?.[1]);
    const text = Number(/<text class="qs-ref" x="0" y="([\d.]+)">▽/.exec(html)?.[1]);
    return text - line;
  };
  assert.ok(place(50, 90) > 0, 'rising: below the baseline');
  assert.ok(place(50, 10) < 0, 'falling: above it');
  const low = trend({ label: 'x', domain: [0, 100], baseline: 1, height: 146, points: [{ t: '2026-11-01', v: 1 }, { t: '2026-11-02', v: 90 }] });
  assert.ok(Number(/<text class="qs-ref" x="0" y="([\d.]+)">▽/.exec(low)?.[1]) <= 122, 'a low baseline stays above the axis');
});

test('trend: each point has a hover area, and together they cover the whole width', () => {
  const html = trend({ label: 'x', points: [{ t: '2026-11-01', v: 1 }, { t: '2026-11-02', v: 2 }, { t: '2026-11-03', v: 3 }] });
  const hits = [...html.matchAll(/class="qs-hit" x="([\d.]+)%" y="0" width="([\d.]+)%"/g)];
  assert.equal(hits.length, 3);
  assert.equal(Number(hits[0]?.[1]), 0);
  const end = Number(hits[2]?.[1]) + Number(hits[2]?.[2]);
  assert.ok(Math.abs(end - 100) < 0.01, `ends at ${end}`);
  assert.match(html, /data-tv="3" data-tl="3 Nov"/);
});

test('trend: a flat line does not divide by zero', () => {
  assert.doesNotMatch(trend({ label: 'x', points: [{ t: '2026-11-01', v: 5 }, { t: '2026-11-02', v: 5 }] }), /NaN|Infinity/);
  assert.doesNotMatch(trend({ label: 'x', points: [{ t: '2026-11-01', v: 0 }, { t: '2026-11-02', v: 0 }] }), /NaN|Infinity/);
});

test('heatmap: a real table, numbers in every cell, and links only where allowed', () => {
  const html = heatmap({
    title: 'Forming',
    note: '40%',
    rows: [{ id: 'founder', label: 'Founder' }, { id: 'investor', label: 'Investor' }],
    cols: [{ id: 'find', label: 'Find it fast', short: 'Find' }],
    cells: [{ row: 'founder', col: 'find', score: 71, href: '#a' }, { row: 'investor', col: 'find', score: null, excluded: true }],
  });
  assert.match(html, /<caption>Forming/);
  assert.match(html, /scope="col" title="Find it fast">Find</);
  assert.match(html, /scope="row"/);
  assert.match(html, /href="#a" aria-label="Founder, Find it fast: 71"/);
  assert.match(html, /Investor, Find it fast: not applicable/);
  assert.equal((html.match(/<a /g) ?? []).length, 1, 'an excluded cell has no link');
});

test('heatmap: 0 and missing are empty red tiles, and 100 carries a check', () => {
  const grid = (score: number | null) => heatmap({ title: 't', rows: [{ id: 'r', label: 'R' }], cols: [{ id: 'c', label: 'C' }], cells: [{ row: 'r', col: 'c', score }] });
  assert.match(grid(0), /qs-h0/);
  assert.match(grid(null), /qs-h0 is-missing/);
  assert.match(grid(null), /missing, scores 0/);
  assert.match(grid(100), /qs-h5/);
  assert.match(grid(100), /M3 8\.5/);
  assert.match(heatLegend(), /role="img"/);
});

test('heatmap: a cell with no record is an empty red tile, and only a listed exclusion is hatched', () => {
  const html = heatmap({ title: 't', rows: [{ id: 'r', label: 'R' }], cols: [{ id: 'c', label: 'C' }], cells: [] });
  assert.match(html, /qs-h0 is-missing/);
  assert.doesNotMatch(html, /qs-hx/);
  assert.match(html, /missing, scores 0/);
  const listed = heatmap({ title: 't', rows: [{ id: 'r', label: 'R' }], cols: [{ id: 'c', label: 'C' }], cells: [{ row: 'r', col: 'c', score: null, excluded: true }] });
  assert.match(listed, /qs-hx/);
});

test('dotMatrix: a state with no record is red and says missing, and only a listed na is hatched', () => {
  const absent = dotMatrix({ caption: 'c', rows: ['r'], cols: ['c'], states: [[]] });
  assert.match(absent, /qs-dm-fail/);
  assert.match(absent, /missing/);
  assert.doesNotMatch(absent, /qs-dm-na/);
  assert.match(dotMatrix({ caption: 'c', rows: ['r'], cols: ['c'], states: [['na']] }), /qs-dm-na/);
});

test('table: a missing score shows as missing, never as 0', () => {
  const html = dataTable({ caption: 'c', columns: [{ key: 's', label: 'S', type: 'score' }], rows: [{ s: null }, { s: 0 }] });
  const cells = [...html.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1] ?? '');
  assert.doesNotMatch(cells[0] ?? '', />0</);
  assert.match(cells[0] ?? '', /Missing/);
  assert.match(cells[1] ?? '', />0</, 'a measured 0 still reads 0');
});

test('table: sorts on raw values, shows formatted ones, and hides the filter until the script arrives', () => {
  const html = dataTable({
    caption: 'c',
    columns: [{ key: 'm', label: 'M' }, { key: 'v', label: 'V', type: 'num', unitKey: 'u' }, { key: 's', label: 'S', type: 'score' }, { key: 't', label: 'T', type: 'status' }],
    rows: [{ m: 'a', v: 1500, u: 'ms', s: 62, t: 'ok' }, { m: 'b', v: null, u: 'ms', s: 0, t: 'missing' }],
  });
  assert.match(html, /data-v="1500">1\.5 s</);
  assert.match(html, /<td class="qs-num"><\/td>/, 'a blank cell sorts on its empty text, so it goes last');
  assert.match(html, /<td>a<\/td>/, 'a plain text cell sorts on its text, with no data-v');
  assert.match(html, /<th scope="col"><button/, 'a text header has no empty class');
  assert.doesNotMatch(html, /class=""/);
  assert.equal((html.match(/data-qs-sort/g) ?? []).length, 4);
  assert.match(html, /class="qs-filter" hidden/);
  assert.match(html, /data-qs-count>2\/2</);
  assert.match(html, /qs-status is-bad/);
  assert.doesNotMatch(dataTable({ caption: 'c', filter: false, columns: [], rows: [] }), /qs-filter/);
});

test('road: bars cascade from now to 100, and a shortfall shows as a gap', () => {
  const props = { baseline: { q: 40, s: 40, c: 40, total: 40 }, now: { q: 70, s: 70, c: 70, total: 70 } };
  const full = roadTo100({ ...props, fixes: [{ id: 'a', label: 'A', q: 15, s: 15, c: 15 }, { id: 'b', label: 'B', q: 15, s: 15, c: 15 }] });
  assert.doesNotMatch(full, /No fix yet/);
  assert.match(full, /qs-seg-q" x="0%"/, 'the now row starts at 0');
  assert.match(full, /qs-seg-q" x="70%"/, 'the first fix starts at now');
  assert.match(full, /qs-seg-q" x="85%"/, 'the second starts where the first ends');
  assert.match(full, /qs-seg-c" x="95%" y="5" width="5%"/, 'each lens is a third of a fix');
  const short = roadTo100({ ...props, fixes: [{ id: 'a', label: 'A', q: 15, s: 15, c: 15 }] });
  assert.match(short, /No fix yet/);
  assert.match(short, /\+15<\/span><\/li><\/ol>/);
});

test('road: a score that is not numbers shows red, and nothing leaks into the markup', () => {
  const html = roadTo100({ baseline: { q: Number.NaN, s: 1, total: 1 }, now: { q: Number.NaN, s: Number.NaN, total: Number.NaN }, fixes: [{ id: 'a', label: 'A', q: 1, s: 1 }] });
  assertSafe(html, 'road');
  assert.match(html, /is-missing/);
});

test('road: toggles are real checkboxes, off and disabled until the script runs', () => {
  const html = roadTo100({ baseline: { q: 0, s: 0, total: 0 }, now: { q: 50, s: 50, total: 50 }, fixes: [{ id: 'a', label: 'A', q: 50, s: 50 }] });
  assert.match(html, /<input type="checkbox" value="a" disabled>/);
  assert.match(html, /<details class="qs-tv">/);
  const data = JSON.parse(/<script type="application\/json">(.*?)<\/script>/.exec(html)?.[1] ?? '{}');
  assert.deepEqual(data.fixes, [{ id: 'a', q: 50, s: 50 }]);
  assert.deepEqual(data.now, { q: 50, s: 50, total: 50 });
});

test('road: baseline, now and goal are all marked', () => {
  const html = roadTo100({ baseline: { q: 10, s: 10, total: 10 }, now: { q: 40, s: 40, total: 40 }, fixes: [] });
  assert.match(html, /▽ 10/);
  assert.match(html, /▼ 40/);
  assert.match(html, /◆ 100/);
});

test('timeline: a native slider that starts on the newest run, off until the script runs', () => {
  const html = timeline({ main: 'a', history: [{ t: '2026-11-01', rings: { a: { q: 1, s: 1, total: 1 } } }, { t: '2026-11-02', rings: { a: { q: 2, s: 2, total: 2 } } }] });
  assert.match(html, /type="range" min="0" max="1" step="1" value="1"/);
  assert.match(html, /aria-valuetext="2 Nov" disabled/);
  assert.match(html, /application\/json/);
});

test('timeline: a long history can stay out of the page and still draw its line', () => {
  const history = [{ t: '2026-11-01', rings: { a: { q: 1, s: 1, total: 1 } } }, { t: '2026-11-02', rings: { a: { q: 2, s: 2, total: 2 } } }];
  const html = timeline({ main: 'a', src: 'history.json', history });
  assert.match(html, /data-qs-timeline data-src="history\.json"/);
  assert.doesNotMatch(html, /application\/json/);
  assert.match(html, /qs-tl-line/);
  assert.match(html, /max="1"/);
});

test('timeline: survives an empty history', () => {
  assert.match(timeline({ main: 'a', history: [] }), /max="0"/);
});

test('historyRows: one row per day, the day\'s last run, and a computed home ring', () => {
  const rows = historyRows(
    [
      { at: '2026-11-02T06:00:00Z', page: 'code', quality: 80, speed: 80, total: 80},
      { at: '2026-11-01T06:00:00Z', page: 'code', quality: 10, speed: 10, total: 10},
      { at: '2026-11-01T18:00:00Z', page: 'code', quality: 20, speed: 20, total: 20},
      { at: '2026-11-01T06:00:00Z', page: 'issues', quality: 30, speed: 30, total: 30},
    ],
    (rings) => ({ q: 1, s: 1, total: Object.keys(rings).length }),
  );
  assert.deepEqual(rows.map((r) => r.t), ['2026-11-01', '2026-11-02']);
  assert.equal(rows[0]?.rings['code']?.total, 20);
  assert.equal(rows[0]?.rings['home']?.total, 2);
  assert.equal(rows[1]?.rings['home']?.total, 1);
});

test('filmstrip: a link opens it with no script, and only a chosen one starts open', () => {
  const closed = filmstrip({ id: 'j', title: 't', back: '#room', frames: [{ label: 'a', sketch: 'log', ms: 100 }] });
  assert.match(closed, /<section class="qs-film" id="j"/);
  assert.match(closed, /class="qs-btn" href="#room"/);
  assert.match(filmstrip({ id: 'j', title: 't', open: true, frames: [] }), /qs-film is-open/);
  assert.match(filmstrip({ id: 'j', title: 't', back: 'javascript:x', frames: [] }), /class="qs-btn" href="#"/);
});

test('filmstrip: a default-open panel closes through its back link, and without one it has no close link that does nothing', () => {
  assert.match(filmstrip({ id: 'j', title: 't', open: true, back: '#room', frames: [] }), /class="qs-btn" href="#room"/);
  assert.doesNotMatch(filmstrip({ id: 'j', title: 't', open: true, frames: [] }), /class="qs-btn"/);
  assert.match(filmstrip({ id: 'j', title: 't', frames: [] }), /class="qs-btn" href="#"/, 'a linked panel closes by leaving its target');
});

test('filmstrip: a time that is not a number takes up no room in the bar', () => {
  const html = filmstrip({ id: 'j', title: 't', frames: [{ label: 'a', ms: Number.NaN }, { label: 'b', ms: 100 }, { label: 'c', ms: -5 }] });
  const widths = [...html.matchAll(/qs-seg-s" x="[^"]+" y="4" width="([\d.]+)%"/g)].map((m) => Number(m[1]));
  assert.equal(widths.length, 1);
  assert.ok((widths[0] ?? 0) <= 100, `width ${widths[0]}%`);
  assert.equal((html.match(/is-stop/g) ?? []).length, 2, 'both broken steps read as stopped');
  assertSafe(html, 'filmstrip');
});

test('filmstrip: a step with no time means no total, however good the rest looks', () => {
  const html = filmstrip({ id: 'j', title: 't', budgetMs: 1000, frames: [{ label: 'a', ms: 100 }, { label: 'b', ms: null }, { label: 'c', ms: 200 }] });
  assert.doesNotMatch(html, /300 ms/, 'it must not read as under budget');
  assert.match(html, /qs-film-sum"><svg/);
  assert.match(html, /is-stop/);
  assert.match(filmstrip({ id: 'j', title: 't', frames: [] }), /qs-film-sum"><svg/, 'no steps at all proves nothing either');
  assert.match(filmstrip({ id: 'j', title: 't', score: null, frames: [] }), /qs-heat-step qs-h0/);
});

test('filmstrip: slow and blocked steps say so in more than color', () => {
  const html = filmstrip({
    id: 'j',
    title: 't',
    frames: [
      { label: 'Fast', sketch: 'log', ms: 100, budgetMs: 200 },
      { label: 'Slow', sketch: 'log', ms: 300, budgetMs: 200 },
      { label: 'Blocked', sketch: 'log', state: 'stop', ref: '#18' },
    ],
  });
  assert.match(html, /is-ok/);
  assert.match(html, /is-slow/);
  assert.match(html, /over budget/);
  assert.match(html, /is-stop/);
  assert.match(html, /#18/);
  assert.match(html, /qs-track-empty/, 'the rest of the time bar stays an empty red run');
});

test('filmstrip: a screenshot loads lazily with its alt text, and a bad source is dropped', () => {
  const good = filmstrip({ id: 'j', title: 't', frames: [{ label: 'Open', src: 'shots/a.webp', alt: 'The open document', ms: 1 }] });
  assert.match(good, /<img src="shots\/a\.webp" alt="The open document" width="320" height="200" loading="lazy"/);
  assert.doesNotMatch(filmstrip({ id: 'j', title: 't', frames: [{ label: 'x', src: 'javascript:x', ms: 1 }] }), /<img/);
});

test('tiles: a broken measurement is an empty red tile, whatever its last value', () => {
  assert.match(statTile({ label: 'x', value: null }), /is-missing/);
  assert.match(statTile({ label: 'x', value: 99, status: 'stale' }), /Stale/);
  assert.doesNotMatch(statTile({ label: 'x', value: 99, status: 'stale' }), /99/);
  assert.match(statTile({ label: 'x', value: null, status: 'no_events' }), /No events/);
});

test('tiles: the direction of a change is good or bad by the metric, and says so', () => {
  assert.match(statTile({ label: 'x', value: 5, delta: 2 }), /is-good[\s\S]*better/);
  assert.match(statTile({ label: 'x', value: 5, delta: 2, better: 'down' }), /is-bad[\s\S]*worse/);
  assert.match(statTile({ label: 'x', value: 5, delta: -2, better: 'down' }), /is-good/);
  assert.doesNotMatch(statTile({ label: 'x', value: 5, delta: 0 }), /qs-delta/);
});

test('blocks: counts add up and states read in words', () => {
  const pics = pictogram({ label: 'Docs', total: 5, filled: 2 });
  assert.equal((pics.match(/is-on/g) ?? []).length, 2);
  assert.equal((pics.match(/is-off/g) ?? []).length, 3);
  assert.match(pics, /Docs: 2 of 5/);
  assert.match(meter({ label: 'x', value: 1, limit: 100 }), /is-ok/);
  assert.match(meter({ label: 'x', value: 95, limit: 100 }), /is-warn/);
  assert.match(meter({ label: 'x', value: 100, limit: 100 }), /is-over/);
  assert.match(meter({ label: 'x', value: 200, limit: 100 }), /width="100%" height="12" rx="3"\/><\/svg>/, 'an overrun stays inside the bar');
  assert.match(dotMatrix({ caption: 'c', rows: ['r'], cols: ['c'], states: [['fail']] }), /qs-dm-fail[\s\S]*fail/);
  assert.match(dayStrip({ label: 'x', days: [{ t: '2026-11-01', state: 'ok' }, { t: '2026-11-02', state: 'fail' }] }), /<b>1\/2<\/b>/);
});
