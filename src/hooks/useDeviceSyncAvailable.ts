import { useEffect, useState } from 'react';
import apiClient from '../api/client';

/**
 * The Hikvision machine is reachable only from the office LAN, so the
 * cloud-hosted API runs with device sync switched off and reports that on
 * /health. An unreachable server is treated as available so the page stays
 * discoverable during local dev when the API simply has not been started yet.
 *
 * Returns `{ available, loading }` so consumers can distinguish "still
 * probing" from "definitively disabled" — preventing a flash where
 * Device Settings appears for one second then vanishes.
 */
let probe: Promise<boolean> | null = null;

function probeDeviceSync(): Promise<boolean> {
  probe ??= apiClient
    .get<{ deviceSyncEnabled?: boolean }>('/health')
    .then(({ data }) => data?.deviceSyncEnabled !== false)
    .catch(() => true);
  return probe;
}

export interface DeviceSyncProbe {
  /** Whether the backend reports device sync as available. */
  available: boolean;
  /** True while the /health probe is still in-flight. */
  loading: boolean;
}

export function useDeviceSyncAvailable(): DeviceSyncProbe {
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    probeDeviceSync().then((value) => {
      if (active) {
        setAvailable(value);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return { available, loading };
}
