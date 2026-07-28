import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus, Search, CheckCircle, XCircle, Clock, X, Ban, Trash2,
  Filter, CalendarDays, Timer, Undo2, User as UserIcon,
} from 'lucide-react';
import { AttendanceAPI, EmployeeAPI, PunchTimeRequestAPI, ShiftAPI } from '../../data/store';
import type { Attendance, Employee, PunchRequestStatus, PunchTimeRequest, Shift } from '../../types';
import {
  calcLateMinutes,
  calcOvertime,
  calcWorkingHours,
  cn,
  formatDate,
  formatTime,
  punchRequestKindLabel,
  punchRequestStatusLabel,
  todayStr,
} from '../../lib/utils';
import { useNotifications } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import ConfirmDialog from '../ui/ConfirmDialog';
import CalendarDateInput from '../ui/CalendarDateInput';

const schema = z.object({
  employeeId: z.string().min(1, 'Employee required'),
  date: z.string().min(1, 'Date required'),
  requestedCheckIn: z.string().optional(),
  requestedCheckOut: z.string().optional(),
  reason: z.string().min(5, 'Reason required (min 5 chars)'),
}).refine(
  (d) => Boolean(d.requestedCheckIn?.trim() || d.requestedCheckOut?.trim()),
  { message: 'Enter at least a check-in or check-out time', path: ['requestedCheckIn'] },
);

type FormData = z.infer<typeof schema>;

const statusConfig: Record<PunchRequestStatus, { className: string; icon: React.ElementType }> = {
  pending: { className: 'badge-pending', icon: Clock },
  approved: { className: 'badge-approved', icon: CheckCircle },
  rejected: { className: 'badge-rejected', icon: XCircle },
  cancelled: { className: 'badge-cancelled', icon: XCircle },
};

function normalizeHm(t?: string): string | undefined {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : undefined;
}

function effectivePunch(record?: Attendance | null) {
  return {
    in: normalizeHm(record?.manualCheckIn || record?.checkIn),
    out: normalizeHm(record?.manualCheckOut || record?.checkOut),
  };
}

async function applyPunchToAttendance(
  req: PunchTimeRequest,
  emp: Employee,
  shift: Shift | undefined,
  approvedByName: string,
  approvedById: string,
) {
  const requestedIn = normalizeHm(req.requestedCheckIn);
  const requestedOut = normalizeHm(req.requestedCheckOut);
  const changeIn = Boolean(requestedIn);
  const changeOut = Boolean(requestedOut);
  if (!changeIn && !changeOut) {
    throw new Error('Request has no check-in or check-out time to apply.');
  }

  const nowIso = new Date().toISOString();
  const existing = req.attendanceId
    ? (await AttendanceAPI.getAll()).find((r) => r.id === req.attendanceId) ?? null
    : (await AttendanceAPI.getByEmployee(emp.id)).find((r) => r.date === req.date)
      ?? (await AttendanceAPI.getByEmployee(emp.employeeId)).find((r) => r.date === req.date)
      ?? null;

  const prev = effectivePunch(existing);
  // Keep existing punch on the side that was not requested.
  const effectiveIn = changeIn ? requestedIn : prev.in;
  const effectiveOut = changeOut ? requestedOut : prev.out;
  const breakMinutes = existing?.breakMinutes ?? shift?.breakMinutes ?? 60;
  const workingHours = calcWorkingHours(effectiveIn, effectiveOut, breakMinutes);
  const lateMinutes = calcLateMinutes(effectiveIn, shift?.startTime, shift?.graceMinutes);
  const overtime = calcOvertime(workingHours, shift?.workingHours);

  if (existing) {
    const patch: Partial<Attendance> = {
      breakMinutes,
      workingHours,
      lateMinutes,
      overtime,
      status: existing.status && existing.status !== 'absent' ? existing.status : 'present',
      remarks: [existing.remarks, `Punch ${req.kind} approved: ${req.reason}`].filter(Boolean).join(' | '),
      manualOverride: true,
      updatedBy: approvedById,
    };

    // Only touch the side(s) explicitly requested — leave the other punch untouched.
    if (changeIn) {
      patch.manualCheckIn = requestedIn;
      patch.checkInEdited = true;
      patch.checkInEditedBy = approvedByName;
      patch.checkInEditedAt = nowIso;
      if (!existing.checkIn) patch.checkIn = requestedIn;
    }
    if (changeOut) {
      patch.manualCheckOut = requestedOut;
      patch.checkOutEdited = true;
      patch.checkOutEditedBy = approvedByName;
      patch.checkOutEditedAt = nowIso;
      if (!existing.checkOut) patch.checkOut = requestedOut;
    }

    await AttendanceAPI.update(existing.id, patch);
    return;
  }

  await AttendanceAPI.create({
    employeeId: emp.id,
    departmentId: emp.departmentId,
    date: req.date,
    shiftId: emp.shiftId,
    checkIn: changeIn ? requestedIn : undefined,
    checkOut: changeOut ? requestedOut : undefined,
    manualCheckIn: changeIn ? requestedIn : undefined,
    manualCheckOut: changeOut ? requestedOut : undefined,
    checkInEdited: changeIn,
    checkOutEdited: changeOut,
    checkInEditedBy: changeIn ? approvedByName : undefined,
    checkOutEditedBy: changeOut ? approvedByName : undefined,
    checkInEditedAt: changeIn ? nowIso : undefined,
    checkOutEditedAt: changeOut ? nowIso : undefined,
    breakMinutes,
    workingHours,
    lateMinutes,
    overtime,
    status: 'present',
    location: '',
    remarks: `Punch add approved: ${req.reason}`,
    manualOverride: true,
    createdBy: approvedById,
  });
}

/**
 * Revert the attendance record to its original machine punch times
 * when an approved punch request is cancelled.
 * Clears manualCheckIn/manualCheckOut and edit flags for the sides
 * that were changed by the punch request, then recalculates
 * workingHours, lateMinutes, and overtime from the original times.
 */
async function revertPunchFromAttendance(
  req: PunchTimeRequest,
  emp: Employee,
  shift: Shift | undefined,
) {
  const changedIn = Boolean(normalizeHm(req.requestedCheckIn));
  const changedOut = Boolean(normalizeHm(req.requestedCheckOut));
  if (!changedIn && !changedOut) return;

  const existing = req.attendanceId
    ? (await AttendanceAPI.getAll()).find((r) => r.id === req.attendanceId) ?? null
    : (await AttendanceAPI.getByEmployee(emp.id)).find((r) => r.date === req.date)
      ?? (await AttendanceAPI.getByEmployee(emp.employeeId)).find((r) => r.date === req.date)
      ?? null;

  if (!existing) return;

  const patch: Partial<Attendance> = {
    manualOverride: false,
    updatedAt: new Date().toISOString(),
  };

  // Clear manual overrides for the sides that this request changed
  if (changedIn) {
    patch.manualCheckIn = undefined;
    patch.checkInEdited = false;
    patch.checkInEditedBy = undefined;
    patch.checkInEditedAt = undefined;
  }
  if (changedOut) {
    patch.manualCheckOut = undefined;
    patch.checkOutEdited = false;
    patch.checkOutEditedBy = undefined;
    patch.checkOutEditedAt = undefined;
  }

  // Determine effective times after revert: use original machine times for
  // the reverted sides, keep any remaining manual overrides on unchanged sides.
  const effectiveIn = changedIn
    ? existing.checkIn                                     // revert to machine time
    : normalizeHm(existing.manualCheckIn || existing.checkIn);  // keep as-is
  const effectiveOut = changedOut
    ? existing.checkOut
    : normalizeHm(existing.manualCheckOut || existing.checkOut);

  // If the other side still has a manual override, keep manualOverride = true
  if (
    (!changedIn && existing.manualCheckIn) ||
    (!changedOut && existing.manualCheckOut)
  ) {
    patch.manualOverride = true;
  }

  const breakMinutes = existing.breakMinutes ?? shift?.breakMinutes ?? 60;
  patch.workingHours = calcWorkingHours(effectiveIn, effectiveOut, breakMinutes);
  patch.lateMinutes = calcLateMinutes(effectiveIn, shift?.startTime, shift?.graceMinutes);
  patch.overtime = calcOvertime(patch.workingHours, shift?.workingHours);
  patch.remarks = [
    (existing.remarks ?? '').replace(/\s*\|?\s*Punch (?:add|edit) approved:.*$/i, ''),
    'Punch override cancelled — reverted to machine time',
  ].filter(Boolean).join(' | ');

  await AttendanceAPI.update(existing.id, patch);
}

export default function PunchRequestPanel() {
  const { user, can, hasRole } = useAuth();
  const { toast, addNotification } = useNotifications();
  const [requests, setRequests] = useState<PunchTimeRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<PunchRequestStatus | ''>('');
  const [search, setSearch] = useState('');
  const [approveId, setApproveId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelApprovedId, setCancelApprovedId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting }, reset } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const watchEmployeeId = watch('employeeId');
  const watchDate = watch('date');

  useEffect(() => {
    (async () => {
      const [r, e, s] = await Promise.all([
        PunchTimeRequestAPI.getAll(),
        EmployeeAPI.getAll(),
        ShiftAPI.getAll(),
      ]);
      setRequests(r);
      setEmployees(e);
      setShifts(s);
      setLoading(false);
    })();
  }, []);

  const empMap = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
  const shiftMap = useMemo(() => Object.fromEntries(shifts.map((s) => [s.id, s])), [shifts]);

  const currentEmployee = useMemo(() => {
    if (!user) return null;
    return employees.find(e =>
      (user.employeeId && (e.id === user.employeeId || e.employeeId === user.employeeId)) ||
      (user.email && e.email && e.email.toLowerCase() === user.email.toLowerCase()) ||
      (user.id && (e.id === user.id || e.employeeId === user.id))
    ) ?? null;
  }, [user, employees]);

  const currentEmpAliases = useMemo(() => {
    const set = new Set<string>();
    if (user?.employeeId) set.add(user.employeeId);
    if (user?.id) set.add(user.id);
    if (currentEmployee?.id) set.add(currentEmployee.id);
    if (currentEmployee?.employeeId) set.add(currentEmployee.employeeId);
    return set;
  }, [user, currentEmployee]);

  const isOwnRecord = useCallback((recordEmpId: string) => {
    if (!recordEmpId) return false;
    if (currentEmpAliases.has(recordEmpId)) return true;
    const recEmp = empMap[recordEmpId];
    if (recEmp && (currentEmpAliases.has(recEmp.id) || currentEmpAliases.has(recEmp.employeeId))) {
      return true;
    }
    return false;
  }, [currentEmpAliases, empMap]);

  const isEmployee = user?.role === 'employee' || (!can('leave:approve') && !hasRole('admin', 'hr', 'dept_manager'));

  const userScopedRequests = useMemo(() => {
    if (isEmployee) {
      return requests.filter(r => isOwnRecord(r.employeeId));
    }
    return requests;
  }, [requests, isEmployee, isOwnRecord]);

  const [dayRecord, setDayRecord] = useState<Attendance | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const targetEmpId = isEmployee
        ? (currentEmployee?.id || user?.employeeId || watchEmployeeId)
        : watchEmployeeId;

      if (!targetEmpId || !watchDate) {
        setDayRecord(null);
        return;
      }
      const emp = empMap[targetEmpId] || currentEmployee;
      if (!emp) {
        setDayRecord(null);
        return;
      }
      const rows = await AttendanceAPI.getByEmployee(emp.id);
      const match = rows.find((r) => r.date === watchDate)
        ?? (await AttendanceAPI.getByEmployee(emp.employeeId)).find((r) => r.date === watchDate)
        ?? null;
      if (!cancelled) setDayRecord(match);
    })();
    return () => { cancelled = true; };
  }, [watchEmployeeId, watchDate, empMap, isEmployee, currentEmployee, user]);

  const filtered = useMemo(() => userScopedRequests.filter((r) => {
    const emp = empMap[r.employeeId];
    const q = search.trim().toLowerCase();
    const matchSearch = !q || (emp && (
      `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(q)
      || (emp.employeeId || '').toLowerCase().includes(q)
    ));
    const matchStatus = !statusFilter || r.status === statusFilter;
    return matchSearch && matchStatus;
  }), [userScopedRequests, empMap, search, statusFilter]);

  const statusSummary = useMemo(() => ({
    pending: userScopedRequests.filter((r) => r.status === 'pending').length,
    approved: userScopedRequests.filter((r) => r.status === 'approved').length,
    rejected: userScopedRequests.filter((r) => r.status === 'rejected').length,
    cancelled: userScopedRequests.filter((r) => r.status === 'cancelled').length,
  }), [userScopedRequests]);

  const openForm = () => {
    const today = todayStr();
    const defaultEmp = isEmployee
      ? (currentEmployee?.id || user?.employeeId || '')
      : '';
    reset({
      employeeId: defaultEmp,
      date: today,
      requestedCheckIn: '',
      requestedCheckOut: '',
      reason: '',
    });
    if (defaultEmp) {
      setValue('employeeId', defaultEmp, { shouldValidate: true });
    }
    setShowForm(true);
  };

  const onSubmit = async (data: FormData) => {
    const targetEmpId = isEmployee
      ? (currentEmployee?.id || user?.employeeId || data.employeeId)
      : data.employeeId;

    const emp = empMap[targetEmpId] || currentEmployee;
    if (!emp) {
      toast('error', 'Employee not found', 'Select a valid employee.');
      return;
    }

    const nextIn = normalizeHm(data.requestedCheckIn);
    const nextOut = normalizeHm(data.requestedCheckOut);
    const prev = effectivePunch(dayRecord);
    const kind = dayRecord ? 'edit' : 'add';

    const req = await PunchTimeRequestAPI.create({
      employeeId: emp.id,
      attendanceId: dayRecord?.id,
      date: data.date,
      kind,
      requestedCheckIn: nextIn,
      requestedCheckOut: nextOut,
      previousCheckIn: prev.in,
      previousCheckOut: prev.out,
      reason: data.reason.trim(),
      status: 'pending',
    });

    setRequests((list) => [req, ...list]);
    addNotification({
      type: 'punch_request',
      title: 'Punch Time Request',
      message: `${emp.firstName} ${emp.lastName} requested to ${kind} punch on ${formatDate(data.date)}.`,
      read: false,
      userId: user?.id ?? 'u1',
      relatedId: req.id,
    });
    toast('success', 'Punch Request Submitted', 'Waiting for manager approval.');
    setShowForm(false);
  };

  const handleApprove = async () => {
    if (!approveId) return;
    const req = requests.find((r) => r.id === approveId);
    if (!req) {
      setApproveId(null);
      return;
    }
    const emp = empMap[req.employeeId];
    if (!emp) {
      toast('error', 'Employee missing', 'Cannot apply punch without employee.');
      setApproveId(null);
      return;
    }

    try {
      await applyPunchToAttendance(
        req,
        emp,
        shiftMap[emp.shiftId],
        user?.name || user?.email || 'Admin',
        user?.id ?? 'u1',
      );
      const updated = await PunchTimeRequestAPI.updateStatus(
        req.id,
        'approved',
        user?.id,
        'Punch times applied to attendance',
      );
      setRequests((list) => list.map((r) => (r.id === req.id ? updated : r)));
      addNotification({
        type: 'punch_approved',
        title: 'Punch Request Approved',
        message: `Your punch ${req.kind} for ${formatDate(req.date)} was approved.`,
        read: false,
        userId: emp.id,
        relatedId: req.id,
      });
      toast('success', 'Punch Approved', 'Times were applied to attendance.');
    } catch (err) {
      toast('error', 'Approve failed', err instanceof Error ? err.message : 'Could not approve request.');
    } finally {
      setApproveId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectId) return;
    try {
      const updated = await PunchTimeRequestAPI.updateStatus(rejectId, 'rejected', user?.id, 'Rejected by manager');
      setRequests((list) => list.map((r) => (r.id === rejectId ? updated : r)));
      toast('success', 'Punch Rejected');
    } catch (err) {
      toast('error', 'Reject failed', err instanceof Error ? err.message : 'Could not reject request.');
    } finally {
      setRejectId(null);
    }
  };

  const handleCancel = async () => {
    if (!cancelId) return;
    try {
      const updated = await PunchTimeRequestAPI.updateStatus(cancelId, 'cancelled', user?.id, 'Cancelled by user');
      setRequests((list) => list.map((r) => (r.id === cancelId ? updated : r)));
      toast('success', 'Request Cancelled');
    } catch (err) {
      toast('error', 'Cancel failed', err instanceof Error ? err.message : 'Could not cancel request.');
    } finally {
      setCancelId(null);
    }
  };

  const handleCancelApproved = async () => {
    if (!cancelApprovedId) return;
    const req = requests.find((r) => r.id === cancelApprovedId);
    if (!req) {
      setCancelApprovedId(null);
      return;
    }
    const emp = empMap[req.employeeId];
    if (!emp) {
      toast('error', 'Employee missing', 'Cannot revert punch without employee.');
      setCancelApprovedId(null);
      return;
    }
    try {
      // Revert attendance to original machine times
      await revertPunchFromAttendance(req, emp, shiftMap[emp.shiftId]);
      // Mark the punch request as cancelled
      const updated = await PunchTimeRequestAPI.updateStatus(
        req.id,
        'cancelled',
        user?.id,
        'Approved punch cancelled — attendance reverted to original machine time',
      );
      setRequests((list) => list.map((r) => (r.id === req.id ? updated : r)));
      addNotification({
        type: 'punch_request',
        title: 'Punch Override Cancelled',
        message: `Punch ${req.kind} for ${formatDate(req.date)} was cancelled. Attendance reverted to machine time.`,
        read: false,
        userId: emp.id,
        relatedId: req.id,
      });
      toast('success', 'Punch Override Cancelled', 'Attendance reverted to original machine time.');
    } catch (err) {
      toast('error', 'Cancel failed', err instanceof Error ? err.message : 'Could not cancel approved punch.');
    } finally {
      setCancelApprovedId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await PunchTimeRequestAPI.delete(deleteId);
      setRequests((list) => list.filter((r) => r.id !== deleteId));
      toast('success', 'Request Deleted');
    } catch (err) {
      toast('error', 'Delete failed', err instanceof Error ? err.message : 'Could not delete request.');
    } finally {
      setDeleteId(null);
    }
  };

  const isAccountant = user?.role === 'account';
  const canDecide = (can('leave:approve') || hasRole('admin', 'hr', 'dept_manager')) && !isAccountant;
  const dayPrev = effectivePunch(dayRecord);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Punch Time Requests</h2>
          <p className="text-sm text-slate-500 mt-0.5">{userScopedRequests.length} total request{userScopedRequests.length !== 1 ? 's' : ''}</p>
        </div>
        {!isAccountant && (
          <button type="button" onClick={openForm} className="btn-primary">
            <Plus size={16} /> Request Punch
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Pending', value: statusSummary.pending, color: 'bg-amber-500' },
          { label: 'Approved', value: statusSummary.approved, color: 'bg-emerald-500' },
          { label: 'Rejected', value: statusSummary.rejected, color: 'bg-rose-500' },
          { label: 'Cancelled', value: statusSummary.cancelled, color: 'bg-slate-500' },
        ].map((s) => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-bold text-lg', s.color)}>
              {s.value}
            </div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="card p-4 flex flex-wrap gap-3">
        {isEmployee ? (
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <UserIcon size={14} className="text-primary-500 flex-shrink-0" />
            <span>Requests for: {currentEmployee ? `${currentEmployee.firstName} ${currentEmployee.lastName}` : user?.name || 'My Account'}</span>
          </div>
        ) : (
          <div className="relative flex-1 min-w-56 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee..."
              className="input pl-9 py-2"
            />
          </div>
        )}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as PunchRequestStatus | '')}
          className="input py-2 w-auto min-w-32"
        >
          <option value="">All Status</option>
          {(['pending', 'approved', 'rejected', 'cancelled'] as PunchRequestStatus[]).map((s) => (
            <option key={s} value={s}>{punchRequestStatusLabel[s]}</option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {['Employee', 'Date', 'Type', 'Requested', 'Current', 'Reason', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 8 }).map((_, j) => <td key={j} className="py-3 px-4"><div className="skeleton h-4 rounded" /></td>)}</tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <Filter size={32} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No punch requests found</p>
                  </td>
                </tr>
              ) : filtered.map((req) => {
                const emp = empMap[req.employeeId];
                const cfg = statusConfig[req.status];
                const StatusIcon = cfg.icon;
                return (
                  <tr key={req.id} className="table-row-hover">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <img src={emp?.avatar} alt="" className="w-8 h-8 rounded-full" />
                        <span className="font-medium text-slate-900 dark:text-white">
                          {emp ? `${emp.firstName} ${emp.lastName}` : '—'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(req.date)}</td>
                    <td className="py-3 px-4">
                      <span className="text-xs font-medium px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        {punchRequestKindLabel[req.kind]}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Timer size={12} className="text-slate-400" />
                        {formatTime(req.requestedCheckIn) || '—'} → {formatTime(req.requestedCheckOut) || '—'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                      {formatTime(req.previousCheckIn) || '—'} → {formatTime(req.previousCheckOut) || '—'}
                    </td>
                    <td className="py-3 px-4 max-w-48">
                      <p className="text-slate-500 truncate">{req.reason}</p>
                    </td>
                    <td className="py-3 px-4">
                      <span className={cn('badge flex items-center gap-1', cfg.className)}>
                        <StatusIcon size={10} />
                        {punchRequestStatusLabel[req.status]}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {isAccountant ? (
                        <span className="text-slate-400 text-xs">—</span>
                      ) : (
                        <div className="flex gap-1 items-center flex-wrap">
                          {req.status === 'pending' && (
                            <>
                              {canDecide && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setApproveId(req.id)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30 transition-colors"
                                  >
                                    <CheckCircle size={13} /> Approve
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRejectId(req.id)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30 transition-colors"
                                  >
                                    <XCircle size={13} /> Reject
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                onClick={() => setCancelId(req.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                              >
                                <Ban size={13} /> Cancel
                              </button>
                            </>
                          )}
                          {req.status === 'approved' && canDecide && (
                            <button
                              type="button"
                              onClick={() => setCancelApprovedId(req.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/30 transition-colors"
                              title="Cancel approved punch and revert to machine time"
                            >
                              <Undo2 size={13} /> Cancel
                            </button>
                          )}
                          {(req.status === 'cancelled' || req.status === 'rejected') && (
                            <button
                              type="button"
                              onClick={() => setDeleteId(req.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30 transition-colors"
                            >
                              <Trash2 size={13} /> Delete
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && setShowForm(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="card w-full max-w-lg shadow-2xl"
            >
              <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Request Punch Time</h2>
                <button type="button" onClick={() => setShowForm(false)} className="btn-ghost p-2 rounded-xl"><X size={18} /></button>
              </div>
              <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Employee *</label>
                  {isEmployee ? (
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                      <img
                        src={currentEmployee?.avatar || user?.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=user'}
                        alt=""
                        className="w-9 h-9 rounded-full bg-slate-200 object-cover flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                          {currentEmployee ? `${currentEmployee.firstName} ${currentEmployee.lastName}` : user?.name || 'Logged-in Employee'}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {currentEmployee?.employeeId || user?.employeeId || 'ID: Self'} {currentEmployee?.designation ? `· ${currentEmployee.designation}` : ''}
                        </p>
                      </div>
                      <input type="hidden" {...register('employeeId')} value={currentEmployee?.id || user?.employeeId || ''} />
                    </div>
                  ) : (
                    <select
                      {...register('employeeId')}
                      className={cn('input', errors.employeeId && 'border-rose-400')}
                    >
                      <option value="">Select employee</option>
                      {employees.filter((e) => e.status === 'active').map((e) => (
                        <option key={e.id} value={e.id}>{e.firstName} {e.lastName} ({e.employeeId})</option>
                      ))}
                    </select>
                  )}
                  {errors.employeeId && <p className="text-xs text-rose-500 mt-1">{errors.employeeId.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    <CalendarDays size={13} className="inline mr-1" /> Date * (BS)
                  </label>
                  <CalendarDateInput
                    value={watchDate || ''}
                    calendar="bs"
                    onChange={(ad) => setValue('date', ad, { shouldValidate: true })}
                    className="w-full flex-wrap"
                  />
                  {errors.date && <p className="text-xs text-rose-500 mt-1">{errors.date.message}</p>}
                </div>

                {dayRecord ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300">
                    Existing punches: {formatTime(dayPrev.in) || '—'} → {formatTime(dayPrev.out) || '—'}. This will submit an <strong>Edit Punch</strong> request.
                  </div>
                ) : watchEmployeeId && watchDate ? (
                  <div className="rounded-xl border border-sky-200 bg-sky-50 dark:bg-sky-900/20 dark:border-sky-800 p-3 text-sm text-sky-800 dark:text-sky-300">
                    No attendance for this date. This will submit an <strong>Add Punch</strong> request.
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Check In</label>
                    <input type="time" step="60" {...register('requestedCheckIn')} className="input" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Check Out</label>
                    <input type="time" step="60" {...register('requestedCheckOut')} className="input" />
                  </div>
                </div>
                {errors.requestedCheckIn && (
                  <p className="text-xs text-rose-500">{errors.requestedCheckIn.message}</p>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Reason *</label>
                  <textarea
                    {...register('reason')}
                    rows={3}
                    className={cn('input resize-none', errors.reason && 'border-rose-400')}
                    placeholder="Explain why punch time needs to be added or corrected..."
                  />
                  {errors.reason && <p className="text-xs text-rose-500 mt-1">{errors.reason.message}</p>}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
                  <button type="submit" disabled={isSubmitting} className="btn-primary">
                    {isSubmitting ? 'Submitting...' : 'Submit Request'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={!!approveId}
        title="Approve Punch Request"
        message="Apply only the requested check-in and/or check-out time. Existing punches on the other side will stay unchanged."
        confirmLabel="Approve & Apply"
        variant="info"
        onConfirm={handleApprove}
        onCancel={() => setApproveId(null)}
      />
      <ConfirmDialog
        open={!!rejectId}
        title="Reject Punch Request"
        message="Reject this punch time request?"
        confirmLabel="Reject"
        variant="warning"
        onConfirm={handleReject}
        onCancel={() => setRejectId(null)}
      />
      <ConfirmDialog
        open={!!cancelId}
        title="Cancel Punch Request"
        message="Cancel this pending punch request?"
        confirmLabel="Cancel Request"
        variant="warning"
        onConfirm={handleCancel}
        onCancel={() => setCancelId(null)}
      />
      <ConfirmDialog
        open={!!cancelApprovedId}
        title="Cancel Approved Punch"
        message="Cancel this approved punch override? The attendance record will revert to the original machine punch time."
        confirmLabel="Cancel & Revert"
        variant="danger"
        onConfirm={handleCancelApproved}
        onCancel={() => setCancelApprovedId(null)}
      />
      <ConfirmDialog
        open={!!deleteId}
        title="Delete Punch Request"
        message="Permanently delete this request? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
