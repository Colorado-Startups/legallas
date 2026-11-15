// SPDX-License-Identifier: Apache-2.0
// What a room says about itself: its hosts and addresses, who runs it, its own words for the case it holds, and what its
// law library holds. Each default is neutral and is what the room shows when it sets nothing.
//
// Fixed when the code is built, like the stored name (worker/stored-name.ts), so each one stays a constant and a page
// that doesn't use it doesn't carry it. A key of the room config, such as `mcpHost`, reaches the code as a global named
// ROOM_MCP_HOST: astro.config.mjs defines them for the pages (scripts/config.ts roomDefines), a room's Wrangler configs
// define them for the Workers, and scripts/room-preload.ts sets them for a script. `node --test` sets nothing, so tests run
// on the defaults.

declare const ROOM_INSTANCE_NAME: string | undefined;
declare const ROOM_COMPANY_NAME: string | undefined;
declare const ROOM_HOST: string | undefined;
declare const ROOM_MCP_HOST: string | undefined;
declare const ROOM_ACCESS_HOST: string | undefined;
declare const ROOM_CONTACT_EMAIL: string | undefined;
declare const ROOM_ALERT_TO: string | undefined;
declare const ROOM_ALERT_FROM: string | undefined;
declare const ROOM_OWNER_NAME: string | undefined;
declare const ROOM_OWNER_FULL_NAME: string | undefined;
declare const ROOM_OWNER_TITLED: string | undefined;
declare const ROOM_OWNER_ALLOWS: string | undefined;
declare const ROOM_OPERATOR_NAME: string | undefined;
declare const ROOM_PRIOR_STATUS: string | undefined;
declare const ROOM_PRIOR_CASE_LABEL: string | undefined;
declare const ROOM_CURRENT_PLEADING: string | undefined;
declare const ROOM_LAW_LIBRARY_HOLDS: string | undefined;
declare const ROOM_REGULATOR_ORDERS: readonly GuideOrder[] | undefined;
declare const ROOM_EXTRA_CLAIM_TYPES: readonly string[] | undefined;
declare const ROOM_TOOL_PREFIX: string | undefined;
declare const ROOM_COPILOT_APP_ID: string | undefined;
declare const ROOM_OWNER_WEBSITE: string | undefined;
declare const ROOM_ENTITY_TYPE: string | undefined;
declare const ROOM_FORMATION_DATE: string | undefined;
declare const ROOM_PAID_MONTHLY_USD: string | undefined;

/** One of the page guide's prepared questions. */
export interface GuideOrder {
  label: string;
  question: string[];
}

/** The room config's keys for this file, each with the JSON type it must have. scripts/config.ts reads and checks them. */
export const ROOM_SETTINGS = {
  instanceName: 'string',
  companyName: 'string',
  host: 'string',
  mcpHost: 'string',
  accessHost: 'string',
  contactEmail: 'string',
  alertTo: 'string',
  alertFrom: 'string',
  ownerName: 'string',
  ownerFullName: 'string',
  ownerTitled: 'string',
  ownerAllows: 'string',
  operatorName: 'string',
  priorStatus: 'string',
  priorCaseLabel: 'string',
  currentPleading: 'string',
  lawLibraryHolds: 'string',
  regulatorOrders: 'array',
  extraClaimTypes: 'array',
  toolPrefix: 'string',
  copilotAppId: 'string',
  ownerWebsite: 'string',
  entityType: 'string',
  formationDate: 'string',
  paidMonthlyUsd: 'string',
} as const;

/** The room's own name in the text of the connect pages. room-names.ts has the same name for what reads a Worker's vars. */
export const instanceName = typeof ROOM_INSTANCE_NAME === 'string' ? ROOM_INSTANCE_NAME : 'Legallas';
/** The Overview's heading in a room with no matter (worker/room-shape.ts): the company's, group's or fund's name. */
export const companyName = typeof ROOM_COMPANY_NAME === 'string' ? ROOM_COMPANY_NAME : 'Overview';
/** The room's own hostname. */
export const roomHost = typeof ROOM_HOST === 'string' ? ROOM_HOST : 'room.example.com';
/** The remote MCP server's hostname. */
export const mcpHost = typeof ROOM_MCP_HOST === 'string' ? ROOM_MCP_HOST : 'mcp.room.example.com';
/** The room's Cloudflare Access team domain, which a lawyer's browser reaches during sign-in. */
export const accessHost = typeof ROOM_ACCESS_HOST === 'string' ? ROOM_ACCESS_HOST : 'room.cloudflareaccess.com';
/** Where counsel and their IT reach the owner: the contact on the connect and legal pages. */
export const contactEmail = typeof ROOM_CONTACT_EMAIL === 'string' ? ROOM_CONTACT_EMAIL : 'email@example.com';
/** Who the room's alert emails go to, and who they come from. A room's send_email binding must allow both. */
export const alertTo = typeof ROOM_ALERT_TO === 'string' ? ROOM_ALERT_TO : 'owner@example.com';
export const alertFrom = typeof ROOM_ALERT_FROM === 'string' ? ROOM_ALERT_FROM : 'room@example.com';

/** The owner in a sentence: "email the owner at". Use `sentence` to open one with it. */
export const ownerName = typeof ROOM_OWNER_NAME === 'string' ? ROOM_OWNER_NAME : 'the owner';
/** The owner in full, for a message to someone who may not know the room: "tell the owner". */
export const ownerFullName = typeof ROOM_OWNER_FULL_NAME === 'string' ? ROOM_OWNER_FULL_NAME : 'the owner';
/** The owner with their role, for a person who isn't a member yet: "Ask the room owner to add it". */
export const ownerTitled = typeof ROOM_OWNER_TITLED === 'string' ? ROOM_OWNER_TITLED : 'the room owner';
/** The owner's pronoun and verb: "once they allow it". */
export const ownerAllows = typeof ROOM_OWNER_ALLOWS === 'string' ? ROOM_OWNER_ALLOWS : 'they allow';
/** Who operates the room, on the legal pages and the footer of the connect pages. */
export const operatorName = typeof ROOM_OPERATOR_NAME === 'string' ? ROOM_OPERATOR_NAME : 'the owner';

/** The word for how the prior case ended: "the closed pleading", "that pleading closed". */
export const priorStatus = typeof ROOM_PRIOR_STATUS === 'string' ? ROOM_PRIOR_STATUS : 'closed';
/** The prior case's name in titles and links. */
export const priorCaseLabel = typeof ROOM_PRIOR_CASE_LABEL === 'string' ? ROOM_PRIOR_CASE_LABEL : 'Prior case';
/** The word for the pleading counsel is preparing: "the current complaint". */
export const currentPleading = typeof ROOM_CURRENT_PLEADING === 'string' ? ROOM_CURRENT_PLEADING : 'current';

/** What the law library holds, as the search tool describes it: a sentence or two, ending in a full stop. */
export const lawLibraryHolds = typeof ROOM_LAW_LIBRARY_HOLDS === 'string' ? ROOM_LAW_LIBRARY_HOLDS : 'the public statutes, rules and opinions this room chose to hold.';

/** The page guide's prepared questions for the regulator track, ahead of its question about gaps. */
export const regulatorOrders: readonly GuideOrder[] = typeof ROOM_REGULATOR_ORDERS === 'object' ? ROOM_REGULATOR_ORDERS : [
  { label: 'What the parties were told', question: ['What were the parties told, and when, according to the record?'] },
  { label: 'Key counts', question: ['What are the key counts, and on what basis, with cites?'] },
];

/** Claim types a room's stored manifest uses beyond the product's (worker/matter-types.ts). */
export const extraClaimTypes: readonly string[] = typeof ROOM_EXTRA_CLAIM_TYPES === 'object' ? ROOM_EXTRA_CLAIM_TYPES : [];

/** The MCP tool prefix the room's Worker sets (MCP_TOOL_PREFIX, room-names.ts), for the app package's pinned tool names. */
export const toolPrefix = typeof ROOM_TOOL_PREFIX === 'string' ? ROOM_TOOL_PREFIX : undefined;
/** The Copilot app's ID in the room's own package (connect/copilot/room-package.ts). A new one is a new app for firms that have it. */
export const copilotAppId = typeof ROOM_COPILOT_APP_ID === 'string' ? ROOM_COPILOT_APP_ID : undefined;
/** The website that package names for its developer. */
export const ownerWebsite = typeof ROOM_OWNER_WEBSITE === 'string' ? ROOM_OWNER_WEBSITE : 'https://example.com';
/** The company's entity type, one of the checklist's (worker/checklist.ts), or null when the room hasn't set it. */
export const companyEntityType = typeof ROOM_ENTITY_TYPE === 'string' && ROOM_ENTITY_TYPE !== '' ? ROOM_ENTITY_TYPE : null;
/** The company's formation date, YYYY-MM-DD, or null when the room hasn't set it. */
export const companyFormationDate = typeof ROOM_FORMATION_DATE === 'string' && ROOM_FORMATION_DATE !== '' ? ROOM_FORMATION_DATE : null;

/** `text` with its first letter capitalized, to open a sentence with a name or a word from above. */
export function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Dollars a UTC month the owner lets Workers AI bill past the free daily neurons (worker/budget.ts), as text such as "10".
 * Unset, or anything but a plain amount from 0 to 50: 0, so Ask stops at the free limit unless the owner chose a budget (#48).
 * 50 is the most one setting may ask for: the account's own plan cap.
 */
export function paidMonthlyOf(raw: unknown): number {
  if (typeof raw !== 'string' || !/^\d{1,2}(?:\.\d{1,2})?$/.test(raw.trim())) return 0;
  const usd = Number(raw.trim());
  return usd <= 50 ? usd : 0;
}

/** This room's paid Workers AI month, in dollars: 0 unless its config sets `paidMonthlyUsd`. */
export const paidMonthlyUsd = paidMonthlyOf(typeof ROOM_PAID_MONTHLY_USD === 'string' ? ROOM_PAID_MONTHLY_USD : undefined);
