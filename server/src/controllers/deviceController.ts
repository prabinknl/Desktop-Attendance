import {
  getActiveDeviceRecord,
  getActiveDevice,
  saveDevice,
  updateDeviceStatus,
  updateSyncSettings,
  getDeviceLogs,
  getAdapterForDevice,
  updateDeviceMeta,
  clearDeviceAdapterCache,
  toStatusResponse,
  regenerateConnectorToken,
  updateConnectionMode,
  setPendingCommand,
  getCommandResult,
} from '../models/DeviceModel.js';
import { syncDeviceAttendance } from '../services/device/SyncService.js';
import { discoverDevices } from '../services/device/DeviceDiscovery.js';
import { withDeviceLock } from '../services/device/deviceLock.js';
import {
  getConnectionState,
  notifyConnectFailed,
  notifyDeviceConfigChanged,
  notifyDeviceConnected,
  notifyManualDisconnect,
  tryReconnectOnce,
} from '../services/device/AutoReconnectService.js';
import { isValidIpAddress, isValidPort, decryptPassword } from '../services/crypto/passwordCrypto.js';
import { publishDeviceProfile } from '../services/cloud/hostedDeviceProfile.js';
import { logDeviceAction } from '../services/device/deviceLogger.js';
import { refreshSyncScheduler } from '../services/device/BackgroundSyncService.js';
import { computeDevicePresence, resolveConnectionMode } from '../services/connector/devicePresence.js';
import { env } from '../config/env.js';
import type {
  DeviceConnectPayload,
  DeviceTestPayload,
  DeviceBrand,
  ConnectionMode,
  ConnectionTestResult,
  DeviceInfo,
} from '../types/index.js';

const VALID_BRANDS: DeviceBrand[] = ['hikvision', 'zkteco', 'essl', 'suprema', 'other'];

function validateConnectPayload(payload: DeviceConnectPayload): string | null {
  if (!payload.name?.trim()) return 'Device name is required';
  if (!payload.brand || !VALID_BRANDS.includes(payload.brand)) return 'Device brand is required';
  if (!isValidIpAddress(payload.ipAddress)) return 'Invalid IP address';
  if (!isValidPort(Number(payload.port))) return 'Port must be between 1 and 65535';
  if (!payload.username?.trim()) return 'Username is required';
  const mode = payload.connectionMode ?? 'local_direct';
  if (mode === 'local_direct' && !String(payload.password ?? '').trim()) {
    // Password may be omitted when updating an already-saved device (reuse stored secret)
  }
  return null;
}

function isPrivateLanIp(ip: string): boolean {
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

async function pollConnectorCommand(
  type: 'test' | 'sync',
  timeoutMs = 5000,
): Promise<Record<string, unknown> | null> {
  const cmdId = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  await setPendingCommand({ id: cmdId, type, createdAt: Date.now() });
  const attempts = Math.ceil(timeoutMs / 400);
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const result = await getCommandResult(cmdId);
    if (result) return result;
  }
  return null;
}

function gatewayOfflineResult(message?: string): ConnectionTestResult {
  return {
    online: false,
    authState: 'gateway_offline',
    latencyMs: 0,
    message:
      message ??
      'Connector not running: the cloud server cannot reach a private LAN IP. Run the Windows connector on your office network.',
  };
}

function sanitizePayloadForLog(payload: Record<string, unknown>) {
  const { password: _p, ...rest } = payload;
  return rest;
}

export const deviceController = {
  /** GET /api/device — current device config (no password). */
  async getDevice(_req: unknown, res: import('express').Response) {
    const device = await getActiveDevice();
    res.json({ success: true, data: device });
  },

  /** PUT /api/device | POST /api/devices — save config without connecting. */
  async save(req: import('express').Request, res: import('express').Response) {
    try {
      const payload = req.body as DeviceConnectPayload;
      const error = validateConnectPayload(payload);
      if (error) {
        logDeviceAction({
          ip: payload.ipAddress,
          action: 'save',
          result: 'error',
          message: error,
        });
        res.status(400).json({ success: false, message: error });
        return;
      }

      const saved = await saveDevice({
        ...payload,
        port: Number(payload.port),
      });
      // Saved devices stay offline until authenticated via Test/Connect
      await updateDeviceStatus(saved.id, 'offline');
      const publicDevice = await getActiveDevice();

      logDeviceAction({
        ip: payload.ipAddress,
        action: 'save',
        result: 'ok',
        message: `id=${saved.id}`,
      });
      console.log('[Device] save payload (redacted):', sanitizePayloadForLog(payload as unknown as Record<string, unknown>));
      if (env.deviceSyncEnabled && (payload.connectionMode ?? 'local_direct') === 'local_direct') {
        void notifyDeviceConfigChanged(saved.id);
      }

      res.status(201).json({
        success: true,
        message: 'Device saved successfully',
        data: publicDevice,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save device';
      logDeviceAction({ action: 'save', result: 'error', message });
      res.status(500).json({ success: false, message });
    }
  },

  /** POST /api/device/connect — save and authenticate with the real device. */
  async connect(req: import('express').Request, res: import('express').Response) {
    const payload = req.body as DeviceConnectPayload;
    const error = validateConnectPayload(payload);
    if (error) {
      res.status(400).json({ success: false, message: error });
      return;
    }

    // Desktop with DEVICE_SYNC_ENABLED talks to the machine on the LAN directly.
    // Cloud-hosted API (sync disabled) cannot reach private LAN IPs — use connector.
    const connectionMode: ConnectionMode =
      payload.connectionMode ??
      (env.deviceSyncEnabled
        ? 'local_direct'
        : isPrivateLanIp(payload.ipAddress)
          ? 'cloud_connector'
          : 'local_direct');

    if (connectionMode === 'cloud_connector' && !env.deviceSyncEnabled && isPrivateLanIp(payload.ipAddress)) {
      console.log(
        `[Device] connect cloud_connector ip=${payload.ipAddress} (no cloud LAN access)`,
      );
    }

    try {
      const saved = await saveDevice({
        ...payload,
        port: Number(payload.port),
        username: payload.username?.trim() || 'admin',
        password: payload.password ?? '',
        connectionMode,
      });

      if (connectionMode === 'cloud_connector') {
        await updateDeviceStatus(saved.id, 'offline');
        const updated = await getActiveDevice();
        logDeviceAction({
          ip: payload.ipAddress,
          action: 'connect',
          result: 'ok',
          message: 'cloud_connector_saved',
        });
        res.json({
          success: true,
          message:
            'Configuration saved. Device stays Offline until the Windows connector reports a successful authenticated heartbeat.',
          data: updated,
        });
        return;
      }

      const { record, info } = await withDeviceLock(async () => {
        await updateDeviceStatus(saved.id, 'connecting');
        const current = await getActiveDeviceRecord();
        if (!current) throw new Error('Device not found after save');
        const realAdapter = getAdapterForDevice(current);
        const result = await realAdapter.testConnection();
        if (!result.online) {
          await updateDeviceStatus(current.id, 'offline');
          await notifyConnectFailed(current, result.authState === 'authentication_failed', result.message);
          throw Object.assign(new Error(result.message), { handled: true });
        }
        const deviceInfo = await realAdapter.getDeviceInfo().catch((): DeviceInfo => ({
          model: result.deviceInfo?.model ?? current.model ?? 'Hikvision device',
          serialNumber: result.deviceInfo?.serialNumber,
          firmwareVersion: result.deviceInfo?.firmwareVersion,
          macAddress: result.deviceInfo?.macAddress,
        }));
        return { record: current, info: deviceInfo };
      });

      await updateDeviceMeta(record.id, {
        status: 'online',
        model: info.model,
        macAddress: info.macAddress,
        deviceTime: info.deviceTime,
      });
      await notifyDeviceConnected(record, info);
      await refreshSyncScheduler();
      if (payload.password) {
        void publishDeviceProfile({
          name: payload.name,
          brand: payload.brand,
          model: info.model ?? payload.model,
          ipAddress: payload.ipAddress,
          port: Number(payload.port),
          username: payload.username?.trim() || 'admin',
          password: payload.password,
        });
      }

      const updated = await getActiveDevice();
      logDeviceAction({
        ip: payload.ipAddress,
        action: 'connect',
        result: 'ok',
        message: `model=${info.model}`,
      });
      res.json({ success: true, message: 'Device connected successfully', data: updated });
    } catch (err) {
      const record = await getActiveDeviceRecord().catch(() => null);
      if (record) await updateDeviceStatus(record.id, 'offline');
      const message = err instanceof Error ? err.message : 'Connection failed';
      if (!(err as { handled?: boolean }).handled) await notifyConnectFailed(record, false, message);
      logDeviceAction({
        ip: payload.ipAddress,
        action: 'connect',
        result: 'error',
        message,
      });
      res.status(502).json({ success: false, message });
    }
  },

  /** POST /api/device/test | POST /api/devices/test-connection */
  async test(req: import('express').Request, res: import('express').Response) {
    try {
      const payload = req.body as DeviceTestPayload;
      if (!payload.brand) {
        res.status(400).json({ success: false, message: 'Brand is required' });
        return;
      }
      if (!isValidIpAddress(payload.ipAddress)) {
        res.status(400).json({ success: false, message: 'Invalid IP address' });
        return;
      }
      if (!isValidPort(Number(payload.port))) {
        res.status(400).json({ success: false, message: 'Invalid port' });
        return;
      }
      if (!payload.username?.trim()) {
        res.status(400).json({ success: false, message: 'Username is required' });
        return;
      }

      const record = await getActiveDeviceRecord();
      const mode = record ? resolveConnectionMode(record) : 'local_direct';
      const presence = record ? computeDevicePresence(record) : null;
      const connectorAlive = presence?.connectorOnline ?? false;

      if (mode === 'cloud_connector') {
        if (connectorAlive && record) {
          const polled = await pollConnectorCommand('test');
          if (polled?.result) {
            res.json({ success: true, data: polled.result as ConnectionTestResult });
            return;
          }
          const deviceOnline = presence?.deviceOnline ?? false;
          res.json({
            success: true,
            data: {
              online: deviceOnline,
              authState: deviceOnline ? 'authenticated' : 'device_unreachable',
              latencyMs: 0,
              message:
                record.gateway_error ||
                (deviceOnline
                  ? 'Authenticated via connector'
                  : 'Connector online but device authentication failed'),
              deviceInfo: record.model
                ? { model: record.model, macAddress: record.mac_address ?? undefined }
                : undefined,
            },
          });
          return;
        }
        res.json({ success: true, data: gatewayOfflineResult() });
        return;
      }

      if (!env.deviceSyncEnabled && isPrivateLanIp(payload.ipAddress)) {
        res.json({
          success: true,
          data: gatewayOfflineResult(
            'Cloud server cannot access a private LAN IP. Switch to Cloud Connector Mode and run the Windows connector.',
          ),
        });
        return;
      }

      let password = String(payload.password ?? '');
      if (!password && record?.password_encrypted) {
        const { decryptPassword } = await import('../services/crypto/passwordCrypto.js');
        password = decryptPassword(record.password_encrypted);
      }

      const { createDeviceAdapter } = await import('../services/device/DeviceFactory.js');
      const testAdapter = createDeviceAdapter(payload.brand, {
        ipAddress: payload.ipAddress,
        port: Number(payload.port),
        username: payload.username.trim(),
        password: password || 'admin',
      });

      const result = await withDeviceLock(() => testAdapter.testConnection());
      const testedSavedDevice =
        record && record.ip_address === payload.ipAddress && record.port === Number(payload.port);
      if (result.online && testedSavedDevice) {
        await updateDeviceStatus(record.id, 'online');
      } else if (
        !result.online &&
        (result.authState === 'offline' || result.authState === 'device_unreachable') &&
        !env.deviceSyncEnabled
      ) {
        res.json({ success: true, data: gatewayOfflineResult(result.message) });
        return;
      }

      res.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Test connection failed';
      logDeviceAction({ action: 'test', result: 'error', message });
      res.status(500).json({ success: false, message });
    }
  },

  /** POST /api/device/disconnect */
  async disconnect(_req: import('express').Request, res: import('express').Response) {
    const device = await getActiveDeviceRecord();
    if (!device) {
      res.status(404).json({ success: false, message: 'No device configured' });
      return;
    }

    try {
      const adapter = getAdapterForDevice(device);
      await adapter.disconnect();
    } catch {
      // ignore disconnect errors
    }
    clearDeviceAdapterCache();
    notifyManualDisconnect(device);

    await updateDeviceStatus(device.id, 'offline');
    await refreshSyncScheduler();
    res.json({ success: true, message: 'Device disconnected' });
  },

  /** GET /api/device/status */
  async status(_req: import('express').Request, res: import('express').Response) {
    const record = await getActiveDeviceRecord();
    if (!record) {
      res.json({
        success: true,
        data: {
          status: 'offline',
          deviceOnline: false,
          connectorOnline: false,
          connectionMode: 'local_direct',
          lastSync: null,
          lastAttendanceReceived: null,
          deviceTime: null,
          autoSyncEnabled: false,
          syncIntervalSeconds: 60,
          gatewayStatus: 'offline',
          gatewayLastHeartbeat: null,
          gatewayError: 'No device configured',
          lastConnectionSuccess: null,
          lastDeviceAuthAt: null,
          lastConnectorError: null,
        },
      });
      return;
    }

    res.json({
      success: true,
      data: toStatusResponse(record),
    });
  },

  /** GET /api/device/logs | GET /api/devices/:id/attendance */
  async logs(req: import('express').Request, res: import('express').Response) {
    const device = await getActiveDeviceRecord();
    if (!device) {
      res.json({ success: true, data: [] });
      return;
    }
    const paramId = req.params.id;
    if (paramId && paramId !== device.id) {
      res.status(404).json({ success: false, message: 'Device not found' });
      return;
    }
    const from =
      typeof req.query.from === 'string' && req.query.from.trim()
        ? req.query.from.trim()
        : undefined;
    const to =
      typeof req.query.to === 'string' && req.query.to.trim()
        ? req.query.to.trim()
        : undefined;
    const logs = await getDeviceLogs(device.id, { from, to });
    res.json({ success: true, data: logs });
  },

  /** POST /api/device/sync | POST /api/devices/sync */
  async sync(req: import('express').Request, res: import('express').Response) {
    try {
      const body = (req.body ?? {}) as { startTime?: string; endTime?: string };
      const startTime = body.startTime ? new Date(body.startTime) : undefined;
      const endTime = body.endTime ? new Date(body.endTime) : undefined;
      if (startTime && Number.isNaN(startTime.getTime())) {
        res.status(400).json({ success: false, message: 'Invalid startTime' });
        return;
      }
      if (endTime && Number.isNaN(endTime.getTime())) {
        res.status(400).json({ success: false, message: 'Invalid endTime' });
        return;
      }

      const record = await getActiveDeviceRecord();
      if (!record) {
        res.status(404).json({ success: false, message: 'No device configured' });
        return;
      }

      const mode = resolveConnectionMode(record);
      const presence = computeDevicePresence(record);
      if (mode === 'cloud_connector') {
        if (!presence.connectorOnline) {
          res.status(503).json({
            success: false,
            message: 'Connector not running — attendance sync runs on your LAN via the Windows connector.',
          });
          return;
        }
        const polled = await pollConnectorCommand('sync', 12_000);
        if (polled?.result) {
          res.json({
            success: true,
            message: 'Sync requested via connector',
            data: polled.result,
          });
          return;
        }
        res.status(504).json({
          success: false,
          message: 'Connector did not complete sync in time. It will retry on its schedule.',
        });
        return;
      }

      if (!env.deviceSyncEnabled) {
        res.status(503).json({
          success: false,
          message: 'Cloud server cannot sync a private LAN device directly. Use Cloud Connector Mode.',
        });
        return;
      }

      const result = await syncDeviceAttendance({ startTime, endTime });
      res.json({
        success: true,
        message: `Downloaded ${result.downloaded}, inserted ${result.inserted}, duplicates ${result.duplicates}, failed ${result.failed}`,
        data: result,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        message: err instanceof Error ? err.message : 'Sync failed',
      });
    }
  },

  /** POST /api/device/scan | POST /api/devices/discover — SADP + ISAPI subnet scan. */
  async scan(req: import('express').Request, res: import('express').Response) {
    try {
      const body = (req.body ?? {}) as { quick?: boolean };
      const result = await discoverDevices({
        includeSubnetScan: body.quick !== true,
        subnetScanOnlyIfSadpEmpty: false,
      });
      res.json({
        success: true,
        data: result.devices,
        message: result.message,
        discoveryAvailable: result.discoveryAvailable,
        sadpAvailable: result.sadpAvailable,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        message: err instanceof Error ? err.message : 'Scan failed',
        data: [],
        discoveryAvailable: false,
      });
    }
  },

  /** PATCH /api/device/sync-settings */
  async updateSyncSettings(req: import('express').Request, res: import('express').Response) {
    const device = await getActiveDeviceRecord();
    if (!device) {
      res.status(404).json({ success: false, message: 'No device configured' });
      return;
    }

    const { autoSyncEnabled, syncIntervalSeconds } = req.body as {
      autoSyncEnabled: boolean;
      syncIntervalSeconds: number;
    };

    const updated = await updateSyncSettings(
      device.id,
      Boolean(autoSyncEnabled),
      Number(syncIntervalSeconds) || 60,
    );

    await refreshSyncScheduler();
    res.json({ success: true, data: updated });
  },

  /** GET /api/device/diagnostics — temporary diagnostic from the live machine. */
  async diagnostics(req: import('express').Request, res: import('express').Response) {
    try {
      const device = await getActiveDeviceRecord();
      if (!device) {
        res.status(404).json({ success: false, message: 'No device configured' });
        return;
      }

      const body = req.query as { startTime?: string; endTime?: string };
      const startTime = body.startTime
        ? new Date(String(body.startTime))
        : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endTime = body.endTime ? new Date(String(body.endTime)) : new Date();

      const adapter = getAdapterForDevice(device);
      if (!adapter.diagnose) {
        res.status(501).json({ success: false, message: 'Diagnostics not supported for this brand' });
        return;
      }

      const report = await adapter.diagnose(startTime, endTime);
      logDeviceAction({
        ip: device.ip_address,
        action: 'diagnostics',
        result: 'ok',
        message: `events=${report.rawEventCount}`,
      });
      res.json({ success: true, data: report });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Diagnostics failed';
      logDeviceAction({ action: 'diagnostics', result: 'error', message });
      res.status(502).json({ success: false, message });
    }
  },

  /**
   * POST /api/devices/lan-profile
   * Returns the saved machine login so another office computer can connect.
   * The desktop server calls this. The password is not logged.
   */
  async lanProfile(req: import('express').Request, res: import('express').Response) {
    const role = String(req.headers['x-user-role'] ?? '').toLowerCase();
    const fromDesktop = req.headers['x-desktop-lan'] === '1';
    if (!fromDesktop || (role !== 'admin' && role !== 'owner')) {
      res.status(403).json({ success: false, message: 'Not allowed' });
      return;
    }
    try {
      const record = await getActiveDeviceRecord();
      if (!record?.password_encrypted || !record.ip_address || !record.username) {
        res.status(404).json({ success: false, message: 'No attendance machine is saved yet' });
        return;
      }
      const password = decryptPassword(record.password_encrypted);
      res.json({
        success: true,
        data: {
          name: record.name,
          brand: record.brand,
          model: record.model,
          ipAddress: record.ip_address,
          port: record.port,
          username: record.username,
          password,
        },
      });
    } catch {
      res.status(409).json({ success: false, message: 'The saved machine login could not be read' });
    }
  },

  /**
   * POST /api/device/reconnect
   * Re-authenticates the saved device (saved IP first, then local subnet scan).
   * Called on login and by the auto-reconnect watcher. Never returns 5xx.
   * Never includes passwords in the response.
   */
  async reconnect(req: import('express').Request, res: import('express').Response) {
    try {
      const force = (req.body as { force?: boolean } | undefined)?.force === true;
      // Answer within ~12 s; a long discovery keeps running and is visible via GET /connection.
      const outcome = await Promise.race([
        tryReconnectOnce({ force }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
      ]);
      if (!outcome) {
        res.json({
          success: true,
          connected: false,
          reason: 'busy',
          message: getConnectionState().message,
          state: getConnectionState(),
        });
        return;
      }

      if (outcome.connected) {
        const pub = await getActiveDevice();
        logDeviceAction({
          ip: outcome.ipAddress,
          action: 'reconnect',
          result: 'ok',
          message: `model=${outcome.model ?? ''}`,
        });
        res.json({ success: true, connected: true, data: pub });
        return;
      }

      logDeviceAction({
        action: 'reconnect',
        result: 'error',
        message: outcome.message,
      });
      console.info(`[Device] Auto-reconnect skipped: ${outcome.message}`);
      res.json({
        success: true,
        connected: false,
        reason: outcome.reason,
        message: outcome.message,
        state: getConnectionState(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Reconnect failed';
      logDeviceAction({ action: 'reconnect', result: 'error', message });
      console.info(`[Device] Auto-reconnect skipped: ${message}`);
      res.json({ success: true, connected: false, reason: message });
    }
  },

  /** GET /api/devices/connection — automatic-connection status for the UI (no secrets). */
  async connection(_req: import('express').Request, res: import('express').Response) {
    res.json({ success: true, data: getConnectionState() });
  },

  /** POST /api/devices/connector-token — generate a new connector token (shown once). */
  async createConnectorToken(_req: import('express').Request, res: import('express').Response) {
    try {
      const { token, device } = await regenerateConnectorToken();
      res.json({
        success: true,
        message: 'Copy this token into the Windows connector .env — it will not be shown again.',
        data: { token, device },
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to generate connector token',
      });
    }
  },

  /** PATCH /api/devices/connection-mode */
  async patchConnectionMode(req: import('express').Request, res: import('express').Response) {
    const device = await getActiveDeviceRecord();
    if (!device) {
      res.status(404).json({ success: false, message: 'No device configured' });
      return;
    }
    const mode = req.body?.connectionMode as ConnectionMode;
    if (mode !== 'local_direct' && mode !== 'cloud_connector') {
      res.status(400).json({ success: false, message: 'Invalid connection mode' });
      return;
    }
    const updated = await updateConnectionMode(device.id, mode);
    if (mode === 'cloud_connector') {
      await updateDeviceStatus(device.id, 'offline');
    }
    res.json({ success: true, data: updated });
  },
};
