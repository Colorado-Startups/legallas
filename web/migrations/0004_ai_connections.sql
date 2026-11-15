-- legallas-mcp (AI connections, web/README.md): audit rows for counsel's AI tools and a daily tool-call cap.
-- Independent of the comment-threads migration: it touches only audit_log and usage, so the two apply
-- safely in either order.

-- audit_log gains four actions and a `via` column. ai_connect and ai_disconnect record a member linking or
-- unlinking an AI app; ai_search and ai_read record each tool call (never the query or page text). `via`
-- names the app ("Claude", "Harvey") for the activity feed; it is NULL for the room's own rows.
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt as 0003 did: same columns and ids, then
-- its indexes (0001 and 0002) are recreated. Nothing references it.
-- An audit id is never reused: the copy alone would reset the AUTOINCREMENT counter to the highest surviving
-- id, so the old counter is saved first and restored after the rename (inserted when the copy left no row).
-- Any later migration that rebuilds audit_log must keep the ai_* actions and the via column.
CREATE TABLE audit_log_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  email       TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN (
                'view', 'download', 'upload', 'comment', 'resolve', 'reopen',
                'ai_question', 'sync_added', 'sync_changed', 'sync_removed',
                'key', 'unkey',
                'ai_connect', 'ai_disconnect', 'ai_search', 'ai_read')),
  document_id TEXT,
  ip          TEXT,
  user_agent  TEXT,
  via         TEXT CHECK (via IS NULL OR length(via) BETWEEN 1 AND 80)
);
INSERT INTO audit_log_new (id, ts, email, action, document_id, ip, user_agent)
  SELECT id, ts, email, action, document_id, ip, user_agent FROM audit_log ORDER BY id;
CREATE TABLE _audit_seq AS SELECT seq FROM sqlite_sequence WHERE name = 'audit_log';
DROP TABLE audit_log;
ALTER TABLE audit_log_new RENAME TO audit_log;
INSERT INTO sqlite_sequence (name, seq)
  SELECT 'audit_log', seq FROM _audit_seq WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'audit_log');
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM _audit_seq), 0)) WHERE name = 'audit_log';
DROP TABLE _audit_seq;
CREATE INDEX audit_log_ts ON audit_log (ts);
CREATE INDEX audit_log_email_ts ON audit_log (email, ts);

-- Per-member daily MCP tool calls (DAILY_TOOL_CAP), beside the Ask `questions` counter on the same row.
ALTER TABLE usage ADD COLUMN tool_calls INTEGER NOT NULL DEFAULT 0;
