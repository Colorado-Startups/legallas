// SPDX-License-Identifier: Apache-2.0
// node --test quality-speed/pages/cloudflare-security/cloudflare-security.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Manifest, MetricRecord } from '../../contract/format.ts';
import { joinMetrics, validateIdeal, validateManifest, validateRecords } from '../../contract/validate.ts';
import { frameWords } from '../../core/build.ts';
import { roadState } from '../../core/charts/charts.js';
import { countWords, MAX_WORDS } from '../../core/guard.ts';
import { scorePage } from '../../core/score.ts';
import { collect, detail, edgeRows, practicesMet, PRACTICES, readConfig, readGap, stripJsonc, type ConfigReading, type Configs } from './collect.ts';
import { configStates, itemState, render, roadFixes } from './page.ts';

const raw = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
/** The list as it will be once signed off, whatever the comment's id. */
const manifest: Manifest = { ...raw, signoff_comment: 1 };
const NOW = new Date('2026-11-18T12:00:00Z');
const RUN = { now: NOW, sourceUrl: 'https://github.com/Colorado-Startups/legallas/actions/runs/7' };
const good: ConfigReading = { age: 1, checks: { date: true, node: true, maps: true, urls: true, logs: true } };
const all = (c: ConfigReading | null): Configs => ({ room: c, mcp: c, backup: c });
const values = (records: MetricRecord[]) => Object.fromEntries(records.map((r) => [r.id, r.value]));

const CONFIG = `// a comment with "quotes"
{
  "name": "w", /* block */ "main": "https://example.invalid//not-a-comment",
  "compatibility_date": "2026-11-17",
  "compatibility_flags": ["nodejs_compat",],
  "upload_source_maps": true,
  "workers_dev": false, "preview_urls": false,
  "observability": { "enabled": true, "logs": { "enabled": true } },
}`;

test('a JSONC config reads each check; a broken or dateless one reads null, never a pass', () => {
  assert.equal(JSON.parse(stripJsonc(CONFIG)).main, 'https://example.invalid//not-a-comment');
  assert.deepEqual(readConfig(CONFIG, NOW), good);
  const old = readConfig(CONFIG.replace('2026-11-17', '2026-08-01').replace('"nodejs_compat",', '').replace('"preview_urls": false', '"preview_urls": true'), NOW);
  assert.deepEqual(old, { age: 109, checks: { date: false, node: false, maps: true, urls: false, logs: true } });
  assert.equal(readConfig(null, NOW), null);
  assert.equal(readConfig('{', NOW), null);
  assert.equal(readConfig('{ "compatibility_date": "soon" }', NOW), null);
});

test("harden.ts's rows are counted from checkAll, and the real file has the README's 12", () => {
  assert.equal(edgeRows('export async function checkAll(ctx: Context): Promise<Row[]> {\n  return Promise.all([aRow(ctx), bRow(ctx), Promise.resolve(cRow(ctx))]);\n}'), 3);
  assert.equal(edgeRows('nothing here'), null);
  assert.equal(edgeRows(null), null);
  assert.equal(edgeRows(readFileSync(new URL('../../../web/scripts/harden.ts', import.meta.url), 'utf8')), 12);
});

test('accepted items leave the share; a failed check counts against it, even on an accepted item', () => {
  assert.equal(PRACTICES.items.length, 21);
  assert.deepEqual(PRACTICES.items.map((i) => i.n), Array.from({ length: 21 }, (_, i) => i + 1));
  assert.equal(PRACTICES.items.filter((i) => i.settled === 'accepted').length, 3);
  assert.equal(PRACTICES.items.filter((i) => i.settled === 'fixed').length, 5);
  assert.deepEqual(practicesMet(PRACTICES, all(good)), { value: 100, n: 18 });
  const noNode = { ...all(good), backup: { ...good, checks: { ...good.checks, node: false } } };
  assert.deepEqual(practicesMet(PRACTICES, noNode), { value: 94.44, n: 18 });
  const noLogs = { ...all(good), mcp: { ...good, checks: { ...good.checks, logs: false } } };
  assert.deepEqual(practicesMet(PRACTICES, noLogs), { value: 94.74, n: 19 });
  assert.equal(practicesMet(PRACTICES, { ...all(good), room: null }), null);
});

test('records pass the format; a failed read writes missing, never 0', () => {
  const records = collect(all(good), 12, 24, RUN);
  assert.deepEqual(values(records), { workers_practices_met: 100, edge_rows_checked: 12, compat_date_age_days: 1, sources_read_hours: 24 });
  const checked = validateManifest({ ...manifest }, 'cloudflare-security');
  assert.deepEqual(checked.errors, []);
  assert.deepEqual(validateManifest(raw, 'cloudflare-security').errors, [], 'the list as it waits for sign-off');
  assert.deepEqual(validateIdeal(JSON.parse(readFileSync(new URL('./ideal.json', import.meta.url), 'utf8'))).errors, []);
  assert.deepEqual(validateRecords(records, checked.value as Manifest, NOW).errors, []);
  const none = collect(all(null), null, null, RUN);
  assert.ok(none.every((r) => r.status === 'missing' && r.value === null));
  assert.deepEqual(validateRecords(none, manifest, NOW).errors, []);
  assert.equal(readGap(null, NOW), null);
  assert.equal(readGap('2026-11-17T12:00:00Z', NOW), 24);
  assert.equal(readGap('2026-11-19T12:00:00Z', NOW), null, 'a read from the future');
});

test('the page shows each config check from the detail, and missing without one', () => {
  const d = detail({ ...all(good), backup: { ...good, checks: { ...good.checks, node: false } } });
  assert.deepEqual(configStates(d)[2], ['pass', 'fail', 'pass', 'pass', 'pass']);
  assert.deepEqual(configStates(null)[0], [undefined, undefined, undefined, undefined, undefined]);
  const node = PRACTICES.items.find((i) => i.check === 'node')!; // safe: in practices.json
  assert.equal(itemState(node, d), 'fail');
  assert.equal(itemState(node, null), 'missing');
  assert.equal(itemState(PRACTICES.items.find((i) => i.n === 21)!, null), 'accepted'); // safe: in practices.json
});

const atGoal: MetricRecord[] = manifest.metrics.map((m) => ({ id: m.id, page: 'cloudflare-security', value: m.goal, status: 'ok', stage: 'lab', measured_at: '2026-11-18T06:00:00Z', source_url: RUN.sourceUrl, sample_size: m.min_samples }));
const page = (records: MetricRecord[]) => {
  const score = scorePage('cloudflare-security', manifest, records, NOW);
  return { score, body: render({ score, metrics: joinMetrics(manifest, records), history: [], others: {}, detail: null }).body };
};

test('the page renders with nothing measured, in the word limit; every metric at goal reads 100; every fix reaches 100', () => {
  const empty = page([]);
  assert.equal(empty.score.total, 0);
  assert.match(empty.body, /Guide met/);
  assert.ok(countWords(empty.body) + frameWords('cloudflare-security') <= MAX_WORDS, `visible words: ${countWords(empty.body)} + ${frameWords('cloudflare-security')}`);
  assert.doesNotMatch(empty.body, /—/);
  const full = page(atGoal).score;
  assert.deepEqual([full.quality, full.speed, full.consumption, full.total], [100, 100, 100, 100]);
  const rows = joinMetrics(manifest, []).map((m, i) => ({ id: m.id, lens: m.lens, weight: m.weight, group: m.group, score: empty.score.metrics[i]?.score ?? 0 }));
  const fixes = roadFixes(rows);
  assert.deepEqual(fixes.map((f) => f.id), ['guide', 'edge', 'date', 'reads', 'lane']);
  const now = { q: empty.score.exact_quality, s: empty.score.exact_speed, c: empty.score.exact_consumption, total: empty.score.total };
  assert.equal(roadState(now, fixes, fixes.map((f) => f.id)).total, 100);
});
