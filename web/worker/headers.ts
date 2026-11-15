// SPDX-License-Identifier: Apache-2.0
// Security headers for every response the Worker sends, including static assets.

/**
 * page:   HTML, scripts, styles and fonts from the Astro build. 'wasm-unsafe-eval' lets the self-hosted
 *         Rive runtime compile its WebAssembly (approved by the owner on 2026-10-01). It allows
 *         WebAssembly.compile and instantiate only: JS eval and new Function stay blocked.
 * api:    JSON from /api/*.
 * file:   an original document from R2. Sandboxed, so an SVG or HTML opened directly runs nothing.
 * visual: an owner-mirrored HTML visual shown in <iframe sandbox="allow-scripts">. It may run its own
 *         inline chart code, but has an opaque origin and no network access.
 */
export type HeaderKind = 'page' | 'api' | 'file' | 'visual';

const CSP: Record<HeaderKind, string> = {
  page: [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  api: "default-src 'none'; frame-ancestors 'none'",
  file: "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
  visual: [
    'sandbox allow-scripts',
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    "frame-ancestors 'self'",
  ].join('; '),
};

/** A kind's Content-Security-Policy, as withSecurityHeaders sets it (mcp/apps/shoot.ts frames the views under `visual`). */
export function contentSecurityPolicy(kind: HeaderKind): string {
  return CSP[kind];
}

const BASE: Record<string, string> = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  // Subdomains: the room is its own subdomain, its MCP host under it. No preload: that binds the whole domain.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

/**
 * Copies `response` and adds the security headers. A Content-Security-Policy the handler already set
 * is kept, so a route can choose `file` or `visual` by calling this itself before returning.
 *
 * A WebSocket upgrade (a 101 carrying `webSocket`) is returned untouched: the copy would rely on the runtime carrying
 * the socket across, and a handshake response has no document for these headers to protect. Only routes behind the
 * gate in room.ts produce one (pro's research chat, worker/agent/), after their own Origin check. Anything else, a
 * response carrying a socket with another status included, gets the headers.
 */
export function withSecurityHeaders(response: Response, kind: HeaderKind): Response {
  // Read through a structural type: scripts/ type-checks this file against Node's Response, which has no webSocket.
  if (response.status === 101 && (response as Response & { webSocket?: unknown }).webSocket) return response;
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(BASE)) out.headers.set(name, value);
  if (!out.headers.has('Content-Security-Policy')) out.headers.set('Content-Security-Policy', CSP[kind]);
  return out;
}
