-- Spend counters for Legallas's Cloudflare budget (worker/budget.ts): Workers AI neurons per UTC day and AI Search
-- queries and ingestion tokens per UTC month, so the room refuses before Cloudflare would bill past Workers Paid's
-- included amounts. legallas-web, legallas-mcp and the eval, law and index scripts all count here (worker/spend.ts,
-- scripts/spend-guard.ts). `period` is YYYY-MM-DD for a daily meter and YYYY-MM for a monthly one. Meter names
-- and numbers only: never a question, a query or document text.
CREATE TABLE spend_counters (
  meter  TEXT NOT NULL CHECK (meter IN ('neurons', 'search_semantic', 'search_fulltext', 'search_ingest_tokens')),
  period TEXT NOT NULL CHECK (length(period) IN (7, 10)),
  used   INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (meter, period)
);
