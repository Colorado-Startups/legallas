-- D1 caps a LIKE or GLOB pattern at 50 bytes (https://developers.cloudflare.com/d1/platform/limits/). The timestamp
-- CHECKs from 0012, 0017, 0018 and 0022 used a 92-byte GLOB, so on D1 every insert that set one failed (#847).
-- Each of the six tables is rebuilt with the same check written as strftime('%Y-%m-%dT%H:%M:%fZ', x) IS x: the
-- toISOString() shape, and a real date (no month 13, no 30 February). Columns, indexes and triggers stay as they were,
-- and rows are copied. The rebuild is listed in worker/migrations.test.ts, which checks all of that.
--
-- Per table: copy the rows aside, drop the table, create it again under its own name, copy the rows back, drop the copy.
-- No rename, so the foreign key from hold_custodians keeps pointing at legal_holds, and its rows find their parents again
-- when legal_holds is refilled: deferred, the check runs at commit. Triggers come back last: audit_purges_hold reads
-- legal_holds, and audit_purges_forward would refuse the copied purges.
PRAGMA defer_foreign_keys = true;

CREATE TABLE audit_purges_old AS SELECT * FROM audit_purges;
DROP TABLE audit_purges;
CREATE TABLE audit_purges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', ts) IS ts),
  through_id INTEGER NOT NULL CHECK (through_id >= 1),
  rows       INTEGER NOT NULL CHECK (rows >= 1),
  chain      TEXT NOT NULL CHECK (length(chain) = 64 AND chain NOT GLOB '*[^0-9a-f]*'),
  copy_key   TEXT NOT NULL CHECK (length(copy_key) BETWEEN 1 AND 200 AND copy_key GLOB 'retention/audit-log/*.jsonl')
);
INSERT INTO audit_purges (id, ts, through_id, rows, chain, copy_key)
  SELECT id, ts, through_id, rows, chain, copy_key FROM audit_purges_old;
DROP TABLE audit_purges_old;

CREATE TABLE matter_close_old AS SELECT * FROM matter_close;
DROP TABLE matter_close;
CREATE TABLE matter_close (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  closed_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', closed_at) IS closed_at),
  closed_by TEXT NOT NULL CHECK (length(closed_by) BETWEEN 1 AND 254)
);
INSERT INTO matter_close (id, closed_at, closed_by)
  SELECT id, closed_at, closed_by FROM matter_close_old;
DROP TABLE matter_close_old;

CREATE TABLE directors_old AS SELECT * FROM directors;
DROP TABLE directors;
CREATE TABLE directors (
  email      TEXT PRIMARY KEY CHECK (
               email = lower(email) AND length(email) BETWEEN 3 AND 254 AND email GLOB '?*@?*' AND email NOT GLOB '*[ :]*'
             ),
  named_by   TEXT NOT NULL CHECK (length(named_by) BETWEEN 1 AND 254),
  named_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decision   TEXT CHECK (decision IS NULL OR decision IN ('keep', 'remove')),
  decided_by TEXT,
  decided_at TEXT CHECK (decided_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', decided_at) IS decided_at),
  CHECK ((decision IS NULL) = (decided_by IS NULL) AND (decision IS NULL) = (decided_at IS NULL))
);
INSERT INTO directors (email, named_by, named_at, decision, decided_by, decided_at)
  SELECT email, named_by, named_at, decision, decided_by, decided_at FROM directors_old;
DROP TABLE directors_old;

CREATE TABLE conversions_old AS SELECT * FROM conversions;
DROP TABLE conversions;
CREATE TABLE conversions (
  id              TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64 AND id NOT GLOB '*[^0-9a-f-]*'),
  actor           TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 254),
  started_at      TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', started_at) IS started_at),
  finished_at     TEXT CHECK (finished_at IS NULL OR (strftime('%Y-%m-%dT%H:%M:%fZ', finished_at) IS finished_at AND finished_at >= started_at)),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  -- Rows found at the start, removed ones included. The conversion adds or removes none of them.
  documents       INTEGER NOT NULL CHECK (documents >= 0),
  comments        INTEGER NOT NULL CHECK (comments >= 0),
  invitations     INTEGER NOT NULL CHECK (invitations >= 0),
  -- access_events plus audit_log rows, at the start and at the finish: the log only grows.
  events_before   INTEGER NOT NULL CHECK (events_before >= 0),
  events_after    INTEGER CHECK (events_after IS NULL OR events_after >= events_before),
  -- Investor invitations the conversion ended.
  investors_out   INTEGER CHECK (investors_out IS NULL OR investors_out >= 0),
  CHECK ((finished_at IS NULL) = (events_after IS NULL) AND (finished_at IS NULL) = (investors_out IS NULL))
);
INSERT INTO conversions (id, actor, started_at, finished_at, manifest_sha256, documents, comments, invitations, events_before, events_after, investors_out)
  SELECT id, actor, started_at, finished_at, manifest_sha256, documents, comments, invitations, events_before, events_after, investors_out FROM conversions_old;
DROP TABLE conversions_old;

CREATE TABLE legal_holds_old AS SELECT * FROM legal_holds;
DROP TABLE legal_holds;
CREATE TABLE legal_holds (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at     TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', started_at) IS started_at),
  started_by     TEXT NOT NULL CHECK (length(started_by) BETWEEN 1 AND 254),
  -- Optional: a hold can start before any suit, so with no case number.
  case_number    TEXT CHECK (case_number IS NULL OR length(case_number) BETWEEN 1 AND 120),
  released_at    TEXT CHECK (released_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', released_at) IS released_at),
  released_by    TEXT CHECK (released_by IS NULL OR length(released_by) BETWEEN 1 AND 254),
  release_reason TEXT CHECK (release_reason IS NULL OR length(release_reason) BETWEEN 1 AND 2000)
);
INSERT INTO legal_holds (id, started_at, started_by, case_number, released_at, released_by, release_reason)
  SELECT id, started_at, started_by, case_number, released_at, released_by, release_reason FROM legal_holds_old;
DROP TABLE legal_holds_old;

CREATE TABLE room_members_old AS SELECT * FROM room_members;
DROP TABLE room_members;
CREATE TABLE room_members (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms (id),
  email      TEXT NOT NULL CHECK (
               email = lower(email) AND length(email) BETWEEN 3 AND 254 AND email GLOB '?*@?*' AND email NOT GLOB '*[ :]*'
             ),
  role       TEXT NOT NULL CHECK (role IN ('investor', 'counsel', 'viewer')),
  name       TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 120),
  invited_by TEXT NOT NULL,
  invited_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', invited_at) IS invited_at),
  accept_by  TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', accept_by) IS accept_by),
  joined_at  TEXT,
  expires_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS expires_at),
  revoked_at TEXT,
  revoked_by TEXT,
  CHECK (accept_by > invited_at AND expires_at > invited_at)
);
INSERT INTO room_members (id, room_id, email, role, name, invited_by, invited_at, accept_by, joined_at, expires_at, revoked_at, revoked_by)
  SELECT id, room_id, email, role, name, invited_by, invited_at, accept_by, joined_at, expires_at, revoked_at, revoked_by FROM room_members_old;
DROP TABLE room_members_old;

CREATE INDEX legal_holds_on ON legal_holds (released_at);
CREATE INDEX room_members_by_email ON room_members (email) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX room_members_live ON room_members (room_id, email) WHERE revoked_at IS NULL;

CREATE TRIGGER audit_purges_forward BEFORE INSERT ON audit_purges
WHEN NEW.through_id <= COALESCE((SELECT MAX(through_id) FROM audit_purges), 0)
  OR NEW.rows <> (SELECT COUNT(*) FROM audit_log WHERE id <= NEW.through_id)
BEGIN
  SELECT RAISE(ABORT, 'audit_purges must cover exactly the rows it removes');
END;

CREATE TRIGGER audit_purges_hold BEFORE INSERT ON audit_purges
WHEN EXISTS (SELECT 1 FROM legal_holds WHERE released_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'a legal hold is on: nothing is purged');
END;

CREATE TRIGGER audit_purges_no_delete BEFORE DELETE ON audit_purges
BEGIN
  SELECT RAISE(ABORT, 'audit_purges is append-only');
END;

CREATE TRIGGER audit_purges_no_update BEFORE UPDATE ON audit_purges
BEGIN
  SELECT RAISE(ABORT, 'audit_purges is append-only');
END;

CREATE TRIGGER conversions_no_delete BEFORE DELETE ON conversions
BEGIN
  SELECT RAISE(ABORT, 'a conversion is a record and is never deleted');
END;

CREATE TRIGGER directors_decided_once BEFORE UPDATE ON directors
WHEN OLD.decision IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a director decision is recorded once');
END;

CREATE TRIGGER directors_lawyer_on_insert BEFORE INSERT ON directors
WHEN NEW.decided_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM members WHERE email = NEW.decided_by AND role = 'counsel')
BEGIN
  SELECT RAISE(ABORT, 'only a lawyer (a counsel member) records a director decision');
END;

CREATE TRIGGER directors_lawyer_on_update BEFORE UPDATE ON directors
WHEN NEW.decided_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM members WHERE email = NEW.decided_by AND role = 'counsel')
BEGIN
  SELECT RAISE(ABORT, 'only a lawyer (a counsel member) records a director decision');
END;

CREATE TRIGGER directors_no_delete BEFORE DELETE ON directors
BEGIN
  SELECT RAISE(ABORT, 'a named director is a record and is never deleted');
END;

CREATE TRIGGER matter_close_fixed BEFORE UPDATE ON matter_close
BEGIN
  SELECT RAISE(ABORT, 'matter_close is fixed once written');
END;
