// Claude Code page collector. Reads GitHub and the local checkout, then writes the
// page's metrics.json: one reading per metric in manifest.json, in the format
// of quality-speed/contract (numbers, times and links to this repository only).
//
//   node quality-speed/pages/claude-code/collect.ts --out <metrics.json> [--as-of <ISO time>]
//        [--repo-dir <checkout>] [--snapshot-out <file>] [--snapshot-in <file>]
//
// Needs GITHUB_TOKEN (read-only: contents, pull requests, actions, checks) and
// a checkout of main with full history. --snapshot-out keeps the raw facts for
// local debugging; they hold pull request text, so never publish or commit them.
// Last, lane_minutes is core/lane's laneRecord(): this lane's job minutes so far,
// read after every other read so they cover them.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { laneRecord } from "../../core/lane/collect.ts";
import { MEASURES } from "./lib/compute.ts";
import { readSnapshot } from "./lib/fetch.ts";
import { restApi } from "./lib/github.ts";
import { combine, scoreMetrics } from "../../core/score.ts";
import { joinMetrics } from "../../contract/validate.ts";
import { toRecord } from "./lib/score.ts";
import type { Manifest, MetricDef, MetricRecord, Snapshot } from "./lib/types.ts";

const here = dirname(fileURLToPath(import.meta.url));

export function manifest(): MetricDef[] {
  return (JSON.parse(readFileSync(join(here, "manifest.json"), "utf8")) as Manifest).metrics;
}

/**
 * Where a reading links when its fact has no run of its own: the collector's
 * run in CI, or main's commit when run by hand.
 */
export function fallbackSource(s: Snapshot, env: NodeJS.ProcessEnv): string {
  const base = `https://github.com/${s.repo}`;
  if (env.GITHUB_RUN_ID && /^[1-9]\d*$/.test(env.GITHUB_RUN_ID) && env.GITHUB_REPOSITORY === s.repo) {
    return `${base}/actions/runs/${env.GITHUB_RUN_ID}`;
  }
  return `${base}/commit/${s.mainSha}`;
}

export function records(snapshot: Snapshot, defs: MetricDef[], fallback: string): MetricRecord[] {
  return defs.map((def) => {
    const measure = MEASURES[def.id];
    if (!measure) throw new Error(`no measure for ${def.id}`);
    return toRecord(def, measure(snapshot), fallback);
  });
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const out = arg("--out");
  if (!out) throw new Error("--out is required");
  const asOf = arg("--as-of") ?? new Date().toISOString();
  const repo = process.env.GITHUB_REPOSITORY ?? "Colorado-Startups/legallas";
  let snapshot: Snapshot;
  const input = arg("--snapshot-in");
  if (input) {
    snapshot = JSON.parse(readFileSync(input, "utf8")) as Snapshot;
  } else {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN is required");
    const read = await readSnapshot(restApi(token), repo, arg("--repo-dir") ?? process.cwd(), asOf);
    snapshot = read.snapshot;
    // Only the status: a read's path can hold a branch name.
    for (const e of read.errors) console.error(`::warning title=Claude Code collector::a read failed (${/HTTP (\d{3})/.exec(e)?.[1] ?? "no status"})`);
    const keep = arg("--snapshot-out");
    if (keep) writeFileSync(keep, JSON.stringify(snapshot));
  }
  const defs = manifest();
  const lane = await laneRecord("claude-code");
  const recs = records(snapshot, defs, fallbackSource(snapshot, process.env)).map((r) => (r.id === lane.id ? lane : r));
  writeFileSync(out, JSON.stringify(recs, null, 2) + "\n");
  const list = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8")) as Manifest;
  const scored = scoreMetrics(joinMetrics(list, recs), new Date(snapshot.takenAt));
  const score = combine(defs.map((d, i) => ({ id: d.id, lens: d.lens, weight: d.weight, score: scored[i]?.score ?? 0 })));
  console.log(`claude-code: quality ${score.exact_quality.toFixed(1)}, speed ${score.exact_speed.toFixed(1)}, consumption ${score.exact_consumption.toFixed(1)}, total ${score.total}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
