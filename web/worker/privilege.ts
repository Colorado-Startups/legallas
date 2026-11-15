// SPDX-License-Identifier: Apache-2.0
// Privileged folders: only a role with viewPrivileged sees them. Owner and counsel both have it, and so does counsel
// invited to a matter room as a guest (rooms.ts guest matrix, guestRoomSql). The read-only family role that lacked it
// was retired (2026-10-20), but the rule stays and fails closed: a role the code does not know is filtered, because
// canPerform allows it nothing. A document is privileged here when any segment of its path (a
// folder or the file name) contains "privileged" in any case, the same reading of a privileged path segment the index
// uses (scripts/extract.ts isPrivilegedOffice). Counsel's notes and attorney-client mail sit in such folders,
// and showing them to people outside the privilege risks waiving it.
//
// Every route that lists, opens, retrieves or cites a document applies this one rule: /api/documents, /api/uploads,
// /api/visuals, /api/doc/:id, /files/:id, Ask's retrieval and case picture, /api/matter and the legallas-mcp tools. A
// refused document answers exactly like a missing one (404 or not_found), so its existence is not confirmed.
//
// One rule in two forms: isPrivilegedPath for a path in hand, privilegeFilter for queries. privilege.test.ts runs
// both over the same paths on real SQLite, so they cannot drift apart.
//
// A room guest's connected AI reads with a role of its own for each tool call (withGuestScope, from mcp/server.ts
// runTool), which the tools pass to every query as they pass any role. For it the same rule is a guest's room rule
// (guestVisibleSql, which rooms.ts's guest routes use too) over its rooms, less the matter manifest's privileged marks:
// every tool query is cut to the guest's rooms without the tools knowing. A reader role with no live call, or a scope
// that cannot be put in SQL safely, shows nothing. No Node built-ins, so every Worker route can import this file.
import { isAgentFile, NOT_AGENT_FILE_SQL } from './agent-files.ts';
import { canPerform, isRoomReader, ROOM_READER } from './auth.ts';
import type { Role } from './env.ts';
import { NOT_HIDDEN_SQL } from './files-catalog.ts';

// ASCII case only, like SQLite's LIKE: a non-unicode /i never folds a non-ASCII letter to an ASCII one.
const PRIVILEGED = /privileged/i;

/**
 * True when any segment of `path` (its folders or its file name) contains "privileged", in any case. The whole
 * path is tested at once: the word holds no "/", so it is in the path exactly when it is in one segment.
 */
export function isPrivilegedPath(path: string): boolean {
  return PRIVILEGED.test(path);
}

/** What a guest's connected AI may read: its rooms' ids and live folders, and the manifest's privileged ids (lowercase). */
export interface GuestScope {
  rooms: readonly string[];
  folders: readonly string[];
  marks: ReadonlySet<string>;
}

/** Each live guest call's scope, by the call's own reader role. */
const scopes = new Map<string, GuestScope>();
let calls = 0;

/** Runs `work` (one tool call) with a reader role of its own, cut to `scope`; once the call ends the role sees nothing. */
export async function withGuestScope<T>(scope: GuestScope, work: (role: Role) => Promise<T>): Promise<T> {
  const role = `${ROOM_READER}#${++calls}` as Role;
  scopes.set(role, scope);
  try {
    return await work(role);
  } finally {
    scopes.delete(role);
  }
}

/** Whether a member with `role` may see a document at `path` at all: list it, open it, retrieve or cite it. */
export function canSeeDocument(role: Role, path: string): boolean {
  if (isRoomReader(role)) {
    const folders = scopes.get(role)?.folders ?? [];
    return !isPrivilegedPath(path) && !isAgentFile(path) && folders.some((folder) => path.startsWith(`${folder}/`));
  }
  return canPerform(role, 'viewPrivileged') || !isPrivilegedPath(path);
}

/**
 * What a guest who may see privileged documents (counsel in a matter room, rooms.ts) sees in the rooms `rooms` matches
 * (`= ?1`, or an IN list), as conditions on documents aliased d: a live mirrored document, not a room data file or a
 * folder guide, under one of the room's live folders (its path starts with the folder and a slash, compared exactly,
 * never LIKE), in a room that is not archived.
 */
export function guestRoomSql(rooms: string): string {
  return (
    `d.removed_at IS NULL AND d.source = 'mirror' AND d.${NOT_HIDDEN_SQL} AND ${NOT_AGENT_FILE_SQL} ` +
    'AND EXISTS (SELECT 1 FROM room_folders f JOIN rooms r ON r.id = f.room_id ' +
    `WHERE f.room_id ${rooms} AND f.removed_at IS NULL AND r.archived_at IS NULL AND substr(d.path, 1, length(f.folder) + 1) = f.folder || '/')`
  );
}

/** What every other guest sees in the rooms `rooms` matches: guestRoomSql, with no "privileged" in the path. */
export function guestVisibleSql(rooms: string): string {
  return `${guestRoomSql(rooms)} AND d.path NOT LIKE '%privileged%'`;
}

/** rooms.id's CHECK (migration 0012), and document ids as the sync writes them: the only values put in SQL as text. */
const ROOM_ID = /^[0-9a-f-]{8,64}$/;
const DOC_ID = /^[0-9a-z._-]{1,128}$/;
/** Keeps a statement well under D1's 100 KB limit; a manifest with more marks shows a guest nothing. */
const MAX_MARKS = 1000;

const NOTHING = ' AND 0';

/** A reader role's filter: its documents by id, through guestVisibleSql over its call's rooms, less the marked ids. */
function guestFilter(role: Role, column: PathColumn): string {
  const scope = scopes.get(role);
  const marks = [...(scope?.marks ?? [])];
  if (!scope || scope.rooms.length === 0 || !scope.rooms.every((id) => ROOM_ID.test(id)) || marks.length > MAX_MARKS || !marks.every((id) => DOC_ID.test(id))) {
    if (scope) console.error('guest_scope_refused', scope.rooms.length, marks.length);
    return NOTHING;
  }
  const quoted = (ids: readonly string[]) => ids.map((id) => `'${id}'`).join(', ');
  const unmarked = marks.length > 0 ? ` AND lower(d.id) NOT IN (${quoted(marks)})` : '';
  const id = column === 'd.path' ? 'd.id' : 'id';
  return ` AND ${column} NOT LIKE '%privileged%' AND ${id} IN (SELECT d.id FROM documents d WHERE ${guestVisibleSql(`IN (${quoted(scope.rooms)})`)}${unmarked})`;
}

/** The documents path column as a query names it; a closed list, so nothing but code reaches the SQL. */
export type PathColumn = 'path' | 'd.path';

/**
 * canSeeDocument for a query, appended to its WHERE conditions: nothing for a role that sees privileged documents (so
 * owner and counsel run the same SQL as before), else ` AND <column> NOT LIKE '%privileged%'`. SQLite's LIKE
 * ignores ASCII case, as isPrivilegedPath does. A reader role gets guestFilter, which binds nothing, so the query's own
 * parameters keep their numbers.
 */
export function privilegeFilter(role: Role, column: PathColumn = 'path'): string {
  if (isRoomReader(role)) return guestFilter(role, column);
  return canPerform(role, 'viewPrivileged') ? '' : ` AND ${column} NOT LIKE '%privileged%'`;
}
