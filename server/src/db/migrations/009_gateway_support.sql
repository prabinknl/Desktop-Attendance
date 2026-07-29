-- Add local gateway support columns to devices table

ALTER TABLE devices ADD COLUMN IF NOT EXISTS gateway_status VARCHAR(20) NOT NULL DEFAULT 'offline';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS gateway_last_heartbeat TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS gateway_error TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_connection_success TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS pending_command JSONB;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS command_result JSONB;

CREATE INDEX IF NOT EXISTS idx_devices_gateway_status ON devices(gateway_status);
