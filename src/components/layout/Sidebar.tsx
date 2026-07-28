import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Clock, Users, Building2, CalendarOff,
  AlarmClock, BarChart3, Bell, Settings, User, LogOut,
  ChevronLeft, ChevronRight, Cpu,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { useDeviceSyncAvailable } from '../../hooks/useDeviceSyncAvailable';
import { cn, getInitials } from '../../lib/utils';

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  badge?: number;
}

const staffNavItems: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Attendance', icon: Clock, path: '/attendance' },
  { label: 'Employees', icon: Users, path: '/employees' },
  { label: 'Departments', icon: Building2, path: '/departments' },
  { label: 'Leave', icon: CalendarOff, path: '/leave' },
  { label: 'Shifts', icon: AlarmClock, path: '/shifts' },
  { label: 'Reports', icon: BarChart3, path: '/reports' },
  { label: 'Notifications', icon: Bell, path: '/notifications' },
];

const accountantNavItems: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Attendance', icon: Clock, path: '/attendance' },
  { label: 'Employees', icon: Users, path: '/employees' },
  { label: 'Leave', icon: CalendarOff, path: '/leave' },
];

const accountantBottomItems: NavItem[] = [
  { label: 'Device Settings', icon: Cpu, path: '/device-settings' },
  { label: 'Profile', icon: User, path: '/profile' },
];

const employeeNavItems: NavItem[] = [
  { label: 'Attendance Report', icon: BarChart3, path: '/dashboard' },
  { label: 'Leave', icon: CalendarOff, path: '/leave' },
  { label: 'Notifications', icon: Bell, path: '/notifications' },
];

const staffBottomItems: NavItem[] = [
  { label: 'Device Settings', icon: Cpu, path: '/device-settings' },
  { label: 'Settings', icon: Settings, path: '/settings' },
  { label: 'Profile', icon: User, path: '/profile' },
];

const employeeBottomItems: NavItem[] = [
  { label: 'Profile', icon: User, path: '/profile' },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { user, logout, hasRole } = useAuth();
  const { unreadCount } = useNotifications();
  const navigate = useNavigate();
  const { available: deviceSyncAvailable, loading: deviceProbeLoading } = useDeviceSyncAvailable();
  const isEmployee = hasRole('employee');
  const isAdmin = hasRole('admin');
  const isAccountant = hasRole('account') || user?.role === 'account';
  const navItems = isEmployee ? employeeNavItems : isAccountant ? accountantNavItems : staffNavItems;
  const allBottomItems = isEmployee ? employeeBottomItems : isAccountant ? accountantBottomItems : staffBottomItems;

  // Admins and Accountants always see Device Settings regardless of the /health probe.
  // Other staff see it only when the probe confirms deviceSyncEnabled.
  // While the probe is still loading, keep Device Settings visible to
  // prevent the flash-then-hide that the user reported.
  const showDeviceSettings = isAdmin || isAccountant || deviceProbeLoading || deviceSyncAvailable;
  const bottomItems = showDeviceSettings
    ? allBottomItems
    : allBottomItems.filter((item) => item.path !== '/device-settings');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const roleColors: Record<string, string> = {
    admin: 'bg-rose-500',
    hr: 'bg-violet-500',
    account: 'bg-sky-500',
    dept_manager: 'bg-amber-500',
    employee: 'bg-emerald-500',
  };

  const roleLabels: Record<string, string> = {
    admin: 'Administrator',
    hr: 'HR Manager',
    account: 'Accountant',
    dept_manager: 'Dept. Manager',
    employee: 'Employee',
  };

  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 260 }}
      transition={{ duration: 0.25, ease: 'easeInOut' }}
      className="h-screen fixed left-0 top-0 z-40 flex flex-col
                 bg-white dark:bg-slate-900
                 border-r border-slate-200 dark:border-slate-800
                 overflow-hidden select-none"
    >
      {/* ── Logo ─────────────────────────────────── */}
      <div className="flex items-center h-16 px-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2 overflow-hidden min-w-0 flex-1">
          {collapsed ? (
            <img
              src="/images/logo-emblem.png"
              alt="PACE"
              className="flex-shrink-0 w-9 h-9 object-contain"
            />
          ) : (
            <img
              src="/images/logo-with-name.png"
              alt="PACE Consultant (P.) Ltd."
              className="h-10 w-auto max-w-[160px] object-contain object-left"
            />
          )}
        </div>

        {/* Toggle button */}
        <button
          onClick={onToggle}
          className={cn(
            'ml-auto flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center',
            'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300',
            'hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors'
          )}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* ── Navigation ──────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {navItems.map(item => {
          const badge = item.label === 'Notifications' ? unreadCount : undefined;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn('sidebar-item', isActive && 'active', collapsed && 'justify-center px-2')
              }
            >
              <item.icon size={18} className="flex-shrink-0" />
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex-1 whitespace-nowrap"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
              {!collapsed && badge ? (
                <span className="ml-auto flex-shrink-0 w-5 h-5 rounded-full bg-primary-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {badge > 9 ? '9+' : badge}
                </span>
              ) : null}
              {collapsed && badge ? (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary-500" />
              ) : null}
            </NavLink>
          );
        })}
      </nav>

      {/* ── Bottom items ─────────────────────────── */}
      <div className="px-3 pb-2 space-y-1 border-t border-slate-200 dark:border-slate-800 pt-2">
        {bottomItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              cn('sidebar-item', isActive && 'active', collapsed && 'justify-center px-2')
            }
          >
            <item.icon size={18} className="flex-shrink-0" />
            <AnimatePresence>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 whitespace-nowrap"
                >
                  {item.label}
                </motion.span>
              )}
            </AnimatePresence>
          </NavLink>
        ))}

        {/* Logout */}
        <button
          onClick={handleLogout}
          title={collapsed ? 'Logout' : undefined}
          className={cn(
            'sidebar-item w-full text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600',
            collapsed && 'justify-center px-2'
          )}
        >
          <LogOut size={18} className="flex-shrink-0" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 whitespace-nowrap"
              >
                Logout
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>

      {/* ── User info ────────────────────────────── */}
      <div className={cn(
        'flex items-center gap-3 p-3 mx-3 mb-3 rounded-xl',
        'bg-slate-50 dark:bg-slate-800',
        collapsed && 'justify-center'
      )}>
        <div className="flex-shrink-0 relative">
          <div className="w-8 h-8 rounded-full overflow-hidden bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
            {user?.avatar ? (
              <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs font-bold text-primary-600">
                {getInitials(user?.name ?? '?')}
              </span>
            )}
          </div>
          <span className={cn(
            'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-800',
            roleColors[user?.role ?? 'employee']
          )} />
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="overflow-hidden min-w-0"
            >
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate leading-none">
                {user?.name}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-none">
                {roleLabels[user?.role ?? 'employee']}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}
