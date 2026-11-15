// SPDX-License-Identifier: Apache-2.0
// "New since your last visit" on the server (D17, migration 0008): POST /api/seen records this page load for the
// signed-in member and answers the visit it belongs to, `{ since, seen }`, so the Overview and Documents mark what
// was added or changed since the member's previous visit on any browser. The visit rule is the room's one rule,
// src/scripts/overview-news-visit.ts (nextVisit), shared with the browser's fallback copy. index.ts has already
// checked the write's Origin and Sec-Fetch-Site, as for every room write. The row holds two instants and nothing else.
import { canPerform } from './auth.ts';
import type { RequestContext } from './env.ts';
import { errorJson, json } from './http.ts';
import type { Route } from './router.ts';
import { isInstant, nextVisit, type Visit } from '../src/scripts/overview-news-visit.ts';

export const SEEN_PATH = '/api/seen';

interface SeenRow {
  last_seen_at: string;
  since_at: string | null;
}

/** The member's stored visit, or null on a first visit (or a row that is not a pair of instants). */
async function storedVisit(db: D1Database, email: string): Promise<Visit | null> {
  const row = await db.prepare('SELECT last_seen_at, since_at FROM member_seen WHERE email = ?1').bind(email).first<SeenRow>();
  if (!row || !isInstant(row.last_seen_at)) return null;
  return { since: isInstant(row.since_at) ? row.since_at : null, seen: row.last_seen_at };
}

/**
 * Records a page load at `now` for `email` and returns its visit. Two tabs loading at once both read the same row
 * and write the same visit, so the race is harmless.
 */
export async function recordVisit(db: D1Database, email: string, now: Date): Promise<Visit> {
  const visit = nextVisit(await storedVisit(db, email), now);
  await db
    .prepare(
      'INSERT INTO member_seen (email, last_seen_at, since_at) VALUES (?1, ?2, ?3) ' +
        'ON CONFLICT (email) DO UPDATE SET last_seen_at = excluded.last_seen_at, since_at = excluded.since_at',
    )
    .bind(email, visit.seen, visit.since)
    .run();
  return visit;
}

async function postSeen(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'view')) return errorJson('forbidden', 403);
  try {
    return json(await recordVisit(c.env.DB, c.member.email, new Date()));
  } catch (error) {
    // Before migration 0008 reaches this database the table is missing: the page keeps its browser's copy.
    if (!/no such table/i.test(String(error))) throw error;
    console.error('seen_unavailable');
    return errorJson('unavailable', 503);
  }
}

export const routes: Route[] = [{ method: 'POST', path: SEEN_PATH, handler: postSeen }];
