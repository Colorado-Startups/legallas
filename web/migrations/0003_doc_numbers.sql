-- Card F3 (design overhaul): permanent document numbers, the Key flag, and Key audit actions.

-- Control numbers (decision R3). Each document row gets a permanent sequence number, shown as
-- <prefix>-<control_seq> with the prefix from the gitignored config. It hangs off the row id, never
-- sha256: ids survive renames, and duplicate files share a sha256. Removed rows keep their numbers so a
-- number is never reused. SQLite cannot add a UNIQUE column in one step, so: add, backfill, index.
-- New rows get MAX + 1 inside their INSERT (scripts/sqlplan.ts, worker/routes/files.ts); a sync first
-- numbers any row still NULL (an upload that lands between this migration and the deploy).
ALTER TABLE documents ADD COLUMN control_seq INTEGER;
UPDATE documents SET control_seq = r.n
  FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY path, updated_at, id) AS n FROM documents) AS r
 WHERE r.id = documents.id;
CREATE UNIQUE INDEX documents_control_seq ON documents (control_seq);

-- The Key flag (decision R9): any member may mark a document as Key. NULL means not Key.
ALTER TABLE documents ADD COLUMN key_at TEXT;
ALTER TABLE documents ADD COLUMN key_by TEXT;

-- audit_log gains 'key' and 'unkey'. SQLite cannot alter a CHECK constraint, so the table is rebuilt
-- with the same columns and ids, then its indexes (0001 and 0002) are recreated. Nothing references it.
CREATE TABLE audit_log_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  email       TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN (
                'view', 'download', 'upload', 'comment', 'resolve', 'reopen',
                'ai_question', 'sync_added', 'sync_changed', 'sync_removed',
                'key', 'unkey')),
  document_id TEXT,
  ip          TEXT,
  user_agent  TEXT
);
INSERT INTO audit_log_new (id, ts, email, action, document_id, ip, user_agent)
  SELECT id, ts, email, action, document_id, ip, user_agent FROM audit_log ORDER BY id;
DROP TABLE audit_log;
ALTER TABLE audit_log_new RENAME TO audit_log;
CREATE INDEX audit_log_ts ON audit_log (ts);
CREATE INDEX audit_log_email_ts ON audit_log (email, ts);
