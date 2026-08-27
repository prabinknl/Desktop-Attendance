import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Pause, ShieldCheck, LogOut, Eye, ArrowLeft } from 'lucide-react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useDateSettings } from '../../contexts/DateSettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { hydratePersistedStores } from '../../data/store';
import { deviceApi } from '../../api/deviceApi';
import { fetchLogsWithCache } from '../../lib/deviceLogsCache';
import { importAttendanceFromDeviceLogs } from '../../lib/deviceAttendanceSync';
import { deviceQueryKeys } from '../../hooks/useDeviceSettings';
import { cn } from '../../lib/utils';

export default function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { formatKey } = useDateSettings();
  const { user, logout, isImpersonating, exitImpersonation } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();

  // Restore saved employees + attendance after login / app reopen
  useEffect(() => {
    hydratePersistedStores();
    let cancelled = false;
    (async () => {
      try {
        const { logs } = await fetchLogsWithCache(() => deviceApi.getLogs());
        if (!cancelled && logs.length) {
          await importAttendanceFromDeviceLogs(logs);
        }
      } catch {
        /* offline — localStorage already hydrated */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Connect the saved attendance machine as soon as the signed-in app opens,
  // not only when the user visits Device Settings or clicks Sign in again.
  useEffect(() => {
    let cancelled = false;
    deviceApi.reconnect().then((result) => {
      if (cancelled) return;
      if (result.connected) {
        void queryClient.invalidateQueries({ queryKey: deviceQueryKeys.device });
        void queryClient.invalidateQueries({ queryKey: deviceQueryKeys.status });
      }
    });
    return () => { cancelled = true; };
  }, [queryClient]);

  // Show Account Disabled screen if logged-in account is soft-deleted (and not owner viewing)
  if (user && user.role !== 'owner' && user.status === 'deleted' && !isImpersonating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6 text-center text-white">
        <div className="max-w-md w-full rounded-3xl bg-slate-900/90 border border-rose-900/50 p-8 shadow-2xl backdrop-blur-xl space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <Pause size={32} className="fill-rose-400 text-rose-400" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-extrabold text-white tracking-tight">
              Account Disabled
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed font-medium">
              Your company account has been disabled. Please contact the application owner.
            </p>
          </div>

          <div className="rounded-2xl bg-slate-950/80 p-4 border border-slate-800 text-left text-xs space-y-1.5">
            <div className="flex items-center gap-2 text-emerald-400 font-bold">
              <ShieldCheck size={16} />
              <span>All Data Safely Preserved</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-normal">
              All company data, employee records, attendance history, and settings remain safely stored.
            </p>
          </div>

          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-700 transition-all"
          >
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    );
  }

  // Show Paused screen if logged-in account is in 'paused' state (and not owner)
  if (user && user.role !== 'owner' && user.appStatus === 'paused' && !isImpersonating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6 text-center text-white">
        <div className="max-w-md w-full rounded-3xl bg-slate-900/90 border border-slate-800 p-8 shadow-2xl backdrop-blur-xl space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Pause size={32} className="fill-amber-400 text-amber-400" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-extrabold text-white tracking-tight">
              App Access Paused
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Your organization account is currently set to <strong className="text-amber-400">Paused</strong> by the platform administrator.
            </p>
          </div>

          <div className="rounded-2xl bg-slate-950/80 p-4 border border-slate-800 text-left text-xs space-y-1.5">
            <div className="flex items-center gap-2 text-emerald-400 font-bold">
              <ShieldCheck size={16} />
              <span>All Data Safely Preserved</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-normal">
              All your company employees, attendance records, departments, and settings remain completely intact and saved. Access will resume immediately when the administrator sets status to <strong>Run App</strong>.
            </p>
          </div>

          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-700 transition-all"
          >
            <LogOut size={16} />
            <span>Sign Out & Return to Login</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block no-print">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(v => !v)}
        />
      </div>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden no-print"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed left-0 top-0 z-50 lg:hidden no-print"
            >
              <Sidebar collapsed={false} onToggle={() => setMobileMenuOpen(false)} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="no-print">
        <Header
          sidebarCollapsed={sidebarCollapsed}
          onMobileMenuToggle={() => setMobileMenuOpen(v => !v)}
        />
      </div>

      {/* Main content */}
      <motion.main
        animate={{
          marginLeft: sidebarCollapsed ? 72 : 260,
        }}
        transition={{ duration: 0.25, ease: 'easeInOut' }}
        className="hidden lg:block pt-16 min-h-screen print-main"
      >
        <div className="p-6 max-w-[1600px] mx-auto print-content">
          <motion.div
            key={`${location.pathname}-${formatKey}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Outlet />
          </motion.div>
        </div>
      </motion.main>

      {/* Mobile main — hidden when printing to avoid duplicate pages */}
      <main className="lg:hidden pt-16 min-h-screen print:hidden">
        <div className="p-4" key={formatKey}>
          <Outlet />
        </div>
      </main>

    </div>
  );
}
