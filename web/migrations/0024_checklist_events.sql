-- Who changed the company checklist, and when (worker/checklist-store.ts, the owner's Activity feed): one row per match
-- made, match changed, match removed, item marked as not applying and item marked as applying again. Ids and codes only:
-- never a fact, title, name or path. Append-only, as audit_log is (0019). Additive and backward compatible (REVIEW.md
-- item 3): one new table and its triggers; nothing reads it while CHECKLIST_ENABLED is off.

CREATE TABLE checklist_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  email       TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('matched', 'match_changed', 'unmatched', 'not_applicable', 'applies')),
  item_id     TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 120),
  document_id TEXT
);
CREATE INDEX checklist_events_ts ON checklist_events (ts);
CREATE INDEX checklist_events_email_ts ON checklist_events (email, ts);

CREATE TRIGGER checklist_events_no_update BEFORE UPDATE ON checklist_events
BEGIN
  SELECT RAISE(ABORT, 'checklist_events is append-only');
END;

CREATE TRIGGER checklist_events_no_delete BEFORE DELETE ON checklist_events
BEGIN
  SELECT RAISE(ABORT, 'checklist_events is append-only');
END;
