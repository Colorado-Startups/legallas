// SPDX-License-Identifier: Apache-2.0
// The AI connectors page, as the site build calls it (core/build.ts render): drawn with the chart kit from the page's validated
// records and scores, plus connectors.json, the lab lane's drill-down (ids and numbers), which the build puts beside this file
// when the lane wrote one. The build adds the title and the score ring. At most 80 visible words, with the build's title.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { bullets, dataTable, dotMatrix, esc, markKey, metricBullet, metricTile, roadTo100, tableView, tileRow } from '../../core/charts/index.ts';
import type { PassState, RoadFixProps } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';
import { combine, type Reading, type ScoredRow } from '../../core/score.ts';
import type { Metric } from '../../contract/format.ts';

/** A metric as the page draws it: its definition, its record, and its score from core/score.ts. */
export interface Scored extends Metric {
  reading: Reading;
  score: number;
}

const LABEL: Readonly<Record<string, string>> = {
  unsupported_ai_refused: 'Blocked', supported_ais_connecting: 'Connect', setup_steps_worst_ai: 'Steps', tool_list_tokens: 'Tool list',
};
const AIS = ['claude', 'copilot', 'harvey', 'open_weight'] as const;
const AI_LABEL: Readonly<Record<string, string>> = { claude: 'Claude', copilot: 'Copilot', harvey: 'Harvey', open_weight: 'Open-weight' };
const STAGES: readonly [string, string][] = [['discover', 'Discover'], ['register', 'Register'], ['sign_in', 'Sign in'], ['tools', 'Tools'], ['revoke', 'Revoke']];
const PROBES: readonly [string, string][] = [
  ['chatgpt_stable', 'ChatGPT'], ['chatgpt_per_app', 'ChatGPT app'], ['chatgpt_client_document', 'ChatGPT document'], ['gemini_enterprise', 'Gemini'],
  ['openai_subdomain', 'OpenAI'], ['google_subdomain', 'Google'], ['grok_subdomain', 'Grok'], ['x_ai_subdomain', 'x.ai'], ['x_com_subdomain', 'x.com'],
];

/** The lab lane's drill-down, read as untrusted: only known keys, and only 0, 1, null or a whole number survive. */
interface Drill {
  steps: Record<string, number | null>;
  stages: Record<string, Record<string, number | null>> | null;
  probes: Record<string, number | null>;
  loopback_off: number;
}
function readDrill(): Drill | null {
  const file = path.join(import.meta.dirname, 'connectors.json');
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Drill>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000 ? v : null);
    const pick = (o: unknown, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, n((o as Record<string, unknown> | null)?.[k])]));
    return {
      steps: pick(raw.steps, AIS),
      stages: raw.stages ? Object.fromEntries(AIS.map((ai) => [ai, pick(raw.stages?.[ai], STAGES.map(([id]) => id))])) : null,
      probes: pick(raw.probes, PROBES.map(([id]) => id)),
      loopback_off: n(raw.loopback_off) ?? 0,
    };
  } catch {
    return null;
  }
}

/** Pass or fail per cell; a cell nothing proved stays a hole, which the kit draws red as missing. */
function cells(values: readonly (number | null | undefined)[]): PassState[] {
  const row: PassState[] = [];
  values.forEach((v, i) => {
    if (v === 1) row[i] = 'pass';
    else if (v === 0) row[i] = 'fail';
  });
  return row;
}

/** The drill-down: each AI's contract by stage, each unsupported probe, and each AI's steps. Tables, so they cost no words. */
function drillDown(drill: Drill, goal: number): string {
  const contract = dotMatrix({
    caption: 'Connector contract',
    rows: AIS.map((ai) => AI_LABEL[ai]!),
    cols: STAGES.map(([, label]) => label),
    states: AIS.map((ai) => (drill.stages ? cells(STAGES.map(([id]) => drill.stages?.[ai]?.[id])) : [])),
  });
  const gate = dotMatrix({
    caption: 'Unsupported AI blocked',
    rows: [...PROBES.map(([, label]) => label), 'Loopback off'],
    cols: ['Blocked'],
    states: [...PROBES.map(([id]) => cells([drill.probes[id]])), cells([drill.loopback_off])],
  });
  const steps = dataTable({
    caption: 'Steps by AI',
    columns: [{ key: 'ai', label: 'AI' }, { key: 'steps', label: 'Steps', type: 'num' }, { key: 'goal', label: 'Goal', type: 'num' }],
    rows: AIS.map((ai) => ({ ai: AI_LABEL[ai]!, steps: drill.steps[ai] ?? null, goal })),
  });
  return `<div class="qs-grid qs-grid-3">${contract}${gate}${steps}</div>`;
}

const PR = (n: number) => ({ ref: `#${n}`, href: `https://github.com/Colorado-Startups/legallas/pull/${n}` });

/** Full, part or empty: the class a stage's node takes from its metrics' scores. */
function stageClass(metrics: readonly Scored[]): string {
  if (metrics.every((m) => m.score >= 100)) return 'qs-fill-q';
  return metrics.some((m) => m.score > 0) ? 'qs-fill-s' : 'qs-track-empty';
}

/**
 * The infographic: the road from a guide to a connection, each stage full, part or empty, with what it reads;
 * below it, ChatGPT, Gemini and Grok meet the gate, and a red line runs through when it lets them in.
 */
function road(by: (id: string) => Scored): string {
  const shown = (m: Scored, text: string) => (m.reading === 'measured' ? text : '?');
  const stages = [
    { x: 100, label: 'Guide', ids: ['setup_steps_worst_ai'], value: shown(by('setup_steps_worst_ai'), String(by('setup_steps_worst_ai').value)) },
    { x: 340, label: 'Connect', ids: ['supported_ais_connecting'], value: shown(by('supported_ais_connecting'), `${Math.round((by('supported_ais_connecting').value! * 4) / 100)}/4`) },
  ];
  const gate = by('unsupported_ai_refused');
  const open = gate.reading === 'measured' && gate.value === 0;
  const parts = [`<rect x="100" y="34" width="240" height="8" rx="4" class="qs-track-s"/>`];
  for (const s of stages) {
    parts.push(`<circle cx="${s.x}" cy="38" r="14" class="${stageClass(s.ids.map(by))}"/>`);
    parts.push(`<text x="${s.x}" y="12" text-anchor="middle" class="qs-end">${esc(s.label)}</text>`);
    parts.push(`<text x="${s.x}" y="72" text-anchor="middle" class="qs-tick-label">${esc(s.value)}</text>`);
  }
  parts.push(`<line x1="40" y1="112" x2="${open ? 340 : 150}" y2="${open ? 52 : 112}" class="${open ? 'qs-cap' : 'qs-link'}"/>`);
  parts.push(`<rect x="150" y="100" width="6" height="24" rx="2" class="${open ? 'qs-track-empty' : gate.score >= 100 ? 'qs-fill-q' : 'qs-track-empty'}"/>`);
  parts.push(`<text x="40" y="140" class="qs-tick-label">ChatGPT · Gemini · Grok</text>`);
  const label = 'From a guide to a connection; unsupported AIs at the gate';
  const rows = [...stages.map((s) => [s.label, s.value]), ['Gate', open ? 'open' : gate.score >= 100 ? 'closed' : '?']];
  return `<figure class="qs-chart" role="img" aria-label="${esc(label)}"><svg viewBox="0 0 440 150" width="100%" aria-hidden="true">${parts.join('')}</svg>${tableView(label, ['Stage', 'Reads'], rows)}</figure>`;
}

/**
 * The fixes left, in PLAN.md's order, each adding what it raises over the fixes before it, by core/score.ts's own rule. A fix
 * that adds nothing to the total under core's weights draws no row.
 */
export function fixes(metrics: readonly Scored[]): RoadFixProps[] {
  const rows: ScoredRow[] = metrics.map((m) => ({ id: m.id, lens: m.lens, weight: m.weight, score: m.score }));
  const apply = (targets: Record<string, number>) => {
    const before = combine(rows);
    for (const row of rows) row.score = Math.max(row.score, targets[row.id] ?? 0);
    const after = combine(rows);
    return { q: after.exact_quality - before.exact_quality, s: after.exact_speed - before.exact_speed, c: after.exact_consumption - before.exact_consumption };
  };
  return [
    { id: 'deny', label: 'Deny unsupported AI', ...PR(156), ...apply({ unsupported_ai_refused: 100 }) },
    { id: 'guide', label: 'Open-weight guide', ...PR(158), ...apply({ setup_steps_worst_ai: 53 }) },
    { id: 'steps', label: 'Each guide in 7 steps', ...apply({ setup_steps_worst_ai: 100 }) },
    { id: 'tools', label: 'Lean tool list', ...apply({ tool_list_tokens: 100 }) },
    { id: 'lane', label: 'Lane in 5 min', ...apply({ lane_minutes: 100 }) },
  ].filter((f) => fixGain(f) > 0);
}

export function render(context: PageContext): PageOutput {
  const metrics: Scored[] = context.metrics.map((m, i) => ({ ...m, score: context.score.metrics[i]?.score ?? 0, reading: context.score.metrics[i]?.reading ?? 'missing' }));
  const by = (id: string) => metrics.find((m) => m.id === id)!; // safe: every id is the manifest's
  const tile = (id: string) => metricTile(by(id), LABEL[id] ?? id, { reading: by(id).reading });
  const bullet = (id: string) => metricBullet(by(id), LABEL[id] ?? id, { reading: by(id).reading });
  // The consumption ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: context.score.exact_quality, s: context.score.exact_speed, total: context.score.total, c: context.score.exact_consumption };
  const first = context.history.find((line) => line.page === 'ai-connectors');
  const baseline = first ? { q: first.quality, s: first.speed, total: first.total } : now;
  const drill = readDrill();
  const body = [
    markKey(),
    tileRow(['unsupported_ai_refused', 'supported_ais_connecting', 'tool_list_tokens'].map(tile)),
    `<div class="qs-grid qs-grid-2">${road(by)}${bullets('Speed', ['setup_steps_worst_ai'].map(bullet))}</div>`,
    ...(drill ? [drillDown(drill, by('setup_steps_worst_ai').goal)] : []),
    roadTo100({ baseline, now, fixes: fixes(metrics) }),
    dataTable({
      caption: 'Every metric',
      columns: [
        { key: 'metric', label: 'Metric' },
        { key: 'value', label: 'Value', type: 'num', unitKey: 'unit' },
        { key: 'goal', label: 'Goal', type: 'num', unitKey: 'unit' },
        { key: 'score', label: 'Score', type: 'score' },
        { key: 'status', label: 'State', type: 'status' },
      ],
      linkKey: 'run',
      rows: metrics.map((m) => ({ metric: LABEL[m.id] ?? m.id, value: m.value, unit: m.unit, goal: m.goal, score: Math.floor(m.score), status: m.reading === 'measured' ? 'ok' : 'missing', run: m.source_url ?? '' })),
    }),
  ];
  return { body: body.join('') };
}
