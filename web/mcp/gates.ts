// SPDX-License-Identifier: Apache-2.0
// Request gates that run in mcp/index.ts before the OAuth library sees a request. Pure functions over the request
// and the env, so plain `node --test` drives them with fake bindings. Logs carry codes, paths and hosts only, never
// an IP address, a token or a body.
import { COPILOT_PACKAGE_PATH, MCP_RESOURCE, ORIGIN_ALLOW, type McpEnv } from './contract.ts';

/** The protected resource's path, where the Origin gate applies (and everything under it). */
export const MCP_PATH = new URL(MCP_RESOURCE).pathname;

/** Seconds a limited caller is told to wait: every limit's period is 60 s (wrangler.mcp.jsonc). */
export const RETRY_AFTER_SECONDS = 60;

type LimitBinding = 'REGISTER_LIMIT' | 'TOKEN_LIMIT' | 'PACKAGE_LIMIT';
export type GateEnv = Pick<McpEnv, LimitBinding | 'MCP_ORIGIN_ENFORCE'>;

interface LimitedRoute {
  path: string;
  binding: LimitBinding;
  /** OAuth sign-in: RFC 6749 errors, fails closed (rateLimitGate). */
  oauth: boolean;
}

/** POST routes with a per-IP limit. /authorize has none: Access is in front of it. */
export const LIMITED_ROUTES: readonly LimitedRoute[] = [
  { path: '/register', binding: 'REGISTER_LIMIT', oauth: true },
  { path: '/token', binding: 'TOKEN_LIMIT', oauth: true },
  { path: COPILOT_PACKAGE_PATH, binding: 'PACKAGE_LIMIT', oauth: false },
];

function json(status: number, body: Record<string, string>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });
}

function limitedResponse(route: LimitedRoute): Response {
  const body: Record<string, string> = { error: 'rate_limited' };
  if (route.oauth) body.error_description = 'Too many requests. Try again in a minute.';
  return json(429, body, { 'retry-after': String(RETRY_AFTER_SECONDS) });
}

/** Sign-in with its limiter down. */
function unavailableResponse(): Response {
  const body = { error: 'temporarily_unavailable', error_description: 'Sign-in is paused for a minute. Try again shortly.' };
  return json(503, body, { 'retry-after': String(RETRY_AFTER_SECONDS) });
}

/**
 * Per-IP limit on a LIMITED_ROUTES POST (CF-Connecting-IP, else 'unknown'): a 429 over it, else null. A missing or
 * throwing binding logs `mcp_ratelimit_error`, then:
 *
 * | Route | On error | Why |
 * |---|---|---|
 * | /register, /token | 503, retry-after | Nothing else caps them: no daily cap, unlike tool calls (worker/burst.ts) |
 * | Copilot package | passes | Public, writes nothing |
 */
export async function rateLimitGate(request: Request, env: GateEnv): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const { pathname } = new URL(request.url);
  const route = LIMITED_ROUTES.find((entry) => entry.path === pathname);
  if (!route) return null;
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    const { success } = await env[route.binding].limit({ key });
    if (success) return null;
  } catch {
    console.error('mcp_ratelimit_error', route.path);
    return route.oauth ? unavailableResponse() : null;
  }
  console.warn('mcp_rate_limited', route.path);
  return limitedResponse(route);
}

/** True when `origin` is a canonical https origin listed in ORIGIN_ALLOW, exactly or under a `*.` entry. */
export function isAllowedOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  // An Origin header is scheme and host only; anything else (a path, userinfo, upper case) is not canonical.
  if (url.protocol !== 'https:' || url.origin !== origin) return false;
  return ORIGIN_ALLOW.some((entry) => {
    const wildcard = entry.match(/^https:\/\/\*\.(.+)$/);
    if (!wildcard) return origin === entry;
    const suffix = wildcard[1];
    return url.port === '' && (url.hostname === suffix || url.hostname.endsWith(`.${suffix}`));
  });
}

/** The host to log for an unlisted Origin ('null' and malformed values are logged as 'invalid'). */
export function originHost(origin: string): string {
  try {
    return new URL(origin).hostname || 'invalid';
  } catch {
    return 'invalid';
  }
}

/**
 * For /mcp: a request with an Origin header not in ORIGIN_ALLOW is logged (`mcp_origin_unlisted`, host only)
 * and, when MCP_ORIGIN_ENFORCE is "1", refused with 403. Requests without an Origin always pass: the AIs call
 * /mcp server to server, and their bearer tokens are not cookies a hostile page could ride on.
 */
export function originGate(request: Request, env: GateEnv): Response | null {
  const { pathname } = new URL(request.url);
  if (pathname !== MCP_PATH && !pathname.startsWith(`${MCP_PATH}/`)) return null;
  const origin = request.headers.get('Origin');
  if (origin === null || isAllowedOrigin(origin)) return null;
  console.warn('mcp_origin_unlisted', originHost(origin));
  return env.MCP_ORIGIN_ENFORCE === '1' ? json(403, { error: 'forbidden_origin' }) : null;
}
