import { test } from "node:test";
import assert from "node:assert/strict";
import { frameWords } from "../../../core/build.ts";
import { countWords } from "../../../core/guard.ts";
import { scorePage } from "../../../core/score.ts";
import { joinMetrics } from "../../../contract/validate.ts";
import type { PageContext } from "../../../core/build.ts";
import type { MetricRecord } from "../../../contract/format.ts";
import { manifest } from "../collect.ts";
import { LABELS, render } from "../page.ts";
import type { Manifest } from "../lib/types.ts";

/** An invented moment in the past: the contract refuses readings from the future. */
const NOW = new Date("2026-10-01T06:00:00Z");
const list: Manifest = { page: "claude-code", signoff_comment: 1, metrics: manifest(), changes: [] };
const atGoal: MetricRecord[] = list.metrics.map((d) => ({
  id: d.id, page: "claude-code", value: d.goal, status: "ok", stage: "live", measured_at: "2026-10-01T05:00:00Z",
  source_url: "https://github.com/Colorado-Startups/legallas/actions/runs/7", sample_size: d.min_samples,
}));
const body = (records: MetricRecord[]) =>
  render({ page: "claude-code", manifest: list, metrics: joinMetrics(list, records), score: scorePage("claude-code", list, records, NOW) } as unknown as PageContext).body;

test("every metric has a label, and the page stays within 80 visible words at goal and with every reading missing", () => {
  for (const d of list.metrics) assert.ok(LABELS[d.id], d.id);
  for (const records of [atGoal, []]) {
    const html = body(records);
    assert.ok(countWords(html) + frameWords("claude-code") <= 80, `visible words: ${countWords(html)}`);
    assert.ok(!/style=|on\w+=|<h1/.test(html));
  }
});
