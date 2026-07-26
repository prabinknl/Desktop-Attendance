import apiClient from './client';
import type {
  AttendanceLogEntry,
  ConnectionTestResult,
  DeviceFormValues,
  DevicePublic,
  DeviceStatusResponse,
  DiscoveredDevice,
  SyncResult,
} from '../types/device';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  discoveryAvailable?: boolean;
}

function toPayload(form: DeviceFormValues) {
  return {
    name: form.name,
    brand: form.brand,
    model: form.model || undefined,
    ipAddress: form.ipAddress,
    port: Number(form.port),
    username: form.username,
    password: form.password,
    location: form.location || undefined,
    description: form.description || undefined,
  };
}

export const deviceApi = {
  getDevice: async (): Promise<DevicePublic | null> => {
    const { data } = await apiClient.get<ApiResponse<DevicePublic | null>>('/devices');
    return data.data;
  },

  saveDevice: async (form: DeviceFormValues): Promise<DevicePublic> => {
    const { data } = await apiClient.post<ApiResponse<DevicePublic>>('/devices', toPayload(form));
    return data.data;
  },

  connect: async (form: DeviceFormValues): Promise<DevicePublic> => {
    const { data } = await apiClient.post<ApiResponse<DevicePublic>>(
      '/devices/connect',
      toPayload(form),
    );
    return data.data;
  },

  test: async (
    form: Pick<DeviceFormValues, 'brand' | 'ipAddress' | 'port' | 'username' | 'password'>,
  ): Promise<ConnectionTestResult> => {
    const { data } = await apiClient.post<ApiResponse<ConnectionTestResult>>(
      '/devices/test-connection',
      {
        brand: form.brand,
        ipAddress: form.ipAddress,
        port: Number(form.port),
        username: form.username,
        password: form.password,
      },
    );
    return data.data;
  },

  disconnect: async (): Promise<void> => {
    await apiClient.post('/devices/disconnect');
  },

  getStatus: async (): Promise<DeviceStatusResponse> => {
    const { data } = await apiClient.get<ApiResponse<DeviceStatusResponse>>('/devices/status');
    return data.data;
  },

  getLogs: async (
    deviceId?: string,
    range?: { from?: string; to?: string },
  ): Promise<AttendanceLogEntry[]> => {
    const path = deviceId ? `/devices/${deviceId}/attendance` : '/devices/logs';
    const params: Record<string, string> = {};
    if (range?.from) params.from = range.from;
    if (range?.to) params.to = range.to;
    const { data } = await apiClient.get<ApiResponse<AttendanceLogEntry[]>>(path, {
      params: Object.keys(params).length ? params : undefined,
    });
    return data.data;
  },

  sync: async (range?: { startTime?: string; endTime?: string }): Promise<SyncResult> => {
    const { data } = await apiClient.post<ApiResponse<SyncResult>>('/devices/sync', range ?? {});
    return data.data;
  },

  scanNetwork: async (): Promise<{
    devices: DiscoveredDevice[];
    message?: string;
    discoveryAvailable?: boolean;
  }> => {
    const { data } = await apiClient.post<ApiResponse<DiscoveredDevice[]> & {
      message?: string;
      discoveryAvailable?: boolean;
    }>('/devices/scan');
    return {
      devices: data.data ?? [],
      message: data.message,
      discoveryAvailable: data.discoveryAvailable,
    };
  },

  updateSyncSettings: async (
    autoSyncEnabled: boolean,
    syncIntervalSeconds: number,
  ): Promise<DevicePublic> => {
    const { data } = await apiClient.patch<ApiResponse<DevicePublic>>('/devices/sync-settings', {
      autoSyncEnabled,
      syncIntervalSeconds,
    });
    return data.data;
  },

  diagnostics: async (): Promise<Record<string, unknown>> => {
    const { data } = await apiClient.get<ApiResponse<Record<string, unknown>>>('/devices/diagnostics');
    return data.data;
  },

  /**
   * Silently re-authenticate the saved device using its stored credentials.
   * Always resolves — never throws — so it can safely be called fire-and-forget.
   */
  reconnect: async (): Promise<{ connected: boolean; data?: DevicePublic; reason?: string }> => {
    try {
      const { data } = await apiClient.post<{ success: boolean; connected: boolean; data?: DevicePublic; reason?: string }>(
        '/devices/reconnect',
        {},
      );
      return { connected: data.connected, data: data.data, reason: data.reason };
    } catch {
      return { connected: false, reason: 'api_unreachable' };
    }
  },
};
