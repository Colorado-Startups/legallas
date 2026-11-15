// The Claude Code page, under the build's title and score ring: a tile per lens's headline (tokens, first pass, task to
// merge), a bullet per metric, Road to 100 and every reading. No metric is a gate, so nothing caps it.
// The site build calls render() with the page's score and joined metrics, inside its fence; this file only draws, with
// the chart kit. Labels are one or two words each, for the page's 80-word budget.

import { bullets, dataTable, markKey, metricBullet, metricTile, roadTo100, tileRow, totalOf } from "../../core/charts/index.ts";
import { fixGain } from "../../core/charts/road.ts";
import type { PageContext, PageOutput } from "../../core/build.ts";
import type { MetricScore, PageScore } from "../../core/score.ts";
import type { Metric } from "../../contract/format.ts";

export const LABELS: Record<string, string> = {
  fence_proven: "Fence",
  shipped_bugs_open: "Open bugs",
  rule_clean: "Rules kept",
  instruction_broken: "Bad paths",
  task_to_merge_p50: "Task p50",
  task_to_merge_p90: "Task p90",
  tokens_per_merged_change: "Tokens",
  lane_minutes: "Lane",
};

/** The headline tile of each lens, left to right. */
const HEADLINES = ["tokens_per_merged_change", "shipped_bugs_open", "task_to_merge_p50"];

/**
 * The baseline in PLAN.md: the 5 Nov run's readings of the metrics that moved here from Agents, scored on this list,
 * with the metrics new to this page not read yet (0). The total by core's own rule.
 */
export const BASELINE = {
  q: 7.5,
  s: 30.8,
  c: 23,
  total: totalOf(7.5, 30.8, 23),
  values: { rule_clean: 36.7, instruction_broken: 2, lane_minutes: 7 } as Record<string, number>,
};

const REPO = "https://github.com/Colorado-Startups/legallas";

/** PLAN.md's fixes, each with the metrics it moves. */
export const FIXES: { id: string; label: string; metrics: string[]; ref?: string; href?: string }[] = [
  { id: "checks", label: "Show checks", metrics: ["rule_clean"] },
  { id: "proof", label: "Fence proven", metrics: ["fence_proven"], ref: "#828", href: `${REPO}/issues/828` },
  { id: "tokens", label: "Session per task", metrics: ["tokens_per_merged_change"] },
  { id: "paths", label: "Fix paths", metrics: ["instruction_broken"], ref: "#286", href: `${REPO}/issues/286` },
  { id: "bugs", label: "Fix open bugs", metrics: ["shipped_bugs_open"], ref: "#846", href: `${REPO}/issues/846` },
  { id: "lane", label: "Lane in 5 min", metrics: ["lane_minutes"] },
];

interface Row {
  m: Metric;
  s: MetricScore;
}

function rows(metrics: Metric[], score: PageScore): Row[] {
  return metrics.map((m) => ({ m, s: score.metrics.find((x) => x.id === m.id) ?? { id: m.id, score: 0, reading: "missing" } }));
}

const label = (id: string) => LABELS[id] ?? id;

/** Points a fix adds to each ring: its metrics' gaps to 100, weighted within their lens. */
export function lensGains(metrics: string[], all: Row[]): { q: number; s: number; c: number } {
  const lens = (l: string) => {
    const inLens = all.filter((r) => r.m.lens === l);
    const weight = inLens.reduce((sum, r) => sum + r.m.weight, 0);
    return inLens.filter((r) => metrics.includes(r.m.id)).reduce((sum, r) => sum + ((100 - r.s.score) * r.m.weight) / weight, 0);
  };
  return { q: lens("quality"), s: lens("speed"), c: lens("consumption") };
}

export function render(context: PageContext): PageOutput {
  const { score } = context;
  const all = rows(context.metrics, score);
  const tile = (r: Row) => metricTile(r.m, label(r.m.id), { reading: r.s.reading });
  const headlines = tileRow(HEADLINES.flatMap((id) => all.filter((r) => r.m.id === id)).map(tile));
  const bullet = (r: Row) => {
    const base = BASELINE.values[r.m.id];
    return metricBullet(r.m, label(r.m.id), base === undefined ? { reading: r.s.reading } : { reading: r.s.reading, baseline: base });
  };
  const lens = (name: string, l: string) => bullets(name, all.filter((r) => r.m.lens === l).map(bullet));
  const road = roadTo100({
    baseline: { q: BASELINE.q, s: BASELINE.s, c: BASELINE.c, total: BASELINE.total },
    now: { q: score.exact_quality, s: score.exact_speed, c: score.exact_consumption, total: score.total },
    fixes: FIXES.map((f) => {
      const gain = lensGains(f.metrics, all);
      return { id: f.id, label: f.label, ...gain, ...(f.ref ? { ref: f.ref } : {}), ...(f.href ? { href: f.href } : {}) };
    }).filter((f) => fixGain(f) > 0),
  });
  const table = dataTable({
    caption: "Readings",
    columns: [
      { key: "metric", label: "Metric" },
      { key: "value", label: "Value", type: "num", unitKey: "unit" },
      { key: "score", label: "Score", type: "score" },
      { key: "status", label: "State", type: "status" },
    ],
    linkKey: "run",
    rows: all.map((r) => ({
      metric: label(r.m.id), value: r.m.value, unit: r.m.unit, score: Math.floor(r.s.score), status: r.m.status,
      ...(r.m.source_url ? { run: r.m.source_url } : {}),
    })),
  });
  const grid = `<div class="qs-grid qs-grid-3">${lens("Quality", "quality")}${lens("Speed", "speed")}${lens("Consumption", "consumption")}</div>`;
  return { body: `${markKey()}${headlines}${grid}${road}${table}` };
}
