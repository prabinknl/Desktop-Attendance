import { env } from '../../config/env.js';
import type { ConnectionMode, DeviceRecord, DevicePublic, DeviceStatus } from '../../types/index.js';

export const CONNECTOR_MISSED_BEFORE_OFFLINE = 3;

export function resolveConnectionMode(record: DeviceRecord): ConnectionMode {
  if (record.connection_mode === 'cloud_connector') return 'cloud_connector';
  if (record.connection_mode === 'local_direct') return 'local_direct';
  return env.deviceSyncEnabled ? 'local_direct' : 'cloud_connector';
}

export function connectorHeartbeatGraceMs(): number {
  return env.connectorHeartbeatSeconds * 1000 * CONNECTOR_MISSED_BEFORE_OFFLINE;
}

export interface ComputedDevicePresence {
  connectionMode: ConnectionMode;
  connectorOnline: boolean;
  deviceOnline: boolean;
  computedStatus: DeviceStatus;
  gatewayStatus: 'online' | 'offline';
  gatewayError: string | null;
}

export function computeDevicePresence(record: DeviceRecord): ComputedDevicePresence {
  const connectionMode = resolveConnectionMode(record);
  const now = Date.now();
  const heartbeatMs = record.gateway_last_heartbeat
    ? new Date(record.gateway_last_heartbeat).getTime()
    : 0;
  const intervalMs = env.connectorHeartbeatSeconds * 1000;
  const ageMs = heartbeatMs > 0 ? now - heartbeatMs : Number.POSITIVE_INFINITY;
  const missed =
    heartbeatMs > 0 ? Math.floor(ageMs / intervalMs) : CONNECTOR_MISSED_BEFORE_OFFLINE;
  const connectorOnline = heartbeatMs > 0 && missed < CONNECTOR_MISSED_BEFORE_OFFLINE;

  const gatewayError =
    connectorOnline
      ? record.gateway_error ?? null
      : record.gateway_error ||
        record.last_connector_error ||
        'Connector offline: no heartbeat (run the Windows connector on your LAN)';

  if (connectionMode === 'cloud_connector') {
    const deviceAuthRecent =
      record.last_device_auth_at &&
      now - new Date(record.last_device_auth_at).getTime() < connectorHeartbeatGraceMs();
    const deviceOnline =
      connectorOnline && record.status === 'online' && Boolean(deviceAuthRecent);

    const computedStatus: DeviceStatus = deviceOnline
      ? 'online'
      : record.status === 'syncing'
        ? 'syncing'
        : record.status === 'connecting'
          ? 'connecting'
          : 'offline';

    return {
      connectionMode,
      connectorOnline,
      deviceOnline,
      computedStatus,
      gatewayStatus: connectorOnline ? 'online' : 'offline',
      gatewayError,
    };
  }

  const directOnline =
    record.status === 'online' || record.status === 'syncing' || record.status === 'connecting';
  const deviceOnline = record.status === 'online';

  return {
    connectionMode,
    connectorOnline,
    deviceOnline,
    computedStatus: directOnline ? record.status : 'offline',
    gatewayStatus: connectorOnline ? 'online' : 'offline',
    gatewayError,
  };
}

export function applyPresenceToPublic(
  record: DeviceRecord,
  presence: ComputedDevicePresence,
): DevicePublic {
  return {
    id: record.id,
    name: record.name,
    brand: record.brand,
    model: record.model,
    ipAddress: record.ip_address,
    port: record.port,
    username: record.username,
    location: record.location,
    description: record.description,
    status: presence.computedStatus,
    autoSyncEnabled: record.auto_sync_enabled,
    syncIntervalSeconds: record.sync_interval_seconds,
    lastSync: record.last_sync,
    lastAttendanceReceived: record.last_attendance_received,
    deviceTime: record.device_time,
    macAddress: record.mac_address,
    gatewayStatus: presence.gatewayStatus,
    gatewayLastHeartbeat: record.gateway_last_heartbeat,
    gatewayError: presence.gatewayError,
    lastConnectionSuccess: record.last_connection_success,
    connectionMode: presence.connectionMode,
    hasConnectorToken: Boolean(record.connector_token_hash),
  };
}
