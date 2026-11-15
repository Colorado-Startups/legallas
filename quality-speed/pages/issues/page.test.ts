// Invented data only.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetricRecord } from "../../contract/format.ts";
import { joinMetrics } from "../../contract/validate.ts";
import { scorePage } from "../../core/score.ts";
import manifestJson from "./manifest.json" with { type: "json" };
import type { Manifest } from "./measure.ts";
import { detail } from "./measure.ts";
import { rankTable, render, roadFixes } from "./page.ts";

const manifest = { ...(manifestJson as unknown as Manifest), signoff_comment: 1 };
const AT = "2030-03-01T00:00:00Z";
const NOW = new Date(AT);
const RUN = "https://github.com/Colorado-Startups/legallas/actions/runs/1001";

const rec = (id: string, value: number | null, sample: number): MetricRecord =>
  value === null
    ? { id, page: "issues", value: null, status: "missing", stage: "live", measured_at: null, source_url: null, sample_size: null }
    : { id, page: "issues", value, status: "ok", stage: "live", measured_at: AT, source_url: RUN, sample_size: sample };

const records = [
  rec("missing_parts", 4, 30),
  rec("unranked", 2, 30),
  rec("closed_by_hand", 1, 30),
  rec("stale", null, 0),
];

// Six open issues: two P1 critical, one P2 medium, three with no rank (no Severity line, so high).
const row = (n: number, p: "P1" | "P2" | null, sev: "critical" | "medium" | "high") =>
  ({ n, goal: true, who: true, where: true, done: true, p, sev, age_d: 1, stale: false, typed: true, overdue: false, launch: false });
const DETAIL = detail([row(1, "P1", "critical"), row(2, "P1", "critical"), row(3, "P2", "medium"), row(4, null, "high"), row(5, null, "high"), row(6, null, "high")]);

const context = (rs: MetricRecord[], d: typeof DETAIL | null = DETAIL) => ({
  score: scorePage("issues", manifest, rs, NOW),
  metrics: joinMetrics(manifest, rs),
  history: [],
  others: {},
  detail: d,
});

/** Visible words, as the publish guard counts them: no table data, scripts, styles or screen-reader-only text. */
function wordCount(html: string): number {
  const visible = html
    .replace(/<(script|style|table|details)[\s\S]*?<\/\1>/g, " ")
    .replace(/<span class="qs-sr">[\s\S]*?<\/span>/g, " ")
    .replace(/<[^>]+>/g, " ");
  return (visible.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length;
}

test("the page stays within 80 visible words, with room for the build's title and ring", () => {
  const { body } = render(context(records));
  assert.ok(wordCount(body) <= 70, `visible words: ${wordCount(body)}`);
});

test("a stale reading draws no pictogram, and the road has no unexplained gap", () => {
  const fresh = render(context(records)).body;
  assert.match(fresh, /qs-pictogram/);
  assert.doesNotMatch(fresh, /No fix yet/);
  const later = { ...context(records), score: scorePage("issues", manifest, records, new Date(NOW.getTime() + 13 * 86_400_000)) };
  assert.doesNotMatch(render(later).body, /qs-pictogram/);
});

test("pictograms count the open issues each metric doesn't count against", () => {
  const body = render(context(records)).body;
  // 6 open: 4 missing a part, 2 unranked.
  assert.match(body, /aria-label="Four parts: 2 of 6"/);
  assert.match(body, /aria-label="Ranked: 4 of 6"/);
  // No detail, no open count: no pictogram and no rank table.
  const bare = render(context(records, null)).body;
  assert.doesNotMatch(bare, /qs-pictogram|Open by rank/);
});

test("the rank table: a row per rank, its severities and total; only with every cell read", () => {
  const html = rankTable(DETAIL);
  assert.match(html, /Open by rank/);
  for (const r of ["P1", "P2", "P3", "None"]) assert.match(html, new RegExp(`>${r}<`));
  assert.equal(rankTable({ checks: {}, readings: { open: { value: 1, limit: null, n: 1 } } }), "");
  assert.equal(rankTable(null), "");
});

test("Road to 100: each fix is its metric's share of the points short, largest gain on the total first", () => {
  const c = context(records);
  const fixes = roadFixes(c.metrics, c.score.metrics);
  assert.ok(Math.abs(fixes.reduce((a, f) => a + f.q, 0) - (100 - c.score.exact_quality)) < 1e-9);
  assert.ok(Math.abs(fixes.reduce((a, f) => a + f.s, 0) - (100 - c.score.exact_speed)) < 1e-9);
  assert.ok(Math.abs(fixes.reduce((a, f) => a + (f.c ?? 0), 0) - (100 - c.score.exact_consumption)) < 1e-9);
  // A third of each lens, as the total counts them.
  const gains = fixes.map((f) => (f.q + f.s + (f.c ?? 0)) / 3);
  assert.deepEqual(gains, [...gains].sort((a, b) => b - a));
  assert.equal(fixes[0]?.id, "lane_minutes");
});

test("a page at goal has no fixes left", () => {
  const c = context(manifest.metrics.map((d) => rec(d.id, d.goal, d.min_samples)));
  assert.deepEqual(roadFixes(c.metrics, c.score.metrics), []);
});
