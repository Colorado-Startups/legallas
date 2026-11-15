// SPDX-License-Identifier: Apache-2.0
// A tiny route table. Each feature module under worker/routes/ exports its own `routes` array, and
// index.ts concatenates them, so features are added without editing a shared router.
import type { RequestContext } from './env.ts';

export interface Route {
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Literal segments and :params, for example /api/documents/:id/comments */
  path: string;
  handler: (c: RequestContext) => Promise<Response>;
}

/** Any table with Route's method and path: the room's own routes, or a guest's (routes/rooms.ts). */
export type Match<R extends Pick<Route, 'method' | 'path'> = Route> =
  | { kind: 'found'; route: R; params: Record<string, string> }
  | { kind: 'wrong-method'; allow: string[] }
  | { kind: 'none' };

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const want = pattern.split('/');
  const got = pathname.split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const part = want[i]!;
    const actual = got[i]!;
    if (part.startsWith(':')) {
      if (!actual) return null;
      try {
        params[part.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
    } else if (part !== actual) {
      return null;
    }
  }
  return params;
}

export function matchRoute<R extends Pick<Route, 'method' | 'path'>>(routes: readonly R[], method: string, pathname: string): Match<R> {
  const allow: string[] = [];
  for (const route of routes) {
    const params = matchPath(route.path, pathname);
    if (!params) continue;
    if (route.method === method.toUpperCase()) return { kind: 'found', route, params };
    allow.push(route.method);
  }
  return allow.length > 0 ? { kind: 'wrong-method', allow } : { kind: 'none' };
}
