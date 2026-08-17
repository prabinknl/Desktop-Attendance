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

export interface DeviceFormValues {
  name: string;
  brand: DeviceBrand;
  model: string;
  location: string;
  description: string;
  ipAddress: string;
  port: number;
  username: string;
  password: string;
  connectionMode?: ConnectionMode;
}

export interface ConnectionTestResult {
  online: boolean;
  authState?: DeviceAuthState;
  latencyMs: number;
  message: string;
  fromRealDevice?: boolean;
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

export interface SyncResult {
  downloaded: number;
  inserted: number;
  duplicates: number;
  failed: number;
  synced: number;
  skipped: number;
  total: number;
  rangeStart: string;
  rangeEnd: string;
}

export const DEVICE_BRANDS: { value: DeviceBrand; label: string }[] = [
  { value: 'hikvision', label: 'Hikvision' },
  { value: 'zkteco', label: 'ZKTeco (not yet supported)' },
  { value: 'essl', label: 'eSSL (not yet supported)' },
  { value: 'suprema', label: 'Suprema (not yet supported)' },
  { value: 'other', label: 'Other (not yet supported)' },
];

export const SYNC_INTERVALS = [
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
];

export const DEFAULT_PORTS: Record<DeviceBrand, number> = {
  hikvision: 80,
  zkteco: 4370,
  essl: 4370,
  suprema: 1470,
  other: 80,
};
