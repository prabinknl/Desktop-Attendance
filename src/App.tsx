import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { DateSettingsProvider } from './contexts/DateSettingsContext';
import { InvitationProvider } from './contexts/InvitationContext';
import ProtectedRoute from './routes/ProtectedRoute';
import AppShell from './components/layout/AppShell';

// Auth pages
import LoginPage from './pages/auth/LoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import InviteSignupPage from './pages/auth/InviteSignupPage';

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

export default function App() {
  return (
    <ThemeProvider>
      <DateSettingsProvider>
        <AuthProvider>
          <NotificationProvider>
            <InvitationProvider>
              <BrowserRouter>
                <Routes>
                  {/* Public routes */}
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                  <Route path="/invite/:token" element={<InviteSignupPage />} />

                  {/* Protected app routes */}
                  <Route element={<ProtectedRoute />}>
                    <Route element={<AppShell />}>
                      <Route index element={<Navigate to="/dashboard" replace />} />
                      <Route path="/dashboard" element={<DashboardEntry />} />
                      <Route path="/leave" element={<LeavePage />} />
                      <Route path="/notifications" element={<NotificationsPage />} />
                      <Route path="/profile" element={<ProfilePage />} />

                      {/* Staff-only routes */}
                      <Route element={<ProtectedRoute allowedRoles={['admin', 'hr', 'dept_manager']} />}>
                        <Route path="/attendance" element={<AttendancePage />} />
                        <Route path="/employees" element={<EmployeesPage />} />
                        <Route path="/employees/:employeeId/report" element={<EmployeeAttendanceReportPage />} />
                        <Route path="/departments" element={<DepartmentsPage />} />
                        <Route path="/shifts" element={<ShiftsPage />} />
                        <Route path="/reports" element={<ReportsPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                        <Route path="/device-settings" element={<DeviceSettingsPage />} />
                      </Route>

                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Route>
                  </Route>
                </Routes>
              </BrowserRouter>
            </InvitationProvider>
          </NotificationProvider>
        </AuthProvider>
      </DateSettingsProvider>
    </ThemeProvider>
  );
}
