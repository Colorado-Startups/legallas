// SPDX-License-Identifier: Apache-2.0
// The planted-drift drill. On invented API answers (fixtures/), it proves the collector catches what it is meant to catch: a clean
// set reads no drift, each planted drift is caught alone (with the settings that follow from it), a refused read reads missing and
// never as a value, names no workflow uses never reach the snapshot, and the fix clock and read gap come out right. collect.ts
// runs it every time and reports planted_drift_detected.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MetricRecord } from '../../contract/format.ts';
import { advance, emptyLog, type DriftLog } from './driftlog.ts';
import { takeSnapshot, type Answer, type Fetcher, type Snapshot } from './reads.ts';
import { evaluate, loadExpected, type Expected, type SettingResult, type WorkflowFacts } from './settings.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');
const R = '/repos/Colorado-Startups/legallas';
const T0 = '2026-11-02T06:00:00Z';
const T1 = '2026-11-03T06:00:00Z';
const T2 = '2026-11-04T06:00:00Z';
/** An old log start, so the clock cases aren't held back by the young-log rule, which case 8 tests on its own. */
const LONG_AGO = '2026-09-01T00:00:00Z';
const RUN = 'https://github.com/Colorado-Startups/legallas/actions/runs/1';

export type Api = Record<string, Answer>;
export type Vars = Record<string, string>;
interface Change {
  path: string;
  op: 'set' | 'remove' | 'status';
  at?: (string | number)[];
  value?: unknown;
}
export interface Plant {
  setting: string;
  changes: Change[];
  also?: string[];
}
export interface DrillResult {
  passed: boolean;
  cases: number;
  /** Case names that failed: setting ids and fixed labels only. */
  failures: string[];
}
type Run = { now: string; sourceUrl: string };
export type Scorer = (e: Expected, results: SettingResult[], log: DriftLog, run: Run) => MetricRecord[];
/** The invented answers, workflows, variables and plants; tests swap one to prove the drill fails when it should. */
export interface Fixtures {
  api: Api;
  wf: WorkflowFacts;
  vars: Vars;
  plants: Plant[];
}

export const load = <T>(name: string): T => JSON.parse(readFileSync(path.join(FIX, name), 'utf8')) as T;
const clone = <T>(v: T): T => structuredClone(v);
export const fixtureFetcher = (api: Api): Fetcher => async (p) => clone(api[p] ?? { status: 404, body: null });

/** Applies one change to the invented answers, workflows or variables. Throws on a path that doesn't exist, so a stale plant fails. */
export function applyChange(api: Api, wf: WorkflowFacts, vars: Vars, change: Change): void {
  if (change.op === 'status') {
    const a = api[change.path];
    if (!a) throw new Error('no fixture for a planted path');
    a.status = change.value as number;
    a.body = null;
    return;
  }
  const root: unknown = change.path === 'workflows' ? wf : change.path === 'vars' ? vars : api[change.path];
  const at = change.at ?? [];
  if (root === undefined || at.length === 0) throw new Error('a plant needs a fixture and a path');
  let node = root as Record<string | number, unknown>;
  for (const key of at.slice(0, -1)) {
    node = node[key] as Record<string | number, unknown>;
    if (typeof node !== 'object' || node === null) throw new Error('a plant path runs past the fixture');
  }
  const last = at[at.length - 1] as string | number;
  if (change.op === 'set') node[last] = clone(change.value);
  else if (Array.isArray(node)) node.splice(last as number, 1);
  else delete node[last];
}

async function snapshotOf(api: Api, wf: WorkflowFacts, vars: Vars, now: string): Promise<Snapshot> {
  return takeSnapshot(fixtureFetcher(api), new Date(now), { known: { secrets: wf.secrets, environments: wf.environments }, claudeEnabled: vars.CLAUDE_ENABLED });
}
async function run(expected: Expected, api: Api, wf: WorkflowFacts, vars: Vars, now: string) {
  const snap = await snapshotOf(api, wf, vars, now);
  return { snap, results: evaluate(expected, snap, wf, new Date(now)) };
}
const drifted = (results: SettingResult[]) => results.filter((r) => r.status === 'drift').map((r) => r.id).sort();
const find = (records: MetricRecord[], id: string) => records.find((r) => r.id === id);

/** Every drill case. `score` is passed in to keep this module free of collect.ts, which runs the drill. */
export async function runDrill(score: Scorer, fixtures?: Partial<Fixtures>): Promise<DrillResult> {
  const expected = loadExpected(path.join(HERE, 'expected-settings.json'));
  const api = fixtures?.api ?? load<Api>('clean-api.json');
  const wf = fixtures?.wf ?? load<WorkflowFacts>('workflows.json');
  const vars = fixtures?.vars ?? load<Vars>('vars.json');
  const plants = fixtures?.plants ?? load<Plant[]>('plants.json');
  const failures: string[] = [];
  let cases = 0;
  const check = (name: string, pass: boolean) => {
    cases++;
    if (!pass) failures.push(name);
  };
  const info = (now: string): Run => ({ now, sourceUrl: RUN });
  const oldLog = (): DriftLog => emptyLog(LONG_AGO);

  // 1. Clean: everything matches and every quality metric is at goal.
  const clean = await run(expected, clone(api), clone(wf), clone(vars), T0);
  check('clean_all_match', clean.results.every((r) => r.status === 'match'));
  const cleanRecords = score(expected, clean.results, advance(oldLog(), clean.results, T0), info(T0));
  check('clean_drift_0', find(cleanRecords, 'settings_drift_count')?.value === 0);
  check('clean_gates_1', find(cleanRecords, 'gates_intact')?.value === 1);
  check('clean_budgets_1', find(cleanRecords, 'stop_budgets_ok')?.value === 1);

  // 2. Every setting has a plant, and each plant is caught with exactly the settings that follow from it.
  const planted = new Set(plants.map((p) => p.setting));
  check('every_setting_planted', expected.settings.every((s) => planted.has(s.id)));
  for (const plant of plants) {
    const a = clone(api);
    const w = clone(wf);
    const v = clone(vars);
    let applied = true;
    try {
      for (const c of plant.changes) applyChange(a, w, v, c);
    } catch {
      applied = false;
    }
    const { results } = await run(expected, a, w, v, T0);
    const want = [plant.setting, ...(plant.also ?? [])].sort();
    check(plant.setting, applied && JSON.stringify(drifted(results)) === JSON.stringify(want) && results.every((r) => r.status !== 'unread'));
  }

  // 3. A refused read is unread, never a value, and the metrics it feeds read missing.
  const refused = clone(api);
  applyChange(refused, wf, vars, { path: `${R}/actions/permissions/workflow`, op: 'status', value: 403 });
  const r3 = await run(expected, refused, clone(wf), clone(vars), T0);
  const r3Records = score(expected, r3.results, advance(oldLog(), r3.results, T0), info(T0));
  check('refused_is_unread', r3.results.find((r) => r.id === 'workflow_default_permissions')?.status === 'unread');
  check('refused_drift_missing', find(r3Records, 'settings_drift_count')?.status === 'missing');
  check('refused_gates_missing', find(r3Records, 'gates_intact')?.status === 'missing');
  check('refused_timing_missing', find(r3Records, 'drift_fix_hours')?.status === 'missing');
  const noVar = await run(expected, clone(api), clone(wf), {}, T0);
  check('unpassed_variable_is_unread', noVar.results.find((r) => r.id === 'claude_review_enabled')?.status === 'unread');

  // 4. A known gate drift reads 0 even when another gate couldn't be read.
  const both = clone(refused);
  applyChange(both, wf, vars, { path: R, op: 'set', at: ['body', 'visibility'], value: 'internal' });
  const r4 = await run(expected, both, clone(wf), clone(vars), T0);
  const r4Records = score(expected, r4.results, advance(oldLog(), r4.results, T0), info(T0));
  check('known_gate_drift_reads_0', find(r4Records, 'gates_intact')?.status === 'ok' && find(r4Records, 'gates_intact')?.value === 0);

  // 5. Without Administration read, a 404 on vulnerability alerts can't be told from "off", so it stays unread.
  const noAdmin = clone(api);
  applyChange(noAdmin, wf, vars, { path: `${R}/actions/permissions`, op: 'status', value: 403 });
  applyChange(noAdmin, wf, vars, { path: `${R}/vulnerability-alerts`, op: 'status', value: 404 });
  const r5 = await run(expected, noAdmin, clone(wf), clone(vars), T0);
  check('ambiguous_404_unread', r5.results.find((r) => r.id === 'vulnerability_alerts')?.status === 'unread');

  // 6. Names: a secret or environment no workflow on main uses is stored as unreferenced, never as itself.
  const named = clone(api);
  applyChange(named, wf, vars, { path: `${R}/actions/organization-secrets?per_page=100`, op: 'set', at: ['body'], value: { total_count: 1, secrets: [{ name: 'PLANTED_NAME', updated_at: T0 }] } });
  applyChange(named, wf, vars, { path: `${R}/environments?per_page=100`, op: 'set', at: ['body', 'environments', 0, 'name'], value: 'planted-env' });
  const namedSnap = await snapshotOf(named, clone(wf), clone(vars), T0);
  const text = JSON.stringify(namedSnap);
  check('unused_names_withheld', !text.includes('PLANTED_NAME') && !text.includes('planted-env'));

  // 7. The clock: clean at T0, drift at T1, fixed at T2. The fix took 24 hours, and so did each gap between reads.
  const drift = clone(api);
  applyChange(drift, wf, vars, { path: R, op: 'set', at: ['body', 'has_wiki'], value: true });
  let log = advance(oldLog(), clean.results, T0);
  const d1 = await run(expected, drift, clone(wf), clone(vars), T1);
  log = advance(log, d1.results, T1);
  check('open_drift_counts_its_age', find(score(expected, d1.results, log, info(T1)), 'drift_fix_hours')?.value === 0);
  const d2 = await run(expected, clone(api), clone(wf), clone(vars), T2);
  log = advance(log, d2.results, T2);
  const timed = score(expected, d2.results, log, info(T2));
  check('fix_24h', find(timed, 'drift_fix_hours')?.value === 24);
  check('gap_24h', find(timed, 'read_gap_hours')?.value === 24);

  // 8. Nothing drifted: fix time reads no_events, never a number. A young or lost log keeps it missing.
  const quiet = score(expected, clean.results, advance(oldLog(), clean.results, T0), info(T0));
  check('quiet_is_no_events', find(quiet, 'drift_fix_hours')?.status === 'no_events');
  const young = score(expected, clean.results, advance(emptyLog(T0), clean.results, T0), info(T0));
  check('young_log_is_missing', find(young, 'drift_fix_hours')?.status === 'missing');

  return { passed: failures.length === 0, cases, failures };
}
