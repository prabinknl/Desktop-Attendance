-- Table for saving user accounts (admin, hr, employee) in InsForge PostgreSQL Cloud DB
-- so accounts persist across computers, logouts, and browser restarts.

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL,
  password TEXT NOT NULL,
  avatar TEXT,
  phone TEXT,
  timezone TEXT,
  employee_id TEXT,
  department_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_app_users_role ON app_users(role);
