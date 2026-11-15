// The Agents page, under the build's title and score ring: GitHub's Agents tab, section by section. Sessions (a row per
// vendor), Automations, the environment's setup, and Configure, which links to the Settings page. A bullet group per
// section, the vendor rows, Road to 100 and every reading. With nothing to measure, a bullet reads "no events", which scores only
// while the drill passes. The site build calls render() with the page's score and joined metrics, inside its fence;
// this file only draws, with the chart kit. Labels are one or two words each, for the page's 80-word budget.

import { readFileSync } from "node:fs";
import { bullets, dataTable, markKey, metricBullet, roadTo100, totalOf } from "../../core/charts/index.ts";
import { fixGain } from "../../core/charts/road.ts";
import type { PageContext, PageOutput } from "../../core/build.ts";
import type { MetricScore, PageScore } from "../../core/score.ts";
import type { Metric } from "../../contract/format.ts";

export const LABELS: Record<string, string> = {
  sessions_merged: "Merged",
  session_drill: "Drill",
  session_to_pr_p50: "To PR",
  minutes_per_merged_change: "Minutes",
  automation_runs_useful: "Useful",
  automation_credit_limit_set: "Credit cap",
  env_setup_success: "Setup OK",
  env_setup_seconds_p50: "Setup",
  lane_minutes: "Lane",
};

/** The tab's sections and their metrics, in the tab's order. */
export const SECTIONS: { name: string; metrics: string[] }[] = [
  { name: "Sessions", metrics: ["sessions_merged", "session_drill", "session_to_pr_p50", "minutes_per_merged_change"] },
  { name: "Automations", metrics: ["automation_runs_useful", "automation_credit_limit_set"] },
  { name: "Environment", metrics: ["env_setup_success", "env_setup_seconds_p50"] },
];

/** The vendors the tab shows; one with no session reads "off". */
export const VENDORS = ["copilot"];

type VendorRow = { vendor: string; sessions: number; merged: number };

/** The lane's sessions per vendor (page/vendors.json), or none when the lane wrote none. */
function vendorFile(): VendorRow[] {
  try {
    const rows = JSON.parse(readFileSync(new URL("vendors.json", import.meta.url), "utf8")) as unknown;
    return Array.isArray(rows) ? (rows as VendorRow[]) : [];
  } catch {
    return [];
  }
}

/** A row per vendor: the known ones first, "off" while they have no session. */
export function vendorTable(rows: VendorRow[]): string {
  const names = [...VENDORS, ...rows.map((r) => r.vendor).filter((v) => !VENDORS.includes(v))];
  return dataTable({
    caption: "Vendors",
    columns: [
      { key: "vendor", label: "Vendor" },
      { key: "sessions", label: "Sessions" },
      { key: "merged", label: "Merged" },
    ],
    rows: names.map((v) => {
      const r = rows.find((x) => x.vendor === v);
      const name = v.charAt(0).toUpperCase() + v.slice(1);
      return r && r.sessions > 0 ? { vendor: name, sessions: String(r.sessions), merged: String(r.merged) } : { vendor: name, sessions: "off", merged: "off" };
    }),
  });
}

/** PLAN.md's baseline: the 5 Nov run, scored on this list. Only lane_minutes had a reading. */
export const BASELINE = {
  q: 0,
  s: 0,
  c: 30.7,
  total: totalOf(0, 0, 30.7),
  values: { lane_minutes: 7 } as Record<string, number>,
};

/** PLAN.md's fixes, each with the metrics it moves. */
export const FIXES: { id: string; label: string; metrics: string[] }[] = [
  { id: "drill", label: "Drill passes", metrics: ["session_drill", "sessions_merged", "session_to_pr_p50", "minutes_per_merged_change", "env_setup_success", "env_setup_seconds_p50"] },
  { id: "automations", label: "Read automations", metrics: ["automation_runs_useful", "automation_credit_limit_set"] },
  { id: "lane", label: "Lane in 5 min", metrics: ["lane_minutes"] },
];

interface Row {
  m: Metric;
  s: MetricScore;
}

const label = (id: string) => LABELS[id] ?? id;

function rows(metrics: Metric[], score: PageScore): Row[] {
  return metrics.map((m) => ({ m, s: score.metrics.find((x) => x.id === m.id) ?? { id: m.id, score: 0, reading: "missing" } }));
}

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
  const bullet = (r: Row) => {
    const base = BASELINE.values[r.m.id];
    return metricBullet(r.m, label(r.m.id), base === undefined ? { reading: r.s.reading } : { reading: r.s.reading, baseline: base });
  };
  const section = (name: string, ids: string[]) => bullets(name, all.filter((r) => ids.includes(r.m.id)).map(bullet));
  const road = roadTo100({
    baseline: { q: BASELINE.q, s: BASELINE.s, c: BASELINE.c, total: BASELINE.total },
    now: { q: score.exact_quality, s: score.exact_speed, c: score.exact_consumption, total: score.total },
    fixes: FIXES.map((f) => ({ id: f.id, label: f.label, ...lensGains(f.metrics, all) })).filter((f) => fixGain(f) > 0),
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
  const grid = `<div class="qs-grid qs-grid-2">${SECTIONS.map((s) => section(s.name, s.metrics)).join("")}${section("Lane", ["lane_minutes"])}</div>`;
  const configure = `<p>Configure: <a href="../settings/">Settings</a></p>`;
  return { body: `${markKey()}${grid}${vendorTable(vendorFile())}${configure}${road}${table}` };
}
