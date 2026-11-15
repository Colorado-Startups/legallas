-- The room's sync endpoints (worker/routes/sync.ts): a laptop keeps a room in step with its folder with an Access service
-- token, not an account-wide credential. Off by default (SYNC_ENDPOINTS); with it off nothing reads or writes these
-- tables. Additive and backward compatible (REVIEW.md item 3): three new tables, nothing else changes, and the Worker
-- before this migration never reads them. No foreign key onto members, which 0006 rebuilt and may again.

-- Which service tokens may sync, and whose they are. client_id is the token's Client ID, which Access puts in the
-- `common_name` claim; it is an identifier, not the secret, and the secret is never stored here. The Worker also requires
-- owner_email to be the room's owner on every request, so removing the owner ends the token too.
CREATE TABLE sync_tokens (
  client_id   TEXT PRIMARY KEY CHECK (length(client_id) BETWEEN 1 AND 128),
  owner_email TEXT NOT NULL CHECK (owner_email = lower(owner_email) AND length(owner_email) BETWEEN 3 AND 320),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at  TEXT
);

-- One uploader at a time: at most one row. A takeover writes a new lease_id, which is what fences the old device out:
-- every write names its lease_id. expires_at only says when another device may take it without asking.
CREATE TABLE sync_lease (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  lease_id    TEXT NOT NULL CHECK (length(lease_id) BETWEEN 1 AND 64),
  device      TEXT NOT NULL CHECK (length(device) BETWEEN 1 AND 80),
  expires_at  TEXT NOT NULL
);

-- Originals a sync over these endpoints replaced or removed. A service token never deletes them: a stolen laptop can add
-- to the room but cannot destroy what counsel relies on. The Worker removes an object only once its retired_at is older
-- than the keep period (worker/sync.ts RETAIN_DAYS).
CREATE TABLE sync_retired (
  r2_key      TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  retired_at  TEXT NOT NULL
);
CREATE INDEX sync_retired_at ON sync_retired (retired_at);
