/**
 * Nepal attendance punches must use one civil calendar everywhere
 * (device log table + daily report). Browser/server local TZ must not
 * shift a 14:02 punch onto the previous BS date.
 */
export const ATTENDANCE_TIME_ZONE = 'Asia/Kathmandu';

function asDate(value: string | Date): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Calendar day `yyyy-MM-dd` in Asia/Kathmandu for a punch timestamp. */
export function punchCalendarDate(value: string | Date): string {
  const d = asDate(value);
  if (!d) {
    const raw = typeof value === 'string' ? value.slice(0, 10) : '';
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
  }
  return d.toLocaleDateString('en-CA', { timeZone: ATTENDANCE_TIME_ZONE });
}

/** Clock `HH:mm:ss` in Asia/Kathmandu. */
export function punchClockHms(value: string | Date): string {
  const d = asDate(value);
  if (!d) return '00:00:00';
  return d.toLocaleTimeString('en-GB', {
    timeZone: ATTENDANCE_TIME_ZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Clock `HH:mm` in Asia/Kathmandu (attendance check-in/out fields). */
export function punchClockHm(value: string | Date): string {
  return punchClockHms(value).slice(0, 5);
}
