/**
 * Mock data store — simulates a real API with in-memory state.
 * All operations are synchronous and return a Promise for easy future swap to fetch().
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
  Attendance, Department, Employee, LeaveRequest, Shift, Holiday,
  AttendanceStatus, LeaveStatus,
} from '../types';
import { generateId } from '../lib/utils';

const ATTENDANCE_STORAGE_KEY = 'attendance-store-v1';
const EMPLOYEE_STORAGE_KEY = 'employee-store-v1';
const LEAVE_STORAGE_KEY = 'leave-store-v1';

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
    console.warn('[Store] Failed to save attendance:', err);
  }
  notifyAttendanceListeners();
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

// ─── Mutable stores ───────────────────────────────────────────────────────────
let attendanceStore: Attendance[] = loadAttendanceStore();
let employeeStore: Employee[] = loadEmployeeStore();
let departmentStore: Department[] = [...mockDepartments];
let leaveStore: LeaveRequest[] = loadLeaveStore();
let shiftStore: Shift[] = [...mockShifts];
let holidayStore: Holiday[] = [...mockHolidays];

/**
 * Reload employees / attendance / leave from localStorage.
 * Call after login so previous machine records appear again.
 */
export function hydratePersistedStores() {
  attendanceStore = loadAttendanceStore();
  employeeStore = loadEmployeeStore();
  leaveStore = loadLeaveStore();
  notifyAttendanceListeners();
}

/** Subscribe to attendance changes (Edit Attendance → Report live update). */
export function subscribeAttendance(listener: StoreListener): () => void {
  attendanceListeners.add(listener);
  return () => {
    attendanceListeners.delete(listener);
  };
}

function sameEmployeeRef(a: string, b: string) {
  return String(a) === String(b);
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

/** One row per employee+date — prefer manual edits, then newest update. */
function dedupeAttendanceRows(rows: Attendance[]): Attendance[] {
  const best = new Map<string, Attendance>();
  for (const row of rows) {
    const key = `${String(row.employeeId)}|${row.date}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, row);
      continue;
    }
    if (row.manualOverride && !prev.manualOverride) {
      best.set(key, row);
      continue;
    }
    if (prev.manualOverride && !row.manualOverride) continue;
    if ((row.updatedAt || '') > (prev.updatedAt || '')) {
      best.set(key, row);
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
    return Promise.resolve(restored);
  },

  delete: (id: string) => {
    attendanceStore = attendanceStore.filter(a => a.id !== id);
    persistAttendanceStore();
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
    return Promise.resolve(created);
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

    const checkIn = data.checkIn;
    const checkOut = data.checkOut;
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
        checkIn: checkIn ?? existing.checkIn,
        checkOut: checkOut ?? existing.checkOut,
        workingHours:
          typeof data.workingHours === 'number'
            ? data.workingHours
            : checkIn && checkOut
              ? workingHours
              : existing.workingHours,
        status: data.status ?? existing.status,
        location: existing.location === 'Device Sync' || !existing.location
          ? 'Device Sync'
          : existing.location,
        remarks:
          existing.manualOverride && existing.remarks && !existing.remarks.startsWith('source=')
            ? existing.remarks
            : undefined,
        updatedAt: now,
      };
      attendanceStore = attendanceStore.map((a) => (a.id === existing.id ? updated : a));
      persistAttendanceStore();
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
    return Promise.resolve(emp);
  },

  update: (id: string, data: Partial<Employee>) => {
    employeeStore = employeeStore.map(e =>
      e.id === id ? { ...e, ...data, updatedAt: new Date().toISOString() } : e
    );
    persistEmployeeStore();
    return Promise.resolve(employeeStore.find(e => e.id === id)!);
  },

  delete: (id: string) => {
    employeeStore = employeeStore.filter(e => e.id !== id);
    persistEmployeeStore();
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
    return Promise.resolve(dept);
  },

  update: (id: string, data: Partial<Department>) => {
    departmentStore = departmentStore.map(d =>
      d.id === id ? { ...d, ...data, updatedAt: new Date().toISOString() } : d
    );
    return Promise.resolve(departmentStore.find(d => d.id === id)!);
  },

  delete: (id: string) => {
    departmentStore = departmentStore.filter(d => d.id !== id);
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
    return Promise.resolve({ ...next });
  },

  delete: (id: string) => {
    leaveStore = leaveStore.filter(l => l.id !== id);
    persistLeaveStore();
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
    return Promise.resolve(shift);
  },

  update: (id: string, data: Partial<Shift>) => {
    shiftStore = shiftStore.map(s => s.id === id ? { ...s, ...data } : s);
    return Promise.resolve(shiftStore.find(s => s.id === id)!);
  },

  delete: (id: string) => {
    shiftStore = shiftStore.filter(s => s.id !== id);
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
    return Promise.resolve(holiday);
  },

  createMany: (items: Omit<Holiday, 'id'>[]) => {
    const created = items.map(data => ({ ...data, id: generateId('h') }) as Holiday);
    holidayStore = [...holidayStore, ...created];
    return Promise.resolve(created);
  },

  delete: (id: string) => {
    holidayStore = holidayStore.filter(h => h.id !== id);
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
