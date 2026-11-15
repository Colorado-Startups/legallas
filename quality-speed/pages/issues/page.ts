// The Issues page: every open issue clear, ranked and typed, every fix closed for good by its merged pull request, none idle
// or overdue; labels and the one milestone sort them. The build adds the
// title and the score ring; this returns the rest, from the chart kit only. Every word is a fixed label here; the data adds
// numbers and dates. The rank table reads the lane's detail.json (measure.ts detail).

import type { Metric } from "../../contract/format.ts";
import type { PageContext, PageOutput } from "../../core/build.ts";
import type { Detail } from "../../core/detail.ts";
import { bullets, dataTable, markKey, metricBullet, metricTile, pictogram, roadTo100, tileRow } from "../../core/charts/index.ts";
import type { RoadFixProps } from "../../core/charts/index.ts";
import { fixGain } from "../../core/charts/road.ts";
import type { MetricScore } from "../../core/score.ts";

/** The page's words: a label for each metric, and for the fix that brings it to goal. */
const LABELS: Record<string, { label: string; fix: string }> = {
  missing_parts: { label: "Missing parts", fix: "Add parts" },
  unranked: { label: "Unranked", fix: "Rank" },
  closed_by_hand: { label: "Closed by hand", fix: "Close by PR" },
  reopened: { label: "Reopened", fix: "Fix for good" },
  untyped: { label: "No type", fix: "Set type" },
  unused_labels: { label: "Unused labels", fix: "Delete" },
  overdue: { label: "Overdue", fix: "Close in time" },
  launch_open: { label: "Launch open", fix: "Close launch" },
  stale: { label: "Stale", fix: "Touch idle" },
  lane_minutes: { label: "Lane minutes", fix: "Shorter lane" },
};

const label = (id: string) => LABELS[id]?.label ?? id;

/**
 * What reaching goal on each metric would add to its ring: its weight's share of the points it is short, largest gain on the
 * total first, by core's own weights. A fix that adds nothing to the total there draws no row.
 */
export function roadFixes(metrics: readonly Metric[], scores: readonly MetricScore[]): RoadFixProps[] {
  const lensWeight = (lens: Metric["lens"]) => metrics.filter((m) => m.lens === lens).reduce((a, m) => a + m.weight, 0);
  return metrics
    .map((m, i) => {
      const gain = ((100 - (scores[i]?.score ?? 0)) * m.weight) / lensWeight(m.lens);
      return { id: m.id, label: LABELS[m.id]?.fix ?? m.id, q: m.lens === "quality" ? gain : 0, s: m.lens === "speed" ? gain : 0, c: m.lens === "consumption" ? gain : 0 };
    })
    .filter((f) => fixGain(f) > 1e-9)
    .sort((a, b) => fixGain(b) - fixGain(a));
}

/** Open issues as counted things: the ones a metric doesn't count against, of every open one. Only a measured reading is drawn. */
function counted(m: Metric | undefined, reading: string, open: number | undefined, name: string): string {
  if (!m || reading !== "measured" || m.value === null || open === undefined) return "";
  return pictogram({ label: name, total: open, filled: Math.max(0, open - m.value), glyph: "doc" });
}

const RANKS = [
  { id: "p1", label: "P1" },
  { id: "p2", label: "P2" },
  { id: "p3", label: "P3" },
  { id: "none", label: "None" },
];
const SEVERITIES = ["critical", "high", "medium", "low"] as const;

/** Open issues by rank and severity, from the lane's detail. Drawn only when every cell was read. */
export function rankTable(detail: Detail | null): string {
  const cell = (id: string) => detail?.readings[id]?.value;
  if (!RANKS.every((r) => SEVERITIES.every((s) => cell(`${r.id}_${s}`) !== undefined))) return "";
  return dataTable({
    caption: "Open by rank",
    columns: [
      { key: "rank", label: "Rank" },
      { key: "critical", label: "Critical", type: "num" },
      { key: "high", label: "High", type: "num" },
      { key: "medium", label: "Medium", type: "num" },
      { key: "low", label: "Low", type: "num" },
      { key: "total", label: "Total", type: "num" },
    ],
    rows: RANKS.map((r) => {
      const counts = Object.fromEntries(SEVERITIES.map((s) => [s, cell(`${r.id}_${s}`) as number]));
      return { rank: r.label, ...counts, total: SEVERITIES.reduce((a, s) => a + (counts[s] ?? 0), 0) };
    }),
  });
}

export function render({ score, metrics, history, detail }: PageContext): PageOutput {
  if (!score.has_list) return { body: "" };
  const at = (id: string) => metrics.findIndex((m) => m.id === id);
  const reading = (id: string) => score.metrics[at(id)]?.reading ?? "missing";
  const metric = (id: string) => metrics[at(id)];
  const open = detail?.readings.open?.value;
  const first = history[0];
  const baseline = first ? { q: first.quality, s: first.speed, total: first.total } : { q: score.quality, s: score.speed, total: score.total };
  // The consumption ring's score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: score.exact_quality, s: score.exact_speed, total: score.total, c: score.exact_consumption };
  const bullet = (id: string) => metricBullet(metric(id) as Metric, label(id), { reading: reading(id) });
  const tile = (id: string) => metricTile(metric(id) as Metric, label(id), { reading: reading(id) });
  const table = dataTable({
    caption: "Every metric",
    columns: [
      { key: "metric", label: "Metric" },
      { key: "value", label: "Value", type: "num", unitKey: "unit" },
      { key: "samples", label: "Samples", type: "num" },
      { key: "score", label: "Score", type: "score" },
    ],
    linkKey: "run",
    rows: metrics.map((m, i) => ({
      metric: label(m.id),
      value: m.value,
      unit: m.unit,
      samples: m.sample_size,
      score: Math.floor(score.metrics[i]?.score ?? 0),
      run: m.source_url,
    })),
  });
  const body = [
    `<section class="qs-grid qs-grid-2">${counted(metric("missing_parts"), reading("missing_parts"), open, "Four parts")}${counted(metric("unranked"), reading("unranked"), open, "Ranked")}</section>`,
    rankTable(detail),
    `<section class="qs-grid qs-grid-2">`,
    bullets("Filed, ranked, closed", ["missing_parts", "unranked", "untyped", "closed_by_hand", "reopened"].map(bullet)),
    `<div>${tileRow(["stale", "overdue", "launch_open", "unused_labels"].map(tile))}</div>`,
    `</section>`,
    roadTo100({ baseline, now, fixes: roadFixes(metrics, score.metrics) }),
    markKey(),
    table,
  ].join("");
  return { body };
}
