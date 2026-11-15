-- The full notice (docs/legal/product-notices.md, A3): one row each time a member ticks a version of it
-- (worker/notice-gate.ts). The gate lets a member in once a row has the current version. Additive: a new table only.
CREATE TABLE notice_acks (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  version TEXT NOT NULL,
  ticked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ip TEXT,
  user_agent TEXT,
  UNIQUE (email, version)
);
