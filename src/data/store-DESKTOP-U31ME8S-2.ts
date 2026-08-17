/**
 * Data store — in-memory + localStorage with cloud PostgreSQL sync.
 * On every write: localStorage is updated immediately for responsiveness,
 * then the same record is pushed to the cloud DB via the Express server.
 * On load (hydratePersistedStores): cloud DB is tried first; localStorage is
 * the offline fallback so the app still works without network.
 */
import {
  mockAttendance,
  mockDepartments,
  mockEmployees,
  mockLeaveRequests,
  mockShifts,
  mockHolidays,
} from './mockData';
import type {
  Attendance, Department, Employee, LeaveRequest, PunchTimeRequest, Shift, Holiday,
  AttendanceStatus, LeaveStatus, PunchRequestStatus,
} from '../types';
import { generateId } from '../lib/utils';
import { cloudAttendanceApi } from '../api/attendanceApi';
import {
  cloudDepartmentApi, cloudEmployeeApi, cloudHolidayApi,
  cloudLeaveApi, cloudPunchRequestApi, cloudShiftApi,
} from '../api/coreDataApi';

const ATTENDANCE_STORAGE_KEY = 'attendance-store-v1';
const EMPLOYEE_STORAGE_KEY = 'employee-store-v1';
const LEAVE_STORAGE_KEY = 'leave-store-v1';
const PUNCH_REQUEST_STORAGE_KEY = 'punch-request-store-v1';
const DEPARTMENT_STORAGE_KEY = 'department-store-v1';
const SHIFT_STORAGE_KEY = 'shift-store-v1';
const HOLIDAY_STORAGE_KEY = 'holiday-store-v1';

type StoreListener = () => void;
const attendanceListeners = new Set<StoreListener>();

function notifyAttendanceListeners() {
  attendanceListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore listener errors */
    }
  });
}

function loadAttendanceStore(): Attendance[] {
  try {
    const raw = localStorage.getItem(ATTENDANCE_STORAGE_KEY);
    if (!raw) return [...mockAttendance];
    const parsed = JSON.parse(raw) as Attendance[];
    if (!Array.isArray(parsed)) return [...mockAttendance];
    return parsed;
  } catch {
    return [...mockAttendance];
  }
}

function persistAttendanceStore() {
  try {
    localStorage.setItem(ATTENDANCE_STORAGE_KEY, JSON.stringify(attendanceStore));
  } catch (err) {
    console.warn('[Store] Failed to save attendance to localStorage:', err);
  }
  notifyAttendanceListeners();
}

/**
 * Fire-and-forget cloud sync for a single record.
 * Silently ignored when the API server is offline.
 */
function syncRecordToCloud(record: Attendance) {
  cloudAttendanceApi.upsert(record).catch(() => {
    /* server offline — localStorage copy is the fallback */
  });
}

/**
 * Fire-and-forget cloud delete.
 */
function deleteRecordFromCloud(id: string) {
  cloudAttendanceApi.delete(id).catch(() => { /* offline */ });
}

function loadEmployeeStore(): Employee[] {
  try {
    const raw = localStorage.getItem(EMPLOYEE_STORAGE_KEY);
    if (!raw) return [...mockEmployees];
    const parsed = JSON.parse(raw) as Employee[];
    if (!Array.isArray(parsed)) return [...mockEmployees];
    // Merge device-synced employees onto mocks by id/employeeId
    const byKey = new Map<string, Employee>();
    for (const e of mockEmployees) {
      byKey.set(e.id, e);
      byKey.set(e.employeeId, e);
    }
    for (const e of parsed) {
      byKey.set(e.id, e);
      byKey.set(e.employeeId, e);
    }
    const seen = new Set<string>();
    const out: Employee[] = [];
    for (const e of byKey.values()) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
    return out;
  } catch {
    return [...mockEmployees];
  }
}

function persistEmployeeStore() {
  try {
    localStorage.setItem(EMPLOYEE_STORAGE_KEY, JSON.stringify(employeeStore));
  } catch (err) {
    console.warn('[Store] Failed to save employees:', err);
  }
}

function loadLeaveStore(): LeaveRequest[] {
  try {
    const raw = localStorage.getItem(LEAVE_STORAGE_KEY);
    if (!raw) return [...mockLeaveRequests];
    const parsed = JSON.parse(raw) as LeaveRequest[];
    return Array.isArray(parsed) ? parsed : [...mockLeaveRequests];
  } catch {
    return [...mockLeaveRequests];
  }
}

function persistLeaveStore() {
  try {
    localStorage.setItem(LEAVE_STORAGE_KEY, JSON.stringify(leaveStore));
  } catch {
    /* ignore */
  }
}

function loadPunchRequestStore(): PunchTimeRequest[] {
  try {
    const raw = localStorage.getItem(PUNCH_REQUEST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PunchTimeRequest[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistPunchRequestStore() {
  try {
    localStorage.setItem(PUNCH_REQUEST_STORAGE_KEY, JSON.stringify(punchRequestStore));
  } catch {
    /* ignore */
  }
}

/** Read a cached collection, falling back to the bundled seed data. */
function loadCollection<T>(key: string, seed: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [...seed];
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [...seed];
  } catch {
    return [...seed];
  }
}

function persistCollection<T>(key: string, rows: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    /* quota — the cloud copy is authoritative anyway */
  }
}

type CloudCollectionApi<T> = {
  getAll: () => Promise<T[]>;
  upsert: (record: T) => Promise<T | null>;
  bulkUpsert: (records: T[]) => Promise<T[]>;
  delete: (id: string) => Promise<void>;
};

/**
 * Push a write to the cloud without blocking the UI. The localStorage copy has
 * already been updated, so a failure here just means this device is ahead
 * until the next successful sync.
 */
function pushToCloud<T>(api: CloudCollectionApi<T>, record: T) {
  api.upsert(record).catch(() => { /* offline */ });
}

function removeFromCloud<T>(api: CloudCollectionApi<T>, id: string) {
  api.delete(id).catch(() => { /* offline */ });
}

/**
 * Resolve a collection against the cloud database. A non-empty cloud table is
 * authoritative, so rows deleted on another device stay deleted. An empty one
 * means this table has not been populated yet, so the local rows are uploaded
 * once to seed it.
 */
async function hydrateCollection<T extends { id: string }>(
  api: CloudCollectionApi<T>,
  local: T[],
  key: string,
): Promise<T[]> {
  const cloud = await api.getAll();
  if (cloud.length > 0) {
    persistCollection(key, cloud);
    return cloud;
  }
  if (local.length > 0) {
    await api.bulkUpsert(local);
  }
  return local;
}

// ─── Mutable stores ───────────────────────────────────────────────────────────
let attendanceStore: Attendance[] = loadAttendanceStore();
let employeeStore: Employee[] = loadEmployeeStore();
let departmentStore: Department[] = loadCollection(DEPARTMENT_STORAGE_KEY, mockDepartments);
let leaveStore: LeaveRequest[] = loadLeaveStore();
let punchRequestStore: PunchTimeRequest[] = loadPunchRequestStore();
let shiftStore: Shift[] = loadCollection(SHIFT_STORAGE_KEY, mockShifts);
let holidayStore: Holiday[] = loadCollection(HOLIDAY_STORAGE_KEY, mockHolidays);

function persistDepartmentStore() {
  persistCollection(DEPARTMENT_STORAGE_KEY, departmentStore);
}

function persistShiftStore() {
  persistCollection(SHIFT_STORAGE_KEY, shiftStore);
}

function persistHolidayStore() {
  persistCollection(HOLIDAY_STORAGE_KEY, holidayStore);
}

/**
 * Reload employees / attendance / leave from localStorage first, then from
 * the cloud database. Cloud records overwrite local ones so that data added
 * on any device is always visible after this call.
 * Call after login or on app start.
 */
export async function hydratePersistedStores() {
  // 1. Fast local load so the UI isn't blank
  attendanceStore = loadAttendanceStore();
  employeeStore = loadEmployeeStore();
  leaveStore = loadLeaveStore();
  punchRequestStore = loadPunchRequestStore();
  departmentStore = loadCollection(DEPARTMENT_STORAGE_KEY, mockDepartments);
  shiftStore = loadCollection(SHIFT_STORAGE_KEY, mockShifts);
  holidayStore = loadCollection(HOLIDAY_STORAGE_KEY, mockHolidays);
  notifyAttendanceListeners();

  // 2. Reconcile every collection with the cloud DB so a second device sees
  //    the same employees, leave and punch requests. Each is independent —
  //    one failing table must not block the rest.
  const collections = await Promise.allSettled([
    hydrateCollection(cloudDepartmentApi, departmentStore, DEPARTMENT_STORAGE_KEY),
    hydrateCollection(cloudShiftApi, shiftStore, SHIFT_STORAGE_KEY),
    hydrateCollection(cloudHolidayApi, holidayStore, HOLIDAY_STORAGE_KEY),
    hydrateCollection(cloudEmployeeApi, employeeStore, EMPLOYEE_STORAGE_KEY),
    hydrateCollection(cloudLeaveApi, leaveStore, LEAVE_STORAGE_KEY),
    hydrateCollection(cloudPunchRequestApi, punchRequestStore, PUNCH_REQUEST_STORAGE_KEY),
  ]);

  if (collections[0].status === 'fulfilled') departmentStore = collections[0].value;
  if (collections[1].status === 'fulfilled') shiftStore = collections[1].value;
  if (collections[2].status === 'fulfilled') holidayStore = collections[2].value;
  if (collections[3].status === 'fulfilled') employeeStore = collections[3].value;
  if (collections[4].status === 'fulfilled') leaveStore = collections[4].value;
  if (collections[5].status === 'fulfilled') punchRequestStore = collections[5].value;

  if (collections.every((c) => c.status === 'rejected')) {
    console.info('[Store] Cloud sync unavailable — using local data');
  }

  // 3. Pull cloud attendance and merge (cloud wins for non-manual rows)
  try {
    const cloudRecords = await cloudAttendanceApi.getAll();
    if (cloudRecords.length > 0) {
      // Merge: keep manual-override local edits if newer, else use cloud
      const byKey = new Map<string, Attendance>();
      // Seed with current local store
      for (const r of attendanceStore) {
        byKey.set(`${r.employeeId}|${r.date}`, r);
      }
      // Overwrite with cloud records (cloud is source of truth for non-manual)
      for (const r of cloudRecords) {
        const key = `${r.employeeId}|${r.date}`;
        const local = byKey.get(key);
        if (!local) {
          byKey.set(key, r);
        } else if (r.manualOverride && !local.manualOverride) {
          byKey.set(key, r);
        } else if (!local.manualOverride) {
          byKey.set(key, r);
        } else if ((r.updatedAt || '') > (local.updatedAt || '')) {
          byKey.set(key, r);
        }
      }
      attendanceStore = Array.from(byKey.values());
      // Persist merged result back to localStorage
      try {
        localStorage.setItem(ATTENDANCE_STORAGE_KEY, JSON.stringify(attendanceStore));
      } catch { /* quota */ }
      notifyAttendanceListeners();
    }
  } catch {
    // Server offline — local data is used as-is
    console.info('[Store] Cloud sync unavailable — using local attendance data');
  }
}

/** Subscribe to attendance changes (Edit Attendance → Report live update). */
export function subscribeAttendance(listener: StoreListener): () => void {
  attendanceListeners.add(listener);
  return () => {
    attendanceListeners.delete(listener);
  };
}

function normalizeEmpId(id: string | number): string {
  const s = String(id || '').trim().toLowerCase();
  const digits = s.replace(/\D/g, '').replace(/^0+/, '');
  return digits || s;
}

function sameEmployeeRef(a: string, b: string) {
  if (String(a) === String(b)) return true;
  const na = normalizeEmpId(a);
  const nb = normalizeEmpId(b);
  return Boolean(na) && na === nb;
}

function employeeIdAliases(employeeId: string): string[] {
  const ids = new Set<string>([String(employeeId)]);
  for (const e of employeeStore) {
    if (e.id === employeeId || e.employeeId === employeeId) {
      ids.add(String(e.id));
      ids.add(String(e.employeeId));
    }
  }
  // Also pull aliases from any attendance row that shares an id
  for (const a of attendanceStore) {
    if (ids.has(String(a.employeeId))) {
      for (const e of employeeStore) {
        if (e.id === a.employeeId || e.employeeId === a.employeeId) {
          ids.add(String(e.id));
          ids.add(String(e.employeeId));
        }
      }
    }
  }
  return [...ids];
}

function findAttendanceForDeviceDay(employeeId: string, date: string) {
  const aliases = employeeIdAliases(employeeId);
  const matches = attendanceStore.filter(
    (a) => aliases.some((id) => sameEmployeeRef(a.employeeId, id)) && a.date === date,
  );
  if (!matches.length) return undefined;
  // Prefer a manually edited row so device sync / Refresh does not wipe it
  return matches.find((a) => a.manualOverride) ?? matches[0];
}

/** One row per employee+date — prefer complete punches / manual edits. */
function attendanceQualityScore(row: Attendance): number {
  let score = 0;
  if (row.manualOverride) score += 10_000;
  if (row.manualCheckIn || row.manualCheckOut) score += 5_000;
  if (row.checkIn || row.manualCheckIn) score += 100;
  if (row.checkOut || row.manualCheckOut) score += 200;
  if (row.status === 'present' || row.status === 'late' || row.status === 'work_from_home') score += 50;
  else if (row.status === 'half_day') score += 20;
  else if (row.status === 'on_leave') score += 10;
  score += Math.min(80, Math.round((row.workingHours || 0) * 10));
  // Prefer newer updates as a weak tie-breaker
  const t = Date.parse(row.updatedAt || row.createdAt || '');
  if (!Number.isNaN(t)) score += Math.min(99, Math.floor(t / 1e11));
  return score;
}

function normalizeAttendanceDate(date: string): string {
  const raw = String(date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** One row per employee+date — prefer manual edits, then most complete punch day. */
function dedupeAttendanceRows(rows: Attendance[]): Attendance[] {
  const best = new Map<string, Attendance>();
  for (const row of rows) {
    const date = normalizeAttendanceDate(row.date);
    const normalized = date === row.date ? row : { ...row, date };
    // Collapse machine id / internal id onto one bucket using numeric alias when possible
    const empKey = normalizeEmpId(normalized.employeeId) || String(normalized.employeeId);
    const key = `${empKey}|${date}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, normalized);
      continue;
    }
    if (attendanceQualityScore(normalized) > attendanceQualityScore(prev)) {
      best.set(key, normalized);
    }
  }
  return Array.from(best.values());
}

// ─── Attendance API ───────────────────────────────────────────────────────────
export const AttendanceAPI = {
  getAll: () => Promise.resolve(dedupeAttendanceRows([...attendanceStore])),

  getByEmployee: (employeeId: string) =>
    Promise.resolve(
      dedupeAttendanceRows(
        attendanceStore.filter(
          (a) =>
            sameEmployeeRef(a.employeeId, employeeId) ||
            employeeStore.some(
              (e) =>
                (e.id === employeeId || e.employeeId === employeeId) &&
                (sameEmployeeRef(a.employeeId, e.id) || sameEmployeeRef(a.employeeId, e.employeeId)),
            ),
        ),
      ),
    ),

  getByDate: (date: string) =>
    Promise.resolve(dedupeAttendanceRows(attendanceStore.filter(a => a.date === date))),

  getByDateRange: (from: string, to: string) =>
    Promise.resolve(dedupeAttendanceRows(attendanceStore.filter(a => a.date >= from && a.date <= to))),

  create: (data: Omit<Attendance, 'id' | 'createdAt' | 'updatedAt'>) => {
    const record: Attendance = {
      ...data,
      id: generateId('att'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // Drop older duplicates for the same employee+date
    attendanceStore = [
      record,
      ...attendanceStore.filter(
        (a) => !(sameEmployeeRef(a.employeeId, record.employeeId) && a.date === record.date),
      ),
    ];
    persistAttendanceStore();
    syncRecordToCloud(record);
    return Promise.resolve(record);
  },

  update: (id: string, data: Partial<Attendance>) => {
    let updated: Attendance | undefined;
    attendanceStore = attendanceStore.map((a) => {
      if (a.id !== id) return a;
      updated = {
        ...a,
        ...data,
        id: a.id,
        // Keep the original calendar day unless the caller intentionally changes date
        date: data.date ?? a.date,
        employeeId: data.employeeId ?? a.employeeId,
        manualOverride: data.manualOverride ?? a.manualOverride,
        updatedAt: new Date().toISOString(),
      };
      return updated;
    });
    if (!updated) {
      return Promise.reject(new Error(`Attendance record not found: ${id}`));
    }
    // Remove duplicate rows for THIS day only — never touch other dates
    const empId = updated.employeeId;
    const date = updated.date;
    attendanceStore = attendanceStore.filter(
      (a) =>
        a.id === updated!.id ||
        !(sameEmployeeRef(a.employeeId, empId) && a.date === date),
    );
    persistAttendanceStore();
    syncRecordToCloud(updated);
    return Promise.resolve(updated);
  },

  /**
   * Apply the same manual fields to many attendance ids (bulk edit).
   * Does not change each row's date.
   */
  updateMany: (ids: string[], data: Partial<Attendance>) => {
    const idSet = new Set(ids);
    const touched: Attendance[] = [];
    attendanceStore = attendanceStore.map((a) => {
      if (!idSet.has(a.id)) return a;
      const next: Attendance = {
        ...a,
        ...data,
        id: a.id,
        date: a.date,
        employeeId: a.employeeId,
        manualOverride: true,
        updatedAt: new Date().toISOString(),
      };
      touched.push(next);
      return next;
    });
    // Dedupe per employee+date keeping the updated rows
    const keepIds = new Set(touched.map((t) => t.id));
    const blocked = new Set(touched.map((t) => `${t.employeeId}|${t.date}`));
    attendanceStore = attendanceStore.filter((a) => {
      if (keepIds.has(a.id)) return true;
      return !blocked.has(`${a.employeeId}|${a.date}`);
    });
    persistAttendanceStore();
    // Sync all touched rows to cloud
    touched.forEach(syncRecordToCloud);
    return Promise.resolve(touched);
  },

  /** Snapshot of manually edited rows (used so Refresh cannot wipe them). */
  getManualOverrides: () =>
    Promise.resolve(attendanceStore.filter((a) => a.manualOverride)),

  /** Re-apply manual edits after a device import / Refresh. */
  restoreManualOverrides: (rows: Attendance[]) => {
    if (!rows.length) return Promise.resolve(0);
    let restored = 0;
    for (const row of rows) {
      if (!row.manualOverride) continue;
      const aliases = employeeIdAliases(row.employeeId);
      attendanceStore = [
        { ...row, manualOverride: true },
        ...attendanceStore.filter(
          (a) =>
            !(aliases.some((id) => sameEmployeeRef(a.employeeId, id)) && a.date === row.date),
        ),
      ];
      restored += 1;
    }
    persistAttendanceStore();
    // Re-push manual rows to cloud so they win over device imports
    rows.filter(r => r.manualOverride).forEach(syncRecordToCloud);
    return Promise.resolve(restored);
  },

  delete: (id: string) => {
    attendanceStore = attendanceStore.filter(a => a.id !== id);
    persistAttendanceStore();
    deleteRecordFromCloud(id);
    return Promise.resolve();
  },

  bulkCreate: (records: Omit<Attendance, 'id' | 'createdAt' | 'updatedAt'>[]) => {
    const created = records.map(r => ({
      ...r,
      id: generateId('att'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    attendanceStore = [...created, ...attendanceStore];
    persistAttendanceStore();
    // Sync all new records to cloud
    created.forEach(syncRecordToCloud);
    return Promise.resolve(created);
  },

  /**
   * Remove non-manual device-sourced rows for an employee in a date range
   * so a rebuild from punch logs cannot leave punches on the wrong day.
   */
  clearDeviceRowsInRange: (employeeIds: string[], from: string, to: string) => {
    const idSet = new Set(employeeIds.map(String));
    const aliases = new Set<string>();
    for (const id of idSet) {
      for (const a of employeeIdAliases(id)) aliases.add(a);
    }
    const before = attendanceStore.length;
    const aliasList = [...aliases];
    attendanceStore = attendanceStore.filter((a) => {
      if (a.date < from || a.date > to) return true;
      if (!aliasList.some((id) => sameEmployeeRef(a.employeeId, id))) return true;
      if (a.manualOverride) return true;
      // Keep human-created rows that were never from the device
      if (a.location && a.location !== 'Device Sync' && a.createdBy !== 'device-sync') {
        return true;
      }
      if (a.location === 'Device Sync' || a.createdBy === 'device-sync' || String(a.id).startsWith('att-dev-')) {
        deleteRecordFromCloud(a.id);
        return false;
      }
      // Legacy imported rows without clear markers — still replace on rebuild
      if (!a.manualCheckIn && !a.manualCheckOut) {
        deleteRecordFromCloud(a.id);
        return false;
      }
      return true;
    });
    if (attendanceStore.length !== before) persistAttendanceStore();
    return Promise.resolve(before - attendanceStore.length);
  },

  /**
   * Permanently collapse duplicate employee+date rows in the local store
   * (keeps the best row). Used by the daily report to stop mismatch rows.
   */
  purgeDuplicateDays: () => {
    const kept = dedupeAttendanceRows([...attendanceStore]);
    const keepIds = new Set(kept.map((r) => r.id));
    const removed = attendanceStore.filter((a) => !keepIds.has(a.id));
    if (!removed.length) return Promise.resolve(0);
    attendanceStore = kept;
    persistAttendanceStore();
    removed.forEach((r) => deleteRecordFromCloud(r.id));
    return Promise.resolve(removed.length);
  },

  /**
   * Upsert a daily attendance row from device punches (keyed by employeeId + date).
   * Skips rows that were manually edited in the app.
   */
  upsertFromDevice: (data: {
    employeeId: string;
    departmentId: string;
    shiftId: string;
    date: string;
    checkIn?: string;
    checkOut?: string;
    status?: AttendanceStatus;
    workingHours?: number;
  }) => {
    const now = new Date().toISOString();
    const existing = findAttendanceForDeviceDay(data.employeeId, data.date);

    // Keep human edits — device re-import must not wipe Edit Attendance changes
    if (existing?.manualOverride) {
      return Promise.resolve(existing);
    }

    const checkIn = data.checkIn?.slice(0, 5);
    const checkOut = data.checkOut?.slice(0, 5);
    let workingHours = 0;
    if (typeof data.workingHours === 'number' && data.workingHours >= 0) {
      workingHours = data.workingHours;
    } else if (checkIn && checkOut) {
      const [ih, im] = checkIn.split(':').map(Number);
      const [oh, om] = checkOut.split(':').map(Number);
      workingHours = Math.max(0, (oh * 60 + om - (ih * 60 + im)) / 60);
    }

    if (existing) {
      const updated: Attendance = {
        ...existing,
        // Always replace times from this day's punch rebuild (do not keep a stale
        // check-out via ?? — that produced 17:20/17:20 when morning was dropped).
        checkIn,
        checkOut,
        workingHours:
          typeof data.workingHours === 'number'
            ? data.workingHours
            : checkIn && checkOut
              ? workingHours
              : checkIn
                ? 0
                : existing.workingHours,
        status: data.status ?? existing.status,
        location: existing.location === 'Device Sync' || !existing.location
          ? 'Device Sync'
          : existing.location,
        remarks:
          existing.manualOverride && existing.remarks && !existing.remarks.startsWith('source=') && !existing.remarks.startsWith('rule=')
            ? existing.remarks
            : undefined,
        updatedAt: now,
      };
      attendanceStore = attendanceStore.map((a) => (a.id === existing.id ? updated : a));
      persistAttendanceStore();
      syncRecordToCloud(updated);
      return Promise.resolve(updated);
    }

    const created: Attendance = {
      id: `att-dev-${data.employeeId}-${data.date}`,
      employeeId: data.employeeId,
      departmentId: data.departmentId,
      date: data.date,
      shiftId: data.shiftId,
      checkIn,
      checkOut,
      breakMinutes: 0,
      workingHours,
      overtime: 0,
      lateMinutes: 0,
      status: data.status ?? 'present',
      location: 'Device Sync',
      remarks: undefined,
      createdBy: 'device-sync',
      createdAt: now,
      updatedAt: now,
    };
    attendanceStore = [
      created,
      ...attendanceStore.filter(
        (a) => !(sameEmployeeRef(a.employeeId, data.employeeId) && a.date === data.date),
      ),
    ];
    persistAttendanceStore();
    syncRecordToCloud(created);
    return Promise.resolve(created);
  },
};

// ─── Employee API ──────────────────────────────────────────────────────────────
export const EmployeeAPI = {
  getAll: () => Promise.resolve([...employeeStore]),

  getById: (id: string) =>
    Promise.resolve(
      employeeStore.find((e) => e.id === id || e.employeeId === id) ?? null,
    ),

  getByDepartment: (deptId: string) =>
    Promise.resolve(employeeStore.filter(e => e.departmentId === deptId)),

  create: (data: Omit<Employee, 'id' | 'createdAt' | 'updatedAt'>) => {
    const emp: Employee = {
      ...data,
      id: generateId('e'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    employeeStore = [...employeeStore, emp];
    persistEmployeeStore();
    pushToCloud(cloudEmployeeApi, emp);
    return Promise.resolve(emp);
  },

  update: (id: string, data: Partial<Employee>) => {
    employeeStore = employeeStore.map(e =>
      e.id === id ? { ...e, ...data, updatedAt: new Date().toISOString() } : e
    );
    persistEmployeeStore();
    const updated = employeeStore.find(e => e.id === id)!;
    pushToCloud(cloudEmployeeApi, updated);
    return Promise.resolve(updated);
  },

  delete: (id: string) => {
    employeeStore = employeeStore.filter(e => e.id !== id);
    persistEmployeeStore();
    removeFromCloud(cloudEmployeeApi, id);
    return Promise.resolve();
  },

  /**
   * Create or update an employee from a Hikvision sync event.
   * Uses the machine employee number as the stable id; name comes from the device.
   */
  upsertFromDevice: (payload: { employeeId: string; name: string }) => {
    const machineId = String(payload.employeeId).trim();
    if (!machineId || machineId === '—' || machineId.toLowerCase() === 'unknown') {
      return Promise.resolve(null);
    }

    const rawName = (payload.name || '').trim();
    const displayName = rawName && rawName.toLowerCase() !== 'unknown' ? rawName : machineId;
    const parts = displayName.split(/\s+/).filter(Boolean);
    const firstName = parts[0] ?? machineId;
    const lastName = parts.slice(1).join(' ');
    const now = new Date().toISOString();
    const existing = employeeStore.find(
      (e) => e.id === machineId || e.employeeId === machineId,
    );

    if (existing) {
      const updated: Employee = {
        ...existing,
        employeeId: machineId,
        firstName,
        lastName,
        // Keep a stable avatar seed from the machine name
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(displayName)}`,
        updatedAt: now,
      };
      employeeStore = employeeStore.map((e) => (e.id === existing.id ? updated : e));
      persistEmployeeStore();
      pushToCloud(cloudEmployeeApi, updated);
      return Promise.resolve(updated);
    }

    const created: Employee = {
      id: machineId,
      employeeId: machineId,
      firstName,
      lastName,
      email: `${machineId}@device.local`,
      phone: '',
      departmentId: 'd0',
      designation: 'Synced from device',
      joiningDate: now.slice(0, 10),
      employmentType: 'full_time',
      status: 'active',
      shiftId: 's1',
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(displayName)}`,
      createdAt: now,
      updatedAt: now,
    };
    employeeStore = [...employeeStore, created];
    persistEmployeeStore();
    pushToCloud(cloudEmployeeApi, created);
    return Promise.resolve(created);
  },
};

// ─── Department API ───────────────────────────────────────────────────────────
export const DepartmentAPI = {
  getAll: () => Promise.resolve([...departmentStore]),

  getById: (id: string) =>
    Promise.resolve(departmentStore.find(d => d.id === id) ?? null),

  create: (data: Omit<Department, 'id' | 'createdAt' | 'updatedAt'>) => {
    const dept: Department = {
      ...data,
      id: generateId('d'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    departmentStore = [...departmentStore, dept];
    persistDepartmentStore();
    pushToCloud(cloudDepartmentApi, dept);
    return Promise.resolve(dept);
  },

  update: (id: string, data: Partial<Department>) => {
    departmentStore = departmentStore.map(d =>
      d.id === id ? { ...d, ...data, updatedAt: new Date().toISOString() } : d
    );
    persistDepartmentStore();
    const updated = departmentStore.find(d => d.id === id)!;
    pushToCloud(cloudDepartmentApi, updated);
    return Promise.resolve(updated);
  },

  delete: (id: string) => {
    departmentStore = departmentStore.filter(d => d.id !== id);
    persistDepartmentStore();
    removeFromCloud(cloudDepartmentApi, id);
    return Promise.resolve();
  },
};

// ─── Leave API ────────────────────────────────────────────────────────────────
export const LeaveAPI = {
  getAll: () => Promise.resolve([...leaveStore]),

  getByEmployee: (employeeId: string) =>
    Promise.resolve(leaveStore.filter(l => l.employeeId === employeeId)),

  create: (data: Omit<LeaveRequest, 'id' | 'createdAt' | 'updatedAt'>) => {
    const req: LeaveRequest = {
      ...data,
      id: generateId('lr'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    leaveStore = [req, ...leaveStore];
    persistLeaveStore();
    pushToCloud(cloudLeaveApi, req);
    return Promise.resolve(req);
  },

  updateStatus: (id: string, status: LeaveStatus, approvedBy?: string, comments?: string) => {
    const existing = leaveStore.find(l => l.id === id);
    if (!existing) {
      return Promise.reject(new Error('Leave request not found'));
    }
    const next = {
      ...existing,
      status,
      approvedBy,
      comments,
      updatedAt: new Date().toISOString(),
    };
    leaveStore = leaveStore.map(l => (l.id === id ? next : l));
    persistLeaveStore();
    pushToCloud(cloudLeaveApi, next);
    return Promise.resolve({ ...next });
  },

  delete: (id: string) => {
    leaveStore = leaveStore.filter(l => l.id !== id);
    persistLeaveStore();
    removeFromCloud(cloudLeaveApi, id);
    return Promise.resolve();
  },
};

// ─── Punch Time Request API ───────────────────────────────────────────────────
export const PunchTimeRequestAPI = {
  getAll: () => Promise.resolve([...punchRequestStore]),

  getByEmployee: (employeeId: string) =>
    Promise.resolve(punchRequestStore.filter(r => r.employeeId === employeeId)),

  create: (data: Omit<PunchTimeRequest, 'id' | 'createdAt' | 'updatedAt'>) => {
    const req: PunchTimeRequest = {
      ...data,
      id: generateId('pr'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    punchRequestStore = [req, ...punchRequestStore];
    persistPunchRequestStore();
    pushToCloud(cloudPunchRequestApi, req);
    return Promise.resolve(req);
  },

  updateStatus: (id: string, status: PunchRequestStatus, approvedBy?: string, comments?: string) => {
    const existing = punchRequestStore.find(r => r.id === id);
    if (!existing) {
      return Promise.reject(new Error('Punch request not found'));
    }
    const next = {
      ...existing,
      status,
      approvedBy,
      comments,
      updatedAt: new Date().toISOString(),
    };
    punchRequestStore = punchRequestStore.map(r => (r.id === id ? next : r));
    persistPunchRequestStore();
    pushToCloud(cloudPunchRequestApi, next);
    return Promise.resolve({ ...next });
  },

  delete: (id: string) => {
    punchRequestStore = punchRequestStore.filter(r => r.id !== id);
    persistPunchRequestStore();
    removeFromCloud(cloudPunchRequestApi, id);
    return Promise.resolve();
  },
};

// ─── Shift API ────────────────────────────────────────────────────────────────
export const ShiftAPI = {
  getAll: () => Promise.resolve([...shiftStore]),

  getById: (id: string) =>
    Promise.resolve(shiftStore.find(s => s.id === id) ?? null),

  create: (data: Omit<Shift, 'id' | 'createdAt'>) => {
    const shift: Shift = {
      ...data,
      id: generateId('s'),
      createdAt: new Date().toISOString(),
    };
    shiftStore = [...shiftStore, shift];
    persistShiftStore();
    pushToCloud(cloudShiftApi, shift);
    return Promise.resolve(shift);
  },

  update: (id: string, data: Partial<Shift>) => {
    shiftStore = shiftStore.map(s => s.id === id ? { ...s, ...data } : s);
    persistShiftStore();
    const updated = shiftStore.find(s => s.id === id)!;
    pushToCloud(cloudShiftApi, updated);
    return Promise.resolve(updated);
  },

  delete: (id: string) => {
    shiftStore = shiftStore.filter(s => s.id !== id);
    persistShiftStore();
    removeFromCloud(cloudShiftApi, id);
    return Promise.resolve();
  },
};

// ─── Holiday API ──────────────────────────────────────────────────────────────
export const HolidayAPI = {
  getAll: () => Promise.resolve([...holidayStore]),

  getUpcoming: (limit = 5) => {
    const today = new Date().toISOString().split('T')[0];
    return Promise.resolve(
      holidayStore
        .filter(h => h.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, limit)
    );
  },

  create: (data: Omit<Holiday, 'id'>) => {
    const holiday: Holiday = { ...data, id: generateId('h') };
    holidayStore = [...holidayStore, holiday];
    persistHolidayStore();
    pushToCloud(cloudHolidayApi, holiday);
    return Promise.resolve(holiday);
  },

  createMany: (items: Omit<Holiday, 'id'>[]) => {
    const created = items.map(data => ({ ...data, id: generateId('h') }) as Holiday);
    holidayStore = [...holidayStore, ...created];
    persistHolidayStore();
    cloudHolidayApi.bulkUpsert(created).catch(() => { /* offline */ });
    return Promise.resolve(created);
  },

  delete: (id: string) => {
    holidayStore = holidayStore.filter(h => h.id !== id);
    persistHolidayStore();
    removeFromCloud(cloudHolidayApi, id);
    return Promise.resolve();
  },
};

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
export const DashboardAPI = {
  getStats: async (date?: string) => {
    const d = date ?? new Date().toISOString().split('T')[0];
    const allEmp = await EmployeeAPI.getAll();
    const active = allEmp.filter(e => e.status === 'active');
    const todayAtt = attendanceStore.filter(a => a.date === d);

    const present = todayAtt.filter(a => a.status === 'present').length;
    const late = todayAtt.filter(a => a.status === 'late').length;
    const onLeave = todayAtt.filter(a => a.status === 'on_leave').length;
    const absent = active.length - todayAtt.filter(a => a.status !== 'absent').length;

    return {
      totalEmployees: active.length,
      presentToday: present + late,
      absentToday: Math.max(0, absent),
      lateToday: late,
      onLeaveToday: onLeave,
      attendancePercentage: active.length
        ? Math.round(((present + late + onLeave) / active.length) * 100)
        : 0,
    };
  },

  getTrend: async (days = 7) => {
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const dayAtt = attendanceStore.filter(a => a.date === ds);
      result.push({
        date: ds,
        present: dayAtt.filter(a => a.status === 'present').length,
        late: dayAtt.filter(a => a.status === 'late').length,
        absent: dayAtt.filter(a => a.status === 'absent').length,
        wfh: dayAtt.filter(a => a.status === 'work_from_home').length,
      });
    }
    return result;
  },

  getDeptStats: async () => {
    const depts = await DepartmentAPI.getAll();
    const emps = await EmployeeAPI.getAll();
    const today = new Date().toISOString().split('T')[0];
    return depts.map(dept => {
      const deptEmps = emps.filter(e => e.departmentId === dept.id && e.status === 'active');
      const deptAtt = attendanceStore.filter(
        a => a.departmentId === dept.id && a.date === today && a.status !== 'absent'
      );
      return {
        name: dept.name,
        total: deptEmps.length,
        present: deptAtt.length,
        percentage: deptEmps.length ? Math.round((deptAtt.length / deptEmps.length) * 100) : 0,
      };
    });
  },
};

// ─── Attendance status filter ─────────────────────────────────────────────────
export function filterAttendance(
  records: Attendance[],
  filters: {
    search?: string;
    departmentId?: string;
    employeeId?: string;
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    status?: AttendanceStatus | '';
    employees?: Employee[];
  }
) {
  let result = [...records];

  if (filters.date) {
    result = result.filter(a => a.date === filters.date);
  } else if (filters.dateFrom || filters.dateTo) {
    if (filters.dateFrom) result = result.filter(a => a.date >= filters.dateFrom!);
    if (filters.dateTo) result = result.filter(a => a.date <= filters.dateTo!);
  }

  if (filters.departmentId) {
    result = result.filter(a => a.departmentId === filters.departmentId);
  }

  if (filters.employeeId) {
    result = result.filter(a => a.employeeId === filters.employeeId);
  }

  if (filters.status) {
    result = result.filter(a => a.status === filters.status);
  }

  if (filters.search && filters.employees) {
    const q = filters.search.toLowerCase();
    const matchingEmpIds = filters.employees
      .filter(e =>
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
        e.employeeId.toLowerCase().includes(q)
      )
      .map(e => e.id);
    result = result.filter(a => matchingEmpIds.includes(a.employeeId));
  }

  return result;
}
