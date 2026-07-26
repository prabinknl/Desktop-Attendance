import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, differenceInMinutes } from 'date-fns';
import type { Attendance, AttendanceStatus, LeaveStatus, PunchRequestKind, PunchRequestStatus } from '../types';

export { formatDate, formatDateTime } from './dateDisplay';

// ─── Class name utility ───────────────────────────────────────────────────────
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
export const formatTime = (time?: string) => {
  if (!time) return '—';
  // Normalize "14:02:00" / "14:02" → display as HH:mm
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?/.exec(String(time).trim());
  if (!m) return time;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
};

export const timeAgo = (dt: string) =>
  formatDistanceToNow(new Date(dt), { addSuffix: true });

export const todayStr = () => format(new Date(), 'yyyy-MM-dd');

// ─── Time calculations ────────────────────────────────────────────────────────
export function calcWorkingHours(checkIn?: string, checkOut?: string, breakMins = 60): number {
  if (!checkIn || !checkOut) return 0;
  const [hi, mi] = checkIn.split(':').map(Number);
  const [ho, mo] = checkOut.split(':').map(Number);
  const inMins = hi * 60 + mi;
  let outMins = ho * 60 + mo;
  if (outMins < inMins) outMins += 24 * 60; // overnight
  const diff = outMins - inMins - breakMins;
  return Math.max(0, Math.round((diff / 60) * 100) / 100);
}

export function calcLateMinutes(checkIn?: string, shiftStart = '09:00', graceMins = 15): number {
  if (!checkIn) return 0;
  const [hs, ms] = shiftStart.split(':').map(Number);
  const [hi, mi] = checkIn.split(':').map(Number);
  const shiftMins = hs * 60 + ms + graceMins;
  const inMins = hi * 60 + mi;
  return Math.max(0, inMins - shiftMins);
}

export function calcOvertime(workingHours: number, expectedHours = 8): number {
  return Math.max(0, Math.round((workingHours - expectedHours) * 100) / 100);
}

/** Expected day hours for a shift (Dayhour). */
export function calcDayHours(shiftWorkingHours?: number): number {
  return shiftWorkingHours && shiftWorkingHours > 0 ? shiftWorkingHours : 8;
}

/**
 * Resolves effective Check In / Check Out and working hours for an attendance record.
 * Manual times (manualCheckIn/manualCheckOut) override machine punch times.
 */
export function getEffectiveAttendanceTimes(record: Attendance): {
  effectiveIn?: string;
  effectiveOut?: string;
  workingHours: number;
} {
  const effectiveIn = record.manualCheckIn || record.checkIn;
  const effectiveOut = record.manualCheckOut || record.checkOut;
  let hours = record.workingHours || 0;
  if (effectiveIn && effectiveOut) {
    const [hi, mi] = effectiveIn.split(':').map(Number);
    const [ho, mo] = effectiveOut.split(':').map(Number);
    if (!Number.isNaN(hi) && !Number.isNaN(ho)) {
      hours = Math.max(0, Math.round(((ho * 60 + mo - (hi * 60 + mi)) / 60) * 100) / 100);
    }
  }
  return { effectiveIn, effectiveOut, workingHours: hours };
}

/**
 * OT/LT net hours:
 * + when worked beyond shift day hours (extra / overtime)
 * - when under Dayhour (shortfall) or late arrival on a full day
 */
export function calcOtLtHours(opts: {
  checkIn?: string;
  workingHours?: number;
  overtime?: number;
  lateMinutes?: number;
  shiftStart?: string;
  graceMinutes?: number;
  dayHours?: number;
}): number {
  const dayHours = calcDayHours(opts.dayHours);
  const worked = opts.workingHours ?? 0;
  const storedOt = opts.overtime ?? 0;

  const lateMins =
    opts.lateMinutes !== undefined && opts.lateMinutes > 0
      ? opts.lateMinutes
      : calcLateMinutes(opts.checkIn, opts.shiftStart ?? '09:00', opts.graceMinutes ?? 15);
  const lateHours = Math.round((lateMins / 60) * 100) / 100;

  const shortfall = Math.max(0, Math.round((dayHours - worked) * 100) / 100);
  const hoursExtra = Math.max(0, Math.round((worked - dayHours) * 100) / 100);
  const extraHours = Math.max(hoursExtra, storedOt);

  // Underworked hours count as late/short time (avoid stacking late + shortfall)
  if (shortfall > 0) {
    return Math.round((-shortfall) * 100) / 100;
  }

  return Math.round((extraHours - lateHours) * 100) / 100;
}

/** Format decimal hours as `1h 24m` (no sign). */
export function formatHoursMinutes(hours: number): string {
  const totalMins = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/** OT/LT label with sign, e.g. `+1h 24m` / `-1h 24m`. */
export function formatOtLt(hours: number): string {
  if (!hours) return '—';
  const label = formatHoursMinutes(hours);
  return hours > 0 ? `+${label}` : `-${label}`;
}

export function calcTotalDays(from: string, to: string): number {
  const diff = differenceInMinutes(new Date(to), new Date(from));
  return Math.max(1, Math.round(diff / (60 * 24)) + 1);
}

// ─── Status label & color ────────────────────────────────────────────────────
export const attendanceStatusLabel: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  half_day: 'Half Day',
  holiday: 'Holiday',
  work_from_home: 'WFH',
  on_leave: 'On Leave',
  field_work: 'Field Work',
  meeting: 'Meeting',
  personal_work: 'Personal Work',
};

export const leaveStatusLabel: Record<LeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  conditional_approved: 'Conditional Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const punchRequestStatusLabel: Record<PunchRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const punchRequestKindLabel: Record<PunchRequestKind, string> = {
  add: 'Add Punch',
  edit: 'Edit Punch',
};

/** True when the date falls under a fully approved leave (not conditional / rejected). */
export function isApprovedLeaveDay(
  leaves: Array<{ status: string; employeeId: string; fromDate: string; toDate: string }>,
  employeeId: string,
  date: string,
  employeeAliases: string[] = [],
): boolean {
  const ids = new Set([employeeId, ...employeeAliases].filter(Boolean));
  const day = String(date).slice(0, 10);
  return leaves.some(
    (l) =>
      l.status === 'approved' &&
      ids.has(l.employeeId) &&
      day >= String(l.fromDate).slice(0, 10) &&
      day <= String(l.toDate).slice(0, 10),
  );
}

export const leaveTypeLabel: Record<string, string> = {
  annual: 'Annual',
  sick: 'Sick',
  casual: 'House',
  maternity: 'Maternity',
  paternity: 'Paternity',
  unpaid: 'Unpaid',
  other: 'Other',
};

export const employmentTypeLabel: Record<string, string> = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  contract: 'Contract',
  intern: 'Intern',
};

export const employeeStatusLabel: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
  on_leave: 'On Leave',
  terminated: 'Terminated',
};

// ─── ID generator ─────────────────────────────────────────────────────────────
export function generateId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Percentage ───────────────────────────────────────────────────────────────
export function pct(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}

// ─── Get initials ─────────────────────────────────────────────────────────────
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ─── Debounce ─────────────────────────────────────────────────────────────────
export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms = 300) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
