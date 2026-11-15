import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePage } from "../../../core/score.ts";
import { validateManifest, validateRecords } from "../../../contract/validate.ts";
import { fallbackSource, manifest } from "../collect.ts";
import { MEASURES } from "../lib/compute.ts";
import { toRecord } from "../lib/score.ts";
import type { Manifest } from "../lib/types.ts";
import { snapshot } from "./fixtures.ts";

/** An invented moment in the past: the contract refuses readings from the future. */
const NOW = "2026-10-01T06:00:00Z";

const RUN = "https://github.com/Colorado-Startups/legallas/actions/runs/7";
const list = (): Manifest => ({ page: "claude-code", signoff_comment: 1, metrics: manifest(), changes: [] });
const readings = (value: (goal: number, floor: number) => number | null) =>
  manifest().map((d) => toRecord(d, { value: value(d.goal, d.floor), sample: d.min_samples, source: null, time: NOW }, RUN));

test("the manifest passes the contract, with every lens and a measure for every metric", () => {
  assert.deepEqual(validateManifest(list(), "claude-code").errors, []);
  for (const d of manifest()) assert.ok(d.id in MEASURES, d.id);
});

test("readings pass the contract; all at goal score exactly 100; no fence costs Quality points", () => {
  const atGoal = readings((goal) => goal);
  assert.deepEqual(validateRecords(atGoal, list()).errors, []);
  assert.equal(scorePage("claude-code", list(), atGoal, new Date(NOW)).total, 100);
  assert.equal(scorePage("claude-code", list(), atGoal, new Date(NOW)).consumption, 100, "lane_minutes at goal too");
  const fenceDown = atGoal.map((r) => (r.id === "fence_proven" ? { ...r, value: 0 } : r));
  const down = scorePage("claude-code", list(), fenceDown, new Date(NOW));
  assert.equal(down.exact_quality, 62.5, "fence weight 3 of Quality's 8");
  assert.ok(down.total < 100);
});

test("a missing value is a missing reading, never a number", () => {
  const r = readings(() => null)[0]!;
  assert.deepEqual(r, { id: r.id, page: "claude-code", value: null, status: "missing", stage: "live", measured_at: null, source_url: null, sample_size: null });
});

test("readings link to the collector's run in CI, else to main's commit", () => {
  const s = snapshot({ repo: "sample/repo" });
  assert.equal(fallbackSource(s, { GITHUB_RUN_ID: "7", GITHUB_REPOSITORY: "sample/repo" }), "https://github.com/sample/repo/actions/runs/7");
  assert.equal(fallbackSource(s, { GITHUB_RUN_ID: "7", GITHUB_REPOSITORY: "other/repo" }), `https://github.com/sample/repo/commit/${"0".repeat(40)}`);
  assert.equal(fallbackSource(s, {}), `https://github.com/sample/repo/commit/${"0".repeat(40)}`);
});
