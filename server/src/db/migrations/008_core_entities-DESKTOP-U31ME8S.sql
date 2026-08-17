-- Core app entities that previously lived only in browser localStorage.
-- Moving them into PostgreSQL lets every device (local dev and the hosted
-- frontend) see the same employees, leave requests and punch requests.
-- Ids are client-generated strings ('e-xxx', 'lr-xxx', 'd0', 's1'), so TEXT
-- primary keys are used rather than the app_id indirection the attendance
-- table needs for its (employee_id, date) upsert key.

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  manager_id TEXT NOT NULL DEFAULT '',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '09:00',
  end_time TEXT NOT NULL DEFAULT '18:00',
  break_minutes INTEGER NOT NULL DEFAULT 60,
  grace_minutes INTEGER NOT NULL DEFAULT 15,
  working_hours NUMERIC NOT NULL DEFAULT 8,
  working_days JSONB NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS holidays (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date DATE NOT NULL,
  type TEXT NOT NULL DEFAULT 'public',
  source TEXT
);

CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  department_id TEXT NOT NULL DEFAULT '',
  designation TEXT NOT NULL DEFAULT '',
  manager_id TEXT,
  joining_date DATE,
  employment_type TEXT NOT NULL DEFAULT 'full_time',
  status TEXT NOT NULL DEFAULT 'active',
  shift_id TEXT NOT NULL DEFAULT 's1',
  address TEXT,
  emergency_contact JSONB,
  avatar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_employee_id ON employees(employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  leave_type TEXT NOT NULL DEFAULT 'annual',
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  total_days NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  attachment_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  comments TEXT,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);

CREATE TABLE IF NOT EXISTS punch_time_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  attendance_id TEXT,
  date DATE NOT NULL,
  kind TEXT NOT NULL DEFAULT 'edit',
  requested_check_in TEXT,
  requested_check_out TEXT,
  previous_check_in TEXT,
  previous_check_out TEXT,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  comments TEXT,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_punch_requests_employee ON punch_time_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_punch_requests_status ON punch_time_requests(status);
