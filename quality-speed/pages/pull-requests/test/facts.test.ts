// Invented pull requests only: numbers, branches and text are made up here.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CI_WORKFLOW,
  DCO_WORKFLOW,
  type PullInput,
  REVIEW_TIMEOUT_MINUTES,
  REVIEW_WORKFLOW,
  type RawJob,
  type RawRun,
  type Rules,
  isGenerated,
  isSite,
  jobMinutes,
  parseGitattributes,
  parseTemplate,
  pullFacts,
  queueFacts,
  queuePull,
  readyAt,
  reviewAttempts,
  revertedShas,
  templateComplete,
} from "../src/facts.ts";

const TEMPLATE = [
  "## What",
  "<!-- one line -->",
  "## Why",
  "## How it was verified",
  "## Checklist",
  "- [ ] Areas",
  "- [ ] D1 migration?",
  "- [ ] No secrets",
].join("\n");

const t = parseTemplate(TEMPLATE);
const RULES: Rules = {
  templateHeadings: t.headings,
  templateBoxes: t.boxes,
  templateAttestations: t.attestations,
  hasTemplate: true,
  generated: ["web/package-lock.json", "*.riv"],
};

const GOOD_BODY = [
  "## What",
  "Adds a widget.",
  "## Why",
  "Fixes #7.",
  "## How it was verified",
  "node --test",
  "## Checklist",
  "- [x] Areas: web",
  "- [ ] D1 migration? No",
  "- [x] No secrets",
].join("\n");

function job(review: string | null, verdict: string | null, conclusion: string, attempt = 1, completed = "2030-01-01T10:12:00Z"): RawJob {
  const steps = [{ name: "Private HOME", conclusion: "success" }];
  if (review !== null) steps.push({ name: "Review", conclusion: review });
  if (verdict !== null) steps.push({ name: "Verdict", conclusion: verdict });
  return { name: "claude-review", run_attempt: attempt, conclusion, completed_at: completed, steps };
}
const PASS = () => [job("success", "success", "success")];
const SKIPPED = () => [{ name: "claude-review", run_attempt: 1, conclusion: "skipped", completed_at: "2030-01-01T10:00:05Z", steps: [] }];
const BLOCKED = () => [job("success", "failure", "failure")];

// Heads as GitHub gives them, so a verdict can name one.
const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const verdictComment = (kind: "MERGE" | "BLOCK", sha: string) => ({ body: `Review: ${kind} at ${sha}`, user: { type: "User" }, author_association: "MEMBER" });

function run(id: number, path: string, sha: string, created: string, conclusion: string, attempt = 1): RawRun {
  return { id, path, head_sha: sha, run_attempt: attempt, conclusion, created_at: created };
}

function input(over: Partial<PullInput> = {}): PullInput {
  return {
    pull: {
      number: 12,
      title: "Widget",
      body: GOOD_BODY,
      created_at: "2030-01-01T10:00:00Z",
      closed_at: "2030-01-01T10:30:00Z",
      merged_at: "2030-01-01T10:30:00Z",
      merge_commit_sha: "abcdef1234567890",
      draft: false,
      user: { type: "User" },
      base: { ref: "main", sha: "base1" },
      head: { ref: "claude/widget", sha: H2 },
    },
    files: [
      { filename: "web/src/widget.ts", additions: 30, deletions: 5 },
      { filename: "web/package-lock.json", additions: 900, deletions: 900 },
    ],
    timeline: [],
    reviewComments: [],
    commits: [{ commit: { message: "Widget\n\nSigned-off-by: someone" } }],
    runs: [
      run(1, REVIEW_WORKFLOW, H1, "2030-01-01T10:00:02Z", "success"),
      run(2, CI_WORKFLOW, H1, "2030-01-01T10:00:02Z", "success"),
      run(3, DCO_WORKFLOW, H1, "2030-01-01T10:00:02Z", "success"),
      run(4, REVIEW_WORKFLOW, H2, "2030-01-01T10:10:00Z", "success"),
      run(5, CI_WORKFLOW, H2, "2030-01-01T10:10:00Z", "success"),
      run(6, DCO_WORKFLOW, H2, "2030-01-01T10:10:00Z", "success"),
    ],
    firstAttempt: {},
    reviewJobs: { 1: PASS(), 4: PASS() },
    rules: RULES,
    blockingSameChange: false,
    fixes: [],
    reworkUnknown: false,
    editedAfterReview: false,
    issueComments: [verdictComment("MERGE", H2)],
    stackBase: false,
    ...over,
  };
}

test("template: headings, checklist lines and attestations", () => {
  assert.deepEqual(t.headings, ["What", "Why", "How it was verified", "Checklist"]);
  assert.equal(t.boxes, 3);
  assert.equal(t.attestations, 1);
});

test("template complete: all sections filled, an unticked answer allowed", () => {
  assert.equal(templateComplete(GOOD_BODY, RULES), true);
});

test("template incomplete: missing heading, empty or comment-only section, missing lines, unticked attestation", () => {
  assert.equal(templateComplete(GOOD_BODY.replace("## Why", "## Reason"), RULES), false);
  assert.equal(templateComplete(GOOD_BODY.replace("node --test", ""), RULES), false);
  assert.equal(templateComplete(GOOD_BODY.replace("node --test", "<!-- commands -->"), RULES), false);
  assert.equal(templateComplete(GOOD_BODY.replace("- [x] Areas: web\n", ""), RULES), false);
  assert.equal(templateComplete(GOOD_BODY.replace("- [x] No secrets", "- [ ] No secrets"), RULES), false);
  assert.equal(templateComplete(null, RULES), false);
});

test("table template: each row's first cell is a section, filled when another cell has text", () => {
  const tt = parseTemplate(["| | |", "|---|---|", "| What | <!-- one line --> |", "| Why | <!-- goal --> |", "", "- [ ] No secrets"].join("\n"));
  assert.deepEqual(tt.headings, ["What", "Why"]);
  const rules: Rules = { templateHeadings: tt.headings, templateBoxes: tt.boxes, templateAttestations: tt.attestations, hasTemplate: true, generated: [] };
  const body = ["| | |", "|---|---|", "| What | Adds a widget. |", "| Why | Fixes #7. |", "", "- [x] No secrets"].join("\n");
  assert.equal(templateComplete(body, rules), true);
  assert.equal(templateComplete(body.replace("Fixes #7.", "<!-- goal -->"), rules), false);
  assert.equal(templateComplete(body.replace("| Why | Fixes #7. |\n", ""), rules), false);
});

test("generated files: lock files, exact paths, globs with and without a slash", () => {
  const rules = parseGitattributes("* text=auto\n# c\nweb/a.d.ts linguist-generated=true -diff\n*.riv binary\ngen/** linguist-generated\n");
  assert.deepEqual(rules, ["web/a.d.ts", "gen/**"]);
  assert.equal(isGenerated("web/a.d.ts", rules), true);
  assert.equal(isGenerated("gen/x/y.ts", rules), true);
  assert.equal(isGenerated("src/gen/y.ts", rules), false);
  assert.equal(isGenerated("Package.resolved", rules), true);
  assert.equal(isGenerated("web/node/yarn.lock", rules), true);
  assert.equal(isGenerated("web/b.ts", rules), false);
  assert.equal(isGenerated("x/anim.riv", ["*.riv"]), true);
});

test("reverted commit ids come from commit messages", () => {
  assert.deepEqual(revertedShas([{ commit: { message: 'Revert "x"\n\nThis reverts commit abc1234def.' } }]), ["abc1234def"]);
});

test("ready_at: created_at if opened ready, first ready_for_review if opened as a draft, null if never ready", () => {
  const pull = input().pull;
  assert.equal(readyAt(pull, []), pull.created_at);
  assert.equal(readyAt(pull, [{ event: "ready_for_review", created_at: "2030-01-01T10:05:00Z" }]), "2030-01-01T10:05:00Z");
  assert.equal(readyAt(pull, [{ event: "convert_to_draft", created_at: "2030-01-01T10:02:00Z" }]), pull.created_at);
  assert.equal(readyAt({ ...pull, draft: true }, []), null);
});

test("review attempts: a skipped job never ran, though GitHub reports it as passing", () => {
  assert.deepEqual(reviewAttempts(SKIPPED()).map((a) => [a.ran, a.verdict]), [[false, "none"]]);
  assert.deepEqual(reviewAttempts(PASS()).map((a) => a.verdict), ["pass"]);
  assert.deepEqual(reviewAttempts(BLOCKED()).map((a) => a.verdict), ["blocking"]);
  assert.deepEqual(reviewAttempts([job("failure", "skipped", "failure")]).map((a) => [a.ran, a.verdict]), [[true, "none"]], "a crash has no verdict");
  assert.deepEqual(reviewAttempts([job("success", null, "success")]).map((a) => a.verdict), ["none"], "a renamed step fails closed");
  assert.deepEqual(reviewAttempts(undefined), []);
});

test("facts: a clean pull request", () => {
  const f = pullFacts(input());
  assert.equal(f.state, "merged");
  assert.equal(f.excluded, null);
  assert.equal(f.size_lines, 35, "lock file left out");
  assert.deepEqual(f.gate_misses, []);
  assert.equal(f.ci_green_first_time, true);
  assert.equal(f.drew_blocking, false);
  assert.equal(f.template_complete, true);
  assert.equal(f.edit_checked, true);
  assert.equal(f.open_minutes, 30);
  // Run 1 is superseded only if cancelled; both finish at 10:12:00.
  assert.deepEqual(f.review_result_minutes, [718 / 60, 2]);
  assert.equal(JSON.stringify(f).includes("widget"), false, "no file or branch names in facts");
});

test("gate: no MERGE verdict on the merged head is a miss; one on an earlier head does not cover it", () => {
  assert.deepEqual(pullFacts(input({ issueComments: [] })).gate_misses, ["review_not_run"]);
  assert.deepEqual(pullFacts(input({ issueComments: [verdictComment("MERGE", H1)] })).gate_misses, ["review_not_run"]);
  const bot = { ...verdictComment("MERGE", H2), user: { type: "Bot" } };
  assert.deepEqual(pullFacts(input({ issueComments: [bot] })).gate_misses, ["review_not_run"], "a bot can't post one");
});

test("gate: a BLOCK verdict on the merged head is a miss, even beside a MERGE", () => {
  const f = pullFacts(input({ issueComments: [verdictComment("BLOCK", H2), verdictComment("MERGE", H2)] }));
  assert.deepEqual(f.gate_misses, ["blocking_verdict"]);
  assert.equal(f.drew_blocking, true);
});

test("gate: red CI or red DCO are misses", () => {
  const ci = input();
  ci.runs[4] = run(5, CI_WORKFLOW, H2, "2030-01-01T10:10:00Z", "failure");
  assert.deepEqual(pullFacts(ci).gate_misses, ["ci_not_green"]);
  const dco = input();
  dco.runs[5] = run(6, DCO_WORKFLOW, H2, "2030-01-01T10:10:00Z", "skipped");
  assert.deepEqual(pullFacts(dco).gate_misses, ["dco_not_green"]);
});

test("gate: a CI rerun that passed on the merged head is green", () => {
  const i = input();
  i.runs[4] = run(5, CI_WORKFLOW, H2, "2030-01-01T10:10:00Z", "success", 2);
  assert.deepEqual(pullFacts(i).gate_misses, []);
});

test("first time: CI failing first, passing on rerun, is not first-pass", () => {
  const i = input();
  i.runs[1] = run(2, CI_WORKFLOW, H1, "2030-01-01T10:00:02Z", "success", 2);
  i.firstAttempt = { 2: "failure" };
  assert.equal(pullFacts(i).ci_green_first_time, false);
});

test("first time: a cancelled CI on the first head is not first-pass", () => {
  const i = input();
  i.runs[1] = run(2, CI_WORKFLOW, H1, "2030-01-01T10:00:02Z", "cancelled");
  assert.equal(pullFacts(i).ci_green_first_time, false);
});

test("first time: measured at ready for review, not on draft pushes", () => {
  const i = input();
  i.timeline = [{ event: "ready_for_review", created_at: "2030-01-01T10:09:59Z" }];
  i.runs[1] = run(2, CI_WORKFLOW, H1, "2030-01-01T10:00:02Z", "failure");
  assert.equal(pullFacts(i).ci_green_first_time, true);
});

test("first time: DCO skipped passes only for a bot; a bot has no template", () => {
  const i = input();
  i.runs[2] = run(3, DCO_WORKFLOW, H1, "2030-01-01T10:00:02Z", "skipped");
  assert.equal(pullFacts(i).ci_green_first_time, false);
  i.pull.user = { type: "Bot" };
  const f = pullFacts(i);
  assert.equal(f.ci_green_first_time, true);
  assert.equal(f.template_complete, null);
});

test("blocking: a bot's inline Blocking comment or a Blocking verdict; a person's comment does not count", () => {
  const comment = pullFacts(input({ reviewComments: [{ body: "**Blocking:** weaker check", user: { type: "Bot" } }] }));
  assert.equal(comment.drew_blocking, true);
  const person = pullFacts(input({ reviewComments: [{ body: "Blocking: I disagree", user: { type: "User" } }] }));
  assert.equal(person.drew_blocking, false);
  const verdict = pullFacts(input({ reviewJobs: { 1: BLOCKED(), 4: PASS() } }));
  assert.equal(verdict.drew_blocking, true, "a summary-only finding still shows as a Blocking verdict");
  assert.deepEqual(verdict.gate_misses, [], "fixed before the merged head");
  const earlier = pullFacts(input({ issueComments: [verdictComment("BLOCK", H1), verdictComment("MERGE", H2)] }));
  assert.deepEqual([earlier.drew_blocking, earlier.gate_misses], [true, []], "a BLOCK verdict fixed before the merged head");
  const rerun = pullFacts(input({ reviewJobs: { 1: BLOCKED(), 4: PASS() }, blockingSameChange: true }));
  assert.deepEqual(rerun.gate_misses, ["blocking_verdict"], "the same change on a new head (an empty commit) is still blocked");
});

test("review time: a crash or a timeout counts as the timeout; a superseded cancel is left out", () => {
  const crash = pullFacts(input({ reviewJobs: { 1: [job("failure", "skipped", "failure")], 4: PASS() } }));
  assert.deepEqual(crash.review_result_minutes, [REVIEW_TIMEOUT_MINUTES, 2]);
  const i = input({ reviewJobs: { 1: [job("success", null, "cancelled", 1, "2030-01-01T10:11:00Z")], 4: PASS() } });
  i.runs[0] = run(1, REVIEW_WORKFLOW, H1, "2030-01-01T10:00:02Z", "cancelled");
  assert.deepEqual(pullFacts(i).review_result_minutes, [2], "run 4 started before run 1 was cancelled");
  const timeout = input({ reviewJobs: { 1: [job("success", null, "cancelled", 1, "2030-01-01T10:05:00Z")], 4: PASS() } });
  timeout.runs[0] = run(1, REVIEW_WORKFLOW, H1, "2030-01-01T10:00:02Z", "cancelled");
  assert.deepEqual(pullFacts(timeout).review_result_minutes, [REVIEW_TIMEOUT_MINUTES, 2], "cancelled with no newer run");
  const skipped = pullFacts(input({ reviewJobs: { 1: SKIPPED(), 4: PASS() } }));
  assert.deepEqual(skipped.review_result_minutes, [2]);
});

test("template: an edit after the review read it fails it; an unchecked body is flagged", () => {
  assert.equal(pullFacts(input({ editedAfterReview: true })).template_complete, false);
  const unchecked = pullFacts(input({ editedAfterReview: null }));
  assert.equal(unchecked.edit_checked, false);
});

test("exclusions: another base branch; only this site's files; one site file among others still counts", () => {
  const other = input();
  other.pull.base.ref = "release/x";
  assert.equal(pullFacts(other).excluded, "base_not_main");
  const site = input({ files: [{ filename: "quality-speed/pages/x/a.ts", additions: 1, deletions: 0 }, { filename: ".github/workflows/quality-speed.yml", additions: 1, deletions: 0 }] });
  assert.equal(pullFacts(site).excluded, "site_only");
  const mixed = input();
  mixed.files.push({ filename: "quality-speed/pages/x/a.ts", additions: 500, deletions: 0 });
  assert.equal(pullFacts(mixed).excluded, null);
  assert.equal(pullFacts(mixed).size_lines, 35, "the site's own lines never count toward size");
});

test("every site workflow is this site's own: a pull request of only quality-speed-screens.yml is left out, and its lines never count", () => {
  const screens = { filename: ".github/workflows/quality-speed-screens.yml", additions: 40, deletions: 2 };
  assert.equal(pullFacts(input({ files: [screens] })).excluded, "site_only");
  const mixed = input();
  mixed.files.push(screens);
  assert.equal(pullFacts(mixed).size_lines, 35, "a site workflow's lines never count toward size");
  // Rework skips the same files: isSite() is its test too (src/rework.ts).
  for (const f of [".github/workflows/quality-speed.yml", ".github/workflows/quality-speed-screens.yml"]) assert.equal(isSite(f), true, f);
  for (const f of [".github/workflows/ci.yml", ".github/workflows/quality-speedy.yaml", "quality-speed.yml"]) assert.equal(isSite(f), false, f);
});

test("closed without merging: no gate, no template, still a submission", () => {
  const i = input();
  i.pull.merged_at = null;
  i.pull.merge_commit_sha = null;
  const f = pullFacts(i);
  assert.equal(f.state, "closed");
  assert.equal(f.gate_misses, null);
  assert.equal(f.template_complete, null);
  assert.equal(f.ci_green_first_time, true);
  assert.equal(f.drew_blocking, false);
  i.pull.draft = true;
  assert.equal(pullFacts(i).ready_at, null, "a draft never marked ready");
  i.pull.closed_at = null;
  assert.throws(() => pullFacts(i), "an open pull request is refused");
});

test("fixes: kept for merges only, sorted", () => {
  assert.deepEqual(pullFacts(input({ fixes: [9, 3] })).fixes, [3, 9]);
  const closed = input({ fixes: [3] });
  closed.pull.merged_at = null;
  closed.pull.merge_commit_sha = null;
  assert.deepEqual(pullFacts(closed).fixes, []);
});

// The merge queue, on invented timestamps.
const q = (event: string, at: string) => ({ event, created_at: `2030-01-01T${at}Z` });
const at = (t: string) => `2030-01-01T${t}Z`;

test("queue: minutes from the add to the merge; the removal GitHub logs with the merge is not an ejection", () => {
  const t = [q("labeled", "10:00:00"), q("added_to_merge_queue", "10:10:00"), q("removed_from_merge_queue", "10:16:59"), q("merged", "10:17:00")];
  assert.deepEqual(queueFacts(t, at("10:17:00")), { queue_minutes: 6 + 59 / 60, queue_ejected: false });
});

test("queue: merged listed first, its removal in the same second, is a clean merge", () => {
  const t = [q("added_to_merge_queue", "10:00:00"), q("merged", "10:05:00"), q("removed_from_merge_queue", "10:05:00")];
  assert.deepEqual(queueFacts(t, at("10:05:00")), { queue_minutes: 5, queue_ejected: false });
  // A removal logged a few seconds after the merge is the merge too.
  assert.deepEqual(queueFacts([q("added_to_merge_queue", "10:00:00"), q("removed_from_merge_queue", "10:05:20")], at("10:05:00")), {
    queue_minutes: 5,
    queue_ejected: false,
  });
});

test("queue: nothing after the merge counts, such as a re-queue of the merged pull request", () => {
  const t = [
    q("added_to_merge_queue", "10:00:00"),
    q("merged", "10:02:00"),
    q("removed_from_merge_queue", "10:02:00"),
    q("added_to_merge_queue", "10:02:01"),
    q("removed_from_merge_queue", "10:02:26"),
  ];
  assert.deepEqual(queueFacts(t, at("10:02:00")), { queue_minutes: 2, queue_ejected: false });
});

test("queue: an ejection, then a second pass, sums only the time in the queue", () => {
  const t = [
    q("added_to_merge_queue", "10:00:00"),
    q("removed_from_merge_queue", "10:12:00"),
    { event: "committed" },
    q("added_to_merge_queue", "11:00:00"),
    q("merged", "11:04:00"),
    q("removed_from_merge_queue", "11:04:00"),
  ];
  const f = queueFacts(t, at("11:04:00"));
  assert.equal(f.queue_ejected, true);
  assert.ok(Math.abs(f.queue_minutes! - (12 + 4)) < 0.001, `${f.queue_minutes}`);
  // Ejected within a minute of the merge, then queued again: only the last removal can be the merge's.
  const quick = [q("added_to_merge_queue", "10:00:00"), q("removed_from_merge_queue", "10:04:30"), q("added_to_merge_queue", "10:04:40")];
  assert.equal(queueFacts(quick, at("10:05:00")).queue_ejected, true);
});

test("queue: a removal more than a minute before the merge is an ejection; never queued is null; closed unmerged has no minutes", () => {
  const late = [q("added_to_merge_queue", "10:00:00"), q("removed_from_merge_queue", "10:05:00"), q("merged", "10:07:00")];
  assert.equal(queueFacts(late, at("10:07:00")).queue_ejected, true);
  assert.deepEqual(queueFacts([q("merged", "10:00:00")], at("10:00:00")), { queue_minutes: null, queue_ejected: null });
  // Queued only after the merge: never queued.
  assert.deepEqual(queueFacts([q("added_to_merge_queue", "10:01:00"), q("removed_from_merge_queue", "10:01:30")], at("10:00:00")), {
    queue_minutes: null,
    queue_ejected: null,
  });
  assert.deepEqual(queueFacts([q("added_to_merge_queue", "10:00:00"), q("removed_from_merge_queue", "10:03:00")], null), {
    queue_minutes: null,
    queue_ejected: true,
  });
  // Out of order in the list, sorted by time.
  assert.equal(queueFacts([q("removed_from_merge_queue", "10:05:00"), q("added_to_merge_queue", "10:00:00")], at("10:05:01")).queue_minutes, 5);
});

test("queue: pullFacts reads the timeline", () => {
  const f = pullFacts(input({ timeline: [q("added_to_merge_queue", "10:20:00"), q("removed_from_merge_queue", "10:29:59"), q("merged", "10:30:00")] }));
  assert.equal(f.queue_ejected, false);
  assert.ok(Math.abs(f.queue_minutes! - (9 + 59 / 60)) < 0.001);
  assert.deepEqual([pullFacts(input()).queue_minutes, pullFacts(input()).queue_ejected], [null, null]);
  const again = pullFacts(
    input({ timeline: [q("added_to_merge_queue", "10:20:00"), q("merged", "10:30:00"), q("removed_from_merge_queue", "10:30:00"), q("added_to_merge_queue", "10:30:01")] }),
  );
  assert.deepEqual([again.queue_minutes, again.queue_ejected], [10, false]);
});

test("queue runs: the pull request from main's queue branch only", () => {
  assert.equal(queuePull("gh-readonly-queue/main/pr-41-0123abcd"), 41);
  assert.equal(queuePull("gh-readonly-queue/release/pr-41-0123abcd"), null);
  assert.equal(queuePull("claude/change-41"), null);
  assert.equal(queuePull(null), null);
});

test("queue runs: each job rounded up to the minute, skipped and unfinished jobs count 0", () => {
  const job = (conclusion: string, started: string | null, completed: string | null): RawJob => ({
    name: "x",
    conclusion,
    started_at: started && `2030-01-01T${started}Z`,
    completed_at: completed && `2030-01-01T${completed}Z`,
  });
  const jobs = [
    job("success", "10:00:00", "10:00:15"),
    job("success", "10:00:20", "10:02:01"),
    job("failure", "10:00:20", "10:04:00"),
    // GitHub stamps a skipped job as starting after it completed.
    job("skipped", "10:05:00", "10:04:59"),
    job("success", "10:00:00", null),
  ];
  assert.equal(jobMinutes(jobs), 1 + 2 + 4);
  assert.equal(jobMinutes([]), 0);
});

test("facts: pushes, the final push to merge, verdicts with their tokens, stack layers", () => {
  const user = { type: "User" };
  const comments = [
    { body: "Review: BLOCK at aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nTokens: 41,200\nfix x", user, author_association: "MEMBER" },
    { body: "Review: MERGE at aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", user, author_association: "CONTRIBUTOR" },
    { body: "Review: MERGE at aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nTokens: 9", user: { type: "Bot" }, author_association: "NONE" },
    { body: "Review: MERGE at abc", user, author_association: "MEMBER" },
  ];
  const f = pullFacts(input({ issueComments: comments }));
  assert.deepEqual([f.ci_heads, f.final_push_minutes, f.verdicts, f.review_tokens, f.stacked], [2, 20, 2, [41200], false]);
  assert.equal(pullFacts(input({ stackBase: true })).stacked, true, "another pull request targets its branch");
  assert.equal(pullFacts(input({ timeline: [{ event: "base_ref_changed", created_at: "2030-01-01T10:05:00Z" }] })).stacked, true, "retargeted");
});
