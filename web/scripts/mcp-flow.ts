// SPDX-License-Identifier: Apache-2.0
// The legallas-mcp client flow as named checks, shared by scripts/mcp-smoke.ts (every step) and
// scripts/mcp-eval.ts (just the grant). Each step records PASS, FAIL or SKIP with a detail made of statuses,
// codes and lengths. Tokens, client secrets and tool text never reach a detail.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LAW_TOOL_NAME, MCP_RESOURCE, SCOPE_READ, TOOL_NAMES } from './mcp-constants.ts';
import { approveConsent, exchangeCode, openConsent, refresh, revoke, type TokenClient } from './mcp-grant.ts';
import { authorizeUrl, createPkce, discover, onBase, randomToken, register, resourceFor, type AuthServer, type Client, type Discovery, type Fetch } from './mcp-oauth.ts';

export type Outcome = 'pass' | 'fail' | 'skip';

export interface Check {
  name: string;
  outcome: Outcome;
  detail: string;
}

/** An ordered list of checks. `ok()` is false once any check failed. */
export class Report {
  readonly checks: Check[] = [];

  add(name: string, ok: boolean | null, detail: string): boolean {
    this.checks.push({ name, outcome: ok === null ? 'skip' : ok ? 'pass' : 'fail', detail });
    return ok !== false;
  }

  ok(): boolean {
    return this.checks.every((check) => check.outcome !== 'fail');
  }

  /** Runs a step; a thrown error becomes a FAIL carrying only the error's own message (ours never hold secrets). */
  async step<T>(name: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      this.add(name, false, error instanceof Error ? `error ${error.message}`.slice(0, 120) : 'error');
      return null;
    }
  }
}

const DEV_VARS = path.resolve(import.meta.dirname, '..', '.dev.vars');

/** A value from the environment, else from web/.dev.vars (KEY=VALUE lines, optional quotes). Null when unset. */
export async function devVar(name: string, env: NodeJS.ProcessEnv = process.env, file = DEV_VARS): Promise<string | null> {
  if (env[name]) return env[name]!;
  const text = await readFile(file, 'utf8').catch(() => '');
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[1] === name) return match[2]!.replace(/^(['"])(.*)\1$/, '$2') || null;
  }
  return null;
}

/** Local options from the dev setup: MCP_DEV_ORIGIN means the server serves RFC 9728 metadata locally. */
export async function localOptions(): Promise<LocalOptions> {
  return { expectProtectedResource: (await devVar('MCP_DEV_ORIGIN')) !== null };
}

/** The PASS/FAIL table. */
export function formatReport(report: Report): string {
  const width = Math.max(...report.checks.map((c) => c.name.length), 4);
  const lines = report.checks.map((c) => `${c.outcome.toUpperCase().padEnd(5)} ${c.name.padEnd(width)}  ${c.detail}`);
  const count = (o: Outcome) => report.checks.filter((c) => c.outcome === o).length;
  return [...lines, '', `${count('pass')} pass, ${count('fail')} fail, ${count('skip')} skip.`].join('\n');
}

/**
 * The contract tools (TOOL_NAMES), each once, plus the law library's search when the server lists it (LAW_LIBRARY "1"
 * in wrangler.mcp.jsonc, mcp/server.ts). Any other name, or a missing one, fails.
 */
export function toolNamesOk(names: readonly string[]): boolean {
  const expected: readonly string[] = names.includes(LAW_TOOL_NAME) ? [...TOOL_NAMES, LAW_TOOL_NAME] : TOOL_NAMES;
  return names.length === expected.length && expected.every((n) => names.includes(n));
}

/** What a finished local grant hands to the MCP steps. */
export interface Grant {
  discovery: Discovery;
  /** With its auth method when it registered one other than the old default (Teams: client_secret_basic). */
  client: TokenClient;
  resource: string;
  accessToken: string;
  refreshToken: string | null;
  /** The client's registered redirect, so a second authorization (scripts/mcp-wave.ts) can reuse the client. */
  redirectUri: string;
}

/** Discovery checks: the 401 challenge, RFC 9728 and RFC 8414. */
/** How a local run treats a server that serves no RFC 9728 document. */
export interface LocalOptions {
  /**
   * True when the server is set up to serve it locally (MCP_DEV_ORIGIN in .dev.vars): a missing document is
   * then a FAIL. Without it the OAuth library cannot serve it on localhost, so it is a SKIP.
   */
  expectProtectedResource?: boolean;
}

export async function discoverySteps(report: Report, fetcher: Fetch, base: string, options: LocalOptions = {}): Promise<Discovery | null> {
  const found = await report.step('discovery', () => discover(fetcher, base));
  if (!found) return null;
  const { challenge, prm, prmServed, asm } = found;
  // Without an RFC 9728 document there is nothing for resource_metadata to name, so only the 401 is checked.
  const challengeOk = challenge.status === 401 && (challenge.resourceMetadata !== null || !prmServed);
  report.add('challenge_401', challengeOk, `status ${challenge.status}, resource_metadata ${challenge.resourceMetadata ? 'set' : 'missing'}`);
  if (prmServed) {
    const resourceOk = prm.resource === MCP_RESOURCE || prm.resource === `${base}/mcp`;
    report.add('protected_resource', resourceOk && (prm.scopes.length === 0 || prm.scopes.includes(SCOPE_READ)), `resource ${resourceOk ? 'ok' : 'unexpected'}, scopes ${prm.scopes.length}`);
  } else if (options.expectProtectedResource) {
    report.add('protected_resource', false, 'not served although MCP_DEV_ORIGIN is set (check it matches the base URL)');
    return null;
  } else {
    report.add('protected_resource', null, 'not served on localhost without MCP_DEV_ORIGIN in .dev.vars; --production checks it');
  }
  // RFC 8414 section 3.3: the issuer must be the authorization server the resource named. MCP clients must also
  // refuse a server without S256 PKCE, so the flow stops here on either.
  const issuerOk = sameIssuer(pinned(asm.issuer, base), pinned(prm.authorizationServers[0]!, base));
  const asmDetail = `issuer ${issuerOk ? 'ok' : 'mismatch'}, S256 ${asm.s256 ? 'yes' : 'no'}, iss ${asm.issParameter ? 'promised' : 'not promised'}, revocation ${asm.revocationEndpoint ? 'yes' : 'no'}`;
  if (!report.add('authorization_server', issuerOk && asm.s256, asmDetail)) return null;
  return found;
}

/** An issuer as the client reaches it (onBase), or the raw value when it is off the server under test. */
function pinned(issuer: string, base: string): string {
  try {
    return onBase(issuer, base);
  } catch {
    return issuer;
  }
}

/** Issuer identifiers compare as strings; only a trailing slash is ignored. */
export function sameIssuer(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

/** A loopback redirect like Claude Code's: any port, no listener needed (the code is read from Location). */
export function loopbackRedirect(port = 49152 + Math.floor(Math.random() * 16000)): string {
  return `http://127.0.0.1:${port}/cb`;
}

/** Registers a public and a confidential client and checks a non-allowlisted redirect is refused. */
export async function registrationSteps(report: Report, fetcher: Fetch, asm: AuthServer, redirectUri: string, refusedRedirect: string): Promise<Client | null> {
  const name = `legallas-smoke-${randomToken(4)}`;
  const pub = await register(fetcher, asm.registrationEndpoint, name, redirectUri, false);
  report.add('register_public', pub.client !== null && pub.client.clientSecret === null, `status ${pub.status}${pub.error ? `, ${pub.error}` : ''}, secret ${pub.client?.clientSecret ? 'issued' : 'none'}`);
  const conf = await register(fetcher, asm.registrationEndpoint, `${name}-conf`, redirectUri, true);
  report.add('register_confidential', conf.client?.clientSecret != null, `status ${conf.status}${conf.error ? `, ${conf.error}` : ''}, secret ${conf.client?.clientSecret ? 'issued' : 'none'}`);
  const bad = await register(fetcher, asm.registrationEndpoint, `${name}-bad`, refusedRedirect, false);
  report.add('register_refused_redirect', bad.client === null && bad.status >= 400 && bad.status < 500, `status ${bad.status}${bad.error ? `, ${bad.error}` : ''}`);
  return pub.client;
}

/** Consent through the dev identity: GET /authorize, POST the approval, exchange the code. `prefix` names a kind's checks. */
export async function consentSteps(report: Report, fetcher: Fetch, base: string, discovery: Discovery, client: TokenClient, redirectUri: string, prefix = ''): Promise<Grant | null> {
  const { asm, prm } = discovery;
  const pkce = await createPkce();
  const state = randomToken(16);
  const resource = resourceFor(prm, base);
  const page = await openConsent(fetcher, authorizeUrl(asm.authorizationEndpoint, client, redirectUri, pkce, state, resource));
  const fields = page.form ? Object.keys(page.form.fields).length : 0;
  if (!report.add(`${prefix}authorize_consent_page`, page.status === 200 && page.form !== null, `status ${page.status}, form ${page.form ? 'found' : 'missing'}, fields ${fields}, cookies ${page.cookies.length}`)) return null;
  const approval = await approveConsent(fetcher, page.form!, page.cookies, base); // safe: checked above
  // RFC 9207: `iss` must match the issuer, and must be present when the metadata promises it.
  const issOk = approval.iss === null ? !asm.issParameter : approval.iss === asm.issuer;
  const approved = approval.status >= 300 && approval.status < 400 && approval.code !== null && approval.state === state && issOk;
  const approvalDetail = `status ${approval.status}, code ${approval.code ? 'yes' : 'no'}, state ${approval.state === state ? 'ok' : 'mismatch'}, iss ${approval.iss === null ? (issOk ? 'absent' : 'missing') : issOk ? 'ok' : 'mismatch'}${approval.error ? `, ${approval.error}` : ''}`;
  if (!report.add(`${prefix}approve_consent`, approved, approvalDetail)) return null;
  const token = await exchangeCode(fetcher, asm.tokenEndpoint, client, approval.code!, redirectUri, pkce.verifier, resource); // safe: approved
  const t = token.tokens;
  const tokenOk = t !== null && t.tokenType.toLowerCase() === 'bearer' && t.refreshToken !== null && (t.scope === null || t.scope.split(' ').includes(SCOPE_READ));
  const tokenDetail = `status ${token.status}${token.error ? `, ${token.error}` : ''}, expires_in ${t?.expiresIn ?? '-'}, refresh ${t?.refreshToken ? 'yes' : 'no'}`;
  if (!report.add(`${prefix}token_exchange`, tokenOk, tokenDetail)) return null;
  return { discovery, client, resource, accessToken: t!.accessToken, refreshToken: t!.refreshToken, redirectUri }; // safe: tokenOk
}

/** The full local grant, recorded as checks. Null when any step failed. */
export async function localGrant(report: Report, fetcher: Fetch, base: string, options: LocalOptions = {}): Promise<Grant | null> {
  const discovery = await discoverySteps(report, fetcher, base, options);
  if (!discovery) return null;
  const redirectUri = loopbackRedirect();
  const client = await report.step('register', () => registrationSteps(report, fetcher, discovery.asm, redirectUri, 'https://evil.invalid/cb'));
  if (!client) return null;
  return report.step('consent', () => consentSteps(report, fetcher, base, discovery, client, redirectUri));
}

/**
 * Refresh rotation: the old refresh token works until the new one is used, then fails with invalid_grant;
 * a token for another resource is refused (invalid_target) without rotating. Returns the grant on its newest
 * tokens, or null when rotation failed.
 */
export async function refreshSteps(report: Report, fetcher: Fetch, grant: Grant): Promise<Grant | null> {
  const endpoint = grant.discovery.asm.tokenEndpoint;
  const first = grant.refreshToken!; // safe: token_exchange required a refresh token
  const r1 = await refresh(fetcher, endpoint, grant.client, first, grant.resource);
  const rotated = r1.tokens?.refreshToken ?? null;
  if (!report.add('refresh_rotates', rotated !== null && rotated !== first, `status ${r1.status}${r1.error ? `, ${r1.error}` : ''}, new refresh ${rotated && rotated !== first ? 'yes' : 'no'}`)) return null;
  const r2 = await refresh(fetcher, endpoint, grant.client, rotated!, grant.resource); // safe: checked above
  if (!report.add('refresh_rotated_works', r2.tokens?.refreshToken != null, `status ${r2.status}${r2.error ? `, ${r2.error}` : ''}`)) return null;
  const reused = await refresh(fetcher, endpoint, grant.client, first, grant.resource);
  report.add('refresh_reuse_refused', reused.error === 'invalid_grant', `status ${reused.status}, ${reused.error ?? 'accepted'}`);
  const latest = r2.tokens!; // safe: checked above
  const wrong = await refresh(fetcher, endpoint, grant.client, latest.refreshToken!, 'https://wrong.example/mcp'); // safe: checked above
  report.add('wrong_resource_refused', wrong.error === 'invalid_target', `status ${wrong.status}, ${wrong.error ?? 'accepted'}`);
  return { ...grant, accessToken: latest.accessToken, refreshToken: latest.refreshToken };
}

/** Revokes the grant (RFC 7009) and checks that neither its access nor its refresh token works afterwards. */
export async function revokeSteps(report: Report, fetcher: Fetch, grant: Grant, mcpStatus: (token: string) => Promise<number>, prefix = ''): Promise<void> {
  const endpoint = grant.discovery.asm.revocationEndpoint ?? grant.discovery.asm.tokenEndpoint;
  const status = await revoke(fetcher, endpoint, grant.client, grant.refreshToken!); // safe: refreshSteps kept one
  report.add(`${prefix}revoke_grant`, status === 200, `status ${status}`);
  const after = await mcpStatus(grant.accessToken);
  report.add(`${prefix}revoked_access_refused`, after === 401, `status ${after}`);
  const again = await refresh(fetcher, grant.discovery.asm.tokenEndpoint, grant.client, grant.refreshToken!, grant.resource); // safe: as above
  report.add(`${prefix}revoked_refresh_refused`, again.error === 'invalid_grant', `status ${again.status}, ${again.error ?? 'accepted'}`);
}
