import { describe, expect, it, beforeAll } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  resolveEmployeeSchedule,
  hoursBetween,
  type AppSettings,
} from './appSettings';
import { calcOtLtHours } from './utils';
import { AttendanceAPI, ShiftAPI } from '../data/store';
import type { Attendance } from '../types';

beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const store: Record<string, string> = {};
    globalThis.localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
      key: (i: number) => Object.keys(store)[i] ?? null,
      length: 0,
    } as any;
  }
});

describe('Office Hours & Attendance Recalculation', () => {
  it('correctly calculates hours between two times', () => {
    expect(hoursBetween('09:30', '17:00')).toBe(7.5);
    expect(hoursBetween('09:00', '17:00')).toBe(8);
  });

  it('recognizes non-working days in resolveEmployeeSchedule', () => {
    const settings: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      officeHours: {
        ...DEFAULT_APP_SETTINGS.officeHours,
        // Sun-Fri working, Sat (6) off
        workingDays: [0, 1, 2, 3, 4, 5],
        byDay: {
          0: { startTime: '09:30', endTime: '17:00', graceMinutes: 15, earlyCheckoutMinutes: 15 },
          1: { startTime: '09:30', endTime: '17:00', graceMinutes: 15, earlyCheckoutMinutes: 15 },
          6: { startTime: '09:00', endTime: '17:00', graceMinutes: 15, earlyCheckoutMinutes: 15 },
        },
      },
    };

    // Sunday (2026-10-11 is a Sunday)
    const sundaySchedule = resolveEmployeeSchedule('emp-1', undefined, [], '2026-10-11', settings);
    expect(sundaySchedule.isWorkingDay).toBe(true);
    expect(sundaySchedule.dayHours).toBe(7.5);
    expect(sundaySchedule.shiftStart).toBe('09:30');

    // Saturday (2026-10-10 is a Saturday)
    const saturdaySchedule = resolveEmployeeSchedule('emp-1', undefined, [], '2026-10-10', settings);
    expect(saturdaySchedule.isWorkingDay).toBe(false);
    expect(saturdaySchedule.dayHours).toBe(0);
  });

  it('calcOtLtHours computes live late minutes and does not penalize off-days', () => {
    // Check in at 09:20 with shift starting at 09:30 + 15 min grace => 0 min late!
    const onTime = calcOtLtHours({
      checkIn: '09:20',
      workingHours: 7.5,
      shiftStart: '09:30',
      graceMinutes: 15,
      dayHours: 7.5,
      lateMinutes: 20, // Stale old lateMinutes from previous 09:00 shift
    });
    // With 7.5h worked on a 7.5h day and arrived on time, OT/LT is 0
    expect(onTime).toBe(0);

    // On an off-day (dayHours = 0):
    // 1) Employee didn't work -> 0
    expect(calcOtLtHours({ dayHours: 0, workingHours: 0 })).toBe(0);
    // 2) Employee worked 4 hours -> +4h overtime (no deduction!)
    expect(calcOtLtHours({ dayHours: 0, workingHours: 4 })).toBe(4);
  });

  it('AttendanceAPI.recalculateWithSettings updates records when office hours change', async () => {
    // Create an attendance record with check-in at 09:20 on Monday 2026-10-12
    const testRecord: Attendance = {
      id: 'test-att-recalc-1',
      employeeId: 'emp-test-1',
      departmentId: 'd1',
      date: '2026-10-12',
      shiftId: 's1',
      checkIn: '09:20',
      checkOut: '17:00',
      breakMinutes: 0,
      workingHours: 7.67,
      overtime: 0,
      lateMinutes: 5, // Was late under old 09:00 shift (09:00 + 15m grace = 09:15)
      status: 'late',
      createdBy: 'test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save initial record
    const created = await AttendanceAPI.create(testRecord);

    // Now admin changes office hours to 09:30 AM (grace 15 => cutoff 09:45)
    const newSettings: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      officeHours: {
        ...DEFAULT_APP_SETTINGS.officeHours,
        workingDays: [0, 1, 2, 3, 4, 5],
        byDay: {
          1: { startTime: '09:30', endTime: '17:00', graceMinutes: 15, earlyCheckoutMinutes: 15 },
        },
      },
    };

    // Recalculate
    const updatedCount = await AttendanceAPI.recalculateWithSettings(newSettings);
    expect(updatedCount).toBeGreaterThan(0);

    // Check that the record's lateMinutes changed from 5 to 0, and status became 'present'
    const records = await AttendanceAPI.getAll();
    const updated = records.find((r) => r.id === created.id || (r.employeeId === 'emp-test-1' && r.date === '2026-10-12'));
    expect(updated).toBeDefined();
    expect(updated?.lateMinutes).toBe(0);
    expect(updated?.status).toBe('present');

    // Cleanup
    if (updated) {
      await AttendanceAPI.delete(updated.id);
    }
  });

  it('ShiftAPI.syncWithOfficeHours updates default shift s1', async () => {
    const newOfficeHours = {
      ...DEFAULT_APP_SETTINGS.officeHours,
      startTime: '09:30',
      endTime: '17:00',
      workingDays: [0, 1, 2, 3, 4, 5],
      byDay: {
        0: { startTime: '09:30', endTime: '17:00', graceMinutes: 15, earlyCheckoutMinutes: 15 },
        1: { startTime: '09:30', endTime: '17:00', graceMinutes: 15, earlyCheckoutMinutes: 15 },
      },
    };

    const shifts = await ShiftAPI.syncWithOfficeHours(newOfficeHours);
    const s1 = shifts.find((s) => s.id === 's1');
    expect(s1).toBeDefined();
    expect(s1?.startTime).toBe('09:30');
    expect(s1?.workingHours).toBe(7.5);
    expect(s1?.workingDays).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
