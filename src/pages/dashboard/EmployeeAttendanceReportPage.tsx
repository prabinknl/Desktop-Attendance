import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import {
  CalendarDays, Clock, AlertTriangle, TrendingUp, CalendarOff, UserX,
  Download, RefreshCw,
} from 'lucide-react';
import { useLocation, useParams } from 'react-router-dom';
import { AttendanceAPI, LeaveAPI, ShiftAPI, EmployeeAPI, subscribeAttendance } from '../../data/store';
import type { Attendance, LeaveRequest, Shift, Employee } from '../../types';
import {
  cn, formatDate, formatTime, attendanceStatusLabel, leaveStatusLabel,
  calcOtLtHours, formatOtLt, formatHoursMinutes, isApprovedLeaveDay,
} from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { useDateSettings } from '../../contexts/DateSettingsContext';
import { downloadAttendancePdf } from '../../lib/attendancePdf';
import CalendarDateInput from '../../components/ui/CalendarDateInput';
import { deviceApi } from '../../api/deviceApi';
import { resolveEmployeeSchedule } from '../../lib/appSettings';
import { importAttendanceFromDeviceLogs } from '../../lib/deviceAttendanceSync';
import type { AttendanceLogEntry } from '../../types/device';

function logLocalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatWeekday(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? '—'
    : parsed.toLocaleDateString('en-US', { weekday: 'long' });
}

function SummaryCard({
  title, value, icon: Icon, color, sub,
}: {
  title: string; value: string | number; icon: React.ElementType; color: string; sub?: string;
}) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={cn('w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0', color)}>
        <Icon size={18} className="text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 dark:text-slate-400">{title}</p>
        <p className="text-xl font-bold text-slate-900 dark:text-white leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function EmployeeAttendanceReportPage() {
  const { employeeId: routeEmployeeId } = useParams<{ employeeId?: string }>();
  const location = useLocation();
  const { user } = useAuth();
  const { toast } = useNotifications();
  const { dateRange, updateDateRange, setDateRange, settings: dateSettings, updateSettings } =
    useDateSettings();
  const dateFrom = dateRange.from;
  const dateTo = dateRange.to;
  const calendar = dateSettings.calendarSystem;

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingDaily, setRefreshingDaily] = useState(false);

  const employeeId = routeEmployeeId || user?.employeeId;

  const load = async (opts?: { quiet?: boolean }): Promise<Attendance[]> => {
    if (!employeeId) {
      setLoading(false);
      return [];
    }
    if (!opts?.quiet) setLoading(true);
    const [emps, attAll, leaveList, shiftList] = await Promise.all([
      EmployeeAPI.getAll(),
      AttendanceAPI.getAll(),
      LeaveAPI.getAll(),
      ShiftAPI.getAll(),
    ]);
    const emp = emps.find(e => e.id === employeeId || e.employeeId === employeeId) ?? null;
    const att = attAll.filter(
      (a) =>
        a.employeeId === employeeId ||
        (emp != null && (a.employeeId === emp.id || a.employeeId === emp.employeeId)),
    );
    const empLeaves = leaveList.filter(
      (l) =>
        l.employeeId === employeeId ||
        (emp != null && (l.employeeId === emp.id || l.employeeId === emp.employeeId)),
    );
    setEmployee(emp);
    setAttendance(att);
    setLeaves(empLeaves);
    setShifts(shiftList);
    setLoading(false);
    return att;
  };

  const refreshDailyByDateRange = async () => {
    if (!dateFrom || !dateTo) {
      toast('error', 'Date required', 'Select both From and To dates.');
      return;
    }
    if (dateFrom > dateTo) {
      toast('error', 'Invalid range', 'From date must be on or before To date.');
      return;
    }
    setRefreshingDaily(true);
    try {
      // Keep manual Edit Attendance changes even if device re-import runs
      const manualRows = await AttendanceAPI.getManualOverrides();

      const startTime = new Date(`${dateFrom}T00:00:00`).toISOString();
      const endTime = new Date(`${dateTo}T23:59:59.999`).toISOString();
      const result = await deviceApi.sync({ startTime, endTime });
      const logs = await deviceApi.getLogs(undefined, { from: dateFrom, to: dateTo });
      const logsInRange = logs.filter((log: AttendanceLogEntry) => {
        const d = logLocalDate(log.time);
        return d >= dateFrom && d <= dateTo;
      });
      await importAttendanceFromDeviceLogs(logsInRange);
      const kept = await AttendanceAPI.restoreManualOverrides(manualRows);
      const att = await load();
      const inRangeCount = att.filter(
        (a) => a.date >= dateFrom && a.date <= dateTo,
      ).length;
      toast(
        'success',
        'Attendance refreshed',
        `Downloaded ${result.downloaded} punch(es); ${inRangeCount} day(s) in range` +
          (kept ? ` · ${kept} manual edit(s) kept` : '') +
          '.',
      );
    } catch (err) {
      toast(
        'error',
        'Refresh failed',
        err instanceof Error ? err.message : 'Could not update attendance for this date range.',
      );
    } finally {
      setRefreshingDaily(false);
    }
  };

  useEffect(() => {
    void load();
  }, [employeeId, location.key]);

  // Live-update when Edit Attendance saves (same browser session)
  useEffect(() => {
    return subscribeAttendance(() => {
      void load({ quiet: true });
    });
  }, [employeeId]);

  // Reload when returning to this tab/window
  useEffect(() => {
    const reload = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', reload);
    return () => {
      window.removeEventListener('focus', reload);
      document.removeEventListener('visibilitychange', reload);
    };
  }, [employeeId]);

  const shiftMap = useMemo(
    () => Object.fromEntries(shifts.map(s => [s.id, s])),
    [shifts]
  );

  const rangedAttendance = useMemo(
    () => {
      // Extra safety: one row per date on the report
      const byDate = new Map<string, Attendance>();
      for (const a of attendance) {
        if (a.date < dateFrom || a.date > dateTo) continue;
        const prev = byDate.get(a.date);
        if (!prev) {
          byDate.set(a.date, a);
          continue;
        }
        if (a.manualOverride && !prev.manualOverride) byDate.set(a.date, a);
        else if (a.manualOverride === prev.manualOverride && (a.updatedAt || '') > (prev.updatedAt || '')) {
          byDate.set(a.date, a);
        }
      }
      return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    },
    [attendance, dateFrom, dateTo]
  );

  const getSchedule = (record: Attendance) => {
    const shift = shiftMap[record.shiftId];
    const altIds = [
      employee?.id,
      employee?.employeeId,
    ].filter((id): id is string => Boolean(id) && id !== record.employeeId);
    return resolveEmployeeSchedule(record.employeeId, shift, altIds, record.date);
  };

  const getOtLt = (record: Attendance) => {
    const aliases = [employee?.id, employee?.employeeId].filter(
      (id): id is string => Boolean(id),
    );
    if (isApprovedLeaveDay(leaves, record.employeeId, record.date, aliases)) {
      return 0;
    }
    const schedule = getSchedule(record);
    return calcOtLtHours({
      checkIn: record.checkIn,
      workingHours: record.workingHours,
      overtime: record.overtime,
      lateMinutes: record.lateMinutes,
      shiftStart: schedule.shiftStart,
      graceMinutes: schedule.graceMinutes,
      dayHours: schedule.dayHours,
    });
  };

  const summary = useMemo(() => {
    let lateHours = 0;
    let overtimeHours = 0;
    let presentDays = 0;
    let absentDays = 0;
    let lateDays = 0;
    let halfDays = 0;
    let wfhDays = 0;

    for (const a of rangedAttendance) {
      const otLt = getOtLt(a);
      if (otLt > 0) overtimeHours += otLt;
      if (otLt < 0) lateHours += Math.abs(otLt);

      if (a.status === 'present' || a.status === 'work_from_home') presentDays += 1;
      if (a.status === 'absent') absentDays += 1;
      if (a.status === 'late') {
        lateDays += 1;
        presentDays += 1;
      }
      if (a.status === 'half_day') halfDays += 1;
      if (a.status === 'work_from_home') wfhDays += 1;
    }

    const approvedLeaves = leaves.filter(
      l =>
        (l.status === 'approved' || l.status === 'conditional_approved') &&
        l.fromDate <= dateTo &&
        l.toDate >= dateFrom
    );
    const approvedLeaveDays = approvedLeaves.reduce((s, l) => {
      // Count overlapping days within range (simple: use totalDays when fully inside)
      const from = l.fromDate < dateFrom ? dateFrom : l.fromDate;
      const to = l.toDate > dateTo ? dateTo : l.toDate;
      const days =
        Math.max(
          1,
          Math.round(
            (parseISO(to).getTime() - parseISO(from).getTime()) / (1000 * 60 * 60 * 24)
          ) + 1
        );
      return s + days;
    }, 0);

    return {
      lateHours: Math.round(lateHours * 100) / 100,
      overtimeHours: Math.round(overtimeHours * 100) / 100,
      presentDays,
      absentDays,
      lateDays,
      halfDays,
      wfhDays,
      approvedLeaveDays,
      approvedLeaves,
      otLtNet: Math.round((overtimeHours - lateHours) * 100) / 100,
      records: rangedAttendance.length,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangedAttendance, leaves, dateFrom, dateTo, shiftMap, employee]);

  const monthLabel = (() => {
    try {
      const from = parseISO(dateFrom);
      const to = parseISO(dateTo);
      const a = format(from, 'MMM yyyy');
      const b = format(to, 'MMM yyyy');
      return a === b ? a : `${a} – ${b}`;
    } catch {
      return '—';
    }
  })();

  const handleExport = () => {
    if (!employee || rangedAttendance.length === 0) {
      toast('warning', 'Nothing to export', 'No attendance records in this date range.');
      return;
    }
    downloadAttendancePdf(
      rangedAttendance,
      {
        employees: { [employee.id]: employee },
        departments: {},
        shifts: shiftMap,
      },
      {
        employeeName: `${employee.firstName} ${employee.lastName}`,
        monthLabel,
        dateLabel: `${formatDate(dateFrom)} – ${formatDate(dateTo)}`,
        fileName: `my-attendance-${dateFrom}-to-${dateTo}.pdf`,
      }
    );
    toast('success', 'PDF Downloaded', 'Your attendance report was exported.');
  };

  if (!employeeId) {
    return (
      <div className="card p-8 text-center text-slate-500">
        No employee profile is linked to this account.
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Attendance Report</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {employee
              ? `${employee.firstName} ${employee.lastName} · ${employee.employeeId}`
              : 'My attendance summary'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} className="btn-ghost p-2" title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button type="button" onClick={handleExport} className="btn-secondary py-2 px-3">
            <Download size={14} /> Export PDF
          </button>
        </div>
      </div>

      {/* Date range */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Calendar</label>
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <button
                type="button"
                className={cn(
                  'px-2.5 py-2 text-xs font-semibold',
                  calendar === 'ad' ? 'bg-primary-500 text-white' : 'bg-white dark:bg-slate-900 text-slate-600',
                )}
                onClick={() => updateSettings({ calendarSystem: 'ad' })}
              >
                AD
              </button>
              <button
                type="button"
                className={cn(
                  'px-2.5 py-2 text-xs font-semibold',
                  calendar === 'bs' ? 'bg-primary-500 text-white' : 'bg-white dark:bg-slate-900 text-slate-600',
                )}
                onClick={() => updateSettings({ calendarSystem: 'bs' })}
              >
                BS
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Date from ({calendar === 'bs' ? 'BS' : 'AD'})
            </label>
            <CalendarDateInput
              value={dateFrom}
              max={dateTo || undefined}
              calendar={calendar}
              onChange={(v) => updateDateRange({ from: v })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Date to ({calendar === 'bs' ? 'BS' : 'AD'})
            </label>
            <CalendarDateInput
              value={dateTo}
              min={dateFrom || undefined}
              calendar={calendar}
              onChange={(v) => updateDateRange({ to: v })}
            />
          </div>
          <div className="flex gap-2 pb-0.5">
            <button
              type="button"
              className="btn-secondary py-2 text-xs"
              onClick={() => {
                const now = new Date();
                setDateRange({
                  from: format(startOfMonth(now), 'yyyy-MM-dd'),
                  to: format(endOfMonth(now), 'yyyy-MM-dd'),
                });
              }}
            >
              This month
            </button>
            <button
              type="button"
              className="btn-secondary py-2 text-xs"
              onClick={() => {
                const to = new Date();
                const from = new Date();
                from.setDate(to.getDate() - 29);
                setDateRange({
                  from: format(from, 'yyyy-MM-dd'),
                  to: format(to, 'yyyy-MM-dd'),
                });
              }}
            >
              Last 30 days
            </button>
          </div>
          <p className="text-xs text-slate-400 ml-auto pb-2">
            Showing {summary.records} day{summary.records === 1 ? '' : 's'} · {monthLabel}
          </p>
        </div>
      </div>

      {/* Summary */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card p-4"><div className="skeleton h-12 rounded-xl" /></div>
          ))}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-3"
        >
          <SummaryCard title="Present days" value={summary.presentDays} icon={CalendarDays} color="bg-emerald-500" />
          <SummaryCard title="Absent days" value={summary.absentDays} icon={UserX} color="bg-rose-500" />
          <SummaryCard title="Late days" value={summary.lateDays} icon={AlertTriangle} color="bg-amber-500" />
          <SummaryCard
            title="Approved leave"
            value={`${summary.approvedLeaveDays}d`}
            icon={CalendarOff}
            color="bg-sky-500"
            sub={`${summary.approvedLeaves.length} request(s)`}
          />
          <SummaryCard
            title="Late hours (LT)"
            value={formatHoursMinutes(summary.lateHours)}
            icon={Clock}
            color="bg-rose-500"
            sub="Short / late time in range"
          />
          <SummaryCard
            title="Overtime (OT)"
            value={formatHoursMinutes(summary.overtimeHours)}
            icon={TrendingUp}
            color="bg-emerald-500"
            sub="Extra hours in range"
          />
          <SummaryCard
            title="OT/LT net"
            value={formatOtLt(summary.otLtNet)}
            icon={Clock}
            color="bg-primary-500"
          />
          <SummaryCard
            title="Half day / WFH"
            value={`${summary.halfDays} / ${summary.wfhDays}`}
            icon={CalendarDays}
            color="bg-violet-500"
            sub="Half day · Work from home"
          />
        </motion.div>
      )}

      {/* Approved leave list */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Approved leave in range</h2>
        </div>
        {summary.approvedLeaves.length === 0 ? (
          <p className="p-6 text-sm text-slate-400 text-center">No approved leave in this date range.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {summary.approvedLeaves.map(l => (
              <div key={l.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 capitalize">{l.leaveType.replace('_', ' ')}</p>
                    <span className={`badge-${l.status}`}>{leaveStatusLabel[l.status]}</span>
                  </div>
                  <p className="text-xs text-slate-500">{l.reason}</p>
                  {l.status === 'approved' && (
                    <p className="text-[11px] text-emerald-600 mt-0.5">OT/LT (+/−) hidden on attendance for these days</p>
                  )}
                  {l.status === 'conditional_approved' && (
                    <p className="text-[11px] text-indigo-600 mt-0.5">Conditional — OT/LT (+/−) still shown on attendance</p>
                  )}
                </div>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                  {formatDate(l.fromDate)} – {formatDate(l.toDate)} ({l.totalDays}d)
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Attendance detail table */}
      <div className="card overflow-hidden max-w-5xl mx-auto w-full">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Daily attendance</h2>
            <span className="text-xs text-slate-400">{rangedAttendance.length} records</span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Calendar</label>
              <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <button
                  type="button"
                  className={cn(
                    'px-2.5 py-1.5 text-xs font-semibold',
                    calendar === 'ad' ? 'bg-primary-500 text-white' : 'bg-white dark:bg-slate-900 text-slate-600',
                  )}
                  onClick={() => updateSettings({ calendarSystem: 'ad' })}
                >
                  AD
                </button>
                <button
                  type="button"
                  className={cn(
                    'px-2.5 py-1.5 text-xs font-semibold',
                    calendar === 'bs' ? 'bg-primary-500 text-white' : 'bg-white dark:bg-slate-900 text-slate-600',
                  )}
                  onClick={() => updateSettings({ calendarSystem: 'bs' })}
                >
                  BS
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                From ({calendar === 'bs' ? 'BS' : 'AD'})
              </label>
              <CalendarDateInput
                value={dateFrom}
                max={dateTo || undefined}
                calendar={calendar}
                onChange={(v) => updateDateRange({ from: v })}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                To ({calendar === 'bs' ? 'BS' : 'AD'})
              </label>
              <CalendarDateInput
                value={dateTo}
                min={dateFrom || undefined}
                calendar={calendar}
                onChange={(v) => updateDateRange({ to: v })}
              />
            </div>
            <div>
              <button
                type="button"
                onClick={() => void refreshDailyByDateRange()}
                disabled={refreshingDaily || loading}
                className="btn-primary py-2 px-3 text-xs font-semibold"
              >
                <RefreshCw size={13} className={cn(refreshingDaily && 'animate-spin')} />
                {refreshingDaily ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {['Date', 'Day', 'Check In', 'Check Out', 'Hours', 'Dayhour', 'OT/LT', 'Status', 'Remarks'].map(h => (
                  <th key={h} className="text-left py-2.5 px-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="py-2.5 px-2.5"><div className="skeleton h-4 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : rangedAttendance.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-sm text-slate-400">
                    No attendance records for this date range.
                  </td>
                </tr>
              ) : (
                rangedAttendance.map(a => {
                  const schedule = getSchedule(a);
                  const otLt = getOtLt(a);
                  const displayedRemark =
                    a.remarks && !a.remarks.startsWith('source=')
                      ? a.remarks
                      : a.location && a.location !== 'Device Sync'
                        ? a.location
                        : '';
                  return (
                    <tr key={a.id} className="table-row-hover">
                      <td className="py-2.5 px-2.5 whitespace-nowrap">{formatDate(a.date)}</td>
                      <td className="py-2.5 px-2.5">
                        <span className="text-xs font-medium px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                          {formatWeekday(a.date)}
                        </span>
                      </td>
                      <td className="py-2.5 px-2.5 font-mono">{formatTime(a.checkIn)}</td>
                      <td className="py-2.5 px-2.5 font-mono">{formatTime(a.checkOut)}</td>
                      <td className="py-2.5 px-2.5 font-semibold">{formatHoursMinutes(a.workingHours || 0)}</td>
                      <td className="py-2.5 px-2.5">{formatHoursMinutes(schedule.dayHours)}</td>
                      <td className="py-2.5 px-2.5">
                        {!otLt ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <span className={cn('text-xs font-semibold', otLt > 0 ? 'text-emerald-600' : 'text-rose-600')}>
                            {formatOtLt(otLt)}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-2.5">
                        <span className={`badge-${a.status}`}>{attendanceStatusLabel[a.status]}</span>
                      </td>
                      <td
                        className="py-2.5 px-2.5 text-xs text-slate-500 max-w-36 truncate"
                        title={displayedRemark}
                      >
                        {displayedRemark}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {rangedAttendance.length > 0 && (
              <tfoot className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                <tr>
                  <td className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase" colSpan={6}>
                    Total OT/LT
                  </td>
                  <td className="py-3 px-4">
                    <span className={cn(
                      'text-sm font-bold',
                      summary.otLtNet > 0 ? 'text-emerald-600' : summary.otLtNet < 0 ? 'text-rose-600' : 'text-slate-500'
                    )}>
                      {formatOtLt(summary.otLtNet)}
                    </span>
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
