// SPDX-License-Identifier: Apache-2.0
// CI overview: pure functions from a dump of GitHub REST reads to this page's readings and drill-down rows.
// Output is numbers, job names, workflow names and runner kinds only: no title, body, branch name or commit message.

export interface Job {
  name: string;
  labels: string[];
  started_at: string | null;
  completed_at: string | null;
  conclusion: string | null;
  run_attempt?: number;
  steps?: { name: string; conclusion: string | null }[];
}
export interface Run {
  id: number;
  name: string;
  event: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  head_branch: string | null;
  created_at: string;
  updated_at: string;
}
export interface Pull {
  number: number;
  merged_at: string | null;
  updated_at?: string;
  head: { ref: string; sha: string };
  user?: { type: string };
}
export interface TimelineEvent {
  event?: string;
  created_at?: string;
  commit_id?: string;
}
export interface Rule {
  type: string;
  parameters?: { required_status_checks?: { context: string }[] } | null;
}
/** A pull request comment as the REST listing gives it: only these fields are read. */
export interface Comment {
  issue_url: string;
  created_at: string;
  author_association: string;
  user?: { type: string } | null;
  body?: string | null;
}
/** A review verdict (the merging skill): its pull request, when it was posted, and what it says. */
export interface Verdict {
  issue: number;
  created_at: string;
  verdict: 'MERGE' | 'BLOCK';
  sha: string;
}
/** Everything the collector reads: runs and the jobs a reading needs, pull requests, merged ones' timelines, rules, ci.yml,
 * and the review verdicts posted from the lookback's start. */
export interface Dump {
  runs: Run[];
  jobs: Record<string, Job[]>;
  pulls: Pull[];
  timelines: Record<string, TimelineEvent[]>;
  rules: Rule[];
  ciYml: string;
  verdicts?: Verdict[];
  /** The drill-down's first run: it covers runs created from here to the window's end. Absent: the whole window. */
  drill_from?: string;
}

/** The merging skill's verdict: a pull request comment whose first line is exactly this, with the full 40-hex SHA. The same
 * pattern as code-os's `quality/collectors/github/github-reviews.mjs` `MARKER`. */
export const MARKER = /^Review: (MERGE|BLOCK) at ([0-9a-f]{40})$/;
/** Who can post one. The repository is private, so only people with access can comment, and GitHub shows a private org
 * member as CONTRIBUTOR to the job's token (code-os's `privateMarkerAuthors` says the same). Bots and first-timers are out. */
const VERDICT_AUTHORS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR']);

/** A comment's verdict, or null: a person with access, the first line exactly the marker. */
export function verdictOf(c: Comment): Verdict | null {
  if (c.user?.type !== 'User' || !VERDICT_AUTHORS.has(c.author_association)) return null;
  const m = MARKER.exec((String(c.body ?? '').split('\n', 1)[0] ?? '').replace(/\r$/, ''));
  const issue = Number(/\/issues\/([1-9]\d*)$/.exec(c.issue_url)?.[1]);
  return m && Number.isInteger(issue) ? { issue, created_at: c.created_at, verdict: m[1] as Verdict['verdict'], sha: m[2] as string } : null;
}

export type Kind = 'slim' | 'linux' | 'windows' | 'mac' | 'blacksmith';

/** GitHub's list price a minute (docs.github.com/en/billing/reference/actions-runner-pricing, 2026-11-02). A Blacksmith
 * minute is priced as the GitHub Linux minute it displaces once its free 3,000 a month are gone. */
export const PRICE: Record<Kind, number> = { slim: 0.002, linux: 0.006, windows: 0.01, mac: 0.062, blacksmith: 0.006 };

export class Unknown extends Error {}

/** The runner kind and price factor for a job's labels. A label the list doesn't know throws: never a low guess. */
export function runnerOf(labels: string[]): { kind: Kind; factor: number } {
  for (const label of labels) {
    const bs = /^blacksmith-(\d+)vcpu-ubuntu-\d+$/.exec(label);
    if (bs) return { kind: 'blacksmith', factor: Number(bs[1]) / 2 };
    if (label === 'ubuntu-slim') return { kind: 'slim', factor: 1 };
    if (/^ubuntu-(latest|\d+\.\d+)$/.test(label)) return { kind: 'linux', factor: 1 };
    if (/^windows-(latest|\d+)$/.test(label)) return { kind: 'windows', factor: 1 };
    if (/^(macos-(latest|\d+)|xcode-\d+)$/.test(label)) return { kind: 'mac', factor: 1 };
  }
  throw new Unknown('a runner label the price list does not know');
}

const t = (iso: string) => Date.parse(iso);
const seconds = (j: Job) => (j.started_at && j.completed_at ? Math.max(0, (t(j.completed_at) - t(j.started_at)) / 1000) : 0);
/** GitHub rounds each job up to a whole minute. */
export const billed = (j: Job) => Math.ceil(seconds(j) / 60);
export const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  const hi = s[m] ?? 0;
  return s.length % 2 ? hi : ((s[m - 1] ?? hi) + hi) / 2;
}

/** What a job cost at list price, and its kind. Skipped jobs cost nothing. */
export function jobCost(j: Job): { kind: Kind | null; usd: number; minutes: number } {
  if (j.conclusion === 'skipped' || !j.started_at || billed(j) === 0) return { kind: null, usd: 0, minutes: 0 };
  const r = runnerOf(j.labels);
  const minutes = billed(j) * r.factor;
  return { kind: r.kind, usd: minutes * PRICE[r.kind], minutes };
}

export const DAY = 86_400_000;
/** The events the collector lists: what pushes, merges and people start. */
export const EVENTS = ['pull_request', 'push', 'workflow_dispatch'];
export interface Config {
  window_days: number;
  /** Days before the window whose runs are listed, so each merged head's runs are found. */
  lookback_days: number;
  max_job_reads: number;
  /** The newest runs in the window whose jobs the drill-down reads: the cost table and the path chart. */
  drill_runs: number;
}

/** The runs the gates read on each merged head. */
const GATE_RUNS = ['CI', 'DCO'];
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z';

/** Whose jobs to read: CI and DCO on merged heads (the gates), runs in the window that share a workflow and head with
 * another (the repeats), and the newest `drill_runs` runs in the window (the drill-down). Every other reading needs runs
 * only. Runs that were skipped had no job on a runner, so none is read. */
export function jobReads(runs: Run[], pulls: Pull[], cfg: Config, now: number): { ids: number[]; drill_from: string } {
  const from = now - cfg.window_days * DAY;
  const ran = runs.filter((r) => r.status === 'completed' && r.conclusion !== 'skipped');
  const heads = new Set(pulls.filter((p) => !!p.merged_at && t(p.merged_at) >= from && t(p.merged_at) <= now).map((p) => p.head.sha));
  const inWindow = ran.filter((r) => t(r.created_at) >= from && t(r.created_at) <= now);
  const key = (r: Run) => `${r.name}\n${r.head_sha}`;
  const count = new Map<string, number>();
  for (const r of inWindow.filter((r) => r.event === 'pull_request')) count.set(key(r), (count.get(key(r)) ?? 0) + 1);
  const newest = inWindow.filter((r) => EVENTS.includes(r.event)).sort((a, b) => t(b.created_at) - t(a.created_at));
  const cut = newest.length > cfg.drill_runs ? t((newest[cfg.drill_runs - 1] as Run).created_at) : from;
  const ids = new Set<number>();
  for (const r of ran) {
    const gate = r.event === 'pull_request' && GATE_RUNS.includes(r.name) && heads.has(r.head_sha);
    const repeat = r.event === 'pull_request' && (count.get(key(r)) ?? 0) > 1 && t(r.created_at) >= from && t(r.created_at) <= now;
    const drill = EVENTS.includes(r.event) && t(r.created_at) >= cut && t(r.created_at) <= now;
    if (gate || repeat || drill) ids.add(r.id);
  }
  return { ids: [...ids], drill_from: iso(cut) };
}

export const IDS = ['gates_intact', 'ci_usd_per_merge', 'pushes_per_merge', 'reviews_per_merge', 'repeat_runs_per_merge', 'final_push_to_merge_p50'] as const;
export type Reading = { value: number | null; samples: number };
export type Values = Record<(typeof IDS)[number], Reading>;

const ok = (j: Job | undefined) => j?.conclusion === 'success' && !!j.started_at;
/** A run's job by name, from its latest attempt: a rerun that passed replaces the failure before it. */
const job = (d: Dump, r: Run | undefined, name: string) =>
  r ? (d.jobs[String(r.id)] ?? []).filter((j) => j.name === name).sort((a, b) => (b.run_attempt ?? 1) - (a.run_attempt ?? 1))[0] : undefined;

/** Merged pull requests in the window, each with its final head's latest CI, DCO and review runs. */
function mergedHeads(d: Dump, cfg: Config, now: number) {
  const from = now - cfg.window_days * DAY;
  const prRuns = d.runs.filter((r) => r.status === 'completed' && r.event === 'pull_request');
  const latest = (sha: string, name: string) => prRuns.filter((r) => r.head_sha === sha && r.name === name).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  return d.pulls
    .filter((p) => !!p.merged_at && t(p.merged_at) >= from && t(p.merged_at) <= now)
    .map((p) => ({ p, ci: latest(p.head.sha, 'CI'), dco: latest(p.head.sha, 'DCO'), review: latest(p.head.sha, 'Claude review') }));
}

/** The eight gates, in GATES order. Null with no merge in the window: nothing on a merged head to prove. */
export const GATES = ['ci-ok', 'dco', 'review', 'signed', 'scan', 'dco ran', 'review ran', 'lint'] as const;
export function gateStates(d: Dump, cfg: Config, now: number): boolean[] | null {
  const heads = mergedHeads(d, cfg, now);
  if (heads.length === 0) return null;
  const every = (f: (h: (typeof heads)[number]) => boolean) => heads.every(f);
  const required = new Set(d.rules.filter((r) => r.type === 'required_status_checks').flatMap((r) => r.parameters?.required_status_checks ?? []).map((c) => c.context));
  return [
    required.has('ci-ok'),
    required.has('dco'),
    required.has('claude-review'),
    d.rules.some((r) => r.type === 'required_signatures'),
    every((h) => ok(job(d, h.ci, 'ci-ok')) && ok(job(d, h.ci, 'checks')) && !!job(d, h.ci, 'checks')?.steps?.some((s) => s.name === 'Secret scan' && s.conclusion === 'success')),
    every((h) => h.p.user?.type === 'Bot' || ok(job(d, h.dco, 'dco'))),
    every((h) => ok(job(d, h.review, 'claude-review'))),
    /^\s+if: steps\.changed\.outputs\.workflows == 'true'\n\s+run: \.github\/scripts\/lint-workflows\.sh\s*$/m.test(d.ciYml),
  ];
}

/** The page's six readings. A per-merge value has the merge count as its sample size; a merged head with no CI run, or
 * a merged pull request with no review verdict, makes that count missing, so a skipped gate never reads as a cheap merge. */
export function readings(d: Dump, cfg: Config, now: number): Values {
  const from = now - cfg.window_days * DAY;
  const inWindow = (iso: string | null | undefined) => !!iso && t(iso) >= from && t(iso) <= now;
  const heads = mergedHeads(d, cfg, now);
  const n = heads.length;
  const done = d.runs.filter((r) => r.status === 'completed');
  const prRuns = done.filter((r) => r.event === 'pull_request');
  const windowPr = prRuns.filter((r) => inWindow(r.created_at));
  // Each verdict is one review, MERGE or BLOCK, on any pull request.
  const verdicts = d.verdicts ?? [];
  const reviewed = new Set(verdicts.map((v) => v.issue));
  const every = (f: (h: (typeof heads)[number]) => boolean) => n > 0 && heads.every(f);
  const per = (x: number, proven = true) => ({ value: n && proven ? round(x / n) : null, samples: n });
  const gates = gateStates(d, cfg, now);

  // Dollars over the drill-down's span only: the runs before it have no jobs read.
  const drillFrom = Math.max(from, d.drill_from ? t(d.drill_from) : from);
  const inDrill = (iso: string | null | undefined) => !!iso && t(iso) >= drillFrom && t(iso) <= now;
  let usd = 0;
  for (const r of done) {
    if (!inDrill(r.created_at) || (r.event !== 'pull_request' && !(r.event === 'push' && r.head_branch === 'main'))) continue;
    for (const j of d.jobs[String(r.id)] ?? []) usd += jobCost(j).usd;
  }
  const drillMerges = heads.filter((h) => inDrill(h.p.merged_at)).length;

  const gotRunner = (r: Run) => (d.jobs[String(r.id)] ?? []).some((j) => j.conclusion !== 'skipped' && !!j.started_at);
  const pairs = new Map<string, number>();
  for (const r of windowPr.filter(gotRunner)) pairs.set(`${r.name}\n${r.head_sha}`, (pairs.get(`${r.name}\n${r.head_sha}`) ?? 0) + 1);
  const repeats = [...pairs.values()].reduce((a, k) => a + k - 1, 0);

  const toMerge = heads.flatMap((h) => {
    const first = prRuns.filter((r) => r.head_sha === h.p.head.sha).map((r) => t(r.created_at));
    return first.length && h.p.merged_at ? [(t(h.p.merged_at) - Math.min(...first)) / 60_000] : [];
  });
  const p50 = median(toMerge);
  return {
    // No merge proves nothing about the gates on merged heads, so a quiet window reads missing, not broken.
    gates_intact: { value: gates ? gates.filter(Boolean).length : null, samples: gates ? 1 : 0 },
    ci_usd_per_merge: { value: drillMerges ? round(usd / drillMerges) : null, samples: drillMerges },
    pushes_per_merge: per(new Set(windowPr.filter((r) => r.name === 'CI').map((r) => r.head_sha)).size, every((h) => !!h.ci)),
    reviews_per_merge: per(verdicts.filter((v) => inWindow(v.created_at)).length, every((h) => reviewed.has(h.p.number))),
    repeat_runs_per_merge: per(repeats),
    final_push_to_merge_p50: { value: p50 === null ? null : round(p50, 2), samples: toMerge.length },
  };
}

/** Force pushes per merge: the 0-behind rule's rebases, with self-squashes. Shown, not scored: each is already a push and
 * a review above. */
export function rebasesPerMerge(d: Dump, cfg: Config, now: number): number | null {
  const from = now - cfg.window_days * DAY;
  const merged = d.pulls.filter((p) => p.merged_at && t(p.merged_at) >= from && t(p.merged_at) <= now);
  const pushes = merged.flatMap((p) => (d.timelines[String(p.number)] ?? []).filter((e) => e.event === 'head_ref_force_pushed'));
  return merged.length ? round(pushes.length / merged.length, 2) : null;
}

export interface JobRow {
  job: string;
  workflow: string;
  kind: Kind;
  runs: number;
  p50_s: number;
  minutes: number;
  usd_run: number;
  usd: number;
}
export interface Bar {
  job: string;
  kind: Kind;
  start_s: number;
  end_s: number;
}
export interface Path {
  path: 'docs' | 'web' | 'swift';
  runs: number;
  usd_push: number;
  bars: Bar[];
}
export interface Rows {
  from: string;
  to: string;
  merges: number;
  /** Hours from the drill-down's first run to the window's end: what the page scales a day by. */
  span_hours: number;
  rebases_per_merge: number | null;
  gates: boolean[] | null;
  /** GitHub-hosted dollars and Blacksmith minutes in the window, every event. */
  hosted_usd: number;
  blacksmith_minutes: number;
  jobs: JobRow[];
  paths: Path[];
}

/** The drill-down, over the runs from `drill_from`: every job's runner, time and cost (every event, by-hand runs and
 * probes too), and one typical push per path as bars from the push. */
export function rows(d: Dump, cfg: Config, now: number): Rows {
  const from = now - cfg.window_days * DAY;
  const start = Math.max(from, d.drill_from ? t(d.drill_from) : from);
  const runs = d.runs.filter((r) => r.status === 'completed' && t(r.created_at) >= start && t(r.created_at) <= now && EVENTS.includes(r.event));
  const groups = new Map<string, { job: string; workflow: string; kind: Kind; secs: number[]; minutes: number; usd: number }>();
  for (const r of runs) {
    for (const j of d.jobs[String(r.id)] ?? []) {
      const c = jobCost(j);
      if (!c.kind) continue;
      const key = `${r.name}\n${j.name}\n${c.kind}`;
      const g = groups.get(key) ?? { job: j.name, workflow: r.name, kind: c.kind, secs: [], minutes: 0, usd: 0 };
      g.secs.push(seconds(j));
      g.minutes += c.minutes;
      g.usd += c.usd;
      groups.set(key, g);
    }
  }
  const jobs = [...groups.values()]
    .map((g) => ({ job: g.job, workflow: g.workflow, kind: g.kind, runs: g.secs.length, p50_s: round(median(g.secs) ?? 0, 0), minutes: g.minutes, usd_run: round(g.usd / g.secs.length, 4), usd: round(g.usd, 2) }))
    .sort((a, b) => b.usd - a.usd || b.minutes - a.minutes);

  // Typical push per path: CI runs on pull requests, each with the DCO, Labeler and review runs on the same head.
  const bySha = new Map<string, Run[]>();
  for (const r of runs.filter((r) => r.event === 'pull_request')) bySha.set(r.head_sha, [...(bySha.get(r.head_sha) ?? []), r]);
  const pathOf = (ci: Job[]): Path['path'] => {
    if (ci.some((j) => j.name === 'swift' && j.conclusion === 'success')) return 'swift';
    if (ci.some((j) => j.name === 'checks' && j.steps?.some((s) => s.name === 'Web test' && s.conclusion === 'success'))) return 'web';
    return 'docs';
  };
  const samples = new Map<Path['path'], { usd: number; bars: Map<string, { kind: Kind; start: number; end: number }> }[]>();
  for (const set of bySha.values()) {
    const ci = set.find((r) => r.name === 'CI' && r.conclusion === 'success');
    if (!ci) continue;
    const t0 = Math.min(...set.map((r) => t(r.created_at)));
    const bars = new Map<string, { kind: Kind; start: number; end: number }>();
    let usd = 0;
    for (const r of set) {
      if (!['CI', 'DCO', 'Labeler', 'Claude review'].includes(r.name)) continue;
      for (const j of d.jobs[String(r.id)] ?? []) {
        const c = jobCost(j);
        if (!c.kind || j.conclusion !== 'success' || !j.started_at || !j.completed_at) continue;
        usd += c.usd;
        bars.set(j.name, { kind: c.kind, start: (t(j.started_at) - t0) / 1000, end: (t(j.completed_at) - t0) / 1000 });
      }
    }
    const p = pathOf(d.jobs[String(ci.id)] ?? []);
    samples.set(p, [...(samples.get(p) ?? []), { usd, bars }]);
  }
  const paths: Path[] = (['docs', 'web', 'swift'] as const).map((path) => {
    const s = samples.get(path) ?? [];
    const names = new Set(s.flatMap((x) => [...x.bars.keys()]));
    const bars: Bar[] = [...names]
      .map((job) => {
        const hits = s.map((x) => x.bars.get(job)).filter((b) => b !== undefined);
        // A job on fewer than a quarter of these pushes isn't part of the typical one.
        if (hits.length * 4 < s.length) return null;
        const counts = new Map<Kind, number>();
        for (const h of hits) counts.set(h.kind, (counts.get(h.kind) ?? 0) + 1);
        const kind = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'linux';
        return { job, kind, start_s: round(median(hits.map((h) => h.start)) ?? 0, 0), end_s: round(median(hits.map((h) => h.end)) ?? 0, 0) };
      })
      .filter((b): b is Bar => b !== null)
      .sort((a, b) => a.start_s - b.start_s);
    return { path, runs: s.length, usd_push: round(median(s.map((x) => x.usd)) ?? 0, 3), bars };
  });
  return {
    from: iso(from),
    to: iso(now),
    merges: d.pulls.filter((p) => p.merged_at && t(p.merged_at) >= from && t(p.merged_at) <= now).length,
    span_hours: round((now - Math.min(now, ...runs.map((r) => t(r.created_at)))) / 3_600_000, 1),
    rebases_per_merge: rebasesPerMerge(d, cfg, now),
    gates: gateStates(d, cfg, now),
    hosted_usd: round(jobs.filter((j) => j.kind !== 'blacksmith').reduce((a, j) => a + j.usd, 0), 2),
    blacksmith_minutes: jobs.filter((j) => j.kind === 'blacksmith').reduce((a, j) => a + j.minutes, 0),
    jobs,
    paths,
  };
}
