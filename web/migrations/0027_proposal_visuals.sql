-- A visual saved by a member's AI (worker/proposal-visual.ts): a draft_document proposal whose body is a self-contained
-- HTML page, and once its member approves it, a page in the room's binder. Off with PROPOSALS_ENABLED, like 0013.
-- Additive and backward compatible (REVIEW.md item 3): one new table and its triggers; the Worker before it never reads it.

-- One row per visual proposal, written in the proposing batch. `page` is the page the room prepared from the approved
-- HTML (worker/visualprep.ts), written once in the approving batch and only when that approval took effect.
CREATE TABLE proposal_visuals (
  proposal_id TEXT PRIMARY KEY REFERENCES proposals (id),
  -- 1: shown only to roles with viewPrivileged. Counsel's AI saves privileged unless it says otherwise.
  privileged  INTEGER NOT NULL CHECK (privileged IN (0, 1)),
  page        TEXT CHECK (page IS NULL OR length(page) BETWEEN 1 AND 120000)
);

CREATE TRIGGER proposal_visuals_no_delete BEFORE DELETE ON proposal_visuals
BEGIN
  SELECT RAISE(ABORT, 'proposal visuals are kept');
END;

CREATE TRIGGER proposal_visuals_fixed BEFORE UPDATE OF proposal_id, privileged ON proposal_visuals
BEGIN
  SELECT RAISE(ABORT, 'what was proposed is fixed');
END;

CREATE TRIGGER proposal_visuals_page_once BEFORE UPDATE OF page ON proposal_visuals WHEN OLD.page IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'the approved page is fixed');
END;
