// SPDX-License-Identifier: Apache-2.0
// The Claude documentation page, inside the site build's shell (core/build.ts adds the title, the ring and the change log):
// what Claude and other coding AIs read at start. Tiles, a heatmap of the two places a session reads from by lens, the
// drill-downs the collector leaves beside this file (answers.json, load.json, rows.json), the trend and Road to 100.

import { existsSync, readFileSync } from 'node:fs';
import type { Metric } from '../../contract/format.ts';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { dataTable, dotMatrix, heatLegend, heatmap, metricTile, roadTo100, tileRow, trend } from '../../core/charts/index.ts';
import type { HeatCell, PassState, RoadFixProps } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';
import { type ScoredRow, combine } from '../../core/score.ts';

const LABEL: Record<string, string> = {
  questions_true: 'Answers',
  settings_match: 'Rows met',
  deny_rules_kept: 'Deny rules',
  drift_open_hours: 'Drift',
  start_tokens: 'Start load',
  startup_tokens: '.claude/ load',
};

const LENSES = ['quality', 'speed', 'consumption'] as const;

/** Where a session reads from: the start files, and .claude/. */
export const PLACES: { id: string; label: string; metrics: string[] }[] = [
  { id: 'start', label: 'CLAUDE.md', metrics: ['questions_true', 'start_tokens'] },
  { id: 'claude', label: '.claude/', metrics: ['settings_match', 'deny_rules_kept', 'drift_open_hours', 'startup_tokens'] },
];

/** Fixes left, each moving its metrics to goal. */
const FIXES: { id: string; label: string; metrics: string[] }[] = [
  { id: 'answers', label: 'Answers', metrics: ['questions_true'] },
  { id: 'start', label: 'Lighter start', metrics: ['start_tokens'] },
  { id: 'claude', label: 'Lighter .claude/', metrics: ['startup_tokens'] },
  { id: 'rows', label: 'Rows met', metrics: ['settings_match', 'deny_rules_kept', 'drift_open_hours'] },
];

/** Each place's score per lens: the weighted mean of its metrics' scores, or excluded when the lens has none there. */
export function placeCells(rows: ScoredRow[]): HeatCell[] {
  return PLACES.flatMap((p) =>
    LENSES.map((lens): HeatCell => {
      const mine = rows.filter((r) => r.lens === lens && p.metrics.includes(r.id));
      const weight = mine.reduce((n, r) => n + r.weight, 0);
      return weight === 0
        ? { row: lens, col: p.id, score: null, excluded: true }
        : { row: lens, col: p.id, score: Math.floor(mine.reduce((n, r) => n + r.weight * r.score, 0) / weight) };
    }),
  );
}

export interface Drill {
  answers: { id: string; stated: boolean; true: boolean; clean: boolean }[] | null;
  load: { path: string; tokens: number; part: string }[] | null;
  rows: { id: string; met: boolean }[] | null;
}

const state = (ok: boolean): PassState => (ok ? 'pass' : 'fail');

/** The drill-downs, each drawn only when the collector left its file. */
export function drill({ answers, load, rows }: Drill): string {
  const parts: string[] = [];
  if (answers?.length) {
    const cols = ['Stated', 'True', 'Clean'];
    parts.push(dotMatrix({ caption: 'Start questions', rows: answers.map((a) => a.id), cols, states: answers.map((a) => [state(a.stated), state(a.true), state(a.clean)]) }));
  }
  if (rows?.length) parts.push(dotMatrix({ caption: 'Settings rows', rows: rows.map((r) => r.id), cols: ['Met'], states: rows.map((r) => [state(r.met)]) }));
  if (load?.length) {
    parts.push(
      dataTable({
        caption: 'Loaded at start',
        columns: [{ key: 'path', label: 'file' }, { key: 'part', label: 'place' }, { key: 'tokens', label: 'tokens', type: 'num' }],
        rows: load.map((f) => ({ path: f.path, part: f.part === 'claude' ? '.claude/' : 'start', tokens: f.tokens })),
      }),
    );
  }
  return parts.length ? `<section class="qs-grid qs-grid-2">${parts.join('')}</section>` : '';
}

const readDrill = (name: string) => {
  const file = new URL(`./${name}.json`, import.meta.url);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};

export function render({ score, metrics, history }: PageContext, found: Drill = { answers: readDrill('answers'), load: readDrill('load'), rows: readDrill('rows') }): PageOutput {
  if (!score.has_list) return { body: '' };
  const reading = (i: number) => score.metrics[i]?.reading ?? 'missing';
  const label = (m: Metric) => LABEL[m.id] ?? m.id;
  const rows: ScoredRow[] = metrics.map((m, i) => ({ id: m.id, lens: m.lens, weight: m.weight, group: m.group, score: score.metrics[i]?.score ?? 0 }));
  const now = { q: score.exact_quality, s: score.exact_speed, total: score.total, c: score.exact_consumption };
  const first = history[0];
  const base = first ? { q: first.quality, s: first.speed, total: first.total } : now;
  // A fix under a twentieth of a point across the lenses draws nothing.
  const fixes: RoadFixProps[] = FIXES.map((f) => {
    const lifted = combine(rows.map((r) => (f.metrics.includes(r.id) ? { ...r, score: 100 } : r)));
    return { id: f.id, label: f.label, q: lifted.exact_quality - now.q, s: lifted.exact_speed - now.s, c: lifted.exact_consumption - now.c };
  }).filter((f) => fixGain(f) > 0.05 / 3);
  const tiles = metrics.map((m, i) => metricTile(m, label(m), { reading: reading(i) }));
  const line = history.length >= 2 ? trend({ label: 'Total', points: history.map((h) => ({ t: h.at, v: h.total })), goal: 100, domain: [0, 100], lens: 'quality' }) : '';
  return {
    body: `
${tileRow(tiles)}
<section>${heatmap({
      title: 'Session reads',
      rows: LENSES.map((l) => ({ id: l, label: l[0]!.toUpperCase() + l.slice(1) })),
      cols: PLACES.map((p) => ({ id: p.id, label: p.label })),
      cells: placeCells(rows),
    })}${heatLegend()}</section>
${drill(found)}
${line}
<section>${roadTo100({ baseline: base, now, fixes })}</section>`,
  };
}
