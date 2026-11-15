-- The one large upload a sync key may have (#280): a second upload on the key is refused when it starts, and only this
-- one can complete, so no late complete can replace an original a record took. Additive: a new table only.
CREATE TABLE sync_uploads (
  r2_key TEXT PRIMARY KEY,
  upload TEXT NOT NULL
);
