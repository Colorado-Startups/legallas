-- The audit log is append-only (litigation room, card #126; research A1; FRE 902(13), (14)): no role, route or
-- mistake changes or removes a row, as access_events (0012) and proposal_events (0013) already are. Purely
-- additive: three triggers, nothing else changes. The Worker on main only inserts into audit_log, so it keeps working.
-- Any later migration that rebuilds audit_log must create all three again.

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

-- INSERT OR REPLACE on an existing id deletes without firing delete triggers (recursive triggers are off), so a new
-- row may not take an id already in use.
CREATE TRIGGER audit_log_no_replace BEFORE INSERT ON audit_log WHEN EXISTS (SELECT 1 FROM audit_log WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
