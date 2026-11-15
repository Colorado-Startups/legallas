// SPDX-License-Identifier: Apache-2.0
// The pure half of the owner's activity page (src/scripts/activity.ts): readable action names, the ledger's
// local timestamp, and the per-day counts behind the sparkline (drawn by F5b's viz/spark.ts). No DOM, so node --test covers it.
import type { ActivityAction } from '../../worker/audit.ts';

/**
 * What each audited action reads as in the ledger and the Action filter. `satisfies` makes a new action in
 * ACTIVITY_ACTIONS fail the build until it has a label; extra keys label actions the server may not send yet.
 */
export const ACTION_LABELS = {
  sign_in: 'Signed in',
  view: 'Viewed',
  download: 'Downloaded',
  upload: 'Uploaded',
  comment: 'Commented',
  resolve: 'Resolved a comment',
  reopen: 'Reopened a comment',
  key: 'Marked key',
  unkey: 'Unmarked key',
  ai_question: 'Asked a question',
  sync_added: 'Sync added a file',
  sync_changed: 'Sync changed a file',
  sync_removed: 'Sync removed a file',
  // The AI connect integration (its migration 0004); labelled ahead of it so the ledger reads well either way.
  ai_search: 'Searched via AI',
  ai_read: 'Read via AI',
  // Proposal steps (worker/audit.ts PROPOSAL_ACTIVITY), in the feed while the room's proposals are on.
  proposal_proposed: 'Proposed via AI',
  proposal_approved: 'Approved a proposal',
  proposal_approved_edited: 'Edited and approved a proposal',
  proposal_rejected: 'Rejected a proposal',
  // Checklist changes (worker/audit.ts CHECKLIST_ACTIVITY), in the feed while the room's checklist is on; the chip is the item's id.
  checklist_matched: 'Matched a checklist item',
  checklist_match_changed: 'Changed a checklist match',
  checklist_unmatched: 'Removed a checklist match',
  checklist_not_applicable: 'Marked a checklist item not applying',
  checklist_applies: 'Marked a checklist item applying',
  ai_connect: 'Connected an AI app',
  ai_disconnect: 'Disconnected an AI app',
} as const satisfies Record<ActivityAction, string> & Record<string, string>;

/** The Action filter's choices: only actions the server accepts today, in label order. */
export function filterActions(accepted: readonly string[]): [string, string][] {
  return Object.entries(ACTION_LABELS).filter(([action]) => accepted.includes(action));
}

/** The label for an action, or the raw value if the server knows one this page does not yet. */
export function actionLabel(action: string): string {
  return Object.hasOwn(ACTION_LABELS, action) ? ACTION_LABELS[action as keyof typeof ACTION_LABELS] : action;
}

/** The Full notice panel's Status words for one member's last tick (notice-ticks.ts). */
export function tickStatus(tick: { version: string | null; current: boolean }): string {
  if (tick.current) return 'Current';
  return tick.version === null ? 'Not yet ticked' : 'Earlier version: asked again at next visit';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-01 14:03" in the browser's time zone: ISO order for a mono table column. */
export function formatWhen(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Days the sparkline covers, ending today (UTC, like the date filters). */
export const SPARK_DAYS = 30;
const DAY_MS = 86_400_000;

/** One day in an activity sparkline: its UTC date and the count for that day. */
export interface SparkDay {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  count: number;
  /** False when older rows not yet loaded could still add to this day. */
  complete: boolean;
}

/** The UTC day of a timestamp, or null when it does not parse. */
export function utcDay(ts: string): string | null {
  const time = Date.parse(ts);
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
}

/**
 * Rows per UTC day over the SPARK_DAYS ending on `today`, oldest first. The ledger loads a page at a time, so
 * while older rows remain (`hasMore`) every day up to and including the oldest loaded row's day is incomplete.
 */
export function dailyCounts(timestamps: readonly string[], today: string, hasMore: boolean): SparkDay[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  const counts = new Map<string, number>();
  let oldest: string | null = null;
  for (const ts of timestamps) {
    const day = utcDay(ts);
    if (day === null) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
    if (oldest === null || day < oldest) oldest = day;
  }
  const days: SparkDay[] = [];
  for (let i = SPARK_DAYS - 1; i >= 0; i--) {
    const day = new Date(end - i * DAY_MS).toISOString().slice(0, 10);
    const complete = !hasMore || (oldest !== null && day > oldest);
    days.push({ day, count: counts.get(day) ?? 0, complete });
  }
  return days;
}

/** The sparkline's series: complete days carry their count; days still loading are NaN, so the line skips them. */
export function sparkValues(days: readonly SparkDay[]): number[] {
  return days.map((d) => (d.complete ? d.count : Number.NaN));
}

/** One sentence for the sparkline's caption and accessible name. */
export function sparkSummary(days: readonly SparkDay[], noun: string): string {
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const first = days.find((d) => d.complete);
  const peak = days.reduce<SparkDay | null>((best, d) => (d.count > (best?.count ?? 0) ? d : best), null);
  const head = `${total} ${noun} in the last ${days.length} days`;
  const busiest = peak ? `, most on ${peak.day} (${peak.count})` : '';
  if (!first) return `${head}${busiest}. Older activity is still to load.`;
  if (first !== days[0]) return `${head}${busiest}. Complete from ${first.day}; load older activity to fill the rest.`;
  return `${head}${busiest}.`;
}
