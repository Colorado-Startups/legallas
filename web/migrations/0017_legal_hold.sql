-- Legal hold (worker/hold.ts): a member turns it on when a dispute is expected, before any suit exists, so it needs no case
-- number. Additive and backward compatible (REVIEW.md item 3): two new tables and their triggers, nothing else changes,
-- and the Worker before this migration never reads them. No foreign key onto members, which 0006 rebuilt and may again.
-- Times are ISO instants as JavaScript's toISOString writes them (24 characters, UTC), so they compare as text.

-- One row per hold. The hold is on while a row has no released_at; the Worker starts one only when none is on, in one
-- statement, so two can't be on at once. The start date and who started it are the server's, never the request's.
CREATE TABLE legal_holds (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at     TEXT NOT NULL CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  started_by     TEXT NOT NULL CHECK (length(started_by) BETWEEN 1 AND 254),
  -- Optional: a hold can start before any suit, so with no case number.
  case_number    TEXT CHECK (case_number IS NULL OR length(case_number) BETWEEN 1 AND 120),
  released_at    TEXT CHECK (released_at IS NULL OR released_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  released_by    TEXT CHECK (released_by IS NULL OR length(released_by) BETWEEN 1 AND 254),
  release_reason TEXT CHECK (release_reason IS NULL OR length(release_reason) BETWEEN 1 AND 2000)
);
CREATE INDEX legal_holds_on ON legal_holds (released_at);

-- Every step of a hold, and every removal it refuses. Append-only: the triggers refuse UPDATE and DELETE. Never text: no
-- names, paths or notice bodies, only ids, the subject's email or a document id, and a code. Every planned action is
-- listed now, because SQLite cannot widen a CHECK without rebuilding the table.
CREATE TABLE hold_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  hold_id     INTEGER NOT NULL,
  actor       TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 254),
  action      TEXT NOT NULL CHECK (action IN (
                'hold_started', 'hold_released',
                'custodian_added', 'notice_sent', 'notice_acknowledged', 'reminder_sent',
                'removal_refused')),
  subject     TEXT CHECK (subject IS NULL OR length(subject) BETWEEN 1 AND 254),
  detail_code TEXT CHECK (detail_code IS NULL OR (length(detail_code) BETWEEN 1 AND 40 AND detail_code NOT GLOB '*[^a-z0-9_]*'))
);
CREATE INDEX hold_events_hold ON hold_events (hold_id, id);

CREATE TRIGGER hold_events_no_update BEFORE UPDATE ON hold_events
BEGIN
  SELECT RAISE(ABORT, 'hold_events is append-only');
END;

CREATE TRIGGER hold_events_no_delete BEFORE DELETE ON hold_events
BEGIN
  SELECT RAISE(ABORT, 'hold_events is append-only');
END;
