-- When this room's database took each change to who sees what. A migration applies at deploy, so a row dates the room's
-- own deploy, not the pull request. worker/versions.ts roomAsOf applies a rule to a past instant only from its row (#884).
-- Additive and backward compatible (REVIEW.md item 3): one new table and one row; the Worker before it never reads it.
CREATE TABLE rule_changes (
  name TEXT PRIMARY KEY CHECK (length(name) BETWEEN 1 AND 64),
  at   TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', at) IS at)
);

-- #881: counsel in a matter room see privileged documents.
INSERT INTO rule_changes (name, at) VALUES ('counsel_sees_privileged', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
