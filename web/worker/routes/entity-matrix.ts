// SPDX-License-Identifier: Apache-2.0
// The Entity choice page's data (src/pages/entity/, worker/entity-matrix.ts). room.ts has already verified Access and
// loaded the member row. Read only, and public law only: the matrix's statutes, dated from the law library's catalog.
//
//   GET /api/entity-matrix    the matrix, each statute with its official link and as-of date, or null when not held
import { canPerform } from '../auth.ts';
import { resolveMatrix } from '../entity-matrix.ts';
import type { RequestContext } from '../env.ts';
import { errorJson, json } from '../http.ts';
import { lawCatalog } from '../law.ts';
import type { Route } from '../router.ts';

async function entityMatrix(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'view')) return errorJson('forbidden', 403);
  // Only the catalog is read, so the page needs the LAW bucket, not the LAW_SEARCH instance.
  if (c.env.LAW_LIBRARY !== '1' || !c.env.LAW) return json(resolveMatrix(null, 'off'));
  const catalog = await lawCatalog(c.env.LAW);
  return json(resolveMatrix(catalog, catalog ? 'on' : 'empty'));
}

export const routes: Route[] = [{ method: 'GET', path: '/api/entity-matrix', handler: entityMatrix }];
