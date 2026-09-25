import type { Holiday } from '../types';
import { getAppSettings } from './appSettings';

/**
 * Holiday calendar rules shared by the attendance report, the PDF export and
 * the dashboard so that whatever Admin saves under Settings → Holidays is
 * reflected in every employee's attendance.
 */

/** Company-wide days off. Optional/restricted days stay working days. */
export function isDayOffHoliday(holiday: Holiday): boolean {
  return holiday.type === 'public';
}

export function holidayDateKey(date: string): string {
  return String(date || '').slice(0, 10);
}

/** Index holidays by AD date; a public holiday wins over an optional one. */
export function buildHolidayMap(holidays: Holiday[]): Map<string, Holiday> {
  const map = new Map<string, Holiday>();
  for (const h of holidays) {
    const key = holidayDateKey(h.date);
    if (!key) continue;
    const prev = map.get(key);
    if (!prev || (isDayOffHoliday(h) && !isDayOffHoliday(prev))) {
      map.set(key, h);
    }
  }
  return map;
}

export function getHolidayOn(
  map: Map<string, Holiday>,
  date: string,
): Holiday | undefined {
  return map.get(holidayDateKey(date));
}

/** Remark text shown in the attendance table / PDF. */
export function holidayRemark(holiday: Holiday): string {
  return isDayOffHoliday(holiday) ? holiday.name : `${holiday.name} (${holiday.type})`;
}

export interface DayOffInfo {
  /** No work expected — no Dayhour, no late deduction, status "Holiday". */
  isDayOff: boolean;
  /** Remark for the row: holiday name, "Weekly off", or an optional note. */
  remark: string;
  holiday?: Holiday;
}

/**
 * Resolve a calendar day against the company week and the holiday calendar.
 * `workingDays` defaults to Settings → Office Hours.
 */
export function resolveDayOff(
  date: string,
  map: Map<string, Holiday>,
  workingDays?: number[],
): DayOffInfo {
  const days = workingDays ?? getAppSettings().officeHours.workingDays;
  const parsed = new Date(`${holidayDateKey(date)}T12:00:00`);
  const isOfficeDay = Number.isNaN(parsed.getTime())
    ? true
    : days.includes(parsed.getDay());
  const holiday = getHolidayOn(map, date);

  if (holiday && isDayOffHoliday(holiday)) {
    return { isDayOff: true, remark: holiday.name, holiday };
  }
  if (!isOfficeDay) {
    return { isDayOff: true, remark: holiday ? holidayRemark(holiday) : 'Weekly off', holiday };
  }
  return { isDayOff: false, remark: holiday ? holidayRemark(holiday) : '', holiday };
}
