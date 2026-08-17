import React, { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_DATE_SETTINGS,
  getDateSettings,
  setDateSettings as persistDateSettings,
  type DateDisplaySettings,
} from '../lib/dateDisplay';

export interface AppDateRange {
  from: string; // yyyy-MM-dd
  to: string;
}

const RANGE_STORAGE_KEY = 'app-filter-date-range';

function defaultDateRange(): AppDateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function loadDateRange(): AppDateRange {
  try {
    const saved = localStorage.getItem(RANGE_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<AppDateRange>;
      const base = defaultDateRange();
      return {
        from: typeof parsed.from === 'string' && parsed.from ? parsed.from : base.from,
        to: typeof parsed.to === 'string' && parsed.to ? parsed.to : base.to,
      };
    }
  } catch {
    /* ignore */
  }
  return defaultDateRange();
}

function persistDateRange(range: AppDateRange) {
  localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify(range));
}

interface DateSettingsContextType {
  settings: DateDisplaySettings;
  updateSettings: (patch: Partial<DateDisplaySettings>) => void;
  setSettings: (next: DateDisplaySettings) => void;
  /** Shared From/To filter used across Device Settings, Attendance, Reports, etc. */
  dateRange: AppDateRange;
  setDateRange: (next: AppDateRange) => void;
  updateDateRange: (patch: Partial<AppDateRange>) => void;
  /** Bumps when settings change so dependent UI remounts/refreshes */
  formatKey: string;
}

const DateSettingsContext = createContext<DateSettingsContextType | null>(null);

export function DateSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<DateDisplaySettings>(() => getDateSettings());
  const [dateRange, setDateRangeState] = useState<AppDateRange>(() => loadDateRange());

  const updateSettings = (patch: Partial<DateDisplaySettings>) => {
    const next = { ...settings, ...patch };
    persistDateSettings(next);
    setSettingsState(next);
  };

  const setSettings = (next: DateDisplaySettings) => {
    persistDateSettings(next);
    setSettingsState(next);
  };

  const setDateRange = (next: AppDateRange) => {
    persistDateRange(next);
    setDateRangeState(next);
  };

  const updateDateRange = (patch: Partial<AppDateRange>) => {
    const next = { ...dateRange, ...patch };
    persistDateRange(next);
    setDateRangeState(next);
  };

  const value = useMemo(
    () => ({
      settings,
      updateSettings,
      setSettings,
      dateRange,
      setDateRange,
      updateDateRange,
      formatKey: [
        settings.calendarSystem,
        settings.showBothCalendars ? 'both' : 'one',
        settings.nepaliDateFormat,
        settings.weekStart,
      ].join('|'),
    }),
    [settings, dateRange],
  );

  return (
    <DateSettingsContext.Provider value={value}>
      {children}
    </DateSettingsContext.Provider>
  );
}

export function useDateSettings() {
  const ctx = useContext(DateSettingsContext);
  if (!ctx) throw new Error('useDateSettings must be used within DateSettingsProvider');
  return ctx;
}

/** Safe optional hook for places outside provider (returns defaults). */
export function useDateSettingsOptional() {
  return useContext(DateSettingsContext);
}
