import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  getPaginationRowModel, flexRender, type ColumnDef, type SortingState, type RowSelectionState,
} from '@tanstack/react-table';
import {
  Plus, Search, Filter, Download, Printer, RefreshCw,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Edit2, Trash2, Copy, Save,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { AttendanceAPI, EmployeeAPI, DepartmentAPI, ShiftAPI, LeaveAPI, filterAttendance, hydratePersistedStores } from '../../data/store';
import type { Attendance, Employee, Department, Shift, AttendanceStatus, LeaveRequest } from '../../types';
import { attendanceStatusLabel, formatDate, formatTime, cn, calcDayHours, calcOtLtHours, formatHoursMinutes, formatOtLt, generateId, isApprovedLeaveDay } from '../../lib/utils';
import { useNotifications } from '../../contexts/NotificationContext';
import { useDateSettings } from '../../contexts/DateSettingsContext';
import { downloadAttendancePdf } from '../../lib/attendancePdf';
import AttendanceFormModal from '../../components/attendance/AttendanceFormModal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { deviceApi } from '../../api/deviceApi';
import { resolveEmployeeSchedule } from '../../lib/appSettings';
import { importAttendanceFromDeviceLogs } from '../../lib/deviceAttendanceSync';
import { fetchLogsWithCache } from '../../lib/deviceLogsCache';
import CalendarDateInput from '../../components/ui/CalendarDateInput';

const PAGE_SIZES = [10, 20, 50];

const statusOptions: { value: AttendanceStatus | ''; label: string }[] = [
  { value: '', label: 'All Status' },
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'late', label: 'Late' },
  { value: 'half_day', label: 'Half Day' },
  { value: 'holiday', label: 'Holiday' },
  { value: 'work_from_home', label: 'WFH' },
  { value: 'on_leave', label: 'On Leave' },
  { value: 'field_work', label: 'Field Work' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'personal_work', label: 'Personal Work' },
];

export default function AttendancePage() {
  const [searchParams] = useSearchParams();
  const { toast } = useNotifications();
  const { dateRange, updateDateRange, settings: dateSettings, updateSettings } = useDateSettings();
  const dateFrom = dateRange.from;
  const dateTo = dateRange.to;
  const calendar = dateSettings.calendarSystem;

  const [records, setRecords] = useState<Attendance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [deptFilter, setDeptFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<AttendanceStatus | ''>('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [empMenuOpen, setEmpMenuOpen] = useState(false);
  const [empSearch, setEmpSearch] = useState('');
  const empPickerRef = useRef<HTMLDivElement>(null);

  const [showForm, setShowForm] = useState(searchParams.get('action') === 'add');
  const [editRecord, setEditRecord] = useState<Attendance | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [draftRecords, setDraftRecords] = useState<Attendance[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      hydratePersistedStores();
      // Load saved attendance first (includes machine imports from localStorage)
      const [a0, e0, d0, s0, l0] = await Promise.all([
        AttendanceAPI.getAll(),
        EmployeeAPI.getAll(),
        DepartmentAPI.getAll(),
        ShiftAPI.getAll(),
        LeaveAPI.getAll(),
      ]);
      setRecords(a0);
      setEmployees(e0);
      setDepartments(d0);
      setShifts(s0);
      setLeaves(l0);
      setLoading(false);

      try {
        const manualRows = await AttendanceAPI.getManualOverrides();
        const { logs } = await fetchLogsWithCache(() => deviceApi.getLogs());
        if (logs.length) {
          await importAttendanceFromDeviceLogs(logs);
          await AttendanceAPI.restoreManualOverrides(manualRows);
          const [a, e] = await Promise.all([AttendanceAPI.getAll(), EmployeeAPI.getAll()]);
          setRecords(a);
          setEmployees(e);
        }
      } catch {
        // Device API may be offline — keep local attendance
      }
    })();
  }, []);

  useEffect(() => {
    if (!empMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (empPickerRef.current && !empPickerRef.current.contains(e.target as Node)) {
        setEmpMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [empMenuOpen]);

  const empMap = useMemo(() => {
    const map: Record<string, Employee> = {};
    for (const e of employees) {
      map[e.id] = e;
      map[e.employeeId] = e;
    }
    return map;
  }, [employees]);
  const deptMap = useMemo(() => Object.fromEntries(departments.map(d => [d.id, d])), [departments]);
  const shiftMap = useMemo(() => Object.fromEntries(shifts.map(s => [s.id, s])), [shifts]);

  const allRecords = useMemo(
    () => [...draftRecords, ...records],
    [draftRecords, records]
  );

  const filtered = useMemo(() =>
    filterAttendance(allRecords, {
      departmentId: deptFilter,
      employeeId: employeeFilter,
      dateFrom,
      dateTo,
      status: statusFilter,
      employees,
    }), [allRecords, deptFilter, employeeFilter, dateFrom, dateTo, statusFilter, employees]);

  const unsavedCount = draftRecords.length;

  const reloadFromDevice = async () => {
    setLoading(true);
    try {
      const { logs, fromCache } = await fetchLogsWithCache(() => deviceApi.getLogs());
      if (logs.length) {
        await importAttendanceFromDeviceLogs(logs);
      }
      const [a, e] = await Promise.all([AttendanceAPI.getAll(), EmployeeAPI.getAll()]);
      setRecords(a);
      setEmployees(e);
      toast(
        logs.length ? 'success' : 'info',
        logs.length ? 'Attendance refreshed' : 'No device records',
        logs.length
          ? fromCache
            ? `Restored ${logs.length} saved punch(es) from previous sync.`
            : `Loaded ${logs.length} punch(es) from the attendance machine.`
          : 'Run Manual Sync on Device Settings first.',
      );
    } catch (err) {
      toast('error', 'Refresh failed', err instanceof Error ? err.message : 'Could not load device logs');
    } finally {
      setLoading(false);
    }
  };

  const departmentEmployees = useMemo(() => {
    return employees
      .filter(e => (!deptFilter || e.departmentId === deptFilter) && e.status === 'active')
      .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
  }, [employees, deptFilter]);

  const visibleEmployees = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    if (!q) return departmentEmployees;
    return departmentEmployees.filter(e =>
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.employeeId.toLowerCase().includes(q)
    );
  }, [departmentEmployees, empSearch]);

  const selectedEmployee = empMap[employeeFilter];

  const getDayHours = (record: Attendance) => {
    const shift = shiftMap[record.shiftId];
    return resolveEmployeeSchedule(record.employeeId, shift, [], record.date).dayHours;
  };

  const getOtLt = (record: Attendance) => {
    const emp = empMap[record.employeeId];
    const aliases = [emp?.id, emp?.employeeId].filter((id): id is string => Boolean(id));
    if (isApprovedLeaveDay(leaves, record.employeeId, record.date, aliases)) {
      return 0;
    }
    const shift = shiftMap[record.shiftId];
    const schedule = resolveEmployeeSchedule(record.employeeId, shift, [], record.date);
    return calcOtLtHours({
      checkIn: record.checkIn,
      workingHours: record.workingHours,
      overtime: record.overtime,
      lateMinutes: record.lateMinutes,
      shiftStart: schedule.shiftStart,
      graceMinutes: schedule.graceMinutes,
      dayHours: schedule.dayHours,
    });
  };

  const otLtTotal = useMemo(
    () => Math.round(filtered.reduce((sum, r) => sum + getOtLt(r), 0) * 100) / 100,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, shiftMap, leaves, empMap]
  );

  const handleDeptChange = (deptId: string) => {
    setDeptFilter(deptId);
    setEmployeeFilter('');
    setEmpSearch('');
    setEmpMenuOpen(!!deptId);
  };

  const columns = useMemo<ColumnDef<Attendance>[]>(() => [
    {
      id: 'select',
      header: ({ table }) => (
        <input type="checkbox" className="accent-primary-600"
          checked={table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <input type="checkbox" className="accent-primary-600"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
        />
      ),
      size: 40,
    },
    {
      accessorKey: 'employeeId',
      header: 'Employee',
      cell: ({ row }) => {
        const emp = empMap[row.original.employeeId];
        const isDraft = row.original.id.startsWith('draft-');
        return (
          <div className="flex items-center gap-2.5">
            <img src={emp?.avatar} alt="" className="w-8 h-8 rounded-full flex-shrink-0 bg-slate-200" />
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-slate-900 dark:text-white whitespace-nowrap">
                  {emp ? `${emp.firstName} ${emp.lastName}` : '—'}
                </p>
                {isDraft && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    Unsaved
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">{emp?.employeeId}</p>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: 'departmentId',
      header: 'Department',
      cell: ({ row }) => (
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {deptMap[row.original.departmentId]?.name ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'date',
      header: 'Date',
      cell: ({ getValue }) => <span className="text-sm whitespace-nowrap">{formatDate(getValue() as string)}</span>,
    },
    {
      accessorKey: 'shiftId',
      header: 'Shift',
      cell: ({ row }) => (
        <span className="text-xs font-medium px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
          {shiftMap[row.original.shiftId]?.name ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'checkIn',
      header: 'Check In',
      cell: ({ getValue }) => (
        <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{formatTime(getValue() as string)}</span>
      ),
    },
    {
      accessorKey: 'checkOut',
      header: 'Check Out',
      cell: ({ getValue }) => (
        <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{formatTime(getValue() as string)}</span>
      ),
    },
    {
      accessorKey: 'workingHours',
      header: 'Hours',
      cell: ({ getValue }) => (
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {formatHoursMinutes((getValue() as number) || 0)}
        </span>
      ),
    },
    {
      id: 'dayHours',
      header: 'Dayhour',
      cell: ({ row }) => (
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {formatHoursMinutes(getDayHours(row.original))}
        </span>
      ),
    },
    {
      id: 'otLt',
      header: 'OT/LT',
      cell: ({ row }) => {
        const v = getOtLt(row.original);
        if (!v) return <span className="text-slate-300 dark:text-slate-600">—</span>;
        return (
          <span
            className={cn(
              'text-xs font-semibold',
              v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            )}
          >
            {formatOtLt(v)}
          </span>
        );
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => {
        const s = getValue() as AttendanceStatus;
        return <span className={`badge-${s}`}>{attendanceStatusLabel[s]}</span>;
      },
    },
    {
      accessorKey: 'location',
      header: 'Location',
      cell: ({ getValue }) => (
        <span className="text-xs text-slate-500">{(getValue() as string) || '—'}</span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setEditRecord(row.original); setShowForm(true); }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
            title="Edit"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={() => handleDuplicate(row.original)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
            title="Duplicate"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={() => setDeleteId(row.original.id)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ], [empMap, deptMap, shiftMap, leaves]);

  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  const handleSave = async (data: Partial<Attendance>) => {
    if (editRecord) {
      // Existing record — update store immediately; drafts updated locally
      if (editRecord.id.startsWith('draft-')) {
        setDraftRecords(list =>
          list.map(x =>
            x.id === editRecord.id
              ? {
                  ...x,
                  ...data,
                  date: editRecord.date,
                  employeeId: editRecord.employeeId,
                  checkIn: data.checkIn || undefined,
                  checkOut: data.checkOut || undefined,
                  manualOverride: true,
                  updatedAt: new Date().toISOString(),
                } as Attendance
              : x
          )
        );
        toast('success', 'Draft Updated', 'Changes will be saved when you click Save Attendance.');
      } else {
        try {
          // If several rows are checked (including this one), apply to all of them
          const bulkIds =
            selectedIds.length > 1 && selectedIds.includes(editRecord.id)
              ? selectedIds.filter((id) => !id.startsWith('draft-'))
              : [editRecord.id];

          const patch = {
            checkIn: data.checkIn || undefined,
            checkOut: data.checkOut || undefined,
            breakMinutes: data.breakMinutes,
            workingHours: data.workingHours,
            lateMinutes: data.lateMinutes,
            overtime: data.overtime,
            status: data.status,
            location: data.location,
            remarks: data.remarks,
            shiftId: data.shiftId,
            departmentId: data.departmentId,
            manualOverride: true as const,
          };

          if (bulkIds.length > 1) {
            const touched = await AttendanceAPI.updateMany(bulkIds, patch);
            const byId = new Map(touched.map((t) => [t.id, t]));
            setRecords((r) => r.map((x) => byId.get(x.id) ?? x));
            setRowSelection({});
            toast(
              'success',
              'Attendance Updated',
              `${touched.length} days updated. Open the employee report to see all changes.`,
            );
          } else {
            const updated = await AttendanceAPI.update(editRecord.id, {
              ...patch,
              date: data.date ?? editRecord.date,
              employeeId: data.employeeId ?? editRecord.employeeId,
            });
            setRecords((r) => r.map((x) => (x.id === updated.id ? updated : x)));
            toast(
              'success',
              'Attendance Updated',
              'This day was saved. Edit other days the same way — each stays on the report.',
            );
          }
        } catch (err) {
          toast('error', 'Update Failed', err instanceof Error ? err.message : 'Could not save attendance.');
          return;
        }
      }
    } else {
      // New attendance — add as draft until bottom Save is clicked
      const now = new Date().toISOString();
      const draft: Attendance = {
        id: generateId('draft'),
        employeeId: data.employeeId!,
        departmentId: data.departmentId!,
        date: data.date!,
        shiftId: data.shiftId!,
        checkIn: data.checkIn || undefined,
        checkOut: data.checkOut || undefined,
        breakMinutes: data.breakMinutes ?? 60,
        workingHours: data.workingHours ?? 0,
        overtime: data.overtime ?? 0,
        lateMinutes: data.lateMinutes ?? 0,
        status: (data.status as AttendanceStatus) ?? 'present',
        location: data.location,
        remarks: data.remarks,
        manualOverride: true,
        createdBy: data.createdBy ?? 'u1',
        createdAt: now,
        updatedAt: now,
      };

      setDraftRecords(list => [draft, ...list]);

      // Expand date filters so the new row is visible
      if (draft.date) {
        if (!dateFrom || draft.date < dateFrom) updateDateRange({ from: draft.date });
        if (!dateTo || draft.date > dateTo) updateDateRange({ to: draft.date });
      }

      toast('info', 'Added to list', 'Click Save Attendance at the bottom to save permanently.');
    }
    setShowForm(false);
    setEditRecord(null);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    if (deleteId.startsWith('draft-')) {
      setDraftRecords(list => list.filter(x => x.id !== deleteId));
      setDeleteId(null);
      toast('success', 'Removed', 'Unsaved attendance removed from the list.');
      return;
    }
    await AttendanceAPI.delete(deleteId);
    setRecords(r => r.filter(x => x.id !== deleteId));
    setDeleteId(null);
    toast('success', 'Deleted', 'Attendance record deleted.');
  };

  const handleDuplicate = async (record: Attendance) => {
    const now = new Date().toISOString();
    const { id, createdAt, updatedAt, ...rest } = record;
    const draft: Attendance = {
      ...rest,
      id: generateId('draft'),
      createdAt: now,
      updatedAt: now,
    };
    setDraftRecords(list => [draft, ...list]);
    if (draft.date) {
      if (!dateFrom || draft.date < dateFrom) updateDateRange({ from: draft.date });
      if (!dateTo || draft.date > dateTo) updateDateRange({ to: draft.date });
    }
    toast('info', 'Duplicated', 'Copy added to the list. Click Save Attendance to save.');
  };

  const handleSaveAttendance = async () => {
    setSaving(true);
    try {
      // Persist newly added drafts
      if (draftRecords.length > 0) {
        const payload = draftRecords.map(({ id, createdAt, updatedAt, ...rest }) => rest);
        await AttendanceAPI.bulkCreate(payload);
        setDraftRecords([]);
      }

      // Persist OT/LT metrics for currently visible saved records
      const refreshed = await AttendanceAPI.getAll();
      const visibleSaved = filterAttendance(refreshed, {
        departmentId: deptFilter,
        employeeId: employeeFilter,
        dateFrom,
        dateTo,
        status: statusFilter,
        employees,
      });

      for (const record of visibleSaved) {
        const shift = shiftMap[record.shiftId];
        const dayHours = calcDayHours(shift?.workingHours);
        const otLt = getOtLt(record);
        await AttendanceAPI.update(record.id, {
          lateMinutes: otLt < 0 ? Math.round(Math.abs(otLt) * 60) : record.lateMinutes,
          overtime: otLt > 0 ? otLt : Math.max(0, record.workingHours - dayHours),
        });
      }

      const finalList = await AttendanceAPI.getAll();
      setRecords(finalList);
      toast(
        'success',
        'Attendance Saved',
        unsavedCount > 0
          ? `${unsavedCount} new record${unsavedCount === 1 ? '' : 's'} saved successfully.`
          : `${visibleSaved.length} record${visibleSaved.length === 1 ? '' : 's'} saved successfully.`
      );
    } catch {
      toast('error', 'Save failed', 'Could not save attendance. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const printEmployeeName = selectedEmployee
    ? `${selectedEmployee.firstName} ${selectedEmployee.lastName}`
    : deptFilter
      ? `All employees — ${deptMap[deptFilter]?.name ?? 'Department'}`
      : 'All Employees';

  const printMonthLabel = (() => {
    if (!dateFrom && !dateTo) return '—';
    try {
      const from = parseISO(dateFrom || dateTo);
      const to = parseISO(dateTo || dateFrom);
      const fromLabel = format(from, 'MMMM yyyy');
      const toLabel = format(to, 'MMMM yyyy');
      return fromLabel === toLabel ? fromLabel : `${fromLabel} – ${toLabel}`;
    } catch {
      return '—';
    }
  })();

  const printDateLabel = (() => {
    if (dateFrom && dateTo && dateFrom === dateTo) return formatDate(dateFrom);
    if (dateFrom && dateTo) return `${formatDate(dateFrom)} – ${formatDate(dateTo)}`;
    if (dateFrom) return formatDate(dateFrom);
    if (dateTo) return formatDate(dateTo);
    return '—';
  })();

  const handleExport = () => {
    if (filtered.length === 0) {
      toast('warning', 'Nothing to export', 'No attendance records match the current filters.');
      return;
    }

    const safeName = printEmployeeName.replace(/[^\w\-]+/g, '_').slice(0, 40);
    downloadAttendancePdf(
      filtered,
      { employees: empMap, departments: deptMap, shifts: shiftMap },
      {
        employeeName: printEmployeeName,
        monthLabel: printMonthLabel,
        dateLabel: printDateLabel,
        fileName: `attendance-${safeName}-${dateFrom}-to-${dateTo}.pdf`,
      }
    );
    toast('success', 'PDF Downloaded', 'Attendance report exported as PDF.');
  };

  const handlePrint = () => {
    const previousSize = table.getState().pagination.pageSize;
    table.setPageSize(Math.max(filtered.length, 1));
    const restore = () => {
      table.setPageSize(previousSize);
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    setTimeout(() => window.print(), 50);
  };

  return (
    <div className="space-y-4">
      {/* Print-only report header */}
      <div className="hidden print-only mb-4 pb-3 border-b-2 border-slate-800">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Attendance Report</p>
            <h1 className="text-2xl font-bold text-slate-900 leading-tight">{printEmployeeName}</h1>
          </div>
          <img src="/images/logo-emblem.png" alt="PACE" className="w-14 h-14 object-contain" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-slate-500">Month: </span>
            <span className="font-semibold text-slate-900">{printMonthLabel}</span>
          </div>
          <div>
            <span className="text-slate-500">Date: </span>
            <span className="font-semibold text-slate-900">{printDateLabel}</span>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between no-print">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Attendance</h1>
          <p className="text-sm text-slate-500 mt-0.5">{filtered.length} records</p>
        </div>
        <button onClick={() => { setEditRecord(null); setShowForm(true); }} className="btn-primary">
          <Plus size={16} /> Add Attendance
        </button>
      </div>

      {/* Toolbar */}
      <div className="card p-4 no-print">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Department filter */}
          <select
            value={deptFilter}
            onChange={e => handleDeptChange(e.target.value)}
            className="input py-2 w-auto min-w-36"
          >
            <option value="">All Departments</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>

          {/* Employee selection button replaces the toolbar search field */}
            <div className="relative min-w-56 order-first" ref={empPickerRef}>
              <button
                type="button"
                onClick={() => setEmpMenuOpen(v => !v)}
                className="input py-2 w-full min-w-48 flex items-center justify-between gap-2 text-left"
              >
                <span className={cn('truncate text-sm', !selectedEmployee && 'text-slate-400')}>
                  {selectedEmployee
                    ? `${selectedEmployee.firstName} ${selectedEmployee.lastName}`
                    : 'Select employee'}
                </span>
                <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
              </button>

              {empMenuOpen && (
                <div className="absolute z-30 mt-1 w-72 max-w-[85vw] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
                  <div className="p-2 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800">
                      <Search size={13} className="text-slate-400" />
                      <input
                        autoFocus
                        value={empSearch}
                        onChange={e => setEmpSearch(e.target.value)}
                        placeholder="Search employee name..."
                        className="bg-transparent text-sm outline-none flex-1 text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
                      />
                    </div>
                  </div>
                  <div className="max-h-52 overflow-y-auto py-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEmployeeFilter('');
                        setEmpMenuOpen(false);
                        setEmpSearch('');
                      }}
                      className={cn(
                        'w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800',
                        !employeeFilter ? 'text-primary-600 font-medium' : 'text-slate-600 dark:text-slate-300'
                      )}
                    >
                      All employees
                    </button>
                    {visibleEmployees.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-slate-400">
                        {deptFilter ? 'No employees in this department' : 'No employees available'}
                      </p>
                    ) : (
                      visibleEmployees.map(emp => (
                        <button
                          key={emp.id}
                          type="button"
                          onClick={() => {
                            setEmployeeFilter(emp.id);
                            setEmpMenuOpen(false);
                            setEmpSearch('');
                          }}
                          className={cn(
                            'w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800',
                            employeeFilter === emp.id && 'bg-primary-50 dark:bg-primary-900/20'
                          )}
                        >
                          <img src={emp.avatar} alt="" className="w-7 h-7 rounded-full bg-slate-200 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                              {emp.firstName} {emp.lastName}
                            </p>
                            <p className="text-[11px] text-slate-400">{emp.employeeId}</p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

          {/* Date from / to */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <button
                type="button"
                className={cn(
                  'px-2.5 py-2 text-xs font-semibold',
                  calendar === 'ad' ? 'bg-primary-500 text-white' : 'bg-white dark:bg-slate-900 text-slate-600',
                )}
                onClick={() => updateSettings({ calendarSystem: 'ad' })}
              >
                AD
              </button>
              <button
                type="button"
                className={cn(
                  'px-2.5 py-2 text-xs font-semibold',
                  calendar === 'bs' ? 'bg-primary-500 text-white' : 'bg-white dark:bg-slate-900 text-slate-600',
                )}
                onClick={() => updateSettings({ calendarSystem: 'bs' })}
              >
                BS
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
                From ({calendar === 'bs' ? 'BS' : 'AD'})
              </span>
              <CalendarDateInput
                value={dateFrom}
                max={dateTo || undefined}
                calendar={calendar}
                onChange={(v) => updateDateRange({ from: v })}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
                To ({calendar === 'bs' ? 'BS' : 'AD'})
              </span>
              <CalendarDateInput
                value={dateTo}
                min={dateFrom || undefined}
                calendar={calendar}
                onChange={(v) => updateDateRange({ to: v })}
              />
            </div>
          </div>

          {/* Status */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as AttendanceStatus | '')}
            className="input py-2 w-auto min-w-32"
          >
            {statusOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <div className="flex items-center gap-2 ml-auto">
            <button onClick={handleExport} className="btn-secondary py-2 px-3">
              <Download size={14} /> Export PDF
            </button>
            <button onClick={handlePrint} className="btn-secondary py-2 px-3">
              <Printer size={14} />
            </button>
            <button onClick={() => void reloadFromDevice()} className="btn-ghost p-2" title="Refresh from device">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden print-sheet">
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full text-sm print-table">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id}>
                  {hg.headers.map(header => (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        'text-left py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap',
                        header.column.getCanSort() && 'cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200',
                        (header.id === 'select' || header.id === 'actions') && 'no-print'
                      )}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' && <ChevronUp size={12} />}
                        {header.column.getIsSorted() === 'desc' && <ChevronDown size={12} />}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {                    Array.from({ length: 13 }).map((_, j) => (
                      <td key={j} className="py-3 px-4"><div className="skeleton h-4 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <Filter size={32} className="opacity-30" />
                      <p className="text-sm font-medium">No attendance records found</p>
                      <p className="text-xs">Try adjusting your filters</p>
                    </div>
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map(row => (
                  <motion.tr
                    key={row.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="table-row-hover"
                  >
                    {row.getVisibleCells().map(cell => (
                      <td
                        key={cell.id}
                        className={cn(
                          'py-3 px-4',
                          (cell.column.id === 'select' || cell.column.id === 'actions') && 'no-print'
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </motion.tr>
                ))
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                <tr>
                  {table.getVisibleLeafColumns().map(col => {
                    if (col.id === 'otLt') {
                      return (
                        <td key={col.id} className="py-3 px-4">
                          <span
                            className={cn(
                              'text-sm font-bold',
                              otLtTotal > 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : otLtTotal < 0
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-slate-500'
                            )}
                          >
                            {formatOtLt(otLtTotal)}
                          </span>
                        </td>
                      );
                    }
                    if (col.id === 'workingHours') {
                      return (
                        <td key={col.id} className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Total
                        </td>
                      );
                    }
                    return (
                      <td
                        key={col.id}
                        className={cn(
                          'py-3 px-4',
                          (col.id === 'select' || col.id === 'actions') && 'no-print'
                        )}
                      />
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800 no-print">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">
              {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}–
              {Math.min((table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize, filtered.length)} of {filtered.length}
            </span>
            <select
              value={table.getState().pagination.pageSize}
              onChange={e => table.setPageSize(Number(e.target.value))}
              className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
            >
              {PAGE_SIZES.map(s => <option key={s} value={s}>{s} / page</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="btn-ghost p-1.5 rounded-lg disabled:opacity-40">
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(table.getPageCount(), 5) }, (_, i) => (
              <button
                key={i}
                onClick={() => table.setPageIndex(i)}
                className={cn(
                  'w-8 h-8 text-sm rounded-lg transition-colors',
                  table.getState().pagination.pageIndex === i
                    ? 'bg-primary-500 text-white font-semibold'
                    : 'btn-ghost'
                )}
              >
                {i + 1}
              </button>
            ))}
            <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="btn-ghost p-1.5 rounded-lg disabled:opacity-40">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom save bar */}
      <div className="flex items-center justify-end gap-3 no-print pt-1">
        <p className="text-sm text-slate-500 mr-auto">
          {unsavedCount > 0
            ? `${unsavedCount} new record${unsavedCount === 1 ? '' : 's'} not saved yet`
            : `${filtered.length} attendance record${filtered.length === 1 ? '' : 's'} ready to save`}
        </p>
        <button
          type="button"
          onClick={handleSaveAttendance}
          className="btn-primary px-6 py-2.5"
          disabled={saving || (filtered.length === 0 && unsavedCount === 0)}
        >
          {saving ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save size={16} /> Save Attendance
            </>
          )}
        </button>
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {showForm && (
          <AttendanceFormModal
            key={editRecord?.id ?? 'new-attendance'}
            record={editRecord}
            employees={employees}
            departments={departments}
            shifts={shifts}
            bulkCount={
              editRecord && selectedIds.length > 1 && selectedIds.includes(editRecord.id)
                ? selectedIds.length
                : 1
            }
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditRecord(null); }}
          />
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteId}
        title="Delete Attendance Record"
        message="Are you sure you want to delete this attendance record? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
