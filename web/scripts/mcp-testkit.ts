// SPDX-License-Identifier: Apache-2.0
// Test support for the legallas-mcp smoke and eval clients (never imported by them): a fake server as a fetch
// function. It follows the rules the real one gets from @cloudflare/workers-oauth-provider that the clients
// depend on: a 401 challenge naming the production metadata URL, S256 PKCE, a consent handle bound to a
// cookie, a refresh token that stays valid until its successor is used, invalid_target for another resource,
// RFC 7009 revocation of a whole grant, and an MCP endpoint that answers both protocol revisions. For the
// counsel AI connect wave it also mirrors DEFAULT_REDIRECT_ALLOW with the `*.harvey.ai` rule, the
// REGISTER_LIMIT 429, the Origin rule, the revocation audit row and the /connect page with its package. For the
// per-kind grants it authenticates clients by their registered method (Basic included, as the library does) and
// answers tools by the client's kind (compact for Microsoft, image blocks for Claude only).
import { zipStore } from '../mcp/zip.ts';
import { CONNECT_PLAN, DESKTOP_KINDS, KIND_NAMES } from './connect-e2e-kinds.ts';
import { pkceChallenge } from './mcp-oauth.ts';
import { LAW_TOOL_NAME, MCP_ORIGIN, MCP_RESOURCE, READ_ONLY_ANNOTATIONS, SCOPE_READ, TOOL_NAMES } from './mcp-constants.ts';

export interface FakeOptions {
  /** Tool results by name; anything absent answers a coded not_found error. */
  tools?: Record<string, Record<string, unknown>>;
  /** Overrides applied to the RFC 8414 document. */
  asm?: Record<string, unknown>;
  /** Leave `iss` off the authorization response (the metadata still promises it unless overridden). */
  omitIss?: boolean;
  /**
   * Answer like the real server under `wrangler dev`: the Worker sees http://localhost (no port), so the
   * issuer and endpoints are portless and the library serves no RFC 9728 document nor names one in the 401.
   */
  wranglerDev?: boolean;
  /** POST /register calls allowed before a 429; REGISTER_LIMIT's 10 by default, Infinity for no gate. */
  registerLimit?: number;
  /** Refuse an unlisted Origin on /mcp with 403, as MCP_ORIGIN_ENFORCE "1" does. */
  originEnforce?: boolean;
  /** Serve /connect and the package route as the contract stubs did (404), to model a wave PR not yet merged. */
  connectStubbed?: boolean;
  /** Leave the ai_disconnect audit row out on revocation. */
  skipRevokeAudit?: boolean;
  /** What prompts/list answers; the real server's nine prompts (mcp/prompts.ts) by default. */
  prompts?: FakePrompt[];
  /**
   * Which kinds get compact results and which get image blocks; the real server's rule by default (Microsoft
   * compact, Claude images). Overrides model a broken server. Loopback (`unknown`) clients always get compact results.
   */
  kinds?: { compact?: readonly FakeKind[]; images?: readonly FakeKind[] };
  /** List the law library's search beside the eight (LAW_LIBRARY "1"). */
  law?: boolean;
}

export type FakeKind = 'claude' | 'harvey' | 'microsoft';

/** The local smoke's kinds in run order: the four counsel kinds, then the desktop ones (OpenCode). */
const LOCAL_KINDS: readonly string[] = [...KIND_NAMES, ...Object.keys(DESKTOP_KINDS)];

/** Every kind's check with the same suffix, in run order (`call_get_file` gives `claude_call_get_file`, ...). */
export const perKind = (suffix: string): string[] => LOCAL_KINDS.map((kind) => `${kind}_${suffix}`);

/** What the local smoke's per-kind grants record (mcp-smoke.ts kindSteps, connect-e2e-kinds.ts localKindSteps), in order. */
export function kindCheckNames(): string[] {
  const steps = [
    'authorize_consent_page', 'approve_consent', 'token_exchange', 'refresh', 'mcp_initialize', 'tools_list',
    ...CONNECT_PLAN.map((call) => `call_${call.step}`),
    'revoke_grant', 'revoked_access_refused', 'revoked_refresh_refused',
  ];
  const named = (kind: string) => steps.map((step) => `${kind}_${step}`);
  return ['register_claude_public', ...KIND_NAMES.flatMap(named), ...Object.keys(DESKTOP_KINDS).flatMap((kind) => [`register_${kind}_public`, ...named(kind)])];
}

/** mcp/server.ts clientKindOf for one redirect: the hosts the fake allows, else null (unknown). */
export function fakeKindOf(redirect: string): FakeKind | null {
  const host = new URL(redirect).hostname;
  if (host === 'claude.ai' || host === 'claude.com') return 'claude';
  if (host === 'harvey.ai' || host.endsWith('.harvey.ai')) return 'harvey';
  if (host === 'teams.microsoft.com' || host.endsWith('.azure-apim.net')) return 'microsoft';
  return null;
}

type ToolResult = Record<string, unknown> & { content?: { type?: unknown; text?: unknown }[]; structuredContent?: Record<string, unknown> };

/** A Claude-shaped result as another kind gets it: no binary blocks nor embedded flags, then forProfile when compact. */
export function fakeProfiled(result: ToolResult, images: boolean, compact: boolean): ToolResult {
  let out: ToolResult = result;
  if (!images) {
    const value = out.structuredContent ? { ...out.structuredContent } : undefined;
    if (value?.embedded === true) Object.assign(value, { embedded: false, reason: 'client' });
    if (value) delete value.image_embedded;
    out = { ...out, content: (out.content ?? []).filter((block) => block.type === 'text'), ...(value ? { structuredContent: value } : {}) };
  }
  if (!compact || out.isError === true || !out.structuredContent || out.content?.length !== 1) return out;
  const { structuredContent, ...rest } = out;
  return { ...rest, content: [{ type: 'text', text: JSON.stringify(structuredContent) }] };
}

type FakePrompt = { name: string; arguments?: { name: string; required?: boolean }[] };
/** mcp/prompts.ts as clients see it, written out so the smoke's own mirror (PROMPT_ARGS) is checked against it. */
const PROMPTS: FakePrompt[] = [
  { name: 'matter_briefing' },
  { name: 'violation_proof', arguments: [{ name: 'violation', required: true }] },
  { name: 'topic_chronology', arguments: [{ name: 'topic', required: true }] },
  { name: 'matter_board' },
  { name: 'review_grid' },
  { name: 'cite_check' },
  { name: 'matter_chronology' },
  { name: 'entity_matrix' },
  { name: 'deviation_board' },
];

/** DEFAULT_REDIRECT_ALLOW (mcp/contract.ts) plus the local loopback entries and the `*.harvey.ai` rule. */
export function fakeAllowsRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === 'http:') return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:') return false;
  if (url.hostname === 'harvey.ai' || url.hostname.endsWith('.harvey.ai')) return true;
  const exact = ['https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect', 'https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'];
  return exact.includes(uri) || (uri.startsWith('https://global.consent.azure-apim.net/redirect/') && url.href === uri);
}

const ORIGINS = /^https:\/\/(claude\.ai|claude\.com|([a-z0-9-]+\.)*(microsoft\.com|office\.com|cloud\.microsoft|azure-apim\.net|harvey\.ai))$/;

interface Consent {
  clientId: string;
  redirect: string;
  state: string;
  challenge: string;
  resource: string;
}

interface Grant {
  clientId: string;
  refresh: string;
  previous: string | null;
  access: Set<string>;
  revoked: boolean;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const oauthError = (error: string, status = 400) => json({ error }, status);

/** A fake legallas-mcp. `requests` records every URL fetched, for "never left the server" assertions. */
class FakeServer {
  readonly requests: string[] = [];
  readonly grants: Grant[] = [];
  /** audit_log actions written, in order (ids are index + 1). */
  readonly audit: string[] = [];
  private readonly options: FakeOptions;
  private registrations = 0;
  private readonly clients = new Map<string, { secret: string | null; redirect: string; method: string }>();
  private readonly consents = new Map<string, Consent>();
  private readonly codes = new Map<string, Consent>();
  private readonly asm: Record<string, unknown>;
  private n = 0;

  constructor(options: FakeOptions) {
    this.options = options;
    const origin = options.wranglerDev ? 'http://localhost' : MCP_ORIGIN;
    this.asm = {
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      revocation_endpoint: `${origin}/token`,
      code_challenge_methods_supported: ['S256'],
      response_types_supported: ['code'],
      authorization_response_iss_parameter_supported: true,
      ...options.asm,
    };
  }

  /** Every issued value ends in SECRETVALUE, so tests can assert none is printed. */
  private next(prefix: string): string {
    return `${prefix}-${++this.n}-SECRETVALUE`;
  }

  register(body: Record<string, unknown>): Response {
    if (++this.registrations > (this.options.registerLimit ?? 10)) {
      return json({ error: 'rate_limited' }, 429, { 'Retry-After': '60' });
    }
    const redirect = (body.redirect_uris as string[] | undefined)?.[0] ?? '';
    if (!fakeAllowsRedirect(redirect)) return oauthError('invalid_redirect_uri');
    const id = this.next('client');
    const method = String(body.token_endpoint_auth_method ?? 'client_secret_basic');
    const secret = method === 'none' ? null : this.next('secret');
    this.clients.set(id, { secret, redirect, method });
    return json({ client_id: id, token_endpoint_auth_method: method, ...(secret ? { client_secret: secret } : {}) }, 201);
  }

  authorizePage(url: URL): Response {
    const q = url.searchParams;
    const client = this.clients.get(q.get('client_id') ?? '');
    if (!client || client.redirect !== q.get('redirect_uri') || q.get('code_challenge_method') !== 'S256' || q.get('scope') !== SCOPE_READ) return new Response('bad request', { status: 400 });
    const handle = this.next('handle');
    this.consents.set(handle, { clientId: q.get('client_id')!, redirect: client.redirect, state: q.get('state') ?? '', challenge: q.get('code_challenge') ?? '', resource: q.get('resource') ?? '' });
    const html = `<main><form method="post" action="/authorize"><input type="hidden" name="handle" value="${handle}">` +
      `<button type="submit" name="decision" value="deny">Deny</button><button type="submit" name="decision" value="approve">Allow &amp; connect</button></form></main>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html', 'Set-Cookie': `__Host-oauth-consent=${handle}; Path=/; Secure; HttpOnly; SameSite=Lax` } });
  }

  approve(form: URLSearchParams, cookie: string, origin: string | null): Response {
    const handle = form.get('handle') ?? '';
    const consent = this.consents.get(handle);
    if (!consent || !cookie.includes(`__Host-oauth-consent=${handle}`) || origin === null || form.get('decision') !== 'approve') return new Response('forbidden', { status: 403 });
    this.consents.delete(handle);
    const code = this.next('code');
    this.codes.set(code, consent);
    const to = new URL(consent.redirect);
    const query: Record<string, string> = { code, state: consent.state };
    if (!this.options.omitIss) query.iss = String(this.asm.issuer);
    to.search = new URLSearchParams(query).toString();
    return new Response(null, { status: 302, headers: { Location: to.href } });
  }

  private issue(grant: Grant): Response {
    const access = this.next('access');
    grant.access.add(access);
    return json({ access_token: access, token_type: 'bearer', expires_in: 3600, refresh_token: grant.refresh, scope: SCOPE_READ });
  }

  /**
   * The client a token request authenticates, as workers-oauth-provider checks it: Basic credentials with nothing in
   * the body (both is invalid_request), or client_id and an optional client_secret in the body; the method presented
   * must be the one registered, and the secret must match.
   */
  private authenticate(form: URLSearchParams, authorization: string | null): string | Response {
    const basic = /^Basic\s+(\S+)$/i.exec(authorization ?? '');
    let clientId = form.get('client_id') ?? '';
    let secret = form.get('client_secret');
    let presented = secret ? 'client_secret_post' : 'none';
    if (basic) {
      if (form.has('client_id') || form.has('client_secret')) return oauthError('invalid_request');
      const pair = atob(basic[1]!);
      const decode = (value: string) => decodeURIComponent(value.replace(/\+/g, ' '));
      [clientId, secret, presented] = [decode(pair.slice(0, pair.indexOf(':'))), decode(pair.slice(pair.indexOf(':') + 1)), 'client_secret_basic'];
    }
    const client = this.clients.get(clientId);
    if (!client || client.method !== presented || (client.secret !== null && secret !== client.secret)) return oauthError('invalid_client', 401);
    return clientId;
  }

  async token(form: URLSearchParams, authorization: string | null): Promise<Response> {
    const clientId = this.authenticate(form, authorization);
    if (clientId instanceof Response) return clientId;
    if (form.has('token') && !form.has('grant_type')) {
      for (const g of this.grants) {
        if (g.revoked || g.clientId !== clientId || (g.refresh !== form.get('token') && g.previous !== form.get('token'))) continue;
        g.revoked = true;
        if (!this.options.skipRevokeAudit) this.audit.push('ai_disconnect');
      }
      return new Response('', { status: 200 });
    }
    return form.get('grant_type') === 'authorization_code' ? this.exchange(form, clientId) : this.refresh(form, clientId);
  }

  private async exchange(form: URLSearchParams, clientId: string): Promise<Response> {
    const code = this.codes.get(form.get('code') ?? '');
    if (!code || code.clientId !== clientId || code.redirect !== form.get('redirect_uri')) return oauthError('invalid_grant');
    if ((await pkceChallenge(form.get('code_verifier') ?? '')) !== code.challenge) return oauthError('invalid_grant');
    if ((form.get('resource') ?? '') !== code.resource) return oauthError('invalid_target');
    this.codes.delete(form.get('code')!);
    const grant: Grant = { clientId, refresh: this.next('refresh'), previous: null, access: new Set(), revoked: false };
    this.grants.push(grant);
    return this.issue(grant);
  }

  private refresh(form: URLSearchParams, clientId: string): Response {
    const presented = form.get('refresh_token');
    const grant = this.grants.find((g) => !g.revoked && g.clientId === clientId && (g.refresh === presented || g.previous === presented));
    if (!grant) return oauthError('invalid_grant');
    if (form.has('resource') && form.get('resource') !== MCP_RESOURCE) return oauthError('invalid_target');
    // The presented token becomes "previous" (valid until the new one is used); an older one dies.
    if (presented === grant.refresh) grant.previous = presented;
    grant.refresh = this.next('refresh');
    return this.issue(grant);
  }

  mcp(body: { id?: number; method?: string; params?: Record<string, unknown> }, bearer: string | undefined, headers: Headers): Response {
    if (bearer === undefined || !this.grants.some((g) => !g.revoked && g.access.has(bearer))) {
      const prm = `${MCP_ORIGIN}/.well-known/oauth-protected-resource/mcp`;
      const challenge = this.options.wranglerDev ? `Bearer realm="OAuth", scope="${SCOPE_READ}"` : `Bearer error="invalid_token", resource_metadata="${prm}", scope="${SCOPE_READ}"`;
      return new Response('', { status: 401, headers: { 'WWW-Authenticate': challenge } });
    }
    const origin = headers.get('Origin');
    if (this.options.originEnforce && origin !== null && !ORIGINS.test(origin)) return new Response('forbidden', { status: 403 });
    if (body.id === undefined) return new Response(null, { status: 202 });
    const modern = headers.get('MCP-Protocol-Version') === '2026-07-28';
    if (modern && !(body.params?._meta as Record<string, unknown> | undefined)?.['io.modelcontextprotocol/protocolVersion']) return json({ jsonrpc: '2.0', id: body.id, error: { code: -32602 } }, 400);
    const result = this.mcpResult(body.method, body.params, this.kindOf(bearer));
    if (!result) return json({ jsonrpc: '2.0', id: body.id, error: { code: -32601 } });
    const frame = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`;
    return modern ? json({ jsonrpc: '2.0', id: body.id, result }) : new Response(frame, { headers: { 'Content-Type': 'text/event-stream' } });
  }

  /** The kind of the client behind an access token, from its registered redirect; null for loopback. */
  private kindOf(bearer: string): FakeKind | null {
    const grant = this.grants.find((g) => g.access.has(bearer));
    const client = grant ? this.clients.get(grant.clientId) : undefined;
    return client ? fakeKindOf(client.redirect) : null;
  }

  private toolResult(name: string, kind: FakeKind | null): Record<string, unknown> {
    const result = this.options.tools?.[name] ?? { isError: true, content: [{ type: 'text', text: 'not_found: No such document.' }] };
    const compact = this.options.kinds?.compact ?? ['microsoft'];
    const images = this.options.kinds?.images ?? ['claude'];
    // An app the server doesn't know (loopback) gets compact results with no bytes, as mcp/contract.ts PROFILE_OF has it.
    if (kind === null) return fakeProfiled(result, false, true);
    return fakeProfiled(result, images.includes(kind), compact.includes(kind));
  }

  private mcpResult(method: string | undefined, params: Record<string, unknown> | undefined, kind: FakeKind | null = null): Record<string, unknown> | null {
    if (method === 'initialize') return { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'legallas' } };
    if (method === 'server/discover') return { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } };
    const names = this.options.law ? [...TOOL_NAMES, LAW_TOOL_NAME] : TOOL_NAMES;
    if (method === 'tools/list') return { tools: names.map((name) => ({ name, title: name, inputSchema: { type: 'object' }, annotations: { ...READ_ONLY_ANNOTATIONS } })) };
    if (method === 'tools/call') return this.toolResult(String(params?.name), kind);
    const prompts = this.options.prompts ?? PROMPTS;
    if (method === 'prompts/list') return { prompts };
    if (method === 'prompts/get' && prompts.some((p) => p.name === params?.name)) return { messages: [{ role: 'user', content: { type: 'text', text: 'Prompt text' } }] };
    return null;
  }

  copilotPackage(form: URLSearchParams): Response {
    if (this.options.connectStubbed) return new Response('not found', { status: 404 });
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    const zip = zipStore([
      { name: 'manifest.json', data: encode({ id: 'fake' }) },
      { name: 'ai-plugin.json', data: encode({ runtimes: [{ auth: { reference_id: form.get('reference_id') } }] }) },
    ]);
    return new Response(new Uint8Array(zip), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="legallas-copilot-agent.zip"' } });
  }

  async route(request: Request): Promise<Response> {
    this.requests.push(request.url);
    const url = new URL(request.url);
    const text = request.method === 'POST' ? await request.text() : '';
    switch (`${request.method} ${url.pathname}`) {
      case 'GET /.well-known/oauth-protected-resource/mcp':
        if (this.options.wranglerDev) return new Response('not found', { status: 404 });
        return json({ resource: MCP_RESOURCE, authorization_servers: [MCP_ORIGIN], scopes_supported: [SCOPE_READ] });
      case 'GET /.well-known/oauth-authorization-server':
        return json(this.asm);
      case 'POST /register':
        return this.register(JSON.parse(text));
      case 'GET /authorize':
        return this.authorizePage(url);
      case 'POST /authorize':
        return this.approve(new URLSearchParams(text), request.headers.get('Cookie') ?? '', request.headers.get('Origin'));
      case 'POST /token':
        return this.token(new URLSearchParams(text), request.headers.get('Authorization'));
      case 'GET /connect':
        if (this.options.connectStubbed) return new Response('not found', { status: 404 });
        return new Response(`<main><input readonly value="${MCP_RESOURCE}"></main>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      case 'POST /connect/copilot-package':
        return this.copilotPackage(new URLSearchParams(text));
      case 'POST /mcp':
        return this.mcp(JSON.parse(text), /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1], request.headers);
      default:
        return new Response('not found', { status: 404 });
    }
  }
}

/** A fake legallas-mcp as a fetch function, with the URLs it saw and the grants it issued. */
export function fakeServer(options: FakeOptions = {}) {
  const server = new FakeServer(options);
  const fetcher = (input: string | URL | Request, init?: RequestInit): Promise<Response> => server.route(new Request(input, init));
  const audit = {
    lastId: async () => server.audit.length,
    disconnectsAfter: async (id: number) => server.audit.slice(id).filter((action) => action === 'ai_disconnect').length,
  };
  return { fetcher, requests: server.requests, grants: server.grants, audit };
}
