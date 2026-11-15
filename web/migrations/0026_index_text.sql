-- What each mirror document's search text was built from, and how many parts of it the index holds (card 8.1, #279).
-- The Worker keeps it as parts are written and deleted (worker/routes/sync.ts), so a new computer's first sync reuses
-- the text, and text deleted since is written again. Additive: a new table only.
CREATE TABLE index_text (
  document_id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  parts INTEGER NOT NULL,
  stamp TEXT NOT NULL
);
