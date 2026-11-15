// SPDX-License-Identifier: Apache-2.0
// Old clients of the production smoke. `npm run mcp:smoke -- --production` (scripts/mcp-smoke.ts) registers its
// Teams, Copilot Studio and Harvey clients through /register on every run, each named SMOKE_CLIENT_NAME, and the
// OAuth library has no RFC 7592 endpoint the script could delete them through afterwards, so they piled up on
// /admin/clients. This sweep deletes them once they are a day old: the daily cron runs it after the grant sweep
// (index.ts), and the owner's "Delete old smoke clients" button on /admin/clients runs the same bounded pass. A
// client is deleted only when all of these hold:
//   - its `client:` key carries an expiry, so it is a dynamic registration (createClient(), which /admin/clients
//     uses, writes clients that never expire);
//   - it is not in the /admin/clients static index (STATIC_CLIENT_PREFIX);
//   - its name is exactly SMOKE_CLIENT_NAME (scripts/connect-e2e.ts reuses its `legallas-smoke-<kind>` clients);
//   - it was registered at least SMOKE_CLIENT_MIN_AGE_SECONDS ago (the smoke never uses a client after its run);
//   - no grant names it.
// Logs carry counts and codes only.
import type { ClientInfo } from '@cloudflare/workers-oauth-provider';
import { SMOKE_CLIENT_NAME, STATIC_CLIENT_PREFIX, type McpEnv } from './contract.ts';
import { STORED_NAME } from '../worker/stored-name.ts';

type SmokeEnv = Pick<McpEnv, 'OAUTH_KV' | 'OAUTH_PROVIDER'>;

/** The library's key spaces: one `client:<clientId>` per client, `grant:<userId>:<grantId>` per grant. */
const CLIENT_PREFIX = 'client:';
const GRANT_PREFIX = 'grant:';
/** A smoke run takes seconds; a day leaves a wide margin before its clients count as old. */
export const SMOKE_CLIENT_MIN_AGE_SECONDS = 24 * 3600;
/**
 * Client keys per listing page and pages per run. Each listed key with an expiry costs one read, so a run reads at
 * most 100 clients; with the grant listing (at most 20 lists and MAX_GRANT_READS reads) and a static-index read per
 * delete, the scan stays under about 300 subrequests.
 */
export const CLIENT_PAGE = 50;
const MAX_CLIENT_PAGES = 2;
export const MAX_SMOKE_DELETES_PER_RUN = 25;
/**
 * Subrequests the deletes of one run may spend. The library's deleteClient lists every grant page and reads every
 * legacy grant again (to revoke any grant naming the client), so one delete costs 1 + the pages and reads this run's
 * own grant scan took (deleteCap). The scan, this budget and the grant sweep's 300 in the same cron stay under the
 * 1000 subrequests per invocation.
 */
export const DELETE_SUBREQUEST_BUDGET = 300;
const GRANT_LIST_LIMIT = 1000;
const MAX_GRANT_PAGES = 20;
/** Grant keys written without metadata (by a library before 1.0) are read; past this many the run deletes nothing. */
export const MAX_GRANT_READS = 50;
/** Where the next run resumes the client listing. Outside the library's key spaces, so its scans never see it. */
export const SMOKE_CURSOR_KEY = `${STORED_NAME}:smoke-client-cursor`;

export interface SmokeSweepResult {
  /** Client keys listed. */
  checked: number;
  /** Old smoke clients deleted. */
  deleted: number;
  /** Old smoke clients kept because a grant names them. */
  withGrant: number;
  /** Old smoke clients whose delete failed (tried again once the listing comes round to them). */
  skipped: number;
  /**
   * True when work is left: the listing stopped before its end (a cursor is saved, or the delete cap was reached and
   * the page is listed again), or a delete failed. False means the pass reached the last key with nothing left.
   */
  more: boolean;
}

/** The grant scan: client IDs some grant names, and what it cost (each library deleteClient costs the same again). */
export interface GrantScan {
  clients: Set<string>;
  /** Grant listing pages read. */
  pages: number;
  /** Grant keys without metadata, read one by one. */
  legacy: number;
}

/** Refused before any delete: the grants could not all be listed (logged by its name, as a code). */
export class SmokeSweepRefused extends Error {
  override name = 'SmokeSweepRefused';
}

/**
 * Deletes this run may make: DELETE_SUBREQUEST_BUDGET over one delete's cost (the key, plus the library's own grant
 * listing, as many pages and legacy reads as this run's scan took), at most MAX_SMOKE_DELETES_PER_RUN, at least 1.
 */
export function deleteCap(grantPages: number, legacyReads: number): number {
  const perDelete = 1 + Math.max(1, grantPages) + Math.max(0, legacyReads);
  return Math.max(1, Math.min(MAX_SMOKE_DELETES_PER_RUN, Math.floor(DELETE_SUBREQUEST_BUDGET / perDelete)));
}

/** A smoke client old enough to delete: named exactly SMOKE_CLIENT_NAME and registered at least a day ago. */
export function isOldSmokeClient(client: Pick<ClientInfo, 'clientName' | 'registrationDate'> | null, nowSeconds: number): boolean {
  if (client?.clientName !== SMOKE_CLIENT_NAME) return false;
  const registered = client.registrationDate;
  return typeof registered === 'number' && Number.isFinite(registered) && nowSeconds - registered >= SMOKE_CLIENT_MIN_AGE_SECONDS;
}

function logFailure(event: string, error: unknown): void {
  console.error(JSON.stringify({ event, code: error instanceof Error ? error.name : 'unknown' }));
}

/**
 * Every client ID a grant names, from the grant keys' metadata (one list per 1,000 grants), reading only the keys
 * written without it, and what that cost. Null, so nothing is deleted, when the listing does not end within
 * MAX_GRANT_PAGES or more than MAX_GRANT_READS keys need a read.
 */
export async function grantedClients(kv: KVNamespace): Promise<GrantScan | null> {
  const scan: GrantScan = { clients: new Set<string>(), pages: 0, legacy: 0 };
  let cursor: string | undefined;
  while (scan.pages < MAX_GRANT_PAGES) {
    const result = await kv.list<{ clientId?: unknown }>({ prefix: GRANT_PREFIX, limit: GRANT_LIST_LIMIT, cursor });
    scan.pages++;
    for (const key of result.keys) {
      const fromKey = key.metadata?.clientId;
      if (typeof fromKey === 'string') {
        scan.clients.add(fromKey);
        continue;
      }
      if (++scan.legacy > MAX_GRANT_READS) return null;
      const grant = await kv.get<{ clientId?: unknown }>(key.name, 'json');
      if (typeof grant?.clientId === 'string') scan.clients.add(grant.clientId);
    }
    if (result.list_complete) return scan;
    cursor = result.cursor;
  }
  return null;
}

/** One page of client keys from `cursor`; a saved cursor that fails is cleared, so the next run starts over. */
async function listClientKeys(kv: KVNamespace, cursor: string | undefined): Promise<KVNamespaceListResult<unknown, string>> {
  try {
    return await kv.list({ prefix: CLIENT_PREFIX, limit: CLIENT_PAGE, cursor });
  } catch (error) {
    if (cursor !== undefined) await kv.delete(SMOKE_CURSOR_KEY).catch(() => undefined);
    throw error;
  }
}

async function saveCursor(kv: KVNamespace, cursor: string | undefined): Promise<void> {
  if (cursor === undefined) await kv.delete(SMOKE_CURSOR_KEY);
  else await kv.put(SMOKE_CURSOR_KEY, cursor);
}

/**
 * Deletes the old smoke clients on one page of keys, at most `cap` of them in all (the checks at the top of this
 * file). Returns false when it stopped at the cap, so the page must be listed again.
 */
async function sweepPage(env: SmokeEnv, keys: KVNamespaceListKey<unknown>[], grants: GrantScan, cap: number, nowSeconds: number, result: SmokeSweepResult): Promise<boolean> {
  for (const key of keys) {
    // No expiry: created on /admin/clients (or registered before registrations expired). Never deleted.
    if (key.expiration === undefined) continue;
    const clientId = key.name.slice(CLIENT_PREFIX.length);
    if (!isOldSmokeClient(await env.OAUTH_PROVIDER.lookupClient(clientId), nowSeconds)) continue;
    if (grants.clients.has(clientId)) {
      result.withGrant++;
      continue;
    }
    if (result.deleted >= cap) return false;
    if ((await env.OAUTH_KV.get(`${STATIC_CLIENT_PREFIX}${clientId}`)) !== null) continue;
    try {
      await env.OAUTH_PROVIDER.deleteClient(clientId);
      result.deleted++;
    } catch (error) {
      logFailure('mcp.smoke_sweep_delete_failed', error);
      result.skipped++;
    }
  }
  return true;
}

/**
 * One bounded pass: lists the grants, then up to MAX_CLIENT_PAGES pages of clients from where the last pass stopped
 * (the cron and the button share the cursor), deleting at most deleteCap old smoke clients. A page cut off at the cap
 * is listed again next time, so no client is passed over; once the listing ends the cursor is cleared and the next
 * pass starts at the top. Throws SmokeSweepRefused, deleting nothing, when the grants cannot all be listed, and any
 * KV failure as it comes; the cron logs the code and the button says so.
 */
export async function sweepSmokeClients(env: SmokeEnv, now: number = Date.now()): Promise<SmokeSweepResult> {
  const nowSeconds = Math.floor(now / 1000);
  const result: SmokeSweepResult = { checked: 0, deleted: 0, withGrant: 0, skipped: 0, more: false };
  const grants = await grantedClients(env.OAUTH_KV);
  if (!grants) throw new SmokeSweepRefused('grants_unlisted');
  const cap = deleteCap(grants.pages, grants.legacy);
  let cursor = (await env.OAUTH_KV.get(SMOKE_CURSOR_KEY)) ?? undefined;
  let stopped = false;
  for (let page = 0; page < MAX_CLIENT_PAGES; page++) {
    const listed = await listClientKeys(env.OAUTH_KV, cursor);
    result.checked += listed.keys.length;
    stopped = !(await sweepPage(env, listed.keys, grants, cap, nowSeconds, result));
    if (stopped) break;
    cursor = listed.list_complete ? undefined : listed.cursor;
    if (listed.list_complete) break;
  }
  await saveCursor(env.OAUTH_KV, cursor);
  result.more = stopped || cursor !== undefined || result.skipped > 0;
  const { checked, deleted, withGrant, skipped, more } = result;
  console.log(JSON.stringify({ event: 'mcp.smoke_sweep', checked, deleted, withGrant, skipped, more }));
  return result;
}
