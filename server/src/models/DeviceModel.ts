import { query } from '../db/pool.js';
import {
  memoryStore,
  createMemoryRecord,
  isMemoryMode,
  isExplicitMemoryStore,
  setMemoryMode,
  type MemoryLog,
} from '../db/memoryStore.js';
import { encryptPassword, decryptPassword } from '../services/crypto/passwordCrypto.js';
import { getOrCreateDeviceAdapter, clearDeviceAdapterCache } from '../services/device/DeviceSessionCache.js';
import {
  applyPresenceToPublic,
  computeDevicePresence,
  resolveConnectionMode,
} from '../services/connector/devicePresence.js';
import { generateConnectorToken } from '../services/connector/connectorAuth.js';
import { getInsForgeClient } from '../services/insforge/insforgeClient.js';
import type {
  DeviceConnectPayload,
  DevicePublic,
  DeviceRecord,
  DeviceStatus,
  DeviceStatusResponse,
  AttendanceLogEntry,
  ConnectionMode,
} from '../types/index.js';

function toPublic(record: DeviceRecord): DevicePublic {
  const presence = computeDevicePresence(record);
  return applyPresenceToPublic(record, presence);
}

export function toStatusResponse(record: DeviceRecord): DeviceStatusResponse {
  const presence = computeDevicePresence(record);
  return {
    status: presence.computedStatus,
    deviceOnline: presence.deviceOnline,
    connectorOnline: presence.connectorOnline,
    connectionMode: presence.connectionMode,
    lastSync: record.last_sync,
    lastAttendanceReceived: record.last_attendance_received,
    deviceTime: record.device_time,
    autoSyncEnabled: record.auto_sync_enabled,
    syncIntervalSeconds: record.sync_interval_seconds,
    gatewayStatus: presence.gatewayStatus,
    gatewayLastHeartbeat: record.gateway_last_heartbeat,
    gatewayError: presence.gatewayError,
    lastConnectionSuccess: record.last_connection_success,
    lastDeviceAuthAt: record.last_device_auth_at ?? null,
    lastConnectorError: record.last_connector_error ?? null,
  };
}

/** Keep a local copy so auto-reconnect still works when PostgreSQL blips. */
function cacheLocalDevice(record: DeviceRecord | null | undefined): void {
  if (record) memoryStore.saveDevice(record);
}

/**
 * InsForge HTTP still works when the Postgres TCP pool is down.
 * Used so auto-reconnect can recover saved machine credentials.
 */
async function loadDeviceFromInsForge(): Promise<DeviceRecord | null> {
  try {
    const client = await getInsForgeClient();
    if (!client) return null;
    const { data, error } = await client.database
      .from('devices')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) {
      console.warn('[DeviceModel] InsForge device load failed:', error.message ?? error);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') return null;
    return row as DeviceRecord;
  } catch (err) {
    console.warn(
      '[DeviceModel] InsForge device load failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Load the saved machine from PostgreSQL and mirror it to disk.
 * On failure, try InsForge HTTP, then the locally cached device.
 */
async function loadDeviceFromPostgres(): Promise<DeviceRecord | null> {
  try {
    const result = await query<DeviceRecord>('SELECT * FROM devices ORDER BY updated_at DESC LIMIT 1');
    const row = result.rows[0] ?? null;
    if (row) {
      cacheLocalDevice(row);
      if (isMemoryMode() && !isExplicitMemoryStore()) {
        setMemoryMode(false);
      }
      return row;
    }
  } catch (err) {
    if (!isMemoryMode()) {
      console.warn(
        '[DeviceModel] DB unavailable, trying InsForge / local cache:',
        err instanceof Error ? err.message : err,
      );
      setMemoryMode(true);
    }
  }

  const fromCloud = await loadDeviceFromInsForge();
  if (fromCloud) {
    cacheLocalDevice(fromCloud);
    console.log(`[Device] Loaded saved machine from InsForge (${fromCloud.ip_address}:${fromCloud.port})`);
    return fromCloud;
  }

  return memoryStore.getDevice();
}

export async function getActiveDevice(): Promise<DevicePublic | null> {
  const record = await getActiveDeviceRecord();
  return record ? toPublic(record) : null;
}

export async function getActiveDeviceRecord(): Promise<DeviceRecord | null> {
  if (isExplicitMemoryStore()) return memoryStore.getDevice();

  const cached = memoryStore.getDevice();
  // Fallback memory mode with a cached device: return it immediately so
  // auto-reconnect does not wait on a dead Postgres connection.
  if (isMemoryMode() && cached) return cached;

  return loadDeviceFromPostgres();
}

export async function saveDevice(payload: DeviceConnectPayload): Promise<DevicePublic> {
  const existing = await getActiveDeviceRecord();
  const connectionMode: ConnectionMode =
    payload.connectionMode ??
    existing?.connection_mode ??
    (existing ? resolveConnectionMode(existing) : 'local_direct');

  const passwordPlain =
    payload.password && payload.password.length > 0
      ? payload.password
      : existing?.password_encrypted
        ? decryptPassword(existing.password_encrypted)
        : '';

  if (connectionMode === 'local_direct' && !passwordPlain) {
    throw new Error('Password is required');
  }

  const username = (payload.username ?? 'admin').trim() || 'admin';
  const encrypted =
    connectionMode === 'cloud_connector' && !passwordPlain
      ? existing?.password_encrypted ?? null
      : encryptPassword(passwordPlain);
  clearDeviceAdapterCache();

  const trimmedPayload = { ...payload, username };

  if (isMemoryMode()) {
    const record = createMemoryRecord(trimmedPayload, encrypted, existing);
    return memoryStore.saveDevice(record);
  }

  try {
    if (existing) {
      const result = await query<DeviceRecord>(
        `UPDATE devices SET
          name = $1, brand = $2, model = $3, ip_address = $4, port = $5,
          username = $6, password_encrypted = $7, location = $8, description = $9,
          connection_mode = $10, updated_at = NOW()
         WHERE id = $11 RETURNING *`,
        [
          payload.name, payload.brand, payload.model ?? null, payload.ipAddress, payload.port,
          username, encrypted, payload.location ?? null, payload.description ?? null,
          connectionMode,
          existing.id,
        ],
      );
      cacheLocalDevice(result.rows[0]);
      return toPublic(result.rows[0]);
    }

    const result = await query<DeviceRecord>(
      `INSERT INTO devices (name, brand, model, ip_address, port, username, password_encrypted, location, description, connection_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        payload.name, payload.brand, payload.model ?? null, payload.ipAddress, payload.port,
        username, encrypted, payload.location ?? null, payload.description ?? null,
        connectionMode,
      ],
    );
    cacheLocalDevice(result.rows[0]);
    return toPublic(result.rows[0]);
  } catch (err) {
    if (err instanceof Error && err.message === 'Password is required') throw err;
    setMemoryMode(true);
    const memExisting = memoryStore.getDevice();
    const record = createMemoryRecord(trimmedPayload, encrypted, memExisting);
    return memoryStore.saveDevice(record);
  }
}

export async function updateDeviceStatus(id: string, status: DeviceStatus): Promise<void> {
  memoryStore.updateStatus(status);
  if (isMemoryMode()) return;
  try {
    await query('UPDATE devices SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
  } catch {
    /* local cache already updated */
  }
}

export async function updateSyncSettings(
  id: string,
  autoSyncEnabled: boolean,
  syncIntervalSeconds: number,
): Promise<DevicePublic> {
  memoryStore.updateMeta({ auto_sync_enabled: autoSyncEnabled, sync_interval_seconds: syncIntervalSeconds });
  if (isMemoryMode()) {
    return memoryStore.getDevicePublic()!;
  }
  try {
    const result = await query<DeviceRecord>(
      `UPDATE devices SET auto_sync_enabled = $1, sync_interval_seconds = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [autoSyncEnabled, syncIntervalSeconds, id],
    );
    cacheLocalDevice(result.rows[0]);
    return toPublic(result.rows[0]);
  } catch {
    const pub = memoryStore.getDevicePublic();
    if (!pub) throw new Error('No device configured');
    return pub;
  }
}

export async function updateDeviceMeta(
  id: string,
  fields: {
    lastSync?: Date;
    lastAttendanceReceived?: Date;
    deviceTime?: Date;
    model?: string;
    macAddress?: string;
    status?: DeviceStatus;
  },
): Promise<void> {
  const memoryFields: Partial<DeviceRecord> = {};
  if (fields.lastSync) memoryFields.last_sync = fields.lastSync.toISOString();
  if (fields.lastAttendanceReceived) memoryFields.last_attendance_received = fields.lastAttendanceReceived.toISOString();
  if (fields.deviceTime) memoryFields.device_time = fields.deviceTime.toISOString();
  if (fields.model) memoryFields.model = fields.model;
  if (fields.macAddress) memoryFields.mac_address = fields.macAddress;
  if (fields.status) memoryFields.status = fields.status;

  memoryStore.updateMeta(memoryFields);
  if (isMemoryMode()) return;

  const sets: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [];
  let idx = 1;

  if (fields.lastSync) { sets.push(`last_sync = $${idx++}`); values.push(fields.lastSync); }
  if (fields.lastAttendanceReceived) {
    sets.push(`last_attendance_received = $${idx++}`);
    values.push(fields.lastAttendanceReceived);
  }
  if (fields.deviceTime) { sets.push(`device_time = $${idx++}`); values.push(fields.deviceTime); }
  if (fields.model) { sets.push(`model = $${idx++}`); values.push(fields.model); }
  if (fields.macAddress) { sets.push(`mac_address = $${idx++}`); values.push(fields.macAddress); }
  if (fields.status) { sets.push(`status = $${idx++}`); values.push(fields.status); }

  values.push(id);
  try {
    await query(`UPDATE devices SET ${sets.join(', ')} WHERE id = $${idx}`, values);
  } catch {
    /* local cache already updated */
  }
}

/** Update the working LAN address on the existing device row (no duplicate records). */
export async function updateDeviceAddress(
  id: string,
  ipAddress: string,
  port: number,
): Promise<void> {
  clearDeviceAdapterCache();

  memoryStore.updateMeta({ ip_address: ipAddress, port });
  if (isMemoryMode()) return;

  try {
    await query(
      'UPDATE devices SET ip_address = $1, port = $2, updated_at = NOW() WHERE id = $3',
      [ipAddress, port, id],
    );
  } catch {
    /* local cache already updated */
  }
}

export function getAdapterForDevice(device: DeviceRecord) {
  // Reuse the live adapter so AcsEvent + digest strategies stay warm across syncs.
  return getOrCreateDeviceAdapter(device);
}

export { clearDeviceAdapterCache };

export interface DeviceLogsRange {
  from?: string;
  to?: string;
}

type DeviceAttendanceLogRow = {
  id: string;
  event_time: string;
  employee_id: string | null;
  employee_name: string | null;
  check_type: string;
  auth_method: string | null;
  card_number: string | null;
  source: string | null;
  raw_event_code: string | null;
};

export async function getDeviceLogs(
  deviceId: string,
  range?: DeviceLogsRange,
): Promise<AttendanceLogEntry[]> {
  const isValidLog = (row: {
    employeeId: string;
    employeeName: string;
    authMethod?: string | null;
  }) => {
    const id = String(row.employeeId ?? '').trim().toLowerCase();
    if (!id || id === 'unknown' || id === '—' || id === '-') return false;
    const name = String(row.employeeName ?? '').trim().toLowerCase();
    if (name === 'unknown') return false;
    const auth = String(row.authMethod ?? '').trim().toLowerCase();
    if (auth === 'invalid' || auth === 'none' || auth === 'unauthorized') return false;
    return true;
  };

  const fromIso = range?.from
    ? new Date(`${range.from}T00:00:00`).toISOString()
    : undefined;
  const toIso = range?.to
    ? new Date(`${range.to}T23:59:59.999`).toISOString()
    : undefined;
  const hasRange = Boolean(fromIso || toIso);
  const limit = hasRange ? 10_000 : 100;

  if (isMemoryMode()) {
    const device = memoryStore.getDevice();
    const deviceName = device?.name ?? 'Device';
    return memoryStore
      .getLogs(deviceId, range)
      .map((row: MemoryLog) => ({
        id: row.id,
        time: row.event_time,
        employeeId: row.employee_id ?? '—',
        employeeName: row.employee_name ?? 'Unknown',
        checkType: row.check_type,
        device: deviceName,
        authMethod: row.auth_method ?? null,
        cardNumber: row.card_number ?? null,
        source: row.source ?? 'hikvision-device',
        rawEventCode: row.raw_event_code ?? null,
      }))
      .filter(isValidLog);
  }

  const device = await query<DeviceRecord>('SELECT * FROM devices WHERE id = $1', [deviceId]);
  const deviceName = device.rows[0]?.name ?? 'Device';

  const conditions = [
    'device_id = $1',
    `(source IS NULL OR source = 'hikvision-device' OR source LIKE 'hikvision%')`,
    `employee_id IS NOT NULL`,
    `LOWER(TRIM(employee_id)) NOT IN ('unknown', '—', '-', '')`,
    `(employee_name IS NULL OR LOWER(TRIM(employee_name)) <> 'unknown')`,
    `(auth_method IS NULL OR LOWER(TRIM(auth_method)) NOT IN ('invalid', 'none', 'unauthorized'))`,
  ];
  const values: Array<string | number> = [deviceId];
  if (fromIso) {
    values.push(fromIso);
    conditions.push(`event_time >= $${values.length}`);
  }
  if (toIso) {
    values.push(toIso);
    conditions.push(`event_time <= $${values.length}`);
  }
  values.push(limit);

  const result = await query<DeviceAttendanceLogRow>(
    `SELECT id, event_time, employee_id, employee_name, check_type,
            auth_method, card_number, source, raw_event_code
     FROM device_attendance_logs
     WHERE ${conditions.join(' AND ')}
     ORDER BY event_time DESC
     LIMIT $${values.length}`,
    values,
  );

  return result.rows
    .map((row: DeviceAttendanceLogRow) => ({
      id: row.id,
      time: row.event_time,
      employeeId: row.employee_id ?? '—',
      employeeName: row.employee_name ?? 'Unknown',
      checkType: row.check_type,
      device: deviceName,
      authMethod: row.auth_method,
      cardNumber: row.card_number,
      source: row.source ?? 'hikvision-device',
      rawEventCode: row.raw_event_code,
    }))
    .filter(isValidLog);
}

export async function regenerateConnectorToken(): Promise<{ token: string; device: DevicePublic }> {
  const device = await getActiveDeviceRecord();
  if (!device) throw new Error('No device configured');

  const { token, hash } = generateConnectorToken();

  if (isMemoryMode()) {
    memoryStore.updateMeta({ connector_token_hash: hash });
    const pub = await getActiveDevice();
    if (!pub) throw new Error('No device configured');
    return { token, device: pub };
  }

  const result = await query<DeviceRecord>(
    `UPDATE devices SET connector_token_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [hash, device.id],
  );
  return { token, device: toPublic(result.rows[0]) };
}

export async function updateConnectionMode(id: string, mode: ConnectionMode): Promise<DevicePublic> {
  if (isMemoryMode()) {
    memoryStore.updateMeta({ connection_mode: mode });
    const pub = memoryStore.getDevicePublic();
    if (!pub) throw new Error('No device configured');
    return pub;
  }
  const result = await query<DeviceRecord>(
    `UPDATE devices SET connection_mode = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [mode, id],
  );
  return toPublic(result.rows[0]);
}

export interface GatewayHeartbeatPayload {
  gatewayStatus: 'online' | 'offline';
  deviceStatus: string;
  deviceInfo?: {
    model?: string;
    serialNumber?: string;
    firmwareVersion?: string;
    deviceTime?: string;
    macAddress?: string;
  } | null;
  lastConnectionSuccess?: string | null;
  lastSyncTime?: string | null;
  errorMessage?: string | null;
}

export async function updateGatewayHeartbeat(payload: GatewayHeartbeatPayload): Promise<{ pendingCommand: Record<string, unknown> | null }> {
  const device = await getActiveDeviceRecord();
  if (!device) return { pendingCommand: null };

  const isOnline = payload.deviceStatus === 'online';
  const newStatus: DeviceStatus = isOnline ? 'online' : 'offline';
  const model = payload.deviceInfo?.model || device.model;
  const macAddress = payload.deviceInfo?.macAddress || device.mac_address;
  const deviceTime = payload.deviceInfo?.deviceTime ? new Date(payload.deviceInfo.deviceTime) : undefined;
  const lastConn = payload.lastConnectionSuccess ? new Date(payload.lastConnectionSuccess) : undefined;
  const lastDeviceAuth = isOnline ? new Date() : device.last_device_auth_at ? new Date(device.last_device_auth_at) : undefined;
  const connectorError = payload.errorMessage ?? null;

  if (isMemoryMode()) {
    memoryStore.updateMeta({
      status: newStatus,
      gateway_status: payload.gatewayStatus,
      gateway_last_heartbeat: new Date().toISOString(),
      gateway_error: connectorError,
      last_connection_success: payload.lastConnectionSuccess ?? null,
      last_device_auth_at: isOnline ? new Date().toISOString() : device.last_device_auth_at,
      last_connector_error: connectorError,
      connector_missed_heartbeats: 0,
      model,
      mac_address: macAddress,
    });
    const pending = device.pending_command ?? null;
    return { pendingCommand: pending };
  }

  const result = await query<DeviceRecord>(
    `UPDATE devices SET
      status = $1,
      gateway_status = $2,
      gateway_last_heartbeat = NOW(),
      gateway_error = $3,
      last_connection_success = COALESCE($4, last_connection_success),
      last_device_auth_at = CASE WHEN $1 = 'online' THEN NOW() ELSE last_device_auth_at END,
      last_connector_error = $5,
      connector_missed_heartbeats = 0,
      model = COALESCE($6, model),
      mac_address = COALESCE($7, mac_address),
      device_time = COALESCE($8, device_time),
      updated_at = NOW()
     WHERE id = $9 RETURNING pending_command`,
    [
      newStatus,
      payload.gatewayStatus,
      connectorError,
      lastConn ?? null,
      connectorError,
      model ?? null,
      macAddress ?? null,
      deviceTime ?? null,
      device.id,
    ],
  );

  const pending = result.rows[0]?.pending_command ?? null;
  if (pending) {
    // Clear pending command so it is not issued twice
    await query('UPDATE devices SET pending_command = NULL WHERE id = $1', [device.id]);
  }

  return { pendingCommand: pending };
}

export async function setPendingCommand(command: { id: string; type: 'test' | 'sync'; createdAt: number }): Promise<void> {
  const device = await getActiveDeviceRecord();
  if (!device) return;
  if (isMemoryMode()) return;
  await query('UPDATE devices SET pending_command = $1, command_result = NULL WHERE id = $2', [
    JSON.stringify(command),
    device.id,
  ]);
}

export async function setCommandResult(commandId: string, result: Record<string, unknown>): Promise<void> {
  const device = await getActiveDeviceRecord();
  if (!device) return;
  if (isMemoryMode()) return;
  await query('UPDATE devices SET command_result = $1 WHERE id = $2', [
    JSON.stringify({ commandId, result, completedAt: new Date().toISOString() }),
    device.id,
  ]);
}

export async function getCommandResult(commandId: string): Promise<Record<string, unknown> | null> {
  const device = await getActiveDeviceRecord();
  if (!device || !device.command_result) return null;
  const res = device.command_result as { commandId?: string; result?: Record<string, unknown> };
  if (res.commandId === commandId) return res.result ?? null;
  return null;
}

export { toPublic, isMemoryMode, isExplicitMemoryStore, setMemoryMode };
