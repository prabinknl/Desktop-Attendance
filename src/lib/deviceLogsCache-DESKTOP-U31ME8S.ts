import type { AttendanceLogEntry } from '../types/device';

const DEVICE_LOGS_CACHE_KEY = 'device-logs-cache-v1';

/** Persist raw machine punches so UI can rebuild after app/API restart. */
export function saveDeviceLogsCache(logs: AttendanceLogEntry[]) {
  if (!Array.isArray(logs) || logs.length === 0) return;
  try {
    localStorage.setItem(
      DEVICE_LOGS_CACHE_KEY,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        logs,
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function loadDeviceLogsCache(): AttendanceLogEntry[] {
  try {
    const raw = localStorage.getItem(DEVICE_LOGS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { logs?: AttendanceLogEntry[] };
    return Array.isArray(parsed.logs) ? parsed.logs : [];
  } catch {
    return [];
  }
}

/**
 * Prefer live device/API logs; fall back to the last cached punches
 * when the machine is offline or the API lost in-memory data.
 */
export async function fetchLogsWithCache(
  fetchLive: () => Promise<AttendanceLogEntry[]>,
): Promise<{ logs: AttendanceLogEntry[]; fromCache: boolean }> {
  try {
    const live = await fetchLive();
    if (Array.isArray(live) && live.length > 0) {
      saveDeviceLogsCache(live);
      return { logs: live, fromCache: false };
    }
  } catch {
    /* fall through to cache */
  }

  const cached = loadDeviceLogsCache();
  return { logs: cached, fromCache: cached.length > 0 };
}
