// SPDX-License-Identifier: Apache-2.0
// Connect end to end as counsel's AI, past a real sign-in (scripts/connect-e2e-kinds.ts has the kinds and checks).
//
// Run it through npm, from the room's own folder: `npm run connect:e2e -- <flags>` loads the room's settings
// (room-preload.ts), so it tests the room's host and its tool names. A bare `node scripts/connect-e2e.ts` has neither and
// tests the example host.
//
//   npm run connect:e2e -- --production --kind claude|teams|apim|harvey --authorize-only
//       registers a client of that kind (or reuses the one saved in ~/Library/Caches/legallas-connect-e2e/), makes
//       PKCE and prints the /authorize URL. Open it in Chrome as the test counsel and approve: for teams and harvey the
//       browser lands on the kind's real callback host with the code in its URL (no listener is needed).
//   pbpaste | npm run connect:e2e -- --production --kind <kind> --code -
//       reads the redirect URL (or the bare code) from stdin, never from the command line: the code holds the
//       member's email, and a command-line value lands in shell history and transcripts. It exchanges the code with
//       the kind's auth method, refreshes once, opens MCP, lists the tools, calls every tool with safe generic
//       arguments, checks the kind's profile, then revokes the grant.
//   With neither flag it does both, asking for the redirect URL in between.
//   --base http://localhost:<port> in place of --production runs against `npm run mcp:dev`.
//   --new-client registers a fresh client instead of reusing the saved one.
//
// | Kind | Return page | Testable here |
// |---|---|---|
// | teams, harvey | Keeps the code in its URL | Yes |
// | claude | claude.ai's callback sends a signed-in browser with a state it doesn't know to its settings; the code is lost | Only through the real app (a real Claude connection covers it) |
// | apim | Azure's consent redirect reads the state as a target and shows its error page; the code is lost | Only through the real app |
// An approval that is never exchanged leaves a grant this script can't revoke: disconnect it on the room's /connections.
//
// The code holds the member's email, so approving sends that email to the kind's callback host (Anthropic, Microsoft,
// Harvey). Run a kind only when its vendor may see the test member's address.
//
// For the claude kind, the get_file and view_visual tools may embed an image: each one embedded writes a
// `download` audit row and counts one of the member's daily pulls (DAILY_DOWNLOAD_CAP). Other kinds get details only.
//
// Output: one PASS/FAIL/SKIP line per step with statuses, codes and counts. Tokens and the client secret stay in
// memory and in the cache file (mode 0600 in a 0700 directory); nothing prints them. Once a code is exchanged the
// grant is always revoked, and it counts as revoked only when a refresh with its newest token answers invalid_grant
// (a revocation answers 200 even when it was ignored). A grant not confirmed revoked stays in the cache with its own
// client, and the next run revokes it before starting anything new.
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { KIND_NAMES, KINDS, kindSessionSteps, type ConnectKind } from './connect-e2e-kinds.ts';
import { MCP_ORIGIN, SCOPE_READ } from './mcp-constants.ts';
import { formatReport, Report, sameIssuer } from './mcp-flow.ts';
import { exchangeCode, refresh, revoke, type TokenClient } from './mcp-grant.ts';
import { authorizeUrl, createPkce, discover, parseJson, randomToken, register, resourceFor, type AuthServer, type Discovery, type Fetch } from './mcp-oauth.ts';
import { mcpStatus } from './mcp-wave.ts';
import { STORED_NAME } from '../worker/stored-name.ts';

export type Step = 'authorize' | 'code' | 'both';

export interface E2eArgs {
  base: string;
  kind: ConnectKind;
  /** `code` reads the redirect URL from stdin (`--code -`); `both` asks for it after printing the URL. */
  step: Step;
  newClient: boolean;
}

const USAGE = 'usage: connect-e2e (--production | --base http://localhost:<port>) --kind claude|teams|apim|harvey [--authorize-only | --code -] [--new-client]';

export function parseE2eArgs(argv: readonly string[]): E2eArgs {
  let production = false;
  let base: string | null = null;
  let kind: string | null = null;
  let authorizeOnly = false;
  let code = false;
  let newClient = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (): string => {
      const next = argv[++i];
      if (next === undefined || next.startsWith('--') || next.trim() === '') throw new Error(USAGE);
      return next;
    };
    if (arg === '--production') production = true;
    else if (arg === '--base') base = value().replace(/\/+$/, '');
    else if (arg === '--kind') kind = value();
    else if (arg === '--authorize-only') authorizeOnly = true;
    else if (arg === '--code') {
      if (argv[++i] !== '-') throw new Error('the code goes on stdin (--code -): it holds the member email, and a command-line value lands in shell history');
      code = true;
    } else if (arg === '--new-client') newClient = true;
    else throw new Error(USAGE);
  }
  if (!KIND_NAMES.includes(kind as ConnectKind)) throw new Error(USAGE);
  if (production === (base !== null)) throw new Error('give exactly one of --production and --base');
  if (authorizeOnly && code) throw new Error('--authorize-only and --code are two separate runs');
  if (base !== null) {
    const { protocol, hostname } = new URL(base);
    if (protocol !== 'http:' || (hostname !== 'localhost' && hostname !== '127.0.0.1')) throw new Error('--base is for http://localhost or http://127.0.0.1; use --production for the live server');
  }
  const step: Step = authorizeOnly ? 'authorize' : code ? 'code' : 'both';
  return { base: base ?? MCP_ORIGIN, kind: kind as ConnectKind, step, newClient };
}

/** A grant not yet confirmed revoked, with the client and resource it was issued to (--new-client may replace the saved client). */
export interface Leftover {
  client: TokenClient;
  refreshToken: string;
  resource: string;
}

/** What one kind's run keeps between the authorize and the code runs. */
export interface Saved {
  base: string;
  kind: ConnectKind;
  redirect: string;
  client: TokenClient;
  /** The authorization waiting for its code. Single use: cleared before the code is exchanged. */
  pending: { verifier: string; state: string; resource: string } | null;
  leftover: Leftover | null;
}

export const CACHE_DIR = path.join(homedir(), 'Library', 'Caches', `${STORED_NAME}-connect-e2e`);

/** One file per kind and server, so a local run never reuses a production client. */
export function cachePath(dir: string, kind: ConnectKind, base: string): string {
  return path.join(dir, `${kind}-${new URL(base).host.replace(/[^A-Za-z0-9.-]/g, '_')}.json`);
}

const isLeftover = (value: unknown): value is Leftover => {
  const v = value as Partial<Leftover> | null;
  return typeof v?.refreshToken === 'string' && typeof v.resource === 'string' && typeof v.client?.clientId === 'string';
};

/**
 * The saved state, or null when there is none or it belongs to another kind or server. Refuses a file others can
 * read, and one whose leftover grant it cannot read (a live grant must not be forgotten).
 */
export async function loadSaved(file: string, args: Pick<E2eArgs, 'base' | 'kind'>): Promise<Saved | null> {
  const info = await stat(file).catch(() => null);
  if (!info) return null;
  if ((info.mode & 0o077) !== 0) throw new Error(`the cache file is readable by others: chmod 600 ${file}, or delete it`);
  const saved = parseJson(await readFile(file, 'utf8'), 'the cache file') as Partial<Saved>;
  if (saved.base !== args.base || saved.kind !== args.kind || typeof saved.client?.clientId !== 'string') return null;
  if (saved.leftover != null && !isLeftover(saved.leftover)) throw new Error(`the cache file's leftover grant is unreadable: revoke it in the room, then delete ${file}`);
  return saved as Saved;
}

/** Writes the state with mode 0600 in a 0700 directory (chmod both: mode applies only when a path is created). */
export async function save(file: string, saved: Saved): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  await writeFile(file, JSON.stringify(saved), { mode: 0o600 });
  await chmod(file, 0o600);
}

/** Discovery as an MCP client does it, pinned to the server under test (mcp-oauth.ts discover). */
async function discoveryStep(report: Report, fetcher: Fetch, base: string): Promise<Discovery | null> {
  const found = await report.step('discovery', () => discover(fetcher, base));
  if (!found) return null;
  const ok = found.challenge.status === 401 && found.asm.s256;
  return report.add('discovery', ok, `challenge ${found.challenge.status}, S256 ${found.asm.s256 ? 'yes' : 'no'}, metadata ${found.prmServed ? 'served' : 'local fallback'}`) ? found : null;
}

/**
 * Revokes a grant by its refresh token and confirms it: the library answers 200 to a revocation it ignored (a token
 * another client owns), so only a refresh that answers invalid_grant proves the grant is gone. A refresh that still
 * works rotates the token, and the newer one is revoked and checked once more. `live` is what is still outstanding.
 */
export async function revokeConfirmed(fetcher: Fetch, discovery: Discovery, grant: Leftover): Promise<{ status: number; live: Leftover | null; detail: string }> {
  const { tokenEndpoint, revocationEndpoint } = discovery.asm;
  let current = grant;
  let status = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    status = await revoke(fetcher, revocationEndpoint ?? tokenEndpoint, current.client, current.refreshToken);
    const check = await refresh(fetcher, tokenEndpoint, current.client, current.refreshToken, current.resource);
    if (check.error === 'invalid_grant') return { status, live: null, detail: `revoke ${status}, refresh invalid_grant${attempt > 1 ? ' on the second revocation' : ''}` };
    if (!check.tokens?.refreshToken) return { status, live: current, detail: `revoke ${status}, refresh ${check.error ?? 'without a token'}: not confirmed` };
    current = { ...current, refreshToken: check.tokens.refreshToken };
  }
  return { status, live: current, detail: `revoke ${status}, the grant still refreshes after two revocations` };
}

/** Revokes a grant an earlier run left behind. False (and the grant kept in the cache) unless confirmed. */
async function leftoverStep(report: Report, fetcher: Fetch, discovery: Discovery, saved: Saved, file: string): Promise<boolean> {
  if (!saved.leftover) return true;
  const result = await revokeConfirmed(fetcher, discovery, saved.leftover);
  await save(file, { ...saved, leftover: result.live });
  return report.add('revoke_leftover', result.live === null, result.live ? `${result.detail}; kept in the cache, nothing new started` : result.detail);
}

/** The kind's client: the saved one unless asked for a new one, else a registration checked for the kind's method. */
async function clientStep(report: Report, fetcher: Fetch, discovery: Discovery, args: E2eArgs, saved: Saved | null): Promise<TokenClient | null> {
  const spec = KINDS[args.kind];
  if (!args.newClient && saved && saved.redirect === spec.redirect && saved.client.authMethod === spec.authMethod) {
    report.add('client', true, `reused, auth ${spec.authMethod}`);
    return saved.client;
  }
  const r = await register(fetcher, discovery.asm.registrationEndpoint, `legallas-smoke-${spec.kind}`, spec.redirect, spec.authMethod);
  const secretOk = spec.authMethod === 'none' ? r.client?.clientSecret === null : Boolean(r.client?.clientSecret);
  const methodOk = r.authMethod === null || r.authMethod === spec.authMethod;
  const detail = `status ${r.status}${r.error ? `, ${r.error}` : ''}, secret ${r.client?.clientSecret ? 'issued' : 'none'}, auth ${r.authMethod ?? 'not echoed'}`;
  if (!report.add('register', r.client !== null && secretOk && methodOk, detail)) return null;
  return { ...r.client!, authMethod: spec.authMethod }; // safe: checked above
}

/** Revokes any leftover grant first, registers or reuses the client, saves a fresh PKCE verifier and state, returns the URL. */
export async function authorizeStep(report: Report, fetcher: Fetch, args: E2eArgs, file: string): Promise<string | null> {
  const discovery = await discoveryStep(report, fetcher, args.base);
  if (!discovery) return null;
  const saved = await loadSaved(file, args);
  if (saved && !(await report.step('revoke_leftover', () => leftoverStep(report, fetcher, discovery, saved, file)))) return null;
  const client = await clientStep(report, fetcher, discovery, args, saved);
  if (!client) return null;
  const spec = KINDS[args.kind];
  const pkce = await createPkce();
  const state = randomToken(16);
  const resource = resourceFor(discovery.prm, args.base);
  await save(file, { base: args.base, kind: args.kind, redirect: spec.redirect, client, pending: { verifier: pkce.verifier, state, resource }, leftover: null });
  report.add('authorize_url', true, `pending saved, callback ${new URL(spec.redirect).host}`);
  return authorizeUrl(discovery.asm.authorizationEndpoint, client, spec.redirect, pkce, state, resource);
}

/**
 * The code from what was pasted: the consent redirect's URL (the kind's callback, the saved state, and RFC 9207's
 * `iss` equal to the discovered issuer when present, required when the server promises it; an `error` there is
 * reported by its code) or the bare code. The detail never quotes the input.
 */
export function readCode(input: string, redirect: string, state: string, asm: Pick<AuthServer, 'issuer' | 'issParameter'>): { code: string | null; detail: string } {
  const text = input.trim();
  if (!/^https?:\/\//i.test(text)) {
    let code: string | null = text;
    try {
      code = text.includes('%') ? decodeURIComponent(text) : text;
    } catch {
      code = null;
    }
    // A library code is `{userId}:{grantId}:{secret}`, the user id being the member's email (mcp/contract.ts userIdFor).
    return code && /^\S{8,512}$/.test(code) ? { code, detail: 'bare code, state not checked' } : { code: null, detail: 'not a code or a redirect URL' };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { code: null, detail: 'unreadable redirect URL' };
  }
  const expected = new URL(redirect);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) return { code: null, detail: "not this kind's callback" };
  const error = url.searchParams.get('error');
  if (error) return { code: null, detail: `consent answered ${/^[a-z_]{1,40}$/.test(error) ? error : 'an error'}` };
  if (url.searchParams.get('state') !== state) return { code: null, detail: 'state mismatch: not the pending authorization' };
  const iss = url.searchParams.get('iss');
  if (iss === null ? asm.issParameter : !sameIssuer(iss, asm.issuer)) return { code: null, detail: `iss ${iss === null ? 'missing' : 'mismatch'} (RFC 9207)` };
  const code = url.searchParams.get('code');
  return code ? { code, detail: `from the redirect, state ok, iss ${iss === null ? 'absent' : 'ok'}` } : { code: null, detail: 'no code in the redirect' };
}

/** The grant's newest tokens, in memory only; each step that rotates them updates this. */
interface Live {
  accessToken: string;
  refreshToken: string;
}

/** The code exchange. Any grant it creates comes back (`ok` false when it is unusable), so the caller can revoke it. */
async function exchangeStep(report: Report, fetcher: Fetch, discovery: Discovery, saved: Saved, pending: NonNullable<Saved['pending']>, code: string): Promise<{ live: Live; ok: boolean } | null> {
  const spec = KINDS[saved.kind];
  const token = await exchangeCode(fetcher, discovery.asm.tokenEndpoint, saved.client, code, saved.redirect, pending.verifier, pending.resource);
  const t = token.tokens;
  const ok = t !== null && t.tokenType.toLowerCase() === 'bearer' && t.refreshToken !== null && (t.scope === null || t.scope.split(' ').includes(SCOPE_READ));
  report.add('token_exchange', ok, `status ${token.status}${token.error ? `, ${token.error}` : ''}, auth ${spec.authMethod}, refresh ${t?.refreshToken ? 'yes' : 'no'}`);
  return t?.refreshToken ? { live: { accessToken: t.accessToken, refreshToken: t.refreshToken }, ok } : null;
}

/** One refresh with the kind's auth method (Teams: Basic). `live` takes the new tokens before the cache does. */
async function refreshStep(report: Report, fetcher: Fetch, discovery: Discovery, saved: Saved, resource: string, live: Live, file: string): Promise<void> {
  const next = await refresh(fetcher, discovery.asm.tokenEndpoint, saved.client, live.refreshToken, resource);
  const rotated = next.tokens?.refreshToken ?? null;
  report.add('token_refresh', rotated !== null, `status ${next.status}${next.error ? `, ${next.error}` : ''}, auth ${KINDS[saved.kind].authMethod}`);
  if (!next.tokens || !rotated) return;
  Object.assign(live, { accessToken: next.tokens.accessToken, refreshToken: rotated });
  await save(file, { ...saved, leftover: { client: saved.client, refreshToken: rotated, resource } });
}

/** Revokes with the newest refresh token, keeps the grant in the cache unless confirmed, then checks the access token. */
async function finalRevokeSteps(report: Report, fetcher: Fetch, discovery: Discovery, saved: Saved, resource: string, live: Live, endpoint: string, file: string): Promise<void> {
  const result = await revokeConfirmed(fetcher, discovery, { client: saved.client, refreshToken: live.refreshToken, resource });
  await save(file, { ...saved, leftover: result.live });
  report.add('revoke_grant', result.status === 200, `status ${result.status}`);
  report.add('revoked_refresh_refused', result.live === null, result.live ? `${result.detail}; kept in the cache for the next run` : result.detail);
  const after = await mcpStatus(fetcher, endpoint, live.accessToken);
  report.add('revoked_access_refused', after === 401, `status ${after}`);
}

/** Exchanges the pasted code; once a grant exists, runs the refresh and every tool, and always revokes it last. */
export async function codeStep(report: Report, fetcher: Fetch, args: E2eArgs, file: string, input: string): Promise<void> {
  const saved = await loadSaved(file, args);
  if (!saved?.pending) return void report.add('pending_authorization', false, 'none: run --authorize-only first');
  report.add('pending_authorization', true, 'found');
  const discovery = await discoveryStep(report, fetcher, args.base);
  if (!discovery) return;
  const { pending } = saved;
  const read = readCode(input, saved.redirect, pending.state, discovery.asm);
  if (!report.add('code', read.code !== null, read.detail) || read.code === null) return;
  const settled: Saved = { ...saved, pending: null }; // a code is single use, whatever happens next
  await save(file, settled);
  const exchanged = await report.step('token_exchange', () => exchangeStep(report, fetcher, discovery, settled, pending, read.code!)); // safe: checked above
  if (!exchanged) return;
  const { live } = exchanged;
  const endpoint = `${args.base}/mcp`;
  try {
    await save(file, { ...settled, leftover: { client: settled.client, refreshToken: live.refreshToken, resource: pending.resource } });
    if (!exchanged.ok) return;
    await report.step('token_refresh', () => refreshStep(report, fetcher, discovery, settled, pending.resource, live, file));
    await report.step('mcp', () => kindSessionSteps(report, fetcher, endpoint, live.accessToken, KINDS[args.kind]));
  } finally {
    await report.step('revoke', () => finalRevokeSteps(report, fetcher, discovery, settled, pending.resource, live, endpoint, file));
  }
}

/**
 * One line from `input`; rejects when it closes first, so an empty pipe fails instead of passing with no report.
 * It waits on the 'line' event, which readline emits before 'close' (a promise-based question() would resolve a
 * microtask after a piped input's 'close' and lose the race).
 */
export async function ask(question: string, input: NodeJS.ReadableStream = process.stdin): Promise<string> {
  if (question) process.stdout.write(question);
  const lines = createInterface({ input, terminal: false });
  try {
    return await new Promise<string>((resolve, reject) => {
      lines.once('line', resolve);
      lines.once('close', () => reject(new Error('stdin closed before a line: pipe in the redirect URL')));
    });
  } finally {
    lines.close();
  }
}

async function main(): Promise<void> {
  process.exitCode = 1; // until a finished report says otherwise
  const args = parseE2eArgs(process.argv.slice(2));
  const file = cachePath(CACHE_DIR, args.kind, args.base);
  console.log(`legallas-mcp connect end to end, ${args.kind} (${args.base})\n`);
  if (args.step !== 'code') {
    const report = new Report();
    const url = await authorizeStep(report, fetch, args, file);
    console.log(formatReport(report));
    if (!url || !report.ok()) return;
    console.log(`\nOpen this in Chrome as the test counsel and approve; the page it lands on holds the code:\n${url}\n`);
    if (args.step === 'authorize') return void (process.exitCode = 0);
  }
  const input = await ask(args.step === 'code' ? '' : 'Paste the redirect URL (or the code): ');
  const report = new Report();
  await codeStep(report, fetch, args, file, input);
  console.log(`\n${formatReport(report)}`);
  process.exitCode = report.ok() ? 0 : 1;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
