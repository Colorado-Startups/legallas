// SPDX-License-Identifier: Apache-2.0
// Which redirect URIs may receive an authorization code (the owner, D5: Harvey, Microsoft and Claude; Gemini Enterprise's
// callback, allowed from 2026-10-20, was removed on 2026-10-31). Checked twice: when a client registers
// (clientRegistrationCallback) and on every /authorize request, so static and Client ID Metadata Document clients,
// which never pass through registration, are held to the same list.
//
// A refused registration's URI is kept for the owner (REFUSED_REDIRECT_PREFIX, 14 days, at most 20), who can
// allow it on /admin/clients (ALLOWED_REDIRECT_PREFIX). mcp/index.ts merges the allowed ones into
// MCP_REDIRECT_ALLOW through loadAllowedRedirects, so an allowed URI needs no redeploy.
import { notifyRefusedRedirect } from './alert.ts';
import { ALLOWED_REDIRECT_PREFIX, DEFAULT_REDIRECT_ALLOW, REFUSED_REDIRECT_PREFIX, type McpEnv } from './contract.ts';

/** Loopback hosts an `http://` entry may name; such an entry matches any port and path on that host. */
const LOOPBACK = new Set(['localhost', '127.0.0.1']);
/** `https://*.example.com/`: example.com and every subdomain, any path. */
const HOST_SUFFIX = /^https:\/\/\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/$/;
/** `=https://...`: exactly this URI, even when it ends in "/" (how loadAllowedRedirects writes owner entries). */
const EXACT_MARK = '=';

/** A refused URI waits this long for the owner's Allow or Dismiss. */
export const REFUSED_TTL_SECONDS = 14 * 86_400;
/** At most this many refused URIs, and this many allowed ones, are kept. */
export const MAX_STORED_REDIRECTS = 20;
/** Longer URIs are never stored. */
export const MAX_STORED_URI = 512;
/** Workers KV's key limit, in bytes. */
const MAX_KV_KEY = 512;

function parse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

/** DEFAULT_REDIRECT_ALLOW plus the comma-separated MCP_REDIRECT_ALLOW entries. */
export function redirectAllowList(extra: string | undefined): string[] {
  const added = (extra ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  return [...DEFAULT_REDIRECT_ALLOW, ...added];
}

/** Canonical https with the default port: what a suffix or exact-marked entry requires. */
function canonicalHttps(uri: string, url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.href === uri;
}

function matchesEntry(uri: string, url: URL, entry: string): boolean {
  if (entry.startsWith(EXACT_MARK)) return canonicalHttps(uri, url) && uri === entry.slice(EXACT_MARK.length);
  const suffix = HOST_SUFFIX.exec(entry)?.[1];
  if (suffix) return canonicalHttps(uri, url) && (url.hostname === suffix || url.hostname.endsWith(`.${suffix}`));
  const allowed = parse(entry);
  if (!allowed) return false;
  if (allowed.protocol === 'http:') {
    // Only a loopback entry may be http, and it covers the whole host: Claude Code picks a free port.
    return LOOPBACK.has(allowed.hostname) && url.protocol === 'http:' && url.hostname === allowed.hostname;
  }
  if (allowed.protocol !== 'https:' || url.protocol !== 'https:') return false;
  // A prefix only counts on the canonical form, so dot segments or a case trick cannot step outside it.
  if (entry.endsWith('/')) return url.href === uri && uri.startsWith(entry);
  return uri === entry;
}

/**
 * True when `uri` may receive codes: exact for an ordinary entry, a prefix for one ending in "/", a host and its
 * subdomains for `https://*.host/`, exact for `=uri`, and any port and path for the http://localhost and
 * http://127.0.0.1 entries. Fragments, userinfo and any other http are refused whatever the list says, and so is
 * an unsupported AI's host (UNSUPPORTED_AI_HOSTS).
 */
export function isAllowedRedirect(uri: string, env: { MCP_REDIRECT_ALLOW?: string }): boolean {
  if (typeof uri !== 'string' || uri.includes('#')) return false;
  if (isUnsupportedAiUri(uri)) return false;
  const url = parse(uri);
  if (!url || url.username || url.password) return false;
  return redirectAllowList(env.MCP_REDIRECT_ALLOW).some((entry) => matchesEntry(uri, url, entry));
}

/** The host to log when a redirect is refused, so an unlisted app (Harvey's host) can be found and added. */
export function redirectHost(uri: unknown): string {
  const url = typeof uri === 'string' ? parse(uri) : null;
  return url?.hostname || 'invalid';
}

/**
 * Names reserved for testing and documentation (RFC 2606, RFC 6761): the `.invalid`, `.example`, `.test` and
 * `.localhost` top-level names and the example.com, example.net and example.org domains, each with every subdomain.
 */
const RESERVED_TEST_NAMES = ['invalid', 'example', 'test', 'localhost', 'example.com', 'example.net', 'example.org'];

/**
 * True for a host under a reserved test name: no real app can use one, so a refusal for it (the smoke's deliberate
 * `.invalid` ones, a scanner's example.com) is never kept or emailed to the owner. A trailing dot counts the same.
 */
export function isReservedTestHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  return RESERVED_TEST_NAMES.some((reserved) => name === reserved || name.endsWith(`.${reserved}`));
}

/**
 * Hosts of AI apps the room never connects (the owner, 2026-10-31: the only closed models are Claude, Copilot and Harvey):
 * OpenAI's ChatGPT, Google's Gemini and xAI's Grok (on x.ai, grok.com and x.com), each with every subdomain. Refused ahead of every list, so neither
 * MCP_REDIRECT_ALLOW nor the owner's Allow on /admin/clients can let one in. Open-weight models connect through other apps.
 */
export const UNSUPPORTED_AI_HOSTS: readonly string[] = ['openai.com', 'chatgpt.com', 'chat.com', 'google.com', 'gemini.google', 'x.ai', 'grok.com', 'x.com', 'twitter.com'];

/** True for a host on UNSUPPORTED_AI_HOSTS or under one. A trailing dot counts the same. */
export function isUnsupportedAiHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  return UNSUPPORTED_AI_HOSTS.some((denied) => name === denied || name.endsWith(`.${denied}`));
}

/** True when `value` is a URL on an unsupported AI's host: a redirect URI, or a client ID that is a metadata document's URL. */
export function isUnsupportedAiUri(value: unknown): boolean {
  const url = typeof value === 'string' ? parse(value) : null;
  return url !== null && isUnsupportedAiHost(url.hostname);
}

/** Logs a refused redirect by error code and host only. */
export function logRefusedRedirect(uri: unknown): void {
  console.warn('mcp_redirect_refused', redirectHost(uri));
}

// ---- Refused and owner-allowed URIs, kept in OAUTH_KV ----

type RedirectKv = Pick<McpEnv, 'OAUTH_KV'>;

/** One stored URI and when it was stored (Unix seconds; null when KV returned no metadata). */
export interface StoredRedirect {
  uri: string;
  at: number | null;
}

function redirectKey(prefix: string, uri: string): string {
  return `${prefix}${encodeURIComponent(uri)}`;
}

/**
 * True when `uri` may be stored and later allowed as one exact entry: canonical https on the default port, no
 * userinfo, fragment or comma (the allowed list is comma-joined), at most MAX_STORED_URI characters, and a KV
 * key that fits.
 */
export function isStorableRedirect(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length > MAX_STORED_URI || uri.includes(',') || uri.includes('#')) return false;
  const url = parse(uri);
  if (!url || url.username || url.password || !canonicalHttps(uri, url)) return false;
  return redirectKey(REFUSED_REDIRECT_PREFIX, uri).length <= MAX_KV_KEY && redirectKey(ALLOWED_REDIRECT_PREFIX, uri).length <= MAX_KV_KEY;
}

function decodeName(name: string, prefix: string): string | null {
  try {
    return decodeURIComponent(name.slice(prefix.length));
  } catch {
    return null;
  }
}

/** The URIs under `prefix` (one KV list), and the raw key count, which the caps check. */
async function listStored(env: RedirectKv, prefix: string): Promise<{ rows: StoredRedirect[]; count: number }> {
  const listed = await env.OAUTH_KV.list<{ at?: unknown }>({ prefix, limit: MAX_STORED_REDIRECTS });
  const rows: StoredRedirect[] = [];
  for (const key of listed.keys) {
    const uri = decodeName(key.name, prefix);
    const at = key.metadata?.at;
    if (isStorableRedirect(uri)) rows.push({ uri, at: typeof at === 'number' ? at : null });
  }
  return { rows, count: listed.keys.length };
}

/** The refused URIs waiting for the owner, for /admin/clients. */
export async function refusedRedirects(env: RedirectKv): Promise<StoredRedirect[]> {
  return (await listStored(env, REFUSED_REDIRECT_PREFIX)).rows;
}

/** The URIs the owner allowed, for /admin/clients. */
export async function allowedRedirects(env: RedirectKv): Promise<StoredRedirect[]> {
  return (await listStored(env, ALLOWED_REDIRECT_PREFIX)).rows;
}

/**
 * The owner-allowed URIs as MCP_REDIRECT_ALLOW entries, comma-joined, each marked exact. Never throws: a KV
 * failure logs a code and returns "" (fewer URIs allowed, never more).
 */
export async function loadAllowedRedirects(env: RedirectKv): Promise<string> {
  try {
    return (await allowedRedirects(env)).map((row) => `${EXACT_MARK}${row.uri}`).join(',');
  } catch (error) {
    console.error('mcp_allowed_redirects_failed', error instanceof Error ? error.name : 'unknown');
    return '';
  }
}

/** MCP_REDIRECT_ALLOW with the loaded owner entries appended, for isAllowedRedirect and redirectAllow(). */
export function mergeRedirectAllow(configured: string | undefined, loaded: string): string | undefined {
  return [configured, loaded].filter(Boolean).join(',') || undefined;
}

/**
 * Keeps a URI a registration was refused for (14 days; skipped when 20 are kept, the URI is already kept, or it
 * is not storable) and emails the owner once per new host. Never throws; logs codes and the host only.
 */
export async function recordRefusedRedirect(env: Pick<McpEnv, 'OAUTH_KV' | 'EMAIL' | 'ALERTS_ENABLED'>, uri: unknown, now: Date = new Date()): Promise<void> {
  if (!isStorableRedirect(uri)) {
    console.warn('mcp_redirect_capture_skipped', 'unstorable');
    return;
  }
  if (isReservedTestHost(redirectHost(uri))) {
    console.warn('mcp_redirect_capture_skipped', 'test_host');
    return;
  }
  // Never offered for the owner's Allow: the room does not connect these apps at all.
  if (isUnsupportedAiHost(redirectHost(uri))) {
    console.warn('mcp_redirect_capture_skipped', 'unsupported_ai');
    return;
  }
  try {
    const { rows, count } = await listStored(env, REFUSED_REDIRECT_PREFIX);
    if (rows.some((row) => row.uri === uri)) return;
    if (count >= MAX_STORED_REDIRECTS) {
      console.warn('mcp_redirect_capture_skipped', 'full');
      return;
    }
    const at = Math.floor(now.getTime() / 1000);
    await env.OAUTH_KV.put(redirectKey(REFUSED_REDIRECT_PREFIX, uri), '1', { expirationTtl: REFUSED_TTL_SECONDS, metadata: { at } });
    const host = redirectHost(uri);
    console.warn('mcp_redirect_captured', host);
    if (!rows.some((row) => redirectHost(row.uri) === host)) await notifyRefusedRedirect(env, uri);
  } catch (error) {
    console.error('mcp_redirect_capture_failed', error instanceof Error ? error.name : 'unknown');
  }
}

/** Moves a refused URI to the allowed list. "missing" when it is not waiting; "full" when 20 are allowed. */
export async function allowRefusedRedirect(env: RedirectKv, uri: unknown, now: Date = new Date()): Promise<'allowed' | 'missing' | 'full'> {
  if (!isStorableRedirect(uri) || (await env.OAUTH_KV.get(redirectKey(REFUSED_REDIRECT_PREFIX, uri))) === null) return 'missing';
  const { rows, count } = await listStored(env, ALLOWED_REDIRECT_PREFIX);
  if (!rows.some((row) => row.uri === uri)) {
    if (count >= MAX_STORED_REDIRECTS) return 'full';
    await env.OAUTH_KV.put(redirectKey(ALLOWED_REDIRECT_PREFIX, uri), '1', { metadata: { at: Math.floor(now.getTime() / 1000) } });
  }
  await env.OAUTH_KV.delete(redirectKey(REFUSED_REDIRECT_PREFIX, uri));
  console.warn('mcp_redirect_allowed', redirectHost(uri));
  return 'allowed';
}

/** Deletes a refused URI without allowing it. False when the URI is not storable. */
export async function dismissRefusedRedirect(env: RedirectKv, uri: unknown): Promise<boolean> {
  if (!isStorableRedirect(uri)) return false;
  await env.OAUTH_KV.delete(redirectKey(REFUSED_REDIRECT_PREFIX, uri));
  return true;
}

/** Takes a URI off the allowed list; /authorize then refuses it again. False when the URI is not storable. */
export async function removeAllowedRedirect(env: RedirectKv, uri: unknown): Promise<boolean> {
  if (!isStorableRedirect(uri)) return false;
  await env.OAUTH_KV.delete(redirectKey(ALLOWED_REDIRECT_PREFIX, uri));
  console.warn('mcp_redirect_removed', redirectHost(uri));
  return true;
}
