/**
 * Table definitions for the six entities that moved out of browser
 * localStorage into PostgreSQL. Each entry maps app-side camelCase fields to
 * their columns; see crudFactory for the shared query implementation.
 */
import { createCrudModel, nowIso } from './crudFactory.js';

export const DepartmentModel = createCrudModel({
  table: 'departments',
  orderBy: 'name ASC',
  touchUpdatedAt: true,
  columns: [
    { col: 'id', field: 'id' },
    { col: 'name', field: 'name', fallback: '' },
    { col: 'code', field: 'code', fallback: '' },
    { col: 'manager_id', field: 'managerId', fallback: '' },
    { col: 'description', field: 'description' },
    { col: 'created_at', field: 'createdAt', fallback: nowIso },
    { col: 'updated_at', field: 'updatedAt', fallback: nowIso },
  ],
});

export const ShiftModel = createCrudModel({
  table: 'shifts',
  orderBy: 'start_time ASC',
  columns: [
    { col: 'id', field: 'id' },
    { col: 'name', field: 'name', fallback: '' },
    { col: 'start_time', field: 'startTime', fallback: '09:00' },
    { col: 'end_time', field: 'endTime', fallback: '18:00' },
    { col: 'break_minutes', field: 'breakMinutes', number: true, fallback: 60 },
    { col: 'grace_minutes', field: 'graceMinutes', number: true, fallback: 15 },
    { col: 'working_hours', field: 'workingHours', number: true, fallback: 8 },
    { col: 'working_days', field: 'workingDays', json: true, fallback: [1, 2, 3, 4, 5] },
    { col: 'created_at', field: 'createdAt', fallback: nowIso },
  ],
});

export const HolidayModel = createCrudModel({
  table: 'holidays',
  orderBy: 'date ASC',
  columns: [
    { col: 'id', field: 'id' },
    { col: 'name', field: 'name', fallback: '' },
    { col: 'date', field: 'date', date: true },
    { col: 'type', field: 'type', fallback: 'public' },
    { col: 'source', field: 'source' },
  ],
});

export const EmployeeModel = createCrudModel({
  table: 'employees',
  orderBy: 'first_name ASC, last_name ASC',
  touchUpdatedAt: true,
  columns: [
    { col: 'id', field: 'id' },
    { col: 'employee_id', field: 'employeeId', fallback: '' },
    { col: 'first_name', field: 'firstName', fallback: '' },
    { col: 'last_name', field: 'lastName', fallback: '' },
    { col: 'email', field: 'email', fallback: '' },
    { col: 'phone', field: 'phone', fallback: '' },
    { col: 'department_id', field: 'departmentId', fallback: '' },
    { col: 'designation', field: 'designation', fallback: '' },
    { col: 'manager_id', field: 'managerId' },
    { col: 'joining_date', field: 'joiningDate', date: true },
    { col: 'employment_type', field: 'employmentType', fallback: 'full_time' },
    { col: 'status', field: 'status', fallback: 'active' },
    { col: 'shift_id', field: 'shiftId', fallback: 's1' },
    { col: 'address', field: 'address' },
    { col: 'emergency_contact', field: 'emergencyContact', json: true },
    { col: 'avatar', field: 'avatar' },
    { col: 'created_at', field: 'createdAt', fallback: nowIso },
    { col: 'updated_at', field: 'updatedAt', fallback: nowIso },
  ],
});

export const LeaveRequestModel = createCrudModel({
  table: 'leave_requests',
  orderBy: 'created_at DESC',
  touchUpdatedAt: true,
  columns: [
    { col: 'id', field: 'id' },
    { col: 'employee_id', field: 'employeeId', fallback: '' },
    { col: 'leave_type', field: 'leaveType', fallback: 'annual' },
    { col: 'from_date', field: 'fromDate', date: true },
    { col: 'to_date', field: 'toDate', date: true },
    { col: 'total_days', field: 'totalDays', number: true, fallback: 0 },
    { col: 'reason', field: 'reason', fallback: '' },
    { col: 'attachment_url', field: 'attachmentUrl' },
    { col: 'status', field: 'status', fallback: 'pending' },
    { col: 'comments', field: 'comments' },
    { col: 'approved_by', field: 'approvedBy' },
    { col: 'created_at', field: 'createdAt', fallback: nowIso },
    { col: 'updated_at', field: 'updatedAt', fallback: nowIso },
  ],
});

export const PunchRequestModel = createCrudModel({
  table: 'punch_time_requests',
  orderBy: 'created_at DESC',
  touchUpdatedAt: true,
  columns: [
    { col: 'id', field: 'id' },
    { col: 'employee_id', field: 'employeeId', fallback: '' },
    { col: 'attendance_id', field: 'attendanceId' },
    { col: 'date', field: 'date', date: true },
    { col: 'kind', field: 'kind', fallback: 'edit' },
    { col: 'requested_check_in', field: 'requestedCheckIn' },
    { col: 'requested_check_out', field: 'requestedCheckOut' },
    { col: 'previous_check_in', field: 'previousCheckIn' },
    { col: 'previous_check_out', field: 'previousCheckOut' },
    { col: 'reason', field: 'reason', fallback: '' },
    { col: 'status', field: 'status', fallback: 'pending' },
    { col: 'comments', field: 'comments' },
    { col: 'approved_by', field: 'approvedBy' },
    { col: 'created_at', field: 'createdAt', fallback: nowIso },
    { col: 'updated_at', field: 'updatedAt', fallback: nowIso },
  ],
});

export const coreModels = {
  departments: DepartmentModel,
  shifts: ShiftModel,
  holidays: HolidayModel,
  employees: EmployeeModel,
  leaves: LeaveRequestModel,
  'punch-requests': PunchRequestModel,
};

export type CoreResource = keyof typeof coreModels;

export function isCoreResource(value: string): value is CoreResource {
  return Object.prototype.hasOwnProperty.call(coreModels, value);
}
