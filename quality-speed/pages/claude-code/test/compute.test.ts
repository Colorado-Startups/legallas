import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEASURES, fenceProven, instructionBroken, isShippedBug, percentile, ruleBreaks, ruleClean, selectWindow, sessionLines,
  sessionWork, shippedBugsOpen, tokensPerMergedChange,
} from "../lib/compute.ts";
import { FENCE, facts, job, pull, run, snapshot, windowOf } from "./fixtures.ts";

const BLOCKED_AT = ["2031-04-09T10:01:30Z"];

test("percentile is nearest-rank and null when empty", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5, 1, 3], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
});

test("the window keeps the site's own work and leaves out bots, other bases and unread merges", () => {
  const pulls = [pull(1), pull(2, { userType: "Bot" }), pull(3, { baseRef: "release/x" }), pull(4), pull(5, { headRef: "claude/qs-page" })];
  const f = { 1: facts(1), 2: facts(2), 3: facts(3), 5: facts(5) };
  assert.deepEqual(selectWindow(pulls, f, "2031-04-10T12:00:00Z"), [1, 5]);
});

test("rule breaks follow CLAUDE.md and the pull-request skill", () => {
  const pr = pull(1);
  assert.deepEqual(ruleBreaks(pr, facts(1)), []);
  assert.deepEqual(ruleBreaks(pull(1, { headRef: "feature/x" }), facts(1)), ["branch"]);
  assert.deepEqual(ruleBreaks(pr, facts(1, { mainCommitParents: 2 })), ["squash"]);
  assert.deepEqual(ruleBreaks(pr, facts(1, { commits: [{ sha: "c", message: "no line", authorDate: "2031-04-09T09:00:00Z", verified: false }] })), ["sign-off", "signature"]);
  assert.deepEqual(ruleBreaks(pull(1, { title: "A \u2014 B" }), facts(1)), ["em-dash"]);
  for (const body of ["", "| Verified |  |", "| Verified | <!-- Commands run and their results. --> |", "| Tested | npm test |"]) {
    assert.deepEqual(ruleBreaks(pull(1, { body }), facts(1)), ["verified"], body);
  }
  assert.deepEqual(ruleBreaks(pull(1, { body: "| What | x |\r\n| **Verified** | CI green at abc1234 |" }), facts(1)), []);
  assert.deepEqual(ruleBreaks(pr, facts(1, { ciOk: "failure" })), ["ci-ok"]);
  const rerun = run(10, { jobs: [job("success", "failure"), job("success", "success", { runAttempt: 2, startedAt: "2031-04-09T10:05:00Z", completedAt: "2031-04-09T10:06:00Z" })] });
  assert.deepEqual(ruleBreaks(pr, facts(1, { runs: [rerun], blockingAt: BLOCKED_AT })), ["rerun-after-block"]);
  assert.deepEqual(ruleBreaks(pull(1, { userType: "Bot", headRef: "dependabot/x" }), facts(1, { commits: null })), []);
  assert.throws(() => ruleBreaks(pr, facts(1, { ciOk: null })));
});

test("rule-clean counts bots' merges and direct pushes, and goes missing on an unread fact", () => {
  const s = windowOf([pull(1), pull(2, { userType: "Bot", headRef: "dependabot/x" })], { 2: { ciOk: "failure" } }, { directPushes: [{ sha: "abc", at: "2031-04-09T12:00:00Z" }] });
  assert.ok(Math.abs(ruleClean(s).value! - 100 / 3) < 1e-9);
  assert.equal(ruleClean(windowOf([pull(1)], {}, { directPushes: null })).value, null);
  assert.equal(ruleClean(windowOf([pull(1)], { 1: { ciOk: null } })).value, null);
});

test("the fence counts as proven only for main's exact fence, with its check step passing", () => {
  const steps = [{ name: "Confinement check", conclusion: "success" }];
  const ok = run(5, { workflow: "Claude confinement check", jobs: [{ ...job("success", "success"), steps }] });
  assert.equal(fenceProven(snapshot({ confinementRuns: [ok], fenceAtRun: { 5: FENCE } })).value, 1);
  assert.deepEqual(fenceProven(snapshot({ confinementRuns: [ok], fenceAtRun: { 5: { ...FENCE, pin: "p2" } } })).value, 0);
  assert.equal(fenceProven(snapshot({ confinementRuns: [] })).sample, 1);
  const skipped = run(6, { workflow: "Claude confinement check", jobs: [{ ...job("success", "success"), steps: [{ name: "Confinement check", conclusion: "skipped" }] }] });
  assert.equal(fenceProven(snapshot({ confinementRuns: [skipped], fenceAtRun: { 6: FENCE } })).value, 0);
  assert.equal(fenceProven(snapshot({ confinementRuns: [{ ...ok, jobs: null }], fenceAtRun: { 5: FENCE } })).value, null);
  assert.equal(fenceProven(snapshot({ confinementRuns: null })).value, null);
});

test("broken instruction references are a count over the references checked", () => {
  assert.deepEqual(instructionBroken(snapshot({ instructions: { checked: 40, broken: ["CLAUDE.md: docs/gone.md"] } })).value, 1);
  assert.equal(instructionBroken(snapshot({ instructions: null })).value, null);
});

test("every population shares the window's span", () => {
  const recent = pull(1, { mergedAt: "2031-04-09T11:00:00Z" });
  const oldBot = pull(2, { userType: "Bot", headRef: "dependabot/x", mergedAt: "2031-04-01T11:00:00Z", headSha: "head2" });
  const s = windowOf([recent, oldBot], { 2: { ciOk: "failure" } }, { directPushes: [{ sha: "abc", at: "2031-04-01T00:00:00Z" }] });
  assert.equal(ruleClean(s).sample, 1);
  assert.equal(ruleClean(s).value, 100);
});

const line = (session: string, tokens: string, started: string) => `Claude Code session ${session}: ${tokens} tokens, started ${started}`;

test("session lines are read from the description, never from comments or fenced code", () => {
  const body = ["What: a change.", line("aaaaaaaa", "1,200,000", "2031-04-09T08:00:00Z"), "<!-- " + line("bbbbbbbb", "5", "2031-04-09T08:00:00Z") + " -->",
    "```", line("cccccccc", "7", "2031-04-09T08:00:00Z"), "```", line("dddddddd", "300", "2031-04-09T09:00:00Z")].join("\r\n");
  assert.deepEqual(sessionLines(body), [
    { session: "aaaaaaaa", tokens: 1_200_000, started: "2031-04-09T08:00:00Z" },
    { session: "dddddddd", tokens: 300, started: "2031-04-09T09:00:00Z" },
  ]);
  assert.deepEqual(sessionLines("Claude Code session aaaaaaaa: lots of tokens, started today"), []);
});

test("a session's highest count splits evenly over its merged pull requests; one pull request adds up its sessions", () => {
  const a1 = line("aaaaaaaa", "4,000,000", "2031-04-09T08:00:00Z");
  const a2 = line("aaaaaaaa", "6,000,000", "2031-04-09T08:00:00Z");
  const b = line("bbbbbbbb", "1,000,000", "2031-04-09T09:30:00Z");
  const pulls = [pull(1, { body: a1 }), pull(2, { body: `${a2}\n${b}` }), pull(3, { body: a2, mergedAt: null }), pull(4)];
  const work = sessionWork(snapshot({ pulls }));
  assert.deepEqual(work.get(1), { tokens: 3_000_000, started: "2031-04-09T08:00:00Z" });
  assert.deepEqual(work.get(2), { tokens: 4_000_000, started: "2031-04-09T08:00:00Z" });
  assert.equal(work.has(3), false);
  assert.equal(work.has(4), false);
  const s = windowOf(pulls.filter((p) => p.mergedAt));
  assert.deepEqual(tokensPerMergedChange(s), { value: 3_500_000, sample: 2, source: null, time: s.takenAt });
  assert.equal(tokensPerMergedChange(windowOf([pull(4)])).value, null);
});

test("task to merge starts at the earliest session line or commit, so a merge without a line counts", () => {
  const s = windowOf([
    pull(1, { body: line("aaaaaaaa", "10", "2031-04-09T08:00:00Z") }),
    pull(2, { body: line("bbbbbbbb", "10", "2031-04-09T12:00:00Z") }),
    pull(3),
  ]);
  assert.deepEqual([MEASURES.task_to_merge_p50!(s).value, MEASURES.task_to_merge_p50!(s).sample], [1.5, 3]);
  assert.equal(MEASURES.task_to_merge_p90!(s).value, 3);
  assert.equal(MEASURES.task_to_merge_p90!(windowOf([pull(1)], { 1: { commits: null } })).value, null);
});

test("open shipped bugs count issues whose Landed line names a merge or commit, and go missing unread", () => {
  const bug = (number: number, landed: string, labels: string[] = []) => ({ number, body: `Severity: low\nLanded: ${landed}\nFound by: a test`, labels });
  const issues = [
    bug(1, "#12"),
    bug(2, "abc1234"),
    bug(3, "fix in #30, open"),
    bug(4, "not merged yet, in #40"),
    bug(5, "not traced to a commit"),
    bug(6, "#50", ["enhancement"]),
    { number: 7, body: "Landed: #60", labels: [] },
  ];
  assert.deepEqual(issues.filter(isShippedBug).map((i) => i.number), [1, 2, 3]);
  assert.deepEqual(shippedBugsOpen(snapshot({ openIssues: issues })), { value: 3, sample: 7, source: null, time: snapshot().takenAt });
  assert.equal(shippedBugsOpen(snapshot({ openIssues: [] })).value, 0);
  assert.equal(shippedBugsOpen(snapshot({ openIssues: null })).value, null);
});
