-- The company's own facts as the room owner sets them on /checklist/ (worker/company-settings.ts): entity type, formation
-- date and Colorado periodic report month. Until the owner saves, the room config's entityType and formationDate stand.
-- One row per save, never changed or removed: the newest row is the setting, the rest say who set what, and when.
-- Additive and backward compatible (REVIEW.md item 3): one new table and its triggers; nothing reads it while
-- CHECKLIST_ENABLED is off, and the Worker on main never does.

CREATE TABLE company_settings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type    TEXT CHECK (entity_type IS NULL OR length(entity_type) BETWEEN 1 AND 60),
  formation_date TEXT CHECK (formation_date IS NULL OR date(formation_date) IS formation_date),
  report_month   INTEGER CHECK (report_month IS NULL OR report_month BETWEEN 1 AND 12),
  set_by         TEXT NOT NULL CHECK (length(set_by) BETWEEN 1 AND 254),
  set_at         TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', set_at) IS set_at)
);

CREATE TRIGGER company_settings_no_update BEFORE UPDATE ON company_settings
BEGIN
  SELECT RAISE(ABORT, 'company_settings is append-only');
END;

CREATE TRIGGER company_settings_no_delete BEFORE DELETE ON company_settings
BEGIN
  SELECT RAISE(ABORT, 'company_settings is append-only');
END;
