-- Free keyword search over every page of document text (worker/fts.ts ftsSearch), so counsel's AIs and Ask keep
-- searching when the AI Search monthly allowance is spent. FTS5 is built into D1; a search costs only D1 rows read,
-- which Workers Paid includes. scripts/fts-index.ts fills these tables from legallas-index (text/<id>.p<N>.md), the same
-- parts AI Search reads, and rewrites only documents whose parts changed. Additive: nothing reads them until a caller
-- uses ftsSearch, and an empty index answers "not built" rather than "nothing matched".
--
-- page_fts: one row per page, or per piece of a page longer than the indexer's piece limit. The text carries no index
-- markers; ftsSearch adds [[doc:<id> p:<n>]] to each passage it returns. doc_id and page are UNINDEXED: stored and
-- returned, never matched. The porter stemmer folds English word forms (sign, signed, signing); unicode61 with
-- remove_diacritics 2 folds case and accents.
--
-- Rowids: each document owns the block [seq * 1048576, (seq + 1) * 1048576), seq from page_fts_docs, so the indexer
-- clears one document by a rowid range. FTS5 has no index on an UNINDEXED column, and "WHERE doc_id = ?" would read
-- every row of the table.
--
-- Export: `wrangler d1 export` refuses a database that holds a virtual table (D1 docs, "Import and export data").
-- Backups here are Time Travel bookmarks, which are unaffected. To export anyway: DROP TABLE page_fts, export, run
-- this file's CREATE VIRTUAL TABLE again, clear page_fts_docs and run the indexer.
CREATE VIRTUAL TABLE page_fts USING fts5(
  text,
  doc_id UNINDEXED,
  page UNINDEXED,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

-- What page_fts holds for each document: a fingerprint of its index parts (their keys and R2 etags), so a run rewrites
-- only documents whose parts changed. fingerprint '' marks a write that did not finish; the next run redoes it.
-- AUTOINCREMENT: a dropped document's seq, and so its rowid block, is never handed out again.
CREATE TABLE page_fts_docs (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id      TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  rows        INTEGER NOT NULL DEFAULT 0 CHECK (rows >= 0),
  indexed_at  TEXT NOT NULL
);
