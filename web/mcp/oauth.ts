// SPDX-License-Identifier: Apache-2.0
// The OAuthProvider configuration for legallas-mcp, as a pure function so tests can inspect it and drive its
// handlers without loading the library (which imports `cloudflare:workers`). mcp/index.ts passes the result to
// `new OAuthProvider(...)`. The library serves discovery, /token and /register; this file routes the rest.
import type { ClientRegistrationCallbackResult, OAuthProviderOptions } from '@cloudflare/workers-oauth-provider';
import { handleAdminClients } from './admin-clients.ts';
import { handleAuthorize, messagePage, requireMember, type GateDeps } from './authorize.ts';
import { handleConnections } from './connections.ts';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  CLIENT_REGISTRATION_TTL_SECONDS,
  CONNECT_PATH,
  MCP_ORIGIN,
  MCP_RESOURCE,
  REFRESH_TOKEN_TTL_SECONDS,
  SCOPES,
  SERVER_TITLE,
  type McpEnv,
  type Props,
} from './contract.ts';
import { addedPage, connectOptions } from './extensions.ts';
import { renderConnectPage } from './pages/connect.ts';
import { readerOf } from '../worker/invite.ts';
import { isCompanyRoom } from '../worker/room-shape.ts';
import { renderSecurityPage, SECURITY_PATH } from './pages/security.ts';
import { CONTACT } from './pages/html.ts';
import { htmlResponse, renderPrivacy, renderTerms } from './pages/index.ts';
import { isAllowedRedirect, logRefusedRedirect } from './redirects.ts';
import { serveMcp } from './server.ts';
import { contactEmail } from '../worker/room-settings.ts';

export interface OAuthDeps extends GateDeps {
  /**
   * MCP_REDIRECT_ALLOW for dynamic registration: the library calls clientRegistrationCallback without env, so
   * mcp/index.ts reads it from `cloudflare:workers`.
   */
  redirectAllow(): string | undefined;
  /** MCP_DEV_ORIGIN from .dev.vars, read once at startup; honoured only for a localhost origin. */
  devOrigin?: string;
  /** DCR_ENABLED, read like redirectAllow because the registration callback gets no env. */
  dcrEnabled?(): string | undefined;
  // onRefusedRedirect (GateDeps) gets the first refused URI of a refused registration, and /authorize's.
}

/** Registration metadata larger than this (serialized) is refused: real clients send well under 1 KB. */
export const MAX_REGISTRATION_BYTES = 4096;
/** A client_name longer than this is refused; the consent page and audit trim to 80 characters anyway. */
export const MAX_CLIENT_NAME = 80;

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$/;

/** The origin the server names in its metadata: production, or a localhost origin for wrangler dev. */
export function publicOrigin(devOrigin: string | undefined): string {
  return devOrigin && LOCAL_ORIGIN.test(devOrigin) ? devOrigin : MCP_ORIGIN;
}

/**
 * The clientRegistrationCallback check (RFC 7591): every redirect URI must be on the allowlist. Refusals log the
 * code and the first refused host only, and hand that URI to `onRefusedRedirect`, so the owner can allow an
 * unlisted app (Harvey's host, say) on /admin/clients.
 */
export function checkRegistration(
  metadata: Record<string, unknown>,
  redirectAllow: string | undefined,
  dcrEnabled: string | undefined = '1',
  onRefusedRedirect?: (uri: string) => void,
): ClientRegistrationCallbackResult | undefined {
  if (dcrEnabled !== '1') {
    console.warn('mcp_registration_closed');
    return { code: 'access_denied', description: 'Dynamic client registration is not open on this server.', status: 403 };
  }
  const name = metadata.client_name;
  if (JSON.stringify(metadata).length > MAX_REGISTRATION_BYTES || (name !== undefined && (typeof name !== 'string' || name.length > MAX_CLIENT_NAME))) {
    console.warn('mcp_registration_too_large');
    return { code: 'invalid_client_metadata', description: 'Client metadata is too large.', status: 400 };
  }
  const uris: unknown[] = Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris : [];
  const refused = uris.find((uri) => typeof uri !== 'string' || !isAllowedRedirect(uri, { MCP_REDIRECT_ALLOW: redirectAllow }));
  if (uris.length > 0 && refused === undefined) return undefined;
  logRefusedRedirect(refused);
  if (typeof refused === 'string') {
    try {
      onRefusedRedirect?.(refused);
    } catch (error) {
      console.error('mcp_redirect_capture_failed', error instanceof Error ? error.name : 'unknown');
    }
  }
  return {
    code: 'invalid_redirect_uri',
    description: `This redirect URI is not on the server's list. Only Harvey, Microsoft Copilot and Claude may register; the owner can allow a new one (${CONTACT}).`,
    status: 400,
  };
}

function publicPage(request: Request, html: () => string): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  return htmlResponse(html());
}

/** /privacy and /terms once the owner has approved their wording (POLICIES_PUBLISHED = "1"); until then a placeholder. */
function policyPage(request: Request, env: McpEnv, html: () => string): Response {
  if (env.POLICIES_PUBLISHED === '1') return publicPage(request, html);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  return messagePage(200, 'Being finalized', `This page is being finalized. Questions: ${contactEmail}.`);
}

async function connections(request: Request, env: McpEnv, deps: GateDeps): Promise<Response> {
  const gate = await requireMember(request, env, deps);
  return 'response' in gate ? gate.response : handleConnections(request, env, gate.member);
}

/** Everything that is not the MCP endpoint or a route the library owns. Unknown paths get a 404 page. */
export async function route(request: Request, env: McpEnv, deps: GateDeps = {}): Promise<Response> {
  const { pathname } = new URL(request.url);
  try {
    switch (pathname) {
      case '/authorize':
        return await handleAuthorize(request, env, deps);
      case '/connections':
        return await connections(request, env, deps);
      case '/admin/clients':
        return await handleAdminClients(request, env, deps);
      case '/privacy':
        return policyPage(request, env, renderPrivacy);
      case '/terms':
        return policyPage(request, env, renderTerms);
      case CONNECT_PATH: {
        // With pro, the kits and, once COPILOT_REFERENCE_ID is set, the agent download (mcp/pro.ts). ?for= orders the
        // panel for whoever the invitation was for (worker/invite.ts). A company room's emails say so.
        const options = { ...connectOptions(env), reader: readerOf(new URL(request.url)), company: await isCompanyRoom(env) };
        return publicPage(request, () => renderConnectPage(options));
      }
      case SECURITY_PATH:
        // The security brief with this room's names; no live settings (mcp/pages/security.ts).
        return publicPage(request, () => renderSecurityPage());
      default: {
        // A page a package added (mcp/extensions.ts; pro: the Copilot agent package), else the 404 page.
        const page = addedPage(pathname);
        return page ? await page(request, env) : messagePage(404, 'Not found', 'There is no page here.');
      }
    }
  } catch (error) {
    console.error('mcp_page_failed', error instanceof Error ? error.name : 'unknown');
    return messagePage(500, 'Something went wrong', 'Try again in a minute.');
  }
}

/** RFC 9728 metadata for the one protected resource, /mcp on the given origin. */
export function resourceMetadata(origin: string) {
  const resource = origin === MCP_ORIGIN ? MCP_RESOURCE : `${origin}/mcp`;
  return { resource, authorization_servers: [origin], resource_name: SERVER_TITLE };
}

/** RFC 9728's well-known path, and where the library serves the document for /mcp (the path the 401 names). */
export const RESOURCE_METADATA_ROOT = '/.well-known/oauth-protected-resource';
export const RESOURCE_METADATA_PATH = `${RESOURCE_METADATA_ROOT}${new URL(MCP_RESOURCE).pathname}`;

/**
 * The same document at the root well-known path, for clients that look there instead: the MCP authorization spec's
 * fallback, and Microsoft's dynamic registration page, which names only `.well-known/oauth-protected-resource`.
 * Returns the request rewritten to the /mcp document the library serves (method and headers kept), or null for any
 * other path. Its `resource` stays .../mcp, the server URL clients check it against.
 */
export function rootResourceMetadataRequest(request: Request): Request | null {
  const url = new URL(request.url);
  if (url.pathname !== RESOURCE_METADATA_ROOT) return null;
  url.pathname = RESOURCE_METADATA_PATH;
  return new Request(url, request);
}

/**
 * The provider options. Refresh tokens live REFRESH_TOKEN_TTL_SECONDS from sign-in however often they are used
 * (the owner, D6), so there is no refreshTokenIdleTTL. Public clients may register (Claude does), a confidential
 * registrant gets a secret (Microsoft needs one), and the implicit flow stays off (the library refuses it).
 */
export function oauthOptions(deps: OAuthDeps): OAuthProviderOptions<McpEnv> {
  return {
    apiRoute: '/mcp',
    // A wrapper, so ctx (and with it the props the library decrypted from the token) always reaches serveMcp.
    apiHandler: { fetch: (request, env, ctx) => serveMcp(request, env, ctx.props as Props) },
    defaultHandler: { fetch: (request, env) => route(request, env, deps) },
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/token',
    clientRegistrationEndpoint: '/register',
    scopesSupported: [...SCOPES],
    requiredScopes: [...SCOPES],
    accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTTL: REFRESH_TOKEN_TTL_SECONDS,
    clientRegistrationTTL: CLIENT_REGISTRATION_TTL_SECONDS,
    resourceMetadata: resourceMetadata(publicOrigin(deps.devOrigin)),
    clientIdMetadataDocumentEnabled: true,
    clientRegistrationCallback: ({ clientMetadata }) => checkRegistration(clientMetadata, deps.redirectAllow(), deps.dcrEnabled?.() ?? '0', deps.onRefusedRedirect),
    // Stable slugs only: never the description or detail, which can echo client input.
    onError: ({ code, internal }) => {
      console.warn('mcp_oauth_error', code, internal.category, internal.reason);
    },
  };
}
