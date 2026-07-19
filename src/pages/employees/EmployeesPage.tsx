import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus, Search, Filter, LayoutGrid, List, Edit2, Trash2,
  UserCheck, UserX, Mail, Phone, Building2, X, Eye, FileText,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EmployeeAPI, DepartmentAPI, ShiftAPI, hydratePersistedStores } from '../../data/store';
import type { Employee, Department, Shift } from '../../types';
import { formatDate, employmentTypeLabel, employeeStatusLabel, generateId, cn } from '../../lib/utils';
import { useNotifications } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { deviceApi } from '../../api/deviceApi';
import { upsertEmployeesFromDeviceLogs } from '../../lib/deviceEmployeeSync';
import { fetchLogsWithCache } from '../../lib/deviceLogsCache';
import { importAttendanceFromDeviceLogs } from '../../lib/deviceAttendanceSync';

const schema = z.object({
  firstName: z.string().min(1, 'First name required'),
  lastName: z.string().min(1, 'Last name required'),
  email: z.string().email('Valid email required'),
  phone: z.string().min(6, 'Phone required'),
  departmentId: z.string().min(1, 'Department required'),
  designation: z.string().min(1, 'Designation required'),
  joiningDate: z.string().min(1, 'Joining date required'),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'intern']),
  status: z.enum(['active', 'inactive', 'on_leave', 'terminated']),
  shiftId: z.string().min(1, 'Shift required'),
  address: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

function EmployeeCard({ emp, dept, onEdit, onDelete, onView, onReport }: {
  emp: Employee; dept?: Department;
  onEdit: () => void; onDelete: () => void; onView: () => void; onReport: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="card-hover p-5"
    >
      <div className="flex items-start gap-4">
        <div className="relative flex-shrink-0">
          <img src={emp.avatar} alt={`${emp.firstName}`} className="w-14 h-14 rounded-2xl object-cover bg-slate-200" />
          <span className={cn(
            'absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white dark:border-slate-800',
            emp.status === 'active' ? 'bg-emerald-500' :
            emp.status === 'on_leave' ? 'bg-amber-500' : 'bg-slate-400'
          )} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 dark:text-white">{emp.firstName} {emp.lastName}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">{emp.designation}</p>
          <span className="inline-flex mt-1.5 items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
            <Building2 size={10} /> {dept?.name ?? '—'}
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Mail size={12} className="flex-shrink-0" />
          <span className="truncate">{emp.email}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Phone size={12} className="flex-shrink-0" />
          <span>{emp.phone || '—'}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onReport}
        className="mt-4 w-full btn-secondary py-2 text-xs font-semibold justify-center"
      >
        <FileText size={13} /> See report
      </button>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex gap-1.5">
          <span className={cn(
            'badge text-[10px]',
            emp.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' :
            emp.status === 'inactive' ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400' :
            'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
          )}>
            {employeeStatusLabel[emp.status]}
          </span>
          <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400 text-[10px]">
            {employmentTypeLabel[emp.employmentType]}
          </span>
        </div>
        <div className="flex gap-1">
          <button onClick={onView} className="p-1.5 rounded-lg text-slate-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors" title="View">
            <Eye size={13} />
          </button>
          <button onClick={onEdit} className="p-1.5 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors" title="Edit">
            <Edit2 size={13} />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors" title="Delete">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default function EmployeesPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { toast } = useNotifications();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editEmp, setEditEmp] = useState<Employee | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewEmp, setViewEmp] = useState<Employee | null>(null);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { status: 'active', employmentType: 'full_time' },
  });

  useEffect(() => {
    (async () => {
      hydratePersistedStores();
      // Show previously saved employees immediately
      const [e0, d0, s0] = await Promise.all([
        EmployeeAPI.getAll(),
        DepartmentAPI.getAll(),
        ShiftAPI.getAll(),
      ]);
      setEmployees(e0);
      setDepartments(d0);
      setShifts(s0);
      setLoading(false);

      try {
        const { logs } = await fetchLogsWithCache(() => deviceApi.getLogs());
        if (logs.length) {
          await upsertEmployeesFromDeviceLogs(logs);
          await importAttendanceFromDeviceLogs(logs);
          const e = await EmployeeAPI.getAll();
          setEmployees(e);
        }
      } catch {
        // Device API may be offline — still show locally stored employees
      }
    })();
  }, []);

  const deptMap = useMemo(() => Object.fromEntries(departments.map(d => [d.id, d])), [departments]);

  const filtered = useMemo(() => employees.filter(e => {
    const q = search.toLowerCase();
    const matchSearch = !q || `${e.firstName} ${e.lastName} ${e.employeeId} ${e.email}`.toLowerCase().includes(q);
    const matchDept = !deptFilter || e.departmentId === deptFilter;
    const matchStatus = !statusFilter || e.status === statusFilter;
    return matchSearch && matchDept && matchStatus;
  }), [employees, search, deptFilter, statusFilter]);

  const openAdd = () => {
    setEditEmp(null);
    reset({ status: 'active', employmentType: 'full_time' });
    setShowForm(true);
  };

  const openEdit = (emp: Employee) => {
    setEditEmp(emp);
    reset({
      firstName: emp.firstName, lastName: emp.lastName,
      email: emp.email, phone: emp.phone, departmentId: emp.departmentId,
      designation: emp.designation, joiningDate: emp.joiningDate,
      employmentType: emp.employmentType, status: emp.status,
      shiftId: emp.shiftId, address: emp.address,
    });
    setShowForm(true);
  };

  const onSubmit = async (data: FormData) => {
    const empCount = employees.length + 1;
    if (editEmp) {
      const updated = await EmployeeAPI.update(editEmp.id, data);
      setEmployees(e => e.map(x => x.id === updated.id ? updated : x));
      toast('success', 'Employee Updated', `${data.firstName} ${data.lastName}'s record updated.`);
    } else {
      const created = await EmployeeAPI.create({
        ...data,
        employeeId: `EMP${String(empCount).padStart(3, '0')}`,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.firstName}`,
      });
      setEmployees(e => [...e, created]);
      toast('success', 'Employee Added', `${data.firstName} ${data.lastName} added successfully.`);
    }
    setShowForm(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await EmployeeAPI.delete(deleteId);
    setEmployees(e => e.filter(x => x.id !== deleteId));
    setDeleteId(null);
    toast('success', 'Employee Deleted', 'Employee record removed.');
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Employees</h1>
          <p className="text-sm text-slate-500 mt-0.5">{filtered.length} of {employees.length} employees</p>
        </div>
        {can('employee:write') && (
          <button onClick={openAdd} className="btn-primary">
            <Plus size={16} /> Add Employee
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex-1 min-w-48 max-w-xs">
          <Search size={14} className="text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employees..."
            className="bg-transparent text-sm outline-none text-slate-700 dark:text-slate-200 placeholder:text-slate-400 flex-1" />
        </div>
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="input py-2 w-auto min-w-36">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input py-2 w-auto min-w-32">
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="on_leave">On Leave</option>
          <option value="terminated">Terminated</option>
        </select>
        <div className="flex items-center gap-1 ml-auto bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
          <button onClick={() => setViewMode('grid')} className={cn('p-1.5 rounded-lg transition-colors', viewMode === 'grid' ? 'bg-white dark:bg-slate-700 shadow-sm' : 'text-slate-400')}>
            <LayoutGrid size={16} />
          </button>
          <button onClick={() => setViewMode('list')} className={cn('p-1.5 rounded-lg transition-colors', viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm' : 'text-slate-400')}>
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Grid / List */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-52 rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-16 text-center text-slate-400">
          <Filter size={40} className="mx-auto mb-2 opacity-30" />
          <p className="font-medium">No employees found</p>
          <p className="text-xs mt-1">Run Manual Sync on Device Settings to import names from the attendance machine.</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <AnimatePresence>
            {filtered.map(emp => (
              <EmployeeCard
                key={emp.id}
                emp={emp}
                dept={deptMap[emp.departmentId]}
                onEdit={() => openEdit(emp)}
                onDelete={() => setDeleteId(emp.id)}
                onView={() => setViewEmp(emp)}
                onReport={() => navigate(`/employees/${emp.id}/report`)}
              />
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {['Employee', 'Department', 'Designation', 'Joining Date', 'Type', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map(emp => (
                <tr key={emp.id} className="table-row-hover">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <img src={emp.avatar} alt="" className="w-8 h-8 rounded-full" />
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">{emp.firstName} {emp.lastName}</p>
                        <p className="text-xs text-slate-400">{emp.employeeId}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-500">{deptMap[emp.departmentId]?.name}</td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{emp.designation}</td>
                  <td className="py-3 px-4 text-slate-500 whitespace-nowrap">{formatDate(emp.joiningDate)}</td>
                  <td className="py-3 px-4"><span className="badge bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px]">{employmentTypeLabel[emp.employmentType]}</span></td>
                  <td className="py-3 px-4">
                    <span className={cn('badge text-[10px]',
                      emp.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                    )}>{employeeStatusLabel[emp.status]}</span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex gap-1">
                      <button
                        onClick={() => navigate(`/employees/${emp.id}/report`)}
                        className="px-2 py-1 rounded-lg text-xs font-medium text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                        title="See report"
                      >
                        See report
                      </button>
                      <button onClick={() => setViewEmp(emp)} className="p-1.5 rounded-lg text-slate-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"><Eye size={13} /></button>
                      <button onClick={() => openEdit(emp)} className="p-1.5 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors"><Edit2 size={13} /></button>
                      <button onClick={() => setDeleteId(emp.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Form Modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={e => e.target === e.currentTarget && setShowForm(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
            >
              <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {editEmp ? 'Edit Employee' : 'Add Employee'}
                </h2>
                <button onClick={() => setShowForm(false)} className="btn-ghost p-2 rounded-xl"><X size={18} /></button>
              </div>
              <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">First Name *</label>
                    <input {...register('firstName')} className={cn('input', errors.firstName && 'border-rose-400')} />
                    {errors.firstName && <p className="text-xs text-rose-500 mt-1">{errors.firstName.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Last Name *</label>
                    <input {...register('lastName')} className={cn('input', errors.lastName && 'border-rose-400')} />
                    {errors.lastName && <p className="text-xs text-rose-500 mt-1">{errors.lastName.message}</p>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email *</label>
                    <input {...register('email')} type="email" className={cn('input', errors.email && 'border-rose-400')} />
                    {errors.email && <p className="text-xs text-rose-500 mt-1">{errors.email.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Phone *</label>
                    <input {...register('phone')} className={cn('input', errors.phone && 'border-rose-400')} />
                    {errors.phone && <p className="text-xs text-rose-500 mt-1">{errors.phone.message}</p>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Department *</label>
                    <select {...register('departmentId')} className={cn('input', errors.departmentId && 'border-rose-400')}>
                      <option value="">Select</option>
                      {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Designation *</label>
                    <input {...register('designation')} className={cn('input', errors.designation && 'border-rose-400')} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Joining Date *</label>
                    <input type="date" {...register('joiningDate')} className="input" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Shift *</label>
                    <select {...register('shiftId')} className="input">
                      <option value="">Select</option>
                      {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Employment Type</label>
                    <select {...register('employmentType')} className="input">
                      <option value="full_time">Full Time</option>
                      <option value="part_time">Part Time</option>
                      <option value="contract">Contract</option>
                      <option value="intern">Intern</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Status</label>
                    <select {...register('status')} className="input">
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="on_leave">On Leave</option>
                      <option value="terminated">Terminated</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Address</label>
                  <input {...register('address')} className="input" />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
                  <button type="submit" disabled={isSubmitting} className="btn-primary">
                    {isSubmitting ? 'Saving...' : editEmp ? 'Update Employee' : 'Add Employee'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* View Profile Modal */}
      <AnimatePresence>
        {viewEmp && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={e => e.target === e.currentTarget && setViewEmp(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="card w-full max-w-md p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Employee Profile</h2>
                <button onClick={() => setViewEmp(null)} className="btn-ghost p-2 rounded-xl"><X size={18} /></button>
              </div>
              <div className="flex flex-col items-center mb-6">
                <img src={viewEmp.avatar} alt="" className="w-20 h-20 rounded-3xl mb-3 bg-slate-200" />
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">{viewEmp.firstName} {viewEmp.lastName}</h3>
                <p className="text-sm text-slate-500">{viewEmp.designation}</p>
                <span className="mt-2 badge bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
                  {viewEmp.employeeId}
                </span>
              </div>
              <div className="space-y-3 text-sm">
                {[
                  { label: 'Email', value: viewEmp.email },
                  { label: 'Phone', value: viewEmp.phone },
                  { label: 'Department', value: deptMap[viewEmp.departmentId]?.name },
                  { label: 'Joined', value: formatDate(viewEmp.joiningDate) },
                  { label: 'Type', value: employmentTypeLabel[viewEmp.employmentType] },
                  { label: 'Status', value: employeeStatusLabel[viewEmp.status] },
                  ...(viewEmp.address ? [{ label: 'Address', value: viewEmp.address }] : []),
                ].map(row => (
                  <div key={row.label} className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-700">
                    <span className="text-slate-500">{row.label}</span>
                    <span className="font-medium text-slate-900 dark:text-white">{row.value}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Employee"
        message="Permanently delete this employee? All associated attendance records will remain."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
