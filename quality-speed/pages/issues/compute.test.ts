// Invented data only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { scorePage } from "../../core/score.ts";
import { CONFIG as cfg, closesSince, inScope, rankOf, rows, severityOf, siteOwn, templateParts, type Issue } from "./compute.ts";
import { closedByPr, closersQuery, labelUses, reopenedQuery } from "./collect.ts";
import { allMissing, cellId, checkIssues, CollectError, detail, readings, records, type Manifest, type Provenance } from "./measure.ts";
import manifestJson from "./manifest.json" with { type: "json" };

const manifest = manifestJson as unknown as Manifest;
const signed = { ...manifest, signoff_comment: 1 };
const RUN: Provenance = { run_url: "https://github.com/Colorado-Startups/legallas/actions/runs/1001" };
const NOW = Date.parse("2030-03-01T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const FULL =
  "## Goal\nA widget.\n\n## Who it's for\nFounders.\n\n## Where to work\n`web/`\n\n## Done when\nTests pass.\n";

function issue(n: number, over: Partial<Issue> = {}): Issue {
  return {
    number: n,
    state: "open",
    created_at: daysAgo(5),
    updated_at: daysAgo(1),
    labels: [{ name: "bug" }, { name: "area:web" }],
    body: FULL,
    ...over,
  };
}

const done = (n: number, over: Partial<Issue> = {}) =>
  issue(n, { state: "closed", state_reason: "completed", closed_at: daysAgo(1), ...over });

test("all four parts, each with real text under it", () => {
  assert.deepEqual(templateParts(FULL), { goal: true, who: true, where: true, done: true });
  for (const filler of ["", "TBD", "- TODO", "n/a", "-", "?", "...", "None.", "_No response_", "<!-- later -->"]) {
    assert.equal(templateParts(`## Goal\n${filler}\n`).goal, false, filler);
  }
  assert.deepEqual(templateParts("Goal: a widget. Done when it ships."), { goal: false, who: false, where: false, done: false });
});

test("the forms' headings and a curly apostrophe count", () => {
  const body = "### What happened, and what you expected\nIt crashed.\n### Who it’s for\nFounders.\n### Files\n`web/`\n### Done when\nIt works.";
  assert.deepEqual(templateParts(body), { goal: true, who: true, where: true, done: true });
});

test("pull requests and this site's own issues are out of scope", () => {
  const all = [issue(1), issue(2, { pull_request: {} }), issue(3, { labels: [{ name: cfg.excluded_label }] })];
  assert.deepEqual(inScope(all, cfg).map((i) => i.number), [1]);
});

const HOURS = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function sample(): Issue[] {
  // Ten completed closes, open 2 to 20 hours, closed one day apart, newest first by number.
  const closed = Array.from({ length: 10 }, (_, k) => done(100 + k, { created_at: HOURS(24 * (k + 1) + 2 * (k + 1)), closed_at: HOURS(24 * (k + 1)) }));
  return [
    issue(2, { labels: [{ name: "bug" }, { name: "P1" }] }),
    issue(3, { body: "No headings here." }),
    issue(4, { labels: [] }),
    issue(5, { updated_at: daysAgo(61), created_at: daysAgo(70) }),
    issue(7, { pull_request: {} }),
    ...closed,
  ];
}

/** The closers the collector would read: all but #109 closed by a commit. */
const closers = (all: Issue[]) => new Map(all.filter((i) => i.state === "closed").map((i) => [i.number, i.number !== 109] as const));

test("readings from an invented repo: counts a fix takes off at once, every issue in scope the sample", () => {
  const all = sample();
  const v = readings(all, cfg, NOW, closers(all)).values;
  // 4 open and 10 closed in scope. Only #3 lacks a part.
  assert.deepEqual(v.get("missing_parts"), { value: 1, sample: 14 });
  // Only #2 carries one rank.
  assert.deepEqual(v.get("unranked"), { value: 3, sample: 14 });
  // #109's close names no commit.
  assert.deepEqual(v.get("closed_by_hand"), { value: 1, sample: 14 });
  // Only #5 has been idle 60 days.
  assert.deepEqual(v.get("stale"), { value: 1, sample: 14 });
});

test("a fix moves its count at once: a rewrite, a rank label, a close reopened and closed by a pull request", () => {
  const all = sample();
  const fixed = all.map((i) =>
    i.state === "open" ? { ...i, body: FULL, labels: [{ name: "P2" }] } : i,
  );
  const v = readings(fixed, cfg, NOW, new Map([...closers(all)].map(([n]) => [n, true] as const))).values;
  for (const id of ["missing_parts", "unranked", "closed_by_hand"]) assert.equal(v.get(id)?.value, 0, id);
});

test("closes: completed ones since closes_since only, and a close with no closer read is unmeasured", () => {
  const before = new Date(Date.parse(cfg.closes_since) - 3_600_000).toISOString();
  const all = [
    ...sample(),
    done(600, { created_at: before, closed_at: before }),
    done(601, { state_reason: "not_planned", closed_at: HOURS(0.5) }),
    done(602, { closed_at: cfg.closes_since }),
  ];
  // Oldest first; #600 closed before the start, #601 not as completed.
  assert.deepEqual(closesSince(inScope(all, cfg), cfg).map((i) => i.number), [602, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100]);
  const byHand = new Map([...closers(all), [600, false], [601, false], [602, false]] as const);
  assert.equal(readings(all, cfg, NOW, byHand).values.get("closed_by_hand")?.value, 2);
  const partial = new Map([...byHand].filter(([n]) => n !== 105));
  assert.deepEqual(readings(all, cfg, NOW, partial).values.get("closed_by_hand"), { value: null, sample: 17 });
});

test("rank: exactly one P label; severity: the Reliability page's line, none counting as high", () => {
  assert.equal(rankOf(issue(1, { labels: [{ name: "P3" }, { name: "bug" }] }), cfg), "P3");
  assert.equal(rankOf(issue(1, { labels: [{ name: "P1" }, { name: "P2" }] }), cfg), null);
  assert.equal(rankOf(issue(1, { labels: [{ name: "p1" }] }), cfg), null);
  assert.equal(severityOf("Severity: Medium\nLanded: #1"), "medium");
  assert.equal(severityOf("Severity: urgent"), "high");
  assert.equal(severityOf(null), "high");
});

test("detail: open issues by rank and severity, every cell present, counts only", () => {
  const all = [
    issue(1, { labels: [{ name: "P1" }], body: `Severity: critical\n${FULL}` }),
    issue(2, { labels: [{ name: "P1" }], body: `Severity: critical\n${FULL}` }),
    issue(3, { labels: [{ name: "P3" }], body: `Severity: low\n${FULL}` }),
    issue(4),
    done(5, { labels: [{ name: "P1" }] }),
  ];
  const d = detail(rows(all, cfg, NOW));
  assert.deepEqual(d.checks, {});
  assert.equal(Object.keys(d.readings).length, 17);
  assert.deepEqual(d.readings.open, { value: 4, limit: null, n: 4 });
  assert.equal(d.readings[cellId("P1", "critical")]?.value, 2);
  assert.equal(d.readings[cellId("P3", "low")]?.value, 1);
  assert.equal(d.readings[cellId(null, "high")]?.value, 1);
  assert.equal(d.readings.p2_medium?.value, 0);
  for (const id of Object.keys(d.readings)) assert.match(id, /^[a-z0-9][a-z0-9_-]{0,31}$/);
});

test("a close counts as by a PR only when its latest closer is a pull request or a commit", () => {
  const close = (closer: unknown) => ({ timelineItems: { nodes: [{ closer }] } });
  // A merge-queue squash: GraphQL names the PR, while REST's commit_id stays null.
  assert.equal(closedByPr(close({ __typename: "PullRequest" })), true);
  assert.equal(closedByPr(close({ __typename: "Commit" })), true);
  assert.equal(closedByPr(close(null)), false);
  assert.equal(closedByPr(close({ __typename: "ProjectV2" })), false);
  assert.equal(closedByPr({ timelineItems: { nodes: [] } }), undefined);
  assert.throws(() => closedByPr(null), CollectError);
  assert.throws(() => closedByPr({}), CollectError);
});

test("the closers query asks one alias per issue and refuses anything but an issue number", () => {
  const q = closersQuery([884, 12]);
  assert.match(q, /repository\(owner: "Colorado-Startups", name: "legallas"\)/);
  assert.match(q, /i884: issue\(number: 884\)/);
  assert.match(q, /i12: issue\(number: 12\)/);
  assert.equal(q.match(/timelineItems\(itemTypes: \[CLOSED_EVENT\], last: 1\)/g)?.length, 2);
  for (const bad of [0, -1, 1.5, Number.NaN]) assert.throws(() => closersQuery([bad]), CollectError);
});

test("a cleared list: no open issue reads 0 on every count, still with a sample", () => {
  const old = Array.from({ length: 20 }, (_, k) => done(k + 1, { created_at: daysAgo(100 - k), closed_at: daysAgo(20) }));
  const v = readings(old, cfg, NOW, closers(old)).values;
  for (const id of ["missing_parts", "unranked", "closed_by_hand", "stale"]) assert.deepEqual(v.get(id), { value: 0, sample: 20 }, id);
  assert.equal(cfg.stale_days, 60);
});

test("this site's own issues are left out and listed: its label, or every named file in its folder", () => {
  const own = (files: string) => `## Goal\nx\n## Files\n${files}\n`;
  assert.equal(siteOwn(issue(1, { body: own("`quality-speed/core/build.ts`, `./quality-speed/pages/x/page.ts`") }), cfg), true);
  assert.equal(siteOwn(issue(2, { body: own("`quality-speed/core/build.ts`, `web/worker/room.ts`") }), cfg), false);
  assert.equal(siteOwn(issue(3, { body: own("none named") }), cfg), false);
  assert.equal(siteOwn(issue(4, { body: "## What happened\n`quality-speed/core/charts/road.ts` draws it wrong." }), cfg), true);
  assert.equal(siteOwn(issue(5, { body: "## Where\n`quality-speed/pages/x/PLAN.md`" }), cfg), true);
  assert.equal(siteOwn(issue(6, { body: own("`quality-speed/core/charts/`, `core/`, `sketch.ts`") }), cfg), true);
  assert.equal(siteOwn(issue(7, { body: own("`quality-speed/pages/x/a.md`, `docs/design/b.md`") }), cfg), false);
  assert.equal(siteOwn(issue(8, { body: own("`.github/workflows/quality-speed-screens.yml`") }), cfg), true);
  assert.equal(siteOwn(issue(9, { body: own("`.github/workflows/ci.yml`") }), cfg), false);
  const all = [...sample(), issue(300, { labels: [{ name: cfg.excluded_label }] }), issue(301, { body: own("`quality-speed/BRIEF.md`") })];
  assert.deepEqual(readings(all, cfg, NOW, closers(all)).excluded, [300, 301]);
});

test("a malformed read is an error; an issue read twice counts once, as its latest", () => {
  assert.throws(() => checkIssues({}), CollectError);
  assert.throws(() => checkIssues([issue(1, { created_at: "soon" })]), CollectError);
  assert.throws(() => checkIssues([{ ...issue(1), labels: [{}] }]), CollectError);
  assert.throws(() => checkIssues([issue(1, { state: "closed", closed_at: null })]), CollectError);
  const twice = checkIssues([issue(1, { updated_at: daysAgo(3) }), issue(1, { updated_at: daysAgo(2), body: "newer" })]);
  assert.deepEqual(twice.map((i) => i.body), ["newer"]);
});

test("records: eight fields, a run behind every ok, and non-finite values missing", () => {
  const values = readings(sample(), cfg, NOW, closers(sample())).values;
  const recs = records(values, manifest, RUN, NOW);
  const keys = ["id", "page", "value", "status", "stage", "measured_at", "source_url", "sample_size"].sort();
  for (const r of recs) assert.deepEqual(Object.keys(r).sort(), keys);
  for (const run_url of [null, "https://github.com/Colorado-Startups/legallas/issues/1"]) {
    assert.ok(records(values, manifest, { run_url }, NOW).every((r) => r.status === "missing" && r.value === null));
  }
  const nan = records(new Map([["missing_parts", { value: Number.NaN, sample: 20 }]]), manifest, RUN, NOW);
  assert.equal(nan.find((r) => r.id === "missing_parts")?.status, "missing");
});

test("scored by core: nothing in scope is 0, a failed read is 0, every goal met is exactly 100", () => {
  const at = new Date(NOW);
  const empty = scorePage("issues", signed, records(readings([], cfg, NOW, new Map()).values, manifest, RUN, NOW), at);
  for (const id of ["missing_parts", "unranked", "closed_by_hand", "stale"]) assert.deepEqual(empty.metrics.find((m) => m.id === id), { id, score: 0, reading: "too_few_samples" });
  assert.equal(scorePage("issues", signed, allMissing(manifest), at).total, 0);
  const goals = new Map(manifest.metrics.map((d) => [d.id, { value: d.goal, sample: d.min_samples }]));
  assert.equal(scorePage("issues", signed, records(goals, manifest, RUN, NOW), at).total, 100);
  assert.equal(scorePage("issues", signed, records(goals, manifest, RUN, NOW), at).consumption, 100, "lane_minutes at goal too");
});

test("type, close target, reopened, unused labels and the launch milestone", () => {
  const typed = { type: { name: "Bug" } };
  const launch = { milestone: { title: cfg.launch_milestone } };
  const all = [
    issue(1, { ...typed, labels: [{ name: "P1" }], created_at: daysAgo(31) }),
    issue(2, { ...typed, labels: [{ name: "P3" }], created_at: daysAgo(31), ...launch }),
    issue(3, { created_at: daysAgo(29), ...launch }),
    done(4, launch),
  ];
  const repo = { reopened: new Set([3, 4]), labelUses: [0, 5, 0, 2], milestones: [cfg.launch_milestone] };
  const v = readings(all, cfg, NOW, new Map([[4, true]]), repo).values;
  assert.deepEqual(v.get("untyped"), { value: 1, sample: 4 });
  // #1 is past P1's 30 days; #2 is inside P3's 90; #3 has no rank, so P1's, and is inside it.
  assert.deepEqual(v.get("overdue"), { value: 1, sample: 4 });
  // #4 was reopened but is closed again: only open ones count.
  assert.deepEqual(v.get("reopened"), { value: 1, sample: 4 });
  assert.deepEqual(v.get("unused_labels"), { value: 2, sample: 4 });
  assert.deepEqual(v.get("launch_open"), { value: 2, sample: 4 });
  // No launch milestone, or no repo read: unmeasured, never a good 0.
  assert.equal(readings(all, cfg, NOW, new Map([[4, true]]), { ...repo, milestones: ["Other"] }).values.get("launch_open")?.value, null);
  for (const id of ["reopened", "unused_labels", "launch_open"]) assert.equal(readings(all, cfg, NOW, new Map([[4, true]])).values.get(id)?.value, null, id);
});

test("label uses: numbers only, and a partial or paged read is an error", () => {
  const node = (i: number, p: number) => ({ issues: { totalCount: i }, pullRequests: { totalCount: p } });
  assert.deepEqual(labelUses({ labels: { pageInfo: { hasNextPage: false }, nodes: [node(0, 0), node(2, 3)] } }), [0, 5]);
  assert.throws(() => labelUses({ labels: { pageInfo: { hasNextPage: true }, nodes: [] } }), CollectError);
  assert.throws(() => labelUses({ labels: { pageInfo: { hasNextPage: false }, nodes: [{ issues: {} }] } }), CollectError);
  assert.match(reopenedQuery([7]), /i7: issue\(number: 7\) \{ timelineItems\(itemTypes: \[REOPENED_EVENT\]\) \{ totalCount \} \}/);
  assert.throws(() => reopenedQuery([0]), CollectError);
});
