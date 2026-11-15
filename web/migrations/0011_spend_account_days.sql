-- The account's Workers AI neurons for each UTC day, from Cloudflare's analytics, read after the day ended
-- (worker/budget.ts paidBefore). The paid month (the owner, 2026-10-31: $10 a month, stop at 90%) counts a day's neurons
-- past the free 10,000 by the larger of this and spend_counters. Written by the scripts' spend lease
-- (scripts/spend-guard.ts) whenever it reads the analytics; read by the Workers (worker/spend.ts), which use no paid
-- neuron while any earlier day of the month is missing here. Days and numbers only.
CREATE TABLE spend_account_days (
  day     TEXT NOT NULL PRIMARY KEY CHECK (length(day) = 10),
  neurons INTEGER NOT NULL CHECK (neurons >= 0),
  read_at TEXT NOT NULL
);
