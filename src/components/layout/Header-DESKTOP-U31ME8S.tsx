import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Bell, Sun, Moon, Menu, X, ChevronDown, User as UserIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { EmployeeAPI, DepartmentAPI } from '../../data/store';
import type { Employee, Department } from '../../types';
import { cn, getInitials, timeAgo } from '../../lib/utils';

interface HeaderProps {
  sidebarCollapsed: boolean;
  onMobileMenuToggle: () => void;
}

const notifIconMap: Record<string, string> = {
  late_arrival: '⏰',
  leave_request: '📋',
  leave_approved: '✅',
  leave_rejected: '❌',
  attendance_saved: '📝',
  missing_checkout: '🔔',
  employee_added: '👤',
  employee_updated: '✏️',
  report_generated: '📊',
  attendance_updated: '🔄',
  attendance_deleted: '🗑️',
};

function formatPlanExpiry(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function resolveAdminExpiryMs(user: {
  accessExpiresAt?: string;
  createdAt?: string;
  durationDays?: number;
  freeDays?: number;
  paidDays?: number;
  planType?: 'free' | 'paid';
}): number | null {
  if (user.accessExpiresAt) {
    const t = new Date(user.accessExpiresAt).getTime();
    return Number.isNaN(t) ? null : t;
  }
  const duration =
    user.durationDays ??
    (user.planType === 'paid' ? user.paidDays : user.freeDays);
  if (!duration || duration <= 0) return null;
  const start = user.createdAt ? new Date(user.createdAt).getTime() : Date.now();
  if (Number.isNaN(start)) return null;
  return start + duration * 24 * 60 * 60 * 1000;
}

function getRemainingParts(expiryMs: number, nowMs: number) {
  const diff = expiryMs - nowMs;
  if (diff <= 0) {
    return { expired: true as const, days: 0, hours: 0, minutes: 0, label: 'Expired' };
  }
  const totalMinutes = Math.floor(diff / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return {
    expired: false as const,
    days,
    hours,
    minutes,
    label: parts.join(' '),
  };
}

export default function Header({ sidebarCollapsed, onMobileMenuToggle }: HeaderProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const navigate = useNavigate();

  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keep remaining time fresh for the admin plan badge
  useEffect(() => {
    if (user?.role !== 'admin') return;
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [user?.role]);

  const adminPlanBadge = useMemo(() => {
    if (user?.role !== 'admin') return null;
    const planType = user.planType === 'paid' ? 'paid' : 'free';
    const expiryMs = resolveAdminExpiryMs(user);
    const expiryLabel = expiryMs
      ? formatPlanExpiry(new Date(expiryMs).toISOString())
      : formatPlanExpiry(user.accessExpiresAt);
    const remaining = expiryMs ? getRemainingParts(expiryMs, nowMs) : null;
    const expired = remaining?.expired ?? false;
    return { planType, expiryLabel, expired, remaining };
  }, [user, nowMs]);

  // Load employees and departments for global search
  useEffect(() => {
    (async () => {
      try {
        const [empList, deptList] = await Promise.all([
          EmployeeAPI.getAll(),
          DepartmentAPI.getAll(),
        ]);
        setEmployees(empList);
        setDepartments(deptList);
      } catch (err) {
        console.warn('[Header] Failed to load search data:', err);
      }
    })();
  }, []);

  const deptMap = useMemo(
    () => Object.fromEntries(departments.map(d => [d.id, d.name])),
    [departments]
  );

  // Matching employees for the search query
  const matchingEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return employees.filter(emp => {
      const fullName = `${emp.firstName} ${emp.lastName}`.toLowerCase();
      const code = (emp.employeeId || '').toLowerCase();
      const desig = (emp.designation || '').toLowerCase();
      const deptName = (deptMap[emp.departmentId] || '').toLowerCase();
      const email = (emp.email || '').toLowerCase();
      return (
        fullName.includes(q) ||
        code.includes(q) ||
        desig.includes(q) ||
        deptName.includes(q) ||
        email.includes(q)
      );
    }).slice(0, 8);
  }, [searchQuery, employees, deptMap]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard shortcut ⌘K or Ctrl+K to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchFocused(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const roleLabels: Record<string, string> = {
    admin: 'Administrator',
    account: 'Account',
    hr: 'HR Manager',
    dept_manager: 'Dept. Manager',
    employee: 'Employee',
  };

  const handleSelectEmployee = (emp: Employee) => {
    setSearchQuery('');
    setSearchFocused(false);
    navigate(`/dashboard?employeeId=${emp.id}`);
  };

  return (
    <header
      className={cn(
        'fixed top-0 right-0 z-30 h-16 flex items-center gap-4 px-6',
        'bg-white/80 dark:bg-slate-900/80 backdrop-blur-md',
        'border-b border-slate-200 dark:border-slate-800',
        'transition-all duration-300',
        sidebarCollapsed ? 'left-[72px]' : 'left-[260px]'
      )}
    >
      {/* Mobile menu toggle */}
      <button
        onClick={onMobileMenuToggle}
        className="lg:hidden btn-ghost p-2 -ml-2"
      >
        <Menu size={20} />
      </button>

      {/* Global Search with Live Employee Results */}
      <div ref={searchRef} className="relative flex-1 max-w-md">
        <div
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-xl',
            'bg-slate-100 dark:bg-slate-800 border',
            searchFocused
              ? 'border-primary-400 ring-2 ring-primary-500/20'
              : 'border-transparent',
            'transition-all duration-200'
          )}
        >
          <Search size={15} className="text-slate-400 flex-shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search employees, attendance..."
            onFocus={() => setSearchFocused(true)}
            className="bg-transparent text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 outline-none flex-1"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
            >
              <X size={14} />
            </button>
          )}
          <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 bg-white dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600 select-none">
            ⌘K
          </kbd>
        </div>

        {/* Global Search Results Dropdown */}
        <AnimatePresence>
          {searchFocused && searchQuery.trim().length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 right-0 top-full mt-2 card shadow-2xl overflow-hidden z-50 max-h-96 overflow-y-auto"
            >
              <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Employees ({matchingEmployees.length})
                </span>
                <span className="text-[11px] text-slate-400">Click to view attendance</span>
              </div>

              {matchingEmployees.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400">
                  <UserIcon size={24} className="mx-auto mb-1.5 opacity-30" />
                  No employees found matching "{searchQuery}"
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {matchingEmployees.map(emp => (
                    <div
                      key={emp.id}
                      onClick={() => handleSelectEmployee(emp)}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/80 cursor-pointer transition-colors"
                    >
                      <img
                        src={emp.avatar}
                        alt={`${emp.firstName} ${emp.lastName}`}
                        className="w-8 h-8 rounded-full bg-slate-200 object-cover flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {emp.firstName} {emp.lastName}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {emp.employeeId} · {emp.designation || 'Employee'}{' '}
                          {deptMap[emp.departmentId] ? `(${deptMap[emp.departmentId]})` : ''}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-primary-600 dark:text-primary-400 flex-shrink-0">
                        View →
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Admin Free / Paid plan badge */}
        {adminPlanBadge && (
          <div
            className={cn(
              'hidden sm:flex flex-col items-end justify-center px-3 py-1.5 rounded-xl border text-right min-w-[10.5rem]',
              adminPlanBadge.expired
                ? 'bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-800'
                : adminPlanBadge.planType === 'paid'
                  ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800'
                  : 'bg-sky-50 border-sky-200 dark:bg-sky-950/30 dark:border-sky-800',
            )}
            title={
              adminPlanBadge.remaining
                ? `${adminPlanBadge.planType === 'paid' ? 'Paid' : 'Free'} account · ${adminPlanBadge.remaining.label}${adminPlanBadge.expiryLabel ? ` · ends ${adminPlanBadge.expiryLabel}` : ''}`
                : `${adminPlanBadge.planType === 'paid' ? 'Paid' : 'Free'} account`
            }
          >
            <span
              className={cn(
                'text-[11px] font-bold leading-none uppercase tracking-wide',
                adminPlanBadge.expired
                  ? 'text-rose-600 dark:text-rose-400'
                  : adminPlanBadge.planType === 'paid'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-sky-700 dark:text-sky-400',
              )}
            >
              {adminPlanBadge.planType === 'paid' ? 'Paid account' : 'Free account'}
            </span>
            <span
              className={cn(
                'text-[11px] font-semibold leading-none mt-1.5 tabular-nums',
                adminPlanBadge.expired
                  ? 'text-rose-500 dark:text-rose-400'
                  : 'text-slate-700 dark:text-slate-200',
              )}
            >
              {adminPlanBadge.remaining
                ? adminPlanBadge.expired
                  ? 'Expired'
                  : `${adminPlanBadge.remaining.days}d ${adminPlanBadge.remaining.hours}h ${adminPlanBadge.remaining.minutes}m`
                : 'No expiry date'}
            </span>
            {adminPlanBadge.expiryLabel && !adminPlanBadge.expired && (
              <span className="text-[10px] font-medium leading-none mt-1 text-slate-500 dark:text-slate-400">
                Ends {adminPlanBadge.expiryLabel}
              </span>
            )}
          </div>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="btn-ghost p-2 rounded-xl"
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Notifications */}
        <div ref={notifRef} className="relative">
          <button
            onClick={() => setShowNotifications(v => !v)}
            className="btn-ghost p-2 rounded-xl relative"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <AnimatePresence>
            {showNotifications && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-80 card shadow-xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</p>
                    <p className="text-xs text-slate-500">{unreadCount} unread</p>
                  </div>
                  <button onClick={markAllRead} className="text-xs text-primary-500 hover:text-primary-600 font-medium">
                    Mark all read
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
                  {notifications.slice(0, 8).map(n => (
                    <div
                      key={n.id}
                      onClick={() => markRead(n.id)}
                      className={cn(
                        'flex gap-3 px-4 py-3 cursor-pointer transition-colors',
                        n.read
                          ? 'hover:bg-slate-50 dark:hover:bg-slate-800'
                          : 'bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/30'
                      )}
                    >
                      <span className="text-base flex-shrink-0 mt-0.5">
                        {notifIconMap[n.type] ?? '🔔'}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white leading-tight">
                          {n.title}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5 leading-tight line-clamp-2">
                          {n.message}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-1">{timeAgo(n.createdAt)}</p>
                      </div>
                      {!n.read && (
                        <div className="flex-shrink-0 w-2 h-2 rounded-full bg-primary-500 mt-1.5" />
                      )}
                    </div>
                  ))}
                  {notifications.length === 0 && (
                    <div className="py-8 text-center text-sm text-slate-400">
                      No notifications
                    </div>
                  )}
                </div>
                <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-700">
                  <button
                    onClick={() => { navigate('/notifications'); setShowNotifications(false); }}
                    className="text-xs text-primary-500 hover:text-primary-600 font-medium w-full text-center"
                  >
                    View all notifications →
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* User menu */}
        <div ref={userRef} className="relative">
          <button
            onClick={() => setShowUserMenu(v => !v)}
            className="flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <div className="w-7 h-7 rounded-full overflow-hidden bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center flex-shrink-0">
              {user?.avatar ? (
                <img src={user.avatar} alt={user?.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-[11px] font-bold text-primary-600">
                  {getInitials(user?.name ?? '?')}
                </span>
              )}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-semibold text-slate-900 dark:text-white leading-none">{user?.name}</p>
              <p className="text-[10px] text-slate-500 leading-none mt-0.5">{roleLabels[user?.role ?? '']}</p>
            </div>
            <ChevronDown size={14} className="text-slate-400 hidden sm:block" />
          </button>

          <AnimatePresence>
            {showUserMenu && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-48 card shadow-xl overflow-hidden py-1"
              >
                {[
                  { label: 'My Profile', path: '/profile' },
                  { label: 'Settings', path: '/settings' },
                ].map(item => (
                  <button
                    key={item.path}
                    onClick={() => { navigate(item.path); setShowUserMenu(false); }}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
                <div className="border-t border-slate-100 dark:border-slate-700 my-1" />
                <button
                  onClick={() => { logout(); navigate('/login'); }}
                  className="w-full text-left px-4 py-2 text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                >
                  Logout
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
