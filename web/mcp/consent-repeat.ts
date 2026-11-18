// SPDX-License-Identifier: Apache-2.0
import { STORED_NAME } from '../worker/stored-name.ts';
import { constantTimeEqual } from './constant-time.ts';
// A second Connect click on the same consent page. The library consumes the consent transaction on the first
// POST, so a repeat click (the browser cancels the first request and posts again) used to get "This page has
// expired" while the first request's redirect, with the authorization code, never reached the app (Copilot, as
// test counsel, 2026-10-21). After completeAuthorization, approve() keeps that redirect for 120 seconds; a repeat
// from the same member in the same browser gets the same redirect, and the code is still unexchanged.
//
// "Same browser" is the library's own binding (workers-oauth-provider 1.2.3, beginConsent and openTransaction):
// the cookie `__Host-oauth-consent-<first 16 hex of sha256(handle)>` holding sha256(handle). KV keeps only the
// handle's hash, and the redirect is sealed with a key derived from the handle, as the library seals transactions.
// Nothing here logs the handle, the cookie or the redirect URL.

/** KV keys (OAUTH_KV): `${prefix}${sha256(handle)}`. */
export const CONSENT_DONE_PREFIX = `${STORED_NAME}-admin:consent-done:`;
/** How long a repeat click can still pick up the redirect. */
export const CONSENT_DONE_TTL_SECONDS = 120;
/** The library's consent binding cookie base (its default cookiePrefix `__Host-oauth-` plus `consent`). */
export const CONSENT_COOKIE_BASE = '__Host-oauth-consent';
/**
 * Pauses before each look for the first click's record, 5 seconds in all: a double click can arrive while the first
 * request is still between consuming the transaction and storing the redirect, which can include fetching the app's
 * metadata document and the D1 audit write. Short at first, since a double click is usually a few hundred ms behind.
 */
export const REPEAT_WAITS_MS: readonly number[] = [0, 250, 250, 250, 250, ...Array<number>(8).fill(500)];

export type Sleep = (ms: number) => Promise<void>;
const sleepFor: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

interface ConsentDone {
  email: string;
  redirectTo: string;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator !== -1 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

/** The binding cookie's name for `handle`, or null when `request` does not carry it with the right value. */
async function boundCookie(request: Request, handle: string): Promise<{ name: string; hash: string } | null> {
  const hash = await sha256Hex(handle);
  const name = `${CONSENT_COOKIE_BASE}-${hash.slice(0, 16)}`;
  const bound = readCookie(request, name);
  return bound !== undefined && (await constantTimeEqual(hash, bound)) ? { name, hash } : null;
}

async function sealKey(handle: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${STORED_NAME}-consent-done:${handle}`));
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/** Keeps where an approval sent the browser, for a repeat click. Never throws: the approval already stands. */
export async function rememberConsentDone(kv: KVNamespace, handle: string, done: ConsentDone): Promise<void> {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealKey(handle), new TextEncoder().encode(JSON.stringify(done)));
    const value = `${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
    await kv.put(`${CONSENT_DONE_PREFIX}${await sha256Hex(handle)}`, value, { expirationTtl: CONSENT_DONE_TTL_SECONDS });
  } catch (error) {
    console.error('mcp_consent_done_failed', error instanceof Error ? error.name : 'unknown');
  }
}

async function readDone(kv: KVNamespace, handle: string, hash: string): Promise<ConsentDone | null> {
  const stored = await kv.get(`${CONSENT_DONE_PREFIX}${hash}`);
  if (!stored) return null;
  const [iv, sealed] = stored.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await sealKey(handle), fromBase64(sealed));
  return JSON.parse(new TextDecoder().decode(plain)) as ConsentDone;
}

/**
 * The redirect an earlier Connect click for `handle` got, and the binding cookie to clear, when `request` comes
 * from the same browser (the library's binding cookie) and the same member within 120 seconds; else null. Looks
 * again after each REPEAT_WAITS_MS pause, so a double click finds a first request that is still finishing. Never
 * throws.
 */
export async function findConsentDone(kv: KVNamespace, request: Request, handle: string, email: string, sleep: Sleep = sleepFor): Promise<{ redirectTo: string; cookieName: string } | null> {
  try {
    const bound = await boundCookie(request, handle);
    if (!bound) return null;
    for (const wait of REPEAT_WAITS_MS) {
      if (wait > 0) await sleep(wait);
      const done = await readDone(kv, handle, bound.hash);
      if (done) return done.email === email && typeof done.redirectTo === 'string' ? { redirectTo: done.redirectTo, cookieName: bound.name } : null;
    }
  } catch (error) {
    console.error('mcp_consent_repeat_failed', error instanceof Error ? error.name : 'unknown');
  }
  return null;
}
