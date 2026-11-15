// SPDX-License-Identifier: Apache-2.0
// The member's visit for "Since your last visit" on the Overview and Documents (D17): the room's record (POST
// /api/seen) when it answers, else this browser's copy in localStorage, which is kept current either way so it can
// stand in. Storage may be blocked (private windows, cleared site data): then, with no answer from the room, every
// load is a first visit. The rule itself is overview-news-visit.ts, shared with the Worker.
import { postSeen } from './files-api.ts';
import { nextVisit, parseVisit, VISIT_KEY, type Visit } from './overview-news-visit.ts';

function readLocal(): Visit | null {
  try {
    return parseVisit(localStorage.getItem(VISIT_KEY));
  } catch {
    return null;
  }
}

function writeLocal(visit: Visit): void {
  try {
    localStorage.setItem(VISIT_KEY, JSON.stringify(visit));
  } catch {
    // Nothing to do: the next load without the room's answer is a first visit again.
  }
}

/** This browser's visit for a load at `now`, advanced and stored: the fallback, and what shows until the room answers. */
export function localVisit(now: Date): Visit {
  const visit = nextVisit(readLocal(), now);
  writeLocal(visit);
  return visit;
}

/** The visit the room records for this load, or `local` when it cannot answer. The browser keeps the room's copy. */
export async function roomVisit(local: Visit): Promise<Visit> {
  const recorded = await postSeen();
  if (!recorded) return local;
  writeLocal(recorded);
  return recorded;
}
