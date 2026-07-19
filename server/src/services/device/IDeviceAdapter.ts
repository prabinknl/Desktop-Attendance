import type {
  ConnectionTestResult,
  DeviceAttendanceEvent,
  DeviceBrand,
  DeviceInfo,
} from '../../types/index.js';

/**
 * Common interface for all attendance device brands.
 * Future adapters (ZKTeco, eSSL, Suprema) implement this contract.
 */
export interface IDeviceAdapter {
  readonly brand: DeviceBrand;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<ConnectionTestResult>;
  getDeviceInfo(): Promise<DeviceInfo>;
  getAttendanceLogs(since?: Date, until?: Date): Promise<DeviceAttendanceEvent[]>;
  syncAttendance(since?: Date, until?: Date): Promise<DeviceAttendanceEvent[]>;
  diagnose?(since?: Date, until?: Date): Promise<{
    fromRealDevice: boolean;
    model?: string;
    serialNumber?: string;
    firmwareVersion?: string;
    deviceTime?: string;
    macAddress?: string;
    rawEventCount: number;
    firstEventTime?: string;
    lastEventTime?: string;
    capabilitiesSnippet?: string;
    probeAttempts?: Array<{ name: string; status: number; error?: string; bodyPreview?: string }>;
  }>;
}

export interface DeviceConnectionConfig {
  ipAddress: string;
  port: number;
  username: string;
  password: string;
  model?: string;
  useHttps?: boolean;
}
