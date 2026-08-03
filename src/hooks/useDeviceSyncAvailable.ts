import { useEffect, useState } from 'react';
import apiClient from '../api/client';

/**
 * The Hikvision machine is reachable only from the office LAN, so the
 * cloud-hosted API runs with device sync switched off and reports that on
 * /health. An unreachable server is treated as available so the page stays
 * discoverable during local dev when the API simply has not been started yet.
 *
 * Returns `{ available, loading, runtime, lanDeviceAccess }` so the Device
 * Settings page can warn when the Electron shell is still talking to cloud.
 */
export interface ApiHealthInfo {
  deviceSyncEnabled?: boolean;
  runtime?: 'electron-desktop' | 'server' | string;
  lanDeviceAccess?: boolean;
}

let probe: Promise<ApiHealthInfo> | null = null;

function probeHealth(): Promise<ApiHealthInfo> {
  probe ??= apiClient
    .get<ApiHealthInfo>('/health')
    .then(({ data }) => data ?? {})
    .catch(() => ({ deviceSyncEnabled: true, runtime: 'unknown', lanDeviceAccess: true }));
  return probe;
}

export interface DeviceSyncProbe {
  /** Whether the backend reports device sync as available. */
  available: boolean;
  /** True while the /health probe is still in-flight. */
  loading: boolean;
  /** electron-desktop means the installer-spawned local API is active. */
  runtime: string;
  /** True when this API process can open sockets to private LAN IPs. */
  lanDeviceAccess: boolean;
}

export function useDeviceSyncAvailable(): DeviceSyncProbe {
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [runtime, setRuntime] = useState('unknown');
  const [lanDeviceAccess, setLanDeviceAccess] = useState(true);

  useEffect(() => {
    let active = true;
    probeHealth().then((info) => {
      if (!active) return;
      setAvailable(info.deviceSyncEnabled !== false);
      setRuntime(info.runtime ?? 'unknown');
      setLanDeviceAccess(info.lanDeviceAccess !== false);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { available, loading, runtime, lanDeviceAccess };
}
