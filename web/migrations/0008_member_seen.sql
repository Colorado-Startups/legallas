-- "New since your last visit", kept by the room (D17; worker/seen.ts, POST /api/seen) instead of only in one browser,
-- so the Overview and Documents mark what was added or changed since a member's previous visit on any device. One
-- row per member: their latest room page load (last_seen_at) and the end of their previous visit (since_at, what
-- "new" is measured from; NULL on a first visit). The visit rule is src/scripts/overview-news-visit.ts. Instants
-- only: never what was opened or read. Additive and backward compatible: a new table, nothing else changes, and the
-- Worker before this migration never reads it. No foreign key to members, which 0006 rebuilt and may again.
CREATE TABLE member_seen (
  email        TEXT PRIMARY KEY,
  last_seen_at TEXT NOT NULL CHECK (length(last_seen_at) BETWEEN 20 AND 24),
  since_at     TEXT CHECK (since_at IS NULL OR length(since_at) BETWEEN 20 AND 24)
);
