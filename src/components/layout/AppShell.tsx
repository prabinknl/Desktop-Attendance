import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from './Sidebar';
import Header from './Header';
import ToastContainer from '../ui/ToastContainer';
import { useDateSettings } from '../../contexts/DateSettingsContext';
import { hydratePersistedStores } from '../../data/store';
import { deviceApi } from '../../api/deviceApi';
import { fetchLogsWithCache } from '../../lib/deviceLogsCache';
import { importAttendanceFromDeviceLogs } from '../../lib/deviceAttendanceSync';

export default function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { formatKey } = useDateSettings();
  const location = useLocation();

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

      {/* Toast Notifications */}
      <div className="no-print">
        <ToastContainer />
      </div>
    </div>
  );
}
