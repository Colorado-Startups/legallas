-- Retention (worker/data-retention.ts, scripts/close-out.ts). Additive and backward compatible (REVIEW.md item 3): two
-- new tables and their triggers. Nothing else changes, and the Workers before this migration never read them. No foreign
-- key onto members, which 0006 rebuilt and may again. Times are ISO instants as toISOString writes them, so they compare
-- as text.

-- When the matter closed: at most one row, written by `npm run close-out -- --revoke`. The audit log's after-close
-- retention (RETAIN_AUDIT_DAYS_AFTER_CLOSE) counts from it. Its date can't move, so a purge can't be brought forward.
-- Deleting the row reopens the room's clock, which only ever keeps more.
CREATE TABLE matter_close (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  closed_at TEXT NOT NULL CHECK (closed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  closed_by TEXT NOT NULL CHECK (length(closed_by) BETWEEN 1 AND 254)
);

CREATE TRIGGER matter_close_fixed BEFORE UPDATE ON matter_close
BEGIN
  SELECT RAISE(ABORT, 'matter_close is fixed once written');
END;

-- Every purge of the audit log: the last row id it removed, how many rows, the chain of the copy it saved first
-- (worker/audit-chain.ts) and where in the room's own files bucket that copy is. Append-only. The purge writes this row
-- and removes the rows in one transaction, so a removal without its record can't happen. The triggers below make the
-- database itself refuse a purge while a legal hold is on, one that goes backwards, and one whose count doesn't match
-- the rows it would remove.
CREATE TABLE audit_purges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL CHECK (ts GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  through_id INTEGER NOT NULL CHECK (through_id >= 1),
  rows       INTEGER NOT NULL CHECK (rows >= 1),
  chain      TEXT NOT NULL CHECK (length(chain) = 64 AND chain NOT GLOB '*[^0-9a-f]*'),
  copy_key   TEXT NOT NULL CHECK (length(copy_key) BETWEEN 1 AND 200 AND copy_key GLOB 'retention/audit-log/*.jsonl')
);

CREATE TRIGGER audit_purges_no_update BEFORE UPDATE ON audit_purges
BEGIN
  SELECT RAISE(ABORT, 'audit_purges is append-only');
END;

CREATE TRIGGER audit_purges_no_delete BEFORE DELETE ON audit_purges
BEGIN
  SELECT RAISE(ABORT, 'audit_purges is append-only');
END;

CREATE TRIGGER audit_purges_hold BEFORE INSERT ON audit_purges
WHEN EXISTS (SELECT 1 FROM legal_holds WHERE released_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'a legal hold is on: nothing is purged');
END;

CREATE TRIGGER audit_purges_forward BEFORE INSERT ON audit_purges
WHEN NEW.through_id <= COALESCE((SELECT MAX(through_id) FROM audit_purges), 0)
  OR NEW.rows <> (SELECT COUNT(*) FROM audit_log WHERE id <= NEW.through_id)
BEGIN
  SELECT RAISE(ABORT, 'audit_purges must cover exactly the rows it removes');
END;
