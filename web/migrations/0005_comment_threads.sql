-- Card F10 (design overhaul, R44): comment threads and page anchors.

-- A reply names its thread's top-level comment. Replies are one level deep: the parent is a top-level
-- comment on the same document. The worker checks that before the INSERT (worker/routes/comments.ts);
-- SQLite cannot express it as a constraint. NULL means a top-level comment.
ALTER TABLE comments ADD COLUMN parent_id TEXT REFERENCES comments (id);

-- The page a comment is about (1-based), or NULL for the whole document. The worker also checks it
-- against documents.pages when that is known.
ALTER TABLE comments ADD COLUMN page INTEGER CHECK (page IS NULL OR (typeof(page) = 'integer' AND page >= 1));

-- A thread's replies, per document.
CREATE INDEX comments_document_parent ON comments (document_id, parent_id);
