// SPDX-License-Identifier: Apache-2.0
// The counsel AI connect checks of the legallas-mcp smoke (scripts/mcp-smoke.ts runs them): Microsoft's and
// Harvey's registrations, an authorization without `resource`, the unlisted-Origin rule, the revocation audit
// row, the /register rate limit, and the public /connect page with its Copilot package download.
// Like the rest of the smoke, details carry statuses, codes and counts only, never tokens, secrets or page text.
import { setTimeout as sleep } from 'node:timers/promises';
import { LEGACY_VERSION } from './mcp-client.ts';
import { MCP_RESOURCE } from './mcp-constants.ts';
import type { Grant, Report } from './mcp-flow.ts';
import { approveConsent, exchangeCode, openConsent, revoke, type TokenClient } from './mcp-grant.ts';
import { authorizeUrl, createPkce, randomToken, register, registrationBody, timeout, type AuthMethod, type Fetch, type Registration } from './mcp-oauth.ts';
import { looksLikeZip, readZip } from './mcp-zip.ts';

/** claude.ai's connector callback (a public client, PKCE only). */
export const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
/** The Teams Developer Portal redirect: Microsoft registers a confidential client and needs a secret. */
export const TEAMS_REDIRECT = 'https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect';
/** A Copilot Studio (Power Platform connector) redirect: a public client, PKCE only. */
export const APIM_REDIRECT = 'https://global.consent.azure-apim.net/redirect/smoke';
/** A callback on Harvey's own domain (the `*.harvey.ai` rule), and a lookalike host that must stay refused. */
export const HARVEY_REDIRECT = 'https://app.harvey.ai/oauth/callback';
export const HARVEY_LOOKALIKE = 'https://harvey.ai.invalid/cb';
/**
 * OpenCode's default sign-in callback (opencode.ai/config.json, read 2026-10-31), the way an open-weight model connects:
 * a public client on loopback, so the room needs loopback allowed (the desktop apps switch; local dev allows it).
 */
export const OPENCODE_REDIRECT = 'http://127.0.0.1:19876/mcp/oauth/callback';
/** A browser Origin that is not in ORIGIN_ALLOW. */
export const UNLISTED_ORIGIN = 'https://evil.example';
/** The registration ID the smoke pastes into the Copilot package form. */
export const PACKAGE_REFERENCE_ID = 'smoke-test-id';
/** REGISTER_LIMIT allows 10 a minute per IP, so the 11th quick POST /register must be refused. */
export const RATE_LIMIT_BURST = 11;

/** Checks the Copilot package's files; an empty list means valid (connect/copilot/validate.ts validatePackage). */
export type PackageValidator = (files: ReadonlyMap<string, Uint8Array>) => string[];

/** The local D1's audit_log, read through `wrangler d1 execute --local` (tests pass a fake). */
export interface AuditProbe {
  lastId(): Promise<number>;
  disconnectsAfter(id: number): Promise<number>;
}

const registrationDetail = (r: Registration) =>
  `status ${r.status}${r.error ? `, ${r.error}` : ''}, secret ${r.client?.clientSecret ? 'issued' : 'none'}${r.authMethod ? `, auth ${r.authMethod}` : ''}`;

/** A refusal is a 4xx with no client: a 5xx or a client would both be wrong. */
export function refusedRegistration(r: Registration): boolean {
  return r.client === null && r.status >= 400 && r.status < 500;
}

/** The clients clientRegistrationSteps registered, each with its auth method, for the per-kind grants to reuse. */
export interface WaveClients {
  teams: TokenClient | null;
  apim: TokenClient | null;
  harvey: TokenClient | null;
}

const withMethod = (r: Registration, authMethod: AuthMethod): TokenClient | null => (r.client ? { ...r.client, authMethod } : null);

/**
 * Microsoft's confidential client (a secret, Basic auth), Copilot Studio's public client (no secret), Harvey's
 * domain allowed (a confidential client, secret in the body) and a lookalike refused. In production each accepted
 * one is a real client record named `name` (SMOKE_CLIENT_NAME), which legallas-mcp's daily sweep deletes once it is a
 * day old (mcp/smoke-clients.ts). Returns the accepted clients, so the local run's per-kind grants need no more
 * registrations (REGISTER_LIMIT allows 10 a minute).
 */
export async function clientRegistrationSteps(report: Report, fetcher: Fetch, endpoint: string, name: string): Promise<WaveClients> {
  const teams = await register(fetcher, endpoint, name, TEAMS_REDIRECT, 'client_secret_basic');
  const basic = teams.authMethod === null || teams.authMethod === 'client_secret_basic';
  report.add('register_teams_confidential', teams.client?.clientSecret != null && basic, registrationDetail(teams));
  const apim = await register(fetcher, endpoint, name, APIM_REDIRECT, 'none');
  report.add('register_apim_public', apim.client !== null && apim.client.clientSecret === null, registrationDetail(apim));
  const harvey = await register(fetcher, endpoint, name, HARVEY_REDIRECT, 'client_secret_post');
  report.add('register_harvey', harvey.client !== null, registrationDetail(harvey));
  const lookalike = await register(fetcher, endpoint, name, HARVEY_LOOKALIKE, 'none');
  report.add('register_harvey_lookalike_refused', refusedRegistration(lookalike), registrationDetail(lookalike));
  return { teams: withMethod(teams, 'client_secret_basic'), apim: withMethod(apim, 'none'), harvey: withMethod(harvey, 'client_secret_post') };
}

/** HTTP status of an MCP tools/list with this bearer token (and any extra headers, such as Origin). */
export async function mcpStatus(fetcher: Fetch, endpoint: string, token: string, extra: Record<string, string> = {}): Promise<number> {
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, 'MCP-Protocol-Version': LEGACY_VERSION, ...extra },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    redirect: 'manual',
    signal: timeout(),
  });
  await response.body?.cancel();
  return response.status;
}

/** What /mcp should answer an unlisted Origin: logged and served while MCP_ORIGIN_ENFORCE is "0", 403 at "1". */
export function originExpectation(enforce: string | null): number {
  return enforce === '1' ? 403 : 200;
}

export async function originStep(report: Report, fetcher: Fetch, endpoint: string, token: string, enforce: string | null): Promise<void> {
  const expected = originExpectation(enforce);
  const status = await mcpStatus(fetcher, endpoint, token, { Origin: UNLISTED_ORIGIN });
  report.add('mcp_origin_unlisted', status === expected, `status ${status}, expected ${expected} (MCP_ORIGIN_ENFORCE ${enforce ?? '0'})`);
}

/**
 * A second authorization on the same client with no `resource` anywhere (Harvey may omit it): the server must
 * default the audience to /mcp, so /mcp accepts the token. The grant is revoked afterwards.
 */
export async function noResourceStep(report: Report, fetcher: Fetch, base: string, grant: Grant): Promise<void> {
  const { asm } = grant.discovery;
  const pkce = await createPkce();
  const state = randomToken(16);
  const page = await openConsent(fetcher, authorizeUrl(asm.authorizationEndpoint, grant.client, grant.redirectUri, pkce, state, null));
  if (!page.form) return void report.add('no_resource_token', false, `consent status ${page.status}, form missing`);
  const approval = await approveConsent(fetcher, page.form, page.cookies, base);
  if (!approval.code || approval.state !== state) return void report.add('no_resource_token', false, `approve status ${approval.status}, code ${approval.code ? 'yes' : 'no'}${approval.error ? `, ${approval.error}` : ''}`);
  const token = await exchangeCode(fetcher, asm.tokenEndpoint, grant.client, approval.code, grant.redirectUri, pkce.verifier, null);
  if (!token.tokens) return void report.add('no_resource_token', false, `token status ${token.status}, ${token.error}`);
  const status = await mcpStatus(fetcher, `${base}/mcp`, token.tokens.accessToken);
  report.add('no_resource_token', status === 200, `token status ${token.status}, mcp status ${status}`);
  if (token.tokens.refreshToken) await revoke(fetcher, asm.revocationEndpoint ?? asm.tokenEndpoint, grant.client, token.tokens.refreshToken);
}

/** The audit_log id before the revocation, or null when the local D1 cannot be read (the audit check then skips). */
export async function auditBaseline(audit: AuditProbe | null): Promise<number | null> {
  if (!audit) return null;
  try {
    return await audit.lastId();
  } catch {
    return null;
  }
}

/** RFC 7009 revocation of a refresh token ends the grant, so the server writes one ai_disconnect row (mcp/index.ts). */
export async function auditStep(report: Report, audit: AuditProbe | null, before: number | null, attempts = 3): Promise<void> {
  if (!audit || before === null) return void report.add('revoke_audit_disconnect', null, 'local D1 not readable (wrangler d1 execute --local); mcp unit tests cover the row');
  let rows = 0;
  for (let i = 0; i < attempts && rows === 0; i++) {
    if (i > 0) await sleep(500);
    rows = await audit.disconnectsAfter(before);
  }
  report.add('revoke_audit_disconnect', rows > 0, `ai_disconnect rows ${rows}`);
}

/**
 * PASS on a 429 that says when to retry; FAIL on a 429 without Retry-After, a 5xx, a refused redirect that
 * registered, or no 429 at all. wrangler dev enforces Workers Rate Limiting locally (checked with 4.145.0: ten
 * pass, then 429), so no 429 means the gate in mcp/index.ts is missing, not that the runtime skipped it.
 */
export function rateLimitOutcome(statuses: readonly number[], retryAfter: string | null): { ok: boolean; detail: string } {
  const limited = statuses.indexOf(429);
  const wrong = statuses.find((s) => s >= 500 || (s >= 200 && s < 300));
  if (wrong !== undefined) return { ok: false, detail: `status ${wrong} among ${statuses.length} POST /register` };
  if (limited >= 0) return { ok: Boolean(retryAfter), detail: `429 on request ${limited + 1}, Retry-After ${retryAfter ? 'set' : 'missing'}` };
  return { ok: false, detail: `no 429 after ${statuses.length} POST /register: REGISTER_LIMIT is not gated (mcp/index.ts)` };
}

/** Quick POST /register calls from one IP, each with a refused redirect so nothing is stored. Run it last. */
export async function rateLimitStep(report: Report, fetcher: Fetch, endpoint: string): Promise<void> {
  const statuses: number[] = [];
  let retryAfter: string | null = null;
  const body = JSON.stringify(registrationBody('legallas-smoke-rate', 'https://evil.invalid/cb', false));
  for (let i = 0; i < RATE_LIMIT_BURST; i++) {
    const response = await fetcher(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body, redirect: 'manual', signal: timeout() });
    await response.body?.cancel();
    statuses.push(response.status);
    if (response.status === 429) {
      retryAfter = response.headers.get('Retry-After');
      break;
    }
  }
  const { ok, detail } = rateLimitOutcome(statuses, retryAfter);
  report.add('register_rate_limited', ok, detail);
}

/** The public setup page: 200 HTML that shows the one link counsel paste. */
export function connectPageOk(status: number, contentType: string | null, html: string): boolean {
  return status === 200 && /^text\/html\b/i.test(contentType ?? '') && html.includes(MCP_RESOURCE);
}

export interface PackageReply {
  status: number;
  contentType: string | null;
  disposition: string | null;
  bytes: Uint8Array;
}

/** The package download: a ZIP holding manifest.json, carrying the pasted ID, and valid when a validator is given. */
export function packageOutcome(reply: PackageReply, validate: PackageValidator | null): { ok: boolean; detail: string } {
  const type = /^application\/zip\b/i.test(reply.contentType ?? '');
  const head = `status ${reply.status}, type ${type ? 'zip' : 'unexpected'}, PK ${looksLikeZip(reply.bytes) ? 'yes' : 'no'}`;
  if (reply.status !== 200 || !type || !looksLikeZip(reply.bytes)) return { ok: false, detail: head };
  let files: Map<string, Uint8Array>;
  try {
    files = readZip(reply.bytes);
  } catch (error) {
    return { ok: false, detail: `${head}, ${error instanceof Error ? error.message : 'zip_unreadable'}` };
  }
  const decoder = new TextDecoder();
  const reference = [...files.values()].some((data) => decoder.decode(data).includes(`"${PACKAGE_REFERENCE_ID}"`));
  const problems = validate ? validate(files).length : null;
  const ok = files.has('manifest.json') && reference && (problems === null || problems === 0);
  const download = /attachment/i.test(reply.disposition ?? '') ? 'download' : 'inline';
  return { ok, detail: `${head}, ${files.size} files, ${download}, reference ${reference ? 'ok' : 'missing'}, problems ${problems ?? 'not checked'}` };
}

/** GET /connect, then the package form as the page posts it (same-origin, urlencoded). */
export async function connectSteps(report: Report, fetcher: Fetch, base: string, validate: PackageValidator | null): Promise<void> {
  const page = await fetcher(`${base}/connect`, { headers: { Accept: 'text/html' }, redirect: 'manual', signal: timeout() });
  const html = page.ok ? await page.text() : '';
  if (!page.ok) await page.body?.cancel();
  const linked = html.includes(MCP_RESOURCE);
  report.add('connect_page', connectPageOk(page.status, page.headers.get('Content-Type'), html), `status ${page.status}, link ${linked ? 'found' : 'missing'}`);
  const response = await fetcher(`${base}/connect/copilot-package`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/zip', Origin: new URL(base).origin, 'Sec-Fetch-Site': 'same-origin' },
    body: new URLSearchParams({ reference_id: PACKAGE_REFERENCE_ID }).toString(),
    redirect: 'manual',
    signal: timeout(),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const reply = { status: response.status, contentType: response.headers.get('Content-Type'), disposition: response.headers.get('Content-Disposition'), bytes };
  const { ok, detail } = packageOutcome(reply, validate);
  report.add('copilot_package_zip', ok, detail);
}

/** The real probe: two read-only counts on the local D1 (the one `npm run mcp:dev` and `dev:seed` use). */
export function localAuditProbe(d1Query: (sql: string) => Promise<Record<string, unknown>[]>): AuditProbe {
  const first = async (sql: string, column: string): Promise<number> => {
    const value = Number((await d1Query(sql))[0]?.[column]);
    if (!Number.isFinite(value)) throw new Error('audit_unreadable');
    return value;
  };
  return {
    lastId: () => first('SELECT COALESCE(MAX(id), 0) AS id FROM audit_log', 'id'),
    disconnectsAfter: (id) => first(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ai_disconnect' AND id > ${Math.trunc(id)}`, 'n'),
  };
}
