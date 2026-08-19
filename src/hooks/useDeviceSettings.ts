import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { deviceApi } from '../api/deviceApi';
import type { AttendanceLogEntry, DeviceFormValues, ConnectionMode } from '../types/device';
import { loadDeviceLogsCache, saveDeviceLogsCache } from '../lib/deviceLogsCache';
import { punchCalendarDate } from '../lib/punchTime';

export const deviceQueryKeys = {
  device: ['device'] as const,
  status: ['device', 'status'] as const,
  logs: ['device', 'logs'] as const,
};

/** Instant paint from last saved punches — do not wait for API/device. */
export function cachedLogsForRange(range?: { from?: string; to?: string }): AttendanceLogEntry[] {
  const all = loadDeviceLogsCache();
  if (!range?.from && !range?.to) return all;
  return all.filter((log) => {
    const d = punchCalendarDate(log.time);
    if (range.from && d < range.from) return false;
    if (range.to && d > range.to) return false;
    return true;
  });
}

export function useDevice() {
  return useQuery({
    queryKey: deviceQueryKeys.device,
    queryFn: () => deviceApi.getDevice(),
  });
}

export function useDeviceStatus() {
  const fetchGen = useRef(0);
  return useQuery({
    queryKey: deviceQueryKeys.status,
    queryFn: async () => {
      const gen = ++fetchGen.current;
      const data = await deviceApi.getStatus();
      if (gen !== fetchGen.current) {
        throw new Error('stale_status_request');
      }
      return data;
    },
    refetchInterval: 10_000,
    retry: (_, err) => !(err instanceof Error && err.message === 'stale_status_request'),
  });
}

export function useDeviceLogs(range?: { from?: string; to?: string }) {
  const from = range?.from ?? '';
  const to = range?.to ?? '';
  return useQuery({
    queryKey: [...deviceQueryKeys.logs, from, to],
    queryFn: async () => {
      const logs = await deviceApi.getLogs(undefined, range);
      if (logs.length) saveDeviceLogsCache(logs);
      return logs;
    },
    // Saved punches show immediately; network refresh happens in the background.
    initialData: () => cachedLogsForRange(range),
    initialDataUpdatedAt: 0,
    placeholderData: (previous) => previous,
    staleTime: 5_000,
    refetchInterval: 30_000,
  });
}

export function useDeviceMutations() {
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: deviceQueryKeys.device });
    void queryClient.invalidateQueries({ queryKey: deviceQueryKeys.status });
    void queryClient.invalidateQueries({ queryKey: deviceQueryKeys.logs });
  };

  const connect = useMutation({
    mutationFn: (form: DeviceFormValues) => deviceApi.connect(form),
    onSuccess: invalidateAll,
  });

  const save = useMutation({
    mutationFn: (form: DeviceFormValues) => deviceApi.saveDevice(form),
    onSuccess: invalidateAll,
  });

  const test = useMutation({
    mutationFn: (
      form: Pick<DeviceFormValues, 'brand' | 'ipAddress' | 'port' | 'username' | 'password'>,
    ) => deviceApi.test(form),
    onSuccess: invalidateAll,
  });

  const disconnect = useMutation({
    mutationFn: () => deviceApi.disconnect(),
    onSuccess: invalidateAll,
  });

  const sync = useMutation({
    mutationFn: (range?: { startTime?: string; endTime?: string }) => deviceApi.sync(range),
    onSuccess: invalidateAll,
  });

  const scan = useMutation({
    mutationFn: () => deviceApi.scanNetwork(),
  });

  const updateSyncSettings = useMutation({
    mutationFn: ({
      autoSyncEnabled,
      syncIntervalSeconds,
    }: {
      autoSyncEnabled: boolean;
      syncIntervalSeconds: number;
    }) => deviceApi.updateSyncSettings(autoSyncEnabled, syncIntervalSeconds),
    onSuccess: invalidateAll,
  });

  const setConnectionMode = useMutation({
    mutationFn: (mode: ConnectionMode) => deviceApi.setConnectionMode(mode),
    onSuccess: invalidateAll,
  });

  const createConnectorToken = useMutation({
    mutationFn: () => deviceApi.createConnectorToken(),
    onSuccess: invalidateAll,
  });

  const reconnect = useMutation({
    mutationFn: () => deviceApi.reconnect(),
    onSuccess: invalidateAll,
  });

  return {
    connect,
    save,
    test,
    disconnect,
    sync,
    scan,
    updateSyncSettings,
    setConnectionMode,
    createConnectorToken,
    reconnect,
  };
}
