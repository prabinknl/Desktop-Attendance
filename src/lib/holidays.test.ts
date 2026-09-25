import { describe, expect, it } from 'vitest';
import type { Holiday } from '../types';
import { buildHolidayMap, holidayRemark, isDayOffHoliday, resolveDayOff } from './holidays';

const h = (name: string, date: string, type: Holiday['type'] = 'public'): Holiday => ({
  id: `h-${name}`,
  name,
  date,
  type,
});

// Nepal office week: Sunday–Friday, Saturday weekly off
const WORKING_DAYS = [0, 1, 2, 3, 4, 5];

describe('holiday calendar', () => {
  it('treats a public holiday as a company day off', () => {
    const map = buildHolidayMap([h('Janaipurnima', '2026-08-28')]);
    const day = resolveDayOff('2026-08-28', map, WORKING_DAYS);
    expect(day.isDayOff).toBe(true);
    expect(day.remark).toBe('Janaipurnima');
  });

  it('keeps an optional holiday a working day but notes it', () => {
    const map = buildHolidayMap([h('Teej', '2026-08-25', 'optional')]);
    const day = resolveDayOff('2026-08-25', map, WORKING_DAYS);
    expect(day.isDayOff).toBe(false);
    expect(day.remark).toBe('Teej (optional)');
  });

  it('falls back to Weekly off for non-office days', () => {
    // 2026-08-22 is a Saturday
    const day = resolveDayOff('2026-08-22', new Map(), WORKING_DAYS);
    expect(day.isDayOff).toBe(true);
    expect(day.remark).toBe('Weekly off');
  });

  it('names the holiday when it lands on a weekly off', () => {
    const map = buildHolidayMap([h('Dashain', '2026-08-22')]);
    expect(resolveDayOff('2026-08-22', map, WORKING_DAYS).remark).toBe('Dashain');
  });

  it('is a plain working day with no holiday', () => {
    const day = resolveDayOff('2026-08-27', new Map(), WORKING_DAYS);
    expect(day.isDayOff).toBe(false);
    expect(day.remark).toBe('');
  });

  it('prefers a public holiday over an optional one on the same date', () => {
    const map = buildHolidayMap([
      h('Optional day', '2026-09-04', 'optional'),
      h('Shreekrishna Janmastami', '2026-09-04'),
    ]);
    expect(map.get('2026-09-04')?.name).toBe('Shreekrishna Janmastami');
    expect(resolveDayOff('2026-09-04', map, WORKING_DAYS).isDayOff).toBe(true);
  });

  it('normalises ISO date-times from calendar imports', () => {
    const map = buildHolidayMap([h('Imported', '2026-09-13T00:00:00.000Z')]);
    expect(map.has('2026-09-13')).toBe(true);
  });

  it('classifies holiday types', () => {
    expect(isDayOffHoliday(h('a', '2026-01-01'))).toBe(true);
    expect(isDayOffHoliday(h('b', '2026-01-01', 'restricted'))).toBe(false);
    expect(holidayRemark(h('b', '2026-01-01', 'restricted'))).toBe('b (restricted)');
  });
});
