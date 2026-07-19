const STORAGE_KEY = 'app-settings';

export interface DayOfficeHours {
  startTime: string;
  endTime: string;
  graceMinutes: number;
  earlyCheckoutMinutes: number;
}

export interface OfficeHoursSettings {
  /** Fallback / template times (also used when a day has no byDay entry). */
  startTime: string;
  endTime: string;
  workingDays: number[];
  graceMinutes: number;
  earlyCheckoutMinutes: number;
  /** Per weekday (0=Sun … 6=Sat) office hours. */
  byDay: Partial<Record<number, DayOfficeHours>>;
}

export interface CompanySettings {
  name: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  timezone: string;
  currency: string;
}

export interface AttendanceRulesSettings {
  latePolicy: string;
  overtimePolicy: string;
  autoMarkAbsent: boolean;
  requireCheckout: boolean;
  missingCheckoutAction: string;
  /** Duplicate punches within this window of check-in keep the first check-in. */
  duplicatePunchWindowMinutes: number;
  /** Duplicate punches within this window of check-out keep the first check-out. */
  duplicateCheckOutWindowMinutes: number;
  /** When enabled, a single punch (no check-out) counts as half-day work. */
  singlePunchHalfDayEnabled: boolean;
  /** Legacy cutoff (unused when any single punch = half day). */
  singlePunchHalfDayBefore: string;
  /** Allowed sick leave days per employee per month. */
  sickLeavePerMonth: number;
  /** Allowed house leave days per employee per month. */
  houseLeavePerMonth: number;
}

export interface NotificationSettings {
  emailOnLate: boolean;
  emailOnAbsent: boolean;
  emailOnLeave: boolean;
  smsOnLate: boolean;
  smsOnAbsent: boolean;
  dailyReport: boolean;
  weeklyReport: boolean;
}

export interface EmployeeOfficeOverride extends DayOfficeHours {
  enabled: boolean;
  workingDays?: number[];
}

export interface AppSettings {
  company: CompanySettings;
  officeHours: OfficeHoursSettings;
  attendanceRules: AttendanceRulesSettings;
  notifications: NotificationSettings;
  employeeOfficeHours: Record<string, EmployeeOfficeOverride>;
}

const DEFAULT_DAY: DayOfficeHours = {
  startTime: '09:00',
  endTime: '17:00',
  graceMinutes: 15,
  earlyCheckoutMinutes: 15,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  company: {
    name: 'AttendAI Corp Pvt. Ltd.',
    email: 'hr@company.com',
    phone: '+977-1-4123456',
    address: 'Kathmandu, Nepal',
    website: 'https://company.com',
    timezone: 'Asia/Kathmandu',
    currency: 'NPR',
  },
  officeHours: {
    ...DEFAULT_DAY,
    workingDays: [1, 2, 3, 4, 5],
    byDay: {
      1: { ...DEFAULT_DAY },
      2: { ...DEFAULT_DAY },
      3: { ...DEFAULT_DAY },
      4: { ...DEFAULT_DAY },
      5: { ...DEFAULT_DAY },
    },
  },
  attendanceRules: {
    latePolicy: 'mark_late',
    overtimePolicy: 'no_auto',
    autoMarkAbsent: true,
    requireCheckout: true,
    missingCheckoutAction: 'notify',
    duplicatePunchWindowMinutes: 10,
    duplicateCheckOutWindowMinutes: 10,
    singlePunchHalfDayEnabled: true,
    singlePunchHalfDayBefore: '11:30',
    sickLeavePerMonth: 2,
    houseLeavePerMonth: 2,
  },
  notifications: {
    emailOnLate: true,
    emailOnAbsent: true,
    emailOnLeave: true,
    smsOnLate: false,
    smsOnAbsent: false,
    dailyReport: true,
    weeklyReport: true,
  },
  employeeOfficeHours: {},
};

function dayHoursFromFallback(oh: Pick<OfficeHoursSettings, keyof DayOfficeHours>): DayOfficeHours {
  return {
    startTime: oh.startTime,
    endTime: oh.endTime,
    graceMinutes: oh.graceMinutes,
    earlyCheckoutMinutes: oh.earlyCheckoutMinutes,
  };
}

/** Migrate legacy flat office hours into per-day map. */
export function normalizeOfficeHours(
  raw?: Partial<OfficeHoursSettings> | null,
): OfficeHoursSettings {
  const fallback = dayHoursFromFallback({
    startTime: raw?.startTime ?? DEFAULT_DAY.startTime,
    endTime: raw?.endTime ?? DEFAULT_DAY.endTime,
    graceMinutes: raw?.graceMinutes ?? DEFAULT_DAY.graceMinutes,
    earlyCheckoutMinutes: raw?.earlyCheckoutMinutes ?? DEFAULT_DAY.earlyCheckoutMinutes,
  });
  const workingDays =
    raw?.workingDays?.length ? [...raw.workingDays].sort() : [...DEFAULT_APP_SETTINGS.officeHours.workingDays];

  const byDay: Partial<Record<number, DayOfficeHours>> = {};
  const rawByDay = raw?.byDay ?? {};
  for (const d of workingDays) {
    const existing = rawByDay[d as keyof typeof rawByDay] ?? rawByDay[String(d) as unknown as number];
    byDay[d] = existing
      ? {
          startTime: existing.startTime ?? fallback.startTime,
          endTime: existing.endTime ?? fallback.endTime,
          graceMinutes: existing.graceMinutes ?? fallback.graceMinutes,
          earlyCheckoutMinutes: existing.earlyCheckoutMinutes ?? fallback.earlyCheckoutMinutes,
        }
      : { ...fallback };
  }
  // Keep any extra byDay entries (e.g. non-working days previously edited)
  for (const key of Object.keys(rawByDay)) {
    const d = Number(key);
    if (Number.isNaN(d) || byDay[d]) continue;
    const existing = rawByDay[d as keyof typeof rawByDay];
    if (!existing) continue;
    byDay[d] = {
      startTime: existing.startTime ?? fallback.startTime,
      endTime: existing.endTime ?? fallback.endTime,
      graceMinutes: existing.graceMinutes ?? fallback.graceMinutes,
      earlyCheckoutMinutes: existing.earlyCheckoutMinutes ?? fallback.earlyCheckoutMinutes,
    };
  }

  return {
    ...fallback,
    workingDays,
    byDay,
  };
}

export function getDayOfficeHours(
  officeHours: OfficeHoursSettings,
  dayOfWeek: number,
): DayOfficeHours {
  return officeHours.byDay[dayOfWeek] ?? dayHoursFromFallback(officeHours);
}

export function getAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APP_SETTINGS, employeeOfficeHours: {} };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      company: { ...DEFAULT_APP_SETTINGS.company, ...parsed.company },
      officeHours: normalizeOfficeHours(parsed.officeHours),
      attendanceRules: { ...DEFAULT_APP_SETTINGS.attendanceRules, ...parsed.attendanceRules },
      notifications: { ...DEFAULT_APP_SETTINGS.notifications, ...parsed.notifications },
      employeeOfficeHours: parsed.employeeOfficeHours ?? {},
    };
  } catch {
    return { ...DEFAULT_APP_SETTINGS, employeeOfficeHours: {} };
  }
}

export function saveAppSettings(settings: AppSettings): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...settings,
      officeHours: normalizeOfficeHours(settings.officeHours),
    }),
  );
}

function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

function dayOfWeekFromDate(date?: string): number {
  if (!date) return new Date().getDay();
  // Noon avoids DST / timezone edge cases for YYYY-MM-DD
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? new Date().getDay() : d.getDay();
}

/** Resolve schedule for OT/LT: employee override → company day hours → shift. */
export function resolveEmployeeSchedule(
  employeeId: string,
  shift?: { startTime: string; graceMinutes: number; workingHours: number },
  alternateIds: string[] = [],
  date?: string,
): { shiftStart: string; graceMinutes: number; dayHours: number; source: 'employee' | 'company' | 'shift' } {
  const app = getAppSettings();
  const ids = [employeeId, ...alternateIds].filter(Boolean);
  const override = ids.map((id) => app.employeeOfficeHours[id]).find((o) => o?.enabled);
  const dow = dayOfWeekFromDate(date);

  if (override?.enabled) {
    return {
      shiftStart: override.startTime,
      graceMinutes: override.graceMinutes,
      dayHours: hoursBetween(override.startTime, override.endTime),
      source: 'employee',
    };
  }

  const global = normalizeOfficeHours(app.officeHours);
  const day = getDayOfficeHours(global, dow);
  if (day.startTime && day.endTime) {
    return {
      shiftStart: day.startTime,
      graceMinutes: day.graceMinutes,
      dayHours: hoursBetween(day.startTime, day.endTime),
      source: 'company',
    };
  }

  if (shift) {
    return {
      shiftStart: shift.startTime,
      graceMinutes: shift.graceMinutes,
      dayHours: shift.workingHours,
      source: 'shift',
    };
  }

  return {
    shiftStart: '09:00',
    graceMinutes: 15,
    dayHours: 8,
    source: 'company',
  };
}
