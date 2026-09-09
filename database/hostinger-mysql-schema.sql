-- Hostinger MySQL/MariaDB schema for Attendance Desktop
-- Import this file in hPanel → Databases → phpMyAdmin (or MySQL section).
-- Do NOT use the PostgreSQL files under server/src/db/migrations/ against MySQL.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS devices (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  brand VARCHAR(50) NOT NULL,
  model VARCHAR(100) NULL,
  ip_address VARCHAR(45) NOT NULL,
  port INT NOT NULL DEFAULT 80,
  username VARCHAR(100) NULL,
  password_encrypted TEXT NULL,
  location VARCHAR(255) NULL,
  description TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'offline',
  auto_sync_enabled TINYINT(1) NOT NULL DEFAULT 0,
  sync_interval_seconds INT NOT NULL DEFAULT 60,
  last_sync DATETIME(3) NULL,
  last_attendance_received DATETIME(3) NULL,
  device_time DATETIME(3) NULL,
  mac_address VARCHAR(17) NULL,
  gateway_status VARCHAR(20) NOT NULL DEFAULT 'offline',
  gateway_last_heartbeat DATETIME(3) NULL,
  gateway_error TEXT NULL,
  last_connection_success DATETIME(3) NULL,
  pending_command JSON NULL,
  command_result JSON NULL,
  connection_mode VARCHAR(32) NOT NULL DEFAULT 'local_direct',
  connector_token_hash TEXT NULL,
  connector_missed_heartbeats INT NOT NULL DEFAULT 0,
  last_device_auth_at DATETIME(3) NULL,
  last_connector_error TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS device_attendance_logs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  device_id CHAR(36) NOT NULL,
  external_id VARCHAR(255) NOT NULL,
  employee_id VARCHAR(100) NULL,
  employee_name VARCHAR(255) NULL,
  check_type VARCHAR(50) NOT NULL,
  event_time DATETIME(3) NOT NULL,
  raw_data JSON NULL,
  synced_to_attendance TINYINT(1) NOT NULL DEFAULT 0,
  source VARCHAR(50) NOT NULL DEFAULT 'hikvision-device',
  auth_method VARCHAR(100) NULL,
  card_number VARCHAR(100) NULL,
  raw_event_code VARCHAR(50) NULL,
  event_type VARCHAR(50) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_device_external (device_id, external_id),
  KEY idx_device_logs_device_time (device_id, event_time),
  KEY idx_device_logs_source (source),
  CONSTRAINT fk_device_logs_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance (
  id CHAR(36) NOT NULL PRIMARY KEY,
  employee_id VARCHAR(100) NOT NULL,
  department_id VARCHAR(100) NULL,
  date DATE NOT NULL,
  shift_id VARCHAR(100) NULL,
  check_in TIME NULL,
  check_out TIME NULL,
  manual_check_in TIME NULL,
  manual_check_out TIME NULL,
  break_minutes INT NOT NULL DEFAULT 0,
  working_hours DECIMAL(5, 2) NOT NULL DEFAULT 0,
  overtime DECIMAL(5, 2) NOT NULL DEFAULT 0,
  late_minutes INT NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'present',
  location VARCHAR(255) NULL,
  remarks TEXT NULL,
  source_device_id CHAR(36) NULL,
  created_by VARCHAR(100) NOT NULL DEFAULT 'device-sync',
  manual_override TINYINT(1) NOT NULL DEFAULT 0,
  app_id VARCHAR(100) NULL,
  source VARCHAR(50) NULL,
  check_in_edited TINYINT(1) NOT NULL DEFAULT 0,
  check_out_edited TINYINT(1) NOT NULL DEFAULT 0,
  check_in_edited_by TEXT NULL,
  check_out_edited_by TEXT NULL,
  check_in_edited_at DATETIME(3) NULL,
  check_out_edited_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_attendance_employee_date (employee_id, date),
  UNIQUE KEY uq_attendance_app_id (app_id),
  KEY idx_attendance_date (date),
  KEY idx_attendance_employee (employee_id),
  KEY idx_attendance_source (source),
  CONSTRAINT fk_attendance_device FOREIGN KEY (source_device_id) REFERENCES devices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_users (
  id VARCHAR(100) NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  password TEXT NOT NULL,
  avatar TEXT NULL,
  phone TEXT NULL,
  timezone TEXT NULL,
  employee_id TEXT NULL,
  department_id TEXT NULL,
  client_id TEXT NULL,
  plan_type VARCHAR(20) NULL,
  access_expires_at DATETIME(3) NULL,
  phone_verified TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  email_verified TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_app_users_email (email),
  KEY idx_app_users_role (role),
  KEY idx_app_users_client_id (client_id(64)),
  KEY idx_app_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_invitations (
  token VARCHAR(128) NOT NULL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name TEXT NULL,
  role VARCHAR(50) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  used TINYINT(1) NOT NULL DEFAULT 0,
  id TEXT NULL,
  client_id TEXT NULL,
  phone TEXT NULL,
  company_name TEXT NULL,
  plan_type VARCHAR(20) DEFAULT 'free',
  duration_days DECIMAL(10, 2) NULL,
  access_start_at DATETIME(3) NULL,
  access_expires_at DATETIME(3) NULL,
  token_hash VARCHAR(128) NULL,
  sms_code_hash VARCHAR(128) NULL,
  sms_expires_at DATETIME(3) NULL,
  sms_attempts INT NOT NULL DEFAULT 0,
  sms_last_sent_at DATETIME(3) NULL,
  status VARCHAR(50) DEFAULT 'pending',
  created_by TEXT NULL,
  updated_at DATETIME(3) NULL,
  KEY idx_app_invitations_email (email),
  KEY idx_app_invitations_token_hash (token_hash),
  KEY idx_app_invitations_email_role (email, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS departments (
  id VARCHAR(100) NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  manager_id TEXT NOT NULL,
  description TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shifts (
  id VARCHAR(100) NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  start_time VARCHAR(16) NOT NULL DEFAULT '09:00',
  end_time VARCHAR(16) NOT NULL DEFAULT '18:00',
  break_minutes INT NOT NULL DEFAULT 60,
  grace_minutes INT NOT NULL DEFAULT 15,
  working_hours DECIMAL(5, 2) NOT NULL DEFAULT 8,
  working_days JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS holidays (
  id VARCHAR(100) NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  date DATE NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'public',
  source TEXT NULL,
  KEY idx_holidays_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employees (
  id VARCHAR(100) NOT NULL PRIMARY KEY,
  employee_id VARCHAR(100) NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  department_id TEXT NOT NULL,
  designation TEXT NOT NULL,
  manager_id TEXT NULL,
  joining_date DATE NULL,
  employment_type VARCHAR(50) NOT NULL DEFAULT 'full_time',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  shift_id VARCHAR(100) NOT NULL DEFAULT 's1',
  address TEXT NULL,
  emergency_contact JSON NULL,
  avatar TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY idx_employees_employee_id (employee_id),
  KEY idx_employees_department (department_id(64))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leave_requests (
  id VARCHAR(100) NOT NULL PRIMARY KEY,
  employee_id VARCHAR(100) NOT NULL,
  leave_type VARCHAR(50) NOT NULL DEFAULT 'annual',
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  total_days DECIMAL(8, 2) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  attachment_url TEXT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  comments TEXT NULL,
  approved_by TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_leave_requests_employee (employee_id),
  KEY idx_leave_requests_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS punch_time_requests (
  id VARCHAR(100) NOT NULL PRIMARY KEY,
  employee_id VARCHAR(100) NOT NULL,
  attendance_id TEXT NULL,
  date DATE NOT NULL,
  kind VARCHAR(50) NOT NULL DEFAULT 'edit',
  requested_check_in TEXT NULL,
  requested_check_out TEXT NULL,
  previous_check_in TEXT NULL,
  previous_check_out TEXT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  comments TEXT NULL,
  approved_by TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_punch_requests_employee (employee_id),
  KEY idx_punch_requests_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS verification_codes (
  email VARCHAR(255) NOT NULL PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_sent_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_admin_invitations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(64) NOT NULL,
  company_name TEXT NULL,
  plan_type VARCHAR(20) NOT NULL DEFAULT 'free',
  duration_days DECIMAL(10, 2) NOT NULL DEFAULT 30,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  invitation_token TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_client_admin_invitations_email (email),
  KEY idx_client_admin_invitations_phone (phone),
  KEY idx_client_admin_invitations_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
