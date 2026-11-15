// SPDX-License-Identifier: Apache-2.0
// The visual binder's route (pro), added to the room by worker/index.ts. room.ts already authenticated the caller,
// loaded their member row and checked the write origin; the handler still checks canPerform() and keeps
// privilegeFilter(), as every document route does. The pages themselves are served by /files/:id (routes/files.ts).
//
//   GET /api/visuals      the visual binder (manifest joined to live visuals), and while PROPOSALS_ENABLED is "1" the
//                         visuals members' AIs saved (worker/proposal-visual.ts), served by /api/proposals/:id/visual
import { canPerform } from '../auth.ts';
import type { RequestContext } from '../env.ts';
import { errorJson, json } from '../http.ts';
import { privilegeFilter } from '../privilege.ts';
import { savedVisuals, withSaved } from '../proposal-visual.ts';
import { proposalsEnabled } from '../proposals.ts';
import type { Route } from '../router.ts';
import { MANIFEST_NAME, ManifestError, parseManifest, resolveBinder, type RoomBinder, type VisualDocument } from '../visuals.ts';

const EMPTY: RoomBinder = { sections: [], visuals: [] };

interface ManifestRow {
  folder: string;
  r2_key: string;
}

async function listVisuals(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'view')) return errorJson('forbidden', 403);
  const binder = await mirrorBinder(c);
  if (binder instanceof Response) return binder;
  return json(proposalsEnabled(c.env) ? withSaved(binder, await savedVisuals(c.env.DB, c.member.role)) : binder);
}

/** The owner's binder from the mirrored manifest, or the error response for a bad one. */
async function mirrorBinder(c: RequestContext): Promise<RoomBinder | Response> {
  const visible = privilegeFilter(c.member.role);
  const row = await c.env.DB.prepare(
    `SELECT folder, r2_key FROM documents WHERE name = ?1 AND source = 'mirror' AND removed_at IS NULL${visible} ORDER BY path LIMIT 1`,
  )
    .bind(MANIFEST_NAME)
    .first<ManifestRow>();
  if (!row) return EMPTY;

  const object = await c.env.FILES.get(row.r2_key);
  if (!object) return EMPTY;

  let manifest;
  try {
    manifest = parseManifest(JSON.parse(await object.text()));
  } catch (error) {
    if (!(error instanceof ManifestError || error instanceof SyntaxError)) throw error;
    // The reason names a field, never document text; only the owner (who maintains the file) sees it.
    console.error('bad_manifest', error.name);
    const detail = c.member.role === 'owner' ? { detail: error.message } : {};
    return json({ error: 'bad_manifest', ...detail }, 500);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, path FROM documents WHERE kind = 'visual' AND source = 'mirror' AND removed_at IS NULL AND folder = ?1${visible}`,
  )
    .bind(row.folder)
    .all<VisualDocument>();
  return resolveBinder(manifest, row.folder, results);
}

export const routes: Route[] = [{ method: 'GET', path: '/api/visuals', handler: listVisuals }];
