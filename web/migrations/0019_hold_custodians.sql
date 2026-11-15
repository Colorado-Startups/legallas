-- A legal hold's custodians (worker/hold.ts): who must keep their records, when the notice reached them, each
-- acknowledgment and the last reminder. Every step also writes a hold_events row (migration 0017). Additive and backward
-- compatible (REVIEW.md item 3): one new table, and the Worker before this migration never reads it.
CREATE TABLE hold_custodians (
  hold_id          INTEGER NOT NULL REFERENCES legal_holds (id),
  email            TEXT NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254 AND email GLOB '?*@?*' AND email NOT GLOB '*[ :]*'),
  name             TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 120),
  added_by         TEXT NOT NULL CHECK (length(added_by) BETWEEN 1 AND 254),
  added_at         TEXT NOT NULL,
  notified_at      TEXT,
  acknowledged_at  TEXT,
  -- The member who recorded the acknowledgment: the custodian, or whoever got their reply.
  acknowledged_by  TEXT CHECK (acknowledged_by IS NULL OR length(acknowledged_by) BETWEEN 1 AND 254),
  last_reminded_at TEXT,
  PRIMARY KEY (hold_id, email)
);
