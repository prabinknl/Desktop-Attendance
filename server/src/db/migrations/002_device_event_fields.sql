-- Extend device attendance logs for real Hikvision events
-- source distinguishes production device data from any legacy rows

ALTER TABLE device_attendance_logs ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'hikvision-device';
ALTER TABLE device_attendance_logs ADD COLUMN IF NOT EXISTS auth_method VARCHAR(100);
ALTER TABLE device_attendance_logs ADD COLUMN IF NOT EXISTS card_number VARCHAR(100);
ALTER TABLE device_attendance_logs ADD COLUMN IF NOT EXISTS raw_event_code VARCHAR(50);
ALTER TABLE device_attendance_logs ADD COLUMN IF NOT EXISTS event_type VARCHAR(50);

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS source VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_device_logs_source
  ON device_attendance_logs(source);

CREATE INDEX IF NOT EXISTS idx_attendance_source
  ON attendance(source)
  WHERE source IS NOT NULL;
