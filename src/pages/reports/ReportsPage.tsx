import React, { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Download, BarChart3, FileText, Calendar } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { AttendanceAPI, EmployeeAPI, DepartmentAPI } from '../../data/store';
import type { Attendance, Employee, Department } from '../../types';
import { formatDate, attendanceStatusLabel, cn } from '../../lib/utils';
import { useDateSettings } from '../../contexts/DateSettingsContext';
import CalendarDateInput from '../../components/ui/CalendarDateInput';
import { TimeDisplay, isManualTime } from '../../components/common/TimeDisplay';

const pieColors = ['#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4'];

const reportTypes = [
  { id: 'daily', label: 'Daily Report', icon: Calendar },
  { id: 'weekly', label: 'Weekly Report', icon: BarChart3 },
  { id: 'monthly', label: 'Monthly Report', icon: FileText },
  { id: 'employee', label: 'Employee Report', icon: FileText },
  { id: 'department', label: 'Department Report', icon: BarChart3 },
  { id: 'late', label: 'Late Report', icon: FileText },
  { id: 'absent', label: 'Absent Report', icon: FileText },
  { id: 'overtime', label: 'Overtime Report', icon: FileText },
];

export default function ReportsPage() {
  const { dateRange, updateDateRange, settings: dateSettings, updateSettings } = useDateSettings();
  const dateFrom = dateRange.from;
  const dateTo = dateRange.to;
  const calendar = dateSettings.calendarSystem;

  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeReport, setActiveReport] = useState('monthly');
  const [deptFilter, setDeptFilter] = useState('');
  const [empFilter, setEmpFilter] = useState('');

  useEffect(() => {
    (async () => {
      const [a, e, d] = await Promise.all([AttendanceAPI.getAll(), EmployeeAPI.getAll(), DepartmentAPI.getAll()]);
      setAttendance(a); setEmployees(e); setDepartments(d);
      setLoading(false);
    })();
  }, []);

  const empMap = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e])), [employees]);
  const deptMap = useMemo(() => Object.fromEntries(departments.map(d => [d.id, d])), [departments]);

  const filtered = useMemo(() => {
    let r = attendance.filter(a => a.date >= dateFrom && a.date <= dateTo);
    if (deptFilter) r = r.filter(a => a.departmentId === deptFilter);
    if (empFilter) r = r.filter(a => a.employeeId === empFilter);
    return r;
  }, [attendance, dateFrom, dateTo, deptFilter, empFilter]);

  // Daily trend chart data
  const trendData = useMemo(() => {
    const byDate: Record<string, { present: number; late: number; absent: number; wfh: number }> = {};
    filtered.forEach(a => {
      if (!byDate[a.date]) byDate[a.date] = { present: 0, late: 0, absent: 0, wfh: 0 };
      if (a.status === 'present') byDate[a.date].present++;
      else if (a.status === 'late') byDate[a.date].late++;
      else if (a.status === 'absent') byDate[a.date].absent++;
      else if (a.status === 'work_from_home') byDate[a.date].wfh++;
    });
    return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date, ...vals }));
  }, [filtered]);

  // Pie data
  const pieData = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach(a => { counts[a.status] = (counts[a.status] ?? 0) + 1; });
    return Object.entries(counts).map(([k, v]) => ({ name: attendanceStatusLabel[k as keyof typeof attendanceStatusLabel] ?? k, value: v }));
  }, [filtered]);

  // Dept bar data
  const deptData = useMemo(() =>
    departments.map(d => {
      const dAtt = filtered.filter(a => a.departmentId === d.id);
      const present = dAtt.filter(a => ['present', 'late', 'work_from_home'].includes(a.status)).length;
      return { name: d.name.substring(0, 8), total: dAtt.length, present };
    }), [departments, filtered]);

  // Summary stats
  const summary = useMemo(() => ({
    total: filtered.length,
    present: filtered.filter(a => a.status === 'present').length,
    late: filtered.filter(a => a.status === 'late').length,
    absent: filtered.filter(a => a.status === 'absent').length,
    wfh: filtered.filter(a => a.status === 'work_from_home').length,
    overtime: filtered.reduce((s, a) => s + a.overtime, 0),
    avgHours: filtered.length ? Math.round(filtered.reduce((s, a) => s + a.workingHours, 0) / filtered.length * 10) / 10 : 0,
  }), [filtered]);

  const exportCSV = () => {
    const headers = ['Date', 'Employee', 'Dept', 'CheckIn', 'CheckOut', 'Hours', 'OT', 'Status'];
    const rows = filtered.map(r => {
      const emp = empMap[r.employeeId];
      return [
        r.date,
        emp ? `${emp.firstName} ${emp.lastName}` : r.employeeId,
        deptMap[r.departmentId]?.name ?? r.departmentId,
        r.checkIn ?? '', r.checkOut ?? '',
        r.workingHours, r.overtime, r.status,
      ];
    });
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `report-${dateFrom}-${dateTo}.csv`; a.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Reports</h1>
          <p className="text-sm text-slate-500 mt-0.5">Attendance analytics and insights</p>
        </div>
        <button onClick={exportCSV} className="btn-primary">
          <Download size={16} /> Export CSV
        </button>
      </div>

      {/* Report type tabs */}
      <div className="flex flex-wrap gap-2">
        {reportTypes.map(r => (
          <button
            key={r.id}
            onClick={() => setActiveReport(r.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all',
              activeReport === r.id
                ? 'bg-primary-500 text-white shadow-sm shadow-primary-500/30'
                : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-primary-300'
            )}
          >
            <r.icon size={13} />
            {r.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
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
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-500">From ({calendar === 'bs' ? 'BS' : 'AD'}):</label>
          <CalendarDateInput
            value={dateFrom}
            max={dateTo || undefined}
            calendar={calendar}
            onChange={(v) => updateDateRange({ from: v })}
            className="input py-1.5 w-auto"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-500">To ({calendar === 'bs' ? 'BS' : 'AD'}):</label>
          <CalendarDateInput
            value={dateTo}
            min={dateFrom || undefined}
            calendar={calendar}
            onChange={(v) => updateDateRange({ to: v })}
            className="input py-1.5 w-auto"
          />
        </div>
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="input py-1.5 w-auto min-w-36">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={empFilter} onChange={e => setEmpFilter(e.target.value)} className="input py-1.5 w-auto min-w-40">
          <option value="">All Employees</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName} ({e.employeeId})</option>)}
        </select>
        <div className="ml-auto text-sm text-slate-500">
          {filtered.length} records in range
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Total', value: summary.total, color: 'text-slate-900 dark:text-white' },
          { label: 'Present', value: summary.present, color: 'text-emerald-600' },
          { label: 'Late', value: summary.late, color: 'text-amber-600' },
          { label: 'Absent', value: summary.absent, color: 'text-rose-600' },
          { label: 'WFH', value: summary.wfh, color: 'text-violet-600' },
          { label: 'OT Hours', value: `${summary.overtime}h`, color: 'text-primary-600' },
          { label: 'Avg Hours', value: `${summary.avgHours}h`, color: 'text-cyan-600' },
        ].map(s => (
          <div key={s.label} className="card p-3 text-center">
            <p className={cn('text-xl font-bold', s.color)}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Trend */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">Attendance Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="rg-present" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => formatDate(d, 'MMM dd')} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} labelFormatter={l => formatDate(String(l ?? ''), 'dd MMM')} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="present" stroke="#0ea5e9" strokeWidth={2} fill="url(#rg-present)" name="Present" />
              <Area type="monotone" dataKey="late" stroke="#f59e0b" strokeWidth={2} fill="none" name="Late" />
              <Area type="monotone" dataKey="absent" stroke="#f43f5e" strokeWidth={2} fill="none" name="Absent" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Pie */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">Status Distribution</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                {pieData.map((_, index) => <Cell key={index} fill={pieColors[index % pieColors.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {pieData.map((entry, i) => (
              <div key={entry.name} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: pieColors[i] }} />
                <span className="text-xs text-slate-600 dark:text-slate-400">{entry.name}: {entry.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Dept Bar */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">By Department</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={deptData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="total" fill="#e2e8f0" radius={[4, 4, 0, 0]} name="Total" />
              <Bar dataKey="present" fill="#0ea5e9" radius={[4, 4, 0, 0]} name="Present" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Overtime Line */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">Working Hours Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={trendData.map(d => ({
                ...d,
                hours: filtered.filter(a => a.date === d.date).reduce((s, a) => s + a.workingHours, 0) / Math.max(1, filtered.filter(a => a.date === d.date).length),
              }))}
              margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => formatDate(d, 'MMM dd')} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 10]} />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} labelFormatter={l => formatDate(String(l ?? ''), 'dd MMM')} formatter={(v) => [`${(typeof v === 'number' ? v : Number(v ?? 0)).toFixed(1)}h`, 'Avg Hours']} />
              <Line type="monotone" dataKey="hours" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3, fill: '#8b5cf6' }} name="Avg Hours" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detail table */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Detailed Records</h3>
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 sticky top-0">
              <tr>
                {['Date', 'Employee', 'Department', 'Check In', 'Check Out', 'Hours', 'OT', 'Status'].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.slice(0, 50).map(a => {
                const emp = empMap[a.employeeId];
                return (
                  <tr key={a.id} className="table-row-hover">
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">{formatDate(a.date)}</td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        <img src={emp?.avatar} alt="" className="w-6 h-6 rounded-full" />
                        <span className="font-medium text-slate-900 dark:text-white whitespace-nowrap">
                          {emp ? `${emp.firstName} ${emp.lastName}` : '—'}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-slate-500">{deptMap[a.departmentId]?.name ?? '—'}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                      <TimeDisplay time={a.manualCheckIn || a.checkIn} isManual={isManualTime(a, 'in')} record={a} type="in" />
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                      <TimeDisplay time={a.manualCheckOut || a.checkOut} isManual={isManualTime(a, 'out')} record={a} type="out" />
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-slate-700 dark:text-slate-200">{a.workingHours}h</td>
                    <td className="py-2.5 px-4 text-violet-500">{a.overtime > 0 ? `+${a.overtime}h` : '—'}</td>
                    <td className="py-2.5 px-4"><span className={`badge-${a.status}`}>{attendanceStatusLabel[a.status]}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
