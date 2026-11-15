// SPDX-License-Identifier: Apache-2.0
// The daily sweep of AI connections left behind by removed members (owner: session C2), by a row whose role the
// code no longer knows, such as a family row from before migration 0010, or by a room guest whose invitation ended
// (expired, revoked, lapsed unused, its room archived, or ROOMS_ENABLED turned off). Removal already stops every tool
// call (each one re-reads `members` and `room_members`), but the library would still refresh the grant's tokens, and
// re-adding the person would bring the grant back. The sweep revokes every grant whose user is neither a member nor a
// guest who may connect (worker/rooms.ts aiGuestEmails), writes an ai_disconnect row for each, then lets the library
// purge expired data. The scheduled handler in index.ts calls it. Logs carry counts and codes only.
import type { PurgeResult } from '@cloudflare/workers-oauth-provider';
import { isRole } from '../worker/auth.ts';
import { normalizeEmail } from '../worker/email.ts';
import { aiGuestEmails, roomsEnabled } from '../worker/rooms.ts';
import { aiAudit } from './audit.ts';
import type { GrantMetadata, McpEnv, OAuthHelpersLike } from './contract.ts';
import { STORED_NAME } from '../worker/stored-name.ts';

type SweepEnv = Pick<McpEnv, 'DB' | 'OAUTH_KV' | 'OAUTH_PROVIDER'> & { ROOMS_ENABLED?: string };

// purgeExpiredData is in OAuthHelpersLike; test fakes may leave it out, so it is checked before use.
type PurgingHelpers = Partial<Pick<OAuthHelpersLike, 'purgeExpiredData'>>;

const GRANT_PREFIX = 'grant:';
/** KV list's maximum page, and a bound on pages (20,000 grants) so one run always ends. */
const LIST_LIMIT = 1000;
const MAX_LIST_PAGES = 20;
/**
 * Revokes per run. Each costs about six subrequests (a grant read, the audit insert, a token listing, a delete
 * or two, the grant delete): about 150 for 25. With the grant listing (at most 20) and one purge step (at most
 * PURGE_BATCH reads per phase, so about 100, plus a few revokes of grants it finds orphaned or expired), a run
 * stays near 300 of the 1000 subrequests per invocation; the rest wait for tomorrow.
 */
export const MAX_REVOKES_PER_RUN = 25;
/** purgeExpiredData keys per phase per run (the library's own default), resumed from a cursor kept in KV. */
const PURGE_BATCH = 50;
/** Outside the library's `grant:`, `token:` and `client:` key spaces, so its scans never see it. */
export const PURGE_CURSOR_KEY = `${STORED_NAME}:purge-cursor`;
/** audit_log.via when the grant's app name cannot be read. */
export const SWEEP_VIA = 'sweep';

export interface SweepResult {
  /** Grant records listed. */
  checked: number;
  /** Orphaned grants revoked. */
  revoked: number;
  /** Orphaned grants left for the next run: over MAX_REVOKES_PER_RUN, or their revoke failed. */
  skipped: number;
  /** Revoked grants whose ai_disconnect row could not be written (the revoke still stands). */
  auditFailed: number;
  /** True when every grant was listed and every orphan revoked; false means the next run continues. */
  complete: boolean;
  /** purgeExpiredData's counts, or null when the helper lacks it or it failed. */
  purge: Pick<PurgeResult, 'grantsPurged' | 'tokensPurged' | 'done'> | null;
}

interface GrantKey {
  key: string;
  userId: string;
  grantId: string;
}

/** `grant:<userId>:<grantId>`, or null for anything else (userIds never contain ':'; see userIdFor). */
export function parseGrantKey(key: string): GrantKey | null {
  if (!key.startsWith(GRANT_PREFIX)) return null;
  const parts = key.slice(GRANT_PREFIX.length).split(':');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return null;
  return { key, userId: parts[0], grantId: parts[1] };
}

function logFailure(event: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  const name = typeof code === 'string' ? code : error instanceof Error ? error.name : 'unknown';
  console.error(JSON.stringify({ event, code: name }));
}

/** Every grant key, and whether the listing reached its end within MAX_LIST_PAGES. */
async function listGrants(kv: KVNamespace): Promise<{ grants: GrantKey[]; listed: boolean }> {
  const grants: GrantKey[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await kv.list({ prefix: GRANT_PREFIX, limit: LIST_LIMIT, cursor });
    for (const { name } of result.keys) {
      const grant = parseGrantKey(name);
      if (grant) grants.push(grant);
    }
    if (result.list_complete) return { grants, listed: true };
    cursor = result.cursor;
  }
  return { grants, listed: false };
}

/** The grant's app name from its stored metadata, else SWEEP_VIA. Never throws. */
async function viaFor(kv: KVNamespace, key: string): Promise<string> {
  try {
    const grant = await kv.get<{ metadata?: Partial<GrantMetadata> | null }>(key, 'json');
    const name = grant?.metadata?.clientName;
    return typeof name === 'string' && name.trim() !== '' ? name.trim() : SWEEP_VIA;
  } catch {
    return SWEEP_VIA;
  }
}

/**
 * Revokes, then audits: a logging failure must never keep a removed member's access alive. The app name is read
 * before the revoke deletes the record. Returns whether the grant was revoked and whether its row was written.
 */
async function revokeOrphan(env: SweepEnv, grant: GrantKey, audit: typeof aiAudit): Promise<{ revoked: boolean; audited: boolean }> {
  const via = await viaFor(env.OAUTH_KV, grant.key);
  try {
    await env.OAUTH_PROVIDER.revokeGrant(grant.grantId, grant.userId);
  } catch (error) {
    logFailure('mcp.sweep_revoke_failed', error);
    return { revoked: false, audited: false };
  }
  try {
    await audit(env, { email: grant.userId, action: 'ai_disconnect', documentId: null, via });
    return { revoked: true, audited: true };
  } catch (error) {
    logFailure('mcp.sweep_audit_failed', error);
    return { revoked: true, audited: false };
  }
}

/** One purgeExpiredData step, resumed from and saved to PURGE_CURSOR_KEY. Null when unavailable or failed. */
async function purgeStep(env: SweepEnv): Promise<SweepResult['purge']> {
  const helpers = env.OAUTH_PROVIDER as PurgingHelpers;
  if (typeof helpers.purgeExpiredData !== 'function') return null;
  try {
    const cursor = (await env.OAUTH_KV.get(PURGE_CURSOR_KEY)) ?? undefined;
    const result = await helpers.purgeExpiredData({ batchSize: PURGE_BATCH, cursor });
    if (result.done || !result.cursor) await env.OAUTH_KV.delete(PURGE_CURSOR_KEY);
    else await env.OAUTH_KV.put(PURGE_CURSOR_KEY, result.cursor);
    return { grantsPurged: result.grantsPurged, tokensPurged: result.tokensPurged, done: result.done };
  } catch (error) {
    logFailure('mcp.sweep_purge_failed', error);
    // A TypeError means the library could not parse the saved cursor (its format changed in an upgrade):
    // start the next sweep from the beginning rather than failing on the same cursor every day.
    if (error instanceof TypeError) await env.OAUTH_KV.delete(PURGE_CURSOR_KEY).catch(() => undefined);
    return null;
  }
}

/**
 * Revokes up to MAX_REVOKES_PER_RUN grants whose user is neither a member nor, with ROOMS_ENABLED, a guest with an
 * active invitation that may connect, auditing each after, then runs one purge step. A member is a `members` row with
 * a role the code knows (auth.ts isRole), as findMember reads it, so a row left with a retired role loses its grants
 * here too. Lists the grants first and reads `members` and the invitations after, once: a grant is only created for a
 * member or such a guest, so one added during the listing is already in the set and keeps their new grant. Throws,
 * revoking nothing, if a read fails. No member at all revokes nothing, because the owner is always one, so none means
 * something is wrong. Both sides are compared normalized. `audit` and `now` are injectable for tests.
 */
export async function sweepOrphanGrants(env: SweepEnv, audit: typeof aiAudit = aiAudit, now: Date = new Date()): Promise<SweepResult> {
  const { grants, listed } = await listGrants(env.OAUTH_KV);
  const { results } = await env.DB.prepare('SELECT email, role FROM members').all<{ email: string; role: string }>();
  const known = results.filter((row) => isRole(row.role));
  const members = new Set(known.map((row) => normalizeEmail(row.email)).filter((email) => email !== null));
  const guests = roomsEnabled(env) ? [...(await aiGuestEmails(env.DB, now))].map(normalizeEmail) : [];
  const keep = new Set([...members, ...guests.filter((email) => email !== null)]);
  const isOrphan = (grant: GrantKey) => {
    const email = normalizeEmail(grant.userId);
    return email === null || !keep.has(email);
  };
  const orphans = members.size === 0 ? [] : grants.filter(isOrphan);
  if (members.size === 0) console.error(JSON.stringify({ event: 'mcp.sweep_no_members', code: 'refused' }));

  let revoked = 0;
  let auditFailed = 0;
  for (const grant of orphans.slice(0, MAX_REVOKES_PER_RUN)) {
    const outcome = await revokeOrphan(env, grant, audit);
    if (outcome.revoked) revoked++;
    if (outcome.revoked && !outcome.audited) auditFailed++;
  }
  const skipped = orphans.length - revoked;
  const purge = await purgeStep(env);
  const complete = listed && skipped === 0 && members.size > 0;
  const result: SweepResult = { checked: grants.length, revoked, skipped, auditFailed, complete, purge };
  console.log(JSON.stringify({ event: 'mcp.sweep', checked: result.checked, revoked, skipped, auditFailed, complete }));
  return result;
}
