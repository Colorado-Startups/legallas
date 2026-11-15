-- What a sync token has added to legallas-files each month, so a stolen token can't grow the customer's R2 bill without
-- limit (worker/sync.ts countUpload). Additive and backward compatible (REVIEW.md item 3): one new table, read and written
-- only by the sync endpoints, which are off by default.
CREATE TABLE sync_upload_bytes (
  period TEXT PRIMARY KEY CHECK (length(period) = 7),  -- YYYY-MM, UTC
  used   INTEGER NOT NULL CHECK (used >= 0)
);
