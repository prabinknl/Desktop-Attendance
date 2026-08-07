-- Invitation tokens table — stores invite links server-side so any
-- browser (not just the admin's) can validate them.

CREATE TABLE IF NOT EXISTS invitations (
  token      TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(LOWER(email));
