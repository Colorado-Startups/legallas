// SPDX-License-Identifier: Apache-2.0
// GET /api/matter: the published matter manifest (worker/matter-types.ts) as a member sees it.
//
// The file lives at MATTER_KEY in legallas-files, written only by `npm run matter -- publish`. The parsed file is
// cached per isolate by its R2 etag (a conditional get skips the download when it has not changed); the live
// documents are read fresh on every request in one query, with no IN (...) list (D1 binds at most 100
// parameters), and joined in memory by worker/matter-serve.ts.
import { canPerform } from '../auth.ts';
import { NOT_HIDDEN_SQL } from '../files-catalog.ts';
import type { Env, RequestContext, Role } from '../env.ts';
import { errorJson, json } from '../http.ts';
import { MatterError, parseMatter } from '../matter.ts';
import { serveMatter, type LiveDocs } from '../matter-serve.ts';
import { MATTER_KEY, type Matter } from '../matter-types.ts';
import { privilegeFilter } from '../privilege.ts';
import type { Route } from '../router.ts';

interface LiveRow {
  id: string;
  control_seq: number | null;
}

let cached: { etag: string; matter: Matter } | null = null;

/** Test support: forget the per-isolate cache. */
export function resetMatterCache(): void {
  cached = null;
}

/** The parsed manifest, or null when none has been published. Throws MatterError or SyntaxError on a bad file. */
export async function loadMatter(env: Env): Promise<Matter | null> {
  const held = cached;
  const object = await env.FILES.get(MATTER_KEY, held ? { onlyIf: { etagDoesNotMatch: held.etag } } : undefined);
  if (!object) {
    cached = null;
    return null;
  }
  // A failed precondition returns the object without a body: the cached parse is still current.
  if (held && !('body' in object)) return held.matter;
  const matter = parseMatter(JSON.parse(await (object as R2ObjectBody).text()), { now: new Date() });
  cached = { etag: object.etag, matter };
  return matter;
}

/**
 * Live document ids with their control numbers, as a member with `role` sees them. The room's own data files
 * (NOT_HIDDEN_SQL) are never citable, and for a role without viewPrivileged neither is anything under a privileged
 * folder (privilege.ts), so a cite to one is dropped like a cite to a removed file, and an entry cited only to such
 * files with it. Before
 * migration 0003 there is no control_seq column yet.
 */
async function liveDocs(db: D1Database, role: Role): Promise<LiveDocs> {
  const visible = `removed_at IS NULL AND ${NOT_HIDDEN_SQL}${privilegeFilter(role)}`;
  const query = (columns: string) => db.prepare(`SELECT ${columns} FROM documents WHERE ${visible}`).all<LiveRow>();
  let rows: LiveRow[];
  try {
    rows = (await query('id, control_seq')).results;
  } catch (error) {
    if (!/no such column/i.test(String(error))) throw error;
    rows = (await query('id, NULL AS control_seq')).results;
  }
  return new Map(rows.map((row) => [row.id.toLowerCase(), row.control_seq ?? null]));
}

async function getMatter(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'view')) return errorJson('forbidden', 403);
  let matter: Matter | null;
  try {
    matter = await loadMatter(c.env);
  } catch (error) {
    if (!(error instanceof MatterError || error instanceof SyntaxError)) throw error;
    // The reason names a field, never matter text; only the owner (who publishes the file) sees it.
    console.error('bad_matter', error.name);
    const detail = c.member.role === 'owner' ? { detail: error.message } : {};
    return json({ error: 'bad_matter', ...detail }, 500);
  }
  if (!matter) return errorJson('not_built', 404);
  return json(serveMatter(matter, await liveDocs(c.env.DB, c.member.role)));
}

export const routes: Route[] = [{ method: 'GET', path: '/api/matter', handler: getMatter }];
