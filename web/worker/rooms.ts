// SPDX-License-Identifier: Apache-2.0
// Deal and matter rooms (docs/design/rooms-and-grants.md; migration 0012). One install holds many rooms. A room is a
// view over the record: it shows the live documents under its folders and copies nothing. A guest is someone invited
// to a room (room_members) who is not a member of the install (members): the founder's investors, a group's members
// invited to the deals they need, or outside counsel invited to one matter. Members keep the whole record, as today.
//
// Off unless ROOMS_ENABLED is "1": then, and only then, the gate (room.ts) lets a guest in, and only to the guest
// routes (routes/rooms.ts). A guest never reaches a member route or the room's static pages (their build carries the
// room's settings: banner, control prefix, regulator name). Guest roles are their own type and matrix, never auth.ts
// Role or PERMISSIONS, so no member route can be handed a guest by mistake. A role with `connect` (a deal room's
// investor) may also connect their own AI app to the remote MCP server (on with ROOMS_ENABLED on that Worker too): it
// reads the same rule over every room the guest may connect in, through privilege.ts's guest scope (findAiGuest,
// guestScopeFor).
//
// What a guest sees, in one rule (VISIBLE_SQL, privilege.ts guestVisibleSql): a live mirrored document, not a room data
// file or a folder guide (it instructs counsel and their AI, and is no part of the record), under one of the room's
// live folders, with no "privileged" anywhere in its path; then, in code, never one the matter manifest marks
// privileged. A role that may viewPrivileged (counsel in a matter room) gets the same rule less both privilege steps
// (VISIBLE_PRIVILEGED_SQL). Nothing is cached: every request and every tool call re-reads the guest's invitations, so a
// revoke, an expiry or an archived room ends access at the next one.
import { isAgentFile } from './agent-files.ts';
import { guestRoomSql, guestVisibleSql, isPrivilegedPath, type GuestScope } from './privilege.ts';
import { loadDocFacts } from './doc-facts-serve.ts';
import type { Env } from './env.ts';

/** The one switch. Anything but "1", unset included, keeps a single-room install exactly as it was. */
export function roomsEnabled(env: Pick<Env, 'ROOMS_ENABLED'>): boolean {
  return env.ROOMS_ENABLED === '1';
}

/** A deal room's guest roles. room_members' CHECK lists 'counsel' and 'viewer' too; a deal room serves neither. */
export type RoomRole = 'investor';

/** A matter room's guest role: outside counsel invited to one matter, not to the whole record. */
export type MatterRole = 'counsel';

/** Every guest role the code serves, each in one kind of room only. */
export type GuestRole = RoomRole | MatterRole;

/** The room kinds that serve guests. rooms.kind also allows 'company', which serves none. */
export type RoomKind = 'deal' | 'matter';

/**
 * Everything a guest can try to do in a room. `viewPrivileged` sees privileged documents in the room's folders; `connect`
 * links their own AI app. Anything else (upload, Ask, resolve) is refused.
 */
export type RoomAction = 'view' | 'viewPrivileged' | 'download' | 'readComments' | 'comment' | 'connect';

/**
 * Who may do what, by room kind, then role. A role in the other kind of room is no access: counsel invited to a deal
 * room, or an investor to a matter room, gets nothing. Investor: read what the room shows inline, read and write their
 * own comment threads, and connect their own AI app to read the same (on by default, the owner 2026-11-06); never a
 * privileged document. Counsel in a matter room: view, privileged documents included (the owner, 2026-11-05: founder and
 * counsel see everything), comment and download, no AI app yet.
 */
const GUEST_ACTIONS: Readonly<Record<RoomKind, Readonly<Record<string, readonly RoomAction[]>>>> = {
  deal: { investor: ['view', 'readComments', 'comment', 'connect'] },
  matter: { counsel: ['view', 'viewPrivileged', 'download', 'readComments', 'comment'] },
};

/** What `role` may do in a room of `kind`, in matrix order; empty for a kind or role the code does not serve. Own keys only. */
export function actionsOf(kind: string, role: string): readonly RoomAction[] {
  if (!Object.hasOwn(GUEST_ACTIONS, kind)) return [];
  const roles = GUEST_ACTIONS[kind as RoomKind];
  return Object.hasOwn(roles, role) ? roles[role]! : [];
}

/**
 * The one guest role a room of `kind` serves (each role is served in one kind only), or null. The owner's preview and
 * as-of reads show a room as that role sees it.
 */
export function servedRole(kind: string): GuestRole | null {
  if (!Object.hasOwn(GUEST_ACTIONS, kind)) return null;
  const [role] = Object.keys(GUEST_ACTIONS[kind as RoomKind]);
  return (role as GuestRole | undefined) ?? null;
}

/** The guest matrix. Fails closed: an unknown kind, role or action, prototype names included, is never allowed. */
export function canGuest(kind: string, role: string, action: string): boolean {
  return (actionsOf(kind, role) as readonly string[]).includes(action);
}

/** Whether `value` is a deal room's guest role. Own keys only, so "constructor" is not. */
export function isRoomRole(value: unknown): value is RoomRole {
  return typeof value === 'string' && actionsOf('deal', value).length > 0;
}

/** A deal room's matrix. Fails closed like canGuest. */
export function canInRoom(role: RoomRole, action: string): boolean {
  return canGuest('deal', role, action);
}

/** One room a guest is in, from an active invitation. */
export interface GuestRoom {
  id: string;
  name: string;
  kind: RoomKind;
  role: GuestRole;
  grantId: string;
  expiresAt: string;
  /** False until the guest's first signed-in request uses the invitation (markJoined). */
  joined: boolean;
}

/** A signed-in guest: the verified email and the rooms their active invitations open. */
export interface RoomGuest {
  email: string;
  rooms: GuestRoom[];
}

/**
 * An invitation is active when it is not revoked, its end date is ahead, it has been used or is still inside its
 * accept window, and its room is a deal or matter room that is not archived. `now` is its parameter, an ISO instant. Whether the
 * room's kind serves the invitation's role is checked in code (actionsOf).
 */
const activeSql = (now: string) =>
  `g.revoked_at IS NULL AND g.expires_at > ${now} AND (g.joined_at IS NOT NULL OR g.accept_by > ${now}) AND r.archived_at IS NULL AND r.kind IN ('deal', 'matter')`;

interface GrantRow {
  grant_id: string;
  role: string;
  expires_at: string;
  joined_at: string | null;
  room_id: string;
  name: string;
  kind: string;
}

/**
 * The guest behind a verified email, or null: no active invitation with a role the code serves. Called only after
 * findMember found no member, and only while roomsEnabled. Read fresh on every request.
 */
export async function findRoomGuest(db: D1Database, email: string, now: Date): Promise<RoomGuest | null> {
  const { results } = await db
    .prepare(
      'SELECT g.id AS grant_id, g.role, g.expires_at, g.joined_at, r.id AS room_id, r.name, r.kind ' +
        `FROM room_members g JOIN rooms r ON r.id = g.room_id WHERE g.email = ?1 AND ${activeSql('?2')} ORDER BY r.name, r.id`,
    )
    .bind(email, now.toISOString())
    .all<GrantRow>();
  const rooms: GuestRoom[] = [];
  for (const row of results) {
    if (actionsOf(row.kind, row.role).length === 0) continue;
    rooms.push({
      id: row.room_id,
      name: row.name,
      kind: row.kind as RoomKind,
      role: row.role as GuestRole,
      grantId: row.grant_id,
      expiresAt: row.expires_at,
      joined: row.joined_at !== null,
    });
  }
  return rooms.length > 0 ? { email, rooms } : null;
}

/**
 * The guest behind a verified email as their AI app reads: only the rooms whose role may `connect`, or null. Null while
 * ROOMS_ENABLED is off on this Worker, so rooms off means no guest AI anywhere. Called only after findMember found no
 * member. Read fresh on every /authorize and every tool call.
 */
export async function findAiGuest(env: { DB: D1Database; ROOMS_ENABLED?: string }, email: string, now: Date): Promise<RoomGuest | null> {
  if (!roomsEnabled(env)) return null;
  const guest = await findRoomGuest(env.DB, email, now);
  const rooms = guest?.rooms.filter((room) => canGuest(room.kind, room.role, 'connect')) ?? [];
  return rooms.length > 0 ? { email, rooms } : null;
}

/** Every email with an active invitation whose role may `connect`: the daily sweep keeps their AI grants (mcp/sweep.ts). */
export async function aiGuestEmails(db: D1Database, now: Date): Promise<Set<string>> {
  const { results } = await db
    .prepare(`SELECT g.email, g.role, r.kind FROM room_members g JOIN rooms r ON r.id = g.room_id WHERE ${activeSql('?1')}`)
    .bind(now.toISOString())
    .all<{ email: string; role: string; kind: string }>();
  return new Set(results.filter((row) => canGuest(row.kind, row.role, 'connect')).map((row) => row.email));
}

/**
 * What a guest's AI may read for one tool call (privilege.ts withGuestScope): its rooms, their live folders and the
 * manifest's privileged marks. Throws PrivilegeMarksUnavailable when the manifest exists but cannot be read. It reads
 * the rule without privileged documents in every room: no role that may connect may viewPrivileged (rooms-matter.test.ts).
 */
export async function guestScopeFor(env: Pick<Env, 'DB' | 'FILES'>, guest: RoomGuest, now: Date): Promise<GuestScope> {
  const rooms = guest.rooms.map((room) => room.id);
  const marks = await privilegedMarks(env, now);
  const folders = (await Promise.all(rooms.map((id) => listRoomFolders(env.DB, id)))).flat();
  return { rooms, folders, marks };
}

/**
 * Records the first use of each invitation the guest has not used yet (joined_at, and an invite_accepted event), so
 * the accept window no longer applies. Only an invitation still active at this instant is marked.
 */
export async function markJoined(db: D1Database, guest: RoomGuest, now: Date): Promise<void> {
  const at = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const room of guest.rooms.filter((r) => !r.joined)) {
    statements.push(
      db
        .prepare(
          "INSERT INTO access_events (actor, action, room_id, grant_id, subject_email) SELECT ?1, 'invite_accepted', room_id, id, email " +
            'FROM room_members WHERE id = ?2 AND joined_at IS NULL AND revoked_at IS NULL AND accept_by > ?3 AND expires_at > ?3',
        )
        .bind(guest.email, room.grantId, at),
      db
        .prepare('UPDATE room_members SET joined_at = ?2 WHERE id = ?1 AND joined_at IS NULL AND revoked_at IS NULL AND accept_by > ?2 AND expires_at > ?2')
        .bind(room.grantId, at),
    );
  }
  if (statements.length > 0) await db.batch(statements);
}

/**
 * What a guest may see in room ?1, as conditions on documents aliased d (privilege.ts guestVisibleSql, which a guest's
 * AI uses over all its rooms). The privilege rule is privilege.ts's. Counsel uploads never show: they are not mirrored,
 * and their folder cannot be a room's (migration 0012).
 */
export const VISIBLE_SQL = guestVisibleSql('= ?1');

/**
 * VISIBLE_SQL for a role that may viewPrivileged: the same room rule, privileged paths included. A privileged folder
 * still cannot be a room's own folder (migration 0012), so these are privileged documents under the folders it shares.
 */
export const VISIBLE_PRIVILEGED_SQL = guestRoomSql('= ?1');

/** A room as one guest role reads it: the room, and the kind and role whose matrix decides what it shows. */
export interface RoomView {
  id: string;
  kind: string;
  role: string;
}

/** A document as a guest's routes read it. r2_key is read to fetch bytes and never returned. */
export interface RoomDocumentRow {
  id: string;
  path: string;
  folder: string;
  name: string;
  kind: string;
  content_type: string;
  size: number;
  pages: number | null;
  updated_at: string;
  source: string;
  r2_key: string;
}

const COLUMNS = 'd.id, d.path, d.folder, d.name, d.kind, d.content_type, d.size, d.pages, d.updated_at, d.source, d.r2_key';

/** Thrown when the matter manifest exists but cannot be read: a guest then sees no document at all (fail closed). */
export class PrivilegeMarksUnavailable extends Error {
  override name = 'PrivilegeMarksUnavailable';
}

/**
 * Lowercase ids of the documents the matter manifest marks privileged; empty with no FILES binding or no manifest.
 * A manifest that exists but does not parse throws PrivilegeMarksUnavailable, because the marks it holds are unknown.
 */
export async function privilegedMarks(env: Pick<Env, 'FILES'>, now: Date): Promise<ReadonlySet<string>> {
  if (!env.FILES) return new Set();
  let facts;
  try {
    facts = await loadDocFacts(env.FILES, now);
  } catch (error) {
    // The error name only: a manifest error message can quote a value.
    console.error('rooms_marks_unavailable', error instanceof Error ? error.name : 'unknown');
    throw new PrivilegeMarksUnavailable();
  }
  if (!facts) return new Set();
  return new Set(Object.entries(facts.docs).filter(([, doc]) => doc.privileged).map(([id]) => id.toLowerCase()));
}

type Seen = (row: Pick<RoomDocumentRow, 'id' | 'path'>) => boolean;

/**
 * The room rule for `room`'s role, and the check in code each row passes once more: the SQL's folder guide rule, and for
 * a role that may not viewPrivileged, its privilege rule and the manifest's marks, which only code can apply. Marks are
 * read only for a role they hide documents from, so unreadable marks never stop counsel.
 */
async function ruleFor(env: Pick<Env, 'FILES'>, room: RoomView, now: Date): Promise<{ sql: string; seen: Seen }> {
  if (canGuest(room.kind, room.role, 'viewPrivileged')) return { sql: VISIBLE_PRIVILEGED_SQL, seen: (row) => !isAgentFile(row.path) };
  const marks = await privilegedMarks(env, now);
  return { sql: VISIBLE_SQL, seen: (row) => !isPrivilegedPath(row.path) && !isAgentFile(row.path) && !marks.has(row.id.toLowerCase()) };
}

/** Every document the room shows a guest with `room`'s role, by path. */
export async function listRoomDocuments(env: Pick<Env, 'DB' | 'FILES'>, room: RoomView, now: Date): Promise<RoomDocumentRow[]> {
  const rule = await ruleFor(env, room, now);
  const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM documents d WHERE ${rule.sql} ORDER BY d.path`)
    .bind(room.id)
    .all<RoomDocumentRow>();
  return results.filter(rule.seen);
}

/** A room's live folders, as the owner shared them, sorted. A folder with no documents is still listed. */
export async function listRoomFolders(db: D1Database, roomId: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT folder FROM room_folders WHERE room_id = ?1 AND removed_at IS NULL ORDER BY folder').bind(roomId).all<{ folder: string }>();
  return results.map((row) => row.folder);
}

/**
 * One document the room shows a guest with `room`'s role, or null: missing, removed, outside the room or privileged for
 * a role that may not see it all read the same.
 */
export async function findRoomDocument(env: Pick<Env, 'DB' | 'FILES'>, room: RoomView, documentId: string, now: Date): Promise<RoomDocumentRow | null> {
  const rule = await ruleFor(env, room, now);
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM documents d WHERE d.id = ?2 AND ${rule.sql}`)
    .bind(room.id, documentId)
    .first<RoomDocumentRow>();
  return row && rule.seen(row) ? row : null;
}

/** One comment as a guest reads it: never an author's email or name, only whether it is the guest's own. */
export interface GuestComment {
  id: string;
  parent_id: string | null;
  page: number | null;
  body: string;
  created_at: string;
  mine: boolean;
  resolved: boolean;
}

/** Newest comments returned per thread list, as worker/comments.ts MAX_THREAD. */
const MAX_GUEST_THREAD = 1000;

/**
 * The guest's own threads on a document in a room, oldest first: top-level comments the guest wrote in this room and
 * the replies written in this room under them. Never a member's comment (counsel's may be privileged advice), another
 * guest's, or one written in another room. The caller checks the document is visible first.
 */
export async function listGuestThreads(db: D1Database, roomId: string, documentId: string, email: string): Promise<GuestComment[]> {
  const { results } = await db
    .prepare(
      'SELECT c.id, c.parent_id, c.page, c.body, c.created_at, c.author_email = ?3 AS mine, t.resolved_at IS NOT NULL AS resolved ' +
        'FROM comments c JOIN comments t ON t.id = COALESCE(c.parent_id, c.id) ' +
        'WHERE c.document_id = ?2 AND c.room_id = ?1 AND t.room_id = ?1 AND t.author_email = ?3 ' +
        'ORDER BY c.created_at DESC, c.rowid DESC LIMIT ?4',
    )
    .bind(roomId, documentId, email, MAX_GUEST_THREAD)
    .all<Omit<GuestComment, 'mine' | 'resolved'> & { mine: number; resolved: number }>();
  return results.reverse().map((row) => ({ ...row, mine: row.mine === 1, resolved: row.resolved === 1 }));
}

/** Whether parentId is a top-level comment the guest wrote on this document in this room. */
export async function validGuestParent(db: D1Database, roomId: string, documentId: string, email: string, parentId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM comments WHERE id = ?1 AND document_id = ?2 AND room_id = ?3 AND author_email = ?4 AND parent_id IS NULL')
    .bind(parentId, documentId, roomId, email)
    .first();
  return row !== null;
}
