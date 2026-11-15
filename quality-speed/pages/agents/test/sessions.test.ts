import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePage } from "../../../core/score.ts";
import { validateManifest, validateRecords } from "../../../contract/validate.ts";
import { creditLimitOf, manifest, records, toRecord } from "../collect.ts";
import { MEASURES, drill, plantedFacts, runMinutes, runnerWeight, sessions, vendorRows, type Facts } from "../lib/sessions.ts";

// Invented moments and records: nothing here comes from a real repository.
const NOW = "2026-10-01T06:00:00Z";
const RUN = "https://github.com/Colorado-Startups/legallas/actions/runs/7";
const quiet: Facts = { takenAt: NOW, runs: [], pulls: [], automations: [], setupRuns: [] };
const SESSION_IDS = ["sessions_merged", "session_to_pr_p50", "minutes_per_merged_change"];

test("the planted sessions read exactly as expected, and the drill passes only on live reads that worked", () => {
  const { facts, expect } = plantedFacts(NOW);
  for (const [id, want] of Object.entries(expect)) assert.ok(Math.abs(MEASURES[id]!(facts).value! - want) < 1e-9, id);
  assert.equal(sessions(facts)!.length, 3, "the site's own session and the other dynamic run are left out");
  assert.equal(drill(quiet), 1);
  assert.equal(drill({ ...quiet, runs: null }), 0);
  assert.equal(drill({ ...quiet, pulls: null }), 0);
});

test("no session is no_events; a failed read or an unread fact is missing, never good", () => {
  for (const id of Object.keys(MEASURES)) assert.deepEqual(MEASURES[id]!(quiet), { value: null, sample: 0, noEvents: true }, id);
  for (const id of SESSION_IDS) assert.deepEqual(MEASURES[id]!({ ...quiet, runs: null }), { value: null, sample: 0 }, id);
  for (const id of ["automation_runs_useful", "automation_credit_limit_set"]) assert.equal(MEASURES[id]!({ ...quiet, automations: null }).value, null, id);
  for (const id of ["env_setup_success", "env_setup_seconds_p50"]) assert.equal(MEASURES[id]!({ ...quiet, setupRuns: null }).value, null, id);
  assert.equal(drill({ ...quiet, automations: null, setupRuns: null }), 1, "a failed automations read leaves the drill and the sessions alone");
  const { facts } = plantedFacts(NOW);
  const unread = { ...facts, runs: facts.runs!.map((r) => ({ ...r, jobs: null })) };
  assert.equal(MEASURES.minutes_per_merged_change!(unread).value, null);
  const noFiles = { ...facts, pulls: facts.pulls!.map((p) => ({ ...p, files: null })) };
  assert.equal(MEASURES.sessions_merged!(noFiles).value, null);
  assert.equal(MEASURES.automation_runs_useful!(noFiles).value, null);
  const unknownLimit = { ...facts, automations: facts.automations!.map((a) => ({ ...a, creditLimit: null })) };
  assert.equal(MEASURES.automation_credit_limit_set!(unknownLimit).value, null, "a limit the API does not show is missing");
});

test("vendor rows come from the agent's workflow path; credit limits only from a field that names credits", () => {
  const { facts } = plantedFacts(NOW);
  assert.deepEqual(vendorRows(facts), [{ vendor: "copilot", sessions: 3, merged: 2 }]);
  const other = { ...facts, runs: [...facts.runs!, { ...facts.runs![0]!, id: 9, path: "dynamic/copilot-swe-agent/other", branch: "agent/x" }] };
  assert.deepEqual(vendorRows(other)!.map((r) => r.vendor), ["copilot", "other"]);
  assert.equal(creditLimitOf({ id: 1, name: "x" }), null);
  assert.equal(creditLimitOf({ ai_credit_limit: 300 }), true);
  assert.equal(creditLimitOf({ ai_credit_limit: null }), false);
});

test("runner weights: GitHub's Linux images and the agent's own runner bill as Linux; anything else is unknown", () => {
  assert.equal(runnerWeight(["ubuntu-cca-77785908-7ef3-498a-9ae0-bbebb95125d3"]), 1);
  assert.equal(runnerWeight(["ubuntu-latest"]), 1);
  assert.equal(runnerWeight(["my-own-runner"]), null);
  assert.equal(runnerWeight([]), null);
  assert.equal(runMinutes({ id: 1, path: "", branch: "", createdAt: NOW, updatedAt: NOW, status: "completed", url: "", jobs: [{ labels: ["x"], startedAt: NOW, completedAt: "2026-10-01T06:01:00Z" }] }), null);
});

test("the list passes the contract; a quiet tab with the drill passing scores 100 but for the lane, and a failed drill scores 0", () => {
  const list = manifest();
  assert.deepEqual(validateManifest(list, "agents").errors, []);
  const lane = { id: "lane_minutes", page: "agents" as const, value: 5, status: "ok" as const, stage: "live" as const, measured_at: NOW, source_url: RUN, sample_size: 1 };
  const recs = [...records(quiet, list.metrics, RUN), lane];
  assert.deepEqual(validateRecords(recs, list, new Date(NOW)).errors, []);
  assert.deepEqual(recs.filter((r) => r.status === "no_events").map((r) => r.id), list.metrics.map((d) => d.id).filter((id) => !["session_drill", "lane_minutes"].includes(id)));
  assert.equal(scorePage("agents", list, recs, new Date(NOW)).total, 100);
  const failed = [...records({ ...quiet, runs: null }, list.metrics, RUN), lane];
  assert.equal(scorePage("agents", list, failed, new Date(NOW)).quality, 0);
  assert.deepEqual(toRecord(list.metrics[0]!, { value: null, sample: 0 }, NOW, RUN), {
    id: "sessions_merged", page: "agents", stage: "live", value: null, status: "missing", measured_at: null, source_url: null, sample_size: null,
  });
});
