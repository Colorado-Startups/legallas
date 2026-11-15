-- Deal rooms and the investor role, first slice (docs/design/rooms-and-grants.md). Purely additive: four new tables
-- with their indexes and triggers, and a nullable room_id column on comments and on audit_log. No table is dropped,
-- renamed or rebuilt and no existing row is touched (REVIEW.md item 3). The Worker before this migration never reads
-- the new tables or columns. The Worker with it reads them only while ROOMS_ENABLED is "1" (worker/rooms.ts), so a
-- single-room install behaves exactly as before. A NULL room_id means the install's own record, which is what every
-- row written before this migration is.
--
-- A deal room is a view: it shows the live documents under its folders (room_folders) and copies nothing. Its people
-- are in room_members, never in members: members stays the install's own owner and counsel, who keep seeing the whole
-- record, every room's folders included, as they do today. Times are ISO instants as JavaScript's toISOString writes
-- them (24 characters, UTC), so they compare as text; the CHECKs below refuse any other shape.

CREATE TABLE rooms (
  -- Random (crypto.randomUUID in scripts/room.ts), never a name: ids appear in URLs, names never leave the room.
  id          TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64 AND id NOT GLOB '*[^0-9a-f-]*'),
  -- Every planned kind is listed now, because SQLite cannot widen a CHECK without rebuilding the table. The code
  -- serves 'deal' only.
  kind        TEXT NOT NULL DEFAULT 'deal' CHECK (kind IN ('deal', 'matter', 'company')),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT
);

-- The folders a room shows, each with everything under it, files added later included. A folder is a path relative to
-- the synced root: no leading, trailing or doubled slash, no backslash, no "." or ".." segment, never the root, never a
-- privileged path (worker/privilege.ts reads "privileged" anywhere in a path, in any ASCII case, as LIKE does) and never
-- counsel's upload folder.
CREATE TABLE room_folders (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms (id),
  folder     TEXT NOT NULL CHECK (
               length(folder) BETWEEN 1 AND 1024
               AND folder NOT GLOB '/*' AND folder NOT GLOB '*/' AND folder NOT GLOB '*//*'
               AND instr(folder, char(92)) = 0
               AND ('/' || folder || '/') NOT GLOB '*/./*' AND ('/' || folder || '/') NOT GLOB '*/../*'
               AND folder NOT LIKE '%privileged%'
               AND folder <> 'from-counsel' AND folder NOT GLOB 'from-counsel/*'
             ),
  added_by   TEXT NOT NULL,
  added_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  removed_at TEXT,
  removed_by TEXT
);
CREATE UNIQUE INDEX room_folders_live ON room_folders (room_id, folder) WHERE removed_at IS NULL;

-- One person invited to one room with one role. Every row has an end date. An invitation lapses unless it is used
-- (joined_at, the person's first signed-in request) before accept_by. Access is derived from the dates on every
-- request and never stored as a status: active means not revoked, before expires_at, joined or still inside the
-- accept window, on a room that is not archived. Every planned role is listed now (see rooms.kind); the code serves
-- 'investor' only, and treats any other role as no access.
CREATE TABLE room_members (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms (id),
  email      TEXT NOT NULL CHECK (
               email = lower(email) AND length(email) BETWEEN 3 AND 254 AND email GLOB '?*@?*' AND email NOT GLOB '*[ :]*'
             ),
  role       TEXT NOT NULL CHECK (role IN ('investor', 'counsel', 'viewer')),
  name       TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 120),
  invited_by TEXT NOT NULL,
  invited_at TEXT NOT NULL CHECK (invited_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  accept_by  TEXT NOT NULL CHECK (accept_by GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  joined_at  TEXT,
  expires_at TEXT NOT NULL CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  revoked_at TEXT,
  revoked_by TEXT,
  CHECK (accept_by > invited_at AND expires_at > invited_at)
);
CREATE UNIQUE INDEX room_members_live ON room_members (room_id, email) WHERE revoked_at IS NULL;
CREATE INDEX room_members_by_email ON room_members (email) WHERE revoked_at IS NULL;

-- Every change to who can see what. Append-only: the triggers refuse UPDATE and DELETE. Never text: no names, paths or
-- comment bodies, only ids, the subject's email and a code. Every planned action is listed now (see rooms.kind).
CREATE TABLE access_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor         TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 254),
  action        TEXT NOT NULL CHECK (action IN (
                  'room_created', 'room_archived', 'room_settings_changed',
                  'content_added', 'content_removed',
                  'invite_created', 'invite_cancelled', 'invite_lapsed', 'invite_accepted',
                  'grant_created', 'grant_changed', 'grant_expired', 'grant_revoked', 'grant_migrated',
                  'person_added', 'person_disabled', 'organization_changed',
                  'privileged_marked', 'privileged_unmarked', 'privilege_warning_acknowledged',
                  'access_allowed', 'access_removed', 'sessions_ended', 'seat_freed', 'access_sync_failed',
                  'colleague_requested')),
  room_id       TEXT,
  grant_id      TEXT,
  subject_email TEXT,
  detail_code   TEXT CHECK (detail_code IS NULL OR (length(detail_code) BETWEEN 1 AND 40 AND detail_code NOT GLOB '*[^a-z0-9_]*'))
);
CREATE INDEX access_events_ts ON access_events (ts);

CREATE TRIGGER access_events_no_update BEFORE UPDATE ON access_events
BEGIN
  SELECT RAISE(ABORT, 'access_events is append-only');
END;

CREATE TRIGGER access_events_no_delete BEFORE DELETE ON access_events
BEGIN
  SELECT RAISE(ABORT, 'access_events is append-only');
END;

-- A comment written in a deal room carries its room. NULL, as on every comment before this migration, is the
-- install's own record. A guest reads only their own threads in their room (worker/rooms.ts).
ALTER TABLE comments ADD COLUMN room_id TEXT REFERENCES rooms (id);
CREATE INDEX comments_room ON comments (room_id, document_id) WHERE room_id IS NOT NULL;

-- The room a guest's audit row was written in; NULL for every other row.
ALTER TABLE audit_log ADD COLUMN room_id TEXT;
