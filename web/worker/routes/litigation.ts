// SPDX-License-Identifier: Apache-2.0
// GET /api/litigation/as-of?at=  each investor who could see a deal room at an instant, or at the end of a date, and what
// it showed them (worker/litigation-history.ts). Owner only, as the room's own as-of (routes/versions.ts).
import { canPerform } from '../auth.ts';
import type { RequestContext } from '../env.ts';
import { errorJson, json } from '../http.ts';
import { investorsAsOf } from '../litigation-history.ts';
import type { Route } from '../router.ts';
import { PrivilegeMarksUnavailable, roomsEnabled } from '../rooms.ts';
import { asOfInstant } from '../versions.ts';

async function getInvestorsAsOf(c: RequestContext): Promise<Response> {
  if (!roomsEnabled(c.env)) return errorJson('not_found', 404);
  if (!canPerform(c.member.role, 'viewActivity')) return errorJson('forbidden', 403);
  const at = asOfInstant(c.url.searchParams.get('at'));
  if (!at) return errorJson('bad_request', 400);
  try {
    return json({ at, investors: await investorsAsOf(c.env, at, new Date()) });
  } catch (error) {
    if (!(error instanceof PrivilegeMarksUnavailable)) throw error;
    return errorJson('unavailable', 503);
  }
}

export const routes: Route[] = [{ method: 'GET', path: '/api/litigation/as-of', handler: getInvestorsAsOf }];
