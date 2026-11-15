// SPDX-License-Identifier: Apache-2.0
// Launch readiness collector, the daily lane. A condition is met when its evidence is a pull request merged into main or
// an issue closed as completed in this repository. Only conditions a session can close and a lane can read are scored: the
// owner's, and those whose evidence is a Project 1 card (no lane token reads the board), are shown, not scored. Writes
// records in the shared format (quality-speed/contract) to the --out file, and each scored condition met or not to
// $DETAIL_DIR/detail.json. Any failed read makes every record "missing": an API error never reads as progress.
//
// Last, the lane's own job minutes (core/lane), missing outside CI.
//
//   GH_TOKEN=... node quality-speed/pages/launch-readiness/collect.ts --out <file>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { MetricRecord } from '../../contract/format.ts';
import { laneRecord } from '../../core/lane/collect.ts';

const REPO = 'Colorado-Startups/legallas';
const DAY = 86_400_000;
/** The pace window, four whole weeks so weekdays even out, and the reading when nothing closed in it. */
export const WINDOW_DAYS = 28;
export const NO_PACE_DAYS = 365;

export interface Condition {
  id: string;
  group: string;
  label: string;
  owner: boolean;
  from: 'gate' | 'review' | 'brief';
  /** A condition that can't start until this one is met. It doesn't count as open for speed until then. */
  after?: string;
  /** An issue or pull request number here, or a Project 1 card's item id. */
  evidence: Evidence;
  /** The eval that tests it, a path in this repository: the row links it until the condition has evidence. */
  eval?: string;
}
export type Evidence = number | { card: number } | null;
export interface Conditions {
  start: string;
  groups: string[];
  conditions: Condition[];
}
/** What the API said about one piece of evidence: when it was done, else null. */
export type MetAt = string | null;
/** The key an evidence's answer is kept under. */
export const keyOf = (e: Exclude<Evidence, null>) => (typeof e === 'number' ? `issue:${e}` : `card:${e.card}`);
export interface DetailRow {
  id: string;
  met: boolean;
  met_at: string | null;
  evidence: Evidence;
  /** A session can close it and a lane can read it. */
  scored: boolean;
  /** Its `after` condition isn't met yet. */
  waiting: boolean;
}

/** When `GET /repos/{repo}/issues/{n}` (and, for a pull request, `GET /repos/{repo}/pulls/{n}`) counts as done. */
export function metAt(item: unknown, pull?: unknown): MetAt {
  const i = item as { state?: unknown; state_reason?: unknown; closed_at?: unknown; pull_request?: unknown };
  if (i.pull_request) {
    const p = pull as { merged_at?: unknown; base?: { ref?: unknown } } | undefined;
    return p?.base?.ref === 'main' && typeof p.merged_at === 'string' ? p.merged_at : null;
  }
  return i.state === 'closed' && i.state_reason === 'completed' && typeof i.closed_at === 'string' ? i.closed_at : null;
}

/** Scored: not the owner's, and its evidence isn't a card, which no lane token can read. */
export const isScored = (c: Condition) => !c.owner && (c.evidence === null || typeof c.evidence === 'number');

/**
 * Scored conditions open now, over the pace of the last 28 days, in days: 0 when none is open, 365 at most and when
 * nothing closed. A condition still waiting for another isn't open yet.
 */
export function daysToClear(all: readonly DetailRow[], now: Date): number {
  const rows = all.filter((r) => r.scored);
  const open = rows.filter((r) => !r.met && !r.waiting).length;
  if (open === 0) return 0;
  const since = now.getTime() - WINDOW_DAYS * DAY;
  const recent = rows.filter((r) => r.met_at !== null && Date.parse(r.met_at) > since).length;
  if (recent === 0) return NO_PACE_DAYS;
  return Math.min(NO_PACE_DAYS, Math.round((10 * open * WINDOW_DAYS) / recent) / 10);
}

/** Each condition's state, from the API's answer for each piece of evidence. */
export function detail(list: Conditions, answers: ReadonlyMap<string, MetAt>): DetailRow[] {
  const at = (c: Condition | undefined) => (c?.evidence == null ? null : (answers.get(keyOf(c.evidence)) ?? null));
  const byId = new Map(list.conditions.map((c) => [c.id, c]));
  return list.conditions.map((c) => {
    const met_at = at(c);
    const waiting = c.after !== undefined && at(byId.get(c.after)) === null;
    return { id: c.id, met: met_at !== null, met_at, evidence: c.evidence, scored: isScored(c), waiting };
  });
}

/** The share of scored conditions met, and days_to_clear. */
export function records(list: Conditions, rows: readonly DetailRow[], now: Date, source_url: string): MetricRecord[] {
  const measured_at = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const base = { page: 'launch-readiness' as const, status: 'ok' as const, stage: 'live' as const, measured_at, source_url };
  const scored = rows.filter((r) => r.scored);
  const met = scored.filter((r) => r.met).length;
  return [
    { ...base, id: 'conditions_met', value: Math.round((10_000 * met) / scored.length) / 100, sample_size: scored.length },
    { ...base, id: 'days_to_clear', value: daysToClear(rows, now), sample_size: scored.length },
  ];
}

export const IDS = ['conditions_met', 'days_to_clear'] as const;

export function missing(ids: readonly string[] = IDS): MetricRecord[] {
  const blank = { page: 'launch-readiness' as const, status: 'missing' as const, value: null, stage: 'live' as const, measured_at: null, source_url: null, sample_size: null };
  return ids.map((id) => ({ ...blank, id }));
}

async function get(route: string, token: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com/${route}`, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' },
  });
  if (res.status !== 200) throw new Error(`read failed: HTTP ${res.status}`);
  return res.json();
}

/** Every issue or pull request number, read once. Cards are never read. */
async function readAll(list: Conditions, token: string): Promise<Map<string, MetAt>> {
  const answers = new Map<string, MetAt>();
  for (const e of list.conditions.flatMap((c) => (typeof c.evidence === 'number' ? [c.evidence] : []))) {
    const key = keyOf(e);
    if (answers.has(key)) continue;
    const item = await get(`repos/${REPO}/issues/${e}`, token);
    answers.set(key, metAt(item, (item as { pull_request?: unknown }).pull_request ? await get(`repos/${REPO}/pulls/${e}`, token) : undefined));
  }
  return answers;
}

/** Each scored condition met or not, for the page's drill-down (core/detail.ts): ids and 0 or 1 only. */
export function checks(rows: readonly DetailRow[]): { checks: Record<string, 0 | 1>; readings: Record<string, never> } {
  return { checks: Object.fromEntries(rows.filter((r) => r.scored).map((r) => [r.id, r.met ? 1 : 0])), readings: {} };
}

if (import.meta.main) {
  const at = process.argv.indexOf('--out');
  const out = at > 0 ? process.argv[at + 1] : undefined;
  if (!out) throw new Error('usage: collect.ts --out <file>');
  const list: Conditions = JSON.parse(readFileSync(new URL('conditions.json', import.meta.url), 'utf8'));
  const now = new Date();
  let written: MetricRecord[];
  try {
    const run = process.env.GITHUB_RUN_ID;
    const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
    if (!run || !/^[1-9]\d*$/.test(run)) throw new Error('not in a workflow run');
    if (!token) throw new Error('GH_TOKEN is not set');
    const rows = detail(list, await readAll(list, token));
    written = records(list, rows, now, `https://github.com/${REPO}/actions/runs/${run}`);
    if (process.env.DETAIL_DIR) writeFileSync(path.join(process.env.DETAIL_DIR, 'detail.json'), `${JSON.stringify(checks(rows))}\n`);
  } catch (e) {
    // Only this collector's own fixed messages reach the log.
    console.error(`launch readiness: ${e instanceof Error && /^(read failed|not in|GH_TOKEN)/.test(e.message) ? e.message : 'unexpected error'}; every metric is missing`);
    written = missing();
  }
  written.push(await laneRecord('launch-readiness'));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(written, null, 2)}\n`);
}
