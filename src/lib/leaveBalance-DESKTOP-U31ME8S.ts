import { getAppSettings } from './appSettings';
import type { LeaveRequest, LeaveStatus } from '../types';

/** Leave types that consume the Admin "House leave per month" allowance. */
export const HOUSE_LEAVE_TYPES = new Set(['casual', 'unpaid']);

const COUNTED_STATUS = new Set<LeaveStatus>(['approved', 'conditional_approved', 'pending']);

export interface HouseLeaveBalance {
  /** Days allowed this calendar month including carry from unused prior months. */
  availableThisMonth: number;
  /** Days already used/requested this month (house leave). */
  usedThisMonth: number;
  /** Remaining days the employee may still take now. */
  remaining: number;
  /** Monthly allotment from Admin settings. */
  perMonth: number;
  /** Unused balance carried into this month from prior months. */
  carriedIn: number;
}

function ymKey(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, '0')}`;
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(ymd || '').trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function sameEmployee(a: string, b: string, aliases: string[] = []): boolean {
  const ids = new Set([b, ...aliases].map(String).filter(Boolean));
  if (ids.has(String(a))) return true;
  const na = String(a).replace(/\D/g, '').replace(/^0+/, '');
  if (!na) return false;
  for (const id of ids) {
    const nb = String(id).replace(/\D/g, '').replace(/^0+/, '');
    if (nb && na === nb) return true;
  }
  return false;
}

function monthStart(y: number, m0: number): Date {
  return new Date(y, m0, 1, 12, 0, 0, 0);
}

function daysOverlapInMonth(
  fromYmd: string,
  toYmd: string,
  year: number,
  month0: number,
): number {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  if (!from || !to) return 0;
  const rangeStart = new Date(from.y, from.m - 1, from.d, 12, 0, 0, 0);
  const rangeEnd = new Date(to.y, to.m - 1, to.d, 12, 0, 0, 0);
  const mStart = monthStart(year, month0);
  const mEnd = new Date(year, month0 + 1, 0, 12, 0, 0, 0);
  const start = rangeStart > mStart ? rangeStart : mStart;
  const end = rangeEnd < mEnd ? rangeEnd : mEnd;
  if (end < start) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/**
 * House leave: Admin sets N days/month (default 1).
 * Unused days from a month carry into the next month
 * (e.g. take 0 in Asar → 2 available in Shrawan when N=1).
 */
export function calcHouseLeaveBalance(
  employeeId: string,
  leaves: LeaveRequest[],
  opts?: {
    asOf?: Date;
    joiningDate?: string;
    aliases?: string[];
    perMonth?: number;
  },
): HouseLeaveBalance {
  const settings = getAppSettings();
  const perMonth = Math.max(
    0,
    opts?.perMonth ?? settings.attendanceRules.houseLeavePerMonth ?? 1,
  );
  const asOf = opts?.asOf ?? new Date();
  const aliases = opts?.aliases ?? [];

  const join = parseYmd(opts?.joiningDate || '');
  let startY = asOf.getFullYear();
  let startM = 0; // Jan of current year by default
  if (join) {
    startY = join.y;
    startM = join.m - 1;
  }
  // Do not accrue before joining, and start from current calendar year if joined earlier
  const yearStartY = asOf.getFullYear();
  if (startY < yearStartY) {
    startY = yearStartY;
    startM = 0;
  }
  if (startY > asOf.getFullYear() || (startY === asOf.getFullYear() && startM > asOf.getMonth())) {
    return {
      availableThisMonth: perMonth,
      usedThisMonth: 0,
      remaining: perMonth,
      perMonth,
      carriedIn: 0,
    };
  }

  const relevant = leaves.filter(
    (l) =>
      sameEmployee(l.employeeId, employeeId, aliases) &&
      HOUSE_LEAVE_TYPES.has(l.leaveType) &&
      COUNTED_STATUS.has(l.status),
  );

  let carry = 0;
  let usedThisMonth = 0;
  let availableThisMonth = perMonth;

  const endY = asOf.getFullYear();
  const endM = asOf.getMonth();

  for (let y = startY; y <= endY; y += 1) {
    const mFrom = y === startY ? startM : 0;
    const mTo = y === endY ? endM : 11;
    for (let m = mFrom; m <= mTo; m += 1) {
      const allotment = perMonth + carry;
      let used = 0;
      for (const l of relevant) {
        used += daysOverlapInMonth(l.fromDate, l.toDate, y, m);
      }
      if (y === endY && m === endM) {
        usedThisMonth = used;
        availableThisMonth = allotment;
        carry = Math.max(0, allotment - used);
      } else {
        // Unused portion carries to next month
        carry = Math.max(0, allotment - used);
      }
    }
  }

  return {
    availableThisMonth,
    usedThisMonth,
    remaining: Math.max(0, availableThisMonth - usedThisMonth),
    perMonth,
    carriedIn: Math.max(0, availableThisMonth - perMonth),
  };
}

/** Map of employeeId → remaining house leave days (also keyed by aliases when provided). */
export function calcHouseLeaveRemainingMap(
  employees: Array<{ id: string; employeeId: string; joiningDate?: string }>,
  leaves: LeaveRequest[],
  asOf?: Date,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const emp of employees) {
    const bal = calcHouseLeaveBalance(emp.id, leaves, {
      asOf,
      joiningDate: emp.joiningDate,
      aliases: [emp.employeeId],
    });
    out[emp.id] = bal.remaining;
    if (emp.employeeId) out[emp.employeeId] = bal.remaining;
  }
  return out;
}
