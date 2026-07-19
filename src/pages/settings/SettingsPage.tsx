import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Building2, Clock, Calendar, Shield, Bell, Palette, Save,
  Upload, Plus, Trash2, CalendarPlus, FileUp, Cpu, ExternalLink,
} from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { useDateSettings } from '../../contexts/DateSettingsContext';
import { HolidayAPI, EmployeeAPI } from '../../data/store';
import { parseHolidayFile } from '../../lib/holidayImport';
import {
  DEFAULT_APP_SETTINGS,
  getAppSettings,
  getDayOfficeHours,
  normalizeOfficeHours,
  saveAppSettings,
  type AppSettings,
  type DayOfficeHours,
  type EmployeeOfficeOverride,
} from '../../lib/appSettings';
import type { Employee } from '../../types';
import { cn, formatDate } from '../../lib/utils';
import type { Holiday } from '../../types';

const tabs = [
  { id: 'company', label: 'Company', icon: Building2 },
  { id: 'office', label: 'Office Hours', icon: Clock },
  { id: 'attendance', label: 'Attendance Rules', icon: Shield },
  { id: 'devices', label: 'Devices', icon: Cpu },
  { id: 'holidays', label: 'Holidays', icon: Calendar },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'appearance', label: 'Appearance', icon: Palette },
];

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const { toast } = useNotifications();
  const { settings: dateSettings, updateSettings, setSettings } = useDateSettings();
  const [activeTab, setActiveTab] = useState('company');

  const [company, setCompany] = useState(DEFAULT_APP_SETTINGS.company);

  const [officeHours, setOfficeHours] = useState(() =>
    normalizeOfficeHours(DEFAULT_APP_SETTINGS.officeHours),
  );
  const [selectedDay, setSelectedDay] = useState(
    () => DEFAULT_APP_SETTINGS.officeHours.workingDays[0] ?? 1,
  );

  const [attendanceRules, setAttendanceRules] = useState(DEFAULT_APP_SETTINGS.attendanceRules);

  const [notifications, setNotifications] = useState(DEFAULT_APP_SETTINGS.notifications);

  const [employeeOfficeHours, setEmployeeOfficeHours] = useState<
    Record<string, EmployeeOfficeOverride>
  >({});
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [empOfficeDraft, setEmpOfficeDraft] = useState<EmployeeOfficeOverride | null>(null);

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayLoading, setHolidayLoading] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState({
    name: '',
    date: '',
    type: 'public' as Holiday['type'],
  });
  const googleInputRef = useRef<HTMLInputElement>(null);
  const hamroInputRef = useRef<HTMLInputElement>(null);

  const loadHolidays = async () => {
    const list = await HolidayAPI.getAll();
    setHolidays(list.sort((a, b) => a.date.localeCompare(b.date)));
  };

  useEffect(() => {
    const saved = getAppSettings();
    const oh = normalizeOfficeHours(saved.officeHours);
    setCompany(saved.company);
    setOfficeHours(oh);
    setSelectedDay(oh.workingDays[0] ?? 1);
    setAttendanceRules(saved.attendanceRules);
    setNotifications(saved.notifications);
    setEmployeeOfficeHours(saved.employeeOfficeHours);
  }, []);

  const selectedDayHours = getDayOfficeHours(officeHours, selectedDay);

  const updateSelectedDayHours = (patch: Partial<DayOfficeHours>) => {
    setOfficeHours((o) => {
      const current = getDayOfficeHours(o, selectedDay);
      const nextDay = { ...current, ...patch };
      const byDay = { ...o.byDay, [selectedDay]: nextDay };
      // Keep top-level fields in sync with the day being edited (legacy fallback)
      return {
        ...o,
        ...nextDay,
        byDay,
        workingDays: o.workingDays.includes(selectedDay)
          ? o.workingDays
          : [...o.workingDays, selectedDay].sort(),
      };
    });
  };

  const selectWorkingDay = (idx: number) => {
    setSelectedDay(idx);
    setOfficeHours((o) => {
      const byDay = { ...o.byDay };
      if (!byDay[idx]) {
        byDay[idx] = getDayOfficeHours(o, idx);
      }
      return { ...o, byDay };
    });
  };

  const toggleWorkingDay = (idx: number) => {
    setOfficeHours((o) => {
      const isOn = o.workingDays.includes(idx);
      if (isOn) {
        const workingDays = o.workingDays.filter((x) => x !== idx);
        const byDay = { ...o.byDay };
        delete byDay[idx];
        return { ...o, workingDays, byDay };
      }
      const day = getDayOfficeHours(o, idx);
      return {
        ...o,
        workingDays: [...o.workingDays, idx].sort(),
        byDay: { ...o.byDay, [idx]: day },
      };
    });
    setSelectedDay(idx);
  };

  useEffect(() => {
    if (activeTab === 'holidays') loadHolidays();
    if (activeTab === 'office') {
      void EmployeeAPI.getAll().then(setEmployees);
    }
  }, [activeTab]);

  const handleSave = () => {
    const payload: AppSettings = {
      company,
      officeHours,
      attendanceRules,
      notifications,
      employeeOfficeHours,
    };
    saveAppSettings(payload);
    setSettings(dateSettings);
    toast('success', 'Settings Saved', 'Your settings have been saved and will persist after refresh.');
  };

  const selectEmployeeForOffice = (empId: string) => {
    setSelectedEmpId(empId);
    if (!empId) {
      setEmpOfficeDraft(null);
      return;
    }
    const existing = employeeOfficeHours[empId];
    setEmpOfficeDraft(
      existing ?? {
        enabled: false,
        ...getDayOfficeHours(officeHours, selectedDay),
      },
    );
  };

  const saveEmployeeOfficeOverride = () => {
    if (!selectedEmpId || !empOfficeDraft) {
      toast('error', 'Select employee', 'Choose an employee to configure custom office hours.');
      return;
    }
    const emp = employees.find((e) => e.id === selectedEmpId);
    setEmployeeOfficeHours((prev) => {
      const next = { ...prev, [selectedEmpId]: { ...empOfficeDraft } };
      // Also key by machine employeeId so attendance OT/LT resolves correctly
      if (emp?.employeeId && emp.employeeId !== selectedEmpId) {
        next[emp.employeeId] = { ...empOfficeDraft };
      }
      return next;
    });
    toast(
      'success',
      'Employee hours saved',
      emp
        ? `Custom office hours for ${emp.firstName} ${emp.lastName} updated. Click Save Changes to persist.`
        : 'Custom office hours updated. Click Save Changes to persist.',
    );
  };

  const removeEmployeeOfficeOverride = (empId: string) => {
    setEmployeeOfficeHours((prev) => {
      const next = { ...prev };
      delete next[empId];
      return next;
    });
    if (selectedEmpId === empId) {
      setSelectedEmpId('');
      setEmpOfficeDraft(null);
    }
  };

  const importHolidays = async (
    file: File,
    source: 'google' | 'hamro_patro',
    label: string
  ) => {
    setHolidayLoading(true);
    try {
      const parsed = await parseHolidayFile(file);
      if (parsed.length === 0) {
        toast('error', 'No holidays found', `Could not read holiday events from ${file.name}.`);
        return;
      }

      const existing = new Set(holidays.map(h => `${h.date}|${h.name.toLowerCase()}`));
      const fresh = parsed.filter(p => !existing.has(`${p.date}|${p.name.toLowerCase()}`));

      if (fresh.length === 0) {
        toast('info', 'Already imported', `All holidays from ${file.name} are already in the list.`);
        return;
      }

      await HolidayAPI.createMany(
        fresh.map(p => ({
          name: p.name,
          date: p.date,
          type: 'public' as const,
          source,
        }))
      );
      await loadHolidays();
      toast('success', `${label} imported`, `Added ${fresh.length} holiday${fresh.length === 1 ? '' : 's'} from ${file.name}.`);
    } catch {
      toast('error', 'Import failed', 'Please upload a valid .ics, .csv, or .json calendar file.');
    } finally {
      setHolidayLoading(false);
    }
  };

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.name.trim() || !manualForm.date) {
      toast('error', 'Missing fields', 'Please enter a holiday name and date.');
      return;
    }
    await HolidayAPI.create({
      name: manualForm.name.trim(),
      date: manualForm.date,
      type: manualForm.type,
      source: 'manual',
    });
    setManualForm({ name: '', date: '', type: 'public' });
    setShowManualForm(false);
    await loadHolidays();
    toast('success', 'Holiday added', `${manualForm.name.trim()} has been added.`);
  };

  const handleDeleteHoliday = async (id: string, name: string) => {
    await HolidayAPI.delete(id);
    await loadHolidays();
    toast('success', 'Holiday removed', `${name} was removed from the calendar.`);
  };

  const sourceLabel = (source?: Holiday['source']) => {
    if (source === 'google') return 'Google';
    if (source === 'hamro_patro') return 'Hamro Patro';
    return 'Manual';
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
        <button onClick={handleSave} className="btn-primary">
          <Save size={16} /> Save Changes
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Tabs */}
        <div className="card p-2 lg:w-52 flex-shrink-0">
          <nav className="space-y-0.5">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'sidebar-item w-full',
                  activeTab === tab.id && 'active'
                )}
              >
                <tab.icon size={16} />
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 card p-6">
          {activeTab === 'company' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Company Information</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { label: 'Company Name', key: 'name' },
                  { label: 'Email', key: 'email' },
                  { label: 'Phone', key: 'phone' },
                  { label: 'Website', key: 'website' },
                  { label: 'Timezone', key: 'timezone' },
                  { label: 'Currency', key: 'currency' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">{f.label}</label>
                    <input
                      value={(company as any)[f.key]}
                      onChange={e => setCompany(c => ({ ...c, [f.key]: e.target.value }))}
                      className="input"
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Address</label>
                <textarea value={company.address} onChange={e => setCompany(c => ({ ...c, address: e.target.value }))} rows={2} className="input resize-none" />
              </div>
            </motion.div>
          )}

          {activeTab === 'office' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Office Hours</h2>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Working Days
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  Select a day to view or edit its office hours. Use the checkbox to mark it as a working day.
                </p>
                <div className="flex gap-2">
                  {DAY_LABELS.map((d, idx) => (
                    <button
                      key={d}
                      type="button"
                      title={`${d} hours`}
                      onClick={() => selectWorkingDay(idx)}
                      className={cn(
                        'w-9 h-9 rounded-xl text-xs font-bold transition-all ring-offset-2 dark:ring-offset-slate-900',
                        officeHours.workingDays.includes(idx)
                          ? 'bg-primary-500 text-white shadow-sm'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500',
                        selectedDay === idx && 'ring-2 ring-primary-400',
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3 mt-3">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Hours for {DAY_LABELS[selectedDay]}
                  </p>
                  <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={officeHours.workingDays.includes(selectedDay)}
                      onChange={() => toggleWorkingDay(selectedDay)}
                      className="rounded border-slate-300"
                    />
                    Working day
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Start Time</label>
                  <input
                    type="time"
                    value={selectedDayHours.startTime}
                    onChange={(e) => updateSelectedDayHours({ startTime: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">End Time</label>
                  <input
                    type="time"
                    value={selectedDayHours.endTime}
                    onChange={(e) => updateSelectedDayHours({ endTime: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Grace Period (min)</label>
                  <input
                    type="number"
                    min={0}
                    value={selectedDayHours.graceMinutes}
                    onChange={(e) => updateSelectedDayHours({ graceMinutes: +e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Early Checkout Grace (min)</label>
                  <input
                    type="number"
                    min={0}
                    value={selectedDayHours.earlyCheckoutMinutes}
                    onChange={(e) => updateSelectedDayHours({ earlyCheckoutMinutes: +e.target.value })}
                    className="input"
                  />
                </div>
              </div>

              <div className="pt-6 mt-6 border-t border-slate-200 dark:border-slate-700 space-y-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Individual Employee Office Hours
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Set custom office times for employees who do not follow the company default above.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Employee
                    </label>
                    <select
                      value={selectedEmpId}
                      onChange={(e) => selectEmployeeForOffice(e.target.value)}
                      className="input"
                    >
                      <option value="">Select employee…</option>
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.firstName} {emp.lastName} ({emp.employeeId})
                        </option>
                      ))}
                    </select>
                  </div>

                  {empOfficeDraft && selectedEmpId && (
                    <>
                      <div className="sm:col-span-2 flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          Use custom office hours for this employee
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setEmpOfficeDraft((d) => d && { ...d, enabled: !d.enabled })
                          }
                          className={cn(
                            'w-11 h-6 rounded-full transition-all duration-200 relative',
                            empOfficeDraft.enabled ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-600',
                          )}
                        >
                          <div
                            className={cn(
                              'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200',
                              empOfficeDraft.enabled ? 'translate-x-5' : 'translate-x-0.5',
                            )}
                          />
                        </button>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          Start Time
                        </label>
                        <input
                          type="time"
                          value={empOfficeDraft.startTime}
                          disabled={!empOfficeDraft.enabled}
                          onChange={(e) =>
                            setEmpOfficeDraft((d) => d && { ...d, startTime: e.target.value })
                          }
                          className="input disabled:opacity-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          End Time
                        </label>
                        <input
                          type="time"
                          value={empOfficeDraft.endTime}
                          disabled={!empOfficeDraft.enabled}
                          onChange={(e) =>
                            setEmpOfficeDraft((d) => d && { ...d, endTime: e.target.value })
                          }
                          className="input disabled:opacity-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          Grace Period (min)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={empOfficeDraft.graceMinutes}
                          disabled={!empOfficeDraft.enabled}
                          onChange={(e) =>
                            setEmpOfficeDraft((d) => d && { ...d, graceMinutes: +e.target.value })
                          }
                          className="input disabled:opacity-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          Early Checkout Grace (min)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={empOfficeDraft.earlyCheckoutMinutes}
                          disabled={!empOfficeDraft.enabled}
                          onChange={(e) =>
                            setEmpOfficeDraft((d) => d && { ...d, earlyCheckoutMinutes: +e.target.value })
                          }
                          className="input disabled:opacity-50"
                        />
                      </div>
                      <div className="sm:col-span-2 flex gap-2">
                        <button type="button" onClick={saveEmployeeOfficeOverride} className="btn-primary">
                          Apply to Employee
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {Object.keys(employeeOfficeHours).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                      Configured overrides
                    </p>
                    {Object.entries(employeeOfficeHours).map(([empId, ov]) => {
                      const emp = employees.find((e) => e.id === empId);
                      if (!ov.enabled) return null;
                      return (
                        <div
                          key={empId}
                          className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                              {emp ? `${emp.firstName} ${emp.lastName}` : empId}
                            </p>
                            <p className="text-xs text-slate-500">
                              {ov.startTime} – {ov.endTime} · Grace {ov.graceMinutes}m
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeEmployeeOfficeOverride(empId)}
                            className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                            title="Remove override"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'attendance' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Attendance Rules</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Late Arrival Policy</label>
                  <select value={attendanceRules.latePolicy} onChange={e => setAttendanceRules(r => ({ ...r, latePolicy: e.target.value }))} className="input">
                    <option value="mark_late">Mark as Late</option>
                    <option value="half_day">Mark as Half Day after 2h</option>
                    <option value="absent">Mark as Absent after 4h</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Overtime Policy</label>
                  <select value={attendanceRules.overtimePolicy} onChange={e => setAttendanceRules(r => ({ ...r, overtimePolicy: e.target.value }))} className="input">
                    <option value="no_auto">No auto-calculation</option>
                    <option value="auto_30min">Auto-calculate after 30 min OT</option>
                    <option value="auto_1h">Auto-calculate after 1h OT</option>
                  </select>
                </div>
                {[
                  { label: 'Auto-mark absent if no check-in', key: 'autoMarkAbsent' },
                  { label: 'Require checkout to close attendance', key: 'requireCheckout' },
                ].map(item => (
                  <div key={item.key} className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{item.label}</span>
                    <button
                      onClick={() => setAttendanceRules(r => ({ ...r, [item.key]: !(r as any)[item.key] }))}
                      className={cn(
                        'w-11 h-6 rounded-full transition-all duration-200 relative',
                        (attendanceRules as any)[item.key] ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-600'
                      )}
                    >
                      <div className={cn(
                        'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200',
                        (attendanceRules as any)[item.key] ? 'translate-x-5' : 'translate-x-0.5'
                      )} />
                    </button>
                  </div>
                ))}

                <div className="pt-4 mt-2 border-t border-slate-200 dark:border-slate-700 space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">Punch pairing</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      How device punches become check-in and check-out.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Duplicate check-in window (minutes)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={attendanceRules.duplicatePunchWindowMinutes}
                      onChange={(e) =>
                        setAttendanceRules((r) => ({
                          ...r,
                          duplicatePunchWindowMinutes: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="input"
                    />
                    <p className="text-xs text-slate-500 mt-1.5">
                      Punches within this time of the first keep the first check-in. After this window,
                      the next punch counts as check-out.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Duplicate check-out window (minutes)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={attendanceRules.duplicateCheckOutWindowMinutes}
                      onChange={(e) =>
                        setAttendanceRules((r) => ({
                          ...r,
                          duplicateCheckOutWindowMinutes: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="input"
                    />
                    <p className="text-xs text-slate-500 mt-1.5">
                      Punches within this time of check-out keep the first check-out. A punch after
                      this window updates check-out to the later time.
                    </p>
                  </div>
                  <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="min-w-0 pr-4">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300 block">
                        Single punch = half day (morning or afternoon)
                      </span>
                      <span className="text-xs text-slate-500">
                        Only one punch for the day (no check-out) counts as half-day work — morning or afternoon.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAttendanceRules((r) => ({
                          ...r,
                          singlePunchHalfDayEnabled: !r.singlePunchHalfDayEnabled,
                        }))
                      }
                      className={cn(
                        'w-11 h-6 rounded-full transition-all duration-200 relative flex-shrink-0',
                        attendanceRules.singlePunchHalfDayEnabled
                          ? 'bg-primary-500'
                          : 'bg-slate-300 dark:bg-slate-600',
                      )}
                    >
                      <div
                        className={cn(
                          'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200',
                          attendanceRules.singlePunchHalfDayEnabled
                            ? 'translate-x-5'
                            : 'translate-x-0.5',
                        )}
                      />
                    </button>
                  </div>
                </div>

                <div className="pt-4 mt-2 border-t border-slate-200 dark:border-slate-700 space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">Monthly leave allowance</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Set how many leave days each employee may take per month.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Sick leave per month (days)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={31}
                        value={attendanceRules.sickLeavePerMonth}
                        onChange={(e) =>
                          setAttendanceRules((r) => ({
                            ...r,
                            sickLeavePerMonth: Math.max(0, Math.min(31, Number(e.target.value) || 0)),
                          }))
                        }
                        className="input"
                      />
                      <p className="text-xs text-slate-500 mt-1.5">
                        Maximum sick leave days allowed each month.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        House leave per month (days)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={31}
                        value={attendanceRules.houseLeavePerMonth}
                        onChange={(e) =>
                          setAttendanceRules((r) => ({
                            ...r,
                            houseLeavePerMonth: Math.max(0, Math.min(31, Number(e.target.value) || 0)),
                          }))
                        }
                        className="input"
                      />
                      <p className="text-xs text-slate-500 mt-1.5">
                        Maximum house leave days allowed each month.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'notifications' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Notification Settings</h2>
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Email Notifications</p>
                {[
                  { label: 'Late arrival alert', key: 'emailOnLate' },
                  { label: 'Absent employee alert', key: 'emailOnAbsent' },
                  { label: 'Leave request notifications', key: 'emailOnLeave' },
                  { label: 'Daily attendance report', key: 'dailyReport' },
                  { label: 'Weekly summary report', key: 'weeklyReport' },
                ].map(item => (
                  <div key={item.key} className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <span className="text-sm text-slate-700 dark:text-slate-300">{item.label}</span>
                    <button
                      onClick={() => setNotifications(n => ({ ...n, [item.key]: !(n as any)[item.key] }))}
                      className={cn('w-11 h-6 rounded-full transition-all relative', (notifications as any)[item.key] ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-600')}
                    >
                      <div className={cn('absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform', (notifications as any)[item.key] ? 'translate-x-5' : 'translate-x-0.5')} />
                    </button>
                  </div>
                ))}
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-2">SMS Notifications</p>
                {[
                  { label: 'SMS on late arrival', key: 'smsOnLate' },
                  { label: 'SMS on absent', key: 'smsOnAbsent' },
                ].map(item => (
                  <div key={item.key} className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <span className="text-sm text-slate-700 dark:text-slate-300">{item.label}</span>
                    <button
                      onClick={() => setNotifications(n => ({ ...n, [item.key]: !(n as any)[item.key] }))}
                      className={cn('w-11 h-6 rounded-full transition-all relative', (notifications as any)[item.key] ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-600')}
                    >
                      <div className={cn('absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform', (notifications as any)[item.key] ? 'translate-x-5' : 'translate-x-0.5')} />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'appearance' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Appearance</h2>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Theme</label>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { id: 'light', label: 'Light Mode', desc: 'Clean and bright interface' },
                    { id: 'dark', label: 'Dark Mode', desc: 'Easy on the eyes at night' },
                  ].map(t => (
                    <button
                      key={t.id}
                      onClick={() => { if (theme !== t.id) toggleTheme(); }}
                      className={cn(
                        'p-4 rounded-2xl border-2 text-left transition-all',
                        theme === t.id
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      )}
                    >
                      <div className={cn('w-full h-20 rounded-xl mb-3', t.id === 'light' ? 'bg-slate-100' : 'bg-slate-800')} />
                      <p className="font-semibold text-slate-900 dark:text-white">{t.label}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{t.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">Date & Calendar</h3>
                <p className="text-sm text-slate-500 mb-4">
                  Choose English (AD) or Nepali (Bikram Sambat / BS) date display.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  {[
                    { id: 'ad' as const, label: 'English Date (AD)', desc: 'Gregorian calendar (e.g. 14 Jul 2026)' },
                    { id: 'bs' as const, label: 'Nepali Date (BS)', desc: 'Bikram Sambat calendar (e.g. ३० असार २०८३)' },
                  ].map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => updateSettings({ calendarSystem: opt.id })}
                      className={cn(
                        'p-4 rounded-2xl border-2 text-left transition-all',
                        dateSettings.calendarSystem === opt.id
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      )}
                    >
                      <p className="font-semibold text-slate-900 dark:text-white">{opt.label}</p>
                      <p className="text-xs text-slate-500 mt-1">{opt.desc}</p>
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Show both AD and BS</p>
                      <p className="text-xs text-slate-500 mt-0.5">Display secondary date next to the primary calendar</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateSettings({ showBothCalendars: !dateSettings.showBothCalendars })}
                      className={cn(
                        'w-11 h-6 rounded-full transition-all relative',
                        dateSettings.showBothCalendars ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-600'
                      )}
                    >
                      <div className={cn(
                        'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform',
                        dateSettings.showBothCalendars ? 'translate-x-5' : 'translate-x-0.5'
                      )} />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Nepali date format
                      </label>
                      <select
                        value={dateSettings.nepaliDateFormat}
                        onChange={e => updateSettings({ nepaliDateFormat: e.target.value })}
                        className="input"
                      >
                        <option value="YYYY-MM-DD">YYYY-MM-DD BS (e.g. 2083-03-30 BS)</option>
                        <option value="DD MMMM YYYY">DD Month YYYY BS (e.g. 30 Asar 2083 BS)</option>
                        <option value="ne-unicode">Nepali Unicode BS (e.g. ३० असार २०८३)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Week starts on
                      </label>
                      <select
                        value={dateSettings.weekStart}
                        onChange={e => updateSettings({ weekStart: e.target.value })}
                        className="input"
                      >
                        <option value="sunday">Sunday</option>
                        <option value="monday">Monday</option>
                      </select>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Preview</p>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {formatDate(new Date())}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'devices' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Attendance Machine</h2>
                <p className="text-sm text-slate-500">
                  Device connection and attendance sync run against the real Hikvision ISAPI API.
                  Simulated localStorage devices have been removed.
                </p>
              </div>
              <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40">
                <Cpu size={28} className="text-primary-500 mb-3" />
                <p className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                  Use Device Settings for real hardware
                </p>
                <p className="text-xs text-slate-500 mb-4">
                  Save credentials, authenticate with Digest auth, download punches, and run Manual Sync
                  from the dedicated Device Settings page.
                </p>
                <Link to="/device-settings" className="btn-primary inline-flex items-center gap-2">
                  <ExternalLink size={14} /> Open Device Settings
                </Link>
              </div>
            </motion.div>
          )}

          {(activeTab === 'holidays') && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Holiday Calendar</h2>
                <p className="text-sm text-slate-500">
                  Import from Google Calendar or Hamro Patro, or add holidays manually.
                </p>
              </div>

              <input
                ref={googleInputRef}
                type="file"
                accept=".ics,.csv,.json,text/calendar"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) importHolidays(file, 'google', 'Google Calendar');
                  e.target.value = '';
                }}
              />
              <input
                ref={hamroInputRef}
                type="file"
                accept=".ics,.csv,.json,text/calendar"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) importHolidays(file, 'hamro_patro', 'Hamro Patro');
                  e.target.value = '';
                }}
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  disabled={holidayLoading}
                  onClick={() => googleInputRef.current?.click()}
                  className="flex flex-col items-start gap-2 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-primary-400 hover:bg-primary-50/50 dark:hover:bg-primary-900/20 transition-all text-left disabled:opacity-50"
                >
                  <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-900/40 text-sky-600 flex items-center justify-center">
                    <FileUp size={18} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-slate-900 dark:text-white">Google Calendar</p>
                    <p className="text-xs text-slate-500 mt-0.5">Upload .ics export</p>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={holidayLoading}
                  onClick={() => hamroInputRef.current?.click()}
                  className="flex flex-col items-start gap-2 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-primary-400 hover:bg-primary-50/50 dark:hover:bg-primary-900/20 transition-all text-left disabled:opacity-50"
                >
                  <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/40 text-rose-600 flex items-center justify-center">
                    <Upload size={18} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-slate-900 dark:text-white">Hamro Patro</p>
                    <p className="text-xs text-slate-500 mt-0.5">Upload .ics / .csv / .json</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setShowManualForm(v => !v)}
                  className={cn(
                    'flex flex-col items-start gap-2 p-4 rounded-2xl border transition-all text-left',
                    showManualForm
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                      : 'border-slate-200 dark:border-slate-700 hover:border-primary-400 hover:bg-primary-50/50 dark:hover:bg-primary-900/20'
                  )}
                >
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 flex items-center justify-center">
                    <CalendarPlus size={18} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-slate-900 dark:text-white">Manual Add</p>
                    <p className="text-xs text-slate-500 mt-0.5">Add a single holiday day</p>
                  </div>
                </button>
              </div>

              {showManualForm && (
                <form onSubmit={handleManualAdd} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 space-y-3">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Add holiday</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-1">
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Name</label>
                      <input
                        value={manualForm.name}
                        onChange={e => setManualForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Dashain"
                        className="input"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Date</label>
                      <input
                        type="date"
                        value={manualForm.date}
                        onChange={e => setManualForm(f => ({ ...f, date: e.target.value }))}
                        className="input"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Type</label>
                      <select
                        value={manualForm.type}
                        onChange={e => setManualForm(f => ({ ...f, type: e.target.value as Holiday['type'] }))}
                        className="input"
                      >
                        <option value="public">Public</option>
                        <option value="optional">Optional</option>
                        <option value="restricted">Restricted</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className="btn-primary">
                      <Plus size={14} /> Add Holiday
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setShowManualForm(false)}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Holidays ({holidays.length})
                  </p>
                  {holidayLoading && (
                    <span className="text-xs text-primary-600">Importing…</span>
                  )}
                </div>

                {holidays.length === 0 ? (
                  <div className="p-8 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-center text-slate-400">
                    <Calendar size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No holidays yet. Import a calendar or add one manually.</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {holidays.map(h => (
                      <div
                        key={h.id}
                        className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        <div className="w-11 h-11 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex flex-col items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-bold text-primary-600 uppercase">
                            {new Date(h.date + 'T00:00:00').toLocaleString('en', { month: 'short' })}
                          </span>
                          <span className="text-sm font-bold text-primary-700 dark:text-primary-300 leading-none">
                            {new Date(h.date + 'T00:00:00').getDate()}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{h.name}</p>
                          <p className="text-xs text-slate-500">
                            {formatDate(h.date)} · <span className="capitalize">{h.type}</span> · {sourceLabel(h.source)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteHoliday(h.id, h.name)}
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                          title="Remove holiday"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
