// Agents page collector: GitHub's Agents tab, section by section. Reads the repository's dynamic workflow runs (each
// agent session is one), the agents' pull requests, the automations and their tasks, and the environment setup
// workflow's runs, with the job's read-only token, then writes the page's metrics.json in the format of
// quality-speed/contract and page/vendors.json, the sessions per vendor. Nothing to measure in 30 days reads no_events,
// which scores only while session_drill proves the measures read planted facts exactly. Last, lane_minutes is core/lane's
// laneRecord().
//
//   node quality-speed/pages/agents/collect.ts --out <metrics.json>

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { laneRecord } from "../../core/lane/collect.ts";
import type { Manifest, MetricDef, MetricRecord } from "../../contract/format.ts";
import { restApi, type Api } from "./lib/github.ts";
import {
  AGENT_PREFIX, MEASURES, SETUP_PATH, WINDOW_DAYS, drill, isCopilotPull, vendorRows,
  type Automation, type Facts, type Job, type Measure, type Pull, type Run, type SetupRun,
} from "./lib/sessions.ts";

type Json = Record<string, any>;
const here = dirname(fileURLToPath(import.meta.url));
const ms = (iso: string) => Date.parse(iso);

export function manifest(): Manifest {
  return JSON.parse(readFileSync(join(here, "manifest.json"), "utf8")) as Manifest;
}

/** A read, or null when it failed. */
async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (e) {
    console.error(`::warning title=Agents collector::a read failed (${/HTTP (\d{3})/.exec(String(e))?.[1] ?? "no status"})`);
    return null;
  }
}

/** An AI credit limit, if the automation shows one: the API documents none (read 2026-11-09), so this is null today. */
export function creditLimitOf(x: Json): boolean | null {
  const key = Object.keys(x).find((k) => /credit/i.test(k));
  if (key === undefined) return null;
  const v = x[key];
  return v !== null && v !== undefined && v !== false && v !== 0;
}

/** The dynamic runs and the agents' pull requests of the last 30 days, with the agent runs' jobs and the pull requests' files, the automations with their tasks, and the setup workflow's runs. */
export async function readFacts(api: Api, repo: string, takenAt: string): Promise<Facts> {
  const r = (path: string) => `/repos/${repo}${path}`;
  const since = new Date(ms(takenAt) - WINDOW_DAYS * 86_400_000).toISOString();
  const raw = await attempt(async () =>
    (await api.list(r(`/actions/runs?event=dynamic&created=%3E%3D${since.slice(0, 10)}`), { key: "workflow_runs" })) as Json[]);
  let runs: Run[] | null = null;
  if (raw) {
    runs = [];
    for (const x of raw) {
      const agent = String(x.path ?? "").startsWith(AGENT_PREFIX) && x.status === "completed";
      const jobs = agent
        ? await attempt(async () => ((await api.list(r(`/actions/runs/${x.id}/jobs?filter=all`), { key: "jobs" })) as Json[]).map((j): Job => ({
            labels: j.labels ?? [], startedAt: j.started_at ?? null, completedAt: j.completed_at ?? null,
          })))
        : [];
      runs.push({ id: x.id, path: x.path ?? "", branch: x.head_branch ?? "", createdAt: x.created_at, updatedAt: x.updated_at, status: x.status ?? "", url: x.html_url ?? "", jobs });
    }
  }
  const agentBranches = new Set((runs ?? []).filter((x) => x.path.startsWith(AGENT_PREFIX)).map((x) => x.branch));
  const listed = await attempt(async () =>
    (await api.list(r("/pulls?state=all&sort=updated&direction=desc"), { stop: (last) => ms((last as Json).updated_at) < ms(since) })) as Json[]);
  let pulls: Pull[] | null = null;
  if (listed) {
    pulls = [];
    for (const p of listed) {
      const pull: Pull = {
        id: p.id, number: p.number, author: p.user?.login ?? "", headRef: p.head?.ref ?? "", baseRef: p.base?.ref ?? "",
        mergedAt: p.merged_at ?? null, closedAt: p.closed_at ?? null, files: [],
      };
      if (!isCopilotPull(pull) && !agentBranches.has(pull.headRef)) continue;
      pull.files = await attempt(async () => (await api.list(r(`/pulls/${p.number}/files`))).map((f) => (f as Json).filename as string));
      pulls.push(pull);
    }
  }
  const autos = await attempt(async () => (await api.list(`/agents/repos/${repo}/automations`, { key: "automations" })) as Json[]);
  let automations: Automation[] | null = null;
  if (autos) {
    automations = [];
    for (const a of autos) {
      const tasks = await attempt(async () =>
        ((await api.list(`/agents/repos/${repo}/automations/${a.id}/tasks`, {
          key: "tasks",
        })) as Json[]).map((t) => ({
          state: t.state ?? "", createdAt: t.created_at,
          pulls: (t.artifacts ?? []).filter((x: Json) => x.type === "pull" && Number.isInteger(x.data?.id)).map((x: Json) => x.data.id as number),
        })));
      automations.push({ id: String(a.id), creditLimit: creditLimitOf(a), tasks });
    }
  }
  const setupRuns = await attempt(async (): Promise<SetupRun[]> => {
    const flows = (await api.list(r("/actions/workflows"), { key: "workflows" })) as Json[];
    if (!flows.some((w) => w.path === SETUP_PATH)) return [];
    const listedRuns = (await api.list(r(`/actions/workflows/copilot-setup-steps.yml/runs?status=completed&created=%3E%3D${since.slice(0, 10)}`), { key: "workflow_runs" })) as Json[];
    return listedRuns.map((x) => ({
      createdAt: x.created_at, conclusion: x.conclusion ?? "",
      seconds: Math.max(0, (ms(x.updated_at) - ms(x.run_started_at ?? x.created_at)) / 1000),
    }));
  });
  return { takenAt, runs, pulls, automations, setupRuns };
}

/** A measure as a contract record. no_events and ok link to the collector's run; missing has no link. */
export function toRecord(def: MetricDef, m: Measure, takenAt: string, run: string): MetricRecord {
  const base = { id: def.id, page: "agents" as const, stage: "live" as const };
  const at = takenAt.replace(/\.\d+Z$/, "Z");
  if (m.noEvents) return { ...base, value: null, status: "no_events", measured_at: at, source_url: run, sample_size: 0 };
  if (m.value === null) return { ...base, value: null, status: "missing", measured_at: null, source_url: null, sample_size: null };
  return { ...base, value: m.value, status: "ok", measured_at: at, source_url: run, sample_size: m.sample };
}

/** Every metric but lane_minutes, which core/lane writes. */
export function records(f: Facts, defs: MetricDef[], run: string): MetricRecord[] {
  return defs.filter((d) => d.id !== "lane_minutes").map((d) => {
    if (d.id === "session_drill") return toRecord(d, { value: drill(f), sample: 1 }, f.takenAt, run);
    const measure = MEASURES[d.id];
    if (!measure) throw new Error(`no measure for ${d.id}`);
    return toRecord(d, measure(f), f.takenAt, run);
  });
}

async function main() {
  const i = process.argv.indexOf("--out");
  const out = i > 0 ? process.argv[i + 1] : undefined;
  if (!out) throw new Error("--out is required");
  const repo = process.env.GITHUB_REPOSITORY ?? "Colorado-Startups/legallas";
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const id = process.env.GITHUB_RUN_ID ?? "";
  const run = /^[1-9]\d*$/.test(id) ? `https://github.com/${repo}/actions/runs/${id}` : `https://github.com/${repo}`;
  const facts = await readFacts(restApi(token), repo, new Date().toISOString());
  const recs = [...records(facts, manifest().metrics, run), await laneRecord("agents")];
  const vendors = vendorRows(facts);
  if (process.env.DETAIL_DIR && vendors) {
    mkdirSync(join(process.env.DETAIL_DIR, "page"), { recursive: true });
    writeFileSync(join(process.env.DETAIL_DIR, "page", "vendors.json"), JSON.stringify(vendors) + "\n");
  }
  writeFileSync(out, JSON.stringify(recs, null, 2) + "\n");
  console.log(`agents: ${recs.map((r) => `${r.id} ${r.status} ${r.value ?? ""}`.trim()).join(", ")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
