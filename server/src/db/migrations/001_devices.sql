-- Device management & attendance sync schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  brand VARCHAR(50) NOT NULL,
  model VARCHAR(100),
  ip_address VARCHAR(45) NOT NULL,
  port INTEGER NOT NULL DEFAULT 80,
  username VARCHAR(100),
  password_encrypted TEXT,
  location VARCHAR(255),
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'offline',
  auto_sync_enabled BOOLEAN NOT NULL DEFAULT false,
  sync_interval_seconds INTEGER NOT NULL DEFAULT 60,
  last_sync TIMESTAMPTZ,
  last_attendance_received TIMESTAMPTZ,
  device_time TIMESTAMPTZ,
  mac_address VARCHAR(17),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_attendance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  external_id VARCHAR(255) NOT NULL,
  employee_id VARCHAR(100),
  employee_name VARCHAR(255),
  check_type VARCHAR(50) NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  raw_data JSONB,
  synced_to_attendance BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(device_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_device_logs_device_time
  ON device_attendance_logs(device_id, event_time DESC);

CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id VARCHAR(100) NOT NULL,
  department_id VARCHAR(100),
  date DATE NOT NULL,
  shift_id VARCHAR(100),
  check_in TIME,
  check_out TIME,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  working_hours DECIMAL(5, 2) NOT NULL DEFAULT 0,
  overtime DECIMAL(5, 2) NOT NULL DEFAULT 0,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'present',
  location VARCHAR(255),
  remarks TEXT,
  source_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  created_by VARCHAR(100) NOT NULL DEFAULT 'device-sync',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date DESC);
