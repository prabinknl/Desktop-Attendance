-- Migration for Admin Signup Flow status and email verification
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_app_users_status ON app_users(status);
