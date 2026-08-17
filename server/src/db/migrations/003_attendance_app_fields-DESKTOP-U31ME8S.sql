-- Add manual_override column and missing columns to attendance table
-- to support app-side records (not just device-synced ones)

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS manual_override BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS app_id TEXT;

-- Allow any employee_id format (not just UUID) by making text columns flexible
-- attendance.id: change to TEXT to support app-generated ids like 'att-xxxx'
-- Note: We can't change PRIMARY KEY type in-place, so we add an alternative lookup column

-- Add index for employee lookups
CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, date);

-- App-created attendance rows will use app_id as their client-side identifier
-- The server will use UUID as primary key; app_id is the client-supplied key for lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_app_id ON attendance(app_id) WHERE app_id IS NOT NULL;
