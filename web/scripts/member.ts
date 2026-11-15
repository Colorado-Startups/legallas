// SPDX-License-Identifier: Apache-2.0
// Manage who may use the room. Members are managed only from the owner's own machine, never over the web.
//
//   npm run member -- add <email> <owner|counsel> [name...] [--local]
//   npm run member -- remove <email> [--local]
//   npm run member -- list [--local]
//   npm run member -- history [email] [--local]
//
// Remote by default (production D1). Every add, role change and removal writes one append-only access_events row
// (migration 0012): who ran it (the Cloudflare login wrangler uses, else ACTOR), the email, and the role. `history`
// lists those rows. Removing a member cuts them off at the Worker immediately, even mid-session, and ends any deal-room
// invitation they hold (scripts/room.ts). With the owner's Access API token set (access-offboard.ts), it also removes
// them from the room's Access policies and ends their Access sessions; without it, it prints those two steps.
import { execFileSync } from 'node:child_process';
import { normalizeEmail } from '../worker/email.ts';
import { inviteMessage, readerOfRole } from '../worker/invite.ts';
import { sqlLiteral } from '../worker/sql.ts';
import { ACCESS_TOKEN_ENV, accessApi, offboard, roomTargets, type OffboardResult } from './access-offboard.ts';
import { ACTOR, revokeSql } from './room.ts';

// Mirrors Role in worker/env.ts (the scripts tsconfig cannot see the Worker's Cloudflare types).
type Role = 'owner' | 'counsel';
const ROLES: ReadonlySet<string> = new Set<Role>(['owner', 'counsel']);
const USAGE = 'usage: member add <email> <owner|counsel> [name] | member remove <email> | member list | member history [email]   [--local]';

export type MemberCommand =
  | { kind: 'add'; email: string; role: Role; name: string | null }
  | { kind: 'remove'; email: string }
  | { kind: 'list' }
  | { kind: 'history'; email: string | null };

/** Parses argv (without node and script path). Throws a usage message on bad input. */
export function parseMemberArgs(args: string[]): MemberCommand {
  const [verb, rawEmail, rawRole, ...rest] = args.filter((arg) => arg !== '--local');
  if (verb === 'list') return { kind: 'list' };
  const email = normalizeEmail(rawEmail);
  if (verb === 'history' && rawRole === undefined && (rawEmail === undefined || email)) return { kind: 'history', email };
  if (verb === 'remove' && email) return { kind: 'remove', email };
  if (verb === 'add' && rawRole?.toLowerCase() === 'family') {
    throw new Error('the family role was retired on 2026-10-20: members are the owner and counsel only. ' + USAGE);
  }
  if (verb === 'add' && email && rawRole && ROLES.has(rawRole)) {
    const name = rest.join(' ').trim();
    return { kind: 'add', email, role: rawRole as Role, name: name || null };
  }
  throw new Error(USAGE);
}

/** The access_events actions this script writes, and `history` lists. room_id is NULL on each: the install itself. */
export const MEMBER_EVENTS = ['person_added', 'grant_changed', 'person_disabled', 'access_removed', 'sessions_ended', 'access_sync_failed'] as const;
type MemberEvent = (typeof MEMBER_EVENTS)[number];

/** One access_events row about the install (room_id NULL). `detail` must already be a valid detail_code or NULL. */
export function eventSql(actor: string, action: MemberEvent, email: string, detail: string | null): string {
  return (
    'INSERT INTO access_events (actor, action, subject_email, detail_code) ' +
    `VALUES (${sqlLiteral(actor)}, '${action}', ${sqlLiteral(email)}, ${sqlLiteral(detail)});`
  );
}

/**
 * The statements for a command, run by wrangler as one batch. The audit rows come before the change they describe and
 * read the state it changes, so each is written only when something changes: person_added for a new member, grant_changed
 * (detail role_<old>_to_<new>) for a new role, person_disabled (detail: the role they had) for a removal. A re-add with the
 * same role, or a removal of someone who is no member, writes no row.
 */
export function memberSql(command: MemberCommand, actor: string = ACTOR): string {
  const by = sqlLiteral(actor);
  switch (command.kind) {
    case 'add': {
      const email = sqlLiteral(command.email);
      const role = sqlLiteral(command.role);
      return (
        `INSERT INTO access_events (actor, action, subject_email, detail_code) SELECT ${by}, 'person_added', ${email}, ${role} ` +
        `WHERE NOT EXISTS (SELECT 1 FROM members WHERE email = ${email}); ` +
        `INSERT INTO access_events (actor, action, subject_email, detail_code) SELECT ${by}, 'grant_changed', email, 'role_' || role || '_to_' || ${role} ` +
        `FROM members WHERE email = ${email} AND role <> ${role}; ` +
        `INSERT INTO members (email, role, name) VALUES (${email}, ${role}, ${sqlLiteral(command.name)}) ` +
        'ON CONFLICT (email) DO UPDATE SET role = excluded.role, name = excluded.name;'
      );
    }
    case 'remove': {
      const email = sqlLiteral(command.email);
      return (
        `INSERT INTO access_events (actor, action, subject_email, detail_code) SELECT ${by}, 'person_disabled', email, role ` +
        `FROM members WHERE email = ${email}; ` +
        `DELETE FROM members WHERE email = ${email};`
      );
    }
    case 'list':
      return 'SELECT email, role, name, added_at FROM members ORDER BY role, email;';
    case 'history': {
      const who = command.email === null ? '' : ` AND subject_email = ${sqlLiteral(command.email)}`;
      return (
        'SELECT ts, actor, action, subject_email, detail_code FROM access_events ' +
        `WHERE room_id IS NULL AND action IN (${MEMBER_EVENTS.map((a) => `'${a}'`).join(', ')})${who} ORDER BY id;`
      );
    }
  }
}

/**
 * The access_events rows for an offboarding: access_removed (detail policies_<n>) when the email left any policy,
 * sessions_ended when Access ended their sessions, and access_sync_failed (detail: the failure's code) for each kind of
 * step that did not happen.
 */
export function offboardSql(actor: string, email: string, result: OffboardResult): string {
  const rows: string[] = [];
  if (result.removedFrom.length > 0) rows.push(eventSql(actor, 'access_removed', email, `policies_${result.removedFrom.length}`));
  if (result.sessionsEnded) rows.push(eventSql(actor, 'sessions_ended', email, null));
  for (const code of result.failures) rows.push(eventSql(actor, 'access_sync_failed', email, code));
  return rows.join(' ');
}

/** Whether wrangler failed only because migration 0012 (deal rooms) is not applied to this database yet. */
export function isMissingRoomsTable(stderr: string): boolean {
  return /no such table: room_members/.test(stderr);
}

/**
 * Who ran the command, for access_events.actor: the email of the Cloudflare login wrangler uses (`wrangler whoami --json`),
 * which is what can write to the room's database, else ACTOR. A login by API token has no email, and --local needs none.
 */
export function actorFromWhoami(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout.slice(Math.max(0, stdout.indexOf('{')))) as { email?: unknown };
    const email = normalizeEmail(typeof parsed.email === 'string' ? parsed.email : undefined);
    return email && !email.includes(':') ? email : ACTOR;
  } catch {
    return ACTOR;
  }
}

/** The Cloudflare account of wrangler's login: CLOUDFLARE_ACCOUNT_ID, else the only account whoami lists, else ''. */
export function accountFromWhoami(stdout: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.CLOUDFLARE_ACCOUNT_ID) return env.CLOUDFLARE_ACCOUNT_ID.trim();
  try {
    const parsed = JSON.parse(stdout.slice(Math.max(0, stdout.indexOf('{')))) as { accounts?: { id?: unknown }[] };
    const ids = (parsed.accounts ?? []).map((a) => a?.id).filter((id): id is string => typeof id === 'string');
    return ids.length === 1 ? ids[0]! : '';
  } catch {
    return '';
  }
}

/** What `remove` prints after the members row is gone, for the two Access steps done by hand. */
export function manualSteps(email: string, tokenSet: boolean): string {
  return (
    `Also remove ${email} from the Access policy and revoke their sessions:\n` +
    'Zero Trust > Access controls > Applications > legallas-web > Policies, then Team & Resources > Users > Revoke.\n' +
    (tokenSet ? '' : `To do both in one step next time, set ${ACCESS_TOKEN_ENV} (web/README.md, "Security model").\n`)
  );
}

/** What `remove` prints after an offboarding through the API. */
export function offboardReport(email: string, result: OffboardResult): string {
  const lines: string[] = [];
  if (result.removedFrom.length > 0) {
    lines.push(`Access: removed ${email} from ${result.removedFrom.map((name) => `"${name}"`).join(', ')}, confirmed by reading each policy back.`);
  }
  if (result.sessionsEnded) lines.push(`Access: ended their sessions in every application.`);
  for (const problem of result.problems) lines.push(`Not done: ${problem}`);
  if (result.problems.length === 0 && result.removedFrom.length === 0) lines.push(`Access: no policy of the room named ${email}.`);
  return `${lines.join('\n')}\n`;
}

function d1(where: string, sql: string): void {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'legallas', where, '--command', sql], { stdio: 'inherit' });
}

/**
 * Removal ends every deal-room invitation too (scripts/room.ts revokeSql), so nobody removed from the install keeps a
 * way in. Run after the members DELETE, which has already taken effect, as its own command: a database without
 * migration 0012 has no invitations to end, and that failure is expected and silent.
 */
function revokeRoomInvitations(email: string, where: string): void {
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'legallas', where, '--command', revokeSql(email, new Date(), null)], {
      stdio: ['ignore', 'inherit', 'pipe'],
      encoding: 'utf8',
    });
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '');
    if (isMissingRoomsTable(stderr)) return;
    process.stderr.write(stderr);
    throw new Error(`Removed from the room, but ending their deal-room invitations failed: run npm run room -- revoke-all ${email}`);
  }
}

/** `wrangler whoami --json`, or '' when it fails (not logged in, offline): the callers fall back. */
function whoami(): string {
  try {
    return execFileSync('npx', ['wrangler', 'whoami', '--json'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
  } catch {
    return '';
  }
}

/** Removes the email from Access with the owner's token, records what happened, and says whether every step was done. */
async function offboardWithToken(token: string, login: string, actor: string, email: string, where: string): Promise<boolean> {
  const result = await offboard(accessApi(token), accountFromWhoami(login), email, roomTargets());
  process.stdout.write(offboardReport(email, result));
  const events = offboardSql(actor, email, result);
  if (events) {
    try {
      d1(where, events);
    } catch {
      process.stderr.write('Recording the Access steps in the audit log failed; the steps above stand as reported.\n');
      return false;
    }
  }
  if (result.problems.length > 0) process.stdout.write(manualSteps(email, true));
  return result.problems.length === 0;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  try {
    const command = parseMemberArgs(args);
    const local = args.includes('--local');
    const where = local ? '--local' : '--remote';
    const writes = command.kind === 'add' || command.kind === 'remove';
    const login = writes && !local ? whoami() : '';
    const actor = login ? actorFromWhoami(login) : ACTOR;
    d1(where, memberSql(command, actor));
    if (command.kind === 'remove') {
      revokeRoomInvitations(command.email, where);
      process.stdout.write('\nRemoved from the room.\n');
      const token = process.env[ACCESS_TOKEN_ENV];
      if (local) process.stdout.write('--local: Cloudflare Access was left alone.\n');
      else if (token) {
        if (!(await offboardWithToken(token, login, actor, command.email, where))) process.exitCode = 1;
      } else process.stdout.write(manualSteps(command.email, false));
    }
    if (command.kind === 'add') {
      process.stdout.write(`\nAdded. Make sure ${command.email} is also on the Access allow-list for legallas-web.\n`);
      process.stdout.write(`Then send them this invitation yourself:\n\n${inviteMessage(readerOfRole(command.role), command.email).replace(/^(?=.)/gm, '  ')}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
