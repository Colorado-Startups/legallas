// SPDX-License-Identifier: Apache-2.0
// The contract for legallas-mcp, the read-only remote MCP server that lets counsel use Harvey, Microsoft Copilot
// and Claude with the room's documents. Every module in web/mcp builds against these names, shapes and limits,
// so parallel work can land in any order. Change this file with care.
//
// Imports here are type-only: @cloudflare/workers-oauth-provider loads `cloudflare:workers` at runtime, which
// plain `node --test` cannot resolve, so only mcp/index.ts (never imported by tests) may import it as a value.
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { z } from 'zod';
import type { Member, Role } from '../worker/env.ts';
import type { ChecklistSetting } from '../worker/checklist.ts';
import type { LawBindings } from '../worker/law.ts';
import type { ProposalSetting } from '../worker/proposals.ts';
import type { PublicRecordsVars } from '../worker/public-records.ts';
import type { RetentionVars } from '../worker/data-retention.ts';
import type { RoomNameVars } from '../worker/room-names.ts';
import { instanceName, mcpHost, roomHost } from '../worker/room-settings.ts';
import { STORED_NAME } from '../worker/stored-name.ts';

/** The server's own hostname and origin (a custom domain on the legallas-mcp Worker). */
export const MCP_HOST = mcpHost;
export const MCP_ORIGIN = `https://${MCP_HOST}`;
/** The canonical protected resource (RFC 8707 audience and RFC 9728 `resource`). Clients add exactly this URL. */
export const MCP_RESOURCE = `${MCP_ORIGIN}/mcp`;
/** The counsel room, where every result links back to the page it came from. */
export const ROOM_ORIGIN = `https://${roomHost}`;
/** A member who hasn't ticked the full notice (worker/notice-gate.ts): sign-in and tool calls refused. */
export const NOTICE_FIRST = `Read and tick the notice at ${ROOM_ORIGIN}/notice/, then connect again.`;

export const SERVER_NAME = STORED_NAME;
export const SERVER_TITLE = `${instanceName} counsel room`;

/** The one scope a grant carries. Read-only access to what a member sees in the room. */
export const SCOPE_READ = 'case.read';
export const SCOPES: readonly string[] = [SCOPE_READ];

/** Access tokens live an hour; refresh tokens rotate and die 30 days after sign-in, however often used (the owner, D6). */
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;

/**
 * Tool calls per member per UTC day (usage.tool_calls). DAILY_TOOL_CAP overrides it. 3,000 (the owner, 2026-10-20, D20):
 * legallas_read_pages reads one document per call, so pulling the whole room takes one call a document. Reads
 * touch only R2 and D1; searches stay capped by the AI Search meter (worker/budget.ts).
 */
export const DEFAULT_DAILY_TOOL_CAP = 3000;
/** legallas_search passages per call; matches the room's Ask retrieval (worker/retrieval.ts MAX_RESULTS). */
export const MAX_SEARCH_RESULTS = 20;
/** legallas_read_pages bounds per call. Microsoft cuts tool responses near 500 KB and 20 s. */
export const MAX_PAGES_PER_READ = 20;
export const MAX_CHARS_PER_READ = 60_000;
/** legallas_list_documents rows per page. */
export const LIST_PAGE_SIZE = 100;
/** legallas_search query length; matches worker/ask.ts MAX_QUESTION_CHARS. */
export const MAX_QUERY_CHARS = 2000;
/**
 * Shown before a control number when CONTROL_PREFIX is unset; the room's own fallback (Room.astro). Neutral on purpose:
 * `DOE` is the fictional fixture's prefix, so a room that set none must never number its documents as the fixture does.
 */
export const CONTROL_PREFIX_FALLBACK = 'DOC';

/**
 * Redirect URIs a client may use (the owner, D5: Harvey, Microsoft and Claude). The only closed models the room connects
 * are Claude, Copilot and Harvey (the owner, 2026-10-31), so Gemini Enterprise's callback, allowed from 2026-10-20, is
 * gone. An entry ending in `/` is a prefix, any other entry is exact. MCP_REDIRECT_ALLOW (comma-separated, same
 * rules) adds entries, for example Harvey's once known. Loopback (`http://localhost`, `http://127.0.0.1`, any port
 * and path) is NOT a default: any program on a lawyer's computer could use it, not just Claude Code (security
 * review, 2026-10-02). Add it to MCP_REDIRECT_ALLOW only if the owner wants those connections.
 */
export const DEFAULT_REDIRECT_ALLOW: readonly string[] = [
  'https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect',
  'https://global.consent.azure-apim.net/redirect/',
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  'https://harvey.ai/',
  'https://*.harvey.ai/',
];

/**
 * Origins /mcp accepts without a log line. The three AIs call /mcp server to server and normally send no Origin;
 * a browser page that does is logged (mcp_origin_unlisted, host only) and refused only when MCP_ORIGIN_ENFORCE
 * is "1". An entry starting `*.` matches that host and its subdomains, https only. The views' frames (mcp/apps/views.ts)
 * fetch nothing, but their hosts are listed all the same: Claude's `<hash>.claudemcpcontent.com`, and Copilot's
 * `<hash>.widget-renderer.usercontent.microsoft.com`, which `*.microsoft.com` covers.
 */
export const ORIGIN_ALLOW: readonly string[] = [
  'https://claude.ai',
  'https://claude.com',
  'https://*.claudemcpcontent.com',
  'https://*.microsoft.com',
  'https://*.office.com',
  'https://*.cloud.microsoft',
  'https://*.azure-apim.net',
  'https://*.harvey.ai',
];

/** Dynamic registrations expire after this long unused; the library renews an active one (D6's 30 days). */
export const CLIENT_REGISTRATION_TTL_SECONDS = 30 * 24 * 3600;

/**
 * The name every client the production smoke registers carries (scripts/mcp-smoke.ts, mirrored in
 * scripts/mcp-constants.ts). The daily sweep deletes such registrations once they are a day old (smoke-clients.ts).
 */
export const SMOKE_CLIENT_NAME = `${STORED_NAME}-smoke`;

/** KV index (OAUTH_KV) of the static clients created on /admin/clients, beside the library's `client:` keys. */
export const STATIC_CLIENT_PREFIX = `${STORED_NAME}-admin:static-client:`;
/** KV keys (OAUTH_KV) for redirect URIs a registration was refused for, and those the owner allowed. */
export const REFUSED_REDIRECT_PREFIX = `${STORED_NAME}-admin:refused-redirect:`;
export const ALLOWED_REDIRECT_PREFIX = `${STORED_NAME}-admin:allowed-redirect:`;

/** The public setup page, and the route that builds a firm's Copilot agent package from its registration ID. */
export const CONNECT_PATH = '/connect';
export const COPILOT_PACKAGE_PATH = '/connect/copilot-package';

/**
 * The nine read tools: eight for the record and the template library's reader. Names fit Microsoft's
 * `^[A-Za-z0-9_]+$` and Claude's 64-character limit. With the law library's tool that is ten, Microsoft's guidance of at
 * most ten per agent. view_visual, get_comments and get_file (data-room build, 2026-10-20) give counsel's AIs the visual
 * binder, comment threads and original files (D3).
 */
export const TOOL_NAMES = [
  'legallas_search',
  'legallas_case_overview',
  'legallas_list_documents',
  'legallas_get_document',
  'legallas_read_pages',
  'legallas_view_visual',
  'legallas_get_comments',
  'legallas_get_file',
  'legallas_template',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
/** The law library's search (T21), listed only while the law library is on (mcp/server.ts), apart from the nine. */
export const LAW_TOOL_NAME = 'legallas_search_law';
/**
 * The one tool that writes (docs/design/propose-and-approve.md): it proposes a new draft for a person to approve in the
 * room, and changes nothing else. Listed only while the room's PROPOSALS_ENABLED is "1" (mcp/server.ts), apart from
 * the read tools. No tool approves, rejects or reads proposals.
 */
export const PROPOSE_TOOL_NAME = 'legallas_propose_draft';
/**
 * Proposes that one company checklist item does or doesn't apply, for the owner to approve in the room
 * (worker/proposal-checklist.ts). Listed beside the propose tool only while the room's CHECKLIST_ENABLED is "1" too.
 */
export const PROPOSE_CHECKLIST_TOOL_NAME = 'legallas_propose_checklist';
/**
 * The public records check (mcp/tools/public-records.ts): a pending request for the member to approve in the room,
 * then a search of public sites. Listed only on a connection that may propose, while the room's PUBLIC_RECORDS is "1"
 * (mcp/server.ts listsRecords).
 */
export const RECORDS_TOOL_NAME = 'legallas_check_public_records';

/**
 * Which AI app a grant belongs to, read from its registered redirect URIs on every call (mcp/server.ts
 * clientKindOf): claude.ai and claude.com, harvey.ai, or Microsoft's Teams and Power Platform consent hosts.
 */
export type ClientKind = 'claude' | 'harvey' | 'microsoft' | 'unknown';

/**
 * How much one tool result may carry. Microsoft 365 Copilot declarative agents take about 4,096 tokens and 45 s per
 * result (plan for two thirds), so Microsoft and unknown clients get `compact`; Claude (about 150,000 characters
 * per result) and Harvey keep each tool's own caps (`standard`).
 */
export type ResponseProfile = 'compact' | 'standard';
export const PROFILE_OF: Readonly<Record<ClientKind, ResponseProfile>> = {
  claude: 'standard',
  harvey: 'standard',
  microsoft: 'compact',
  unknown: 'compact',
};

/** Items and characters one result may carry. Tools pass their own caps; format.ts limitsFor narrows them. */
export interface ResultLimits {
  maxItems: number;
  maxChars: number;
}
/** A compact result: at most 25 items and about 9,000 characters (about 2,300 tokens), with a cursor for more. */
export const COMPACT_LIMITS: ResultLimits = { maxItems: 25, maxChars: 9_000 };

/**
 * Binary content (an image or a PDF) is embedded in a result only for Claude, and only while its base64 stays within
 * this many characters; images also stay within IMAGE_MAX_PIXELS. Everyone else gets the file's facts and text.
 */
export const EMBED_MAX_BASE64_CHARS = 100_000;
export const IMAGE_MAX_PIXELS = 1_000_000;

/**
 * Byte pulls (embedded files and visual images) per member per UTC day across every AI connection, counted from the
 * `download` rows the tools write (mcp/audit.ts downloadsToday). Past it the tools answer with text only, so a stolen
 * or runaway grant cannot drain the room's files in a day (claude-review on #396).
 */
export const DAILY_DOWNLOAD_CAP = 200;

/** What a tool may audit: searches and reads (ai_read deduped as in mcp/audit.ts), and byte pulls as `download`. */
export type ToolAuditAction = 'ai_search' | 'ai_read' | 'download';

/** audit_log actions this server writes (migration 0004 adds them to the CHECK constraint). */
export const AI_AUDIT_ACTIONS = ['ai_connect', 'ai_disconnect', 'ai_search', 'ai_read'] as const;
export type AiAuditAction = (typeof AI_AUDIT_ACTIONS)[number];

/**
 * What a grant carries into every tool call (encrypted by the OAuth library, read back as ctx.props).
 * `email` is the Access-verified, normalized address; `clientName` is the app's name as shown on the consent
 * page ("Claude", "Harvey"), used for audit_log.via and alerts. `role` is frozen at consent: authorize on
 * ToolContext.member.role, which is re-read from D1 on every call, never on props.role.
 */
export interface Props {
  email: string;
  role: Role;
  clientId: string;
  clientName: string;
  /**
   * Set only when the member ticked "propose" on the consent page while the room's proposals or public-records checks
   * were on (docs/design/propose-and-approve.md): the connection's consent to propose, which the design names
   * `case.propose`. A grant without it never lists or runs legallas_propose_draft or legallas_check_public_records.
   * Absent on every grant made with both off.
   */
  propose?: true;
  /**
   * Set only on a grant a person approved after the install became a litigation room (mcp/conversion.ts): the ISO time
   * of that approval. Every grant without one stops at the conversion.
   */
  reapprovedAt?: string;
  /**
   * Set only by the room's own assistant, Ask (worker/agent/tools/adapters.ts), never on a grant: a proposal it makes
   * is recorded as Ask's (client_kind `ask`), through the same propose tool a connected AI calls.
   */
  ask?: true;
}

/** The grant's userId: the normalized email (never contains ':', which the OAuth library forbids). */
export function userIdFor(email: string): string {
  return email;
}

/** The OAuth helpers this server uses. Tests pass a fake with the same shape. */
export type OAuthHelpersLike = Pick<
  OAuthHelpers,
  | 'parseAuthRequest'
  | 'lookupClient'
  | 'completeAuthorization'
  | 'describeConsent'
  | 'beginConsent'
  | 'approveConsent'
  | 'denyConsent'
  | 'createClient'
  | 'listClients'
  | 'updateClient'
  | 'deleteClient'
  | 'listUserGrants'
  | 'revokeGrant'
  | 'purgeExpiredData'
>;

/** legallas-mcp's bindings, vars and secrets. Mirrors wrangler.mcp.jsonc. */
/** LAW_LIBRARY, LAW and LAW_SEARCH (worker/law.ts) are absent until the law library is turned on. */
/** INSTANCE_NAME and MCP_TOOL_PREFIX (worker/room-names.ts) are optional vars; unset keeps today's names. */
/** PROPOSALS_ENABLED (worker/proposals.ts): "1" lists legallas_propose_draft; anything else, or unset, does not. */
/** CHECKLIST_ENABLED (worker/checklist.ts): "1", with proposals, also lists legallas_propose_checklist. */
/** PUBLIC_RECORDS, PUBLIC_RECORDS_CONTACT and COURTLISTENER_TOKEN (worker/public-records.ts) set the records check. */
export interface McpEnv extends LawBindings, RoomNameVars, ProposalSetting, ChecklistSetting, PublicRecordsVars, RetentionVars {
  DB: D1Database;
  /** legallas-index: page-tagged text parts `text/<id>.p<N>.md`. */
  INDEX: R2Bucket;
  /**
   * legallas-files: meta/matter.json, the visual binder's manifest and meta/visual-ai side files, and original files
   * for legallas_get_file (the owner, 2026-10-20, D3). Bytes leave only as embedded results built by format.ts for
   * Claude, each audited as `download`; never as a URL.
   */
  FILES: R2Bucket;
  SEARCH: AiSearchInstance;
  /** OAuth clients, grants and token hashes (the library requires this binding name). */
  OAUTH_KV: KVNamespace;
  /** New-connection alerts; locked to room@ sending to owner@ like the room's binding. */
  EMAIL: SendEmail;
  /** Injected by OAuthProvider at runtime. */
  OAUTH_PROVIDER: OAuthHelpersLike;

  /** https://<team>.cloudflareaccess.com. Empty means /authorize denies everyone. */
  TEAM_DOMAIN: string;
  /** AUD tag of the Access app on /authorize, /connections and /admin/*; several may be comma-separated. */
  ACCESS_AUD: string;
  /** "1": those paths refuse a sign-in with no second factor (worker/mfa.ts), as the room's Worker does. */
  REQUIRE_MFA?: string;
  DAILY_TOOL_CAP?: string;
  /** "0" turns alert emails off (local dev). */
  ALERTS_ENABLED?: string;
  /** Keeps "counsel room" out of the alerts of a room with no published matter (worker/room-shape.ts). */
  COMPANY_ROOM_ENABLED?: string;
  /** "1" adds the options and recommendation line to the instructions (worker/recommend.ts). Anything else is off. */
  RECOMMEND?: string;
  /** The IANA zone for alert times next to UTC, as in the room's Worker (worker/env.ts). */
  TIME_ZONE?: string;
  /** Extra allowed redirect URIs, comma-separated (see DEFAULT_REDIRECT_ALLOW). */
  MCP_REDIRECT_ALLOW?: string;
  /**
   * "1" opens dynamic client registration (/register): Harvey and Copilot Studio register themselves (the owner,
   * 2026-10-02). Guarded by the redirect allowlist, size limits, REGISTER_LIMIT and a 30-day expiry when unused.
   */
  DCR_ENABLED?: string;
  /** "1" refuses /mcp requests whose Origin is not in ORIGIN_ALLOW; otherwise they are only logged. */
  MCP_ORIGIN_ENFORCE?: string;
  /** "zdr": zero retention only (mcp/retention.ts). Unset or anything else: any allowed AI, as today. */
  AI_POLICY?: string;
  /** With AI_POLICY "zdr": the client ids, comma-separated, whose setup the owner confirmed keeps nothing. */
  AI_ZDR_CLIENTS?: string;
  /**
   * The shared Teams Developer Portal OAuth client registration ID ("Any Microsoft 365 organization")
   * baked into GET /connect/legallas-agent.zip. Not a secret (every ZIP carries it), never logged. Empty: /connect
   * keeps the per-firm registration form and the download is a 404 page (mcp/copilot-package.ts).
   */
  COPILOT_REFERENCE_ID?: string;
  /**
   * Workers Rate Limiting, keyed by client IP: POST /register, POST /token, POST /connect/copilot-package (mcp/gates.ts),
   * and GET /connect/legallas-agent.zip, which applies PACKAGE_LIMIT itself (mcp/copilot-package.ts).
   */
  REGISTER_LIMIT: RateLimit;
  TOKEN_LIMIT: RateLimit;
  PACKAGE_LIMIT: RateLimit;
  /** Tool calls per member per minute (worker/burst.ts), before the daily cap. Optional: unset fails open. */
  TOOL_LIMIT?: RateLimit;
  /** Secret: the control-number prefix (names the matter, so it never lives in git). */
  CONTROL_PREFIX?: string;
  /** "1" once the owner has approved the wording of /privacy and /terms (D7); until then they say "being finalized". */
  POLICIES_PUBLISHED?: string;
  /**
   * Local development only (.dev.vars): the origin wrangler dev serves, for example http://localhost:8790. The
   * library serves resource metadata only for the configured resource's origin, so local runs need their own.
   * Ignored unless it is a localhost origin; mcp/config.test.ts keeps it out of wrangler.mcp.jsonc.
   */
  MCP_DEV_ORIGIN?: string;
  /** Local development only (.dev.vars): "1" swaps AI Search for a keyword scan of the local index (dev-search.ts). */
  MCP_SEARCH_MOCK?: string;

  /** Local development only (.dev.vars); honoured on localhost only, as in worker/auth.ts. */
  ALLOW_DEV_IDENTITY?: string;
  /** Local development only (.dev.vars): "1" lets the billed AI Search bindings run from localhost (worker/spend.ts). */
  LEGALLAS_DEV_REMOTE_AI?: string;
  DEV_IDENTITY_EMAIL?: string;
}

/** Everything a tool handler gets. Built per call after the membership and cap checks pass. */
export interface ToolContext {
  env: McpEnv;
  props: Props;
  /** Fresh from D1 for this call: removal from `members` cuts every connection at once. */
  member: Member;
  now: Date;
  /** The app behind this grant (mcp/server.ts clientKindOf). Only `claude` receives embedded binary content. */
  clientKind: ClientKind;
  /** PROFILE_OF[clientKind] unless a test or the replica sets it. Tools size every result with format.ts limitsFor. */
  profile: ResponseProfile;
  /**
   * The room's MCP tool prefix (worker/room-names.ts) when it is not the default; tools pass their hints and notes
   * through mcp/tool-prefix.ts withToolPrefix with it. Unset (the room's own research agent, tests): default names.
   */
  toolPrefix?: string;
  /**
   * Writes one audit_log row (never query text), with the client's name as `via`. ai_read is deduped like the room's
   * auditOnce; `download` (a byte pull) never is.
   */
  audit(action: ToolAuditAction, documentId: string | null): Promise<void>;
}

/**
 * One tool. server.ts registers each read tool with fixed read-only annotations, the propose tool with
 * PROPOSE_ANNOTATIONS and the public records check with RECORDS_ANNOTATIONS; handlers never throw for user errors.
 */
export interface ToolDefinition<Schema extends z.ZodObject = z.ZodObject> {
  name: ToolName | typeof LAW_TOOL_NAME | typeof PROPOSE_TOOL_NAME | typeof PROPOSE_CHECKLIST_TOOL_NAME | typeof RECORDS_TOOL_NAME;
  title: string;
  description: string;
  inputSchema: Schema;
  /**
   * The input schema a room lists, when it depends on the room's settings (the overview lists its checklist section only
   * while CHECKLIST_ENABLED is "1"); inputSchema otherwise. Every schema it returns accepts a subset of inputSchema.
   */
  inputSchemaFor?(env: McpEnv): z.ZodObject;
  /**
   * What a successful result's structured content holds (mcp/tools/output.ts). server.ts lists it, and the SDK checks
   * every result against it, for standard callers only: a compact result has no structured content to check (format.ts
   * forProfile). Every tool the server lists has one (mcp/tools/output.test.ts).
   */
  outputSchema?: z.ZodObject;
  /**
   * Listed as the tool's `_meta` (mcp/server.ts): the view an AI draws from its result, as MCP Apps names it
   * (mcp/apps/views.ts viewMeta). Only the overview and the document list have one.
   */
  _meta?: Record<string, unknown>;
  handler(args: z.infer<Schema>, ctx: ToolContext): Promise<CallToolResult>;
}

/** Annotations every tool carries: Copilot lists them as read tools and Claude may run them without asking. */
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * The propose tool's annotations: it writes (a pending proposal), so Claude asks its user before calling it and Copilot
 * lists it as an action. It destroys nothing and reaches nothing outside the room. Every read tool keeps
 * READ_ONLY_ANNOTATIONS.
 */
export const PROPOSE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/**
 * The public records check's annotations: a propose tool's (it writes a pending request, so Claude asks its user first)
 * that also reaches outside the room, since once the member approves it sends the name to public sites.
 */
export const RECORDS_ANNOTATIONS = { ...PROPOSE_ANNOTATIONS, openWorldHint: true } as const;

/** One connection as /connections lists it. */
export interface ConnectionRow {
  grantId: string;
  email: string;
  clientName: string;
  /** Unix seconds. */
  createdAt: number;
  expiresAt: number | null;
}

/** Grants as /connections needs them. Backed by OAuthHelpersLike in production and a fake in tests. */
export interface GrantStore {
  listForMember(email: string): Promise<ConnectionRow[]>;
  revoke(grantId: string, email: string): Promise<void>;
}

/** Grant metadata stored by completeAuthorization (readable without decrypting props). */
export interface GrantMetadata {
  clientName: string;
  /** ISO time of consent. */
  approvedAt: string;
}

/**
 * Form and query field names shared by the handlers (A1, C2) and the pages that post them (A2), so a renamed
 * field breaks the type check instead of a form. The form token and grant id live in forms.ts.
 */
export const FIELDS = {
  /** POST /authorize: the consent transaction handle from beginConsent. */
  handle: 'handle',
  /** POST /authorize: 'approve' or 'deny'. */
  decision: 'decision',
  /** POST /authorize: '1' when the member also lets the app propose drafts (offered only while proposals are on). */
  propose: 'propose',
  /** POST /admin/clients: 'create', 'delete', 'add_redirect', 'sweep_smoke' or a callback action. */
  action: 'action',
  clientName: 'client_name',
  /** One redirect URI per line. */
  redirectUris: 'redirect_uris',
  clientId: 'client_id',
  /** GET /admin/clients query: 'static' (default) or 'all'. */
  list: 'list',
  cursor: 'cursor',
  /** GET /admin/clients query: the one-time view of a just-created client's secret. */
  created: 'created',
  /** GET /admin/clients query after Delete old smoke clients: how many were deleted, and '1' when more may remain. */
  swept: 'swept',
  more: 'more',
} as const;

/** The two consent decisions. */
export const DECISIONS = { approve: 'approve', deny: 'deny' } as const;
