-- Migration for Client Admin invitations and user organization fields

ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS id TEXT;
ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'free';
ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS duration_days NUMERIC;
ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS access_start_at TIMESTAMPTZ;
ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ;
ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS token_hash TEXT;
ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS sms_code_hash TEXT;
ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS sms_expires_at TIMESTAMPTZ;
ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS sms_attempts INT DEFAULT 0;
ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS sms_last_sent_at TIMESTAMPTZ;
ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE app_invitations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add client & subscription fields to app_users
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS plan_type TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_app_invitations_token_hash ON app_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_app_invitations_email_role ON app_invitations(LOWER(email), role);
CREATE INDEX IF NOT EXISTS idx_app_users_client_id ON app_users(client_id);
