/**
 * Auto-reconnect for the saved attendance machine.
 * Tries the saved IP first, then scans only the current local subnet.
 * Runs a single guarded reconnect loop (no overlapping attempts).
 */
import net from 'net';
import {
  getActiveDeviceRecord,
  updateDeviceStatus,
  updateDeviceMeta,
  updateDeviceAddress,
  updateConnectionMode,
  getAdapterForDevice,
  clearDeviceAdapterCache,
} from '../../models/DeviceModel.js';
import { refreshSyncScheduler } from './BackgroundSyncService.js';
import { scanNetwork, getLocalNetworkInfo } from './NetworkScanner.js';
import { createDeviceAdapter } from './DeviceFactory.js';
import { decryptPassword } from '../crypto/passwordCrypto.js';
import { resolveConnectionMode } from '../connector/devicePresence.js';
import { env } from '../../config/env.js';

const RECONNECT_INTERVAL_MS = 15_000;

/** Fast TCP reachability check — resolves in ≤ timeoutMs without ISAPI overhead. */
function tcpProbe(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

let reconnectTimer: ReturnType<typeof setInterval> | null = null;
let reconnectInFlight = false;
let watcherStarted = false;

export type ReconnectOutcome =
  | { connected: true; ipAddress: string; port: number; model?: string }
  | {
      connected: false;
      reason:
        | 'no_device'
        | 'no_credentials'
        | 'connector_mode'
        | 'sync_disabled'
        | 'no_local_network'
        | 'authentication_failed'
        | 'device_unavailable'
        | 'not_hikvision'
        | 'busy';
      message: string;
    };

async function markOnline(
  recordId: string,
  info: { model?: string; macAddress?: string; deviceTime?: Date },
): Promise<void> {
  await updateConnectionMode(recordId, 'local_direct').catch(() => {});
  await updateDeviceMeta(recordId, {
    status: 'online',
    model: info.model,
    macAddress: info.macAddress,
    deviceTime: info.deviceTime,
    // Record the successful authentication timestamp so the UI shows "Last Auth OK"
    lastSync: info.deviceTime ? undefined : new Date(),
  });
  await refreshSyncScheduler();
}

/**
 * Attempt one reconnect cycle: saved IP → subnet scan → authenticate.
 * Never logs passwords or tokens.
 */
export async function tryReconnectOnce(): Promise<ReconnectOutcome> {
  if (reconnectInFlight) {
    return {
      connected: false,
      reason: 'busy',
      message: 'Reconnect already in progress',
    };
  }

  reconnectInFlight = true;
  try {
    if (!env.deviceSyncEnabled) {
      return {
        connected: false,
        reason: 'sync_disabled',
        message: 'Device sync is disabled on this server',
      };
    }

    const record = await getActiveDeviceRecord();
    if (!record) {
      return {
        connected: false,
        reason: 'no_device',
        message: 'No device configured',
      };
    }

    if (resolveConnectionMode(record) === 'cloud_connector') {
      // Packaged desktop runs with DEVICE_SYNC_ENABLED — prefer LAN even if an
      // older bug saved the device as cloud_connector.
      if (!env.deviceSyncEnabled) {
        return {
          connected: false,
          reason: 'connector_mode',
          message: 'Device uses cloud connector mode',
        };
      }
      console.info(
        '[Device] Device was saved as cloud_connector; attempting local_direct on desktop API',
      );
    }

    if (!record.password_encrypted) {
      console.info('[Device] Auto-reconnect skipped: no stored credentials');
      return {
        connected: false,
        reason: 'no_credentials',
        message: 'No stored credentials',
      };
    }

    if (record.status === 'online') {
      // Verify the device is still reachable before trusting the persisted status.
      // A cold-start after overnight shutdown must not show "Connected" for an offline machine.
      const stillUp = await tcpProbe(record.ip_address, record.port, 1500);
      if (stillUp) {
        await refreshSyncScheduler();
        console.log(
          `[Device] Verified device still reachable at ${record.ip_address}:${record.port} — staying online`,
        );
        return {
          connected: true,
          ipAddress: record.ip_address,
          port: record.port,
          model: record.model ?? undefined,
        };
      }
      // TCP probe failed — clear the ghost-online status and fall through to full reconnect.
      console.info(
        `[Device] Persisted status=online but ${record.ip_address}:${record.port} is unreachable — running full reconnect`,
      );
      await updateDeviceStatus(record.id, 'offline').catch(() => {});
    }

    const preferredSubnet = record.ip_address
      ? record.ip_address.split('.').slice(0, 3).join('.')
      : undefined;

    const netInfo = getLocalNetworkInfo(preferredSubnet);
    console.log(
      `[Device] Local network: ${
        netInfo.addresses.length
          ? netInfo.addresses.map((a) => `${a.address}/${a.subnet}`).join(', ')
          : 'none detected'
      }`,
    );

    if (netInfo.subnets.length === 0) {
      console.info('[Device] Computer is not connected to a local network');
      await updateDeviceStatus(record.id, 'offline').catch(() => {});
      return {
        connected: false,
        reason: 'no_local_network',
        message: 'Computer is not connected to a local network',
      };
    }

    console.log(
      `[Device] Saved device connection attempted: ${record.name} @ ${record.ip_address}:${record.port}`,
    );
    await updateDeviceStatus(record.id, 'connecting');

    try {
      const adapter = getAdapterForDevice(record);
      const test = await adapter.testConnection();

      if (test.online) {
        const info = await adapter.getDeviceInfo();
        await markOnline(record.id, {
          model: info.model,
          macAddress: info.macAddress,
          deviceTime: info.deviceTime,
        });
        console.log(
          `[Device] Compatible device found and authenticated: ${record.ip_address}:${record.port} (${info.model ?? record.brand})`,
        );
        return {
          connected: true,
          ipAddress: record.ip_address,
          port: record.port,
          model: info.model,
        };
      }

      if (test.authState === 'authentication_failed') {
        console.info('[Device] Authentication failed for saved device credentials');
        await updateDeviceStatus(record.id, 'offline').catch(() => {});
        return {
          connected: false,
          reason: 'authentication_failed',
          message: test.message,
        };
      }

      if (test.authState === 'reachable' || test.authState === 'isapi_unsupported') {
        console.info(
          `[Device] IP responds but is not a usable Hikvision attendance device: ${record.ip_address}:${record.port}`,
        );
        // Fall through to subnet scan — IP may have changed.
      } else {
        console.info(`[Device] Device unavailable at saved address: ${test.message}`);
      }
    } catch (err) {
      console.info(
        '[Device] Saved device connection failed:',
        err instanceof Error ? err.message : String(err),
      );
    }

    // Saved IP unavailable — scan current local subnet (prioritizing saved subnet).
    console.log('[Device] Subnet scan started');
    const scan = await scanNetwork(preferredSubnet, record.port);
    if (!scan.discoveryAvailable) {
      await updateDeviceStatus(record.id, 'offline').catch(() => {});
      return {
        connected: false,
        reason: 'no_local_network',
        message: scan.message ?? 'No local subnet for discovery',
      };
    }

    if (scan.devices.length === 0) {
      console.info('[Device] Device not found on the local network');
      await updateDeviceStatus(record.id, 'offline').catch(() => {});
      return {
        connected: false,
        reason: 'device_unavailable',
        message: 'Device not found on the local network',
      };
    }

    let password: string;
    try {
      password = decryptPassword(record.password_encrypted);
    } catch {
      await updateDeviceStatus(record.id, 'offline').catch(() => {});
      return {
        connected: false,
        reason: 'no_credentials',
        message: 'Stored credentials could not be read',
      };
    }

    let sawAuthFailure = false;

    for (const found of scan.devices) {
      // Skip the already-tried saved endpoint.
      if (found.ipAddress === record.ip_address && found.port === record.port) {
        continue;
      }

      console.log(
        `[Device] Trying discovered candidate ${found.ipAddress}:${found.port} (${found.model})`,
      );

      const probe = createDeviceAdapter(record.brand, {
        ipAddress: found.ipAddress,
        port: found.port,
        username: record.username || 'admin',
        password,
        model: found.model,
      });

      const result = await probe.testConnection();
      if (result.authState === 'authentication_failed') {
        sawAuthFailure = true;
        console.info(
          `[Device] Authentication failed at discovered address ${found.ipAddress}:${found.port}`,
        );
        continue;
      }
      if (!result.online) {
        continue;
      }

      clearDeviceAdapterCache();
      await updateDeviceAddress(record.id, found.ipAddress, found.port);
      console.log(
        `[Device] Compatible device found — saved working address ${found.ipAddress}:${found.port}`,
      );

      const refreshed = await getActiveDeviceRecord();
      if (!refreshed) {
        break;
      }

      const adapter = getAdapterForDevice(refreshed);
      await adapter.connect();
      const info = await adapter.getDeviceInfo();
      await markOnline(refreshed.id, {
        model: info.model ?? found.model,
        macAddress: info.macAddress || found.macAddress,
        deviceTime: info.deviceTime,
      });

      return {
        connected: true,
        ipAddress: found.ipAddress,
        port: found.port,
        model: info.model ?? found.model,
      };
    }

    await updateDeviceStatus(record.id, 'offline').catch(() => {});
    if (sawAuthFailure) {
      return {
        connected: false,
        reason: 'authentication_failed',
        message: 'Device found but credentials are incorrect',
      };
    }

    console.info('[Device] Device unavailable after subnet scan');
    return {
      connected: false,
      reason: 'device_unavailable',
      message: 'Device not found on the local network',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.info('[Device] Reconnect cycle failed:', message);
    const record = await getActiveDeviceRecord().catch(() => null);
    if (record) {
      await updateDeviceStatus(record.id, 'offline').catch(() => {});
    }
    return {
      connected: false,
      reason: 'device_unavailable',
      message,
    };
  } finally {
    reconnectInFlight = false;
  }
}

/** One-shot startup reconnect (also starts the periodic watcher). */
export async function autoReconnectDevice(): Promise<void> {
  const outcome = await tryReconnectOnce();
  if (outcome.connected) {
    console.log(
      `[Device] Auto-reconnected: ${outcome.ipAddress}:${outcome.port}` +
        (outcome.model ? ` (${outcome.model})` : ''),
    );
  } else {
    console.info(`[Device] Auto-reconnect on startup: ${outcome.message}`);
  }
  startAutoReconnectWatcher();
}

/**
 * Periodic reconnect while the saved device is offline.
 * Ensures only one timer exists and skips overlapping attempts.
 */
export function startAutoReconnectWatcher(): void {
  if (!env.deviceSyncEnabled) return;

  stopAutoReconnectWatcher();
  watcherStarted = true;

  console.log(`[Device] Reconnect scheduled every ${RECONNECT_INTERVAL_MS / 1000}s`);

  reconnectTimer = setInterval(() => {
    void (async () => {
      if (reconnectInFlight) return;

      const record = await getActiveDeviceRecord().catch(() => null);
      if (!record) return;
      if (!env.deviceSyncEnabled && resolveConnectionMode(record) === 'cloud_connector') return;
      if (record.status === 'online' || record.status === 'syncing') return;
      if (!record.password_encrypted) return;

      console.log('[Device] Reconnect scheduled — attempting recovery');
      const outcome = await tryReconnectOnce();
      if (outcome.connected) {
        console.log(
          `[Device] Reconnected after offline period: ${outcome.ipAddress}:${outcome.port}`,
        );
      } else if (outcome.reason !== 'busy') {
        console.info(`[Device] Reconnect attempt: ${outcome.message}`);
      }
    })();
  }, RECONNECT_INTERVAL_MS);
}

export function stopAutoReconnectWatcher(): void {
  if (reconnectTimer) {
    clearInterval(reconnectTimer);
    reconnectTimer = null;
  }
  watcherStarted = false;
}

export function isAutoReconnectWatcherRunning(): boolean {
  return watcherStarted && reconnectTimer !== null;
}
