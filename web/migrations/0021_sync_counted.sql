-- What each sync upload counted against the month (worker/sync.ts recordCounted), so a delete gives back only bytes that
-- counted: never a side file stored before counting began, and never last month's. A delete takes its row with one
-- DELETE ... RETURNING, so two requests deleting one key at once refund once, and a stolen token can't race the monthly cap
-- down. Additive and backward compatible: one new table, read and written only by the sync endpoints, which are off by
-- default.
CREATE TABLE sync_counted (
  r2_key TEXT PRIMARY KEY,
  period TEXT NOT NULL CHECK (length(period) = 7),  -- YYYY-MM, UTC. Past months go at the end of a run (purgeRetired).
  bytes INTEGER NOT NULL CHECK (bytes >= 0)
);
