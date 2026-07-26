/**
 * Attempts to reconnect the stored device on server startup.
 * Called after migrations and before the HTTP server opens.
 * Failures are silently logged — the device is marked offline if unreachable.
 */
import {
  getActiveDeviceRecord,
  updateDeviceStatus,
  updateDeviceMeta,
  getAdapterForDevice,
} from '../../models/DeviceModel.js';
import { refreshSyncScheduler } from './BackgroundSyncService.js';

export async function autoReconnectDevice(): Promise<void> {
  try {
    const record = await getActiveDeviceRecord();
    if (!record) return; // No device saved yet

    if (record.status === 'online') {
      // Already online from DB — restore the sync scheduler
      await refreshSyncScheduler();
      console.log(`[Device] Resuming sync scheduler for already-online device: ${record.name}`);
      return;
    }

    if (!record.password_encrypted) {
      console.info('[Device] Auto-reconnect skipped: no stored credentials');
      return;
    }

    console.log(`[Device] Attempting auto-reconnect to ${record.name} @ ${record.ip_address}:${record.port}…`);
    await updateDeviceStatus(record.id, 'connecting');

    const adapter = getAdapterForDevice(record);
    await adapter.connect();

    const info = await adapter.getDeviceInfo();
    await updateDeviceMeta(record.id, {
      status: 'online',
      model: info.model,
      macAddress: info.macAddress,
      deviceTime: info.deviceTime,
    });

    await refreshSyncScheduler();
    console.log(`[Device] Auto-reconnected: ${record.name} (${info.model ?? record.brand})`);
  } catch (err) {
    const record = await getActiveDeviceRecord().catch(() => null);
    if (record) {
      await updateDeviceStatus(record.id, 'offline').catch(() => {});
    }
    console.info(
      '[Device] Auto-reconnect on startup failed (machine may be offline):',
      err instanceof Error ? err.message : String(err),
    );
  }
}
