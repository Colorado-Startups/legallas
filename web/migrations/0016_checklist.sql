-- The company checklist (docs/checklist/baseline.toml, worker/checklist.ts): which documents a person has matched to which
-- items, with the key facts they entered, and which items they say don't apply. Off by default (CHECKLIST_ENABLED); with it
-- off nothing reads or writes these tables. Additive and backward compatible (REVIEW.md item 3).

CREATE TABLE checklist_matches (
  id          TEXT PRIMARY KEY,                             -- random (crypto.randomUUID)
  item_id     TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents (id),
  signed      TEXT CHECK (signed IN ('yes', 'no', 'not_needed')),  -- NULL: nobody has said
  doc_date    TEXT,
  next_date   TEXT,
  parties     TEXT CHECK (length(parties) <= 500),
  amount      TEXT CHECK (length(amount) <= 100),
  matched_by  TEXT NOT NULL,
  matched_at  TEXT NOT NULL,
  UNIQUE (item_id, document_id)
);

CREATE TABLE checklist_not_applicable (
  item_id    TEXT PRIMARY KEY,
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL
);
