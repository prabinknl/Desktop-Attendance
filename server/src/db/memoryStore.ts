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

export type InvitationRecord = {
  token: string;
  email: string;
  name?: string;
  role: string;
  created_at: string;
  expires_at: string;
  used: boolean;
  id?: string;
  client_id?: string;
  phone?: string;
  company_name?: string;
  plan_type?: 'free' | 'paid';
  duration_days?: number;
  access_start_at?: string;
  access_expires_at?: string;
  token_hash?: string;
  sms_code_hash?: string;
  sms_expires_at?: string;
  sms_attempts?: number;
  sms_last_sent_at?: string;
  status?: 'pending' | 'accepted' | 'expired' | 'cancelled';
  created_by?: string;
  updated_at?: string;
};

/** App user row kept when PostgreSQL is unavailable (persisted with the memory store). */
export type MemoryUserRecord = {
  id: string;
  name: string;
  email: string;
  role: string;
  password: string;
  avatar?: string;
  phone?: string;
  timezone?: string;
  employeeId?: string;
  departmentId?: string;
  clientId?: string;
  planType?: 'free' | 'paid';
  accessExpiresAt?: string;
  status?: string;
  emailVerified?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/** In-memory fallback when PostgreSQL is unavailable — persisted to disk so restarts keep data. */
let memoryDevice: DeviceRecord | null = null;
let memoryLogs: MemoryLog[] = [];
let memoryInvitations: InvitationRecord[] = [];
let memoryUsers: MemoryUserRecord[] = [];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Electron sets ATTENDANCE_DATA_DIR to a writable userData folder. */
const DATA_DIR = path.resolve(
  process.env.ATTENDANCE_DATA_DIR?.trim() || path.join(__dirname, '../../data'),
);
const STORE_FILE = path.join(DATA_DIR, 'memory-store.json');

function loadFromDisk() {
  try {
    if (!fs.existsSync(STORE_FILE)) return;
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as {
      device?: DeviceRecord | null;
      logs?: MemoryLog[];
      invitations?: InvitationRecord[];
      users?: MemoryUserRecord[];
    };
    if (parsed.device && typeof parsed.device === 'object') {
      memoryDevice = parsed.device;
    }
    if (Array.isArray(parsed.logs)) {
      memoryLogs = parsed.logs;
    }
    if (Array.isArray(parsed.invitations)) {
      memoryInvitations = parsed.invitations;
    }
    if (Array.isArray(parsed.users)) {
      memoryUsers = parsed.users;
    }
    console.log(
      `[MemoryStore] Restored from disk: device=${memoryDevice ? memoryDevice.id : 'none'} logs=${memoryLogs.length} invitations=${memoryInvitations.length} users=${memoryUsers.length}`,
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
      {
        device: memoryDevice,
        logs: memoryLogs,
        invitations: memoryInvitations,
        users: memoryUsers,
        savedAt: new Date().toISOString(),
      },
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

  saveInvitation(inv: InvitationRecord): void {
    memoryInvitations = [
      inv,
      ...memoryInvitations.filter((i) => i.token !== inv.token),
    ];
    saveToDisk();
  },

  getInvitation(token: string): InvitationRecord | null {
    if (!token) return null;
    const norm = token.trim().toLowerCase();
    const inv = memoryInvitations.find(
      (i) => (i.token && i.token.trim().toLowerCase() === norm) || (i.token_hash && i.token_hash.trim().toLowerCase() === norm)
    );
    if (!inv) return null;
    return inv;
  },

  getInvitationByTokenHash(tokenHash: string): InvitationRecord | null {
    if (!tokenHash) return null;
    const norm = tokenHash.trim().toLowerCase();
    const inv = memoryInvitations.find(
      (i) => (i.token_hash && i.token_hash.trim().toLowerCase() === norm) || (i.token && i.token.trim().toLowerCase() === norm)
    );
    if (!inv) return null;
    return inv;
  },

  getInvitationBySmsCodeHash(smsCodeHash: string): InvitationRecord | null {
    if (!smsCodeHash) return null;
    const norm = smsCodeHash.trim().toLowerCase();
    // Prefer the newest pending invite when multiple share a hash (test fixtures).
    const matches = memoryInvitations
      .filter((i) => i.sms_code_hash && i.sms_code_hash.trim().toLowerCase() === norm)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return matches[0] || null;
  },

  getPendingInvitationByEmail(email: string, role: string): InvitationRecord | null {
    const norm = email.trim().toLowerCase();
    const inv = memoryInvitations.find(
      (i) => i.email.trim().toLowerCase() === norm && i.role === role && (!i.status || i.status === 'pending') && !i.used
    );
    return inv || null;
  },

  markInvitationUsed(token: string): void {
    memoryInvitations = memoryInvitations.map((i) =>
      i.token === token || i.token_hash === token ? { ...i, used: true, status: 'accepted' } : i,
    );
    saveToDisk();
  },

  getUsers(): MemoryUserRecord[] {
    return memoryUsers.map((u) => ({ ...u }));
  },

  getUserByEmail(email: string): MemoryUserRecord | null {
    const key = email.trim().toLowerCase();
    if (!key) return null;
    const found = memoryUsers.find((u) => u.email.trim().toLowerCase() === key);
    return found ? { ...found } : null;
  },

  getUserById(id: string): MemoryUserRecord | null {
    const found = memoryUsers.find((u) => u.id === id);
    return found ? { ...found } : null;
  },

  upsertUser(user: MemoryUserRecord): MemoryUserRecord {
    const emailLower = user.email.trim().toLowerCase();
    const now = new Date().toISOString();
    const next: MemoryUserRecord = {
      ...user,
      email: emailLower,
      updatedAt: now,
      createdAt: user.createdAt ?? now,
    };

    // Enforce a single admin account in memory mode (mirrors DB upsert behavior).
    if (next.role === 'admin') {
      memoryUsers = memoryUsers.filter(
        (u) => !(u.role === 'admin' && u.email.trim().toLowerCase() !== emailLower),
      );
    }

    const idx = memoryUsers.findIndex((u) => u.email.trim().toLowerCase() === emailLower);
    if (idx >= 0) {
      memoryUsers[idx] = {
        ...memoryUsers[idx],
        ...next,
        id: memoryUsers[idx].id || next.id,
        createdAt: memoryUsers[idx].createdAt ?? next.createdAt,
      };
      saveToDisk();
      return { ...memoryUsers[idx] };
    }

    memoryUsers.push(next);
    saveToDisk();
    return { ...next };
  },

  updateUserStatus(email: string, status: string, emailVerified: boolean): void {
    const key = email.trim().toLowerCase();
    const idx = memoryUsers.findIndex((u) => u.email.trim().toLowerCase() === key);
    if (idx < 0) return;
    memoryUsers[idx] = {
      ...memoryUsers[idx],
      status,
      emailVerified,
      updatedAt: new Date().toISOString(),
    };
    saveToDisk();
  },

  deleteUserById(id: string): void {
    const before = memoryUsers.length;
    memoryUsers = memoryUsers.filter((u) => u.id !== id);
    if (memoryUsers.length !== before) saveToDisk();
  },

  deleteUserByEmail(email: string): void {
    const key = email.trim().toLowerCase();
    if (!key) return;
    const before = memoryUsers.length;
    memoryUsers = memoryUsers.filter((u) => u.email.trim().toLowerCase() !== key);
    if (memoryUsers.length !== before) saveToDisk();
  },

  deleteUsersByClientId(clientId: string): void {
    const key = clientId.trim();
    if (!key) return;
    const before = memoryUsers.length;
    memoryUsers = memoryUsers.filter((u) => (u.clientId ?? '') !== key && u.id !== key);
    if (memoryUsers.length !== before) saveToDisk();
  },

  deleteInvitationsByEmail(email: string): void {
    const key = email.trim().toLowerCase();
    if (!key) return;
    const before = memoryInvitations.length;
    memoryInvitations = memoryInvitations.filter((i) => i.email.trim().toLowerCase() !== key);
    if (memoryInvitations.length !== before) saveToDisk();
  },
};

export function createMemoryRecord(
  payload: DeviceConnectPayload,
  encryptedPassword: string | null,
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
    connection_mode: payload.connectionMode ?? existing?.connection_mode ?? 'local_direct',
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
}
