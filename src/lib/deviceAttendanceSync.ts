import { AttendanceAPI, EmployeeAPI } from '../data/store';
import type { AttendanceStatus } from '../types';
import type { AttendanceLogEntry } from '../types/device';
import { getAppSettings, resolveEmployeeSchedule } from './appSettings';
import { upsertEmployeesFromDeviceLogs } from './deviceEmployeeSync';
import { saveDeviceLogsCache } from './deviceLogsCache';
import { punchCalendarDate, punchClockHm } from './punchTime';

type TimedPunch = { time: string; checkType: string };

/**
 * Pair punches into check-in / check-out.
 * - Earliest punch of the day = Check In
 * - Latest punch of the day (if >= 1 min after Check In) = Check Out
 */
function pairCheckInOut(
  sorted: TimedPunch[],
  _checkInWindowMinutes: number,
  _checkOutWindowMinutes: number,
): { checkIn?: TimedPunch; checkOut?: TimedPunch } {
  if (!sorted.length) return {};

  const validPunches = sorted
    .map((p) => ({ punch: p, ms: new Date(p.time).getTime() }))
    .filter((p) => !Number.isNaN(p.ms))
    .sort((a, b) => a.ms - b.ms);

  if (!validPunches.length) return {};

  const checkIn = validPunches[0].punch;

  let checkOut: TimedPunch | undefined;
  if (validPunches.length > 1) {
    const last = validPunches[validPunches.length - 1];
    // Check out is the last punch of the day (if at least 1 minute after check-in)
    if (last.ms - validPunches[0].ms >= 60_000) {
      checkOut = last.punch;
    }
  }

  return { checkIn, checkOut };
}

/**
 * Import device attendance logs into the Attendance page store.
 * Dates/times use Asia/Kathmandu so they match Device Settings display.
 */
export async function importAttendanceFromDeviceLogs(
  logs: AttendanceLogEntry[],
): Promise<{ employees: number; attendance: number }> {
  if (logs.length) {
    saveDeviceLogsCache(logs);
  }

  const [employeesCount, allEmps] = await Promise.all([
    upsertEmployeesFromDeviceLogs(logs),
    EmployeeAPI.getAll(),
  ]);

  const empMap = new Map<string, (typeof allEmps)[0]>();
  for (const e of allEmps) {
    empMap.set(e.id, e);
    empMap.set(e.employeeId, e);
  }

  const rules = getAppSettings().attendanceRules;
  const checkInWindowMins = rules.duplicatePunchWindowMinutes ?? 10;
  const checkOutWindowMins = rules.duplicateCheckOutWindowMinutes ?? checkInWindowMins;
  const halfDayEnabled = rules.singlePunchHalfDayEnabled !== false;

  const groups = new Map<string, { employeeId: string; date: string; punches: TimedPunch[] }>();

  for (const log of logs) {
    const employeeId = String(log.employeeId ?? '').trim();
    if (!employeeId || employeeId === '—' || employeeId.toLowerCase() === 'unknown') continue;
    const date = punchCalendarDate(log.time);
    if (!date) continue;
    const key = `${employeeId}|${date}`;
    const existing = groups.get(key) ?? { employeeId, date, punches: [] };
    existing.punches.push({ time: log.time, checkType: String(log.checkType ?? 'punch') });
    groups.set(key, existing);
  }

  const upsertTasks: Array<Promise<unknown>> = [];

  for (const group of groups.values()) {
    const sorted = [...group.punches].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
    );
    if (!sorted.length) continue;

    const paired = pairCheckInOut(sorted, checkInWindowMins, checkOutWindowMins);
    let checkIn = paired.checkIn ? punchClockHm(paired.checkIn.time) : undefined;
    let checkOut = paired.checkOut ? punchClockHm(paired.checkOut.time) : undefined;

    if (checkIn && checkOut && checkIn === checkOut) {
      checkOut = undefined;
    }

    let status: AttendanceStatus = 'present';
    let workingHours: number | undefined;

    if (checkIn && checkOut) {
      const [hi, mi] = checkIn.split(':').map(Number);
      const [ho, mo] = checkOut.split(':').map(Number);
      if (!Number.isNaN(hi) && !Number.isNaN(ho)) {
        workingHours = Math.max(0, Math.round(((ho * 60 + mo - (hi * 60 + mi)) / 60) * 100) / 100);
      }
    } else if (!checkOut && checkIn && halfDayEnabled) {
      status = 'half_day';
      const schedule = resolveEmployeeSchedule(group.employeeId, undefined, [], group.date);
      workingHours = Math.round((schedule.dayHours / 2) * 100) / 100;
    }

    const emp = empMap.get(group.employeeId);
    upsertTasks.push(
      AttendanceAPI.upsertFromDevice({
        employeeId: group.employeeId,
        departmentId: emp?.departmentId ?? 'd0',
        shiftId: emp?.shiftId ?? 's1',
        date: group.date,
        checkIn,
        checkOut,
        status,
        workingHours,
      }),
    );
  }

  await Promise.all(upsertTasks);

  return { employees: employeesCount, attendance: upsertTasks.length };
}
