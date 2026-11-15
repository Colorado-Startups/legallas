// SPDX-License-Identifier: Apache-2.0
// The failure drill, which lets recovery time read "no events" (contract/README.md, "A clean reading needs proof").
// Each run copies the live history, plants three invented failures shaped like GitHub's own records (a revert made with
// GitHub's button, a follow-up fix, and a change that turned main's CI red), and runs the same analysis. It passes only
// if all three are found with the exact recovery times planted, the real results are unchanged, every real change has a
// CI result on main (so a run that read no CI records can't pass), and every real repair on the reviewed list
// (reviewed.json), whatever its age, is found in the live history, and that list was refreshed within REVIEW_DAYS.
// Nothing planted is ever written out.
import {
  DAY_MS,
  HOUR_MS,
  REPO_FULL,
  REVIEW_DAYS,
  analyze,
  changeFailureRate,
  recoveryTime,
  reworkRate,
  type Analysis,
  type History,
  type RawPull,
  type Reviewed,
  type RawRun,
} from './delivery.ts';

export interface DrillResult {
  passed: boolean;
  /** Which checks held, for the log. Names only. */
  checks: Record<string, boolean>;
}

const iso = (t: number) => new Date(t).toISOString();
const fakeSha = (n: number) => n.toString(16).padStart(40, 'd');

/** The live history plus the planted records, and what the analysis must find. */
export interface Planted {
  planted: History;
  expect: { failed: Record<'revert' | 'follow_up' | 'red_main', [number, number]>; repairs: number[]; top: number };
}

export function plant(history: History, now: number): Planted {
  const templatePull = history.pulls.find((p) => p.base.ref === 'main' && p.merged_at !== null);
  const templateRun = history.runs[0];
  if (!templatePull || !templateRun) throw new Error('no live records to shape the drill on');
  const top = Math.max(0, ...history.pulls.map((p) => p.number), ...history.issues);
  const n = top + 100_000;
  const t = now - 10 * DAY_MS;

  const pull = (number: number, mergedAt: number, title: string, body: string | null, head: string): RawPull => ({
    ...templatePull,
    number,
    title,
    body,
    created_at: iso(mergedAt - HOUR_MS),
    merged_at: iso(mergedAt),
    merge_commit_sha: fakeSha(number),
    base: { ...templatePull.base, ref: 'main' },
    head: { ...templatePull.head, ref: head },
    user: { type: 'User', login: 'invented-drill' },
  });
  const run = (id: number, sha: string, at: number, conclusion: string): RawRun => ({
    ...templateRun,
    id,
    head_sha: sha,
    event: 'push',
    head_branch: 'main',
    status: 'completed',
    conclusion,
    created_at: iso(at),
    updated_at: iso(at + 5 * 60_000),
  });

  const reverted = n + 1;
  const followed = n + 3;
  const red = n + 5;
  const pulls = [
    pull(reverted, t, 'Drill change', null, 'drill-change'),
    pull(n + 2, t + 2 * HOUR_MS, 'Revert "Drill change"', `Reverts ${REPO_FULL}#${reverted}`, `revert-${reverted}-drill-change`),
    pull(followed, t + 3 * HOUR_MS, 'Drill change two', null, 'drill-two'),
    pull(n + 4, t + 4 * HOUR_MS, 'Drill fix', `A follow-up to ${REPO_FULL}#${followed}, from review.`, 'drill-fix'),
    pull(red, t + 5 * HOUR_MS, 'Drill change three', null, 'drill-three'),
  ];
  const runs = [
    run(n + 10, fakeSha(red), t + 5 * HOUR_MS + 60_000, 'failure'),
    run(n + 11, fakeSha(n + 99), t + 8 * HOUR_MS, 'success'),
  ];
  const facts = new Map(history.facts);
  for (const p of pulls) facts.set(p.number, { firstCommitAt: p.created_at, files: ['docs/drill.md'] });

  return {
    planted: { ...history, pulls: [...history.pulls, ...pulls], facts, runs: [...history.runs, ...runs] },
    expect: {
      // Hours from each planted failure's merge to its repair, or to the end of the next green run on main.
      failed: { revert: [reverted, 2], follow_up: [followed, 1], red_main: [red, 3 + 5 / 60] },
      repairs: [n + 2, n + 4],
      top,
    },
  };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

export function drill(history: History, live: Analysis, now: number, reviewed: Reviewed): DrillResult {
  const checks: Record<string, boolean> = {};
  try {
    const { planted, expect } = plant(history, now);
    const a = analyze(planted, now, reviewed);
    for (const [name, [number, hours]] of Object.entries(expect.failed)) {
      const f = a.failures.find((x) => x.number === number);
      checks[`found_${name}`] = f?.recoveredAt != null && near((f.recoveredAt - f.mergedAt) / HOUR_MS, hours);
    }
    checks.found_repairs = expect.repairs.every((r) => a.changes.find((c) => c.number === r)?.repairs.length === 1);
    checks.rates_count_planted =
      changeFailureRate(a).samples === changeFailureRate(live).samples + 5 &&
      reworkRate(a).samples === reworkRate(live).samples + 5 &&
      recoveryTime(a).samples >= recoveryTime(live).samples + 3;
    const real = (x: Analysis) => x.failures.filter((f) => f.number <= expect.top).map((f) => f.number).join(',');
    checks.real_failures_unchanged = real(a) === real(live);
    checks.ci_results_cover_window = live.ciUnresolved.length === 0;
    checks.recall_real_repairs =
      reviewed.repairs.length > 0 && reviewed.repairs.every(({ pr, repairs }) => live.repairsOf.get(pr)?.includes(repairs) === true);
    const through = Date.parse(`${reviewed.reviewed_through}T00:00:00Z`);
    checks.review_fresh = Number.isFinite(through) && through <= now && now - through <= REVIEW_DAYS * DAY_MS;
  } catch {
    checks.planted = false;
  }
  const values = Object.values(checks);
  return { passed: values.length > 0 && values.every(Boolean), checks };
}
