-- Connection mode: local_direct (API reaches LAN) vs cloud_connector (on-prem agent)

ALTER TABLE devices ADD COLUMN IF NOT EXISTS connection_mode VARCHAR(32) NOT NULL DEFAULT 'local_direct';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS connector_token_hash TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS connector_missed_heartbeats INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_device_auth_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_connector_error TEXT;
