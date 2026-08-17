import React, { useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus, Search, CheckCircle, XCircle, Clock, X, Paperclip,
  CalendarDays, Filter, BadgeCheck, Ban, Undo2, ChevronDown, User as UserIcon,
} from 'lucide-react';
import { LeaveAPI, EmployeeAPI, AttendanceAPI } from '../../data/store';
import type { LeaveRequest, Employee, LeaveType, LeaveStatus } from '../../types';
import { formatDate, leaveTypeLabel, leaveStatusLabel, calcTotalDays, cn, todayStr } from '../../lib/utils';
import { useNotifications } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import CalendarDateInput from '../../components/ui/CalendarDateInput';
import { calcHouseLeaveRemainingMap } from '../../lib/leaveBalance';

const schema = z.object({
  employeeId: z.string().min(1, 'Employee required'),
  leaveType: z.enum(['annual', 'sick', 'casual', 'maternity', 'paternity', 'unpaid', 'other']),
  fromDate: z.string().min(1, 'From date required'),
  toDate: z.string().min(1, 'To date required'),
  reason: z.string().min(5, 'Reason required (min 5 chars)'),
}).refine(d => d.toDate >= d.fromDate, { message: 'To date must be after from date', path: ['toDate'] });

type FormData = z.infer<typeof schema>;

const statusConfig: Record<LeaveStatus, { label: string; className: string; icon: React.ElementType }> = {
  pending:   { label: 'Pending',   className: 'badge-pending',  icon: Clock },
  approved:  { label: 'Approved',  className: 'badge-approved', icon: CheckCircle },
  conditional_approved: { label: 'Conditional Approved', className: 'badge-conditional_approved', icon: BadgeCheck },
  rejected:  { label: 'Rejected',  className: 'badge-rejected', icon: XCircle },
  cancelled: { label: 'Cancelled', className: 'badge-cancelled', icon: XCircle },
};

/** Keep leave attendance dates in local civil time; never shift via UTC ISO conversion. */
function localYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function LeavePage() {
  const { user, can, hasRole } = useAuth();
  const { toast, addNotification } = useNotifications();
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<LeaveType | ''>('');
  const [search, setSearch] = useState('');
  const [empMenuOpen, setEmpMenuOpen] = useState(false);
  const empMenuRef = useRef<HTMLDivElement>(null);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [conditionalApproveId, setConditionalApproveId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (empMenuRef.current && !empMenuRef.current.contains(e.target as Node)) {
        setEmpMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting }, reset } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { leaveType: 'annual' },
  });

  const watchFrom = watch('fromDate');
  const watchTo = watch('toDate');
  const totalDays = watchFrom && watchTo ? calcTotalDays(watchFrom, watchTo) : 0;

  useEffect(() => {
    (async () => {
      const [l, e] = await Promise.all([LeaveAPI.getAll(), EmployeeAPI.getAll()]);
      setLeaves(l); setEmployees(e);
      setLoading(false);
    })();
  }, []);

  const empMap = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e])), [employees]);

  const leaveRemainingByEmp = useMemo(
    () => calcHouseLeaveRemainingMap(employees, leaves),
    [employees, leaves],
  );

  const filtered = useMemo(() => leaves.filter(l => {
    if (user?.role === 'employee' && user.employeeId && l.employeeId !== user.employeeId) return false;
    const emp = empMap[l.employeeId];
    const q = search.trim().toLowerCase();
    const matchSearch = !q || (emp && (
      `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(q) ||
      (emp.employeeId || '').toLowerCase().includes(q) ||
      (emp.email || '').toLowerCase().includes(q) ||
      (emp.designation || '').toLowerCase().includes(q)
    ));
    const matchStatus = !statusFilter || l.status === statusFilter;
    const matchType = !typeFilter || l.leaveType === typeFilter;
    return matchSearch && matchStatus && matchType;
  }), [leaves, empMap, search, statusFilter, typeFilter, user]);

  const onSubmit = async (data: FormData) => {
    if (data.leaveType === 'casual' || data.leaveType === 'unpaid') {
      const emp = empMap[data.employeeId];
      const remaining = leaveRemainingByEmp[data.employeeId] ?? 0;
      if (totalDays > remaining) {
        toast(
          'error',
          'Not enough house leave',
          `${emp ? `${emp.firstName} ${emp.lastName}` : 'Employee'} has ${remaining} day(s) remaining this month (unused days carry over).`,
        );
        return;
      }
    }
    const req = await LeaveAPI.create({
      ...data,
      totalDays,
      status: 'pending',
    });
    setLeaves(l => [req, ...l]);
    addNotification({
      type: 'leave_request',
      title: 'Leave Request Submitted',
      message: `Your ${leaveTypeLabel[data.leaveType]} leave request has been submitted.`,
      read: false,
      userId: user?.id ?? 'u1',
    });
    toast('success', 'Leave Request Submitted', 'Your request is pending approval.');
    reset();
    setShowForm(false);
  };

  const handleApprove = async () => {
    if (!approveId) return;
    const updated = await LeaveAPI.updateStatus(approveId, 'approved', user?.id, 'Approved by manager');
    setLeaves(l => l.map(x => x.id === approveId ? updated : x));

    // Mark attendance as on_leave for those days
    const leave = leaves.find(l => l.id === approveId);
    if (leave) {
      const emp = empMap[leave.employeeId];
      if (emp) {
        const cur = new Date(`${leave.fromDate}T12:00:00`);
        const end = new Date(`${leave.toDate}T12:00:00`);
        while (cur <= end) {
          const date = localYmd(cur);
          await AttendanceAPI.create({
            employeeId: emp.id, departmentId: emp.departmentId, date,
            shiftId: emp.shiftId, checkIn: undefined, checkOut: undefined,
            breakMinutes: 0, workingHours: 0, overtime: 0, lateMinutes: 0,
            status: 'on_leave', location: '', remarks: `Leave approved: ${leave.leaveType}`,
            createdBy: user?.id ?? 'u1',
          });
          cur.setDate(cur.getDate() + 1);
        }
      }
    }

    addNotification({
      type: 'leave_approved',
      title: 'Leave Approved',
      message: 'Your leave request has been approved.',
      read: false,
      userId: leave?.employeeId ?? 'u1',
    });
    toast('success', 'Leave Approved');
    setApproveId(null);
  };

  const handleConditionalApprove = async () => {
    if (!conditionalApproveId) return;
    const leave = leaves.find(l => l.id === conditionalApproveId);
    const updated = await LeaveAPI.updateStatus(
      conditionalApproveId,
      'conditional_approved',
      user?.id,
      'Conditionally approved — attendance OT/LT still counted',
    );
    setLeaves(l => l.map(x => x.id === conditionalApproveId ? updated : x));

    if (leave) {
      const emp = empMap[leave.employeeId];
      if (emp) {
        const cur = new Date(`${leave.fromDate}T12:00:00`);
        const end = new Date(`${leave.toDate}T12:00:00`);
        while (cur <= end) {
          const date = localYmd(cur);
          await AttendanceAPI.create({
            employeeId: emp.id, departmentId: emp.departmentId, date,
            shiftId: emp.shiftId, checkIn: undefined, checkOut: undefined,
            breakMinutes: 0, workingHours: 0, overtime: 0, lateMinutes: 0,
            status: 'on_leave', location: '', remarks: 'Unpaid Leave',
            createdBy: user?.id ?? 'u1',
          });
          cur.setDate(cur.getDate() + 1);
        }
      }
    }

    addNotification({
      type: 'leave_approved',
      title: 'Leave Conditionally Approved',
      message: 'Your leave was conditionally approved. Working hours (+/−) remain visible on attendance for those days.',
      read: false,
      userId: leave?.employeeId ?? 'u1',
    });
    toast('success', 'Conditionally Approved', 'OT/LT (+/−) stays visible on attendance for those days.');
    setConditionalApproveId(null);
  };

  const handleReject = async () => {
    if (!rejectId) return;
    const updated = await LeaveAPI.updateStatus(rejectId, 'rejected', user?.id, 'Rejected by manager');
    setLeaves(l => l.map(x => x.id === rejectId ? updated : x));
    toast('success', 'Leave Rejected');
    setRejectId(null);
  };

  const handleCancel = async () => {
    if (!cancelId) return;
    const id = cancelId;
    try {
      const updated = await LeaveAPI.updateStatus(id, 'cancelled', user?.id, 'Cancelled by user');
      setLeaves(l => l.map(x => x.id === id ? updated : x));
      toast('success', 'Leave Cancelled', 'The leave request was cancelled.');
    } catch (err) {
      toast('error', 'Cancel failed', err instanceof Error ? err.message : 'Could not cancel leave.');
    } finally {
      setCancelId(null);
    }
  };

  /** Reset leave to Pending and restore Approve / Conditional / Reject / Cancel actions. */
  const revokeToPending = async (id: string) => {
    const leave = leaves.find(l => l.id === id);
    if (!leave) {
      toast('error', 'Leave not found', 'Could not find this leave request.');
      setRevokeId(null);
      return;
    }
    if (leave.status === 'pending') {
      setRevokeId(null);
      return;
    }

    const previousStatus = leave.status;
    try {
      const updated = await LeaveAPI.updateStatus(
        id,
        'pending',
        user?.id,
        `Revoked previous ${leaveStatusLabel[previousStatus] ?? previousStatus} decision — awaiting review`,
      );
      setLeaves(l => l.map(x => (x.id === id ? { ...updated, status: 'pending' } : x)));

      // Clear On Leave attendance rows created by a full approve (best-effort)
      if (previousStatus === 'approved' || previousStatus === 'conditional_approved') {
        try {
          const emp = empMap[leave.employeeId];
          const aliases = new Set(
            [leave.employeeId, emp?.id, emp?.employeeId].filter((v): v is string => Boolean(v)),
          );
          const allAtt = await AttendanceAPI.getAll();
          for (const row of allAtt) {
            if (
              aliases.has(row.employeeId) &&
              row.date >= leave.fromDate &&
              row.date <= leave.toDate &&
              row.status === 'on_leave' &&
              (row.remarks ?? '').toLowerCase().includes('leave')
            ) {
              await AttendanceAPI.delete(row.id);
            }
          }
        } catch {
          /* attendance cleanup is best-effort */
        }
      }

      toast('success', 'Leave Revoked', 'Status is Pending. Choose Approved, Conditional approved, Reject, or Cancel.');
    } catch (err) {
      toast('error', 'Revoke failed', err instanceof Error ? err.message : 'Could not revoke leave.');
    } finally {
      setRevokeId(null);
    }
  };

  const handleRevoke = () => {
    if (!revokeId) return;
    void revokeToPending(revokeId);
  };

  const statusSummary = useMemo(() => ({
    pending: leaves.filter(l => l.status === 'pending').length,
    approved: leaves.filter(l => l.status === 'approved').length,
    conditional: leaves.filter(l => l.status === 'conditional_approved').length,
    rejected: leaves.filter(l => l.status === 'rejected').length,
  }), [leaves]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Leave Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">{leaves.length} total requests</p>
        </div>
        <button
          onClick={() => {
            const today = todayStr();
            reset({ leaveType: 'annual', fromDate: today, toDate: today, employeeId: '', reason: '' });
            setShowForm(true);
          }}
          className="btn-primary"
        >
          <Plus size={16} /> New Request
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Pending', value: statusSummary.pending, color: 'bg-amber-500' },
          { label: 'Approved', value: statusSummary.approved, color: 'bg-emerald-500' },
          { label: 'Conditional', value: statusSummary.conditional, color: 'bg-indigo-500' },
          { label: 'Rejected', value: statusSummary.rejected, color: 'bg-rose-500' },
        ].map(s => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-bold text-lg', s.color)}>
              {s.value}
            </div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3">
        <div ref={empMenuRef} className="relative flex-1 min-w-56 max-w-xs">
          <div
            onClick={() => setEmpMenuOpen(v => !v)}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Search size={14} className="text-slate-400 flex-shrink-0" />
              <input
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  setEmpMenuOpen(true);
                }}
                onFocus={() => setEmpMenuOpen(true)}
                placeholder="Search or select employee..."
                className="bg-transparent text-sm outline-none flex-1 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 min-w-0"
              />
              {search && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearch('');
                  }}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
                >
                  ×
                </button>
              )}
            </div>
            <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
          </div>

          <AnimatePresence>
            {empMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="absolute left-0 right-0 top-full mt-1.5 z-40 card shadow-xl overflow-hidden max-h-72 flex flex-col"
              >
                <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Select Employee ({employees.length})
                  </span>
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="text-[11px] text-primary-500 font-medium hover:underline"
                    >
                      Clear selection
                    </button>
                  )}
                </div>

                <div className="overflow-y-auto max-h-60 divide-y divide-slate-100 dark:divide-slate-800/60 py-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setEmpMenuOpen(false);
                    }}
                    className={cn(
                      'w-full text-left px-3 py-2 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors',
                      !search ? 'text-primary-600 dark:text-primary-400 font-bold bg-primary-50/50 dark:bg-primary-900/20' : 'text-slate-600 dark:text-slate-300'
                    )}
                  >
                    All Employees
                  </button>

                  {employees
                    .filter(e => {
                      const q = search.trim().toLowerCase();
                      if (!q) return true;
                      const name = `${e.firstName} ${e.lastName}`.toLowerCase();
                      const code = (e.employeeId || '').toLowerCase();
                      return name.includes(q) || code.includes(q);
                    })
                    .map(emp => {
                      const fullName = `${emp.firstName} ${emp.lastName}`;
                      const isSelected = search.toLowerCase() === fullName.toLowerCase();
                      return (
                        <div
                          key={emp.id}
                          onClick={() => {
                            setSearch(fullName);
                            setEmpMenuOpen(false);
                          }}
                          className={cn(
                            'flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors',
                            isSelected && 'bg-primary-50 dark:bg-primary-900/30'
                          )}
                        >
                          <img
                            src={emp.avatar}
                            alt=""
                            className="w-7 h-7 rounded-full bg-slate-200 object-cover flex-shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className={cn('text-sm truncate', isSelected ? 'font-bold text-primary-600 dark:text-primary-400' : 'font-medium text-slate-800 dark:text-slate-200')}>
                              {fullName}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {emp.employeeId} {emp.designation ? `· ${emp.designation}` : ''}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="input py-2 w-auto min-w-32">
          <option value="">All Status</option>
          {(['pending', 'approved', 'conditional_approved', 'rejected', 'cancelled'] as LeaveStatus[]).map(s => (
            <option key={s} value={s}>{leaveStatusLabel[s]}</option>
          ))}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)} className="input py-2 w-auto min-w-32">
          <option value="">All Types</option>
          {Object.entries(leaveTypeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Leave Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {['Employee', 'Leave Type', 'From', 'To', 'Days', 'Reason', 'Status', 'Actions'].map(h => (
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
                <tr><td colSpan={8} className="py-12 text-center text-slate-400">
                  <Filter size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No leave requests found</p>
                </td></tr>
              ) : filtered.map(leave => {
                const emp = empMap[leave.employeeId];
                const cfg = statusConfig[leave.status] ?? statusConfig.pending;
                const { className: statusClass, icon: StatusIcon } = cfg;
                const canDecide = can('leave:approve') || hasRole('admin', 'hr', 'dept_manager');
                return (
                  <tr key={leave.id} className="table-row-hover">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <img src={emp?.avatar} alt="" className="w-8 h-8 rounded-full" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-slate-900 dark:text-white">
                              {emp ? `${emp.firstName} ${emp.lastName}` : '—'}
                            </span>
                            {emp && (
                              <span
                                className={cn(
                                  'inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold',
                                  (leaveRemainingByEmp[emp.id] ?? 0) > 0
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                    : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
                                )}
                                title="Remaining house leave days"
                              >
                                {leaveRemainingByEmp[emp.id] ?? 0}d leave
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-xs font-medium px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        {leaveTypeLabel[leave.leaveType]}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">{formatDate(leave.fromDate)}</td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">{formatDate(leave.toDate)}</td>
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">{leave.totalDays}d</td>
                    <td className="py-3 px-4 max-w-48">
                      <p className="text-slate-500 truncate">{leave.reason}</p>
                    </td>
                    <td className="py-3 px-4">
                      <span className={cn('badge flex items-center gap-1', statusClass)}>
                        <StatusIcon size={10} />
                        {leaveStatusLabel[leave.status] ?? leave.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-1 items-center flex-wrap">
                        {leave.status === 'pending' && (
                          <>
                            {canDecide && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setApproveId(leave.id)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30 transition-colors"
                                  title="Approve"
                                >
                                  <CheckCircle size={13} />
                                  Approved
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConditionalApproveId(leave.id)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30 transition-colors"
                                  title="Conditional Approve"
                                >
                                  <BadgeCheck size={13} />
                                  Conditional approved
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRejectId(leave.id)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30 transition-colors"
                                  title="Reject"
                                >
                                  <XCircle size={13} />
                                  Reject
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => setCancelId(leave.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                              title="Cancel request"
                            >
                              <Ban size={13} />
                              Cancel
                            </button>
                          </>
                        )}
                        {(leave.status === 'approved'
                          || leave.status === 'conditional_approved'
                          || leave.status === 'rejected'
                          || leave.status === 'cancelled') && (
                          <button
                            type="button"
                            onClick={() => setRevokeId(leave.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/30 transition-colors"
                            title="Reset to Pending"
                          >
                            <Undo2 size={13} />
                            Revoke
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Leave Form Modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={e => e.target === e.currentTarget && setShowForm(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              className="card w-full max-w-lg shadow-2xl"
            >
              <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">New Leave Request</h2>
                <button onClick={() => setShowForm(false)} className="btn-ghost p-2 rounded-xl"><X size={18} /></button>
              </div>
              <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Employee *</label>
                  <select {...register('employeeId')} className={cn('input', errors.employeeId && 'border-rose-400')}>
                    <option value="">Select employee</option>
                    {employees.filter(e => e.status === 'active').map(e => (
                      <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>
                    ))}
                  </select>
                  {errors.employeeId && <p className="text-xs text-rose-500 mt-1">{errors.employeeId.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Leave Type *</label>
                  <select {...register('leaveType')} className="input">
                    {Object.entries(leaveTypeLabel).map(([k, v]) => <option key={k} value={k}>{v} Leave</option>)}
                  </select>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      <CalendarDays size={13} className="inline mr-1" /> From Date * (BS)
                    </label>
                    <CalendarDateInput
                      value={watchFrom || ''}
                      calendar="bs"
                      onChange={(ad) => setValue('fromDate', ad, { shouldValidate: true })}
                      className="w-full flex-wrap"
                    />
                    {errors.fromDate && <p className="text-xs text-rose-500 mt-1">{errors.fromDate.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      <CalendarDays size={13} className="inline mr-1" /> To Date * (BS)
                    </label>
                    <CalendarDateInput
                      value={watchTo || ''}
                      calendar="bs"
                      onChange={(ad) => setValue('toDate', ad, { shouldValidate: true })}
                      className="w-full flex-wrap"
                    />
                    {errors.toDate && <p className="text-xs text-rose-500 mt-1">{errors.toDate.message}</p>}
                  </div>
                </div>
                {totalDays > 0 && (
                  <div className="p-3 rounded-xl bg-primary-50 dark:bg-primary-900/30 text-center">
                    <p className="text-sm font-semibold text-primary-600 dark:text-primary-400">
                      Total: {totalDays} working day{totalDays !== 1 ? 's' : ''}
                    </p>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Reason *</label>
                  <textarea {...register('reason')} rows={3} className={cn('input resize-none', errors.reason && 'border-rose-400')}
                    placeholder="Explain the reason for leave..." />
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
        open={!!conditionalApproveId}
        title="Conditional Approve"
        message="Conditionally approve this leave? Attendance punches stay, and OT/LT (+/− working hours) will still be shown for those days. Use full Approve to hide OT/LT."
        confirmLabel="Conditional Approve"
        variant="info"
        onConfirm={handleConditionalApprove}
        onCancel={() => setConditionalApproveId(null)}
      />
      <ConfirmDialog
        open={!!approveId}
        title="Approve Leave Request"
        message="Approve this leave request? Attendance will be marked On Leave, and OT/LT (+/−) will be hidden on attendance records for those days."
        confirmLabel="Approve"
        variant="info"
        onConfirm={handleApprove}
        onCancel={() => setApproveId(null)}
      />
      <ConfirmDialog
        open={!!rejectId}
        title="Reject Leave Request"
        message="Reject this leave request?"
        confirmLabel="Reject"
        variant="warning"
        onConfirm={handleReject}
        onCancel={() => setRejectId(null)}
      />
      <ConfirmDialog
        open={!!cancelId}
        title="Cancel Leave Request"
        message="Cancel this pending leave request? It will be marked as Cancelled."
        confirmLabel="Cancel Request"
        variant="warning"
        onConfirm={handleCancel}
        onCancel={() => setCancelId(null)}
      />
      <ConfirmDialog
        open={!!revokeId}
        title="Revoke Leave Decision"
        message="Revoke this decision? Status will become Pending and you will see Approved, Conditional approved, Reject, and Cancel again."
        confirmLabel="Revoke to Pending"
        variant="danger"
        onConfirm={handleRevoke}
        onCancel={() => setRevokeId(null)}
      />
    </div>
  );
}
