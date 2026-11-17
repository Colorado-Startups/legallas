// SPDX-License-Identifier: Apache-2.0
// The Settings page: the gates, stop budgets and drill as pass tiles, drift and timing against their goals, how many expected
// settings read as expected, Road to 100, and the expected settings one click away, each with its status from the last read
// (settings-status.json, which the collector leaves for the build beside this file).
import { existsSync, readFileSync } from 'node:fs';
import type { Metric } from '../../contract/format.ts';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, dataTable, markKey, metricBullet, metricTile, pictogram, roadTo100, tileRow, totalOf } from '../../core/charts/index.ts';
import type { ReadingLike, RoadFixProps } from '../../core/charts/index.ts';

interface ExpectedFile {
  settings: { id: string; area: string; expect: { op: string; value: unknown }; gate: boolean }[];
}
const EXPECTED = JSON.parse(readFileSync(new URL('./expected-settings.json', import.meta.url), 'utf8')) as ExpectedFile;

/** The score before any fix, from PLAN.md's baseline, with no lane reading yet (Consumption 0); the total by core's own rule. */
const BASELINE = { q: 12, s: 0, c: 0, total: totalOf(12, 0, 0) };

/** The fixes left, with what each is expected to add, estimated in PLAN.md from the metric weights. */
const FIXES: RoadFixProps[] = [
  { id: 'key', label: 'Read-only key', q: 50, s: 33.3 },
  { id: 'actions', label: 'Actions policy', q: 11.25, s: 0 },
  { id: 'branch', label: 'Branch rules', q: 11.25, s: 0 },
  { id: 'signoff', label: 'Sign-off, releases', q: 7.5, s: 66.7 },
  { id: 'lane', label: 'Lane in 5 min', q: 0, s: 0, c: 100 },
];

const shown = (value: unknown) => (Array.isArray(value) ? value.join(' ') || 'none' : String(value));
const STATUS_FILE = new URL('./settings-status.json', import.meta.url);

/** Each setting's status from the last read, keeping only known ids and the three closed words. */
function lastStatus(): Map<string, string> {
  const ids = new Set(EXPECTED.settings.map((s) => s.id));
  let rows: unknown = [];
  try {
    rows = existsSync(STATUS_FILE) ? JSON.parse(readFileSync(STATUS_FILE, 'utf8')) : [];
  } catch {
    rows = [];
  }
  const ok = (r: unknown): r is { id: string; status: string } =>
    typeof r === 'object' && r !== null && ids.has((r as { id: string }).id) && ['match', 'drift', 'unread'].includes((r as { status: string }).status);
  return new Map((Array.isArray(rows) ? rows.filter(ok) : []).map((r) => [r.id, r.status]));
}

export function render({ score, metrics }: PageContext): PageOutput {
  const byId = new Map(metrics.map((m, i) => [m.id, { m, reading: (score.metrics[i]?.reading ?? 'missing') as ReadingLike }]));
  const get = (id: string) => byId.get(id) as { m: Metric; reading: ReadingLike };
  const tile = (id: string, label: string) => metricTile(get(id).m, label, { reading: get(id).reading });
  const bullet = (id: string, label: string) => metricBullet(get(id).m, label, { reading: get(id).reading });

  const drift = get('settings_drift_count');
  const total = EXPECTED.settings.length;
  const filled = drift.reading === 'measured' && drift.m.value !== null ? total - drift.m.value : 0;
  // The consumption ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: score.quality, s: score.speed, total: score.total, c: score.exact_consumption };

  const body =
    tileRow([tile('gates_intact', 'Gates'), tile('stop_budgets_ok', 'Stop budgets'), tile('planted_drift_detected', 'Drill')]) +
    bullets('Against goal', [bullet('settings_drift_count', 'Drift'), bullet('drift_fix_hours', 'Fix'), bullet('read_gap_hours', 'Read gap')]) +
    markKey() +
    pictogram({ label: 'As expected', total, filled, glyph: 'check' }) +
    roadTo100({ baseline: BASELINE, now, fixes: FIXES }) +
    '<p><a href="expected.html">Expected settings</a></p>';

  const status = lastStatus();
  const expected = dataTable({
    caption: 'Expected settings',
    columns: [
      { key: 'setting', label: 'setting' },
      { key: 'now', label: 'now' },
      { key: 'area', label: 'area' },
      { key: 'expect', label: 'expected' },
      { key: 'gate', label: 'gate' },
    ],
    rows: EXPECTED.settings.map((s) => ({ setting: s.id, now: status.get(s.id) ?? 'unread', area: s.area, expect: `${s.expect.op} ${shown(s.expect.value)}`, gate: s.gate ? 'gate' : '' })),
    filter: true,
  });

  return { body, pages: { expected } };
}
