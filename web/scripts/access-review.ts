// SPDX-License-Identifier: Apache-2.0
// The quarterly access review (README.md "Quarterly access review"): everyone who can reach the room, and when they last did.
// For the room owner's own eyes on their own machine. It reads D1 and the MCP server's grants through wrangler, as
// scripts/member.ts does, and prints one report to the terminal. It writes no file and refuses to run in CI, whose logs
// GitHub keeps for 90 days: the report names every member.
//
//   npm run access-review [-- --local]
//
// Remote by default (production D1 and KV). Read-only: it changes nothing. Each flag's fix is in FLAG_ACTIONS.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cliWrangler, wrangler, type Target } from './wrangler.ts';

/** A person counts as inactive after this many days without a sign-in (or, for an AI connection, without a tool call). */
export const STALE_DAYS = 90;
const DAY_MS = 86_400_000;

/** The MCP server's own config, and its grant store (workers-oauth-provider keeps each grant at `grant:<user>:<id>`). */
export const MCP_CONFIG = 'wrangler.mcp.jsonc';
const GRANT_PREFIX = 'grant:';

export type Flag = 'no-sign-in' | 'ai-unused' | 'ai-not-member' | 'guest-no-sign-in';

/** What the owner does about each flag. The source: README.md "Quarterly access review" restates it (the test checks). */
export const FLAG_ACTIONS: Record<Flag, string> = {
  'no-sign-in': 'No sign-in in 90 days. Recent AI use means they work through their AI: keep. Else: npm run member -- remove <email>, then revoke their Access sessions',
  'ai-unused': 'AI connection unused in 90 days. Revoke it on the MCP server\'s /connections page; the member can reconnect',
  'ai-not-member': 'AI connection held by someone who is not a member. Revoke it on /connections now',
  'guest-no-sign-in': 'Guest with access and no sign-in in 90 days. Still needed? If not: npm run room -- revoke <room-id> <email>',
};

/** Members, each with their newest sign-in (migration 0002). */
export const MEMBERS_SQL =
  'SELECT m.email, m.role, m.added_at, (SELECT MAX(s.created_at) FROM sign_ins s WHERE s.email = m.email) AS last_sign_in ' +
  'FROM members m ORDER BY m.role, m.email;';

/** Each member's newest AI tool call per app (migration 0004's `via`). Never the query or the document. */
export const AI_USE_SQL =
  "SELECT email, via, MAX(ts) AS last_use FROM audit_log WHERE action IN ('ai_search', 'ai_read') GROUP BY email, via;";

/** Every invitation not revoked (migration 0012), with the guest's newest sign-in. */
export const GUESTS_SQL =
  'SELECT g.email, g.role, g.room_id, r.name AS room, r.kind, r.archived_at, g.invited_at, g.accept_by, g.joined_at, g.expires_at, ' +
  '(SELECT MAX(s.created_at) FROM sign_ins s WHERE s.email = g.email) AS last_sign_in ' +
  'FROM room_members g JOIN rooms r ON r.id = g.room_id WHERE g.revoked_at IS NULL ORDER BY g.expires_at, g.email;';

/** One live grant: whose it is, the app's name and when it was made and ends (ISO). */
export interface GrantRecord {
  email: string;
  app: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface ReviewInput {
  members: Record<string, unknown>[];
  aiUse: Record<string, unknown>[];
  /** Null when the room has no MCP server config, so no AI can connect. */
  grants: GrantRecord[] | null;
  /** Null when the database has no deal rooms (migration 0012 not applied). */
  guests: Record<string, unknown>[] | null;
}

export interface MemberLine { email: string; role: string; lastSignIn: string | null; lastAiUse: string | null; flag: Flag | null }
export interface ConnectionLine { email: string; app: string | null; connected: string; lastUse: string | null; flag: Flag | null }
export type GuestStatus = 'joined' | 'pending' | 'lapsed' | 'expired' | 'archived' | 'not served';
export interface GuestLine {
  email: string; role: string; roomId: string; room: string; status: GuestStatus; expires: string; lastSignIn: string | null; flag: Flag | null;
}
export interface Review { members: MemberLine[]; connections: ConnectionLine[] | null; guests: GuestLine[] | null }

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const newest = (a: string | null, b: string | null): string | null => (a === null ? b : b === null ? a : a > b ? a : b);

/** True when `since` (an ISO instant) is more than STALE_DAYS before `now`, or missing. */
export function stale(since: string | null, now: Date): boolean {
  const at = since === null ? Number.NaN : Date.parse(since);
  return Number.isNaN(at) || now.getTime() - at > STALE_DAYS * DAY_MS;
}

/** The app name as mcp/audit.ts auditVia stores it in audit_log.via, so a grant's clientName finds its own tool calls. */
export function viaName(name: string | null): string | null {
  if (name === null) return null;
  const clean = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  const via = Array.from(clean).slice(0, 80).join('').trimEnd();
  return via === '' ? null : via;
}

/** An invitation's state by worker/rooms.ts's rule: access while not expired, joined or inside the accept window, room live. */
export function guestStatus(row: Record<string, unknown>, now: Date): GuestStatus {
  const at = now.toISOString();
  if (text(row.kind) !== 'deal' && text(row.kind) !== 'matter') return 'not served';
  if (text(row.archived_at)) return 'archived';
  if ((text(row.expires_at) ?? '') <= at) return 'expired';
  if (text(row.joined_at)) return 'joined';
  return (text(row.accept_by) ?? '') > at ? 'pending' : 'lapsed';
}

/** Members, live AI connections and invitations, each with the flag the owner should act on (null when none). */
export function buildReview(input: ReviewInput, now: Date): Review {
  const lastUse = new Map<string, string>();
  const lastAiByEmail = new Map<string, string>();
  for (const row of input.aiUse) {
    const email = text(row.email);
    const at = text(row.last_use);
    if (!email || !at) continue;
    lastUse.set(`${email}\n${text(row.via) ?? ''}`, at);
    lastAiByEmail.set(email, newest(lastAiByEmail.get(email) ?? null, at)!);
  }

  const members: MemberLine[] = input.members.map((row) => {
    const email = text(row.email) ?? '';
    const lastSignIn = text(row.last_sign_in);
    // Never signed in counts from the day they were added, so a member added last week is not flagged yet.
    const flag: Flag | null = stale(lastSignIn ?? text(row.added_at), now) ? 'no-sign-in' : null;
    return { email, role: text(row.role) ?? '', lastSignIn, lastAiUse: lastAiByEmail.get(email) ?? null, flag };
  });

  const memberEmails = new Set(members.map((m) => m.email));
  const connections =
    input.grants
      ?.filter((g) => g.expiresAt === null || Date.parse(g.expiresAt) > now.getTime())
      .map((grant): ConnectionLine => {
        const used = lastUse.get(`${grant.email}\n${viaName(grant.app) ?? ''}`) ?? null;
        const flag: Flag | null = !memberEmails.has(grant.email)
          ? 'ai-not-member'
          : stale(used ?? grant.createdAt, now)
            ? 'ai-unused'
            : null;
        return { email: grant.email, app: grant.app, connected: grant.createdAt, lastUse: used, flag };
      })
      .sort((a, b) => a.email.localeCompare(b.email) || (a.app ?? '').localeCompare(b.app ?? '')) ?? null;

  const guests =
    input.guests?.map((row): GuestLine => {
      const status = guestStatus(row, now);
      const lastSignIn = text(row.last_sign_in);
      const hasAccess = status === 'joined' || status === 'pending';
      const flag: Flag | null = hasAccess && stale(lastSignIn ?? text(row.invited_at), now) ? 'guest-no-sign-in' : null;
      return {
        email: text(row.email) ?? '',
        role: text(row.role) ?? '',
        roomId: text(row.room_id) ?? '',
        room: text(row.room) ?? '',
        status,
        expires: text(row.expires_at) ?? '',
        lastSignIn,
        flag,
      };
    }) ?? null;

  return { members, connections, guests };
}

const day = (iso: string | null): string => (iso === null ? 'never' : iso.slice(0, 10));

/** Left-aligned columns, two spaces apart. */
function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => `  ${cells.map((c, i) => c.padEnd(widths[i]!)).join('  ')}`.trimEnd();
  return [line(head), ...rows.map(line)].join('\n');
}

/** The report as the terminal shows it. */
export function renderReview(review: Review, now: Date, target: Target): string {
  const out: string[] = [`Access review, ${day(now.toISOString())} (${target}). Flagged: nothing in ${STALE_DAYS} days.`, ''];
  const flags = new Set<Flag>();
  const mark = (flag: Flag | null): string => {
    if (flag) flags.add(flag);
    return flag ?? '';
  };

  out.push(`Members (${review.members.length})`);
  out.push(table(['email', 'role', 'last sign-in', 'last AI use', 'flag'], review.members.map((m) => [m.email, m.role, day(m.lastSignIn), day(m.lastAiUse), mark(m.flag)])));
  out.push('');

  if (review.connections === null) {
    out.push(`AI connections: none possible (no ${MCP_CONFIG}, so this room has no MCP server)`);
  } else {
    out.push(`AI connections (${review.connections.length})`);
    out.push(table(['email', 'app', 'connected', 'last use', 'flag'], review.connections.map((c) => [c.email, c.app ?? '(unnamed)', day(c.connected), day(c.lastUse), mark(c.flag)])));
  }
  out.push('');

  if (review.guests === null) {
    out.push('Guest invitations: none possible (this database has no deal rooms)');
  } else {
    out.push(`Guest invitations (${review.guests.length})`);
    out.push(
      table(
        ['email', 'role', 'room id', 'room', 'status', 'expires', 'last sign-in', 'flag'],
        review.guests.map((g) => [g.email, g.role, g.roomId, g.room, g.status, day(g.expires), day(g.lastSignIn), mark(g.flag)]),
      ),
    );
  }
  out.push('');

  const count = [...review.members, ...(review.connections ?? []), ...(review.guests ?? [])].filter((line) => line.flag).length;
  out.push(count === 0 ? 'No flags.' : `${count} flagged. What to do:`);
  for (const flag of Object.keys(FLAG_ACTIONS) as Flag[]) if (flags.has(flag)) out.push(`  ${flag}: ${FLAG_ACTIONS[flag]}`);
  return `${out.join('\n')}\n`;
}

/** The grant keys from `wrangler kv key list` output. */
export function parseKeyList(stdout: string): string[] {
  const start = stdout.indexOf('[');
  if (start < 0) throw new Error('wrangler kv key list returned no JSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    throw new Error('wrangler kv key list did not return JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('wrangler kv key list did not return a list');
  return parsed
    .map((entry) => (entry as { name?: unknown }).name)
    .filter((name): name is string => typeof name === 'string' && name.startsWith(GRANT_PREFIX));
}

/**
 * Whose grant, which app, and its dates, from one stored grant (workers-oauth-provider's Grant). Only these fields are read:
 * the grant's encrypted props never leave this function. Null for anything that is not a grant.
 */
export function parseGrant(stored: string): GrantRecord | null {
  let grant: { userId?: unknown; metadata?: { clientName?: unknown } | null; createdAt?: unknown; expiresAt?: unknown };
  try {
    grant = JSON.parse(stored) as typeof grant;
  } catch {
    // JSON.parse quotes the input around the error: never pass it on.
    return null;
  }
  if (!grant || typeof grant.userId !== 'string' || typeof grant.createdAt !== 'number') return null;
  const name = grant.metadata?.clientName;
  return {
    email: grant.userId.toLowerCase(),
    app: typeof name === 'string' && name.trim() ? name.trim() : null,
    createdAt: new Date(grant.createdAt * 1000).toISOString(),
    expiresAt: typeof grant.expiresAt === 'number' ? new Date(grant.expiresAt * 1000).toISOString() : null,
  };
}

export function isMissingRoomsTable(message: string): boolean {
  return /no such table: (?:room_members|rooms)\b/.test(message);
}

/** CI logs outlive the review: GitHub keeps them 90 days. */
export function inCi(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.CI || env.GITHUB_ACTIONS);
}

async function readGrants(target: Target): Promise<GrantRecord[] | null> {
  if (!existsSync(path.resolve(import.meta.dirname, '..', MCP_CONFIG))) return null;
  const kv = ['--binding', 'OAUTH_KV', '--config', MCP_CONFIG, `--${target}`];
  const grants: GrantRecord[] = [];
  for (const key of parseKeyList(await wrangler(['kv', 'key', 'list', '--prefix', GRANT_PREFIX, ...kv]))) {
    const grant = parseGrant(await wrangler(['kv', 'key', 'get', key, ...kv]));
    if (grant) grants.push(grant);
  }
  return grants;
}

if (import.meta.main) {
  try {
    if (inCi(process.env)) throw new Error('access-review names every member: run it on your own machine, never in CI.');
    const target: Target = process.argv.includes('--local') ? 'local' : 'remote';
    const db = cliWrangler(target);
    const members = await db.d1Query(MEMBERS_SQL);
    const aiUse = await db.d1Query(AI_USE_SQL);
    const guests = await db.d1Query(GUESTS_SQL).catch((error: unknown) => {
      if (isMissingRoomsTable(error instanceof Error ? error.message : '')) return null;
      throw error;
    });
    const grants = await readGrants(target);
    const now = new Date();
    process.stdout.write(renderReview(buildReview({ members, aiUse, grants, guests }, now), now, target));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
