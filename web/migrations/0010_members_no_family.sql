-- The database refuses the retired 'family' role (the owner, 2026-10-20): members are the owner and counsel only
-- (worker/auth.ts PERMISSIONS). Purely additive: two triggers, and nothing else changes. No table is dropped,
-- renamed or rebuilt and no row is touched (REVIEW.md item 3), so every column, index and row stays as it was.
--
-- members' CHECK from 0006 still lists 'family', because changing a CHECK in SQLite means rebuilding the table. These
-- triggers narrow it instead: a new row, an upsert or a change of role to 'family' aborts with "family role retired".
-- The code refuses the role too: findMember treats a role it does not know as no member, canPerform allows it
-- nothing, the MCP sweep revokes its grants, and npm run member refuses to add it.
-- Backward compatible: the Worker before this migration never writes 'family' (only npm run member could).
CREATE TRIGGER members_no_family_insert BEFORE INSERT ON members WHEN NEW.role = 'family'
BEGIN
  SELECT RAISE(ABORT, 'family role retired');
END;

CREATE TRIGGER members_no_family_update BEFORE UPDATE OF role ON members WHEN NEW.role = 'family'
BEGIN
  SELECT RAISE(ABORT, 'family role retired');
END;
