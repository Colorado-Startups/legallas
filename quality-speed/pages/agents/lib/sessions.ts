// Pure functions from the facts the Agents collector read to its measures: GitHub's Agents tab, section by section.
// Sessions (each vendor's cloud agent runs), Automations and their runs, and the agent's environment setup. No reads here, so the tests and the drill can feed invented
// facts. A fact that could not be read makes its measure missing; no session at all is no_events, which scores only
// while the drill proves detection works.

/** Each Copilot cloud agent session runs as one Actions run of this dynamic workflow, on a `copilot/` branch. */
export const AGENT_PATH = "dynamic/copilot-swe-agent/copilot";
/** The agent's dynamic workflows: the last part names the vendor's agent (Copilot's, verified on github/docs' runs). */
export const AGENT_PREFIX = "dynamic/copilot-swe-agent/";
/** The environment's setup workflow: its path and job name are fixed by GitHub. */
export const SETUP_PATH = ".github/workflows/copilot-setup-steps.yml";
/** How GitHub names Copilot as a pull request's author: REST's login, then the app's slug. */
export const COPILOT_LOGINS = new Set(["Copilot", "copilot-swe-agent", "copilot-swe-agent[bot]"]);
export const WINDOW_DAYS = 30;
const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(iso);

export interface Job {
  labels: string[];
  startedAt: string | null;
  completedAt: string | null;
}

export interface Run {
  id: number;
  path: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  url: string;
  /** Null when they could not be read. */
  jobs: Job[] | null;
}

export interface Pull {
  /** The REST id, which an automation task's pull artifact names. */
  id: number;
  number: number;
  author: string;
  headRef: string;
  baseRef: string;
  mergedAt: string | null;
  closedAt: string | null;
  /** Null when they could not be read. */
  files: string[] | null;
}

/** An automation task (one run). `pulls` are the ids of its pull request artifacts. */
export interface Task {
  state: string;
  createdAt: string;
  pulls: number[];
}

export interface Automation {
  id: string;
  /** True or false when the API shows an AI credit limit; null when it shows none. */
  creditLimit: boolean | null;
  /** Null when they could not be read. */
  tasks: Task[] | null;
}

/** One run of the setup workflow. */
export interface SetupRun {
  createdAt: string;
  conclusion: string;
  seconds: number;
}

export interface Facts {
  takenAt: string;
  /** The repository's automations; null when the read failed. */
  automations?: Automation[] | null;
  /** The setup workflow's runs, [] when the repository has no such workflow; null when the read failed. */
  setupRuns?: SetupRun[] | null;
  /** The repository's dynamic workflow runs; null when the read failed. */
  runs: Run[] | null;
  /** Pull requests updated in the window; null when the read failed. */
  pulls: Pull[] | null;
}

/** A measured value; null is missing, unless `noEvents` says there was nothing to measure. */
export interface Measure {
  value: number | null;
  sample: number;
  noEvents?: true;
}

const MISSING: Measure = { value: null, sample: 0 };
const NONE: Measure = { value: null, sample: 0, noEvents: true };

/** Paths that belong to the Quality and Speed site itself, which no page here counts. */
export const isSitePath = (path: string) => path.startsWith("quality-speed/") || /^\.github\/workflows\/quality-speed[^/]*\.ya?ml$/.test(path);

export const isAgentRun = (run: Run) => run.path.startsWith(AGENT_PREFIX);

/** The vendor's agent a session ran, from its workflow path: "copilot" for Copilot's. */
export const vendorOf = (run: Run) => run.path.slice(AGENT_PREFIX.length).split("/")[0] || "unknown";

export const isCopilotPull = (p: Pull) => COPILOT_LOGINS.has(p.author) || p.headRef.startsWith("copilot/");

/** Billed minutes per minute on a runner, against Linux 2-core (GitHub's runner prices): the cloud agent's own `ubuntu-cca-` runner bills as Linux. Unknown is null, never cheap. */
export function runnerWeight(labels: string[]): number | null {
  const l = (labels[0] ?? "").toLowerCase();
  if (labels.length === 0) return null;
  if (/^ubuntu-(latest|\d+\.\d+)$/.test(l) || /^ubuntu-cca-[0-9a-f-]+$/.test(l)) return 1;
  if (/^ubuntu-slim$/.test(l)) return 0.002 / 0.006;
  return null;
}

/** Linux-equivalent minutes a run billed: each job rounded up. Null on unread jobs or an unknown runner. */
export function runMinutes(run: Run): number | null {
  if (!run.jobs) return null;
  let total = 0;
  for (const j of run.jobs) {
    if (!j.startedAt || !j.completedAt) continue;
    const raw = (ms(j.completedAt) - ms(j.startedAt)) / 60_000;
    if (raw <= 0) continue;
    const weight = runnerWeight(j.labels);
    if (weight === null) return null;
    total += Math.ceil(raw) * weight;
  }
  return total;
}

export interface Session {
  run: Run;
  pull: Pull | null;
}

/**
 * The window's finished sessions: the cloud agent's completed runs in the last 30 days, each with its pull request by
 * branch. A session whose pull request is the site's own work is left out. Null when a read failed.
 */
export function sessions(f: Facts): Session[] | null {
  if (!f.runs || !f.pulls) return null;
  const since = ms(f.takenAt) - WINDOW_DAYS * DAY;
  const byBranch = new Map(f.pulls.map((p) => [p.headRef, p]));
  const out: Session[] = [];
  for (const run of f.runs) {
    if (!isAgentRun(run) || run.status !== "completed" || ms(run.createdAt) < since || ms(run.createdAt) > ms(f.takenAt)) continue;
    const pull = byBranch.get(run.branch) ?? null;
    if (pull && pull.files === null) return null;
    if (pull?.files?.some(isSitePath)) continue;
    out.push({ run, pull });
  }
  return out;
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
};

/** Of the sessions whose pull request has closed, the share whose pull request merged into main. */
export function sessionsMerged(f: Facts): Measure {
  const all = sessions(f);
  if (!all) return MISSING;
  const done = all.filter((s) => s.pull?.closedAt);
  if (done.length === 0) return NONE;
  return { value: (100 * done.filter((s) => s.pull!.mergedAt && s.pull!.baseRef === "main").length) / done.length, sample: done.length };
}

/** p50 minutes from a session's start to its end, when it hands its pull request back. */
export function sessionToPr(f: Facts): Measure {
  const all = sessions(f);
  if (!all) return MISSING;
  if (all.length === 0) return NONE;
  return { value: percentile(all.map((s) => (ms(s.run.updatedAt) - ms(s.run.createdAt)) / 60_000), 50), sample: all.length };
}

/** The sessions' billed minutes over the merged pull requests they built; with none merged, all of them count against one. */
export function minutesPerMergedChange(f: Facts): Measure {
  const all = sessions(f);
  if (!all) return MISSING;
  if (all.length === 0) return NONE;
  let minutes = 0;
  for (const s of all) {
    const m = runMinutes(s.run);
    if (m === null) return MISSING;
    minutes += m;
  }
  const merged = new Set(all.filter((s) => s.pull?.mergedAt && s.pull.baseRef === "main").map((s) => s.pull!.number));
  return { value: minutes / Math.max(1, merged.size), sample: all.length };
}

/** Sessions and merged pull requests per vendor, for the page's vendor rows. */
export function vendorRows(f: Facts): { vendor: string; sessions: number; merged: number }[] | null {
  const all = sessions(f);
  if (!all) return null;
  const rows = new Map<string, { vendor: string; sessions: number; merged: number }>();
  for (const s of all) {
    const v = vendorOf(s.run);
    const row = rows.get(v) ?? { vendor: v, sessions: 0, merged: 0 };
    row.sessions++;
    if (s.pull?.mergedAt && s.pull.baseRef === "main") row.merged++;
    rows.set(v, row);
  }
  return [...rows.values()];
}

const ENDED = new Set(["completed", "failed", "timed_out", "cancelled"]);

/**
 * Of the automation runs that ended in the window, the share that was useful: a pull request that merged into main, or,
 * with no pull request, a completed run (a closed issue, a comment, a verdict). A run whose pull request is still open
 * has not ended. A pull request the collector did not read is missing, never good.
 */
export function automationRunsUseful(f: Facts): Measure {
  if (!f.automations || !f.pulls) return MISSING;
  const since = ms(f.takenAt) - WINDOW_DAYS * DAY;
  const byId = new Map(f.pulls.map((p) => [p.id, p]));
  let ended = 0;
  let useful = 0;
  for (const a of f.automations) {
    if (!a.tasks) return MISSING;
    for (const t of a.tasks) {
      if (!ENDED.has(t.state) || ms(t.createdAt) < since || ms(t.createdAt) > ms(f.takenAt)) continue;
      const pulls = t.pulls.map((id) => byId.get(id));
      if (pulls.some((p) => !p || p.files === null)) return MISSING;
      if (pulls.some((p) => !p!.closedAt)) continue;
      if (pulls.some((p) => p!.files!.some(isSitePath))) continue;
      ended++;
      if (pulls.length > 0 ? pulls.some((p) => p!.mergedAt && p!.baseRef === "main") : t.state === "completed") useful++;
    }
  }
  return ended === 0 ? NONE : { value: (100 * useful) / ended, sample: ended };
}

/** The share of automations with an AI credit limit. One whose limit the API does not show is missing. */
export function automationCreditLimitSet(f: Facts): Measure {
  if (!f.automations) return MISSING;
  if (f.automations.length === 0) return NONE;
  if (f.automations.some((a) => a.creditLimit === null)) return MISSING;
  return { value: (100 * f.automations.filter((a) => a.creditLimit).length) / f.automations.length, sample: f.automations.length };
}

/** The setup workflow's finished runs in the window: a cancelled or skipped run says nothing about setup. */
function finishedSetups(f: Facts): SetupRun[] | null {
  if (!f.setupRuns) return null;
  const since = ms(f.takenAt) - WINDOW_DAYS * DAY;
  return f.setupRuns.filter((r) => !["cancelled", "skipped", ""].includes(r.conclusion) && ms(r.createdAt) >= since && ms(r.createdAt) <= ms(f.takenAt));
}

/** p50 seconds of the setup workflow's finished runs. */
export function envSetupSeconds(f: Facts): Measure {
  const runs = finishedSetups(f);
  if (!runs) return MISSING;
  if (runs.length === 0) return NONE;
  return { value: percentile(runs.map((r) => r.seconds), 50), sample: runs.length };
}

/** The share of the setup workflow's finished runs that succeeded. */
export function envSetupSuccess(f: Facts): Measure {
  const runs = finishedSetups(f);
  if (!runs) return MISSING;
  if (runs.length === 0) return NONE;
  return { value: (100 * runs.filter((r) => r.conclusion === "success").length) / runs.length, sample: runs.length };
}

export const MEASURES: Record<string, (f: Facts) => Measure> = {
  sessions_merged: sessionsMerged,
  session_to_pr_p50: sessionToPr,
  minutes_per_merged_change: minutesPerMergedChange,
  automation_runs_useful: automationRunsUseful,
  automation_credit_limit_set: automationCreditLimitSet,
  env_setup_seconds_p50: envSetupSeconds,
  env_setup_success: envSetupSuccess,
};

/** Invented sessions shaped like GitHub's records, and what the measures must make of them. */
export function plantedFacts(takenAt: string): { facts: Facts; expect: Record<string, number> } {
  const at = (minutesAgo: number) => new Date(ms(takenAt) - minutesAgo * 60_000).toISOString().replace(/\.\d+Z$/, "Z");
  const job = (start: number, end: number, label = "ubuntu-cca-00000000-0000-0000-0000-000000000000"): Job => ({ labels: [label], startedAt: at(start), completedAt: at(end) });
  const run = (id: number, branch: string, start: number, end: number, jobs: Job[], path = AGENT_PATH): Run => ({
    id, path, branch, createdAt: at(start), updatedAt: at(end), status: "completed", url: `https://github.com/example/drill/actions/runs/${id}`, jobs,
  });
  const pull = (number: number, headRef: string, merged: boolean, files = ["web/sample.ts"]): Pull => ({
    id: 1000 + number, number, author: "Copilot", headRef, baseRef: "main", mergedAt: merged ? at(10) : null, closedAt: at(10), files,
  });
  return {
    facts: {
      takenAt,
      runs: [
        run(1, "copilot/drill-a", 120, 100, [job(119, 101)]),
        run(2, "copilot/drill-a", 90, 80, [job(89, 81)]),
        run(3, "copilot/drill-b", 60, 30, [job(59, 31)]),
        run(4, "copilot/drill-c", 50, 40, [job(49, 41)]),
        run(5, "main", 50, 40, [job(49, 41, "ubuntu-latest")], "dynamic/dependabot/dependabot-updates"),
      ],
      pulls: [pull(11, "copilot/drill-a", true), pull(12, "copilot/drill-b", false), pull(13, "copilot/drill-c", true, ["quality-speed/core/x.ts"])],
      automations: [
        { id: "a", creditLimit: true, tasks: [
          { state: "completed", createdAt: at(120), pulls: [1011] },
          { state: "completed", createdAt: at(60), pulls: [1012] },
          { state: "completed", createdAt: at(30), pulls: [] },
          { state: "failed", createdAt: at(20), pulls: [] },
          { state: "in_progress", createdAt: at(5), pulls: [] },
        ] },
        { id: "b", creditLimit: false, tasks: [{ state: "completed", createdAt: at(50), pulls: [1013] }] },
      ],
      setupRuns: [
        { createdAt: at(300), conclusion: "success", seconds: 90 },
        { createdAt: at(200), conclusion: "failure", seconds: 200 },
        { createdAt: at(100), conclusion: "success", seconds: 110 },
        { createdAt: at(50), conclusion: "cancelled", seconds: 5 },
      ],
    },
    // Sessions 1, 2 and 3 count; 4 is the site's own work and 5 isn't the agent. Merged: 2 of 3. Minutes: 20, 10, 30
    // long, p50 20. Billed: 18 + 8 + 28 = 54 over one merged change. Automation runs ended: merged, closed unmerged,
    // a verdict, a failure (one still running, one the site's own): 2 of 4 useful. Limits: 1 of 2. Setup: 90, 200 and
    // 110 seconds (the cancelled run left out), p50 110, 2 of 3 succeeded.
    expect: {
      sessions_merged: 200 / 3, session_to_pr_p50: 20, minutes_per_merged_change: 54,
      automation_runs_useful: 50, automation_credit_limit_set: 50, env_setup_seconds_p50: 110, env_setup_success: 200 / 3,
    },
  };
}

/** 1 when the measures read the planted sessions exactly and the live reads all succeeded; 0 otherwise. */
export function drill(live: Facts): number {
  if (!live.runs || !live.pulls) return 0;
  const planted = plantedFacts(live.takenAt);
  const exact = Object.entries(planted.expect).every(([id, want]) => {
    const got = MEASURES[id]!(planted.facts).value;
    return got !== null && Math.abs(got - want) < 1e-9;
  });
  return exact ? 1 : 0;
}
