export type DeviceBrand = 'hikvision' | 'zkteco' | 'essl' | 'suprema' | 'other';
export type DeviceStatus = 'online' | 'offline' | 'connecting' | 'syncing';
export type DeviceAuthState =
  | 'authenticated'
  | 'authentication_failed'
  | 'reachable'
  | 'offline'
  | 'gateway_offline'
  | 'device_unreachable'
  | 'isapi_unsupported';

export type GatewayStatus = 'online' | 'offline';

export type ConnectionMode = 'local_direct' | 'cloud_connector';

export interface DeviceRecord {
  id: string;
  name: string;
  brand: DeviceBrand;
  model: string | null;
  ip_address: string;
  port: number;
  username: string | null;
  password_encrypted: string | null;
  location: string | null;
  description: string | null;
  status: DeviceStatus;
  auto_sync_enabled: boolean;
  sync_interval_seconds: number;
  last_sync: string | null;
  last_attendance_received: string | null;
  device_time: string | null;
  mac_address: string | null;
  gateway_status?: GatewayStatus;
  gateway_last_heartbeat?: string | null;
  gateway_error?: string | null;
  last_connection_success?: string | null;
  connection_mode?: ConnectionMode;
  connector_token_hash?: string | null;
  connector_missed_heartbeats?: number;
  last_device_auth_at?: string | null;
  last_connector_error?: string | null;
  pending_command?: Record<string, unknown> | null;
  command_result?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Device config exposed to the frontend — never includes password. */
export interface DevicePublic {
  id: string;
  name: string;
  brand: DeviceBrand;
  model: string | null;
  ipAddress: string;
  port: number;
  username: string | null;
  location: string | null;
  description: string | null;
  status: DeviceStatus;
  autoSyncEnabled: boolean;
  syncIntervalSeconds: number;
  lastSync: string | null;
  lastAttendanceReceived: string | null;
  deviceTime: string | null;
  macAddress: string | null;
  gatewayStatus?: GatewayStatus;
  gatewayLastHeartbeat?: string | null;
  gatewayError?: string | null;
  lastConnectionSuccess?: string | null;
  connectionMode?: ConnectionMode;
  hasConnectorToken?: boolean;
}

export interface DeviceConnectPayload {
  name: string;
  brand: DeviceBrand;
  model?: string;
  ipAddress: string;
  port: number;
  username: string;
  password: string;
  location?: string;
  description?: string;
  connectionMode?: ConnectionMode;
}

export interface DeviceTestPayload {
  brand: DeviceBrand;
  ipAddress: string;
  port: number;
  username: string;
  /** Empty string reuses the saved device password when IP/port match. */
  password: string;
}

export interface ConnectionTestResult {
  online: boolean;
  /** authenticated = real digest login succeeded; reachable = port open only */
  authState?: DeviceAuthState;
  latencyMs: number;
  message: string;
  fromRealDevice?: boolean;
  /** Port that answered (may differ from the requested port after fallback). */
  resolvedPort?: number;
  deviceInfo?: {
    model?: string;
    serialNumber?: string;
    firmwareVersion?: string;
    deviceTime?: string;
    macAddress?: string;
  };
}

export interface DiscoveredDevice {
  brand: DeviceBrand;
  model: string;
  ipAddress: string;
  macAddress: string;
  port: number;
  status: 'reachable' | 'unreachable';
}

export interface AttendanceLogEntry {
  id: string;
  time: string;
  employeeId: string;
  employeeName: string;
  checkType: string;
  device: string;
  authMethod?: string | null;
  cardNumber?: string | null;
  source?: string | null;
  rawEventCode?: string | null;
}

export interface DeviceStatusResponse {
  status: DeviceStatus;
  /** Device authenticated on LAN (direct or via connector). */
  deviceOnline: boolean;
  connectorOnline: boolean;
  connectionMode: ConnectionMode;
  lastSync: string | null;
  lastAttendanceReceived: string | null;
  deviceTime: string | null;
  autoSyncEnabled: boolean;
  syncIntervalSeconds: number;
  gatewayStatus?: GatewayStatus;
  gatewayLastHeartbeat?: string | null;
  gatewayError?: string | null;
  lastConnectionSuccess?: string | null;
  lastDeviceAuthAt?: string | null;
  lastConnectorError?: string | null;
}

/**
 * Raw event from a physical device.
 * checkType is 'punch' unless the machine itself supplies attendanceStatus.
 */
export interface DeviceAttendanceEvent {
  externalId: string;
  employeeId: string;
  employeeName: string;
  checkType: 'check_in' | 'check_out' | 'punch' | 'unknown';
  eventTime: Date;
  authMethod?: string;
  cardNumber?: string;
  eventType?: string;
  majorEventType?: number;
  minorEventType?: number;
  serialNumber?: string;
  rawEventCode?: string;
  source?: string;
  rawData?: Record<string, unknown>;
}

export interface DeviceInfo {
  model: string;
  serialNumber?: string;
  firmwareVersion?: string;
  deviceTime?: Date;
  macAddress?: string;
}

export interface SyncResult {
  downloaded: number;
  inserted: number;
  duplicates: number;
  failed: number;
  /** @deprecated use inserted — kept for older UI */
  synced: number;
  skipped: number;
  total: number;
  rangeStart: string;
  rangeEnd: string;
}

export interface ScanResult {
  devices: DiscoveredDevice[];
  message?: string;
  discoveryAvailable: boolean;
}
