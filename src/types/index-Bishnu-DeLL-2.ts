// ─── Enums ───────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'account' | 'hr' | 'dept_manager' | 'employee' | 'owner';

export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'late'
  | 'half_day'
  | 'holiday'
  | 'work_from_home'
  | 'on_leave'
  | 'field_work'
  | 'meeting'
  | 'personal_work';

export type LeaveStatus = 'pending' | 'approved' | 'conditional_approved' | 'rejected' | 'cancelled';

export type LeaveType =
  | 'annual'
  | 'sick'
  | 'casual'
  | 'maternity'
  | 'paternity'
  | 'unpaid'
  | 'other';

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern';

export type EmployeeStatus = 'active' | 'inactive' | 'on_leave' | 'terminated';

export type PunchRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type PunchRequestKind = 'add' | 'edit';

export type NotificationType =
  | 'attendance_saved'
  | 'attendance_updated'
  | 'attendance_deleted'
  | 'late_arrival'
  | 'missing_checkout'
  | 'leave_request'
  | 'leave_approved'
  | 'leave_rejected'
  | 'punch_request'
  | 'punch_approved'
  | 'punch_rejected'
  | 'employee_added'
  | 'employee_updated'
  | 'report_generated';

// ─── Models ──────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  phone?: string;
  timezone?: string;
  employeeId?: string;
  departmentId?: string;
  password: string; // hashed in real app
  planType?: 'free' | 'paid';
  freeDays?: number;
  paidDays?: number;
  durationDays?: number;
  companyName?: string;
  appStatus?: 'running' | 'paused';
}

export interface Department {
  id: string;
  name: string;
  code: string;
  managerId: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Shift {
  id: string;
  name: string;
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  breakMinutes: number;
  graceMinutes: number;
  workingHours: number;
  workingDays: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  createdAt: string;
}

export interface Employee {
  id: string;
  employeeId: string; // e.g. "EMP-001"
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatar?: string;
  departmentId: string;
  shiftId: string;
  role: UserRole;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  joinDate: string;
  designation: string;
  leaveBalance: Record<LeaveType, number>;
  createdAt: string;
  updatedAt: string;
}

export interface Attendance {
  id: string;
  employeeId: string;
  date: string; // "YYYY-MM-DD"
  checkIn?: string; // "HH:mm:ss"
  checkOut?: string; // "HH:mm:ss"
  status: AttendanceStatus;
  workHours: number;
  overtimeHours: number;
  notes?: string;
  deviceSynced?: boolean;
  deviceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PunchRequest {
  id: string;
  employeeId: string;
  date: string;
  kind: PunchRequestKind;
  checkIn?: string;
  checkOut?: string;
  reason: string;
  status: PunchRequestStatus;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  appliedDate: string;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
}

export interface Holiday {
  id: string;
  name: string;
  date: string; // "YYYY-MM-DD"
  type: 'public' | 'optional' | 'restricted';
  description?: string;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  userId: string;
  createdAt: string;
  link?: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  action: string;
  details: string;
  timestamp: string;
  ip?: string;
}
