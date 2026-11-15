// SPDX-License-Identifier: Apache-2.0
// The OAuth half of the legallas-mcp smoke and eval clients (scripts/mcp-smoke.ts, scripts/mcp-eval.ts): PKCE,
// discovery (RFC 9728 then RFC 8414), dynamic registration (RFC 7591), the consent form, and the token endpoint
// (code exchange, refresh, RFC 7009 revocation). No browser and no listener: the code is read from the
// approval's Location header. Every call takes an injected fetch, so tests drive it with a fake.
//
// Nothing here logs. Callers print statuses, codes and lengths only, never tokens, secrets or page text.
import { MCP_ORIGIN, MCP_RESOURCE, SCOPE_READ } from './mcp-constants.ts';

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Every request gives up after this long, so a hung server fails one check instead of hanging the run. */
export const FETCH_TIMEOUT_MS = 30_000;

export function timeout(): AbortSignal {
  return AbortSignal.timeout(FETCH_TIMEOUT_MS);
}

/** JSON.parse with a fixed message: V8's own errors quote fragments of the input, which may be case content. */
export function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} is not valid JSON`);
  }
}

/** A random PKCE verifier and its S256 challenge (RFC 7636). */
export interface Pkce {
  verifier: string;
  challenge: string;
}

/** base64url without padding. */
export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** S256: base64url(SHA-256(ASCII verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export async function createPkce(): Promise<Pkce> {
  const verifier = randomToken(32);
  return { verifier, challenge: await pkceChallenge(verifier) };
}

/** The auth-params of a `WWW-Authenticate: Bearer k="v", ...` challenge, keys lowercased; null if not Bearer. */
export function parseBearerChallenge(header: string | null): Record<string, string> | null {
  if (!header) return null;
  const match = /^\s*Bearer\b(.*)$/i.exec(header);
  if (!match) return null;
  const params: Record<string, string> = {};
  for (const part of match[1]!.matchAll(/([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g)) {
    params[part[1]!.toLowerCase()] = (part[2] ?? part[3] ?? '').replace(/\\(.)/g, '$1');
  }
  return params;
}

/** True for a localhost or 127.0.0.1 base: the only kind a local run uses. */
function isLocal(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

/**
 * Keeps every discovered URL on the server under test. Local runs map the production origin onto the local
 * base (a server configured with MCP_RESOURCE advertises it), and a portless http://localhost too: `wrangler
 * dev` forwards requests with `dev.host`, so the Worker builds its URLs without the port. Any other origin is
 * refused, so no token or secret can be sent elsewhere and a local smoke never contacts production.
 */
export function onBase(url: string, base: string): string {
  const parsed = new URL(url, base);
  const target = new URL(base);
  const portlessLocal = isLocal(target) && isLocal(parsed) && parsed.protocol === 'http:' && parsed.port === '';
  if ((parsed.origin === MCP_ORIGIN && target.origin !== MCP_ORIGIN) || portlessLocal) {
    parsed.protocol = target.protocol;
    parsed.host = target.host;
  }
  if (parsed.origin !== target.origin) throw new Error(`refusing an endpoint off the server under test (${parsed.origin})`);
  return parsed.href;
}

/** RFC 9728 metadata, validated to what a client needs. */
export interface ProtectedResource {
  resource: string;
  authorizationServers: string[];
  scopes: string[];
}

export function parseProtectedResource(raw: unknown): ProtectedResource {
  const doc = (raw ?? {}) as Record<string, unknown>;
  if (typeof doc.resource !== 'string' || !doc.resource) throw new Error('prm_missing_resource');
  const servers = Array.isArray(doc.authorization_servers) ? doc.authorization_servers.filter((s): s is string => typeof s === 'string') : [];
  if (servers.length === 0) throw new Error('prm_missing_authorization_servers');
  const scopes = Array.isArray(doc.scopes_supported) ? doc.scopes_supported.filter((s): s is string => typeof s === 'string') : [];
  return { resource: doc.resource, authorizationServers: servers, scopes };
}

/** RFC 8414 metadata, validated to what this client uses. */
export interface AuthServer {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint: string | null;
  s256: boolean;
  /** RFC 9207: the server promises `iss` on every authorization response, so a missing one is an error. */
  issParameter: boolean;
}

export function parseAuthServer(raw: unknown): AuthServer {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const need = (key: string): string => {
    const value = doc[key];
    if (typeof value !== 'string' || !value) throw new Error(`asm_missing_${key}`);
    return value;
  };
  const methods = Array.isArray(doc.code_challenge_methods_supported) ? doc.code_challenge_methods_supported : [];
  return {
    issuer: need('issuer'),
    authorizationEndpoint: need('authorization_endpoint'),
    tokenEndpoint: need('token_endpoint'),
    registrationEndpoint: need('registration_endpoint'),
    revocationEndpoint: typeof doc.revocation_endpoint === 'string' ? doc.revocation_endpoint : null,
    s256: methods.includes('S256'),
    issParameter: doc.authorization_response_iss_parameter_supported === true,
  };
}

/** Every endpoint the client will call, through onBase: mapped onto a local base, refused if off-server. */
export function pinAuthServer(asm: AuthServer, base: string): AuthServer {
  return {
    ...asm,
    authorizationEndpoint: onBase(asm.authorizationEndpoint, base),
    tokenEndpoint: onBase(asm.tokenEndpoint, base),
    registrationEndpoint: onBase(asm.registrationEndpoint, base),
    revocationEndpoint: asm.revocationEndpoint === null ? null : onBase(asm.revocationEndpoint, base),
  };
}

/** RFC 8414 section 3: the well-known suffix goes between the host and any issuer path. */
export function authServerMetadataUrl(issuer: string): string {
  const url = new URL(issuer);
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return `${url.origin}/.well-known/oauth-authorization-server${path}`;
}

/** The resource's metadata URL when a 401 does not name one: RFC 9728 section 3.1. */
export function protectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname === '/' ? '' : url.pathname}`;
}

export interface Discovery {
  /** The 401's status and resource_metadata parameter (null when absent). */
  challenge: { status: number; resourceMetadata: string | null };
  prm: ProtectedResource;
  /** False when a local server serves no RFC 9728 document and `prm` is the fallback (see discover). */
  prmServed: boolean;
  asm: AuthServer;
}

async function getJson(fetcher: Fetch, url: string): Promise<unknown> {
  const response = await fetcher(url, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: timeout() });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return parseJson(await response.text(), 'a metadata document');
}

/** An unauthenticated MCP request, as a client first sends it, to read the 401 challenge. */
export async function probeChallenge(fetcher: Fetch, endpoint: string): Promise<{ status: number; resourceMetadata: string | null }> {
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/list', params: {} }),
    redirect: 'manual',
    signal: timeout(),
  });
  await response.body?.cancel();
  return { status: response.status, resourceMetadata: parseBearerChallenge(response.headers.get('WWW-Authenticate'))?.resource_metadata ?? null };
}

/**
 * Discovery as an MCP client does it: 401 challenge, then RFC 9728, then RFC 8414. A local server may serve no
 * RFC 9728 document: workers-oauth-provider serves it only when the request's origin is the resource's
 * (MCP_ORIGIN), and under `wrangler dev` it is http://localhost. Then, locally only, the MCP server's own origin
 * stands in as the authorization server (the MCP 2025-03-26 fallback) and `prmServed` is false.
 */
export async function discover(fetcher: Fetch, base: string): Promise<Discovery> {
  const challenge = await probeChallenge(fetcher, `${base}/mcp`);
  const prmUrl = onBase(challenge.resourceMetadata ?? protectedResourceMetadataUrl(`${base}/mcp`), base);
  const response = await fetcher(prmUrl, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: timeout() });
  let prm: ProtectedResource;
  const prmServed = response.status !== 404 || !isLocal(new URL(base)) || challenge.resourceMetadata !== null;
  if (prmServed) {
    if (!response.ok) throw new Error(`http_${response.status}`);
    prm = parseProtectedResource(parseJson(await response.text(), 'a metadata document'));
  } else {
    await response.body?.cancel();
    prm = { resource: MCP_RESOURCE, authorizationServers: [base], scopes: [] };
  }
  const asm = pinAuthServer(parseAuthServer(await getJson(fetcher, onBase(authServerMetadataUrl(prm.authorizationServers[0]!), base))), base);
  return { challenge, prm, prmServed, asm };
}

/** The resource a token is requested for: MCP_RESOURCE, or the local server's own URL when it advertises that. */
export function resourceFor(prm: ProtectedResource, base: string): string {
  return prm.resource === MCP_RESOURCE || prm.resource === `${base}/mcp` ? prm.resource : MCP_RESOURCE;
}

export interface Client {
  clientId: string;
  clientSecret: string | null;
}

export interface Registration {
  status: number;
  client: Client | null;
  /** The OAuth error code on refusal. */
  error: string | null;
  /** The token_endpoint_auth_method the server recorded (RFC 7591 echoes it), or null when absent. */
  authMethod: string | null;
}

/** RFC 7591 token endpoint authentication: `none` (public, PKCE only) or a client secret, in the body or Basic. */
export type AuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';

/** The registration request body. `true` and `false` keep the original meaning: post a secret, or none. */
export function registrationBody(name: string, redirectUri: string, auth: boolean | AuthMethod): Record<string, unknown> {
  const method: AuthMethod = auth === true ? 'client_secret_post' : auth === false ? 'none' : auth;
  return {
    client_name: name,
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: method,
  };
}

/** RFC 7591 registration of a public (`none`) or confidential (`client_secret_post` or `_basic`) client. */
export async function register(fetcher: Fetch, endpoint: string, name: string, redirectUri: string, auth: boolean | AuthMethod): Promise<Registration> {
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(registrationBody(name, redirectUri, auth)),
    redirect: 'manual',
    signal: timeout(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const authMethod = typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : null;
  if (!response.ok || typeof body.client_id !== 'string') {
    return { status: response.status, client: null, error: typeof body.error === 'string' ? body.error : `http_${response.status}`, authMethod };
  }
  const client = { clientId: body.client_id, clientSecret: typeof body.client_secret === 'string' ? body.client_secret : null };
  return { status: response.status, client, error: null, authMethod };
}

/** The authorization request URL (code flow, PKCE S256, RFC 8707 resource; null leaves `resource` out, as Harvey may). */
export function authorizeUrl(endpoint: string, client: Client, redirectUri: string, pkce: Pkce, state: string, resource: string | null): string {
  const url = new URL(endpoint);
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: redirectUri,
    scope: SCOPE_READ,
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
  };
  if (resource !== null) params.resource = resource;
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
}

/** `name=value` pairs from Set-Cookie headers, ready for a Cookie header. Attributes are dropped. */
export function cookiesFrom(headers: Headers): string[] {
  return headers.getSetCookie().map((line) => line.split(';', 1)[0]!.trim()).filter((pair) => pair.includes('='));
}
