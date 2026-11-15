-- Version history and what a deal room showed on a past date (worker/versions.ts). Additive and backward compatible
-- (REVIEW.md item 3): one new table filled by triggers, so every writer (the sync endpoints, `npm run sync`, uploads, the
-- Worker before this migration) records history with no code change; a nullable column on rooms; no row is rewritten.

-- Each state a document has been in: its path and its bytes, from valid_from until valid_to (NULL: still so). A sync
-- that replaces a file closes the old state and opens a new one with the new r2_key, so each version keeps its own key,
-- sha256, size and date. No CHECK here: a trigger must never fail a write to documents.
CREATE TABLE document_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  TEXT NOT NULL,
  path         TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  sha256       TEXT,
  size         INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  valid_from   TEXT NOT NULL,
  valid_to     TEXT
);
CREATE INDEX document_history_document ON document_history (document_id, id);
CREATE INDEX document_history_key ON document_history (r2_key);

-- What is known before this migration: each document's state since its last update. Earlier states were not recorded.
INSERT INTO document_history (document_id, path, r2_key, sha256, size, content_type, valid_from, valid_to)
  SELECT id, path, r2_key, sha256, size, content_type, updated_at, removed_at FROM documents;

CREATE TRIGGER document_history_added AFTER INSERT ON documents WHEN NEW.removed_at IS NULL
BEGIN
  INSERT INTO document_history (document_id, path, r2_key, sha256, size, content_type, valid_from)
    VALUES (NEW.id, NEW.path, NEW.r2_key, NEW.sha256, NEW.size, NEW.content_type, NEW.updated_at);
END;

CREATE TRIGGER document_history_changed AFTER UPDATE OF path, r2_key, removed_at ON documents
WHEN OLD.path IS NOT NEW.path OR OLD.r2_key IS NOT NEW.r2_key OR OLD.removed_at IS NOT NEW.removed_at
BEGIN
  UPDATE document_history SET valid_to = NEW.updated_at WHERE document_id = NEW.id AND valid_to IS NULL;
  INSERT INTO document_history (document_id, path, r2_key, sha256, size, content_type, valid_from)
    SELECT NEW.id, NEW.path, NEW.r2_key, NEW.sha256, NEW.size, NEW.content_type, NEW.updated_at WHERE NEW.removed_at IS NULL;
END;

-- When the owner turned version history on for a deal room (npm run room -- versions); NULL is off. While it is on and the
-- room is not archived, a replaced original of a document the room shows is kept (worker/sync.ts purgeRetired).
ALTER TABLE rooms ADD COLUMN version_history_at TEXT;
