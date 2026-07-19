import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Clock, MapPin, User, Calendar, CheckCircle, XCircle, BadgeCheck } from 'lucide-react';
import type { Attendance, Employee, Department, Shift, LeaveRequest, LeaveStatus } from '../../types';
import {
  calcWorkingHours,
  calcLateMinutes,
  calcOvertime,
  cn,
  formatDate,
  leaveStatusLabel,
  leaveTypeLabel,
  todayStr,
} from '../../lib/utils';
import CalendarDateInput from '../ui/CalendarDateInput';
import { useDateSettings } from '../../contexts/DateSettingsContext';
import { AttendanceAPI, LeaveAPI } from '../../data/store';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';

const schema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  departmentId: z.string().min(1, 'Department is required'),
  date: z.string().min(1, 'Date is required'),
  shiftId: z.string().min(1, 'Shift is required'),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  breakMinutes: z.coerce.number().min(0).default(60),
  status: z.enum([
    'present',
    'absent',
    'late',
    'half_day',
    'holiday',
    'work_from_home',
    'on_leave',
    'field_work',
    'meeting',
    'personal_work',
  ]),
  location: z.string().optional(),
  remarks: z.string().optional(),
}).refine(data => {
  if (data.checkIn && data.checkOut) {
    const [hi, mi] = data.checkIn.split(':').map(Number);
    const [ho, mo] = data.checkOut.split(':').map(Number);
    return ho * 60 + mo > hi * 60 + mi;
  }
  return true;
}, { message: 'Check-out must be after check-in', path: ['checkOut'] });

type FormData = z.infer<typeof schema>;

interface Props {
  record: Attendance | null;
  employees: Employee[];
  departments: Department[];
  shifts: Shift[];
  /** When >1, Update applies the same fields to every selected day. */
  bulkCount?: number;
  onSave: (data: Partial<Attendance>) => Promise<void>;
  onClose: () => void;
}

export default function AttendanceFormModal({
  record,
  employees,
  departments,
  shifts,
  bulkCount = 1,
  onSave,
  onClose,
}: Props) {
  const { settings: dateSettings } = useDateSettings();
  const { user } = useAuth();
  const { toast } = useNotifications();
  const calendar = dateSettings.calendarSystem;
  const isEditing = Boolean(record);
  const applyBulk = isEditing && bulkCount > 1;
  const [matchingLeaves, setMatchingLeaves] = useState<LeaveRequest[]>([]);
  const [leaveActionId, setLeaveActionId] = useState<string | null>(null);

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: {
      employeeId: record?.employeeId ?? '',
      departmentId: record?.departmentId ?? '',
      date: record?.date ?? todayStr(),
      shiftId: record?.shiftId ?? shifts[0]?.id ?? '',
      checkIn: record?.checkIn ?? '',
      checkOut: record?.checkOut ?? '',
      breakMinutes: record?.breakMinutes ?? 60,
      status: record?.status ?? 'present',
      location: record?.location ?? '',
      remarks:
        record?.remarks && !record.remarks.startsWith('source=')
          ? record.remarks
          : '',
    },
  });

  const watchEmployee = watch('employeeId');
  const watchDate = watch('date');
  const watchCheckIn = watch('checkIn');
  const watchCheckOut = watch('checkOut');
  const watchBreak = watch('breakMinutes');
  const watchShift = watch('shiftId');

  const selectedEmployee = useMemo(
    () =>
      employees.find(
        (employee) =>
          employee.id === watchEmployee || employee.employeeId === watchEmployee,
      ),
    [employees, watchEmployee],
  );

  useEffect(() => {
    let active = true;
    void LeaveAPI.getAll().then((requests) => {
      if (!active) return;
      const aliases = new Set(
        [
          watchEmployee,
          selectedEmployee?.id,
          selectedEmployee?.employeeId,
        ].filter((value): value is string => Boolean(value)),
      );
      setMatchingLeaves(
        requests
          .filter((leave) => aliases.has(leave.employeeId))
          .sort((a, b) => {
            if (a.status === 'pending' && b.status !== 'pending') return -1;
            if (a.status !== 'pending' && b.status === 'pending') return 1;
            return b.createdAt.localeCompare(a.createdAt);
          }),
      );
    });
    return () => {
      active = false;
    };
  }, [watchEmployee, watchDate, selectedEmployee]);

  // Auto-fill department when employee changes
  useEffect(() => {
    const emp = employees.find(e => e.id === watchEmployee);
    if (emp) {
      setValue('departmentId', emp.departmentId);
      setValue('shiftId', emp.shiftId);
    }
  }, [watchEmployee, employees, setValue]);

  const selectedShift = shifts.find(s => s.id === watchShift);
  const workingHours = calcWorkingHours(watchCheckIn, watchCheckOut, watchBreak);
  const lateMinutes = calcLateMinutes(watchCheckIn, selectedShift?.startTime, selectedShift?.graceMinutes);
  const overtime = calcOvertime(workingHours, selectedShift?.workingHours);

  const onSubmit = async (data: FormData) => {
    await onSave({
      ...data,
      workingHours,
      lateMinutes,
      overtime,
      manualOverride: true,
      createdBy: 'u1',
    });
  };

  const handleLeaveDecision = async (
    leave: LeaveRequest,
    status: Extract<LeaveStatus, 'approved' | 'conditional_approved' | 'rejected'>,
  ) => {
    setLeaveActionId(leave.id);
    try {
      const updated = await LeaveAPI.updateStatus(
        leave.id,
        status,
        user?.id,
        status === 'approved'
          ? 'Approved from attendance — OT/LT hidden'
          : status === 'conditional_approved'
            ? 'Conditionally approved from attendance — OT/LT still shown'
            : 'Rejected from attendance',
      );

      if (status === 'approved') {
        const employee =
          selectedEmployee ??
          employees.find(
            (item) => item.id === leave.employeeId || item.employeeId === leave.employeeId,
          );
        const aliases = new Set(
          [leave.employeeId, employee?.id, employee?.employeeId].filter(
            (value): value is string => Boolean(value),
          ),
        );
        const attendance = await AttendanceAPI.getAll();
        const cursor = new Date(`${leave.fromDate}T12:00:00`);
        const end = new Date(`${leave.toDate}T12:00:00`);

        while (cursor <= end) {
          const date = cursor.toISOString().slice(0, 10);
          const existing = attendance.find(
            (item) => aliases.has(item.employeeId) && item.date === date,
          );
          const remarks = `Approved ${leaveTypeLabel[leave.leaveType]} leave`;

          if (existing) {
            await AttendanceAPI.update(existing.id, {
              status: 'on_leave',
              checkIn: undefined,
              checkOut: undefined,
              workingHours: 0,
              overtime: 0,
              lateMinutes: 0,
              location: '',
              remarks,
              manualOverride: true,
            });
          } else if (employee) {
            await AttendanceAPI.create({
              employeeId: employee.id,
              departmentId: employee.departmentId,
              shiftId: employee.shiftId,
              date,
              checkIn: undefined,
              checkOut: undefined,
              breakMinutes: 0,
              workingHours: 0,
              overtime: 0,
              lateMinutes: 0,
              status: 'on_leave',
              location: '',
              remarks,
              manualOverride: true,
              createdBy: user?.id ?? 'u1',
            });
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      }

      setMatchingLeaves((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      toast(
        'success',
        status === 'approved'
          ? 'Leave Approved'
          : status === 'conditional_approved'
            ? 'Leave Conditionally Approved'
            : 'Leave Rejected',
        status === 'approved'
          ? 'Attendance marked On Leave; OT/LT (+/−) hidden for those days.'
          : status === 'conditional_approved'
            ? 'OT/LT (+/−) remains visible on attendance for those days.'
            : 'The employee leave request was rejected.',
      );
    } catch (error) {
      toast(
        'error',
        'Leave Update Failed',
        error instanceof Error ? error.message : 'Could not update leave request.',
      );
    } finally {
      setLeaveActionId(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="card w-full max-w-2xl max-h-[min(90vh,720px)] shadow-2xl flex flex-col my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {record ? 'Edit Attendance' : 'Add Attendance'}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {applyBulk
                ? `Update will apply to ${bulkCount} selected days`
                : record
                  ? 'Update the attendance record'
                  : 'Enter attendance details for an employee'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost p-2 rounded-xl">
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="p-6 space-y-5 overflow-y-auto overscroll-contain flex-1 min-h-0"
        >
          {applyBulk && (
            <div className="rounded-xl border border-primary-200 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-800 px-4 py-3 text-sm text-primary-800 dark:text-primary-200">
              Status, location, times, and remarks will be saved on all{' '}
              <strong>{bulkCount}</strong> checked days. Each day keeps its own date.
            </div>
          )}

          {/* Employee & Date row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                <User size={13} className="inline mr-1" /> Employee *
              </label>
              <select {...register('employeeId')} className={cn('input', errors.employeeId && 'border-rose-400')}>
                <option value="">Select employee</option>
                {employees.filter(e => e.status === 'active').map(e => (
                  <option key={e.id} value={e.id}>{e.firstName} {e.lastName} ({e.employeeId})</option>
                ))}
              </select>
              {errors.employeeId && <p className="text-xs text-rose-500 mt-1">{errors.employeeId.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                <Calendar size={13} className="inline mr-1" /> Date * ({calendar === 'bs' ? 'BS' : 'AD'})
              </label>
              <CalendarDateInput
                value={watchDate}
                calendar={calendar}
                onChange={(ad) => setValue('date', ad, { shouldValidate: true })}
                className={
                  calendar === 'ad'
                    ? cn('input w-full', errors.date && 'border-rose-400')
                    : 'w-full flex-wrap'
                }
              />
              {errors.date && <p className="text-xs text-rose-500 mt-1">{errors.date.message}</p>}
            </div>
          </div>

          {/* Leave requests submitted by the selected employee */}
          <div className="space-y-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Employee Leave Request
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Requests submitted by this employee. Pending requests can be approved or rejected here.
                </p>
              </div>
              {matchingLeaves.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-4 text-sm text-slate-500">
                  No leave request has been submitted by this employee.
                </div>
              )}
              {matchingLeaves.map((leave) => (
                <div
                  key={leave.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {leaveTypeLabel[leave.leaveType]} Leave
                        </p>
                        <span className={`badge-${leave.status}`}>
                          {leaveStatusLabel[leave.status]}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {formatDate(leave.fromDate)} – {formatDate(leave.toDate)}
                        {' · '}
                        {leave.totalDays} day{leave.totalDays === 1 ? '' : 's'}
                      </p>
                      <p className="text-sm text-slate-700 dark:text-slate-300 mt-2">
                        {leave.reason}
                      </p>
                    </div>

                    {leave.status === 'pending' && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={leaveActionId === leave.id}
                          onClick={() => void handleLeaveDecision(leave, 'rejected')}
                          className="btn-secondary text-rose-600 border-rose-200 hover:bg-rose-50"
                        >
                          <XCircle size={15} /> Reject
                        </button>
                        <button
                          type="button"
                          disabled={leaveActionId === leave.id}
                          onClick={() => void handleLeaveDecision(leave, 'conditional_approved')}
                          className="btn-secondary text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                        >
                          <BadgeCheck size={15} /> Conditional
                        </button>
                        <button
                          type="button"
                          disabled={leaveActionId === leave.id}
                          onClick={() => void handleLeaveDecision(leave, 'approved')}
                          className="btn-primary bg-emerald-600 hover:bg-emerald-700"
                        >
                          <CheckCircle size={15} /> Approve
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </div>

          {/* Department & Shift */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Department *</label>
              <select {...register('departmentId')} className={cn('input', errors.departmentId && 'border-rose-400')}>
                <option value="">Select department</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              {errors.departmentId && <p className="text-xs text-rose-500 mt-1">{errors.departmentId.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Shift *</label>
              <select {...register('shiftId')} className={cn('input', errors.shiftId && 'border-rose-400')}>
                <option value="">Select shift</option>
                {shifts.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>
                ))}
              </select>
              {errors.shiftId && <p className="text-xs text-rose-500 mt-1">{errors.shiftId.message}</p>}
            </div>
          </div>

          {/* Check-in / Check-out / Break */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                <Clock size={13} className="inline mr-1" /> Check In
              </label>
              <input type="time" {...register('checkIn')} className="input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                <Clock size={13} className="inline mr-1" /> Check Out
              </label>
              <input type="time" {...register('checkOut')} className={cn('input', errors.checkOut && 'border-rose-400')} />
              {errors.checkOut && <p className="text-xs text-rose-500 mt-1">{errors.checkOut.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Break (min)</label>
              <input type="number" {...register('breakMinutes')} min={0} className="input" />
            </div>
          </div>

          {/* Auto-calculated fields */}
          {(watchCheckIn || watchCheckOut) && (
            <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60">
              <div className="text-center">
                <p className="text-xs text-slate-500 mb-1">Working Hours</p>
                <p className="text-lg font-bold text-primary-600 dark:text-primary-400">{workingHours}h</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-slate-500 mb-1">Late Minutes</p>
                <p className={cn('text-lg font-bold', lateMinutes > 0 ? 'text-amber-500' : 'text-emerald-500')}>
                  {lateMinutes}m
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-slate-500 mb-1">Overtime</p>
                <p className={cn('text-lg font-bold', overtime > 0 ? 'text-violet-500' : 'text-slate-400')}>
                  {overtime}h
                </p>
              </div>
            </div>
          )}

          {/* Status & Location */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Status *</label>
              <select {...register('status')} className={cn('input', errors.status && 'border-rose-400')}>
                <option value="present">Present</option>
                <option value="absent">Absent</option>
                <option value="late">Late</option>
                <option value="half_day">Half Day</option>
                <option value="holiday">Holiday</option>
                <option value="work_from_home">Work From Home</option>
                <option value="on_leave">On Leave</option>
                <option value="field_work">Field Work</option>
                <option value="meeting">Meeting</option>
                <option value="personal_work">Personal Work</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                <MapPin size={13} className="inline mr-1" /> Location
              </label>
              <input {...register('location')} placeholder="e.g. Office - HQ" className="input" />
            </div>
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Remarks</label>
            <textarea {...register('remarks')} rows={2} placeholder="Optional notes..." className="input resize-none" />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 sticky bottom-0 bg-white dark:bg-slate-900 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="btn-primary">
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving...
                </span>
              ) : applyBulk ? `Update ${bulkCount} days` : record ? 'Update' : 'Add to List'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
