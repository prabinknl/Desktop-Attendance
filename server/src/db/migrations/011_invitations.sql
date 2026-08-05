-- Table for storing invitation tokens so they can be validated across any browser/device
CREATE TABLE IF NOT EXISTS app_invitations (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_app_invitations_token ON app_invitations(token);
CREATE INDEX IF NOT EXISTS idx_app_invitations_email ON app_invitations(LOWER(email));
