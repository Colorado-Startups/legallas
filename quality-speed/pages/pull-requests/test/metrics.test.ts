// Invented facts only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { PullFacts, QueueRun } from "../src/facts.ts";
import { type Collected, type Manifest, type Measured, type MetricRecord, failedRecords, measure, percentile, records, reworked } from "../src/metrics.ts";
import { scorePage } from "../../../core/score.ts";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as Manifest;
const NOW = new Date("2030-03-01T00:00:00Z");
const DAY = 86400000;
const URL_ = "https://github.com/example-org/example-repo/actions/runs/1";

function fact(n: number, daysAgo: number, over: Partial<PullFacts> = {}): PullFacts {
  const ended = new Date(NOW.getTime() - daysAgo * DAY).toISOString();
  return {
    v: 6,
    number: n,
    state: "merged",
    created_at: new Date(Date.parse(ended) - 20 * 60000).toISOString(),
    ended_at: ended,
    ready_at: ended,
    merge_sha: `sha${n}0000000`,
    excluded: null,
    bot: false,
    size_lines: 100,
    gate_misses: [],
    ci_green_first_time: true,
    drew_blocking: false,
    template_complete: true,
    edit_checked: true,
    open_minutes: 20,
    review_result_minutes: [2],
    fixes: [],
    reverts: [],
    rework_unknown: false,
    queue_minutes: 2,
    queue_ejected: false,
    ci_heads: 1,
    final_push_minutes: 2,
    verdicts: 1,
    review_tokens: [30000],
    stacked: false,
    ...over,
  };
}

/** A completed merge_group run for pull request `n`, created at `at`. */
function run(id: number, n: number | null, at: string, minutes: number): QueueRun {
  return { id, run_attempt: 1, pull: n, created_at: at, minutes };
}

function many(count: number, from: number, daysAgo: number, over: Partial<PullFacts> = {}): PullFacts[] {
  return Array.from({ length: count }, (_, i) => fact(from + i, daysAgo, over));
}

/** measure() with every id present, for terse asserts. */
function m(d: Collected, now = NOW): Record<string, Measured> & Record<"pushes_per_merge" | "final_push_to_merge_p50" | "review_rounds" | "review_tokens_p50" | "big_changes_stacked" | "required_gates_on_merged_head" | "ci_green_first_time" | "no_blocking_findings" | "no_rework_7d" | "small_changes" | "template_complete" | "open_to_merge_p50" | "open_to_merge_p90" | "review_result_p90" | "queue_wait_p50" | "queue_wait_p90" | "queue_ejections_pct" | "queue_minutes_per_merge" | "queue_prs_per_group_p50", Measured> {
  return measure(d, now) as ReturnType<typeof m>;
}

function data(pulls: PullFacts[], extra: Partial<Collected> = {}): Collected {
  // One 3-minute queue run per pull request, at its end.
  const queue_runs = pulls.map((f) => run(f.number, f.number, f.ended_at, 3));
  return { pulls, open: [], direct_pushes: [], deleted_runs: [], queue_runs, ...extra };
}

test("manifest: every metric has a measure; both lenses; floors and goals point the right way", () => {
  const values = m(data([]));
  for (const m of manifest.metrics) assert.ok(m.id in values, m.id);
  assert.equal(Object.keys(values).length, manifest.metrics.length);
  assert.ok(manifest.metrics.filter((m) => m.lens === "quality").length >= 3);
  assert.ok(manifest.metrics.filter((m) => m.lens === "speed").length >= 2);
  for (const m of manifest.metrics) {
    assert.match(m.id, /^[a-z][a-z0-9_]*$/);
    assert.equal(m.direction === "higher", m.goal > m.floor, `${m.id} direction matches floor and goal`);
  }
});

test("percentile: nearest rank", () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([5], 0.9), 5);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
  assert.equal(percentile([10, 1, 9, 2, 8, 3, 7, 4, 6, 5], 0.9), 9);
});

test("rework: a later merge that rewrites it, or reverts its merge commit", () => {
  assert.deepEqual([...reworked([fact(1, 20), fact(2, 18, { fixes: [1] })])], [1]);
  assert.deepEqual([...reworked([fact(1, 20), fact(3, 19, { reverts: ["sha1000"] })])], [1]);
  assert.deepEqual([...reworked([fact(1, 20), fact(4, 19)])], []);
});

test("rework: not after 7 days, not before the merge, not from another branch or an unmerged one", () => {
  assert.deepEqual([...reworked([fact(1, 20), fact(2, 12, { fixes: [1] })])], []);
  assert.deepEqual([...reworked([fact(1, 20), fact(3, 21, { fixes: [1] })])], []);
  assert.deepEqual([...reworked([fact(1, 20), fact(4, 19, { fixes: [1], excluded: "base_not_main" })])], []);
  assert.deepEqual([...reworked([fact(1, 20), fact(5, 19, { fixes: [1], state: "closed" })])], []);
});

test("rework: only merges whose 7 days have passed are counted", () => {
  assert.equal(m(data(many(25, 1, 3))).no_rework_7d.n, 0);
  assert.equal(m(data(many(25, 100, 10))).no_rework_7d.n, 25);
});

test("gate: a deleted CI, DCO or review run is a miss", () => {
  const v = m(data(many(20, 1, 5), { deleted_runs: [{ workflow: "ci", run_number: 41 }] }));
  assert.equal(v.required_gates_on_merged_head.n, 21);
  assert.ok(v.required_gates_on_merged_head.value! < 100);
});

test("template: a body never checked for edits does not count as complete", () => {
  const v = m(data([...many(19, 1, 5), fact(90, 5, { edit_checked: false })]));
  assert.equal(v.template_complete.value, 95);
});

test("time: bounds never stand in for merges, and never count as samples", () => {
  const closed = many(25, 30, 5, { state: "closed", open_minutes: 3, merge_sha: null, gate_misses: null });
  const v = m(data(closed));
  assert.equal(v.open_to_merge_p50.value, null);
  assert.equal(v.open_to_merge_p50.n, 0);
  const mixed = m(data([...many(15, 1, 5), ...closed.slice(0, 5)]));
  assert.equal(mixed.open_to_merge_p90.n, 15);
});

test("time: a pull request closed fast never lowers a percentile", () => {
  const pulls = [...many(20, 1, 5, { open_minutes: 600 }), ...many(20, 30, 5, { state: "closed", open_minutes: 3, merge_sha: null, gate_misses: null })];
  const v = m(data(pulls));
  assert.equal(v.open_to_merge_p50.value, 600);
  assert.equal(v.open_to_merge_p90.value, 600);
});

test("gate: this site's own merges are left out; direct pushes to main are misses", () => {
  const pulls = [...many(19, 1, 5), fact(50, 5, { excluded: "site_only", gate_misses: ["review_not_run"] })];
  const v = m(data(pulls, { direct_pushes: [{ sha: "abc", at: new Date(NOW.getTime() - 2 * DAY).toISOString() }] }));
  assert.equal(v.required_gates_on_merged_head.n, 20);
  assert.equal(v.required_gates_on_merged_head.value, (100 * 19) / 20);
  assert.equal(v.small_changes.n, 19);
});

test("window: 28 days; another base branch left out everywhere", () => {
  const v = m(data([...many(20, 1, 5), fact(60, 40), fact(61, 5, { excluded: "base_not_main", gate_misses: ["ci_not_green"] })]));
  assert.equal(v.required_gates_on_merged_head.n, 20);
  assert.equal(v.required_gates_on_merged_head.value, 100);
});

test("closed without merging counts in first time and Blocking once it was ready; drafts never ready do not", () => {
  const closed = fact(70, 2, { state: "closed", merge_sha: null, gate_misses: null, template_complete: null, ci_green_first_time: false, drew_blocking: true });
  const draft = fact(71, 2, { state: "closed", ready_at: null, ci_green_first_time: null, drew_blocking: null, gate_misses: null, template_complete: null });
  const v = m(data([...many(20, 1, 5), closed, draft]));
  assert.equal(v.ci_green_first_time.n, 21);
  assert.equal(v.no_blocking_findings.n, 21);
  assert.equal(v.required_gates_on_merged_head.n, 20);
  assert.equal(v.template_complete.n, 20);
});

test("time: closed-unmerged and ready open pull requests add lower bounds", () => {
  const pulls = [...many(9, 1, 5), fact(80, 2, { state: "closed", open_minutes: 5000, merge_sha: null, gate_misses: null })];
  const open = [
    { number: 81, created_at: new Date(NOW.getTime() - 3 * DAY).toISOString(), ever_ready: true, excluded: null },
    { number: 82, created_at: new Date(NOW.getTime() - 9 * DAY).toISOString(), ever_ready: false, excluded: null },
  ];
  const v = m(data(pulls, { open }));
  assert.equal(v.open_to_merge_p90.n, 9, "samples are merges only");
  // Nine at 20 minutes, the open one at 3 days, the closed one at 5000: the 10th of 11 is 3 days.
  assert.equal(v.open_to_merge_p90.value, 3 * 1440);
});

test("bots are left out of the template metric only", () => {
  const v = m(data([...many(20, 1, 5), fact(60, 5, { bot: true, template_complete: null })]));
  assert.equal(v.template_complete.n, 20);
  assert.equal(v.required_gates_on_merged_head.n, 21);
});

test("queue wait: p50 and p90 over merges that went through the queue; never queued and closed left out", () => {
  const waits = [...many(10, 1, 3, { queue_minutes: 4 }), ...many(8, 20, 3, { queue_minutes: 9 }), ...many(2, 40, 3, { queue_minutes: 60 })];
  const never = fact(50, 3, { queue_minutes: null, queue_ejected: null });
  const closed = fact(51, 3, { state: "closed", merge_sha: null, gate_misses: null, queue_minutes: null, queue_ejected: true });
  const site = fact(52, 3, { excluded: "site_only", queue_minutes: 500 });
  const v = m(data([...waits, never, closed, site]));
  assert.deepEqual([v.queue_wait_p50.value, v.queue_wait_p50.n], [4, 20]);
  // Nearest rank: the 18th of 20 is 9.
  assert.deepEqual([v.queue_wait_p90.value, v.queue_wait_p90.n], [9, 20]);
  assert.equal(m(data([never])).queue_wait_p50.value, null, "no merge through the queue is missing");
});

test("queue ejections: share of pull requests ever queued, merged or closed, that were removed without merging", () => {
  const pulls = [
    ...many(16, 1, 3),
    ...many(2, 20, 3, { queue_ejected: true }),
    fact(30, 3, { state: "closed", merge_sha: null, gate_misses: null, queue_minutes: null, queue_ejected: true }),
    fact(31, 3, { queue_minutes: 5, queue_ejected: true }),
    fact(32, 3, { queue_minutes: null, queue_ejected: null }),
    fact(33, 3, { excluded: "site_only", queue_ejected: true }),
    fact(34, 40, { queue_ejected: true }),
  ];
  const v = m(data(pulls));
  assert.equal(v.queue_ejections_pct.n, 20);
  assert.equal(v.queue_ejections_pct.value, (100 * 4) / 20);
  assert.equal(m(data([fact(32, 3, { queue_minutes: null, queue_ejected: null })])).queue_ejections_pct.value, null);
});

test("queue minutes: merge_group job minutes in the window over merges through the queue", () => {
  const pulls = [...many(20, 1, 3), fact(60, 3, { excluded: "site_only" }), fact(61, 3, { queue_minutes: null, queue_ejected: null })];
  const at = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
  const queue_runs = [
    ...pulls.slice(0, 20).map((f) => run(f.number, f.number, at(3), 4)),
    // An ejected pass of an open pull request costs minutes too.
    run(100, 99, at(2), 10),
    // This site's own, outside main's queue, outside the window: left out.
    run(101, 60, at(3), 50),
    run(102, null, at(3), 50),
    run(103, 1, at(40), 50),
  ];
  const v = m(data(pulls, { queue_runs, open: [{ number: 99, created_at: at(5), ever_ready: true, excluded: null }] }));
  assert.equal(v.queue_minutes_per_merge.n, 20);
  assert.equal(v.queue_minutes_per_merge.value, (20 * 4 + 10) / 20);
  // Merges through the queue but no run read: missing, never zero.
  assert.equal(m(data(pulls, { queue_runs: [] })).queue_minutes_per_merge.value, null);
  // A run for a site-only open pull request is left out too.
  const siteOpen = m(data(pulls, { queue_runs: [...queue_runs, run(104, 98, at(1), 30)], open: [{ number: 98, created_at: at(5), ever_ready: true, excluded: "site_only" }] }));
  assert.equal(siteOpen.queue_minutes_per_merge.value, (20 * 4 + 10) / 20);
});

test("queue groups: merges through the queue that share a merge second, median size over 14 days", () => {
  const pulls = [
    ...many(3, 1, 2),
    ...many(3, 10, 3),
    ...many(1, 20, 4),
    // Never queued, outside 14 days, this site's own: left out.
    fact(30, 5, { queue_minutes: null, queue_ejected: null }),
    fact(31, 15),
    fact(32, 6, { excluded: "site_only" }),
  ];
  const v = m(data(pulls));
  assert.deepEqual([v.queue_prs_per_group_p50.value, v.queue_prs_per_group_p50.n], [3, 3]);
  assert.equal(m(data([fact(30, 5, { queue_minutes: null, queue_ejected: null })])).queue_prs_per_group_p50.value, null);
});

test("records: the shared format, eight fields; no samples is missing", () => {
  const rs = records(data(many(5, 1, 2)), manifest, NOW, URL_);
  for (const r of rs) {
    assert.deepEqual(Object.keys(r).sort(), ["id", "measured_at", "page", "sample_size", "source_url", "stage", "status", "value"]);
    assert.equal(r.stage, "live");
  }
  const rw = rs.find((r) => r.id === "no_rework_7d")!;
  assert.deepEqual([rw.status, rw.value, rw.measured_at, rw.source_url, rw.sample_size], ["missing", null, null, null, null]);
  // No fact times the lane: collect.ts puts laneRecord() in its place.
  assert.equal(rs.find((r) => r.id === "lane_minutes")?.status, "missing");
});

// Scored with core's rule, as if signed off, with the lane's minutes at goal where collect.ts puts laneRecord().
const signed = { ...manifest, signoff_comment: 1 };
const LANE: MetricRecord = {
  id: "lane_minutes",
  page: "pull-requests",
  value: manifest.metrics.find((m) => m.id === "lane_minutes")!.goal,
  status: "ok",
  stage: "lab",
  measured_at: "2030-03-01T00:00:00Z",
  source_url: URL_,
  sample_size: 1,
};
const withLane = (rs: MetricRecord[]) => rs.map((r) => (r.id === LANE.id ? LANE : r));
/** 50 merges at goal: 10 queue groups of 5, each its own merge second, inside 14 days. */
const atGoal = () => Array.from({ length: 10 }, (_, g) => many(5, 1 + g * 5, 1 + g)).flat();
const score = (d: Collected, now = NOW) => scorePage("pull-requests", signed, withLane(records(d, manifest, NOW, URL_)), now);

test("score: too few samples, stale, missing or a failed read scores 0", () => {
  // Too few samples: Quality, Speed, queue minutes and review tokens 0, while the lane's minutes stay at goal, a third of
  // Consumption. Stacked reads no_events (nothing big), at 100 only while small_changes proves it, which it can't here.
  const few = score(data(many(5, 1, 2)));
  assert.deepEqual([few.quality, few.speed, few.consumption], [0, 0, 33]);
  assert.equal(few.total, 11);
  const full = data(atGoal());
  assert.equal(score(full).total, 100);
  assert.equal(score(full, new Date(NOW.getTime() + 49 * 3600000)).total, 0, "older than 48 hours");
  assert.equal(scorePage("pull-requests", signed, failedRecords(manifest), NOW).total, 0);
  assert.equal(scorePage("pull-requests", signed, [], NOW).total, 0, "no records at all");
});

test("score: all at goal reads exactly 100; a missed gate lowers it and caps nothing (#645)", () => {
  const pulls = atGoal();
  const all = score(data(pulls));
  assert.deepEqual([all.quality, all.speed, all.total], [100, 100, 100]);
  assert.equal(all.consumption, 100, "lane_minutes at goal too");
  pulls[0]!.gate_misses = ["behind_main"];
  const missed = score(data(pulls));
  assert.ok(missed.total < 100, `total ${missed.total}`);
});

test("moved and new metrics: pushes, last push, review rounds and tokens, stacks", () => {
  const pulls = [
    ...many(8, 1, 2),
    fact(9, 2, { ci_heads: 3, verdicts: 2, review_tokens: [50000, 70000], final_push_minutes: 10 }),
    fact(10, 2, { state: "closed", ci_heads: 2, verdicts: 1, review_tokens: [] }),
    fact(11, 20, { verdicts: 0, review_tokens: [] }),
  ];
  const r = m(data(pulls));
  // Pushes: 8 + 3 + 2 + 1 over 10 merges. Rounds, last 7 days only: 8 + 2 + 1 over 9 merges.
  assert.equal(r.pushes_per_merge.value, 1.4);
  assert.equal(r.review_rounds.value, 11 / 9);
  assert.equal(r.review_tokens_p50.value, 30000);
  assert.equal(r.final_push_to_merge_p50.value, 2);
  assert.equal(r.big_changes_stacked.none, true, "nothing big: no events");
  // A recent merge with no verdict proves no review: missing, never cheap. A merge with no CI run, the same for pushes.
  assert.equal(m(data([...pulls, fact(12, 1, { verdicts: 0, ci_heads: 0 })])).review_rounds.value, null);
  assert.equal(m(data([...pulls, fact(12, 1, { ci_heads: 0 })])).pushes_per_merge.value, null);
  // No verdict carries a Tokens line yet: missing.
  assert.equal(m(data(many(5, 1, 2, { review_tokens: [] }))).review_tokens_p50.value, null);
  // Big: two lone ones over 400 lines, two stack layers (one small): half stacked.
  const big = m(data([...many(5, 1, 2), fact(6, 2, { size_lines: 900 }), fact(7, 2, { size_lines: 500 }), fact(8, 2, { stacked: true }), fact(9, 2, { stacked: true, size_lines: 900 })]));
  assert.deepEqual([big.big_changes_stacked.value, big.big_changes_stacked.n], [50, 4]);
  const rec = records(data(many(5, 1, 2)), manifest, NOW, URL_).find((x) => x.id === "big_changes_stacked")!;
  assert.deepEqual([rec.status, rec.value, rec.sample_size, rec.source_url], ["no_events", null, 0, URL_]);
});
