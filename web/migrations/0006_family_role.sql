-- members gains the 'family' role: a read-only member reads the record and asks Legallas, and nothing else
-- (worker/auth.ts PERMISSIONS). SQLite cannot alter a CHECK constraint, so the table is rebuilt with the
-- same columns and rows, as 0003 did for audit_log. Nothing references members and it has no indexes
-- or AUTOINCREMENT, so a plain copy keeps everything.
CREATE TABLE members_new (
  email    TEXT PRIMARY KEY CHECK (email = lower(email)),
  role     TEXT NOT NULL CHECK (role IN ('owner', 'counsel', 'family')),
  name     TEXT,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO members_new (email, role, name, added_at)
  SELECT email, role, name, added_at FROM members;
DROP TABLE members;
ALTER TABLE members_new RENAME TO members;
