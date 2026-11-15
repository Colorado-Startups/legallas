// SPDX-License-Identifier: Apache-2.0
// The Security page: counts and pass marks only, so no finding, path, package or advisory reaches the site. Its one
// infographic is a shield of the layers that keep a weakness out, each lit only as far as today's readings prove it.
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, dataTable, dotMatrix, esc, markKey, meter, metricBullet, roadTo100, totalOf, trend } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';
import type { Metric } from '../../contract/format.ts';

/** The score before anything was fixed (PLAN.md, Baseline), with no consumption metric yet; the total by core's own rule. */
const BASELINE = { q: 50.4, s: 65.8, total: totalOf(50.4, 65.8) };

/** The shield, outside in, as a commit meets it. A layer resting on two metrics reads as the weaker. */
const LAYERS: readonly { label: string; ids: readonly string[] }[] = [
  { label: 'Ignored', ids: ['case_paths_ignored'] },
  { label: 'Gate', ids: ['secret_scan_gate_coverage'] },
  { label: 'Secrets', ids: ['secrets_in_history'] },
  { label: 'Paths', ids: ['forbidden_paths_in_history'] },
  { label: 'Packages', ids: ['alerts_critical_high_open', 'alerts_medium_low_open', 'osv_vulnerabilities_open'] },
  { label: 'Code', ids: ['sast_findings_open'] },
  { label: 'Practices', ids: ['scorecard_checks_at_goal'] },
  { label: 'Keys', ids: ['key_age_max_days'] },
];

/** Each metric's full name for the tables, which the word budget leaves out, and one word for Road to 100, which it doesn't. */
const NAMES: Readonly<Record<string, { full: string; short: string }>> = {
  alerts_critical_high_open: { full: 'Dependabot, critical and high', short: 'Open high' },
  alerts_medium_low_open: { full: 'Dependabot, medium and low', short: 'Open medium' },
  osv_vulnerabilities_open: { full: 'OSV advisories', short: 'OSV' },
  sast_findings_open: { full: 'Semgrep findings', short: 'Semgrep' },
  scorecard_checks_at_goal: { full: 'Scorecard checks at goal', short: 'Scorecard' },
  secrets_in_history: { full: 'Secrets in history', short: 'Secrets' },
  forbidden_paths_in_history: { full: 'Forbidden paths in history', short: 'Paths' },
  case_paths_ignored: { full: 'Case paths ignored', short: 'Ignored' },
  secret_scan_gate_coverage: { full: 'Secret scan on every commit', short: 'Gate' },
  key_age_max_days: { full: 'Oldest key', short: 'Keys' },
  scanner_drills_passing: { full: 'Planted drills found', short: 'Drills' },
  time_to_fix_critical_high_hours: { full: 'Fix critical and high', short: 'Fix high' },
  time_to_fix_medium_low_hours: { full: 'Fix medium and low', short: 'Fix medium' },
  scan_minutes: { full: 'Scan minutes', short: 'Scan' },
};

const DRILLS = [
  ['drill_secret', 'Secret'],
  ['drill_path', 'Path'],
  ['drill_osv', 'Package'],
  ['drill_sast', 'Code'],
] as const;

const scoreOf = (context: PageContext, id: string): number => context.score.metrics.find((metric) => metric.id === id)?.score ?? 0;

/** A layer's score: its weakest metric, because a layer is only as sound as that. */
export function layerScore(ids: readonly string[], score: (id: string) => number): number {
  return Math.min(...ids.map(score));
}

/**
 * A band's look, from the kit's own classes because the publish guard lets no color reach an attribute: solid when proven at
 * goal, outlined when part of the way there, and the kit's red, which always means a score of 0, when it isn't proven at all.
 */
export function bandClass(score: number): string {
  if (score <= 0) return 'qs-track-empty';
  return score >= 100 ? 'qs-dot-q' : 'qs-seg-q';
}

const SHIELD = 'M0-100 L82-72 V-8 C82 44 42 82 0 100 C-42 82-82 44-82-8 V-72 Z';

/** A nested shield for the band, and a row naming it. The rows keep the bands' order, so the two read together. */
function band(label: string, score: number, index: number, count: number): { shape: string; row: string } {
  const scale = 1 - (index / count) * 0.86;
  const y = 26 + index * 34;
  const look = bandClass(score);
  const dash = score <= 0 ? ' stroke-dasharray="5 4"' : '';
  return {
    shape: `<path class="${look}" d="${SHIELD}" transform="translate(112 124) scale(${scale.toFixed(3)})" vector-effect="non-scaling-stroke"${dash}/>`,
    row:
      `<rect class="${look}" x="236" y="${y - 12}" width="14" height="14" rx="2"${dash}/>` +
      `<text class="qs-tick-label" x="258" y="${y}">${esc(label)}</text>` +
      `<text class="qs-ref-strong" x="396" y="${y}" text-anchor="end">${Math.floor(score)}</text>`,
  };
}

/** The infographic. Painted outside in, so a band that isn't proven shows as a break in the shield. */
export function shield(layers: readonly { label: string; score: number }[]): string {
  const bands = layers.map((layer, index) => band(layer.label, layer.score, index, layers.length));
  const atGoal = layers.filter((layer) => layer.score >= 100).length;
  return (
    `<svg class="qs-shield" viewBox="0 0 400 290" width="100%" role="img" aria-label="${atGoal} of ${layers.length} layers at goal. Each layer's score is in the table below.">` +
    bands.map((b) => b.shape).join('') +
    bands.map((b) => b.row).join('') +
    '</svg>'
  );
}

/** Road to 100: what each metric short of its goal is worth to its ring. Computed, so it can't drift from the scoring. */
export function roadFixes(context: PageContext): { id: string; label: string; q: number; s: number; c: number }[] {
  const weights = { quality: 0, speed: 0, consumption: 0 };
  for (const metric of context.metrics) weights[metric.lens] += metric.weight;
  const fixes: { id: string; label: string; q: number; s: number; c: number }[] = [];
  for (const metric of context.metrics) {
    const gain = ((100 - scoreOf(context, metric.id)) * metric.weight) / weights[metric.lens];
    if (gain <= 0) continue;
    const fix = { id: metric.id, label: NAMES[metric.id]?.short ?? metric.id, q: metric.lens === 'quality' ? gain : 0, s: metric.lens === 'speed' ? gain : 0, c: metric.lens === 'consumption' ? gain : 0 };
    if (fixGain(fix) > 0) fixes.push(fix);
  }
  return fixes.sort((a, b) => fixGain(b) - fixGain(a));
}

const SCORECARD_ACRONYMS = new Set(['ci', 'cii', 'sast']);

export const scorecardName = (id: string) =>
  id.slice('scorecard_'.length).split('_').map((word) => (SCORECARD_ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1))).join('-');

function scorecardTable(context: PageContext): string {
  const readings = context.detail?.readings ?? {};
  const rows = Object.entries(readings)
    .filter(([id]) => id.startsWith('scorecard_'))
    .map(([id, reading]) => ({ check: scorecardName(id), score: reading.value }))
    .sort((a, b) => a.score - b.score);
  return dataTable({ caption: 'Scorecard', columns: [{ key: 'check', label: 'Check' }, { key: 'score', label: 'Of 10', type: 'num' }], rows });
}

/** Every Semgrep rule that fired, by count: the audit-level hints stay visible even when they aren't scored. */
function semgrepTable(context: PageContext): string {
  const readings = context.detail?.readings ?? {};
  const rows = Object.entries(readings)
    .filter(([id]) => id.startsWith('sast_rule_'))
    .map(([id, reading]) => ({ rule: id.slice('sast_rule_'.length), count: reading.value }))
    .sort((a, b) => b.count - a.count);
  return dataTable({ caption: 'Semgrep', columns: [{ key: 'rule', label: 'Rule' }, { key: 'count', label: 'Hits', type: 'num' }], rows });
}

function metricTable(context: PageContext, byId: (id: string) => Metric | undefined): string {
  const rows = context.score.metrics.map((scored) => {
    const metric = byId(scored.id);
    return { metric: NAMES[scored.id]?.full ?? scored.id, value: metric?.value ?? null, unit: metric?.unit ?? '', score: scored.score, status: metric?.status ?? 'missing', run: metric?.source_url ?? undefined };
  });
  return dataTable({
    caption: 'Every metric',
    columns: [
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Value', type: 'num', unitKey: 'unit' },
      { key: 'score', label: 'Score', type: 'score' },
      { key: 'status', label: 'State', type: 'status' },
    ],
    linkKey: 'run',
    rows,
  });
}

export function render(context: PageContext): PageOutput {
  const byId = (id: string) => context.metrics.find((metric) => metric.id === id);
  const readingOf = (id: string) => context.score.metrics.find((metric) => metric.id === id)?.reading;
  const bullet = (id: string, label: string) => {
    const metric = byId(id);
    const reading = readingOf(id);
    // A metric with no score is unproven, so it reads as missing.
    return metric ? metricBullet(metric, label, { reading: reading ?? 'missing' }) : { label, value: null, unit: 'count', floor: 1, goal: 0, status: 'missing' as const };
  };
  const layers = LAYERS.map((layer) => ({ label: layer.label, score: layerScore(layer.ids, (id) => scoreOf(context, id)) }));
  const checks = context.detail?.checks ?? {};
  const keyAge = byId('key_age_max_days');
  const keyMeter = keyAge?.value !== null && keyAge?.value !== undefined ? meter({ label: 'Oldest key', value: keyAge.value, limit: keyAge.goal, unit: 'days' }) : '';
  const drills = dotMatrix({
    caption: 'Planted drills',
    rows: ['Found'],
    cols: DRILLS.map(([, label]) => label),
    states: [DRILLS.map(([id]) => (checks[id] === 1 ? 'pass' : checks[id] === 0 ? 'fail' : 'na'))],
  });
  const { quality, speed, total } = context.score;
  // The consumption ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: quality, s: speed, total, c: context.score.consumption };
  const history = context.history.map((line) => ({ t: line.at.slice(0, 10), v: line.total }));

  // The build draws the page's ring, and Road to 100 draws its own. A trend line scores nothing, so it waits for a second run.
  const body =
    `<div class="qs-grid-2">${shield(layers)}<div>${drills}${keyMeter}</div></div>` +
    markKey() +
    bullets('Open', [
      bullet('alerts_critical_high_open', 'Open high'),
      bullet('alerts_medium_low_open', 'Open medium'),
      bullet('osv_vulnerabilities_open', 'OSV'),
      bullet('sast_findings_open', 'Semgrep'),
      bullet('scorecard_checks_at_goal', 'Scorecard'),
    ]) +
    bullets('Time to fix', [bullet('time_to_fix_critical_high_hours', 'Fix high'), bullet('time_to_fix_medium_low_hours', 'Fix medium')]) +
    bullets('Consumption', [bullet('scan_minutes', 'Scan')]) +
    (history.length >= 2 ? trend({ label: 'Total', goal: 100, baseline: BASELINE.total, lens: 'quality', points: history }) : '') +
    roadTo100({ baseline: BASELINE, now, fixes: roadFixes(context) }) +
    `<details><summary>Tables</summary>${metricTable(context, byId)}${scorecardTable(context)}${semgrepTable(context)}</details>`;
  return { body };
}
