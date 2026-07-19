import { getActiveDeviceRecord } from '../../models/DeviceModel.js';
import { syncDeviceAttendance } from './SyncService.js';

let syncTimer: ReturnType<typeof setInterval> | null = null;
let currentIntervalMs = 0;
let syncInFlight = false;

/** Start or restart the background sync scheduler based on device settings. */
export async function refreshSyncScheduler(): Promise<void> {
  stopSyncScheduler();

  const device = await getActiveDeviceRecord();
  if (!device?.auto_sync_enabled || device.status === 'offline') {
    return;
  }

  const intervalMs = Math.max(device.sync_interval_seconds, 15) * 1000;
  currentIntervalMs = intervalMs;

  syncTimer = setInterval(async () => {
    if (syncInFlight) {
      console.warn('[SyncService] Skipping auto-sync — previous run still in progress');
      return;
    }
    syncInFlight = true;
    try {
      const current = await getActiveDeviceRecord();
      if (!current?.auto_sync_enabled) {
        stopSyncScheduler();
        return;
      }
      const result = await syncDeviceAttendance();
      console.log(
        `[SyncService] Auto-sync completed for ${current.name}: downloaded=${result.downloaded} inserted=${result.inserted} duplicates=${result.duplicates}`,
      );
    } catch (err) {
      console.error('[SyncService] Auto-sync failed:', err instanceof Error ? err.message : err);
    } finally {
      syncInFlight = false;
    }
  }, intervalMs);

  console.log(`[SyncService] Auto-sync enabled every ${device.sync_interval_seconds}s`);
}

export function stopSyncScheduler(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    currentIntervalMs = 0;
  }
}

/** Poll device settings every 30s to pick up interval changes. */
export function startSyncSettingsWatcher(): void {
  setInterval(() => {
    void (async () => {
      const device = await getActiveDeviceRecord();
      if (!device) {
        stopSyncScheduler();
        return;
      }
      const expectedMs =
        device.auto_sync_enabled && device.status !== 'offline'
          ? Math.max(device.sync_interval_seconds, 15) * 1000
          : 0;
      if (expectedMs !== currentIntervalMs) {
        await refreshSyncScheduler();
      }
    })();
  }, 30_000);
}
