import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Users, UserCheck, UserX, Clock, CalendarOff, TrendingUp,
  Plus, ClipboardList, CheckSquare, FileText, ArrowRight,
  AlertCircle, UserPlus, Trash2,
} from 'lucide-react';
import InviteModal from '../../components/InviteModal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { authApi } from '../../api/authApi';
import { DashboardAPI, LeaveAPI, AttendanceAPI, EmployeeAPI } from '../../data/store';
import { mockHolidays } from '../../data/mockData';
import type { DashboardStats, Employee, User } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useInvitations } from '../../contexts/InvitationContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { formatDate, formatTime, attendanceStatusLabel, cn, getInitials } from '../../lib/utils';
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

interface DashboardAccessUser {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar?: string;
  meta?: string;
}

interface DashboardInviteRecord {
  token: string;
  email: string;
  name?: string;
  role: string;
  status?: string;
  createdAt?: string;
  expiresAt?: string;
  used?: boolean;
}

const STAFF_ACCOUNT_ROLES = new Set<string>(['employee', 'account']);
const DASHBOARD_INVITE_ROLES = new Set<string>(['employee', 'accountant']);

function titleFromEmail(email: string) {
  const local = email.split('@')[0]?.trim() || 'User';
  return local
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'User';
}

function roleLabel(role?: string) {
  switch ((role || '').toLowerCase()) {
    case 'account':
    case 'accountant':
      return 'Accountant';
    case 'employee':
      return 'Employee';
    default:
      return 'User';
  }
}

function formatListDate(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function employeeName(employee: Employee) {
  return `${employee.firstName} ${employee.lastName}`.trim() || employee.employeeId || titleFromEmail(employee.email);
}

function buildActiveAccessUsers(employees: Employee[], authUsers: User[]) {
  const byEmail = new Map<string, DashboardAccessUser>();

  employees
    .filter((employee) => employee.status === 'active')
    .forEach((employee) => {
      const email = employee.email.trim().toLowerCase();
      if (!email) return;
      byEmail.set(email, {
        id: employee.id,
        name: employeeName(employee),
        email: employee.email,
        role: 'Employee',
        avatar: employee.avatar,
        meta: employee.designation || employee.employeeId,
      });
    });

  authUsers
    .filter((authUser) => STAFF_ACCOUNT_ROLES.has(authUser.role))
    .filter((authUser) => !['deleted', 'pending', 'paused'].includes(String(authUser.status ?? 'active').toLowerCase()))
    .forEach((authUser) => {
      const email = authUser.email.trim().toLowerCase();
      if (!email) return;
      const existing = byEmail.get(email);
      byEmail.set(email, {
        id: existing?.id || authUser.id,
        name: existing?.name || authUser.name || titleFromEmail(authUser.email),
        email: existing?.email || authUser.email,
        role: existing?.role || roleLabel(authUser.role),
        avatar: existing?.avatar || authUser.avatar,
        meta: existing?.meta || authUser.employeeId || 'Registered account',
      });
    });

  return Array.from(byEmail.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function isPendingDashboardInvite(invite: DashboardInviteRecord) {
  const role = invite.role.toLowerCase();
  const status = String(invite.status ?? 'pending').toLowerCase();
  if (!DASHBOARD_INVITE_ROLES.has(role)) return false;
  if (invite.used || ['accepted', 'cancelled', 'deleted', 'expired'].includes(status)) return false;

  if (invite.expiresAt) {
    const expiresAt = new Date(invite.expiresAt).getTime();
    if (!Number.isNaN(expiresAt) && expiresAt < Date.now()) return false;
  }

  return true;
}

function buildInvitedAccessUsers(invites: DashboardInviteRecord[], activeEmails: Set<string>) {
  const byEmailAndRole = new Map<string, DashboardAccessUser & { createdAt?: string }>();

  invites
    .filter(isPendingDashboardInvite)
    .forEach((invite) => {
      const email = invite.email.trim().toLowerCase();
      if (!email || activeEmails.has(email)) return;

      const key = `${invite.role.toLowerCase()}:${email}`;
      const createdAt = invite.createdAt;
      const existing = byEmailAndRole.get(key);
      if (existing?.createdAt && createdAt && existing.createdAt > createdAt) return;

      byEmailAndRole.set(key, {
        id: invite.token || key,
        name: invite.name?.trim() || titleFromEmail(invite.email),
        email: invite.email,
        role: roleLabel(invite.role),
        meta: formatListDate(createdAt) ? `Invited ${formatListDate(createdAt)}` : 'Invite sent',
        createdAt,
      });
    });

  return Array.from(byEmailAndRole.values())
    .map(({ createdAt: _createdAt, ...item }) => item)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function AccessUserList({
  title,
  users,
  emptyText,
  icon: Icon,
  tone,
  onDelete,
}: {
  title: string;
  users: DashboardAccessUser[];
  emptyText: string;
  icon: React.ElementType;
  tone: 'active' | 'invited';
  onDelete?: (user: DashboardAccessUser) => void;
}) {
  const styles =
    tone === 'active'
      ? {
          icon: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300',
          badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
          dot: 'bg-emerald-500',
          label: 'Active',
        }
      : {
          icon: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300',
          badge: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
          dot: 'bg-indigo-500',
          label: 'Invited',
        };

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', styles.icon)}>
            <Icon size={19} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</h3>
            <p className="text-xs text-slate-400">{users.length} users</p>
          </div>
        </div>
        <span className={cn('rounded-full px-2.5 py-1 text-xs font-bold', styles.badge)}>
          {users.length}
        </span>
      </div>

      {users.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400 dark:bg-slate-800/60">
          {emptyText}
        </p>
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {users.map((item) => (
            <div key={`${item.role}-${item.email}-${item.id}`} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
              {item.avatar ? (
                <img src={item.avatar} alt="" className="h-9 w-9 rounded-full bg-slate-200 object-cover" />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                  {getInitials(item.name)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{item.name}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{item.email}</p>
                {item.meta && (
                  <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">{item.meta}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{item.role}</span>
                  <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold', styles.badge)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', styles.dot)} />
                    {styles.label}
                  </span>
                </div>
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(item)}
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30"
                    title={`Delete ${item.name}`}
                    aria-label={`Delete ${item.name}`}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { user, getAuthUsers, deleteStaffUser } = useAuth();
  const { getAllInvitations, softDeleteInvitation } = useInvitations();
  const { toast } = useNotifications();
  const navigate = useNavigate();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [deptStats, setDeptStats] = useState<any[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState<any[]>([]);
  const [recentAtt, setRecentAtt] = useState<any[]>([]);
  const [lateEmployees, setLateEmployees] = useState<any[]>([]);
  const [activeUsers, setActiveUsers] = useState<DashboardAccessUser[]>([]);
  const [invitedUsers, setInvitedUsers] = useState<DashboardAccessUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deletingAccess, setDeletingAccess] = useState<{
    user: DashboardAccessUser;
    tone: 'active' | 'invited';
  } | null>(null);

  const today = new Date().toISOString().split('T')[0];
  const upcomingHolidays = mockHolidays.filter(h => h.date >= today).slice(0, 5);

  const loadDashboardData = useCallback(async () => {
    try {
      const [s, t, d, leaves, attendance, employees, employeeInvites, accountantInvites] = await Promise.all([
        DashboardAPI.getStats(),
        DashboardAPI.getTrend(14),
        DashboardAPI.getDeptStats(),
        LeaveAPI.getAll(),
        AttendanceAPI.getByDate(today),
        EmployeeAPI.getAll(),
        authApi.getInvitationsByRole('employee'),
        authApi.getInvitationsByRole('accountant'),
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

      const activeAccessUsers = buildActiveAccessUsers(employees, getAuthUsers());
      const activeEmails = new Set(activeAccessUsers.map((item) => item.email.trim().toLowerCase()));
      const localInvites = getAllInvitations()
        .filter((invite) => DASHBOARD_INVITE_ROLES.has(invite.role))
        .map((invite) => ({
          token: invite.token,
          email: invite.email,
          name: invite.name,
          role: invite.role,
          status: invite.status,
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
          used: invite.used,
        }));

      setActiveUsers(activeAccessUsers);
      setInvitedUsers(buildInvitedAccessUsers(
        [...localInvites, ...employeeInvites, ...accountantInvites],
        activeEmails,
      ));
      setLoading(false);
    } catch (err) {
      console.error('[Dashboard] Load error:', err);
      setLoading(false);
    }
  }, [getAllInvitations, getAuthUsers, today]);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  const confirmDeleteAccess = async () => {
    if (!deletingAccess) return;

    const target = deletingAccess.user;
    try {
      if (deletingAccess.tone === 'active') {
        await deleteStaffUser(target.email);
        await EmployeeAPI.delete(target.id);
      } else {
        const result = await authApi.deleteStaffAccess(target.email);
        if (!result.success) {
          throw new Error(result.message || 'Could not delete this invitation.');
        }
        softDeleteInvitation(target.email);
      }

      setActiveUsers((items) => items.filter((item) => item.email.toLowerCase() !== target.email.toLowerCase()));
      setInvitedUsers((items) => items.filter((item) => item.email.toLowerCase() !== target.email.toLowerCase()));
      setDeletingAccess(null);
      await loadDashboardData();
      toast('success', deletingAccess.tone === 'active' ? 'User deleted' : 'Invitation deleted', `${target.name} was removed.`);
    } catch (err) {
      toast('error', 'Could not delete user', err instanceof Error ? err.message : 'Please try again.');
    }
  };

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

      {/* ── Active and invited users ─────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <AccessUserList
          title="Already Active Users"
          users={activeUsers}
          emptyText="No active users found."
          icon={UserCheck}
          tone="active"
          onDelete={user?.role === 'admin' ? (item) => setDeletingAccess({ user: item, tone: 'active' }) : undefined}
        />
        <AccessUserList
          title="Invited Users"
          users={invitedUsers}
          emptyText="No pending invited users found."
          icon={UserPlus}
          tone="invited"
          onDelete={user?.role === 'admin' ? (item) => setDeletingAccess({ user: item, tone: 'invited' }) : undefined}
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
      <InviteModal 
        open={inviteOpen} 
        onClose={() => setInviteOpen(false)}
        onInvitationSent={() => {
          // Refresh dashboard stats after invitation is sent
          setTimeout(() => void loadDashboardData(), 500);
        }}
      />
      <ConfirmDialog
        open={!!deletingAccess}
        title={deletingAccess?.tone === 'invited' ? 'Delete Invitation' : 'Delete User'}
        message={deletingAccess
          ? `Permanently delete ${deletingAccess.user.name} (${deletingAccess.user.email})?`
          : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void confirmDeleteAccess()}
        onCancel={() => setDeletingAccess(null)}
      />
    </div>
  );
}
