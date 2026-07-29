import { query } from '../db/pool.js';
import { memoryStore, createMemoryRecord, isMemoryMode, setMemoryMode } from '../db/memoryStore.js';
import { encryptPassword, decryptPassword } from '../services/crypto/passwordCrypto.js';
import { getOrCreateDeviceAdapter, clearDeviceAdapterCache } from '../services/device/DeviceSessionCache.js';
import type {
  DeviceConnectPayload,
  DevicePublic,
  DeviceRecord,
  DeviceStatus,
  AttendanceLogEntry,
} from '../types/index.js';

function toPublic(record: DeviceRecord): DevicePublic {
  const now = Date.now();
  const heartbeatMs = record.gateway_last_heartbeat ? new Date(record.gateway_last_heartbeat).getTime() : 0;
  const isHeartbeatFresh = heartbeatMs > 0 && now - heartbeatMs < 60_000;
  const computedGatewayStatus: 'online' | 'offline' = isHeartbeatFresh ? 'online' : 'offline';

  // Overall status: direct connection (online/syncing/connecting) takes priority,
  // falling back to gateway status if direct status is offline.
  const computedStatus =
    record.status === 'online' || record.status === 'syncing' || record.status === 'connecting'
      ? record.status
      : isHeartbeatFresh && record.gateway_status === 'online'
        ? 'online'
        : 'offline';

  return {
    id: record.id,
    name: record.name,
    brand: record.brand,
    model: record.model,
    ipAddress: record.ip_address,
    port: record.port,
    username: record.username,
    location: record.location,
    description: record.description,
    status: computedStatus,
    autoSyncEnabled: record.auto_sync_enabled,
    syncIntervalSeconds: record.sync_interval_seconds,
    lastSync: record.last_sync,
    lastAttendanceReceived: record.last_attendance_received,
    deviceTime: record.device_time,
    macAddress: record.mac_address,
    gatewayStatus: computedGatewayStatus,
    gatewayLastHeartbeat: record.gateway_last_heartbeat,
    gatewayError: computedGatewayStatus === 'offline' ? (record.gateway_error || 'Gateway Offline: Local agent heartbeat missing') : record.gateway_error,
    lastConnectionSuccess: record.last_connection_success,
  };
}

async function dbQuery<T extends import('pg').QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[] }> {
  try {
    return await query<T>(text, params);
  } catch (err) {
    if (!isMemoryMode()) {
      console.warn('[DeviceModel] DB unavailable, switching to memory store');
      setMemoryMode(true);
    }
    throw err;
  }
}

export async function getActiveDevice(): Promise<DevicePublic | null> {
  if (isMemoryMode()) return memoryStore.getDevicePublic();
  try {
    const result = await dbQuery<DeviceRecord>('SELECT * FROM devices ORDER BY updated_at DESC LIMIT 1');
    return result.rows[0] ? toPublic(result.rows[0]) : null;
  } catch {
    return memoryStore.getDevicePublic();
  }
}

export async function getActiveDeviceRecord(): Promise<DeviceRecord | null> {
  if (isMemoryMode()) return memoryStore.getDevice();
  try {
    const result = await dbQuery<DeviceRecord>('SELECT * FROM devices ORDER BY updated_at DESC LIMIT 1');
    return result.rows[0] ?? null;
  } catch {
    return memoryStore.getDevice();
  }
}

export async function saveDevice(payload: DeviceConnectPayload): Promise<DevicePublic> {
  const existing = await getActiveDeviceRecord();
  // Keep previously stored password when the form sends an empty password
  const passwordPlain =
    payload.password && payload.password.length > 0
      ? payload.password
      : existing?.password_encrypted
        ? decryptPassword(existing.password_encrypted)
        : '';
  if (!passwordPlain) {
    throw new Error('Password is required');
  }
  const encrypted = encryptPassword(passwordPlain);
  // Config may have changed — drop warm adapter so the next sync uses new credentials/host.
  clearDeviceAdapterCache();

  if (isMemoryMode()) {
    const record = createMemoryRecord(payload, encrypted, existing);
    return memoryStore.saveDevice(record);
  }

  try {
    if (existing) {
      const result = await query<DeviceRecord>(
        `UPDATE devices SET
          name = $1, brand = $2, model = $3, ip_address = $4, port = $5,
          username = $6, password_encrypted = $7, location = $8, description = $9,
          updated_at = NOW()
         WHERE id = $10 RETURNING *`,
        [
          payload.name, payload.brand, payload.model ?? null, payload.ipAddress, payload.port,
          payload.username, encrypted, payload.location ?? null, payload.description ?? null, existing.id,
        ],
      );
      return toPublic(result.rows[0]);
    }

    const result = await query<DeviceRecord>(
      `INSERT INTO devices (name, brand, model, ip_address, port, username, password_encrypted, location, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        payload.name, payload.brand, payload.model ?? null, payload.ipAddress, payload.port,
        payload.username, encrypted, payload.location ?? null, payload.description ?? null,
      ],
    );
    return toPublic(result.rows[0]);
  } catch (err) {
    if (err instanceof Error && err.message === 'Password is required') throw err;
    setMemoryMode(true);
    const memExisting = memoryStore.getDevice();
    const record = createMemoryRecord(payload, encrypted, memExisting);
    return memoryStore.saveDevice(record);
  }
}

export async function updateDeviceStatus(id: string, status: DeviceStatus): Promise<void> {
  if (isMemoryMode()) {
    memoryStore.updateStatus(status);
    return;
  }
  try {
    await query('UPDATE devices SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
  } catch {
    memoryStore.updateStatus(status);
  }
}

export async function updateSyncSettings(
  id: string,
  autoSyncEnabled: boolean,
  syncIntervalSeconds: number,
): Promise<DevicePublic> {
  if (isMemoryMode()) {
    memoryStore.updateMeta({ auto_sync_enabled: autoSyncEnabled, sync_interval_seconds: syncIntervalSeconds });
    return memoryStore.getDevicePublic()!;
  }
  const result = await query<DeviceRecord>(
    `UPDATE devices SET auto_sync_enabled = $1, sync_interval_seconds = $2, updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [autoSyncEnabled, syncIntervalSeconds, id],
  );
  return toPublic(result.rows[0]);
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

  if (isMemoryMode()) {
    memoryStore.updateMeta(memoryFields);
    return;
  }

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
  await query(`UPDATE devices SET ${sets.join(', ')} WHERE id = $${idx}`, values);
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
      .map((row) => ({
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

  const result = await query<{
    id: string;
    event_time: string;
    employee_id: string | null;
    employee_name: string | null;
    check_type: string;
    auth_method: string | null;
    card_number: string | null;
    source: string | null;
    raw_event_code: string | null;
  }>(
    `SELECT id, event_time, employee_id, employee_name, check_type,
            auth_method, card_number, source, raw_event_code
     FROM device_attendance_logs
     WHERE ${conditions.join(' AND ')}
     ORDER BY event_time DESC
     LIMIT $${values.length}`,
    values,
  );

  return result.rows
    .map((row) => ({
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

  if (isMemoryMode()) {
    memoryStore.updateMeta({
      status: newStatus,
      gateway_status: payload.gatewayStatus,
      gateway_last_heartbeat: new Date().toISOString(),
      gateway_error: payload.errorMessage ?? null,
      last_connection_success: payload.lastConnectionSuccess ?? null,
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
      model = COALESCE($5, model),
      mac_address = COALESCE($6, mac_address),
      device_time = COALESCE($7, device_time),
      updated_at = NOW()
     WHERE id = $8 RETURNING pending_command`,
    [
      newStatus,
      payload.gatewayStatus,
      payload.errorMessage ?? null,
      lastConn ?? null,
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

export { toPublic, isMemoryMode, setMemoryMode };
