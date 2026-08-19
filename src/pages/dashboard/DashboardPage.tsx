import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Users, UserCheck, UserX, Clock, CalendarOff, TrendingUp,
  Plus, ClipboardList, CheckSquare, FileText, ArrowRight,
  AlertCircle, UserPlus, Cpu,
} from 'lucide-react';
import InviteModal from '../../components/InviteModal';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { DashboardAPI, LeaveAPI, AttendanceAPI, EmployeeAPI } from '../../data/store';
import { mockHolidays } from '../../data/mockData';
import type { DashboardStats } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { formatDate, formatTime, attendanceStatusLabel, cn } from '../../lib/utils';
import { TimeDisplay, isManualTime } from '../../components/common/TimeDisplay';

const pieColors = ['#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4'];

function StatCard({
  title, value, icon: Icon, color, sub, delay = 0,
}: {
  title: string; value: string | number; icon: React.ElementType;
  color: string; sub?: string; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="card p-5 flex items-center gap-4"
    >
      <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0', color)}>
        <Icon size={22} className="text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-slate-500 dark:text-slate-400 leading-none">{title}</p>
        <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </motion.div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { toast } = useNotifications();
  const navigate = useNavigate();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [deptStats, setDeptStats] = useState<any[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState<any[]>([]);
  const [recentAtt, setRecentAtt] = useState<any[]>([]);
  const [lateEmployees, setLateEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const upcomingHolidays = mockHolidays.filter(h => h.date >= today).slice(0, 5);

  useEffect(() => {
    (async () => {
      const [s, t, d, leaves, attendance, employees] = await Promise.all([
        DashboardAPI.getStats(),
        DashboardAPI.getTrend(14),
        DashboardAPI.getDeptStats(),
        LeaveAPI.getAll(),
        AttendanceAPI.getByDate(today),
        EmployeeAPI.getAll(),
      ]);

      setStats(s);
      setTrend(t);
      setDeptStats(d);
      setPendingLeaves(leaves.filter(l => l.status === 'pending').slice(0, 5));

      const empMap = Object.fromEntries(employees.map(e => [e.id, e]));
      const withEmp = attendance
        .map(a => ({ ...a, employee: empMap[a.employeeId] }))
        .filter(a => a.employee);

      setLateEmployees(withEmp.filter(a => a.status === 'late').slice(0, 5));
      setRecentAtt(withEmp.slice(0, 8));
      setLoading(false);
    })();
  }, []);

  const pieData = stats ? [
    { name: 'Present', value: stats.presentToday },
    { name: 'Absent', value: stats.absentToday },
    { name: 'Late', value: stats.lateToday },
    { name: 'On Leave', value: stats.onLeaveToday },
  ] : [];

  const isAccountant = user?.role === 'account';

  const quickActions = isAccountant
    ? [
        { label: 'Export Report', icon: FileText, path: '/attendance', color: 'bg-violet-500 hover:bg-violet-600' },
        { label: 'View Attendance', icon: Clock, path: '/attendance', color: 'bg-primary-500 hover:bg-primary-600' },
        { label: 'View Employees', icon: Users, path: '/employees', color: 'bg-emerald-500 hover:bg-emerald-600' },
      ]
    : [
        { label: 'Add Attendance', icon: Plus, path: '/attendance?action=add', color: 'bg-primary-500 hover:bg-primary-600' },
        { label: 'Add Employee', icon: Users, path: '/employees?action=add', color: 'bg-emerald-500 hover:bg-emerald-600' },
        { label: 'Approve Leave', icon: CheckSquare, path: '/leave', color: 'bg-amber-500 hover:bg-amber-600' },
        { label: 'Export Report', icon: FileText, path: '/reports', color: 'bg-violet-500 hover:bg-violet-600' },
      ];

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-24 rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-72 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {(() => {
              const displayName = user?.name?.trim() || user?.email?.trim() || 'User';
              const greeting = displayName.includes('@') ? displayName : displayName.split(' ')[0];
              return `Good morning, ${greeting} 👋`;
            })()}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            {formatDate(new Date())} · Here's what's happening today
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          {quickActions.map(a => (
            <button
              key={a.label}
              onClick={() => navigate(a.path)}
              className={cn('btn text-white text-xs px-3 py-2', a.color)}
            >
              <a.icon size={14} />
              <span className="hidden xl:inline">{a.label}</span>
            </button>
          ))}
          {user?.role === 'admin' && (
            <button
              onClick={() => setInviteOpen(true)}
              className="btn bg-indigo-500 hover:bg-indigo-600 text-white text-xs px-3 py-2 flex items-center gap-1.5"
            >
              <UserPlus size={14} />
              <span className="hidden xl:inline">Invite</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="Total Employees" value={stats!.totalEmployees} icon={Users} color="bg-primary-500" delay={0} />
        <StatCard title="Present Today" value={stats!.presentToday} icon={UserCheck} color="bg-emerald-500" sub="Including late" delay={0.05} />
        <StatCard title="Absent" value={stats!.absentToday} icon={UserX} color="bg-rose-500" delay={0.1} />
        <StatCard title="Late Arrivals" value={stats!.lateToday} icon={Clock} color="bg-amber-500" delay={0.15} />
        <StatCard title="On Leave" value={stats!.onLeaveToday} icon={CalendarOff} color="bg-cyan-500" delay={0.2} />
        <StatCard
          title="Attendance Rate"
          value={`${stats!.attendancePercentage}%`}
          icon={TrendingUp}
          color="bg-violet-500"
          sub="Today"
          delay={0.25}
        />
      </div>

      {/* ── Charts row 1 ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Attendance Trend - 14 day area */}
        <div className="xl:col-span-2 card p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">
            14-Day Attendance Trend
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="present-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="absent-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-700" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => formatDate(d, 'MMM dd')} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                labelFormatter={l => formatDate(String(l ?? ''), 'dd MMM yyyy')}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="present" stroke="#0ea5e9" strokeWidth={2} fill="url(#present-grad)" name="Present" />
              <Area type="monotone" dataKey="late" stroke="#f59e0b" strokeWidth={2} fill="none" name="Late" strokeDasharray="4 2" />
              <Area type="monotone" dataKey="absent" stroke="#f43f5e" strokeWidth={2} fill="url(#absent-grad)" name="Absent" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Pie chart */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">
            Today's Breakdown
          </h3>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                {pieData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {pieData.map((entry, i) => (
              <div key={entry.name} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: pieColors[i] }} />
                <span className="text-xs text-slate-600 dark:text-slate-400">{entry.name}: <strong>{entry.value}</strong></span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Charts row 2 ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Department Attendance */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">
            Department Attendance (Today)
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={deptStats} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" className="dark:stroke-slate-700" />
              <XAxis type="number" tick={{ fontSize: 10 }} domain={[0, 100]} tickFormatter={v => `${v}%`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(v) => [`${Number(v ?? 0)}%`, 'Attendance']} />
              <Bar dataKey="percentage" fill="#0ea5e9" radius={[0, 6, 6, 0]} name="Attendance %">
                {deptStats.map((_, index) => (
                  <Cell key={index} fill={pieColors[index % pieColors.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Weekly Bar */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">
            Weekly Overview
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trend.slice(-7)} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-700" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => formatDate(d, 'EEE')} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} labelFormatter={l => formatDate(String(l ?? ''), 'EEE, dd MMM')} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="present" fill="#0ea5e9" radius={[4, 4, 0, 0]} name="Present" stackId="a" />
              <Bar dataKey="late" fill="#f59e0b" radius={[0, 0, 0, 0]} name="Late" stackId="a" />
              <Bar dataKey="absent" fill="#f43f5e" radius={[0, 0, 0, 0]} name="Absent" stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Widgets row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">

        {/* Today's Late Employees */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <AlertCircle size={15} className="text-amber-500" />
              Today's Late Arrivals
            </h3>
            <span className="badge bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
              {lateEmployees.length}
            </span>
          </div>
          <div className="space-y-3">
            {lateEmployees.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">No late arrivals today 🎉</p>
            )}
            {lateEmployees.map(a => (
              <div key={a.id} className="flex items-center gap-3">
                <img
                  src={(a.employee as any)?.avatar}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover bg-slate-200"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                    {(a.employee as any)?.firstName} {(a.employee as any)?.lastName}
                  </p>
                  <p className="text-xs text-slate-400">
                    Arrived: {formatTime(a.checkIn)} · {a.lateMinutes}m late
                  </p>
                </div>
                <span className="badge-late">Late</span>
              </div>
            ))}
          </div>
        </div>

        {/* Pending Leave Requests */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <ClipboardList size={15} className="text-primary-500" />
              Pending Leave Requests
            </h3>
            <button onClick={() => navigate('/leave')} className="text-xs text-primary-500 hover:text-primary-600 font-medium">
              View all →
            </button>
          </div>
          <div className="space-y-3">
            {pendingLeaves.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">No pending requests</p>
            )}
            {pendingLeaves.map(l => (
              <div key={l.id} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white capitalize">
                    {l.leaveType} Leave
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatDate(l.fromDate)} – {formatDate(l.toDate)} ({l.totalDays}d)
                  </p>
                </div>
                <span className="badge-pending">Pending</span>
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming Holidays */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">
            Upcoming Holidays
          </h3>
          <div className="space-y-3">
            {upcomingHolidays.map(h => (
              <div key={h.id} className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex flex-col items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-primary-600 dark:text-primary-400 uppercase">
                    {formatDate(h.date, 'MMM')}
                  </span>
                  <span className="text-base font-bold text-primary-700 dark:text-primary-300 leading-none">
                    {formatDate(h.date, 'dd')}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{h.name}</p>
                  <p className="text-xs text-slate-400 capitalize">{h.type} holiday</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Recent Attendance ───────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Today's Attendance</h3>
          <button onClick={() => navigate('/attendance')} className="text-xs text-primary-500 hover:text-primary-600 font-medium flex items-center gap-1">
            View all <ArrowRight size={12} />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700">
                {['Employee', 'Department', 'Check In', 'Check Out', 'Hours', 'Status'].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {recentAtt.map(a => (
                <tr key={a.id} className="table-row-hover">
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2.5">
                      <img src={(a.employee as any)?.avatar} alt="" className="w-7 h-7 rounded-full" />
                      <span className="font-medium text-slate-900 dark:text-white">
                        {(a.employee as any)?.firstName} {(a.employee as any)?.lastName}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">
                    {(a.employee as any)?.departmentId}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                    <TimeDisplay time={a.manualCheckIn || a.checkIn} isManual={isManualTime(a, 'in')} record={a} type="in" />
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                    <TimeDisplay time={a.manualCheckOut || a.checkOut} isManual={isManualTime(a, 'out')} record={a} type="out" />
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{a.workingHours}h</td>
                  <td className="py-2.5 px-3">
                    <span className={`badge-${a.status}`}>
                      {attendanceStatusLabel[a.status as keyof typeof attendanceStatusLabel]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Quick Actions (mobile) ───────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:hidden gap-3">
        {quickActions.map(a => (
          <button
            key={a.label}
            onClick={() => navigate(a.path)}
            className={cn('btn text-white py-4 flex-col gap-2 rounded-2xl', a.color)}
          >
            <a.icon size={22} />
            <span className="text-sm font-semibold">{a.label}</span>
          </button>
        ))}
        {user?.role === 'admin' && (
          <button
            onClick={() => setInviteOpen(true)}
            className="btn bg-indigo-500 hover:bg-indigo-600 text-white py-4 flex-col gap-2 rounded-2xl"
          >
            <UserPlus size={22} />
            <span className="text-sm font-semibold">Invite</span>
          </button>
        )}
      </div>

      {/* ── Invite modal ─────────────────────────────────────────────────── */}
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
