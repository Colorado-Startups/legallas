-- Propose and approve (docs/design/propose-and-approve.md): an AI proposes work as one member, and a person in the room
-- approves or rejects it. Off by default (PROPOSALS_ENABLED); with it off nothing reads or writes these tables.
-- Additive and backward compatible (REVIEW.md item 3): three new tables and their triggers, nothing else changes, and
-- the Worker before this migration never reads them. No foreign key onto members, which 0006 rebuilt and may again.
--
-- Every CHECK lists the kinds, statuses, events and reason codes planned now, so a later kind needs no table rebuild
-- (the rooms design's rule); the code decides which are live (worker/proposals.ts). The first slice uses the
-- draft_document kind and the pending, approved and rejected statuses only.

-- One row per proposal. What the AI proposed (kind, title, why, body, who it was made as, which AI) never changes after
-- the INSERT; a person's decision fills the decided_* columns and decision_id once, and an edit before approving goes in final_title and
-- final_body, so both what the AI wrote and what the person approved are kept. Expiry is derived from expires_at, never
-- stored as a status, so no job has to run on time.
CREATE TABLE proposals (
  id            TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),     -- random (crypto.randomUUID), never sequential
  kind          TEXT NOT NULL CHECK (kind IN (
                  'draft_document', 'filled_template', 'checklist_update', 'prepared_filing', 'prepared_message')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  why           TEXT NOT NULL CHECK (length(why) BETWEEN 1 AND 2000),
  body          TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 60000),
  proposed_by   TEXT NOT NULL CHECK (proposed_by = lower(proposed_by) AND length(proposed_by) BETWEEN 3 AND 320),
  via           TEXT CHECK (via IS NULL OR length(via) BETWEEN 1 AND 80),  -- the AI app's name, as audit_log.via
  client_kind   TEXT NOT NULL CHECK (client_kind IN ('claude', 'harvey', 'microsoft', 'unknown', 'ask')),
  -- 1 when the title, why or body reads as instructions to an AI (worker/quarantine.ts): the reviewer is warned.
  untrusted     INTEGER NOT NULL DEFAULT 0 CHECK (untrusted IN (0, 1)),
  created_at    TEXT NOT NULL CHECK (length(created_at) BETWEEN 20 AND 24),
  expires_at    TEXT NOT NULL CHECK (length(expires_at) BETWEEN 20 AND 24 AND expires_at > created_at),
  decided_by    TEXT CHECK (decided_by IS NULL OR decided_by = lower(decided_by)),
  decided_at    TEXT CHECK (decided_at IS NULL OR length(decided_at) BETWEEN 20 AND 24),
  -- A fresh random id per decision: the decision's event is written only when this decision's UPDATE took effect, so a
  -- replay, even in the same millisecond by the same person, writes nothing.
  decision_id   TEXT UNIQUE CHECK (decision_id IS NULL OR length(decision_id) BETWEEN 1 AND 64),
  final_title   TEXT CHECK (final_title IS NULL OR length(final_title) BETWEEN 1 AND 200),
  final_body    TEXT CHECK (final_body IS NULL OR length(final_body) BETWEEN 1 AND 60000),
  reject_reason TEXT CHECK (reject_reason IS NULL OR reject_reason IN ('not_needed', 'incorrect', 'unsafe', 'duplicate', 'other')),
  -- A pending proposal has no decision; a decided one names who and when; only an approval has a final text, only a
  -- rejection a reason.
  CHECK ((status = 'pending') = (decided_by IS NULL)),
  CHECK ((decided_by IS NULL) = (decided_at IS NULL) AND (decided_by IS NULL) = (decision_id IS NULL)),
  CHECK (status = 'approved' OR (final_title IS NULL AND final_body IS NULL)),
  CHECK ((status = 'rejected') = (reject_reason IS NOT NULL))
);
CREATE INDEX proposals_status_created ON proposals (status, created_at);
CREATE INDEX proposals_by_created ON proposals (proposed_by, created_at);

-- The documents a proposal cites, with each document's updated_at when it was proposed. Approval is refused when any
-- of them has changed since, so a person never approves a draft built on a version that is gone.
CREATE TABLE proposal_sources (
  proposal_id         TEXT NOT NULL REFERENCES proposals (id),
  position            INTEGER NOT NULL CHECK (position BETWEEN 0 AND 49),
  document_id         TEXT NOT NULL CHECK (length(document_id) BETWEEN 1 AND 64),
  page                INTEGER CHECK (page IS NULL OR page BETWEEN 1 AND 100000),
  document_updated_at TEXT NOT NULL,
  PRIMARY KEY (proposal_id, position)
);

-- Who did what to a proposal, when, and through which AI. Codes only: never a title, body, reason text or file name.
CREATE TABLE proposal_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  proposal_id TEXT NOT NULL CHECK (length(proposal_id) BETWEEN 1 AND 64),
  action      TEXT NOT NULL CHECK (action IN (
                'proposed', 'approved', 'approved_edited', 'rejected', 'approve_refused', 'withdrawn',
                'downloaded', 'applied', 'apply_failed', 'sent', 'filed')),
  actor_email TEXT NOT NULL CHECK (actor_email = lower(actor_email) AND length(actor_email) BETWEEN 3 AND 320),
  via         TEXT CHECK (via IS NULL OR length(via) BETWEEN 1 AND 80),
  detail_code TEXT CHECK (detail_code IS NULL OR (length(detail_code) BETWEEN 1 AND 40 AND detail_code NOT GLOB '*[^a-z_]*')),
  ip          TEXT,
  user_agent  TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 256)
);
CREATE INDEX proposal_events_proposal ON proposal_events (proposal_id, id);
CREATE INDEX proposal_events_actor_ts ON proposal_events (actor_email, action, ts);

-- Append-only events and sources: no row is changed or removed, by the Worker or by a mistake.
CREATE TRIGGER proposal_events_no_update BEFORE UPDATE ON proposal_events
BEGIN
  SELECT RAISE(ABORT, 'proposal events are append-only');
END;

CREATE TRIGGER proposal_events_no_delete BEFORE DELETE ON proposal_events
BEGIN
  SELECT RAISE(ABORT, 'proposal events are append-only');
END;

CREATE TRIGGER proposal_sources_no_update BEFORE UPDATE ON proposal_sources
BEGIN
  SELECT RAISE(ABORT, 'proposal sources are fixed');
END;

CREATE TRIGGER proposal_sources_no_delete BEFORE DELETE ON proposal_sources
BEGIN
  SELECT RAISE(ABORT, 'proposal sources are fixed');
END;

-- A proposal is never deleted, what the AI proposed never changes, and a decision is made once.
CREATE TRIGGER proposals_no_delete BEFORE DELETE ON proposals
BEGIN
  SELECT RAISE(ABORT, 'proposals are kept');
END;

CREATE TRIGGER proposals_fixed BEFORE UPDATE OF id, kind, title, why, body, proposed_by, via, client_kind, untrusted, created_at, expires_at ON proposals
BEGIN
  SELECT RAISE(ABORT, 'what was proposed is fixed');
END;

CREATE TRIGGER proposals_decided_once BEFORE UPDATE ON proposals WHEN OLD.status <> 'pending'
BEGIN
  SELECT RAISE(ABORT, 'proposal already decided');
END;
