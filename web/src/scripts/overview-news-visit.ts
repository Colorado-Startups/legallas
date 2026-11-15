// SPDX-License-Identifier: Apache-2.0

/** The room's stored name as a literal (worker/stored-name.ts): the minified key stays one, and a stored key can be read. */
declare const ROOM_STORED_NAME: string | undefined;
// What "Since your last visit" means (D17): one rule for the server's record (worker/seen.ts, POST /api/seen) and
// this browser's fallback copy (overview-news-seen.ts). A page load within VISIT_GAP_MS of the last one continues
// the visit; a later one starts a new visit, measured from the last load. No DOM types here: the Worker imports it.

/** A visit to the room: when the previous visit ended and when the latest page load happened. */
export interface Visit {
  /** The end of the previous visit, what "new" is measured from; null on a first visit. */
  since: string | null;
  /** The latest page load of this visit. */
  seen: string;
}

/** The browser's copy, for when the server cannot answer (localStorage; never trusted as it comes back). */
export const VISIT_KEY = `${typeof ROOM_STORED_NAME === 'string' ? ROOM_STORED_NAME : 'legallas'}.overview.visit`;
/** The idle time, 30 minutes, that separates one visit from the next. */
export const VISIT_GAP_MS = 30 * 60 * 1000;
/** With no earlier visit, "new" means this many days back. */
export const FIRST_VISIT_DAYS = 30;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** A UTC instant as toISOString writes it (milliseconds optional). */
export function isInstant(value: unknown): value is string {
  return typeof value === 'string' && ISO.test(value) && !Number.isNaN(Date.parse(value));
}

/** A visit from anything (storage, a response body, a row), or null when it is not one. */
export function toVisit(value: unknown): Visit | null {
  if (typeof value !== 'object' || value === null) return null;
  const { since, seen } = value as Partial<Record<keyof Visit, unknown>>;
  if (!isInstant(seen)) return null;
  return { since: isInstant(since) ? since : null, seen };
}

/** The stored visit, or null when it is missing or not ours (never trust what storage hands back). */
export function parseVisit(raw: string | null): Visit | null {
  if (!raw) return null;
  try {
    return toVisit(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The visit this page load belongs to: the same one within the gap, otherwise a new one starting from `seen`. */
export function nextVisit(stored: Visit | null, now: Date): Visit {
  const seen = now.toISOString();
  if (!stored) return { since: null, seen };
  const gap = now.getTime() - Date.parse(stored.seen);
  if (gap >= 0 && gap < VISIT_GAP_MS) return { since: stored.since, seen };
  return { since: stored.seen, seen };
}

/** The instant "new" is measured from: the last visit, or FIRST_VISIT_DAYS back on a first visit. */
export function newsCutoff(visit: Visit, now: Date): string {
  return visit.since ?? new Date(now.getTime() - FIRST_VISIT_DAYS * 86_400_000).toISOString();
}
