// SPDX-License-Identifier: Apache-2.0
// The Settings page's collector, as core/collect.ts runs it: reads this repository's settings through the API (reads.ts),
// compares them with expected-settings.json, runs the planted-drift drill, and writes the records.
//
//   node quality-speed/pages/settings/collect.ts --out records.json
//
// In CI it reads with QS_SETTINGS_TOKEN, the read-only key, when the job has it, and otherwise with GH_TOKEN, the job's own
// token, which also reads Pages; CLAUDE_ENABLED_VAR is vars.CLAUDE_ENABLED. The drift log is the lane's memory, in facts/
// (core/detail.ts), and each setting's status goes to page/ for page.ts. Anything it can't read writes missing, never a good
// number. With a snapshot, lane_minutes is core/lane's laneRecord(): this lane's job minutes so far, read last so they cover
// every read. To try it from a session signed in to gh: add --gh --run-url <a run link of this repository> --detail <folder>.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MetricRecord } from '../../contract/format.ts';
import { laneRecord } from '../../core/lane/collect.ts';
import { advance, emptyLog, hoursBetween, parseLog, type DriftLog } from './driftlog.ts';
import { runDrill } from './drill.ts';
import { takeSnapshot, type Answer, type Fetcher, type Snapshot } from './reads.ts';
import { evaluate, loadExpected, resolveNested, workflowFacts, type Expected, type SettingResult, type TextFetcher, type WorkflowFacts } from './settings.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXPECTED_FILE = path.join(HERE, 'expected-settings.json');
const PAGE = 'settings' as const;
const WINDOW_DAYS = 30;
const GAP_DAYS = 14;
/** A drift log younger than this can't vouch for drift it never saw, so fix time stays missing. */
export const MIN_LOG_DAYS = 7;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const METRIC_IDS = ['settings_drift_count', 'gates_intact', 'stop_budgets_ok', 'planted_drift_detected', 'drift_fix_hours', 'read_gap_hours', 'lane_minutes'] as const;
export type MetricId = (typeof METRIC_IDS)[number];
export const BILLING = ['stop_budgets', 'stop_budget_actions', 'budgets_not_stopping'];

export interface RunInfo {
  now: string;
  /** The run on the commit being scored. */
  sourceUrl: string;
}

const missing = (id: MetricId): MetricRecord => ({ id, page: PAGE, value: null, status: 'missing', stage: 'live', measured_at: null, source_url: null, sample_size: null });
const ok = (id: MetricId, value: number, sample: number, run: RunInfo, stage: MetricRecord['stage'] = 'live'): MetricRecord => ({
  id,
  page: PAGE,
  value,
  status: 'ok',
  stage,
  measured_at: run.now,
  source_url: run.sourceUrl,
  sample_size: sample,
});
const noEvents = (id: MetricId, run: RunInfo): MetricRecord => ({ id, page: PAGE, value: null, status: 'no_events', stage: 'live', measured_at: run.now, source_url: run.sourceUrl, sample_size: 0 });

/** A pass metric over some settings: a known drift reads 0 even if others are unread; otherwise anything unread is missing. */
function passOver(id: MetricId, results: SettingResult[], run: RunInfo): MetricRecord {
  if (results.length === 0) return missing(id);
  const read = results.filter((r) => r.status !== 'unread');
  if (results.some((r) => r.status === 'drift')) return ok(id, 0, read.length, run);
  return read.length === results.length ? ok(id, 1, read.length, run) : missing(id);
}

/** Every metric except the drill's, from this run's results and the drift log after it. */
export function score(expected: Expected, results: SettingResult[], log: DriftLog, run: RunInfo): MetricRecord[] {
  const complete = results.length > 0 && results.every((r) => r.status !== 'unread');
  const gates = new Set(expected.settings.filter((s) => s.gate).map((s) => s.id));
  const now = Date.parse(run.now);
  const out: MetricRecord[] = [
    complete ? ok('settings_drift_count', results.filter((r) => r.status === 'drift').length, results.length, run) : missing('settings_drift_count'),
    passOver('gates_intact', results.filter((r) => gates.has(r.id)), run),
    passOver('stop_budgets_ok', results.filter((r) => BILLING.includes(r.id)), run),
  ];

  // Fix time needs a complete read now (a partial read can't prove nothing drifted) and a log old enough to have seen it.
  if (!complete || now - Date.parse(log.started_at) < MIN_LOG_DAYS * DAY_MS) out.push(missing('drift_fix_hours'));
  else {
    const since = now - WINDOW_DAYS * DAY_MS;
    const fixes = log.events
      .filter((e) => e.fixed_at === null || (Date.parse(e.fixed_at) >= since && e.fix_hours !== null))
      .map((e) => (e.fixed_at === null ? hoursBetween(e.detected_at, run.now) : (e.fix_hours as number)));
    out.push(fixes.length ? ok('drift_fix_hours', Math.max(...fixes), fixes.length, run) : noEvents('drift_fix_hours', run));
  }

  // The longest gap between complete reads in the last 14 days, counting the time since the last one if this read wasn't complete.
  const reads = log.full_reads.map((t) => Date.parse(t)).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps = reads.slice(1).flatMap((t, i) => (t >= now - GAP_DAYS * DAY_MS ? [(t - (reads[i] as number)) / HOUR_MS] : []));
  if (!complete && reads.length) gaps.push((now - (reads[reads.length - 1] as number)) / HOUR_MS);
  out.push(gaps.length ? ok('read_gap_hours', Math.round(Math.max(...gaps) * 100) / 100, gaps.length, run) : missing('read_gap_hours'));
  return out;
}

export interface CollectOutput {
  records: MetricRecord[];
  status: SettingResult[];
  log: DriftLog;
}

/** One whole run. `snap` null means the snapshot couldn't be read: every live metric is missing and the log is unchanged. */
export async function collect(expected: Expected, snap: Snapshot | null, wf: WorkflowFacts | null, prior: DriftLog, run: RunInfo): Promise<CollectOutput> {
  const drill = await runDrill(score);
  const drillRecord = ok('planted_drift_detected', drill.passed ? 1 : 0, drill.cases, run, 'lab');
  if (!snap) {
    const records = METRIC_IDS.map((id) => (id === 'planted_drift_detected' ? drillRecord : missing(id)));
    return { records, status: expected.settings.map((s) => ({ id: s.id, status: 'unread' })), log: prior };
  }
  const results = evaluate(expected, snap, wf, new Date(run.now));
  const log = advance(prior, results, run.now);
  const records = score(expected, results, log, run);
  records.splice(3, 0, drillRecord);
  // No setting times the lane: main() puts core/lane's laneRecord() in its place.
  records.push(missing('lane_minutes'));
  return { records, status: results, log };
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const API_VERSION = '2022-11-28';
const parse = (text: string): unknown => {
  try {
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

/** Plain HTTPS with a token: a GET, or with a query one POST to /graphql, which only reads (reads.ts holds no mutation). */
export function tokenFetcher(token: string): Fetcher {
  return async (p: string, query?: string): Promise<Answer> => {
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': API_VERSION };
    const res = await fetch(`https://api.github.com${p}`, query === undefined ? { headers, redirect: 'error' } : { method: 'POST', headers, body: JSON.stringify({ query }), redirect: 'error' });
    return { status: res.status, body: parse(await res.text()) };
  };
}

/** The gh command line, for a session signed in through it. */
function ghFetcher(): Fetcher {
  return async (p: string, query?: string): Promise<Answer> => {
    const target = query === undefined ? [p.replace(/^\//, '')] : ['graphql', '-f', `query=${query}`];
    const out = spawnSync('gh', ['api', '-i', '-H', `X-GitHub-Api-Version: ${API_VERSION}`, ...target], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const text = out.stdout ?? '';
    const split = text.search(/\r?\n\r?\n/);
    return { status: Number(/^HTTP\/[\d.]+ (\d{3})/.exec(text)?.[1] ?? 0), body: split < 0 ? null : parse(text.slice(split)) };
  };
}

/** Public files over HTTPS, with no credentials. */
export const publicText: TextFetcher = async (url) => {
  try {
    const res = await fetch(url, { redirect: 'error' });
    return res.status === 200 ? await res.text() : null;
  } catch {
    return null;
  }
};

/** This run's link, from the variables every Actions job has. */
function runUrl(): string | undefined {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  return GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const out = arg(args, '--out');
  const sourceUrl = arg(args, '--run-url') ?? runUrl();
  const detail = arg(args, '--detail') ?? process.env.DETAIL_DIR;
  if (!out || !sourceUrl || !detail) throw new Error('usage: collect.ts --out <file>, inside core/collect.ts; see the header');
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const expected = loadExpected(EXPECTED_FILE);

  const wf: WorkflowFacts | null = existsSync('.github/workflows') ? workflowFacts('.github/workflows') : null;
  if (wf) wf.all_uses = await resolveNested(wf.uses, publicText);
  const own = process.env.GH_TOKEN;
  const key = process.env.QS_SETTINGS_TOKEN ?? own;
  const fetcher = args.includes('--gh') ? ghFetcher() : key ? tokenFetcher(key) : null;
  const snap: Snapshot | null = fetcher
    ? await takeSnapshot(fetcher, new Date(now), {
        known: wf ? { secrets: wf.secrets, environments: wf.environments } : null,
        claudeEnabled: process.env.CLAUDE_ENABLED_VAR,
        builtin: own ? tokenFetcher(own) : undefined,
      })
    : null;

  const prevLog = process.env.PREV_DIR ? path.join(process.env.PREV_DIR, 'facts', 'drift-log.json') : '';
  const prior = prevLog && existsSync(prevLog) ? parseLog(readJson(prevLog), now) : emptyLog(now);
  const result = await collect(expected, snap, wf, prior, { now, sourceUrl });
  const lane = snap ? await laneRecord('settings') : null;
  if (lane) result.records = result.records.map((r) => (r.id === lane.id ? lane : r));
  mkdirSync(path.join(detail, 'facts'), { recursive: true });
  mkdirSync(path.join(detail, 'page'), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result.records)}\n`);
  writeFileSync(path.join(detail, 'page', 'settings-status.json'), `${JSON.stringify(result.status)}\n`);
  writeFileSync(path.join(detail, 'facts', 'drift-log.json'), `${JSON.stringify(result.log)}\n`);
  for (const [id, r] of Object.entries(snap?.reads ?? {})) console.log(`${id}: ${r.status}`);
  for (const r of result.records) console.log(`${r.id}: ${r.status}`);
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : 'collect failed');
    process.exit(1);
  });
}
