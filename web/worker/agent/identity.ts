// SPDX-License-Identifier: Apache-2.0
// The identity the Worker hands a research Durable Object (D10). worker/index.ts has verified the Access JWT and read
// the members row before any research route runs, and the Durable Objects have no public route (no
// routeAgentRequest), so a request reaches one only from worker/agent/routes.ts. That request is built fresh: no
// client header, cookie or token is forwarded, and the headers below come from the verified identity alone. Whatever a
// client sends under these names is dropped with everything else it sent.
//
// Imports nothing from cloudflare:workers or agents, so index.ts stays loadable under plain Node.

/** The headers that carry the verified member identity to the agent. */
export const IDENTITY_HEADERS = {
  member: 'x-legallas-member',
  /** Unix seconds when the member's Access session ends: the socket closes then (research.ts). */
  exp: 'x-legallas-session-exp',
  local: 'x-legallas-local',
  ip: 'x-legallas-ip',
  userAgent: 'x-legallas-ua',
  thread: 'x-legallas-thread',
} as const;

/** Paths a research Durable Object answers for routes.ts. Not public: the Worker builds every such request itself. */
export const INTERNAL_PATHS = { messages: '/research/messages', turn: '/research/turn' } as const;

/** The counsel room's Access session length (README "Cloudflare and Claude"): the dev identity's session. */
export const DEV_SESSION_SECONDS = 6 * 3600;

/** The identity forwarded to the agent: the member's email and when the session ends. */
export interface ForwardedIdentity {
  email: string;
  exp: number;
  local: boolean;
  ip: string | null;
  userAgent: string | null;
}

function base64url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/**
 * When the member's Access session ends, in Unix seconds: the `exp` of the request's Access JWT. Read only after
 * auth.ts verified that token (index.ts runs first), so decoding it here trusts nothing new. The localhost dev identity
 * has no token and gets DEV_SESSION_SECONDS from `now`.
 */
export function sessionExp(request: Request, now: number = Date.now()): number {
  const fallback = Math.floor(now / 1000) + DEV_SESSION_SECONDS;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return fallback;
  try {
    const exp = (JSON.parse(base64url(token.split('.')[1] ?? '')) as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isSafeInteger(exp) ? exp : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A request for a research Durable Object: `url` with only the headers set here. `thread` names the thread for an
 * instance that needs it; `upgrade` forwards a WebSocket handshake; `json` becomes the body.
 */
export function forwarded(url: URL, identity: ForwardedIdentity, options: { method?: string; thread?: string; upgrade?: boolean; json?: unknown } = {}): Request {
  const headers = new Headers({
    [IDENTITY_HEADERS.member]: identity.email,
    [IDENTITY_HEADERS.exp]: String(identity.exp),
    [IDENTITY_HEADERS.local]: identity.local ? '1' : '0',
  });
  if (identity.ip) headers.set(IDENTITY_HEADERS.ip, identity.ip);
  if (identity.userAgent) headers.set(IDENTITY_HEADERS.userAgent, identity.userAgent.slice(0, 512));
  if (options.thread) headers.set(IDENTITY_HEADERS.thread, options.thread);
  if (options.upgrade) headers.set('Upgrade', 'websocket');
  const body = options.json === undefined ? undefined : JSON.stringify(options.json);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return new Request(url, { method: options.method ?? (body === undefined ? 'GET' : 'POST'), headers, body });
}

/** The identity a research Durable Object received, or null when the request did not come from routes.ts. */
export function identityOf(request: Request): (ForwardedIdentity & { thread: string | null }) | null {
  const email = request.headers.get(IDENTITY_HEADERS.member);
  const exp = Number(request.headers.get(IDENTITY_HEADERS.exp));
  if (!email || !Number.isSafeInteger(exp)) return null;
  return {
    email,
    exp,
    local: request.headers.get(IDENTITY_HEADERS.local) === '1',
    ip: request.headers.get(IDENTITY_HEADERS.ip),
    userAgent: request.headers.get(IDENTITY_HEADERS.userAgent),
    thread: request.headers.get(IDENTITY_HEADERS.thread),
  };
}
