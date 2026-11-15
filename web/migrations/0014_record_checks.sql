-- "Check who you're dealing with" (worker/public-records.ts): a public-records check sends a name out of the room to
-- public sites, so a member approves each one in the room first (/checks/). One row per request: the member who
-- asked, the name and whether it is a person or a company, the sources it would go to (the page shows them and the
-- check sends to no other), the app that asked (Claude, Ask), and the member's decision. A pending request lapses 30
-- minutes after it is made and an approval an hour after it is given; rows past their expiry are deleted whenever a
-- member uses the approval page and by the MCP Worker's daily cron, so the room keeps no lasting list of who was checked.
-- What the sources returned is never stored. Additive and backward compatible: a new table, nothing else changes,
-- and the Worker before this migration never reads it. No foreign key to members, which 0006 rebuilt and may again.
CREATE TABLE record_checks (
  id          TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 64),
  email       TEXT NOT NULL,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  name_key    TEXT NOT NULL CHECK (length(name_key) BETWEEN 1 AND 120),
  kind        TEXT NOT NULL CHECK (kind IN ('person', 'company')),
  sources     TEXT NOT NULL CHECK (length(sources) BETWEEN 1 AND 200),
  state       TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'declined')),
  via         TEXT NOT NULL CHECK (length(via) BETWEEN 1 AND 80),
  created_at  TEXT NOT NULL CHECK (length(created_at) BETWEEN 20 AND 24),
  decided_at  TEXT CHECK (decided_at IS NULL OR length(decided_at) BETWEEN 20 AND 24),
  expires_at  TEXT NOT NULL CHECK (length(expires_at) BETWEEN 20 AND 24)
);
CREATE INDEX record_checks_member ON record_checks (email, name_key, kind, state);
CREATE INDEX record_checks_expiry ON record_checks (expires_at);
