// SPDX-License-Identifier: Apache-2.0
// End-to-end smoke for legallas-mcp with no browser (README.md, "The MCP server").
//
//   npm run mcp:smoke                      # --local: the full flow against `npm run mcp:dev` (localhost:8790)
//   npm run mcp:smoke -- --base http://localhost:8791
//   npm run mcp:smoke -- --production      # public parts on mcp.room.example.com, plus three registrations
//   npm run mcp:smoke -- --production --register   # also registers a public client with Claude's redirect
//   npm run mcp:smoke -- --production --read-only  # writes nothing (no registrations)
//
// Local mode needs ALLOW_DEV_IDENTITY=1 in .dev.vars and the dev identity in the local `members` table
// (`npm run dev:seed`): discovery (the 401's resource_metadata, RFC 9728, RFC 8414 with S256 and client ID
// metadata documents), registration (public, confidential, a refused redirect), PKCE consent,
// code exchange, refresh rotation, a wrong-resource refusal, MCP over both protocol revisions, the prompts listed and
// fetched (production cannot: no grant), a call to each
// contract tool (a stub's not_available fails), a page sweep of one multi-part document (SKIP when local dev has none), then revocation. The counsel AI
// connect checks (scripts/mcp-wave.ts) add Microsoft's and Harvey's registrations, an unlisted Origin, the
// revocation's ai_disconnect row in local D1, an authorization without `resource`, one full grant per counsel AI
// kind (Claude, Teams with Basic auth, Copilot Studio, Harvey: scripts/connect-e2e-kinds.ts, each answered with
// its profile) and OpenCode for an open-weight model, on loopback, the /connect page and its Copilot package, and last the /register rate limit. Consent cannot be automated in production, so production
// mode checks discovery (client ID metadata documents too), the 401 challenge, the refused redirect, the Microsoft and Harvey registrations (real
// client records named SMOKE_CLIENT_NAME, which legallas-mcp's daily sweep deletes a day later, mcp/smoke-clients.ts; the
// library has no RFC 7592 endpoint to delete them from here; --read-only skips them) and /connect.
//
// The table shows statuses, codes and lengths. Tokens, secrets and tool text are never printed.
import { DESKTOP_KINDS, KIND_NAMES, KINDS, localKindSteps } from './connect-e2e-kinds.ts';
import { MCP_ORIGIN, MCP_RESOURCE, READ_ONLY_ANNOTATIONS, SMOKE_CLIENT_NAME } from './mcp-constants.ts';
import { firstId, LEGACY_VERSION, McpSession, MODERN_VERSION, resultValue, summarizeTool, toolCallOk } from './mcp-client.ts';
import { devVar, formatReport, localGrant, localOptions, refreshSteps, Report, revokeSteps, toolNamesOk, type Grant, type LocalOptions } from './mcp-flow.ts';
import { loadModule } from './load-module.ts';
import { localPartReader, sweepStep, type PartReader } from './mcp-sweep.ts';
import { authServerMetadataUrl, parseAuthServer, parseProtectedResource, probeChallenge, pinAuthServer, onBase, protectedResourceMetadataUrl, register, timeout, type AuthServer, type Fetch } from './mcp-oauth.ts';
import {
  auditBaseline,
  auditStep,
  CLAUDE_REDIRECT,
  clientRegistrationSteps,
  connectSteps,
  localAuditProbe,
  mcpStatus,
  noResourceStep,
  originStep,
  rateLimitStep,
  type AuditProbe,
  type PackageValidator,
  type WaveClients,
} from './mcp-wave.ts';
import { cliWrangler } from './wrangler.ts';

export { CLAUDE_REDIRECT, mcpStatus, toolNamesOk };

export const LOCAL_BASE = 'http://localhost:8790';
export const REFUSED_REDIRECT = 'https://evil.invalid/cb';

export interface SmokeArgs {
  mode: 'local' | 'production';
  base: string;
  /** Production only: also register a public client with Claude's redirect (deleted a day later, like the others). */
  register: boolean;
  /** Production only: register nothing (the refused redirect and the /connect checks still run). */
  readOnly: boolean;
}

const USAGE = 'usage: mcp:smoke [--local [--base http://localhost:<port>] | --production [--register | --read-only]]';

export function parseSmokeArgs(argv: readonly string[]): SmokeArgs {
  const args: SmokeArgs = { mode: 'local', base: LOCAL_BASE, register: false, readOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--local') args.mode = 'local';
    else if (arg === '--production') args.mode = 'production';
    else if (arg === '--register') args.register = true;
    else if (arg === '--read-only') args.readOnly = true;
    else if (arg === '--base' && argv[i + 1]) args.base = argv[++i]!.replace(/\/+$/, '');
    else throw new Error(USAGE);
  }
  if (args.register && args.readOnly) throw new Error('--register and --read-only contradict each other');
  if (args.mode === 'production') return { mode: 'production', base: MCP_ORIGIN, register: args.register, readOnly: args.readOnly };
  if (args.register || args.readOnly) throw new Error('--register and --read-only are for --production (local runs always register)');
  const { protocol, hostname } = new URL(args.base);
  if (protocol !== 'http:' || (hostname !== 'localhost' && hostname !== '127.0.0.1')) throw new Error('--local runs against http://localhost or http://127.0.0.1 only');
  return args;
}

/** Harmless arguments for each tool; the document probes use an id from list or search when one came back. */
export function probeArgs(name: string, docId: string | null): Record<string, unknown> {
  const id = docId && /^[A-Za-z0-9_-]{1,64}$/.test(docId) ? docId : 'smoke-missing-id';
  switch (name) {
    case 'legallas_search':
      return { query: 'agreement', limit: 3 };
    case 'legallas_get_document':
    case 'legallas_get_comments':
    case 'legallas_get_file':
      return { id };
    case 'legallas_read_pages':
      return { id, from: 1, to: 1 };
    default:
      return {};
  }
}

/** JSON-RPC errors that mean "this server does not speak 2026-07-28": method not found, unsupported version. */
const NOT_OFFERED: ReadonlySet<string> = new Set(['rpc_-32601', 'rpc_-32022']);

/**
 * The 2026-07-28 check: PASS when agreed, SKIP only when the server says it does not offer the revision (an
 * error in NOT_OFFERED, or a discover reply that does not list it), FAIL on anything else (a 500, a 401, no
 * reply), which would hide a broken server behind a skip.
 */
export function discoverOutcome(reply: { result: Record<string, unknown> | null; error: string | null; agreed: string | null }): boolean | null {
  if (reply.agreed === MODERN_VERSION) return true;
  if (reply.error !== null) return NOT_OFFERED.has(reply.error) ? null : false;
  return Array.isArray(reply.result?.supportedVersions) ? null : false;
}

/** Opens both protocol revisions and returns the session to use for calls (2026-07-28 when agreed). */
async function openSteps(report: Report, fetcher: Fetch, endpoint: string, token: string): Promise<McpSession | null> {
  const legacy = new McpSession(fetcher, endpoint, token, LEGACY_VERSION);
  const init = await legacy.open();
  const legacyOk = report.add('mcp_initialize_2025', init.agreed === LEGACY_VERSION, `status ${init.status}, ${init.error ?? `agreed ${init.agreed}`}`);
  const modern = new McpSession(fetcher, endpoint, token, MODERN_VERSION);
  const discover = await modern.open();
  report.add('mcp_discover_2026', discoverOutcome(discover), `status ${discover.status}, ${discover.error ?? `agreed ${discover.agreed ?? 'none'}`}`);
  if (discover.agreed === MODERN_VERSION) return modern;
  return legacyOk ? legacy : null;
}

/** tools/list must show the contract tools (toolNamesOk), each with the read-only annotations. */
async function listStep(report: Report, session: McpSession): Promise<void> {
  const reply = await session.listTools();
  const tools = (reply.result?.tools as { name?: unknown; annotations?: Record<string, unknown> }[] | undefined) ?? [];
  const names = tools.map((t) => String(t.name));
  const sameNames = toolNamesOk(names);
  const readOnly = tools.every((t) => Object.entries(READ_ONLY_ANNOTATIONS).every(([key, value]) => t.annotations?.[key] === value));
  report.add('mcp_tools_list', sameNames && readOnly, `status ${reply.status}, ${reply.error ?? `${tools.length} tools, read-only ${readOnly ? 'yes' : 'no'}`}`);
}

/**
 * The prompts mcp/prompts.ts registers, in its order, with the arguments each requires (mirrored here like
 * mcp-constants.ts; scripts/mcp-smoke.test.ts loads mcp/prompts.ts and fails if they drift).
 */
export const PROMPT_ARGS: Readonly<Record<string, readonly string[]>> = {
  matter_briefing: [],
  violation_proof: ['violation'],
  topic_chronology: ['topic'],
  matter_board: [],
  review_grid: [],
  cite_check: [],
  matter_chronology: [],
  entity_matrix: [],
  deviation_board: [],
};
/** Harmless prompts/get arguments: nothing from the case, nothing that must exist in the room. */
const PROMPT_PROBE_ARGS: Readonly<Record<string, Record<string, string>>> = { violation_proof: { violation: 'A' }, topic_chronology: { topic: 'smoke' } };

type ListedPrompt = { name?: unknown; arguments?: { name?: unknown; required?: unknown }[] };

/** True when prompts/list shows exactly PROMPT_ARGS, in order, each with its required arguments and no others. */
export function promptsListOk(prompts: readonly ListedPrompt[]): boolean {
  const expected = Object.entries(PROMPT_ARGS);
  return (
    prompts.length === expected.length &&
    expected.every(([name, args], i) => {
      const listed = prompts[i]?.arguments ?? [];
      return prompts[i]?.name === name && listed.length === args.length && args.every((arg, j) => listed[j]?.name === arg && listed[j]?.required === true);
    })
  );
}

/** prompts/list (promptsListOk), then prompts/get of each: a message comes back. Prompt text is never printed. */
async function promptSteps(report: Report, session: McpSession): Promise<void> {
  const reply = await session.request('prompts/list');
  const prompts = (reply.result?.prompts as ListedPrompt[] | undefined) ?? [];
  report.add('mcp_prompts_list', promptsListOk(prompts), `status ${reply.status}, ${reply.error ?? `${prompts.length} prompts`}`);
  const names = Object.keys(PROMPT_ARGS);
  let answered = 0;
  for (const name of names) {
    const got = await session.request('prompts/get', { name, arguments: PROMPT_PROBE_ARGS[name] ?? {} });
    if (Array.isArray(got.result?.messages) && got.result.messages.length > 0) answered++;
  }
  report.add('mcp_prompts_get', answered === names.length, `${answered} of ${names.length} answered`);
}

/** Every contract tool, list and search first so the document probes can use a real id; the visual call lists the binder. */
export const CALL_ORDER: readonly string[] = [
  'legallas_list_documents',
  'legallas_search',
  'legallas_case_overview',
  'legallas_get_document',
  'legallas_read_pages',
  'legallas_view_visual',
  'legallas_get_comments',
  'legallas_get_file',
  'legallas_template',
];
/** What contract v2's registered stubs answer (mcp/tools/*.ts): a tool still answering it has not shipped. */
const STUB_CODE = 'not_available';

/** Calls every tool once (CALL_ORDER). */
async function callSteps(report: Report, session: McpSession): Promise<void> {
  let docId: string | null = null;
  for (const name of CALL_ORDER) {
    const reply = await session.callTool(name, probeArgs(name, docId));
    const summary = summarizeTool(reply.result);
    if (!docId && !summary.isError) docId = firstId(resultValue(reply.result));
    const ok = reply.result !== null && toolCallOk(summary) && summary.code !== STUB_CODE;
    const detail = reply.result === null ? `status ${reply.status}, ${reply.error}` : summary.isError ? `code ${summary.code}` : `ok, text ${summary.textLength} chars, structured ${summary.structured ? 'yes' : 'no'}`;
    report.add(`call_${name}`, ok, detail);
  }
}

/** What the local run needs beyond LocalOptions: the flag, the D1 probe and the package validator. */
export interface WaveOptions {
  /** MCP_ORIGIN_ENFORCE as the local server has it (.dev.vars over wrangler.mcp.jsonc's "0"). */
  originEnforce?: string | null;
  /** Reads local D1 for the ai_disconnect row; absent, that check skips. */
  audit?: AuditProbe | null;
  /** connect/copilot/validate.ts; absent, the package is checked as a ZIP holding the pasted ID only. */
  validatePackage?: PackageValidator | null;
}

/**
 * Client ID Metadata Documents, the way Claude identifies itself (mcp/oauth.ts). The OAuth library advertises
 * them only while the global_fetch_strictly_public flag is on (wrangler.mcp.jsonc), so a dropped flag fails here
 * before Claude's sign-in does. The detail never echoes the server's value.
 */
export function cimdStep(report: Report, metadata: unknown): boolean {
  const value = metadata !== null && typeof metadata === 'object' ? (metadata as Record<string, unknown>).client_id_metadata_document_supported : undefined;
  return report.add('client_id_metadata_documents', value === true, `client_id_metadata_document_supported ${value === true ? 'true' : value === undefined ? 'missing' : 'not true'}`);
}

/** The full local flow. With `parts` (the local index), also the multi-part page sweep (scripts/mcp-sweep.ts). */
export async function runLocal(fetcher: Fetch, base: string, parts?: PartReader, options: LocalOptions & WaveOptions = {}): Promise<Report> {
  const report = new Report();
  const granted = await localGrant(report, fetcher, base, options);
  if (!granted) return report;
  // The same RFC 8414 document discovery read, fetched again for the one field AuthServer does not parse.
  const asmUrl = onBase(authServerMetadataUrl(granted.discovery.prm.authorizationServers[0]!), base); // safe: discovery requires one
  await report.step('client_id_metadata_documents', async () => cimdStep(report, (await getJson(fetcher, asmUrl)).body));
  const registration = granted.discovery.asm.registrationEndpoint;
  const clients = await report.step('register_wave', () => clientRegistrationSteps(report, fetcher, registration, `legallas-smoke-${granted.client.clientId.slice(0, 6)}`));
  const grant = await report.step('refresh', () => refreshSteps(report, fetcher, granted));
  if (!grant) return report;
  const endpoint = `${base}/mcp`;
  const session = await report.step('mcp_open', () => openSteps(report, fetcher, endpoint, grant.accessToken));
  if (session) {
    await report.step('mcp_tools_list', () => listStep(report, session));
    await report.step('mcp_prompts', () => promptSteps(report, session));
    await report.step('mcp_origin_unlisted', () => originStep(report, fetcher, endpoint, grant.accessToken, options.originEnforce ?? null));
    await report.step('mcp_calls', () => callSteps(report, session));
    if (parts) await report.step('read_pages_sweep', () => sweepStep(report, session, parts));
  }
  const audit = options.audit ?? null;
  const before = await auditBaseline(audit);
  await report.step('revoke', () => revokeSteps(report, fetcher, grant, (token) => mcpStatus(fetcher, endpoint, token)));
  await report.step('revoke_audit_disconnect', () => auditStep(report, audit, before));
  await report.step('no_resource_token', () => noResourceStep(report, fetcher, base, grant));
  await report.step('kinds', () => kindSteps(report, fetcher, base, grant, clients));
  await report.step('connect', () => connectSteps(report, fetcher, base, options.validatePackage ?? null));
  await report.step('register_rate_limited', () => rateLimitStep(report, fetcher, registration));
  return report;
}

/**
 * One full grant per counsel AI kind (connect-e2e-kinds.ts KINDS), then OpenCode (DESKTOP_KINDS), each answered with
 * its profile. Teams, Copilot Studio and Harvey reuse the register_wave clients, and Claude and OpenCode add one each,
 * so the run stays under REGISTER_LIMIT's 10 a minute before the rate-limit check. The real callback hosts need no listener: consent's Location holds the code.
 */
async function kindSteps(report: Report, fetcher: Fetch, base: string, grant: Grant, wave: WaveClients | null): Promise<void> {
  const claude = await register(fetcher, grant.discovery.asm.registrationEndpoint, 'legallas-smoke-claude', CLAUDE_REDIRECT, 'none');
  report.add('register_claude_public', claude.client !== null && claude.client.clientSecret === null, `status ${claude.status}${claude.error ? `, ${claude.error}` : ''}`);
  const clients = { claude: claude.client ? { ...claude.client, authMethod: 'none' as const } : null, teams: wave?.teams ?? null, apim: wave?.apim ?? null, harvey: wave?.harvey ?? null };
  for (const kind of KIND_NAMES) await report.step(`${kind}_grant`, () => localKindSteps(report, fetcher, base, grant.discovery, KINDS[kind], clients[kind]));
  // An open-weight model through OpenCode: its own public registration on loopback, which local dev allows.
  const opencode = DESKTOP_KINDS.opencode;
  const desktop = await register(fetcher, grant.discovery.asm.registrationEndpoint, 'legallas-smoke-opencode', opencode.redirect, 'none');
  report.add('register_opencode_public', desktop.client !== null && desktop.client.clientSecret === null, `status ${desktop.status}${desktop.error ? `, ${desktop.error}` : ''}`);
  const client = desktop.client ? { ...desktop.client, authMethod: 'none' as const } : null;
  await report.step('opencode_grant', () => localKindSteps(report, fetcher, base, grant.discovery, opencode, client));
}

async function getJson(fetcher: Fetch, url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetcher(url, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: timeout() });
  return { status: response.status, body: await response.json().catch(() => null) };
}

export interface ProductionOptions {
  register?: boolean;
  readOnly?: boolean;
  validatePackage?: PackageValidator | null;
}

/** Production: the public parts only. Every URL is pinned to MCP_ORIGIN; nothing is sent anywhere else. */
export async function runProduction(fetcher: Fetch, options: ProductionOptions = {}): Promise<Report> {
  const report = new Report();
  const prmUrl = protectedResourceMetadataUrl(MCP_RESOURCE);
  const prm = await report.step('protected_resource', async () => {
    const { status, body } = await getJson(fetcher, prmUrl);
    const doc = parseProtectedResource(body);
    report.add('protected_resource', status === 200 && doc.resource === MCP_RESOURCE && doc.authorizationServers.includes(MCP_ORIGIN), `status ${status}, resource ${doc.resource === MCP_RESOURCE ? 'ok' : 'unexpected'}`);
    return doc;
  });
  const asm = await report.step('authorization_server', () => productionAuthServer(report, fetcher, prm?.authorizationServers[0] ?? MCP_ORIGIN));
  await report.step('challenge_401', async () => {
    const challenge = await probeChallenge(fetcher, MCP_RESOURCE);
    report.add('challenge_401', challenge.status === 401 && challenge.resourceMetadata === prmUrl, `status ${challenge.status}, resource_metadata ${challenge.resourceMetadata === prmUrl ? 'ok' : challenge.resourceMetadata ? 'unexpected' : 'missing'}`);
  });
  if (asm) {
    await report.step('register', () => productionRegistration(report, fetcher, asm.registrationEndpoint, options.register === true));
    if (!options.readOnly) await report.step('register_wave', () => clientRegistrationSteps(report, fetcher, asm.registrationEndpoint, SMOKE_CLIENT_NAME));
  }
  await report.step('connect', () => connectSteps(report, fetcher, MCP_ORIGIN, options.validatePackage ?? null));
  // prompts/list needs a member's grant, and consent cannot be automated here; the local run lists them.
  report.add('mcp_prompts_list', null, 'needs a member grant; listed by the local run');
  return report;
}

/** RFC 8414 on MCP_ORIGIN, its endpoints pinned there. Null (so nothing is registered) when any is off-origin. */
async function productionAuthServer(report: Report, fetcher: Fetch, issuer: string): Promise<AuthServer | null> {
  const { status, body } = await getJson(fetcher, onBase(authServerMetadataUrl(issuer), MCP_ORIGIN));
  const doc = parseAuthServer(body);
  let pinned: AuthServer | null = null;
  try {
    pinned = pinAuthServer(doc, MCP_ORIGIN);
  } catch {
    pinned = null;
  }
  const ok = status === 200 && doc.issuer === MCP_ORIGIN && doc.s256 && pinned !== null;
  report.add('authorization_server', ok, `status ${status}, issuer ${doc.issuer === MCP_ORIGIN ? 'ok' : 'unexpected'}, S256 ${doc.s256 ? 'yes' : 'no'}, endpoints ${pinned ? 'on origin' : 'off origin'}`);
  cimdStep(report, body);
  return pinned;
}

/**
 * The refused redirect always (a refusal writes nothing). A public client with Claude's redirect only with
 * --register: a real client record named SMOKE_CLIENT_NAME, shown on /admin/clients until the daily sweep deletes it.
 */
async function productionRegistration(report: Report, fetcher: Fetch, endpoint: string, withClient: boolean): Promise<void> {
  const bad = await register(fetcher, endpoint, 'legallas-smoke-bad', REFUSED_REDIRECT, false);
  report.add('register_refused_redirect', bad.client === null && bad.status >= 400 && bad.status < 500, `status ${bad.status}${bad.error ? `, ${bad.error}` : ''}`);
  if (!withClient) return;
  const pub = await register(fetcher, endpoint, SMOKE_CLIENT_NAME, CLAUDE_REDIRECT, false);
  report.add('register_public_claude', pub.client !== null && pub.client.clientSecret === null, `status ${pub.status}${pub.error ? `, ${pub.error}` : ''}`);
}

/** connect/copilot/validate.ts, loaded at runtime (it imports mcp/contract.ts, which this tsconfig cannot type). */
async function packageValidator(): Promise<PackageValidator | null> {
  return loadModule<{ validatePackage: PackageValidator }>('connect/copilot/validate.ts').then(
    (module) => module.validatePackage,
    () => null,
  );
}

async function main(): Promise<void> {
  const args = parseSmokeArgs(process.argv.slice(2));
  console.log(`legallas-mcp smoke, ${args.mode} (${args.base})\n`);
  const validatePackage = await packageValidator();
  const report =
    args.mode === 'production'
      ? await runProduction(fetch, { register: args.register, readOnly: args.readOnly, validatePackage })
      : await runLocal(fetch, args.base, localPartReader(), {
          ...(await localOptions()),
          originEnforce: await devVar('MCP_ORIGIN_ENFORCE'),
          audit: localAuditProbe((sql) => cliWrangler('local').d1Query(sql)),
          validatePackage,
        });
  console.log(formatReport(report));
  process.exitCode = report.ok() ? 0 : 1;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
