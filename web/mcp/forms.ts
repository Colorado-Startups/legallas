// SPDX-License-Identifier: Apache-2.0
// Form protection for the Access-gated pages (/connections, /admin/clients): a double-submit token in a
// __Host- cookie (SameSite=Strict, HttpOnly) that must match the posted field, plus a same-origin check.
// No server secret is needed: an attacker can neither read the cookie nor set a __Host- cookie for this host.
import { LOCAL_HOSTS } from '../worker/auth.ts';
import { constantTimeEqual } from './constant-time.ts';
import { MCP_ORIGIN } from './contract.ts';
import { STORED_NAME } from '../worker/stored-name.ts';

export const FORM_COOKIE = `__Host-${STORED_NAME}-form`;
export const FORM_FIELD = 'form_token';
/** The posted field naming the grant a /connections revoke button disconnects. */
export const GRANT_FIELD = 'grant_id';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function cookieToken(request: Request): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === FORM_COOKIE) {
      const value = rest.join('=');
      return TOKEN.test(value) ? value : null;
    }
  }
  return null;
}

/** The token to embed in a page's forms, and the Set-Cookie header to send when the browser has none yet. */
export function formToken(request: Request): { token: string; setCookie: string | null } {
  const existing = cookieToken(request);
  if (existing) return { token: existing, setCookie: null };
  const token = randomToken();
  return { token, setCookie: `${FORM_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400` };
}

/** True when the POST came from this origin (or localhost in dev) and its token matches the cookie. Always awaited: a promise is truthy. */
export async function checkForm(request: Request, posted: FormData): Promise<boolean> {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const sameOrigin = LOCAL_HOSTS.has(url.hostname) ? origin === url.origin : origin === MCP_ORIGIN;
  if (!sameOrigin) return false;
  const cookie = cookieToken(request);
  const field = posted.get(FORM_FIELD);
  return cookie !== null && typeof field === 'string' && (await constantTimeEqual(cookie, field));
}
