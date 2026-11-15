// SPDX-License-Identifier: Apache-2.0
// Daily series from the drill-down rows, for the page's calendar and trend lines. Merged history doesn't change, so
// every run rebuilds its own trend from detail.json, with no stored history needed.
import { DAY_MS, median } from './delivery.ts';
import type { Detail } from './records.ts';

export interface Day {
  /** The UTC day, as YYYY-MM-DD. */
  t: string;
  changes: number;
  /** Changes merged that day that later needed repair. */
  failed: number;
  /** Percent of that day's changes that were rework, or null with no change. */
  rework: number | null;
  /** Median lead hours of that day's changes, or null. */
  lead: number | null;
  /** Percent of that day's changes (Dependabot's left out) tied to an issue, or null. */
  tied: number | null;
}

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 10000) / 100 : null);

/** The last `days` completed UTC days before `now`, oldest first, each filled from the rows merged that day. */
export function daily(detail: Detail, now: number, days = 28): Day[] {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const out: Day[] = [];
  for (let start = today - days * DAY_MS; start < today; start += DAY_MS) {
    const rows = detail.changes.filter((c) => {
      const at = Date.parse(c.merged_at);
      return at >= start && at < start + DAY_MS;
    });
    const people = rows.filter((c) => !c.dependabot);
    const lead = median(rows.map((c) => c.lead_hours));
    out.push({
      t: new Date(start).toISOString().slice(0, 10),
      changes: rows.length,
      failed: rows.filter((c) => c.failed).length,
      rework: pct(rows.filter((c) => c.rework).length, rows.length),
      lead: lead === null ? null : Math.round(lead * 1000) / 1000,
      tied: pct(people.filter((c) => c.tied).length, people.length),
    });
  }
  return out;
}

/** The days from the first one with a change, so a young repository's trend doesn't start with empty weeks. */
export function sinceFirst(days: Day[]): Day[] {
  const first = days.findIndex((d) => d.changes > 0);
  return first < 0 ? [] : days.slice(first);
}
