// SPDX-License-Identifier: Apache-2.0
// legallas-web's gate and router: the core room. run_worker_first is true, so this runs for every request, static
// files included. Order: serve the front door's few public files (public.ts), verify the Access JWT, require a second
// factor in it when REQUIRE_MFA is "1" (mfa.ts), require a member row, note a new sign-in, check write origin, then route
// or serve assets. With ROOMS_ENABLED, someone with no member
// row but an active deal-room invitation goes to the guest routes instead (routes/rooms.ts), never to assets. With
// SYNC_ENDPOINTS, /api/sync/ goes to its own check for a laptop's service token (routes/sync.ts), never to anyone else.
// Feature modules never see an unauthenticated request; only the static files in PUBLIC_PATHS do.
// The core's own routes are listed here; packages add theirs through extensions.ts (pro: worker/index.ts, which adds
// Ask, the research chat, the case manifest and the visual binder), so every added route sits behind the same gate.
// This file must never import cloudflare:workers or agents: tests load it under plain Node, and the Worker entries
// export the Durable Object class instead (worker/config.test.ts). Its default export is a whole Worker, the core alone.
import type { JWTVerifyGetKey } from 'jose';
import { findMember, verifyAccessIdentity, verifySyncToken } from './auth.ts';
import type { Env } from './env.ts';
import { extensionRoutes, roomMark } from './extensions.ts';
import { withSecurityHeaders } from './headers.ts';
import { errorJson, isSameOriginWrite, isWrite } from './http.ts';
import { enrollUrl, lacksSecondFactor } from './mfa.ts';
import { matchRoute, type Route } from './router.ts';
import { routes as checkRoutes } from './routes/checks.ts';
import { routes as checklistRoutes } from './routes/checklist.ts';
import { routes as commentRoutes } from './routes/comments.ts';
import { routes as entityMatrixRoutes } from './routes/entity-matrix.ts';
import { routes as fileRoutes } from './routes/files.ts';
import { routes as holdRoutes } from './routes/hold.ts';
import { routes as meRoutes } from './routes/me.ts';
import { routes as proposalRoutes } from './routes/proposals.ts';
import { routes as versionRoutes } from './routes/versions.ts';
import { routes as litigationRoutes } from './routes/litigation.ts';
import { checklistEnabled, type ChecklistSetting } from './checklist.ts';
import { proposalsEnabled, type ProposalSetting } from './proposals.ts';
import { noticeGate } from './notice-gate.ts';
import { isPublicPath, servePublic } from './public.ts';
import { redirectFor } from './redirects.ts';
import { roomNamesOf } from './room-names.ts';
import { servePage } from './room-shape.ts';
import { findRoomGuest, roomsEnabled } from './rooms.ts';
import { escapeHtml, handleGuest, OWNER_ROOM_ROUTES } from './routes/rooms.ts';
import { handleSync } from './routes/sync.ts';
import { trackSignIn } from './signins.ts';
import { isSyncPath, syncEnabled } from './sync.ts';

/** The core's routes. */
export const CORE_ROUTES: readonly Route[] = [...meRoutes, ...fileRoutes, ...commentRoutes, ...checkRoutes, ...OWNER_ROOM_ROUTES, ...holdRoutes, ...versionRoutes, ...litigationRoutes, ...entityMatrixRoutes];

/**
 * Every route the room serves: the core's, then the ones packages added (extensions.ts), read per request, then the
 * proposals routes only while the room's PROPOSALS_ENABLED is "1" (worker/proposals.ts), and the checklist's only while
 * its CHECKLIST_ENABLED is "1" (worker/checklist.ts). Without `env`, or with a setting off, the table is exactly what it
 * was before that feature existed, so its paths answer like any unknown path.
 */
export function roomRoutes(env?: ProposalSetting & ChecklistSetting): readonly Route[] {
  const routes = [...CORE_ROUTES, ...extensionRoutes()];
  if (env === undefined) return routes;
  return [...routes, ...(proposalsEnabled(env) ? proposalRoutes : []), ...(checklistEnabled(env) ? checklistRoutes : [])];
}

// A refused person must not load the room's scripts or styles, so these pages use only the front door's public
// stylesheet (/welcome/door.css) and the room's mark inline (extensions.ts roomMark). The title is the room's instance
// name (room-names.ts), which allows no markup characters. `main` is trusted markup: callers escape what they put in it.
function doorPage(env: Pick<Env, 'INSTANCE_NAME'>, main: string): Response {
  const body =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex"><meta name="color-scheme" content="light">' +
    '<link rel="icon" href="/welcome/favicon.svg" type="image/svg+xml">' +
    `<link rel="stylesheet" href="/welcome/door.css"><title>${escapeHtml(roomNamesOf(env).instanceName)}</title></head>` +
    `<body><main class="door door-compact">${roomMark()(false)}${main}</main></body></html>`;
  return withSecurityHeaders(
    new Response(body, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    'page',
  );
}

const SIGN_OUT = '<a class="door-button" href="/cdn-cgi/access/logout">Sign out</a>';

// A signed-in non-member. Same words as /welcome/denied/.
function denied(env: Pick<Env, 'INSTANCE_NAME'>): Response {
  return doorPage(
    env,
    '<h1 class="door-title door-title-small">This room is private.</h1>' +
      '<p class="door-lede">If you were invited, ask the person who invited you ' +
      'to add the email address you signed in with.</p>' +
      `<hr class="door-rule">${SIGN_OUT}`,
  );
}

const ATTRIBUTE_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;', "'": '&#39;' };

/**
 * A sign-in with no second factor while REQUIRE_MFA is on (mfa.ts): how to add one, then sign in again, since the
 * session that was refused stays without one until it ends. The link is Cloudflare's enrollment page on TEAM_DOMAIN.
 */
function secondStepNeeded(env: Pick<Env, 'INSTANCE_NAME' | 'TEAM_DOMAIN'>): Response {
  const enroll = enrollUrl(env.TEAM_DOMAIN);
  const add = enroll ? `<a class="door-button" href="${enroll.replace(/[&"<>']/g, (c) => ATTRIBUTE_ESCAPES[c]!)}">Add a sign-in step</a> ` : '';
  return doorPage(
    env,
    '<h1 class="door-title door-title-small">Add a second sign-in step.</h1>' +
      '<p class="door-lede">This room asks for a security key, Touch ID, Face ID or Windows Hello as well as the emailed code. ' +
      'A code from an authenticator app is not enough here. Add one, then sign out and sign in again.</p>' +
      `<hr class="door-rule">${add}${SIGN_OUT}`,
  );
}

/** `getKey` exists for tests (a locally signed Access token); production uses the team's keys. */
export async function handle(request: Request, env: Env, ctx: ExecutionContext, getKey?: JWTVerifyGetKey): Promise<Response> {
  const url = new URL(request.url);

  // The front door's static files, before any identity check (public.ts holds the exact list).
  if (isPublicPath(url.pathname)) return servePublic(request, env, url.pathname);

  // The laptop's sync endpoints have their own check (routes/sync.ts): a service token, never a person. Off, unset
  // included, these paths go through the gate below and answer like any unknown path; a service token passes nothing else.
  if (syncEnabled(env) && isSyncPath(url.pathname)) {
    return withSecurityHeaders(await handleSync(request, env, url, await verifySyncToken(request, env, getKey)), 'api');
  }

  const identity = await verifyAccessIdentity(request, env, getKey);
  if (!identity) return denied(env);
  // REQUIRE_MFA (mfa.ts): before any lookup, so a sign-in with no second factor reaches nothing, guests included, and
  // counts as no sign-in. The localhost dev identity is never refused.
  if (lacksSecondFactor(identity, env)) return secondStepNeeded(env);
  const member = await findMember(env.DB, identity.email);
  if (!member) {
    // Deal and matter rooms (rooms.ts): with ROOMS_ENABLED, someone invited to a room reaches that room's guest routes
    // and nothing else. Off, or with no active invitation, they are refused exactly like a stranger.
    const now = new Date();
    const guest = roomsEnabled(env) ? await findRoomGuest(env.DB, identity.email, now) : null;
    if (!guest) return denied(env);
    trackSignIn(env, ctx, identity, request);
    return handleGuest(request, env, ctx, url, guest, now);
  }
  // A member's first request in a new Access session emails the owner (after the response; see signins.ts).
  trackSignIn(env, ctx, identity, request);

  if (isWrite(request.method) && !isSameOriginWrite(request)) {
    return withSecurityHeaders(errorJson('forbidden', 403), 'api');
  }
  // A3 (notice-gate.ts): until this member ticks the current full notice, only /notice/ and sign-out answer.
  const notice = await noticeGate(request, env, url, member);
  if (notice) return notice;

  const match = matchRoute(roomRoutes(env), request.method, url.pathname);
  if (match.kind === 'found') {
    const response = await match.route.handler({ request, env, ctx, url, member, params: match.params });
    return withSecurityHeaders(response, 'api');
  }
  if (match.kind === 'wrong-method') {
    const response = errorJson('method_not_allowed', 405);
    response.headers.set('Allow', match.allow.join(', '));
    return withSecurityHeaders(response, 'api');
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) {
    return withSecurityHeaders(errorJson('not_found', 404), 'api');
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return withSecurityHeaders(errorJson('method_not_allowed', 405), 'api');
  }
  const moved = redirectFor(url);
  if (moved) return withSecurityHeaders(Response.redirect(new URL(moved, url).href, 301), 'page');
  return withSecurityHeaders(await servePage(request, env, url, member), 'page');
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      return await handle(request, env, ctx);
    } catch (error) {
      // Log the error type only: messages can carry filenames or document text.
      console.error('unhandled', error instanceof Error ? error.name : typeof error);
      return withSecurityHeaders(errorJson('internal_error', 500), 'api');
    }
  },
} satisfies ExportedHandler<Env>;
