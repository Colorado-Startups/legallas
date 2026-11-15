// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Manifest, MetricRecord } from '../../contract/format.ts';
import { joinMetrics } from '../../contract/validate.ts';
import type { PageContext } from '../../core/build.ts';
import { assertBalanced, assertSafe } from '../../core/charts/markup-checks.ts';
import { countWords, MAX_WORDS } from '../../core/guard.ts';
import { scorePage } from '../../core/score.ts';
import { aiCell, cellScore, fixOf, render, roadFixes } from './page.ts';
import { buildManifest, lensOf, ROWS } from './list.ts';

const manifest = buildManifest(1) as unknown as Manifest;
const groups = manifest.groups ?? [];
const row = (id: string, score: number, lens: string) =>
  ({ id, score, lens, group: id.split('.')[0], weight: 1, reading: score > 0 ? 'measured' : 'missing' }) as unknown as Parameters<typeof roadFixes>[0][number];

test('a cell averages its metrics by weight, and reads as missing only when none has a reading', () => {
  const metrics = new Map([['a', { weight: 1, score: 100, reading: 'measured' }], ['b', { weight: 3, score: 0, reading: 'missing' }]]);
  assert.equal(cellScore(['a', 'b'], metrics), 25);
  assert.equal(cellScore(['b'], metrics), null);
  assert.equal(cellScore(['gone'], metrics), null);
});

test('a score is rounded down, so a cell never rounds up to 100', () => {
  assert.equal(cellScore(['a', 'b'], new Map([['a', { weight: 1, score: 100, reading: 'measured' }], ['b', { weight: 1, score: 99, reading: 'measured' }]])), 99);
});

test("Connected AI's cells read the page's own rings: speed for find, consumption for cost, quality for the rest", () => {
  const rings = { quality: 95, speed: 80, consumption: 70 };
  assert.equal(aiCell('leak', rings), 95);
  assert.equal(aiCell('trust', rings), 95);
  assert.equal(aiCell('find', rings), 80);
  assert.equal(aiCell('cost', rings), 70);
});

test('a row waits for the last work it names, answers wait for the live room, and the rest are below goal', () => {
  assert.equal(fixOf({ after: ['checklist', 'company_room'] }), 'company_room');
  assert.equal(fixOf({ answers: 'right_page' }), 'live');
  assert.equal(fixOf({ test: 'f', names: ['R1'] }), 'now');
});

test('every row has a place on Road to 100, so the fixes reach the goal', () => {
  const metrics = ROWS.map((r) => row(r.id, 0, lensOf(r.id)));
  const fixes = roadFixes(metrics, groups);
  const total = (lens: 'q' | 's' | 'c') => fixes.reduce((sum, f) => sum + f[lens], 0);
  assert.ok(Math.abs(total('q') - 100) < 0.5, `quality adds up to ${total('q')}`);
  assert.ok(Math.abs(total('s') - 100) < 0.5, `speed adds up to ${total('s')}`);
  // Only the groups with consumption rows add consumption, so it reaches their share of the page.
  const consuming = groups.filter((g) => ROWS.some((r) => r.id.startsWith(`${g.id}.`) && lensOf(r.id) === 'consumption')).reduce((sum, g) => sum + g.weight, 0);
  assert.ok(Math.abs(total('c') - consuming) < 0.5, `consumption adds up to ${total('c')} of ${consuming}`);
});

test('a metric at goal adds nothing to the road', () => {
  const metrics = ROWS.map((r) => row(r.id, 100, r.id.split('.')[2] === 'find' ? 'speed' : 'quality'));
  assert.deepEqual(roadFixes(metrics, groups), []);
});

/** The page as the build draws it, from the real scorer, with each metric at the value it's given. */
function rendered(valueOf: (m: Manifest['metrics'][number]) => number | null) {
  const records = manifest.metrics.map((m) => {
    const value = valueOf(m);
    return value === null
      ? { id: m.id, page: 'data-room', value, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null }
      : { id: m.id, page: 'data-room', value, status: 'ok', stage: 'lab', measured_at: '2026-11-02T06:00:00Z', source_url: 'https://github.com/Colorado-Startups/legallas/actions/runs/1', sample_size: m.min_samples };
  }) as MetricRecord[];
  const score = scorePage('data-room', manifest, records, new Date('2026-11-02T07:00:00Z'));
  const { body, pages } = render({ score, metrics: joinMetrics(manifest, records), history: [], others: {} } as unknown as PageContext);
  return { score, body, pages: pages as Record<string, string> };
}

test('a row at its goal draws as passed, timed or not', () => {
  const { score, pages } = rendered((m) => m.goal);
  assert.equal(score.total, 100);
  for (const [name, html] of Object.entries(pages)) {
    if (name === 'linked') continue; // other pages' rings: this context has none, so they draw as missing
    assert.ok(!html.includes('is-missing') && !html.includes('is-stop'), name);
  }
});

test('a row short of its goal is red with its reading, and one with no reading links to its fix', () => {
  const leak = 'vc.investor.leak.no_download';
  const short = rendered((m) => (m.id === leak ? m.floor : m.goal)).pages['j-vc-investor-leak']!;
  assert.equal(short.match(/qs-tile is-missing/g)?.length, 1);
  assert.match(short, /Fail/);
  assert.match(short, /actions\/runs\/1/);
  const unrun = rendered((m) => (m.id === leak ? null : m.goal)).pages['j-vc-investor-leak']!;
  assert.equal(unrun.match(/qs-tile is-missing/g)?.length, 1);
  assert.match(unrun, /Missing/);
});

test('every page is balanced, fits a strict security policy, names no screenshot and keeps to the word limit, read or unread', () => {
  for (const { body, pages } of [rendered((m) => m.goal), rendered(() => null), rendered((m) => m.floor)]) {
    for (const [name, html] of Object.entries({ index: body, ...pages })) {
      assertBalanced(html, name);
      assertSafe(html, name);
      assert.ok(!html.includes('frames/'), name);
      assert.ok(countWords(html) <= MAX_WORDS, `${name}: ${countWords(html)} words`);
    }
  }
});

test('the page\'s ideal state is ideal.json, which core draws above the page, and each source is in the research', () => {
  const ideal = JSON.parse(readFileSync(new URL('./ideal.json', import.meta.url), 'utf8')) as { sources: { url: string }[] };
  const research = ['formation-and-standards.md', 'investors.md', 'litigation.md'].map((f) => readFileSync(new URL(`./research/${f}`, import.meta.url), 'utf8')).join('\n');
  for (const { url } of ideal.sources) assert.ok(research.includes(url), url);
  assert.ok(!rendered((m) => m.goal).body.includes('<h2>Ideal state</h2>'), 'drawn once, by core');
});
