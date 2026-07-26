import type { Department, Shift, Employee, Attendance, LeaveRequest, Notification, Holiday, User, AuditLog } from '../types';

// ─── Users ────────────────────────────────────────────────────────────────────
/** Admin / employee accounts are created via Sign up on the login page.
 *  Seed HR/manager remain for staff demos. Admin email allowed for signup: appnep@pacenp.com */
export const mockUsers: User[] = [
  { id: 'u1', name: 'Admin Khan', email: 'appnep@pacenp.com', role: 'admin', password: 'admin123', phone: '+977-9800000000', timezone: 'Asia/Kathmandu', avatar: 'https://api.dicebear.com/9.x/avataaars/svg?seed=AdminKhan&top=shortFlat&facialHairProbability=100&facialHair=beardMedium' },
  { id: 'u2', name: 'Sara HR', email: 'hr@company.com', role: 'hr', password: 'hr123', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sara' },
  { id: 'u3', name: 'Rajan Manager', email: 'manager@company.com', role: 'dept_manager', password: 'mgr123', departmentId: 'd1', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=rajan' },
  { id: 'u4', name: 'Priya Employee', email: 'employee@company.com', role: 'employee', password: 'emp123', departmentId: 'd1', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=priya' },
];

// ─── Departments ──────────────────────────────────────────────────────────────
export const mockDepartments: Department[] = [
  { id: 'd0', name: 'Device Synced', code: 'DEV', managerId: '', description: 'Employees imported from the attendance machine', createdAt: '2023-01-01', updatedAt: '2024-01-01' },
  { id: 'd1', name: 'Engineering', code: 'ENG', managerId: '', description: 'Software development team', createdAt: '2023-01-01', updatedAt: '2024-01-01' },
  { id: 'd2', name: 'Human Resources', code: 'HR', managerId: '', description: 'People operations', createdAt: '2023-01-01', updatedAt: '2024-01-01' },
  { id: 'd3', name: 'Finance', code: 'FIN', managerId: '', description: 'Financial planning and accounting', createdAt: '2023-01-01', updatedAt: '2024-01-01' },
  { id: 'd4', name: 'Marketing', code: 'MKT', managerId: '', description: 'Brand and growth', createdAt: '2023-01-01', updatedAt: '2024-01-01' },
  { id: 'd5', name: 'Operations', code: 'OPS', managerId: '', description: 'Day-to-day operations', createdAt: '2023-01-01', updatedAt: '2024-01-01' },
  { id: 'd6', name: 'Design', code: 'DES', managerId: '', description: 'UX/UI design', createdAt: '2023-01-01', updatedAt: '2024-01-01' },
];

// ─── Shifts ───────────────────────────────────────────────────────────────────
export const mockShifts: Shift[] = [
  { id: 's1', name: 'Morning Shift', startTime: '09:00', endTime: '17:00', breakMinutes: 60, graceMinutes: 15, workingHours: 8, workingDays: [0,1,2,3,4,5], createdAt: '2023-01-01' },
  { id: 's2', name: 'Evening Shift', startTime: '14:00', endTime: '22:00', breakMinutes: 60, graceMinutes: 15, workingHours: 8, workingDays: [0,1,2,3,4,5], createdAt: '2023-01-01' },
  { id: 's3', name: 'Night Shift', startTime: '22:00', endTime: '06:00', breakMinutes: 30, graceMinutes: 10, workingHours: 7.5, workingDays: [0,1,2,3,4,5,6], createdAt: '2023-01-01' },
  { id: 's4', name: 'General Shift', startTime: '10:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 30, workingHours: 8, workingDays: [0,1,2,3,4,5], createdAt: '2023-01-01' },
];

// ─── Employees ────────────────────────────────────────────────────────────────
/** Start empty — names come from Hikvision device sync (UserInfo / attendance events). */
export const mockEmployees: Employee[] = [];

// ─── Attendance (last 30 days) ────────────────────────────────────────────────
/** Start empty — attendance is filled from device sync, not seeded demo data. */
export const mockAttendance: Attendance[] = [];

// ─── Leave Requests ───────────────────────────────────────────────────────────
export const mockLeaveRequests: LeaveRequest[] = [];

// ─── Holidays ─────────────────────────────────────────────────────────────────
export const mockHolidays: Holiday[] = [
  { id: 'h1', name: 'Dashain', date: '2026-10-13', type: 'public' },
  { id: 'h2', name: 'Tihar', date: '2026-10-30', type: 'public' },
  { id: 'h3', name: 'Nepal New Year', date: '2026-04-14', type: 'public' },
  { id: 'h4', name: 'Democracy Day', date: '2026-02-19', type: 'public' },
  { id: 'h5', name: 'Teej', date: '2026-08-25', type: 'optional' },
  { id: 'h6', name: 'Christmas', date: '2026-12-25', type: 'optional' },
  { id: 'h7', name: 'Eid al-Fitr', date: '2026-03-31', type: 'optional' },
  { id: 'h8', name: 'Buddha Jayanti', date: '2026-05-23', type: 'public' },
];

// ─── Notifications ────────────────────────────────────────────────────────────
export const mockNotifications: Notification[] = [
  { id: 'n1', type: 'attendance_saved', title: 'Welcome', message: 'Connect your attendance device and run Manual Sync to import real punches.', read: false, userId: 'u1', createdAt: new Date().toISOString() },
];

// ─── Audit Logs ───────────────────────────────────────────────────────────────
export const mockAuditLogs: AuditLog[] = [
  { id: 'al1', userId: 'u1', action: 'LOGIN', resource: 'auth', resourceId: 'u1', details: 'Successful login', ipAddress: '192.168.1.1', createdAt: new Date(Date.now() - 3600000).toISOString() },
];
