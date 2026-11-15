// SPDX-License-Identifier: Apache-2.0
// Manage deal and matter rooms and who is invited to them (docs/design/rooms-and-grants.md; migration 0012). Like members
// (scripts/member.ts), rooms are managed only from the owner's own machine, never over the web. The room serves a
// guest only while ROOMS_ENABLED is "1" (worker/rooms.ts).
//
//   npm run room -- list [--local]          (then warns of every invitation ending within WARN_DAYS)
//   npm run room -- create <name...> --folder <path> [--folder <path>...] [--local]
//   npm run room -- folder add <room-id> <path> [--local]
//   npm run room -- folder remove <room-id> <path> [--local]
//   npm run room -- invite <room-id> <email> investor [name...] [--days <1-730>] [--local]
//   npm run room -- matter create <name...> --folder <path> [--folder <path>...] [--local]
//   npm run room -- matter invite <room-id> <email> [name...] [--days <1-730>] [--local]
//   npm run room -- revoke <room-id> <email> [--local]
//   npm run room -- revoke-all <email> [--local]
//   npm run room -- archive <room-id> [--local]
//   npm run room -- versions <room-id> on|off [--local]   keep replaced originals while on (worker/sync-rules.ts)
//
// Remote by default (production D1). A revoke cuts the person off at the Worker at their next request. Their email
// also has to be added to, and later removed from, the room's Access policy by hand, as for members: the room holds no
// token that can edit Cloudflare Access.
import { execFileSync } from 'node:child_process';
import { normalizeEmail } from '../worker/email.ts';
import { GUEST_NOTICE } from '../worker/guest-notice.ts';
import { GUEST_CONNECTS, inviteMessage, readerOfRole } from '../worker/invite.ts';
import { sqlLiteral } from '../worker/sql.ts';

/** Mirrors worker/rooms.ts RoomRole: the role `invite` takes, for a deal room. `matter invite` invites counsel. */
export const INVITE_ROLES: ReadonlySet<string> = new Set(['investor']);
/** The one kind of room that serves each guest role (worker/rooms.ts actionsOf). */
const ROOM_KIND = { investor: 'deal', counsel: 'matter' } as const;
/**
 * An invitation's end date when --days is not given. Rounds take 83 days to close on average, 106 at late-stage firms
 * (Gompers et al., in quality-speed/pages/data-room/research/investors.md), so 120 outlasts a normal round (#202).
 */
export const DEFAULT_DAYS = 120;
export const MAX_DAYS = 730;
/** An invitation not used within this many days lapses (worker/rooms.ts). */
export const ACCEPT_DAYS = 14;
/** How many days before an invitation's end date `list` and `invite` warn the owner (rooms-and-grants.md, "Lifecycle"). */
export const WARN_DAYS = 14;
/** room_members.invited_by, revoked_by and access_events.actor for what this script writes. */
export const ACTOR = 'owner-cli';

const USAGE =
  'usage: room list | room create <name> --folder <path> | room folder add|remove <room-id> <path> | ' +
  'room invite <room-id> <email> investor [name] [--days <1-730>] | room matter create <name> --folder <path> | ' +
  'room matter invite <room-id> <email> [name] [--days <1-730>] | room revoke <room-id> <email> | ' +
  'room revoke-all <email> | room archive <room-id> | room versions <room-id> on|off   [--local]';

export type RoomCommand =
  | { kind: 'list' }
  | { kind: 'create'; name: string; folders: string[]; roomKind?: 'matter' }
  | { kind: 'folder'; action: 'add' | 'remove'; roomId: string; folder: string }
  | { kind: 'invite'; roomId: string; email: string; role: 'investor' | 'counsel'; name: string | null; days: number }
  | { kind: 'revoke'; roomId: string; email: string }
  | { kind: 'revoke-all'; email: string }
  | { kind: 'archive'; roomId: string }
  | { kind: 'versions'; roomId: string; on: boolean };

const ROOM_ID = /^[0-9a-f-]{8,64}$/;

/** A room id as migration 0012 allows it, else a usage error. */
function roomId(value: string | undefined): string {
  if (value && ROOM_ID.test(value)) return value;
  throw new Error(`a room id is lowercase hex and dashes (npm run room -- list shows them). ${USAGE}`);
}

/** A normalized email the room and the MCP server can both use (no ':', which the OAuth library forbids). */
function guestEmail(value: string | undefined): string {
  const email = normalizeEmail(value);
  if (email && !email.includes(':')) return email;
  throw new Error(USAGE);
}

/**
 * A room folder as migration 0012's CHECK requires it, or an error saying why not: relative to the synced root, slashes
 * trimmed, no empty, "." or ".." segment, no backslash, never privileged and never counsel's upload folder.
 */
export function normalizeFolder(raw: string | undefined): string {
  const folder = (raw ?? '').normalize('NFC').trim().replace(/^\/+|\/+$/g, '');
  if (!folder) throw new Error('a room folder cannot be the whole record: name a folder inside it');
  if (folder.length > 1024) throw new Error('that folder path is too long');
  const segments = folder.split('/');
  if (folder.includes('\\') || segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error('a room folder is a plain path such as "Deals/Seed round": no empty, "." or ".." parts and no backslash');
  }
  if (/privileged/i.test(folder)) throw new Error('a privileged folder can never be in a room');
  if (segments[0] === 'from-counsel') throw new Error("counsel's upload folder can never be in a room");
  return folder;
}

function flagValues(args: string[], flag: string): { values: string[]; rest: string[] } {
  const values: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value. ${USAGE}`);
      values.push(value);
      i++;
    } else {
      rest.push(args[i]!);
    }
  }
  return { values, rest };
}

/** create and matter create: a name and at least one folder. */
function parseCreate(args: string[]): { name: string; folders: string[] } {
  const { values, rest } = flagValues(args, '--folder');
  const name = rest.join(' ').trim();
  if (!name || name.length > 120 || values.length === 0) throw new Error(USAGE);
  return { name, folders: [...new Set(values.map(normalizeFolder))] };
}

/**
 * invite (a deal room's investor: the role word is required) and matter invite (a matter room's counsel: no role word).
 * Then the room, the email, an optional name and --days.
 */
function parseInvite(args: string[], matter: boolean): Extract<RoomCommand, { kind: 'invite' }> {
  const { values, rest } = flagValues(args, '--days');
  const [rawRoom, rawEmail, ...more] = rest;
  let words = more;
  if (!matter) {
    if (!more[0] || !INVITE_ROLES.has(more[0])) {
      throw new Error(`invite takes the investor role only; invite counsel to a matter room with room matter invite. ${USAGE}`);
    }
    words = more.slice(1);
  }
  const days = values.length === 0 ? DEFAULT_DAYS : Number(values.at(-1));
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new Error(`--days is a whole number from 1 to ${MAX_DAYS}. ${USAGE}`);
  const name = words.join(' ').trim();
  if (name.length > 120) throw new Error(USAGE);
  return { kind: 'invite', roomId: roomId(rawRoom), email: guestEmail(rawEmail), role: matter ? 'counsel' : 'investor', name: name || null, days };
}

/** Parses argv (without node and script path). Throws a usage message on bad input. */
export function parseRoomArgs(argv: string[]): RoomCommand {
  const args = argv.filter((arg) => arg !== '--local');
  const [verb] = args;
  if (verb === 'list' && args.length === 1) return { kind: 'list' };
  if (verb === 'create') return { kind: 'create', ...parseCreate(args.slice(1)) };
  if (verb === 'matter' && args[1] === 'create') return { kind: 'create', ...parseCreate(args.slice(2)), roomKind: 'matter' };
  if (verb === 'folder' && (args[1] === 'add' || args[1] === 'remove') && args.length === 4) {
    return { kind: 'folder', action: args[1], roomId: roomId(args[2]), folder: normalizeFolder(args[3]) };
  }
  if (verb === 'invite') return parseInvite(args.slice(1), false);
  if (verb === 'matter' && args[1] === 'invite') return parseInvite(args.slice(2), true);
  if (verb === 'revoke' && args.length === 3) return { kind: 'revoke', roomId: roomId(args[1]), email: guestEmail(args[2]) };
  if (verb === 'revoke-all' && args.length === 2) return { kind: 'revoke-all', email: guestEmail(args[1]) };
  if (verb === 'archive' && args.length === 2) return { kind: 'archive', roomId: roomId(args[1]) };
  if (verb === 'versions' && args.length === 3 && (args[2] === 'on' || args[2] === 'off')) return { kind: 'versions', roomId: roomId(args[1]), on: args[2] === 'on' };
  throw new Error(USAGE);
}

const DAY_MS = 86_400_000;
const at = (now: Date, days = 0) => sqlLiteral(new Date(now.getTime() + days * DAY_MS).toISOString());
const event = (action: string, room: string, grant = 'NULL', subject = 'NULL') =>
  `INSERT INTO access_events (actor, action, room_id, grant_id, subject_email) VALUES (${sqlLiteral(ACTOR)}, '${action}', ${room}, ${grant}, ${subject});`;

/**
 * Revokes every live invitation of `email` (in one room, or in all), with one grant_revoked event for each invitation
 * this statement revoked and none for any other. `now` marks the rows, so the events find exactly them.
 */
export function revokeSql(email: string, now: Date, roomIdOrAll: string | null): string {
  const ts = at(now);
  const room = roomIdOrAll === null ? '' : ` AND room_id = ${sqlLiteral(roomIdOrAll)}`;
  return (
    `UPDATE room_members SET revoked_at = ${ts}, revoked_by = ${sqlLiteral(ACTOR)} WHERE email = ${sqlLiteral(email)}${room} AND revoked_at IS NULL; ` +
    `INSERT INTO access_events (actor, action, room_id, grant_id, subject_email) SELECT ${sqlLiteral(ACTOR)}, 'grant_revoked', room_id, id, email ` +
    `FROM room_members WHERE email = ${sqlLiteral(email)}${room} AND revoked_at = ${ts} AND revoked_by = ${sqlLiteral(ACTOR)};`
  );
}

/** What the database says before an invitation is written (inviteSql). */
export interface InviteState {
  isMember: boolean;
  roomLive: boolean;
  liveGrant: { id: string; joined: boolean } | null;
}

/** The read inviteSql needs, as one row: is_member, room_live, grant_id, joined. */
export function inviteStateSql(command: Extract<RoomCommand, { kind: 'invite' }>): string {
  const email = sqlLiteral(command.email);
  const room = sqlLiteral(command.roomId);
  return (
    `SELECT EXISTS (SELECT 1 FROM members WHERE email = ${email}) AS is_member, ` +
    `EXISTS (SELECT 1 FROM rooms WHERE id = ${room} AND archived_at IS NULL AND kind = '${ROOM_KIND[command.role]}') AS room_live, ` +
    `(SELECT id FROM room_members WHERE room_id = ${room} AND email = ${email} AND revoked_at IS NULL) AS grant_id, ` +
    `(SELECT joined_at IS NOT NULL FROM room_members WHERE room_id = ${room} AND email = ${email} AND revoked_at IS NULL) AS joined;`
  );
}

/**
 * The invitation: a new row (invite_created), or new terms on the live one (grant_changed), which keeps its first use.
 * Refuses a member of the install, who already sees every room's folders, and a room that is missing, archived or of the
 * other kind (an investor goes to a deal room, counsel to a matter room).
 */
export function inviteSql(command: Extract<RoomCommand, { kind: 'invite' }>, state: InviteState, now: Date, newId: string): string {
  if (state.isMember) throw new Error(`${command.email} is a member of the install and already sees every room's folders.`);
  if (!state.roomLive) throw new Error(`no such room, or it is archived, or it is not a ${ROOM_KIND[command.role]} room (npm run room -- list)`);
  const room = sqlLiteral(command.roomId);
  const email = sqlLiteral(command.email);
  const terms = { role: sqlLiteral(command.role), name: sqlLiteral(command.name), expires: at(now, command.days), acceptBy: at(now, ACCEPT_DAYS) };
  if (state.liveGrant) {
    const grant = sqlLiteral(state.liveGrant.id);
    const window = state.liveGrant.joined ? '' : `, accept_by = ${terms.acceptBy}, invited_at = ${at(now)}`;
    return (
      `UPDATE room_members SET role = ${terms.role}, name = ${terms.name}, expires_at = ${terms.expires}${window} ` +
      `WHERE id = ${grant} AND revoked_at IS NULL; ${event('grant_changed', room, grant, email)}`
    );
  }
  const grant = sqlLiteral(newId);
  return (
    'INSERT INTO room_members (id, room_id, email, role, name, invited_by, invited_at, accept_by, expires_at) VALUES ' +
    `(${grant}, ${room}, ${email}, ${terms.role}, ${terms.name}, ${sqlLiteral(ACTOR)}, ${at(now)}, ${terms.acceptBy}, ${terms.expires}); ` +
    event('invite_created', room, grant, email)
  );
}

/** The SQL for every command but invite, which needs its state first. `ids` gives fresh random ids. */
export function roomSql(command: Exclude<RoomCommand, { kind: 'invite' }>, now: Date, ids: () => string = () => crypto.randomUUID()): string {
  switch (command.kind) {
    case 'list':
      return (
        "SELECT r.id, r.name, r.kind, r.archived_at, 'folder' AS what, f.folder AS who, NULL AS role, NULL AS until FROM rooms r JOIN room_folders f ON f.room_id = r.id AND f.removed_at IS NULL " +
        "UNION ALL SELECT r.id, r.name, r.kind, r.archived_at, 'invited', g.email, g.role, g.expires_at FROM rooms r JOIN room_members g ON g.room_id = r.id AND g.revoked_at IS NULL " +
        'ORDER BY 2, 1, 5, 6;'
      );
    case 'create': {
      const room = sqlLiteral(ids());
      const folders = command.folders.map(
        (folder) => `INSERT INTO room_folders (id, room_id, folder, added_by) VALUES (${sqlLiteral(ids())}, ${room}, ${sqlLiteral(folder)}, ${sqlLiteral(ACTOR)});`,
      );
      const kind = sqlLiteral(command.roomKind ?? 'deal');
      return [`INSERT INTO rooms (id, kind, name, created_by) VALUES (${room}, ${kind}, ${sqlLiteral(command.name)}, ${sqlLiteral(ACTOR)});`, event('room_created', room), ...folders, event('content_added', room)].join(' ');
    }
    case 'folder': {
      const room = sqlLiteral(command.roomId);
      const folder = sqlLiteral(command.folder);
      if (command.action === 'add') {
        return (
          `INSERT INTO room_folders (id, room_id, folder, added_by) SELECT ${sqlLiteral(ids())}, id, ${folder}, ${sqlLiteral(ACTOR)} FROM rooms WHERE id = ${room} AND archived_at IS NULL; ` +
          event('content_added', room)
        );
      }
      return (
        `UPDATE room_folders SET removed_at = ${at(now)}, removed_by = ${sqlLiteral(ACTOR)} WHERE room_id = ${room} AND folder = ${folder} AND removed_at IS NULL; ` +
        event('content_removed', room)
      );
    }
    case 'revoke':
      return revokeSql(command.email, now, command.roomId);
    case 'revoke-all':
      return revokeSql(command.email, now, null);
    case 'versions': {
      // Only a live deal room, and only a real change, writes the setting and its event.
      const room = sqlLiteral(command.roomId);
      const [value, was, code] = command.on ? [at(now), 'IS NULL', 'version_history_on'] : ['NULL', 'IS NOT NULL', 'version_history_off'];
      return (
        `UPDATE rooms SET version_history_at = ${value} WHERE id = ${room} AND kind = 'deal' AND archived_at IS NULL AND version_history_at ${was}; ` +
        `INSERT INTO access_events (actor, action, room_id, detail_code) SELECT ${sqlLiteral(ACTOR)}, 'room_settings_changed', id, '${code}' ` +
        'FROM rooms WHERE changes() > 0 AND id = ' + room + ';'
      );
    }
    case 'archive': {
      const room = sqlLiteral(command.roomId);
      return (
        `UPDATE rooms SET archived_at = ${at(now)} WHERE id = ${room} AND archived_at IS NULL; ${event('room_archived', room)} ` +
        `UPDATE room_members SET revoked_at = ${at(now)}, revoked_by = ${sqlLiteral(ACTOR)} WHERE room_id = ${room} AND revoked_at IS NULL;`
      );
    }
  }
}

/** An active invitation (worker/rooms.ts ACTIVE_SQL) that ends within WARN_DAYS, as endingSoonSql reads it. */
export interface EndingSoon {
  room_id: string;
  room_name: string;
  email: string;
  role: string;
  expires_at: string;
}

/**
 * Every invitation still active at `now` (worker/rooms.ts ACTIVE_SQL: not revoked, used or inside its accept window,
 * on a live deal or matter room) whose end date falls within WARN_DAYS, soonest first. Read from the dates, like
 * access itself, so it needs no job and no stored status.
 */
export function endingSoonSql(now: Date): string {
  return (
    'SELECT r.id AS room_id, r.name AS room_name, g.email, g.role, g.expires_at FROM room_members g JOIN rooms r ON r.id = g.room_id ' +
    `WHERE g.revoked_at IS NULL AND g.expires_at > ${at(now)} AND g.expires_at <= ${at(now, WARN_DAYS)} ` +
    `AND (g.joined_at IS NOT NULL OR g.accept_by > ${at(now)}) AND r.archived_at IS NULL AND r.kind IN ('deal', 'matter') ` +
    'ORDER BY g.expires_at, r.name, g.email;'
  );
}

/** The owner's warning for endingSoonSql's rows, with the command that extends each; empty when there are none. */
export function endingSoonNotice(rows: readonly EndingSoon[], now: Date): string {
  if (rows.length === 0) return '';
  const lines = rows.map((row) => {
    const days = Math.ceil((Date.parse(row.expires_at) - now.getTime()) / DAY_MS);
    const extend = row.role === 'counsel' ? `matter invite ${row.room_id} ${row.email}` : `invite ${row.room_id} ${row.email} investor`;
    return `  ${row.email} in ${row.room_name}: ends ${row.expires_at.slice(0, 10)}, in ${days} day${days === 1 ? '' : 's'}. ` +
      `To extend (days count from today): npm run room -- ${extend} --days <1-${MAX_DAYS}>`;
  });
  return `\n${rows.length === 1 ? 'An invitation ends' : `${rows.length} invitations end`} within ${WARN_DAYS} days:\n${lines.join('\n')}\n`;
}

/** Runs one statement list with wrangler; `json` returns the first result set's rows instead of printing them. */
export function d1(sql: string, where: '--local' | '--remote', json = false): Record<string, unknown>[] {
  const args = ['wrangler', 'd1', 'execute', 'legallas', where, '--command', sql, ...(json ? ['--json'] : [])];
  if (!json) {
    execFileSync('npx', args, { stdio: 'inherit' });
    return [];
  }
  const out = JSON.parse(execFileSync('npx', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })) as { results?: Record<string, unknown>[] }[];
  return out[0]?.results ?? [];
}

/**
 * What the owner is told after an invite, then the invitation to send: its one link opens Connect your AI for the role
 * (worker/invite.ts), or the room for a role that may not connect yet. An investor's carries the confidentiality
 * notice, as the guest page does (routes/rooms.ts).
 */
export const ACCESS_ADD = (email: string, role: 'investor' | 'counsel') =>
  `\nInvited. Add ${email} to the room's Access policy too, or Access will not send them a code:\n` +
  'Zero Trust > Access controls > Applications > the room > Policies. Then send them this invitation yourself:\n\n' +
  `${indent(inviteMessage(readerOfRole(role), email, { notice: role === 'investor' ? GUEST_NOTICE : undefined, connect: GUEST_CONNECTS[role] }))}\n`;

/** Two spaces before each line, so the invitation stands apart in the terminal. */
const indent = (text: string) => text.replace(/^(?=.)/gm, '  ');
const ACCESS_REMOVE = (email: string) =>
  `\nRevoked: the room refuses ${email} from their next request. If they hold no other invitation, also remove them\n` +
  'from the Access policy and revoke their sessions: Zero Trust > Access controls > Applications > the room > Policies,\n' +
  'then Users > Revoke sessions.\n';

/**
 * Cloudflare Zero Trust Free covers 50 users; past that every user costs $7 a month (rooms-and-grants.md, "Sign-in").
 * A seat is used by each person who signs in, so the count is the distinct people who can: members and every live
 * invitation. The owner is warned from SEAT_WARN on.
 */
export const FREE_SEATS = 50;
export const SEAT_WARN = 45;

/**
 * One row, `seats`: the distinct emails of every member and every invitation not revoked, not yet ended, and accepted or
 * still inside its accept window (worker/rooms.ts ACTIVE_SQL, as endingSoonSql reads it).
 */
export function seatsSql(now: Date): string {
  return (
    'SELECT COUNT(*) AS seats FROM (SELECT email FROM members UNION ' +
    `SELECT email FROM room_members WHERE revoked_at IS NULL AND expires_at > ${at(now)} ` +
    `AND (joined_at IS NOT NULL OR accept_by > ${at(now)}));`
  );
}

/** The owner's warning for `seats` people who can sign in; empty below SEAT_WARN. */
export function seatNotice(seats: number): string {
  if (seats < SEAT_WARN) return '';
  const where = seats > FREE_SEATS ? `That is past the ${FREE_SEATS} free Cloudflare Zero Trust seats` : `The free Cloudflare Zero Trust plan covers ${FREE_SEATS}`;
  return (
    `\n${seats} people can now sign in to this room. ${where}; each person past ${FREE_SEATS} who signs in costs $7 a month.\n` +
    'Revoke invitations you no longer need: npm run room -- revoke <room-id> <email>\n'
  );
}

/** Prints endingSoonNotice after list and invite. A failed check never reads as a failed command: that already ran. */
function warnEndingSoon(where: '--local' | '--remote', now: Date): void {
  try {
    process.stdout.write(endingSoonNotice(d1(endingSoonSql(now), where, true) as unknown as EndingSoon[], now));
  } catch (error) {
    process.stderr.write(`\nCould not check which invitations end soon (${error instanceof Error ? error.name : 'unknown'}). Run npm run room -- list to see.\n`);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  try {
    const command = parseRoomArgs(args);
    const where = args.includes('--local') ? '--local' : '--remote';
    const now = new Date();
    if (command.kind === 'invite') {
      const row = d1(inviteStateSql(command), where, true)[0] ?? {};
      const state: InviteState = {
        isMember: row.is_member === 1,
        roomLive: row.room_live === 1,
        liveGrant: typeof row.grant_id === 'string' ? { id: row.grant_id, joined: row.joined === 1 } : null,
      };
      d1(inviteSql(command, state, now, crypto.randomUUID()), where);
      process.stdout.write(ACCESS_ADD(command.email, command.role));
      warnEndingSoon(where, now);
      try {
        process.stdout.write(seatNotice(Number(d1(seatsSql(now), where, true)[0]?.seats ?? 0)));
      } catch {
        process.stderr.write('\nCould not count the seats in use. Run npm run room -- list to see who is invited.\n');
      }
    } else {
      const made: string[] = [];
      d1(roomSql(command, now, () => (made.push(crypto.randomUUID()), made.at(-1)!)), where);
      if (command.kind === 'revoke' || command.kind === 'revoke-all') process.stdout.write(ACCESS_REMOVE(command.email));
      if (command.kind === 'list') warnEndingSoon(where, now);
      if (command.kind === 'create') {
        const how = command.roomKind === 'matter' ? `matter invite ${made[0]} <email>` : `invite ${made[0]} <email> investor`;
        process.stdout.write(`\nCreated room ${made[0]}. Invite people with npm run room -- ${how}\n`);
      }
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
