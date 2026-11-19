// The collector end to end against an invented, in-memory API.
import assert from "node:assert/strict";
import { test } from "node:test";
import { collect, reusable } from "../src/collect.ts";
import { FACTS_VERSION } from "../src/facts.ts";
import { type Getter, NotFound, fetchGetter, ghFailure, rateLimited, reason } from "../src/github.ts";

const REPO = "example-org/example-repo";
const NOW = new Date("2030-03-01T00:00:00Z");
const b64 = (s: string) => Buffer.from(s).toString("base64");
// No earlier merge falls within 7 days of #2, so git is never called.
const OPTS = { git: "/nonexistent", hasCommit: () => true };

const TEMPLATE = "## What\n## Why\n## Checklist\n- [ ] One\n- [ ] No secrets\n";
const BODY = "## What\nA.\n## Why\nB.\n## Checklist\n- [x] One\n- [x] No secrets\n";

// A head as GitHub gives it, so a verdict can name one.
const head = (n: number) => String(n).repeat(40);

function pull(n: number, merged: string | null, closed: string | null = merged, base = "main") {
  return {
    number: n,
    title: `Change ${n}`,
    body: BODY,
    created_at: "2030-02-27T10:00:00Z",
    updated_at: closed ?? "2030-02-27T10:00:00Z",
    closed_at: closed,
    merged_at: merged,
    merge_commit_sha: merged ? `m${n}` : null,
    draft: false,
    user: { type: "User" },
    base: { ref: base, sha: "b0" },
    head: { ref: `claude/change-${n}`, sha: head(n) },
  };
}

const REVIEW_JOB = {
  name: "claude-review",
  run_attempt: 1,
  conclusion: "success",
  completed_at: "2030-02-27T10:02:03Z",
  steps: [
    { name: "Review", conclusion: "success" },
    { name: "Verdict", conclusion: "success" },
  ],
};

const QUEUE = "gh-readonly-queue/main/pr-2-h2";
const QUEUE_RUNS = [
  { id: 20, run_attempt: 1, status: "completed", conclusion: "success", head_branch: QUEUE, created_at: "2030-02-27T10:12:30Z" },
  { id: 21, run_attempt: 1, status: "completed", conclusion: "skipped", head_branch: QUEUE, created_at: "2030-02-27T10:12:30Z" },
  { id: 22, run_attempt: 1, status: "in_progress", conclusion: null, head_branch: QUEUE, created_at: "2030-02-27T10:12:30Z" },
];

function api(calls: string[], failOn?: string, absent: string[] = []): Getter {
  const R = `repos/${REPO}`;
  const routes: Record<string, unknown> = {
    [`${R}/contents/.github/pull_request_template.md`]: { encoding: "base64", content: b64(TEMPLATE) },
    [`${R}/contents/.gitattributes`]: { encoding: "base64", content: b64("* text=auto\n") },
    [`${R}/pulls`]: [pull(2, "2030-02-27T10:20:00Z"), pull(3, null, "2030-02-27T11:00:00Z"), pull(1, "2010-01-01T00:00:00Z")],
    [`${R}/pulls/2/files`]: [{ filename: "a.ts", additions: 3, deletions: 1, patch: "@@\n+export const a = 1;\n" }],
    [`${R}/pulls/3/files`]: [{ filename: "b.ts", additions: 1, deletions: 0 }],
    [`${R}/pulls/9/files`]: [{ filename: "quality-speed/pages/x/a.ts", additions: 1, deletions: 0 }],
    // As GitHub lists it: merged first, its removal in the same second, then queued again after the merge.
    [`${R}/issues/2/timeline`]: [
      { event: "added_to_merge_queue", created_at: "2030-02-27T10:12:00Z" },
      { event: "merged", created_at: "2030-02-27T10:20:00Z" },
      { event: "removed_from_merge_queue", created_at: "2030-02-27T10:20:00Z" },
      { event: "added_to_merge_queue", created_at: "2030-02-27T10:20:01Z" },
      { event: "removed_from_merge_queue", created_at: "2030-02-27T10:20:26Z" },
    ],
    [`${R}/issues/3/timeline`]: [],
    [`${R}/issues/9/timeline`]: [{ event: "ready_for_review", created_at: "2030-02-28T10:00:00Z" }],
    [`${R}/pulls/2/comments`]: [],
    [`${R}/issues/2/comments`]: [{ body: `Review: MERGE at ${head(2)}\nTokens: 1200`, user: { type: "User" }, author_association: "MEMBER" }],
    [`${R}/issues/3/comments`]: [],
    [`${R}/pulls/3/comments`]: [{ body: "Blocking: a secret", user: { type: "Bot" } }],
    [`${R}/pulls/2/commits`]: [{ commit: { message: "x" } }],
    [`${R}/pulls/3/commits`]: [{ commit: { message: "y" } }],
    [`${R}/actions/runs`]: {
      workflow_runs: [
        { id: 10, path: ".github/workflows/claude-review.yml", head_sha: head(2), run_attempt: 1, conclusion: "success", created_at: "2030-02-27T10:00:03Z" },
        { id: 11, path: ".github/workflows/ci.yml", head_sha: head(2), run_attempt: 2, conclusion: "success", created_at: "2030-02-27T10:00:03Z" },
        { id: 12, path: ".github/workflows/dco.yml", head_sha: head(2), run_attempt: 1, conclusion: "success", created_at: "2030-02-27T10:00:03Z" },
      ],
    },
    [`${R}/actions/runs/11/attempts/1`]: { conclusion: "failure" },
    [`${R}/actions/runs/10/jobs`]: { jobs: [REVIEW_JOB] },
    [`${R}/actions/runs/20/jobs`]: {
      jobs: [
        { name: "checks", conclusion: "success", started_at: "2030-02-27T10:13:00Z", completed_at: "2030-02-27T10:14:30Z" },
        { name: "ci-ok", conclusion: "success", started_at: "2030-02-27T10:14:31Z", completed_at: "2030-02-27T10:14:40Z" },
        { name: "swift", conclusion: "skipped", started_at: "2030-02-27T10:14:41Z", completed_at: "2030-02-27T10:14:30Z" },
      ],
    },
    [`${R}/actions/workflows/claude-review.yml/runs`]: { workflow_runs: [{ run_number: 7 }, { run_number: 5 }, { run_number: 4 }] },
    [`${R}/actions/workflows/ci.yml/runs`]: { workflow_runs: [{ run_number: 3 }, { run_number: 1 }] },
    [`${R}/actions/workflows/dco.yml/runs`]: { workflow_runs: [] },
  };
  return async (path: string) => {
    calls.push(path);
    const bare = path.split("?")[0] ?? path;
    if (failOn && bare === failOn) throw new Error(`GET ${bare}: HTTP 500`);
    if (absent.includes(bare)) throw new NotFound(bare);
    if (bare === `${R}/pulls` && path.includes("state=open")) return path.includes("page=1") || !path.includes("page=") ? [pull(9, null, null)] : [];
    if (bare === `${R}/activity`) {
      if (!path.includes("ref=refs/heads/main")) throw new Error("activity must be read for main");
      return path.includes("activity_type=force_push")
        ? [{ after: "f1", timestamp: "2030-02-28T08:00:00Z" }, { after: "old", timestamp: "2020-01-01T00:00:00Z" }]
        : [];
    }
    if (bare === `${R}/actions/runs` && path.includes("event=merge_group")) {
      if (path.includes("page=") && !path.includes("page=1&") && !path.endsWith("page=1")) return { workflow_runs: [] };
      return { workflow_runs: path.includes("created=2030-02-27T00:00:00Z..2030-02-27T23:59:59Z") ? QUEUE_RUNS : [] };
    }
    if (!(bare in routes)) throw new Error(`unexpected ${bare}`);
    const page = /[?&]page=(\d+)/.exec(path);
    if (page && Number(page[1]) > 1) return Array.isArray(routes[bare]) ? [] : { workflow_runs: [], jobs: [] };
    return routes[bare];
  };
}

test("collect: merged and closed pull requests in range, open ones, and direct pushes", async () => {
  const calls: string[] = [];
  const out = await collect(api(calls), REPO, NOW, OPTS);
  assert.deepEqual(out.pulls.map((f) => [f.number, f.state]), [[2, "merged"], [3, "closed"]]);
  const f = out.pulls[0]!;
  assert.deepEqual(f.gate_misses, []);
  assert.equal(f.ci_green_first_time, false, "CI passed only on a rerun");
  assert.equal(f.template_complete, true);
  assert.equal(f.open_minutes, 20);
  assert.deepEqual(f.review_result_minutes, [2]);
  assert.deepEqual([f.verdicts, f.review_tokens, f.ci_heads], [1, [1200], 1]);
  assert.equal(out.pulls[1]!.drew_blocking, true);
  assert.deepEqual(out.open, [{ number: 9, created_at: "2030-02-27T10:00:00Z", ever_ready: true, excluded: "site_only" }]);
  assert.deepEqual(out.direct_pushes, [{ sha: "f1", at: "2030-02-28T08:00:00Z" }]);
  assert.deepEqual(out.deleted_runs, [
    { workflow: "ci", run_number: 2 },
    { workflow: "review", run_number: 6 },
  ]);
  assert.ok(calls.some((c) => c.includes("branch=claude%2Fchange-2") && c.includes("event=pull_request")));
  assert.ok(calls.some((c) => c.includes("contents/.github/pull_request_template.md?ref=b0")), "rules at the base commit");
  assert.ok(calls.some((c) => c.includes("jobs?filter=all")), "every attempt of the review");
});

test("collect: a gate workflow the repository does not have has no deleted runs; another failure on it still throws", async () => {
  const R = `repos/${REPO}`;
  const out = await collect(api([], undefined, [`${R}/actions/workflows/claude-review.yml/runs`]), REPO, NOW, OPTS);
  assert.deepEqual(out.deleted_runs, [{ workflow: "ci", run_number: 2 }]);
  await assert.rejects(collect(api([], `${R}/actions/workflows/claude-review.yml/runs`), REPO, NOW, OPTS));
});

test("collect: a failed read throws, so the run writes every metric missing", async () => {
  await assert.rejects(collect(api([], `repos/${REPO}/pulls/2/comments`), REPO, NOW, OPTS));
  await assert.rejects(collect(api([], `repos/${REPO}/issues/2/comments`), REPO, NOW, OPTS));
});

test("collect: a base with no template or .gitattributes leaves only template_complete unread", async () => {
  const R = `repos/${REPO}`;
  const out = await collect(api([], undefined, [`${R}/contents/.github/pull_request_template.md`, `${R}/contents/.gitattributes`]), REPO, NOW, OPTS);
  const f = out.pulls[0]!;
  assert.equal(f.template_complete, null, "nothing to complete, so not counted");
  assert.equal(f.ci_green_first_time, false, "every other fact still reads");
  await assert.rejects(collect(api([], `${R}/contents/.github/pull_request_template.md`), REPO, NOW, OPTS), "any other failure still fails the run");
});

test("collect: a merge missing from the clone is left for the next run if recent, an error if not", async () => {
  const recent = new Date("2030-02-27T10:30:00Z");
  const out = await collect(api([]), REPO, recent, { ...OPTS, hasCommit: () => false });
  assert.deepEqual(out.pulls.map((f) => f.number), [], "merged 10 minutes before");
  await assert.rejects(collect(api([]), REPO, NOW, { ...OPTS, hasCommit: () => false }));
});

test("collect: a merge git cannot read counts every earlier merge in its window as reworked", async () => {
  const R = `repos/${REPO}`;
  const two = pull(2, "2030-02-27T10:20:00Z");
  const four = pull(4, "2030-02-26T10:00:00Z");
  const extra: Record<string, unknown> = {
    [`${R}/pulls/4/files`]: [{ filename: "a.ts", additions: 1, deletions: 0 }],
    [`${R}/issues/4/timeline`]: [],
    [`${R}/pulls/4/comments`]: [],
    [`${R}/issues/4/comments`]: [],
    [`${R}/pulls/4/commits`]: [],
  };
  const get = api([]);
  const out = await collect(
    async (path: string) => {
      const bare = path.split("?")[0] ?? path;
      if (bare === `${R}/pulls` && path.includes("state=closed")) return [two, four];
      return bare in extra ? extra[bare] : get(path);
    },
    REPO,
    NOW,
    OPTS,
  );
  // git at /nonexistent cannot read #2's merge, so #4, merged a day before, counts as reworked.
  const f = out.pulls.find((p) => p.number === 2)!;
  assert.deepEqual(f.fixes, [4]);
  assert.equal(f.rework_unknown, true);
});

test("collect: facts from an earlier run are reused, not read again", async () => {
  const first = await collect(api([]), REPO, NOW, OPTS);
  const calls: string[] = [];
  const again = await collect(api(calls), REPO, NOW, { ...OPTS, prev: first });
  assert.deepEqual(again, first);
  assert.equal(calls.some((c) => c.includes("/pulls/2/comments") || c.includes("/issues/3/")), false);
});

test("collect: a run stopped part way keeps what it read, and the next run reads only the rest", async () => {
  const first = await collect(api([]), REPO, NOW, OPTS);
  const progress = { pulls: [] as typeof first.pulls, queue_runs: [] as typeof first.queue_runs };
  await assert.rejects(collect(api([], `repos/${REPO}/activity`), REPO, NOW, { ...OPTS, progress }));
  assert.deepEqual([...progress.pulls].sort((a, b) => a.number - b.number), first.pulls);
  const calls: string[] = [];
  const again = await collect(api(calls), REPO, NOW, { ...OPTS, prev: progress });
  assert.deepEqual(again, first);
  assert.equal(calls.some((c) => c.includes("/pulls/2/comments")), false);
});

test("rate limited: a 403 or 429 GitHub marks as one, never another refusal", () => {
  assert.equal(rateLimited(403, new Headers({ "x-ratelimit-remaining": "0" }), ""), true);
  assert.equal(rateLimited(403, new Headers(), '{"message":"You have exceeded a secondary rate limit."}'), true);
  assert.equal(rateLimited(429, new Headers({ "retry-after": "60" }), ""), true);
  assert.equal(rateLimited(403, new Headers({ "x-ratelimit-remaining": "812" }), '{"message":"Resource not accessible by integration"}'), false);
  assert.equal(rateLimited(404, new Headers({ "x-ratelimit-remaining": "0" }), ""), false);
  assert.equal(rateLimited(403, new Headers(), '{"message":"You have triggered an abuse detection mechanism."}'), true);
});

test("reason: GitHub's message in plain characters, or nothing", () => {
  assert.equal(reason('{"message":"Resource not accessible by integration"}'), ", Resource not accessible by integration");
  assert.equal(reason('{"message":"<b>x</b> `y`"}'), ", bxb y");
  assert.equal(reason(`{"message":"${"a".repeat(150)}"}`), `, ${"a".repeat(100)}`);
  assert.equal(reason("not json"), "");
  assert.equal(reason('{"message":7}'), "");
});

test("reusable: only the same facts version", async () => {
  const first = await collect(api([]), REPO, NOW, OPTS);
  assert.equal(reusable(first).size, 2);
  assert.equal(reusable({ pulls: [{ ...first.pulls[0]!, v: FACTS_VERSION + 1 }] }).size, 0);
  assert.equal(reusable("not facts").size, 0);
  assert.equal(reusable(null).size, 0);
});

test("collect: merge queue facts from the timeline, and merge_group runs a day at a time with their job minutes", async () => {
  const calls: string[] = [];
  const out = await collect(api(calls), REPO, NOW, OPTS);
  const f = out.pulls[0]!;
  assert.equal(f.queue_ejected, false);
  // Added 10:12:00, merged 10:20:00; the re-queue after the merge counts neither way.
  assert.equal(f.queue_minutes, 8);
  assert.deepEqual(out.queue_runs, [
    // 1.5 minutes rounds up to 2, 9 seconds to 1; the skipped job counts 0.
    { id: 20, run_attempt: 1, pull: 2, created_at: "2030-02-27T10:12:30Z", minutes: 3 },
    { id: 21, run_attempt: 1, pull: 2, created_at: "2030-02-27T10:12:30Z", minutes: 0 },
  ]);
  assert.equal(calls.filter((c) => c.includes("event=merge_group")).length, 28, "one query a day for 28 days");
  assert.equal(calls.some((c) => c.includes("runs/21/jobs")), false, "a skipped run ran no job");
  assert.equal(calls.some((c) => c.includes("runs/22/jobs")), false, "an unfinished run waits for the next read");
  const again: string[] = [];
  assert.deepEqual((await collect(api(again), REPO, NOW, { ...OPTS, prev: out })).queue_runs, out.queue_runs);
  assert.equal(again.some((c) => c.includes("runs/20/jobs")), false, "a run already read is reused");
});

test("collect: a day with more merge_group runs than one query lists throws, never reads short", async () => {
  const get = api([]);
  const full = Array.from({ length: 100 }, (_, i) => ({ ...QUEUE_RUNS[1]!, id: 1000 + i }));
  const busy: Getter = async (path) => {
    if (!path.includes("event=merge_group")) return get(path);
    const page = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? 1);
    return { workflow_runs: page <= 10 ? full.map((r) => ({ ...r, id: r.id + page * 100 })) : [] };
  };
  await assert.rejects(collect(busy, REPO, NOW, OPTS), /a day holds more than one query lists/);
});

test("an HTTP 404 becomes NotFound in both getters; other failures stay plain errors", async () => {
  const realFetch = globalThis.fetch;
  try {
    for (const [status, body] of [[404, '{"message":"Not Found"}'], [500, "{}"]] as const) {
      globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch;
      const read = fetchGetter("token")("repos/o/r/contents/.github/pull_request_template.md?ref=abc");
      if (status === 404) await assert.rejects(read, (e: unknown) => e instanceof NotFound && !String(e).includes("ref="));
      else await assert.rejects(read, (e: unknown) => !(e instanceof NotFound));
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(ghFailure("repos/o/r/contents/x?ref=abc", "gh: Not Found (HTTP 404)") instanceof NotFound);
  assert.ok(!(ghFailure("repos/o/r/contents/x", "gh: Server Error (HTTP 500)") instanceof NotFound));
});
