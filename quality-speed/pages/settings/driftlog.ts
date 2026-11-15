// SPDX-License-Identifier: Apache-2.0
// The drift log: what the collector remembers between runs, to time fixes and the gaps between complete reads. It holds
// setting ids from expected-settings.json and UTC times only. The daily run keeps it as an artifact.
import type { SettingResult } from './settings.ts';

export interface DriftEvent {
  setting: string;
  detected_at: string;
  fixed_at: string | null;
  /** Hours from detection to the first read that matched again. */
  fix_hours: number | null;
}
export interface DriftLog {
  version: 2;
  /** When this log began. A young log can't vouch for drift it never saw, so fix time waits for it. */
  started_at: string;
  /** Times of complete reads, newest last. */
  full_reads: string[];
  events: DriftEvent[];
}

export const emptyLog = (now: string): DriftLog => ({ version: 2, started_at: now, full_reads: [], events: [] });
const HOUR_MS = 3_600_000;
const KEEP_DAYS = 90;
const KEEP_READS = 60;
export const hoursBetween = (a: string, b: string) => Math.round(((Date.parse(b) - Date.parse(a)) / HOUR_MS) * 100) / 100;

/** Accepts a parsed log only if it has the exact shape. Anything else starts a new log at `now`, which keeps fix time missing
 * until it has aged, so a lost log can never reset an open drift's age into a good number. */
export function parseLog(v: unknown, now: string): DriftLog {
  const l = v as DriftLog;
  const ok =
    typeof v === 'object' &&
    v !== null &&
    l.version === 2 &&
    typeof l.started_at === 'string' &&
    Number.isFinite(Date.parse(l.started_at)) &&
    Array.isArray(l.full_reads) &&
    Array.isArray(l.events);
  return ok ? l : emptyLog(now);
}

/** The log after one run at `now`. A setting that wasn't read changes nothing. */
export function advance(log: DriftLog, results: SettingResult[], now: string): DriftLog {
  const events = log.events.map((e) => ({ ...e }));
  const open = new Map(events.filter((e) => e.fixed_at === null).map((e) => [e.setting, e]));
  for (const r of results) {
    const event = open.get(r.id);
    if (r.status === 'match' && event) {
      event.fixed_at = now;
      event.fix_hours = hoursBetween(event.detected_at, now);
    } else if (r.status === 'drift' && !event) {
      events.push({ setting: r.id, detected_at: now, fixed_at: null, fix_hours: null });
    }
  }
  const complete = results.length > 0 && results.every((r) => r.status !== 'unread');
  const cutoff = Date.parse(now) - KEEP_DAYS * 24 * HOUR_MS;
  return {
    ...log,
    full_reads: [...log.full_reads, ...(complete ? [now] : [])].slice(-KEEP_READS),
    events: events.filter((e) => e.fixed_at === null || Date.parse(e.fixed_at) >= cutoff),
  };
}
