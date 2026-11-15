// SPDX-License-Identifier: Apache-2.0
// The Testing page: is every real risk proven by a fast test? The risk map is the infographic: one row per risk, caught or
// not when its planted breaks go in. Numbers come only from render()'s context.
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, dataTable, dotMatrix, historyRows, markKey, metricBullet, roadTo100, timeline, type PassState } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';

const RISKS: Record<string, string> = {
  room_gate: 'Room gate',
  who_sees_what: 'Who sees what',
  cites_right_page: 'Cites',
  sync_changes_nothing: 'Sync',
  safe_migrations: 'Migrations',
  pii_guard: 'PII guard',
  spend_guard: 'Spend guard',
  connector_contract: 'Connector',
};

const LABELS: Record<string, string> = {
  risk_mutation_score: 'Mutants caught',
  flaky_tests: 'Flaky tests',
  web_test_step_p50: 'Suite p50',
  web_test_step_p95: 'Suite p95',
  suite_cpu_minutes: 'Suite CPU',
};

/** Before any fix, 2026-11-02 (PLAN.md): a third each, with no consumption metric yet. */
const BASELINE = { q: 94.7, s: 88.1, total: 60 };

/** The fixes left, each with the metrics it moves. */
const FIXES = [
  { id: 'migrations', label: 'Migrations test', ref: '#135', metrics: ['risks_proven'] },
  { id: 'speed', label: 'Faster suite', ref: '#284', metrics: ['web_test_step_p50', 'web_test_step_p95'] },
  { id: 'cpu', label: 'Leaner suite', metrics: ['suite_cpu_minutes'] },
  { id: 'lane', label: 'Lane in 5 min', metrics: ['lane_minutes'] },
];

const pull = (ref: string) => `https://github.com/Colorado-Startups/legallas/pull/${ref.slice(1)}`;

export function render({ score, metrics, history, detail }: PageContext): PageOutput {
  const at = new Map(metrics.map((m, i) => [m.id, { m, s: score.metrics[i] }]));
  const weight = (lens: string) => metrics.filter((m) => m.lens === lens).reduce((a, m) => a + m.weight, 0);
  // What a fix would add to each ring: the points its metrics still lack, by weight.
  const gain = (ids: string[], lens: string) =>
    ids.reduce((a, id) => {
      const row = at.get(id);
      return row && row.m.lens === lens ? a + ((100 - (row.s?.score ?? 0)) * row.m.weight) / weight(lens) : a;
    }, 0);

  // Each risk's own result is a check in the lane's detail, read only while risks_proven itself is measured.
  const measured = at.get('risks_proven')?.s?.reading === 'measured';
  const proofs = Object.entries(RISKS).map(([id, label]) => {
    const check = measured ? detail?.checks[id] : undefined;
    const state: PassState | undefined = check === undefined ? undefined : check === 1 ? 'pass' : 'fail';
    return { label, state };
  });
  const rest = Object.entries(LABELS).flatMap(([id, label]) => {
    const row = at.get(id);
    return row ? [metricBullet(row.m, label, { reading: row.s?.reading ?? 'missing' })] : [];
  });
  // A fix under a hundredth of a point across the lenses draws nothing.
  const fixes = FIXES.map((f) => ({ id: f.id, label: f.label, ...(f.ref ? { ref: f.ref, href: pull(f.ref) } : {}), q: gain(f.metrics, 'quality'), s: gain(f.metrics, 'speed'), c: gain(f.metrics, 'consumption') }))
    .filter((f) => fixGain(f) > 0.01 / 3);
  // The consumption ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: score.exact_quality, s: score.exact_speed, total: score.total, c: score.exact_consumption };

  const body =
    `<div class="qs-grid qs-grid-2">` +
    dotMatrix({ caption: 'Planted break caught', rows: proofs.map((p) => p.label), cols: ['Caught'], states: proofs.map((p) => (p.state ? [p.state] : [])) }) +
    bullets('Breadth, speed, CPU', rest) +
    `</div>` +
    markKey() +
    // The ideal's second half is a stated gap, never claimed: nothing measures a test that isn't needed (PLAN.md).
    `<p>Not measured: nothing else gets a test.</p>` +
    roadTo100({ baseline: BASELINE, now, fixes }) +
    (history.length ? timeline({ main: 'testing', history: historyRows(history) }) : '') +
    dataTable({
      caption: 'Every metric',
      columns: [
        { key: 'metric', label: 'Metric' },
        { key: 'value', label: 'Value', type: 'num', unitKey: 'unit' },
        { key: 'score', label: 'Score', type: 'score' },
        { key: 'status', label: 'State', type: 'status' },
      ],
      linkKey: 'run',
      rows: metrics.map((m, i) => ({ metric: m.id, value: m.value, unit: m.unit, score: Math.floor(score.metrics[i]?.score ?? 0), status: m.status, run: m.source_url })),
    });
  return { body };
}
