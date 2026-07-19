import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeviceConnectPayload, DevicePublic, DeviceRecord, DeviceStatus } from '../types/index.js';

type MemoryLog = {
  id: string;
  device_id: string;
  external_id: string;
  employee_id: string;
  employee_name: string;
  check_type: string;
  event_time: string;
  auth_method?: string | null;
  card_number?: string | null;
  source?: string | null;
  raw_event_code?: string | null;
  raw_data?: string | null;
};

/** In-memory fallback when PostgreSQL is unavailable — persisted to disk so restarts keep data. */
let memoryDevice: DeviceRecord | null = null;
let memoryLogs: MemoryLog[] = [];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const STORE_FILE = path.join(DATA_DIR, 'memory-store.json');

function loadFromDisk() {
  try {
    if (!fs.existsSync(STORE_FILE)) return;
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as {
      device?: DeviceRecord | null;
      logs?: MemoryLog[];
    };
    if (parsed.device && typeof parsed.device === 'object') {
      memoryDevice = parsed.device;
    }
    if (Array.isArray(parsed.logs)) {
      memoryLogs = parsed.logs;
    }
    console.log(
      `[MemoryStore] Restored from disk: device=${memoryDevice ? memoryDevice.id : 'none'} logs=${memoryLogs.length}`,
    );
  } catch (err) {
    console.warn('[MemoryStore] Could not load persisted store:', err instanceof Error ? err.message : err);
  }
}

function saveToDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const payload = JSON.stringify(
      { device: memoryDevice, logs: memoryLogs, savedAt: new Date().toISOString() },
      null,
      2,
    );
    fs.writeFileSync(STORE_FILE, payload, 'utf8');
  } catch (err) {
    console.warn('[MemoryStore] Could not persist store:', err instanceof Error ? err.message : err);
  }
}

loadFromDisk();

export function isMemoryMode(): boolean {
  return process.env.USE_MEMORY_STORE === 'true';
}

export function setMemoryMode(enabled: boolean): void {
  process.env.USE_MEMORY_STORE = enabled ? 'true' : 'false';
}

function toPublic(record: DeviceRecord): DevicePublic {
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
    status: record.status,
    autoSyncEnabled: record.auto_sync_enabled,
    syncIntervalSeconds: record.sync_interval_seconds,
    lastSync: record.last_sync,
    lastAttendanceReceived: record.last_attendance_received,
    deviceTime: record.device_time,
    macAddress: record.mac_address,
  };
}

export const memoryStore = {
  getDevice(): DeviceRecord | null {
    return memoryDevice;
  },

  getDevicePublic(): DevicePublic | null {
    return memoryDevice ? toPublic(memoryDevice) : null;
  },

  saveDevice(record: DeviceRecord): DevicePublic {
    memoryDevice = record;
    saveToDisk();
    return toPublic(record);
  },

  updateStatus(status: DeviceStatus): void {
    if (memoryDevice) {
      memoryDevice = { ...memoryDevice, status, updated_at: new Date().toISOString() };
      saveToDisk();
    }
  },

  updateMeta(fields: Partial<DeviceRecord>): void {
    if (memoryDevice) {
      memoryDevice = { ...memoryDevice, ...fields, updated_at: new Date().toISOString() };
      saveToDisk();
    }
  },

  getLogs(deviceId: string, range?: { from?: string; to?: string }) {
    const fromIso = range?.from
      ? new Date(`${range.from}T00:00:00`).toISOString()
      : undefined;
    const toIso = range?.to
      ? new Date(`${range.to}T23:59:59.999`).toISOString()
      : undefined;
    const hasRange = Boolean(fromIso || toIso);
    const limit = hasRange ? 10_000 : 100;

    return memoryLogs
      .filter((l) => {
        if (l.device_id !== deviceId) return false;
        if (fromIso && l.event_time < fromIso) return false;
        if (toIso && l.event_time > toIso) return false;
        return true;
      })
      .sort((a, b) => b.event_time.localeCompare(a.event_time))
      .slice(0, limit);
  },

  addLog(entry: MemoryLog): boolean {
    if (memoryLogs.some((l) => l.device_id === entry.device_id && l.external_id === entry.external_id)) {
      return false;
    }
    memoryLogs = [entry, ...memoryLogs].slice(0, 10_000);
    saveToDisk();
    return true;
  },

  /** Clear all in-memory logs (never seed demo data). */
  clearLogs(): void {
    memoryLogs = [];
    saveToDisk();
  },
};

export function createMemoryRecord(
  payload: DeviceConnectPayload,
  encryptedPassword: string,
  existing?: DeviceRecord | null,
): DeviceRecord {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? `mem-${Date.now()}`,
    name: payload.name,
    brand: payload.brand,
    model: payload.model ?? null,
    ip_address: payload.ipAddress,
    port: payload.port,
    username: payload.username,
    password_encrypted: encryptedPassword,
    location: payload.location ?? null,
    description: payload.description ?? null,
    status: existing?.status ?? 'offline',
    auto_sync_enabled: existing?.auto_sync_enabled ?? false,
    sync_interval_seconds: existing?.sync_interval_seconds ?? 60,
    last_sync: existing?.last_sync ?? null,
    last_attendance_received: existing?.last_attendance_received ?? null,
    device_time: existing?.device_time ?? null,
    mac_address: existing?.mac_address ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
}
