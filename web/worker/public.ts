// SPDX-License-Identifier: Apache-2.0
// The front door: the few static files a visitor may load before signing in.
// Cloudflare Access lets /welcome* through with a Bypass app (README.md, "Front door"); this list is the
// Worker's own, independent gate. Everything not named here still needs a verified Access identity and
// a member row (index.ts). The list is exact on purpose: an unknown path must never reach env.ASSETS,
// because not_found_handling would answer with the room's 404 page.
import type { Env } from './env.ts';
import { withSecurityHeaders } from './headers.ts';
import { errorJson } from './http.ts';
import { shapedHead, shapedPage } from './room-shape.ts';

/** Every public path, spelled exactly as the browser requests it. */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  '/welcome',
  '/welcome/',
  '/welcome/denied/',
  '/welcome/away/',
  '/welcome/door.css',
  '/welcome/favicon.svg',
  '/welcome/seal-access.svg',
  '/welcome/fonts/source-serif-4-latin-wght-normal.woff2',
  '/welcome/fonts/inter-latin-wght-normal.woff2',
]);

/** Shown on room.cloudflareaccess.com (the Access login page logo), so it must load cross-origin. */
const CROSS_ORIGIN_PATHS: ReadonlySet<string> = new Set(['/welcome/seal-access.svg']);

/**
 * True when `pathname` (a `URL.pathname`, as the Worker sees it) may be served without signing in.
 * Answers only for a path spelled exactly as in PUBLIC_PATHS; public.test.ts lists the near misses
 * that must stay private.
 */
export function isPublicPath(pathname: string): boolean {
  // Exact, case-sensitive lookup with no decoding or trimming: the runtime has already resolved literal
  // ".." segments, and any other spelling (case, %2e, doubled or trailing slashes) is simply not listed.
  return PUBLIC_PATHS.has(pathname);
}

/** Serves one public file (GET or HEAD only) with the page security headers. */
export async function servePublic(request: Request, env: Env, pathname: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const refused = errorJson('method_not_allowed', 405);
    refused.headers.set('Allow', 'GET, HEAD');
    return withSecurityHeaders(refused, 'api');
  }
  // Public, so it must not tell a visitor what the room holds: a door that changed when a matter was published would
  // announce a dispute. With the setting on, the door is neutral in both shapes and never asks which one this is.
  const served = await env.ASSETS.fetch(request);
  const shaped = env.COMPANY_ROOM_ENABLED !== '1' ? served : request.method === 'GET' ? shapedPage(served) : shapedHead(served);
  const response = withSecurityHeaders(shaped, 'page');
  // After withSecurityHeaders, which sets Cross-Origin-Resource-Policy: same-origin for everything.
  if (CROSS_ORIGIN_PATHS.has(pathname)) response.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return response;
}
