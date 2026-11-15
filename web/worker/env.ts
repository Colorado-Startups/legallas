// SPDX-License-Identifier: Apache-2.0
// The Worker's bindings and vars, shared by every module. Mirrors wrangler.jsonc.
import type { MemberGrantsApi } from '../mcp/member-grants.ts';
import type { LawBindings } from './law.ts';
import type { ChecklistSetting } from './checklist.ts';
import type { ProposalSetting } from './proposals.ts';
import type { PublicRecordsVars } from './public-records.ts';
import type { RoomNameVars } from './room-names.ts';
import type { CompanyRoomSetting } from './room-shape.ts';
import type { SyncSetting } from './sync.ts';

/** LAW_LIBRARY, LAW and LAW_SEARCH (worker/law.ts) are absent until the law library is turned on. */
/** INSTANCE_NAME and ASSISTANT_NAME (worker/room-names.ts) are optional vars; unset keeps today's names. */
/** PROPOSALS_ENABLED (worker/proposals.ts): "1" serves proposals in the room; anything else, or unset, is off. */
/** CHECKLIST_ENABLED (worker/checklist.ts): "1" serves the company checklist in the room; anything else, or unset, is off. */
/** PUBLIC_RECORDS, PUBLIC_RECORDS_CONTACT and COURTLISTENER_TOKEN (worker/public-records.ts) set the records check. */
/** SYNC_ENDPOINTS (worker/sync.ts): "1" serves the laptop's sync endpoints; anything else, or unset, is off. */
/** COMPANY_ROOM_ENABLED (worker/room-shape.ts): "1" opens a room with no published matter on its company. */
export interface Env extends LawBindings, ProposalSetting, ChecklistSetting, PublicRecordsVars, SyncSetting, CompanyRoomSetting, Pick<RoomNameVars, 'INSTANCE_NAME' | 'ASSISTANT_NAME'> {
  ASSETS: Fetcher;
  DB: D1Database;
  /** Original files, under opaque keys (documents.r2_key). */
  FILES: R2Bucket;
  /** Page-tagged text parts for AI Search. */
  INDEX: R2Bucket;
  AI: Ai;
  /** AI Search instance over legallas-index. Retrieval only (search()); generation goes through AI.run. */
  SEARCH: AiSearchInstance;
  /** Sign-in alerts. wrangler.jsonc locks it to one sender and one verified destination. */
  EMAIL: SendEmail;
  /** Questions per member per minute (worker/burst.ts), before the daily cap. Optional: unset fails open. */
  ASK_LIMIT?: RateLimit;
  /**
   * legallas-mcp's MemberGrants entrypoint (service binding): one member's live AI connection for GET /api/me/ai.
   * Optional: unset (local dev without mcp:dev, tests) answers not connected.
   */
  MCP_GRANTS?: MemberGrantsApi;
  /**
   * The research chat's Durable Objects (class LegallasResearch, worker/agent/research.ts): one SQLite instance per
   * member, named by worker/agent/instance.ts from the verified email, reached only through index.ts (D10, D12).
   */
  RESEARCH: DurableObjectNamespace;

  /** https://<team>.cloudflareaccess.com (no trailing slash needed). Empty means deny everything. */
  TEAM_DOMAIN: string;
  /** Access application AUD tag; several may be comma-separated. Empty means deny everything. */
  ACCESS_AUD: string;
  /**
   * "1": refuse a person whose Access sign-in shows no second factor (worker/mfa.ts), with a page saying how to add one.
   * Anything else, unset included, leaves sign-in as Access decides. Set it the same in wrangler.mcp.jsonc.
   */
  REQUIRE_MFA?: string;
  LEGALLAS_MODEL: string;
  DAILY_QUESTION_CAP: string;
  /**
   * The AUD tag of the Access application over /api/sync/, the one whose only policy is Service Auth. Never ACCESS_AUD:
   * a token for the people's application is no sync token. Empty means deny.
   */
  SYNC_ACCESS_AUD?: string;
  /** Optional: lowers the gigabytes a sync token may add to legallas-files in a month (worker/sync-rules.ts MONTHLY_UPLOAD_GB). */
  SYNC_MONTHLY_GB?: string;
  /** "0" turns sign-in emails off (local dev). Anything else, or unset, sends them. */
  ALERTS_ENABLED?: string;
  /**
   * The room's IANA time zone, such as America/Denver. The checklist's "today" (routes/checklist.ts): unset or unknown
   * reads UTC. Alert times next to UTC (worker/signins.ts alertTime): unset or unknown reads America/Denver.
   */
  TIME_ZONE?: string;
  /** Secret: the control-number prefix (names the matter, so it never lives in git). Unset shows the neutral "DOC" fallback. */
  CONTROL_PREFIX?: string;
  /**
   * The research chat's kill switch (D10): "1" on over a WebSocket, "http" on over an HTTP stream, anything else or
   * unset off (worker/agent/protocol.ts researchTransport). "0" in wrangler.jsonc until the Wave 2 flip.
   */
  RESEARCH_ENABLED?: string;
  /**
   * Deal rooms (worker/rooms.ts): "1" lets a guest invited to a room (room_members, migration 0012) in, to the guest
   * routes only. Anything else, unset included, keeps the room exactly as it was: a guest is refused like a stranger.
   * Not in wrangler.example.jsonc, so a room turns it on deliberately.
   */
  ROOMS_ENABLED?: string;
  /** "1" lets Ask retrieve the visuals' text (D8), after a replica eval shows no hard-gate loss. Anything else leaves it out. */
  ASK_VISUALS?: string;
  /** "1" has Ask and Research mode give options and a recommendation (worker/recommend.ts), after a replica eval passes. Anything else is off. */
  RECOMMEND?: string;
  /**
   * Groq, Ask's second backend after the day's neurons (worker/ask-provider.ts groqConfig): a JSON object var,
   * { enabled, zdr_confirmed, eval_runs }. Unset or malformed keeps Groq off.
   */
  ASK_GROQ?: unknown;
  /** Secret: the Groq key. Unset keeps Groq off. */
  LEGALLAS_ASK_GROQ_API_KEY?: string;
  /**
   * The room's own OpenAI-compatible model host for Ask (worker/ask-host.ts hostConfig): a JSON object var,
   * { enabled, zdr_confirmed, eval_runs, url, model, body }. Unset or malformed keeps it off, and Ask on Workers AI.
   */
  ASK_HOST?: unknown;
  /** Secret: the host's key. Unset keeps the host off. */
  LEGALLAS_ASK_HOST_API_KEY?: string;

  /** Local development only (.dev.vars). Ignored unless the request host is localhost. */
  ALLOW_DEV_IDENTITY?: string;
  DEV_IDENTITY_EMAIL?: string;
  /** Local development only (.dev.vars): the service token's Client ID on localhost, as DEV_IDENTITY_EMAIL is a person's. */
  DEV_SYNC_CLIENT_ID?: string;
  /** Local development only (.dev.vars): canned retrieval and answers instead of the billed AI bindings. */
  ASK_MOCK?: string;
  /**
   * Local development only (.dev.vars): "1" lets the billed AI bindings run from localhost, counted only in local D1
   * (worker/spend.ts withSpendGuards). Unset, local Ask refuses them; ASK_MOCK is the free way to develop.
   */
  LEGALLAS_DEV_REMOTE_AI?: string;
}

/** Who may use the room: the owner and counsel (see PERMISSIONS in auth.ts). The family role is retired. */
export type Role = 'owner' | 'counsel';

export interface Member {
  email: string;
  role: Role;
  name: string | null;
}

/** Everything a route handler needs. Built only after the caller passed Access and is a member. */
export interface RequestContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  url: URL;
  member: Member;
  params: Record<string, string>;
}
