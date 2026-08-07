import React from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { DateSettingsProvider } from './contexts/DateSettingsContext';
import { InvitationProvider } from './contexts/InvitationContext';
import ProtectedRoute from './routes/ProtectedRoute';
import AppShell from './components/layout/AppShell';
import { isDesktopBuild } from './lib/appEnv';

/** The desktop bundle uses relative asset URLs — HashRouter keeps the path at
 *  "/" so deep links such as /invite/<token> still load their scripts.
 *  Hosted web builds keep BrowserRouter (pretty URLs + SPA rewrites). */
const AppRouter = isDesktopBuild ? HashRouter : BrowserRouter;

// Auth pages
import LoginPage from './pages/auth/LoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import InviteSignupPage from './pages/auth/InviteSignupPage';
import ClientAdminSignupPage from './pages/auth/ClientAdminSignupPage';

// App pages
import DashboardEntry from './pages/dashboard/DashboardEntry';
import AttendancePage from './pages/attendance/AttendancePage';
import EmployeesPage from './pages/employees/EmployeesPage';
import DepartmentsPage from './pages/departments/DepartmentsPage';
import LeavePage from './pages/leave/LeavePage';
import ShiftsPage from './pages/shifts/ShiftsPage';
import ReportsPage from './pages/reports/ReportsPage';
import NotificationsPage from './pages/notifications/NotificationsPage';
import SettingsPage from './pages/settings/SettingsPage';
import ProfilePage from './pages/profile/ProfilePage';
import DeviceSettingsPage from './pages/device-settings/DeviceSettingsPage';
import EmployeeAttendanceReportPage from './pages/dashboard/EmployeeAttendanceReportPage';
import { useDeviceSyncAvailable } from './hooks/useDeviceSyncAvailable';
import { useAuth } from './contexts/AuthContext';
import AutoUpdateNotifier from './components/common/AutoUpdateNotifier';

/** Admin users always see Device Settings. Non-admin staff are redirected to
 *  the dashboard only after the /health probe has definitively responded with
 *  deviceSyncEnabled: false. While the probe is loading, a spinner is shown
 *  to avoid the brief flash-then-redirect. */
function DeviceSettingsRoute() {
  const { available, loading } = useDeviceSyncAvailable();
  const { hasRole } = useAuth();
  const isAdminOrAccountant = hasRole('admin', 'account');

  // Admins and Accountants always get access — no probe gating
  if (isAdminOrAccountant) return <DeviceSettingsPage />;

  // While probe is loading, show a brief spinner instead of redirecting
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!available) return <Navigate to="/dashboard" replace />;
  return <DeviceSettingsPage />;
}

export default function App() {
  return (
    <ThemeProvider>
      <DateSettingsProvider>
        <AuthProvider>
          <NotificationProvider>
            <InvitationProvider>
              <AppRouter>
                <AutoUpdateNotifier />
                <Routes>
                  {/* Public routes */}
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                  <Route path="/invite/:token" element={<InviteSignupPage />} />
                  <Route path="/client-admin/signup" element={<ClientAdminSignupPage />} />

                  {/* Protected app routes */}
                  <Route element={<ProtectedRoute />}>
                    <Route element={<AppShell />}>
                      <Route index element={<Navigate to="/dashboard" replace />} />
                      <Route path="/dashboard" element={<DashboardEntry />} />
                      <Route path="/leave" element={<LeavePage />} />
                      <Route path="/notifications" element={<NotificationsPage />} />
                      <Route path="/profile" element={<ProfilePage />} />

                      {/* Accessible by admin, hr, account, dept_manager */}
                      <Route element={<ProtectedRoute allowedRoles={['admin', 'owner', 'hr', 'account', 'dept_manager']} />}>
                        <Route path="/attendance" element={<AttendancePage />} />
                        <Route path="/employees" element={<EmployeesPage />} />
                        <Route path="/employees/:employeeId/report" element={<EmployeeAttendanceReportPage />} />
                      </Route>

                      {/* Staff management routes - excluded for accountant */}
                      <Route element={<ProtectedRoute allowedRoles={['admin', 'owner', 'hr', 'dept_manager']} />}>
                        <Route path="/departments" element={<DepartmentsPage />} />
                        <Route path="/shifts" element={<ShiftsPage />} />
                        <Route path="/reports" element={<ReportsPage />} />
                      </Route>

                      {/* Device settings - admin, owner, hr & account */}
                      <Route element={<ProtectedRoute allowedRoles={['admin', 'owner', 'hr', 'account']} />}>
                        <Route path="/device-settings" element={<DeviceSettingsRoute />} />
                      </Route>

                      {/* App settings - admin, owner & hr only */}
                      <Route element={<ProtectedRoute allowedRoles={['admin', 'owner', 'hr']} />}>
                        <Route path="/settings" element={<SettingsPage />} />
                      </Route>

                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Route>
                  </Route>
                </Routes>
              </AppRouter>
            </InvitationProvider>
          </NotificationProvider>
        </AuthProvider>
      </DateSettingsProvider>
    </ThemeProvider>
  );
}
