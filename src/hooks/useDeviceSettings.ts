import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
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

/**
 * Fires a reconnect attempt exactly once per page mount after device data loads,
 * but only when the device is configured, offline, and in local_direct mode.
 *
 * Rules:
 * - Waits until `deviceLoaded` is true (the initial query has settled).
 * - Only fires if `reconnectPending` is false (no concurrent call).
 * - Uses a `firedRef` so it never fires more than once per mount, regardless of
 *   how many times the status query re-renders (every 10 s).
 * - Does NOT fire on visibility changes or network-online events — the server-side
 *   15-second watcher handles those cases automatically.
 */
export function useAutoReconnect({
  deviceId,
  isOnline,
  connectionMode,
  deviceLoaded,
  reconnectPending,
  onReconnect,
}: {
  deviceId: string | undefined;
  isOnline: boolean;
  connectionMode: string;
  deviceLoaded: boolean;
  reconnectPending: boolean;
  onReconnect: () => void;
}): void {
  const firedRef = useRef(false);

  // Reset the guard when the device identity changes (e.g. first-time save reloads the page)
  useEffect(() => {
    firedRef.current = false;
  }, [deviceId]);

  useEffect(() => {
    if (firedRef.current) return;         // already fired this mount
    if (!deviceLoaded) return;            // wait for the initial query to settle
    if (!deviceId) return;               // no device configured yet
    if (isOnline) return;                // already online — nothing to do
    if (connectionMode !== 'local_direct') return;  // cloud connector: server handles it
    if (reconnectPending) return;        // already in flight

    firedRef.current = true;
    onReconnect();
  }, [deviceId, deviceLoaded, isOnline, connectionMode, reconnectPending, onReconnect]);
}

/** Stable callback ref — prevents useAutoReconnect re-firing when parent re-renders. */
export function useStableCallback<T extends (...args: unknown[]) => unknown>(fn: T): T {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((...args: unknown[]) => ref.current(...args), []) as T;
}
