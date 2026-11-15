// SPDX-License-Identifier: Apache-2.0
// The four ways counsel's AI connects to legallas-mcp, and OpenCode for an open-weight model, as a client of each kind, and the checks that the server answers
// each with its own profile. The server reads the kind from the registered redirect's host (mcp/server.ts
// clientKindOf) and sizes results by it (mcp/contract.ts PROFILE_OF, mcp/format.ts forProfile):
//   Microsoft (Teams, Copilot Studio): compact, one minified-JSON text block, and structuredContent only as the small view
//   the case overview and the catalog keep.
//   Claude and Harvey: standard, minified-JSON text plus structuredContent, checked against each tool's outputSchema.
//   Embedded image bytes go to Claude only, and only from the get_file and view_visual tools (under the room's prefix).
// Shared by the local smoke (scripts/mcp-smoke.ts: one grant per kind through the dev identity) and
// scripts/connect-e2e.ts (production: the code read from a real sign-in). Details carry statuses, codes and counts
// only, never tokens, secrets or tool text.
import { firstId, LEGACY_VERSION, McpSession, resultValue, summarizeTool, toolCallOk } from './mcp-client.ts';
import { LAW_TOOL_NAME, tool as toolName } from './mcp-constants.ts';
import { consentSteps, revokeSteps, toolNamesOk, type Report } from './mcp-flow.ts';
import { refresh, type TokenClient } from './mcp-grant.ts';
import type { AuthMethod, Discovery, Fetch } from './mcp-oauth.ts';
import { APIM_REDIRECT, CLAUDE_REDIRECT, HARVEY_REDIRECT, mcpStatus, OPENCODE_REDIRECT, TEAMS_REDIRECT } from './mcp-wave.ts';

export type ConnectKind = 'claude' | 'teams' | 'apim' | 'harvey';
/** A desktop app on the member's own computer, through a loopback callback: tested locally only, where loopback is allowed. */
export type DesktopKind = 'opencode';

export interface KindSpec {
  kind: ConnectKind | DesktopKind;
  /** The registered redirect: the server reads the kind from its host. */
  redirect: string;
  /** How the client registers and authenticates at the token endpoint (RFC 7591). */
  authMethod: AuthMethod;
  profile: 'compact' | 'standard';
  /** May receive embedded image bytes: Claude only. */
  images: boolean;
}

/**
 * Claude registers as a public client; Teams' Developer Portal as a confidential one with Basic auth; Copilot Studio
 * as a public one; Harvey's registration is unpublished, so it is the confidential client that posts its secret,
 * which covers the third auth method. scripts/connect-e2e.test.ts pins each profile to the server's own rules.
 */
export const KINDS: Readonly<Record<ConnectKind, KindSpec>> = {
  claude: { kind: 'claude', redirect: CLAUDE_REDIRECT, authMethod: 'none', profile: 'standard', images: true },
  teams: { kind: 'teams', redirect: TEAMS_REDIRECT, authMethod: 'client_secret_basic', profile: 'compact', images: false },
  apim: { kind: 'apim', redirect: APIM_REDIRECT, authMethod: 'none', profile: 'compact', images: false },
  harvey: { kind: 'harvey', redirect: HARVEY_REDIRECT, authMethod: 'client_secret_post', profile: 'standard', images: false },
};
export const KIND_NAMES = Object.keys(KINDS) as ConnectKind[];

/**
 * OpenCode, the way an open-weight model connects (docs/design/ai-connectors.md, section 4): a public client by
 * registration on its loopback callback. The server knows no such app, so it answers with the compact profile and no bytes.
 */
export const DESKTOP_KINDS: Readonly<Record<DesktopKind, KindSpec>> = {
  opencode: { kind: 'opencode', redirect: OPENCODE_REDIRECT, authMethod: 'none', profile: 'compact', images: false },
};

/** The tools whose results may carry bytes for a kind that takes them (mcp/tools/files.ts, visuals.ts). */
const BYTE_TOOLS: ReadonlySet<string> = new Set([toolName('get_file'), toolName('view_visual')]);
/** The tools whose compact results keep a small view as structured content, for the views that read it (mcp/tools/output.ts). */
const VIEW_TOOLS: ReadonlySet<string> = new Set([toolName('case_overview'), toolName('list_documents')]);

type Block = { type?: unknown; text?: unknown };

/** True for one minified JSON object: what forProfile sends a compact caller (JSON.stringify never writes a raw newline). */
export function minifiedObject(text: string): boolean {
  if (text.includes('\n')) return false;
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  } catch {
    return false;
  }
}

/**
 * Why a result does not have the kind's profile, as a reason word, or null when it does. A coded error is the same
 * for every profile, so only its blocks are checked.
 */
export function profileProblem(spec: KindSpec, tool: string, result: Record<string, unknown>): string | null {
  const content = Array.isArray(result.content) ? (result.content as Block[]) : [];
  const binary = content.filter((block) => block.type !== 'text').length;
  if (binary > 0 && !(spec.images && BYTE_TOOLS.has(tool))) return 'binary_content';
  if (result.isError === true) return null;
  if (content[0]?.type !== 'text' || typeof content[0].text !== 'string') return 'no_text';
  const structured = typeof result.structuredContent === 'object' && result.structuredContent !== null;
  // The law search names no outputSchema and sends its answer once, as text, to every kind (mcp/law-answer.ts).
  if (spec.profile === 'standard' && tool !== LAW_TOOL_NAME) return structured ? null : 'no_structured_content';
  if (structured && !VIEW_TOOLS.has(tool)) return 'structured_content';
  if (content.length !== 1) return 'extra_blocks';
  return minifiedObject(content[0].text) ? null : 'not_minified_json';
}

/**
 * Whether the server treated the caller as its kind where a result shows it: get_file refuses bytes to anyone but
 * Claude with reason `client` (a visual answers `visual` for everyone), and no other kind gets an embedded image.
 */
export function kindProblem(spec: KindSpec, tool: string, value: Record<string, unknown> | null): string | null {
  if (!value) return null;
  if (tool === toolName('get_file')) {
    if (spec.images) return value.reason === 'client' ? 'not_seen_as_claude' : null;
    if (value.embedded === true) return 'embedded_file';
    return value.reason === undefined || value.reason === 'client' || value.reason === 'visual' ? null : 'unexpected_reason';
  }
  if (tool === toolName('view_visual') && !spec.images && value.image_embedded === true) return 'embedded_image';
  return null;
}

/** Ids earlier calls found, for the calls that need one. */
interface Found {
  hit: string | null;
  doc: string | null;
  visual: string | null;
}

interface PlannedCall {
  step: string;
  tool: string;
  args(found: Found): Record<string, unknown>;
  /** Which id this call's result supplies. */
  keep?: keyof Found;
}

/** What contract v2's stubs answer (mcp/tools/*.ts): a tool still answering it has not shipped. */
const STUB_CODE = 'not_available';
/** Stands in when nothing came back to read: the tool still runs and answers a coded not_found. */
const MISSING_ID = 'smoke-missing-id';
const idOf = (value: string | null) => value ?? MISSING_ID;

/** Safe generic calls, every tool at least once; nothing names the case. */
export const CONNECT_PLAN: readonly PlannedCall[] = [
  { step: 'search', tool: toolName('search'), args: () => ({ query: 'complaint', limit: 3 }), keep: 'hit' },
  { step: 'read_pages', tool: toolName('read_pages'), args: (f) => ({ id: idOf(f.hit), from: 1, to: 1 }) },
  { step: 'list_documents', tool: toolName('list_documents'), args: () => ({}), keep: 'doc' },
  { step: 'get_document', tool: toolName('get_document'), args: (f) => ({ id: idOf(f.doc) }) },
  { step: 'get_file', tool: toolName('get_file'), args: (f) => ({ id: idOf(f.doc) }) },
  { step: 'case_overview', tool: toolName('case_overview'), args: () => ({}) },
  { step: 'view_visual_binder', tool: toolName('view_visual'), args: () => ({}), keep: 'visual' },
  { step: 'view_visual_one', tool: toolName('view_visual'), args: (f) => ({ id: idOf(f.visual) }) },
  { step: 'get_comments', tool: toolName('get_comments'), args: (f) => ({ id: idOf(f.doc) }) },
  { step: 'search_law_list', tool: LAW_TOOL_NAME, args: () => ({ list: true }) },
];

/** One call's line: the outcome's codes and sizes, then the profile verdict. Never text. */
function callDetail(spec: KindSpec, result: Record<string, unknown>, problem: string | null): string {
  const summary = summarizeTool(result);
  const blocks = Array.isArray(result.content) ? (result.content as Block[]) : [];
  const binary = blocks.filter((block) => block.type !== 'text').length;
  const head = summary.isError ? `code ${summary.code}` : `ok, text ${summary.textLength} chars, blocks ${blocks.length}, structured ${summary.structured ? 'yes' : 'no'}`;
  return `${head}${binary ? `, binary ${binary}` : ''}, ${spec.profile} ${problem ?? 'ok'}`;
}

/** Every planned call, each checked for success (a harmless coded error passes), the profile and the kind. */
async function planSteps(report: Report, session: McpSession, spec: KindSpec, lawListed: boolean, prefix: string): Promise<void> {
  const found: Found = { hit: null, doc: null, visual: null };
  for (const call of CONNECT_PLAN) {
    const name = `${prefix}call_${call.step}`;
    if (call.tool === LAW_TOOL_NAME && !lawListed) {
      report.add(name, null, 'not listed (LAW_LIBRARY off)');
      continue;
    }
    const reply = await session.callTool(call.tool, call.args(found));
    if (reply.result === null) {
      report.add(name, false, `status ${reply.status}, ${reply.error}`);
      continue;
    }
    const summary = summarizeTool(reply.result);
    const value = summary.isError ? null : resultValue(reply.result);
    if (call.keep && !found[call.keep]) found[call.keep] = firstId(value);
    const problem = profileProblem(spec, call.tool, reply.result) ?? kindProblem(spec, call.tool, value);
    report.add(name, toolCallOk(summary) && summary.code !== STUB_CODE && problem === null, callDetail(spec, reply.result, problem));
  }
}

/** Opens an MCP connection with the token, lists the tools and runs CONNECT_PLAN. False when it could not open. */
export async function kindSessionSteps(report: Report, fetcher: Fetch, endpoint: string, token: string, spec: KindSpec, prefix = ''): Promise<boolean> {
  const session = new McpSession(fetcher, endpoint, token, LEGACY_VERSION);
  const init = await session.open();
  if (!report.add(`${prefix}mcp_initialize`, init.agreed !== null, `status ${init.status}, ${init.error ?? `agreed ${init.agreed}`}`)) return false;
  const listed = await session.listTools();
  const names = ((listed.result?.tools as { name?: unknown }[] | undefined) ?? []).map((tool) => String(tool.name));
  report.add(`${prefix}tools_list`, toolNamesOk(names), `status ${listed.status}, ${listed.error ?? `${names.length} tools`}`);
  await planSteps(report, session, spec, names.includes(LAW_TOOL_NAME), prefix);
  return true;
}

/**
 * The local grant for one kind on its registered client: consent through the dev identity, the code exchange and
 * one refresh with the kind's auth method, the MCP checks, then revocation. Checks are named `<kind>_...`.
 */
export async function localKindSteps(report: Report, fetcher: Fetch, base: string, discovery: Discovery, spec: KindSpec, client: TokenClient | null): Promise<void> {
  const prefix = `${spec.kind}_`;
  if (!client) return void report.add(`${prefix}grant`, false, 'no client: its registration failed above');
  const granted = await consentSteps(report, fetcher, base, discovery, client, spec.redirect, prefix);
  if (!granted) return;
  const next = await refresh(fetcher, discovery.asm.tokenEndpoint, client, granted.refreshToken!, granted.resource); // safe: token_exchange required one
  const rotated = next.tokens?.refreshToken ?? null;
  report.add(`${prefix}refresh`, rotated !== null, `status ${next.status}${next.error ? `, ${next.error}` : ''}, auth ${spec.authMethod}`);
  const grant = next.tokens && rotated ? { ...granted, accessToken: next.tokens.accessToken, refreshToken: rotated } : granted;
  const endpoint = `${base}/mcp`;
  await kindSessionSteps(report, fetcher, endpoint, grant.accessToken, spec, prefix);
  await revokeSteps(report, fetcher, grant, (token) => mcpStatus(fetcher, endpoint, token), prefix);
}
