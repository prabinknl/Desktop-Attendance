import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deviceApi } from '../api/deviceApi';
import type { DeviceFormValues } from '../types/device';

export const deviceQueryKeys = {
  device: ['device'] as const,
  status: ['device', 'status'] as const,
  logs: ['device', 'logs'] as const,
};

export function useDevice() {
  return useQuery({
    queryKey: deviceQueryKeys.device,
    queryFn: () => deviceApi.getDevice(),
  });
}

export function useDeviceStatus() {
  return useQuery({
    queryKey: deviceQueryKeys.status,
    queryFn: () => deviceApi.getStatus(),
    refetchInterval: 10_000,
  });
}

export function useDeviceLogs(range?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: [...deviceQueryKeys.logs, range?.from ?? '', range?.to ?? ''],
    queryFn: () => deviceApi.getLogs(undefined, range),
    refetchInterval: 15_000,
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

  return { connect, save, test, disconnect, sync, scan, updateSyncSettings };
}
