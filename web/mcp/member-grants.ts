// SPDX-License-Identifier: Apache-2.0
// One member's live AI connection, for the room's Overview panel (legallas-web GET /api/me/ai). legallas-web asks over
// a service binding to the named entrypoint MemberGrants (mcp/index.ts), which the internet cannot reach. The grants
// themselves are the truth: when the owner revokes a counsel's app, or one of two apps is disconnected, the answer
// changes at once, where the audit log records who acted rather than whose grant it was. Only { connected, via, at }
// ever leaves: never a token, grant id, client id or another member's data. No role is checked here: whoever calls
// it decides who may ask (worker/routes/me.ts asks only for the signed-in member whose role may connect).
import type { GrantSummary } from '@cloudflare/workers-oauth-provider';
import { normalizeEmail } from '../worker/email.ts';
import { userIdFor, type GrantMetadata, type OAuthHelpersLike } from './contract.ts';

/** The member's newest live grant: the app's name (GrantMetadata.clientName) and when it was granted (ISO). */
export interface AiStatus {
  connected: boolean;
  via: string | null;
  at: string | null;
}

/** What legallas-web's MCP_GRANTS binding offers (worker/env.ts). */
export interface MemberGrantsApi {
  live(email: string): Promise<AiStatus>;
}

export const NOT_CONNECTED: AiStatus = { connected: false, via: null, at: null };

/** As connections.ts: listUserGrants' largest page, and a bound so a bad cursor can never loop forever. */
const PAGE_LIMIT = 1000;
const MAX_PAGES = 50;

/** The app's name from the grant's own metadata; never the client id that /connections falls back to. */
function appName(grant: GrantSummary): string | null {
  const name = (grant.metadata as Partial<GrantMetadata> | null | undefined)?.clientName;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

async function memberGrants(helpers: Pick<OAuthHelpersLike, 'listUserGrants'>, email: string): Promise<GrantSummary[]> {
  const grants: GrantSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await helpers.listUserGrants(userIdFor(email), { limit: PAGE_LIMIT, cursor });
    grants.push(...result.items);
    if (!result.cursor) break;
    cursor = result.cursor;
  }
  return grants;
}

/**
 * Connected while the member holds any unexpired grant; via and at come from the newest one. An address that is not
 * one is never looked up. KV listings can trail a revoke for a moment, as /connections notes.
 */
export async function liveAi(helpers: Pick<OAuthHelpersLike, 'listUserGrants'>, email: unknown, nowMs = Date.now()): Promise<AiStatus> {
  const member = normalizeEmail(email);
  if (!member) return NOT_CONNECTED;
  const live = (await memberGrants(helpers, member)).filter((g) => g.expiresAt == null || g.expiresAt * 1000 > nowMs);
  const newest = live.sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!newest) return NOT_CONNECTED;
  return { connected: true, via: appName(newest), at: new Date(newest.createdAt * 1000).toISOString() };
}
