import { AttendanceAPI, EmployeeAPI } from '../data/store';
import type { AttendanceStatus } from '../types';
import type { AttendanceLogEntry } from '../types/device';
import { getAppSettings, resolveEmployeeSchedule } from './appSettings';
import { upsertEmployeesFromDeviceLogs } from './deviceEmployeeSync';
import { saveDeviceLogsCache } from './deviceLogsCache';

function toLocalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toLocalHm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '00:00';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type TimedPunch = { time: string; checkType: string };

/**
 * Pair punches into check-in / check-out using separate duplicate windows.
 * - First punch = check-in; punches within check-in window are ignored.
 * - First punch after check-in window = check-out.
 * - Later punches within check-out window keep the first check-out;
 *   a punch after the check-out window updates check-out (last session).
 */
function pairCheckInOut(
  sorted: TimedPunch[],
  checkInWindowMinutes: number,
  checkOutWindowMinutes: number,
): { checkIn?: TimedPunch; checkOut?: TimedPunch } {
  if (!sorted.length) return {};

  const inWindowMs = Math.max(0, checkInWindowMinutes) * 60_000;
  const outWindowMs = Math.max(0, checkOutWindowMinutes) * 60_000;

  const labeledIn = sorted.find((p) => p.checkType === 'check_in');
  const labeledOut = [...sorted].reverse().find((p) => p.checkType === 'check_out');
  if (labeledIn || labeledOut) {
    return {
      checkIn: labeledIn ?? sorted[0],
      checkOut: labeledOut,
    };
  }

  const checkIn = sorted[0];
  const checkInAt = new Date(checkIn.time).getTime();
  let checkOut: TimedPunch | undefined;

  for (let i = 1; i < sorted.length; i++) {
    const punch = sorted[i];
    const at = new Date(punch.time).getTime();
    if (Number.isNaN(at) || Number.isNaN(checkInAt)) continue;

    if (!checkOut) {
      if (at - checkInAt >= inWindowMs) checkOut = punch;
      continue;
    }

    const outAt = new Date(checkOut.time).getTime();
    if (Number.isNaN(outAt)) {
      checkOut = punch;
      continue;
    }
    // Within check-out window → keep first check-out; after window → new check-out
    if (at - outAt >= outWindowMs) checkOut = punch;
  }

  return { checkIn, checkOut };
}

/**
 * Import device attendance logs into the Attendance page store.
 *
 * Rules (from Settings → Attendance Rules):
 * - Duplicate check-ins within the check-in window keep the first check-in.
 * - Duplicate check-outs within the check-out window keep the first check-out.
 * - A single punch (morning or afternoon) with no later check-out → half_day
 *   with half of that day’s expected office hours.
 */
export async function importAttendanceFromDeviceLogs(
  logs: AttendanceLogEntry[],
): Promise<{ employees: number; attendance: number }> {
  if (logs.length) {
    saveDeviceLogsCache(logs);
  }
  const employees = await upsertEmployeesFromDeviceLogs(logs);
  const rules = getAppSettings().attendanceRules;
  const checkInWindowMins = rules.duplicatePunchWindowMinutes ?? 10;
  const checkOutWindowMins = rules.duplicateCheckOutWindowMinutes ?? checkInWindowMins;
  const halfDayEnabled = rules.singlePunchHalfDayEnabled !== false;

  const groups = new Map<string, { employeeId: string; date: string; punches: TimedPunch[] }>();

  for (const log of logs) {
    const employeeId = String(log.employeeId ?? '').trim();
    if (!employeeId || employeeId === '—' || employeeId.toLowerCase() === 'unknown') continue;
    const date = toLocalDate(log.time);
    const key = `${employeeId}|${date}`;
    const existing = groups.get(key) ?? { employeeId, date, punches: [] };
    existing.punches.push({ time: log.time, checkType: String(log.checkType ?? 'punch') });
    groups.set(key, existing);
  }

  let attendance = 0;
  for (const group of groups.values()) {
    const sorted = [...group.punches].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
    );
    if (!sorted.length) continue;

    const paired = pairCheckInOut(sorted, checkInWindowMins, checkOutWindowMins);
    let checkIn = paired.checkIn ? toLocalHm(paired.checkIn.time) : undefined;
    let checkOut = paired.checkOut ? toLocalHm(paired.checkOut.time) : undefined;

    if (checkIn && checkOut && checkIn === checkOut) {
      checkOut = undefined;
    }

    let status: AttendanceStatus = 'present';
    let workingHours: number | undefined;

    if (!checkOut && checkIn && halfDayEnabled) {
      status = 'half_day';
      const schedule = resolveEmployeeSchedule(group.employeeId, undefined, [], group.date);
      workingHours = Math.round((schedule.dayHours / 2) * 100) / 100;
    }

    const emp = await EmployeeAPI.getById(group.employeeId);
    await AttendanceAPI.upsertFromDevice({
      employeeId: group.employeeId,
      departmentId: emp?.departmentId ?? 'd0',
      shiftId: emp?.shiftId ?? 's1',
      date: group.date,
      checkIn,
      checkOut,
      status,
      workingHours,
    });
    attendance += 1;
  }

  return { employees, attendance };
}
