// SPDX-License-Identifier: Apache-2.0
// The owner's version history and a deal room's past contents (worker/versions.ts). Owner only: the routes check
// viewActivity, which counsel lacks, as the room preview does. room.ts already checked the member.
//
//   GET /api/documents/:id/versions   each version of a live document: date, replaced, sha256, size, whether still stored
//   GET /files/:id/versions/:n        version n's bytes, as a download (one `download` audit row)
//   GET /api/rooms/:room/as-of?at=    what the room showed a guest at an instant, or at the end of a date (YYYY-MM-DD).
//                                     Privilege marks are today's: one removed since `at` shows that document as visible
//                                     then. Unreadable marks: 503, nothing shown.
import { auditOnce } from '../audit.ts';
import { canPerform } from '../auth.ts';
import type { RequestContext } from '../env.ts';
import { attachment } from '../files-http.ts';
import { withSecurityHeaders } from '../headers.ts';
import { errorJson, isAllowedDocumentRead, json } from '../http.ts';
import { privilegeFilter } from '../privilege.ts';
import type { Route } from '../router.ts';
import { PrivilegeMarksUnavailable, roomsEnabled } from '../rooms.ts';
import { asOfInstant, listVersions, roomAsOf } from '../versions.ts';

const ownerOnly = (c: RequestContext) => (canPerform(c.member.role, 'viewActivity') ? null : errorJson('forbidden', 403));

async function getVersions(c: RequestContext): Promise<Response> {
  const refused = ownerOnly(c);
  if (refused) return refused;
  const found = await listVersions(c.env.DB, c.params.id!, privilegeFilter(c.member.role));
  return found ? json({ versions: found.rows }) : errorJson('not_found', 404);
}

async function getVersionFile(c: RequestContext): Promise<Response> {
  const refused = ownerOnly(c);
  if (refused) return refused;
  if (!isAllowedDocumentRead(c.request)) return errorJson('forbidden', 403);
  const found = await listVersions(c.env.DB, c.params.id!, privilegeFilter(c.member.role));
  const n = Number(c.params.n);
  const version = found && Number.isInteger(n) && n >= 1 ? found.rows[n - 1] : undefined;
  if (!found || !version?.stored) return errorJson('not_found', 404);
  const object = await c.env.FILES.get(found.keys[n - 1]!);
  if (!object) return errorJson('not_found', 404);
  await auditOnce(c, 'download', c.params.id!);
  const headers = new Headers({ 'Content-Type': found.contentType, 'Content-Disposition': attachment(found.name) });
  if (Number.isFinite(object.size)) headers.set('Content-Length', String(object.size));
  return withSecurityHeaders(new Response(object.body, { headers }), 'file');
}

async function getRoomAsOf(c: RequestContext): Promise<Response> {
  if (!roomsEnabled(c.env)) return errorJson('not_found', 404);
  const refused = ownerOnly(c);
  if (refused) return refused;
  const at = asOfInstant(c.url.searchParams.get('at'));
  if (!at) return errorJson('bad_request', 400);
  try {
    const documents = await roomAsOf(c.env, c.params.room!, at, new Date());
    return documents ? json({ room: c.params.room, at, documents }) : errorJson('not_found', 404);
  } catch (error) {
    // As the guest routes: marks that cannot be read show nothing.
    if (!(error instanceof PrivilegeMarksUnavailable)) throw error;
    return errorJson('unavailable', 503);
  }
}

export const routes: Route[] = [
  { method: 'GET', path: '/api/documents/:id/versions', handler: getVersions },
  { method: 'GET', path: '/files/:id/versions/:n', handler: getVersionFile },
  { method: 'GET', path: '/api/rooms/:room/as-of', handler: getRoomAsOf },
];
