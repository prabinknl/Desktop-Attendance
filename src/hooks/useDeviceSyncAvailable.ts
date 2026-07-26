import { useEffect, useState } from 'react';
import apiClient from '../api/client';

/**
 * The Hikvision machine is reachable only from the office LAN, so the
 * cloud-hosted API runs with device sync switched off and reports that on
 * /health. Device settings are hidden in that case. An unreachable server is
 * treated as available so the page stays discoverable during local dev when
 * the API simply has not been started yet.
 */
let probe: Promise<boolean> | null = null;

function probeDeviceSync(): Promise<boolean> {
  probe ??= apiClient
    .get<{ deviceSyncEnabled?: boolean }>('/health')
    .then(({ data }) => data?.deviceSyncEnabled !== false)
    .catch(() => true);
  return probe;
}

export function useDeviceSyncAvailable(): boolean {
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let active = true;
    probeDeviceSync().then((value) => {
      if (active) setAvailable(value);
    });
    return () => {
      active = false;
    };
  }, []);

  return available;
}
