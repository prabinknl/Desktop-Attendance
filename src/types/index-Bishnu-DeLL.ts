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
  endTime: string;   // "HH:mm"
  breakMinutes: number;
  graceMinutes: number;
  workingHours: number;
  workingDays: number[]; // 0=Sun, 1=Mon ... 6=Sat
  createdAt: string;
}

export interface Employee {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  departmentId: string;
  designation: string;
  managerId?: string;
  joiningDate: string;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  shiftId: string;
  address?: string;
  emergencyContact?: {
    name: string;
    phone: string;
    relation: string;
  };
  avatar?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Attendance {
  id: string;
  employeeId: string;
  departmentId: string;
  date: string; // "YYYY-MM-DD"
  shiftId: string;
  checkIn?: string;  // "HH:mm"
  checkOut?: string; // "HH:mm"
  manualCheckIn?: string;  // "HH:mm" - admin manual check in time override
  manualCheckOut?: string; // "HH:mm" - admin manual check out time override
  checkInEdited?: boolean;
  checkOutEdited?: boolean;
  checkInEditedBy?: string;
  checkOutEditedBy?: string;
  checkInEditedAt?: string;
  checkOutEditedAt?: string;
  breakMinutes: number;
  workingHours: number;
  overtime: number;
  lateMinutes: number;
  status: AttendanceStatus;
  location?: string;
  remarks?: string;
  /** When true, device sync must not overwrite this row. */
  manualOverride?: boolean;
  source?: string;
  createdBy: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveType: LeaveType;
  fromDate: string;
  toDate: string;
  totalDays: number;
  reason: string;
  attachmentUrl?: string;
  status: LeaveStatus;
  comments?: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** Pending add/edit of check-in / check-out until a manager approves. */
export interface PunchTimeRequest {
  id: string;
  employeeId: string;
  attendanceId?: string;
  date: string;
  kind: PunchRequestKind;
  requestedCheckIn?: string;
  requestedCheckOut?: string;
  previousCheckIn?: string;
  previousCheckOut?: string;
  reason: string;
  status: PunchRequestStatus;
  comments?: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  userId: string;
  relatedId?: string;
  createdAt: string;
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
  type: 'public' | 'optional' | 'restricted';
  source?: 'manual' | 'google' | 'hamro_patro';
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resource: string;
  resourceId: string;
  details?: string;
  ipAddress?: string;
  createdAt: string;
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export interface DashboardStats {
  totalEmployees: number;
  presentToday: number;
  absentToday: number;
  lateToday: number;
  onLeaveToday: number;
  attendancePercentage: number;
}

// ─── Report Types ─────────────────────────────────────────────────────────────

export interface ReportFilter {
  startDate: string;
  endDate: string;
  departmentId?: string;
  employeeId?: string;
  status?: AttendanceStatus;
}
