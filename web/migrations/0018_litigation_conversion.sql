-- Turning the install into a litigation room (scripts/litigation.ts; quality-speed/pages/data-room/research/litigation.md,
-- section 3). Purely additive: two new tables and their triggers. No table is dropped, renamed or rebuilt and no existing
-- row is touched (REVIEW.md item 3). The Worker before this migration never reads them. Times are ISO instants as
-- JavaScript's toISOString writes them (24 characters, UTC), as in migration 0012.

-- The conversion, as one recorded act: who ran it, when, the counts it found and the SHA-256 of the document manifest
-- it found. It copies, moves and renumbers nothing. A row with no finished_at is a run that stopped part way, which the
-- next run finishes (scripts/litigation.ts). An install converts once: the first statement of a run inserts only into
-- an empty table.
CREATE TABLE conversions (
  id              TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64 AND id NOT GLOB '*[^0-9a-f-]*'),
  actor           TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 254),
  started_at      TEXT NOT NULL CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  finished_at     TEXT CHECK (finished_at IS NULL OR (finished_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z' AND finished_at >= started_at)),
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

CREATE TRIGGER conversions_no_delete BEFORE DELETE ON conversions
BEGIN
  SELECT RAISE(ABORT, 'a conversion is a record and is never deleted');
END;

-- Accounts the owner names as holding a director role. A conversion can neither start nor finish while one has no
-- decision, and only a lawyer (a counsel member of the install) can record it. The decision is the lawyer's, about
-- the account only: 'keep' leaves its invitations as they are, 'remove' ends them with every investor's. It is recorded
-- once and states no conclusion about anyone's rights.
CREATE TABLE directors (
  email      TEXT PRIMARY KEY CHECK (
               email = lower(email) AND length(email) BETWEEN 3 AND 254 AND email GLOB '?*@?*' AND email NOT GLOB '*[ :]*'
             ),
  named_by   TEXT NOT NULL CHECK (length(named_by) BETWEEN 1 AND 254),
  named_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decision   TEXT CHECK (decision IS NULL OR decision IN ('keep', 'remove')),
  decided_by TEXT,
  decided_at TEXT CHECK (decided_at IS NULL OR decided_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((decision IS NULL) = (decided_by IS NULL) AND (decision IS NULL) = (decided_at IS NULL))
);

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

CREATE TRIGGER directors_decided_once BEFORE UPDATE ON directors
WHEN OLD.decision IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a director decision is recorded once');
END;

CREATE TRIGGER directors_no_delete BEFORE DELETE ON directors
BEGIN
  SELECT RAISE(ABORT, 'a named director is a record and is never deleted');
END;
