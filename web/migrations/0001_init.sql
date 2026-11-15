-- Counsel room schema. Every table for every phase is defined here so parallel work never races on
-- migration numbers. Later changes get 0002+ in the order they merge.

-- Who may use the room. Passing Cloudflare Access is not enough: the verified email must be here.
CREATE TABLE members (
  email    TEXT PRIMARY KEY CHECK (email = lower(email)),
  role     TEXT NOT NULL CHECK (role IN ('owner', 'counsel')),
  name     TEXT,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One row per file. Mirror rows come from `npm run sync`; counsel rows from uploads in the room.
-- Removed files keep their row (and comments and audit history) with removed_at set.
CREATE TABLE documents (
  id           TEXT PRIMARY KEY,                -- random (crypto.randomUUID), never sequential
  path         TEXT NOT NULL,                   -- mirror: relative to the source root; counsel: from-counsel/<id>/<name>
  folder       TEXT NOT NULL,                   -- parent of path, '' for the root
  name         TEXT NOT NULL,                   -- display filename
  kind         TEXT NOT NULL CHECK (kind IN ('pdf', 'image', 'markdown', 'csv', 'visual', 'text', 'file')),
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL CHECK (size >= 0),
  sha256       TEXT,                            -- mirror: hex sha256 computed on the Mac; counsel: NULL
  etag         TEXT,                            -- counsel: R2 etag
  pages        INTEGER,                         -- PDFs only
  r2_key       TEXT NOT NULL UNIQUE,            -- opaque key in legallas-files, never derived from the filename
  source       TEXT NOT NULL CHECK (source IN ('mirror', 'counsel')),
  uploaded_by  TEXT,                            -- counsel uploads: member email
  pulled_at    TEXT,                            -- counsel uploads: when sync downloaded it to the Mac
  updated_at   TEXT NOT NULL,
  removed_at   TEXT
);
CREATE UNIQUE INDEX documents_live_path ON documents (path) WHERE removed_at IS NULL;
CREATE INDEX documents_live_folder ON documents (folder) WHERE removed_at IS NULL;
CREATE INDEX documents_sha256 ON documents (sha256);

CREATE TABLE comments (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents (id),
  author_email TEXT NOT NULL,
  body         TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at  TEXT,
  resolved_by  TEXT
);
CREATE INDEX comments_document ON comments (document_id, created_at);

-- Who did what, when. Never stores question text or comment bodies.
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  email       TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN (
                'view', 'download', 'upload', 'comment', 'resolve', 'reopen',
                'ai_question', 'sync_added', 'sync_changed', 'sync_removed')),
  document_id TEXT,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX audit_log_ts ON audit_log (ts);

-- Per-user daily question count for the Legallas AI cost cap. day is YYYY-MM-DD (UTC).
CREATE TABLE usage (
  email     TEXT NOT NULL,
  day       TEXT NOT NULL,
  questions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (email, day)
);
