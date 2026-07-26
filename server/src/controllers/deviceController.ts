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
} from '../models/DeviceModel.js';
import { syncDeviceAttendance } from '../services/device/SyncService.js';
import { scanNetwork } from '../services/device/NetworkScanner.js';
import { isValidIpAddress, isValidPort } from '../services/crypto/passwordCrypto.js';
import { logDeviceAction } from '../services/device/deviceLogger.js';
import { refreshSyncScheduler } from '../services/device/BackgroundSyncService.js';
import type {
  DeviceConnectPayload,
  DeviceTestPayload,
  DeviceBrand,
} from '../types/index.js';

const VALID_BRANDS: DeviceBrand[] = ['hikvision', 'zkteco', 'essl', 'suprema', 'other'];

function validateConnectPayload(payload: DeviceConnectPayload): string | null {
  if (!payload.name?.trim()) return 'Device name is required';
  if (!payload.brand || !VALID_BRANDS.includes(payload.brand)) return 'Device brand is required';
  if (!isValidIpAddress(payload.ipAddress)) return 'Invalid IP address';
  if (!isValidPort(Number(payload.port))) return 'Port must be between 1 and 65535';
  if (!payload.username?.trim()) return 'Username is required';
  // Password may be omitted when updating an already-saved device (reuse stored secret)
  return null;
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

    const saved = await saveDevice({
      ...payload,
      port: Number(payload.port),
      username: payload.username?.trim() || 'admin',
      password: payload.password ?? '',
    });
    await updateDeviceStatus(saved.id, 'connecting');

    try {
      const record = await getActiveDeviceRecord();
      if (!record) throw new Error('Device not found after save');
      const realAdapter = getAdapterForDevice(record);
      await realAdapter.connect();

      const info = await realAdapter.getDeviceInfo();
      await updateDeviceMeta(record.id, {
        status: 'online',
        model: info.model,
        macAddress: info.macAddress,
        deviceTime: info.deviceTime,
      });

      await refreshSyncScheduler();

      const updated = await getActiveDevice();
      logDeviceAction({
        ip: payload.ipAddress,
        action: 'connect',
        result: 'ok',
        message: `model=${info.model}`,
      });
      res.json({ success: true, message: 'Device connected successfully', data: updated });
    } catch (err) {
      await updateDeviceStatus(saved.id, 'offline');
      const message = err instanceof Error ? err.message : 'Connection failed';
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

      let password = String(payload.password ?? '');
      // Allow blank password → reuse the last saved device password (same as Connect)
      if (!password) {
        const record = await getActiveDeviceRecord();
        if (
          record?.password_encrypted
          && record.ip_address === payload.ipAddress
          && Number(record.port) === Number(payload.port)
        ) {
          const { decryptPassword } = await import('../services/crypto/passwordCrypto.js');
          password = decryptPassword(record.password_encrypted);
        }
      }
      if (!password) {
        res.status(400).json({
          success: false,
          message: 'Password is required (or save the device first to reuse the stored password)',
        });
        return;
      }

      const { createDeviceAdapter } = await import('../services/device/DeviceFactory.js');
      const testAdapter = createDeviceAdapter(payload.brand, {
        ipAddress: payload.ipAddress,
        port: Number(payload.port),
        username: payload.username.trim(),
        password,
      });

      const result = await testAdapter.testConnection();

      // Only mark the *saved* device online after real authentication
      const record = await getActiveDeviceRecord();
      if (
        record &&
        result.online &&
        record.ip_address === payload.ipAddress &&
        Number(record.port) === Number(payload.port)
      ) {
        const info = result.deviceInfo;
        await updateDeviceMeta(record.id, {
          status: 'online',
          deviceTime: info?.deviceTime ? new Date(info.deviceTime) : undefined,
          model: info?.model,
          macAddress: info?.macAddress,
        });
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

    await updateDeviceStatus(device.id, 'offline');
    await refreshSyncScheduler();
    res.json({ success: true, message: 'Device disconnected' });
  },

  /** GET /api/device/status */
  async status(_req: import('express').Request, res: import('express').Response) {
    const device = await getActiveDevice();
    if (!device) {
      res.json({
        success: true,
        data: {
          status: 'offline',
          lastSync: null,
          lastAttendanceReceived: null,
          deviceTime: null,
          autoSyncEnabled: false,
          syncIntervalSeconds: 60,
        },
      });
      return;
    }

    res.json({
      success: true,
      data: {
        status: device.status,
        lastSync: device.lastSync,
        lastAttendanceReceived: device.lastAttendanceReceived,
        deviceTime: device.deviceTime,
        autoSyncEnabled: device.autoSyncEnabled,
        syncIntervalSeconds: device.syncIntervalSeconds,
      },
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

  /** POST /api/device/scan */
  async scan(_req: import('express').Request, res: import('express').Response) {
    try {
      const result = await scanNetwork();
      res.json({
        success: true,
        data: result.devices,
        message: result.message,
        discoveryAvailable: result.discoveryAvailable,
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
   * POST /api/device/reconnect
   * Silently re-authenticates the saved device using stored credentials.
   * Called automatically on user login so the device reconnects when the
   * machine and API server are on the same network.
   * Returns { connected: true } or { connected: false, reason } — never 5xx,
   * so callers can safely fire-and-forget.
   */
  async reconnect(_req: import('express').Request, res: import('express').Response) {
    try {
      const record = await getActiveDeviceRecord();
      if (!record) {
        res.json({ success: true, connected: false, reason: 'no_device_configured' });
        return;
      }

      // Already online — nothing to do
      if (record.status === 'online') {
        const pub = await getActiveDevice();
        res.json({ success: true, connected: true, data: pub });
        return;
      }

      // Need stored password to re-authenticate
      const { decryptPassword: _dp } = await import('../services/crypto/passwordCrypto.js');
      if (!record.password_encrypted) {
        res.json({ success: true, connected: false, reason: 'no_credentials' });
        return;
      }
      // password is read by the adapter via getAdapterForDevice(record) internally

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

      const pub = await getActiveDevice();
      logDeviceAction({
        ip: record.ip_address,
        action: 'reconnect',
        result: 'ok',
        message: `model=${info.model}`,
      });
      console.log(`[Device] Auto-reconnected: ${record.name} @ ${record.ip_address} (${info.model})`);
      res.json({ success: true, connected: true, data: pub });
    } catch (err) {
      // Reconnect failure is expected when the machine is offline — not an error
      const message = err instanceof Error ? err.message : 'Reconnect failed';
      const record = await getActiveDeviceRecord().catch(() => null);
      if (record) {
        await updateDeviceStatus(record.id, 'offline').catch(() => {});
      }
      logDeviceAction({ action: 'reconnect', result: 'error', message });
      console.info(`[Device] Auto-reconnect skipped: ${message}`);
      // Always 200 so the frontend can ignore the result
      res.json({ success: true, connected: false, reason: message });
    }
  },
};
