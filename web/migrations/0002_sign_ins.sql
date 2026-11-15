-- Sign-in alerts (Access hardening item 6). One row per Access session: Access issues a new
-- application token (a new `iat`) at each login and then resends the same token until the session
-- ends, so a never-before-seen (sub, iat) pair is a new sign-in. The Worker inserts with
-- INSERT OR IGNORE and emails the owner only when a row was actually inserted.
CREATE TABLE sign_ins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL CHECK (email = lower(email)),
  sub        TEXT,                            -- Access user id; NULL if the token has none
  iat        INTEGER NOT NULL,                -- token issued-at, seconds since the epoch
  country    TEXT,                            -- the token's `country` claim (ISO 3166 alpha-2)
  user_agent TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- A plain UNIQUE (sub, iat) would never match when sub is NULL (NULLs are distinct in SQLite),
-- so the key falls back to the email inside the index itself.
CREATE UNIQUE INDEX sign_ins_session ON sign_ins (COALESCE(sub, email), iat);
CREATE INDEX sign_ins_created ON sign_ins (created_at);

-- The owner's activity page filters by person.
CREATE INDEX audit_log_email_ts ON audit_log (email, ts);
