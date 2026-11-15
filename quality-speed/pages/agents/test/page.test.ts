import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { frameWords } from "../../../core/build.ts";
import { countWords } from "../../../core/guard.ts";
import { scorePage } from "../../../core/score.ts";
import { joinMetrics } from "../../../contract/validate.ts";
import type { PageContext } from "../../../core/build.ts";
import type { MetricRecord } from "../../../contract/format.ts";
import { manifest, records } from "../collect.ts";
import { LABELS, render, vendorTable } from "../page.ts";

/** An invented moment in the past: the contract refuses readings from the future. */
const NOW = new Date("2026-10-01T06:00:00Z");
const RUN = "https://github.com/Colorado-Startups/legallas/actions/runs/7";
const list = manifest();
const atGoal: MetricRecord[] = list.metrics.map((d) => ({
  id: d.id, page: "agents", value: d.goal, status: "ok", stage: "live", measured_at: "2026-10-01T05:00:00Z", source_url: RUN, sample_size: d.min_samples,
}));
const quiet = records({ takenAt: NOW.toISOString(), runs: [], pulls: [], automations: [], setupRuns: [] }, list.metrics, RUN);
const body = (recs: MetricRecord[]) =>
  render({ page: "agents", manifest: list, metrics: joinMetrics(list, recs), score: scorePage("agents", list, recs, NOW) } as unknown as PageContext).body;

test("every metric has a label, and the page stays within 80 visible words at goal, quiet, and with every reading missing", () => {
  for (const d of list.metrics) assert.ok(LABELS[d.id], d.id);
  for (const recs of [atGoal, quiet, []]) {
    const html = body(recs);
    assert.ok(countWords(html) + frameWords("agents") <= 80, `visible words: ${countWords(html)}`);
    assert.ok(!/style=|on\w+=|<h1/.test(html));
  }
});

test("vendor rows show their counts, and the collector writes the file core/detail.ts copies beside page.ts", () => {
  const html = vendorTable([{ vendor: "copilot", sessions: 4, merged: 3 }, { vendor: "claude", sessions: 2, merged: 1 }]);
  assert.match(html, /Copilot[\s\S]*?>4<[\s\S]*?>3</);
  assert.match(html, /Claude[\s\S]*?>2<[\s\S]*?>1</);
  assert.match(vendorTable([]), /Copilot[\s\S]*?off/);
  const collect = readFileSync(new URL("../collect.ts", import.meta.url), "utf8");
  assert.match(collect, /join\(process\.env\.DETAIL_DIR, "page", "vendors\.json"\)/);
  assert.match(readFileSync(new URL("../page.ts", import.meta.url), "utf8"), /new URL\("vendors\.json", import\.meta\.url\)/);
});
