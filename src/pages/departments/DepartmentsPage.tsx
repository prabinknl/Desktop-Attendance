import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Building2, Users, TrendingUp, Edit2, Trash2, X } from 'lucide-react';
import { DepartmentAPI, EmployeeAPI, AttendanceAPI } from '../../data/store';
import type { Department, Employee } from '../../types';
import { formatDate, cn } from '../../lib/utils';
import { useNotifications } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import ConfirmDialog from '../../components/ui/ConfirmDialog';

const schema = z.object({
  name: z.string().min(1, 'Name required'),
  code: z.string().min(2, 'Code required (min 2 chars)').max(5, 'Code max 5 chars').toUpperCase(),
  managerId: z.string().min(1, 'Manager required'),
  description: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

const deptColors = ['bg-primary-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-cyan-500', 'bg-rose-500'];

export default function DepartmentsPage() {
  const { can } = useAuth();
  const { toast } = useNotifications();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deptStats, setDeptStats] = useState<Record<string, { count: number; attendance: number }>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editDept, setEditDept] = useState<Department | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    (async () => {
      const [d, e, a] = await Promise.all([DepartmentAPI.getAll(), EmployeeAPI.getAll(), AttendanceAPI.getAll()]);
      setDepartments(d);
      setEmployees(e);
      const today = new Date().toISOString().split('T')[0];
      const stats: Record<string, { count: number; attendance: number }> = {};
      d.forEach(dept => {
        const deptEmps = e.filter(emp => emp.departmentId === dept.id && emp.status === 'active');
        const present = a.filter(att => att.departmentId === dept.id && att.date === today && att.status !== 'absent').length;
        stats[dept.id] = {
          count: deptEmps.length,
          attendance: deptEmps.length ? Math.round((present / deptEmps.length) * 100) : 0,
        };
      });
      setDeptStats(stats);
      setLoading(false);
    })();
  }, []);

  const empMap = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e])), [employees]);

  const openEdit = (dept: Department) => {
    setEditDept(dept);
    reset({ name: dept.name, code: dept.code, managerId: dept.managerId, description: dept.description });
    setShowForm(true);
  };

  const onSubmit = async (data: FormData) => {
    if (editDept) {
      const updated = await DepartmentAPI.update(editDept.id, data);
      setDepartments(d => d.map(x => x.id === updated.id ? updated : x));
      toast('success', 'Department Updated');
    } else {
      const created = await DepartmentAPI.create(data);
      setDepartments(d => [...d, created]);
      toast('success', 'Department Created', `${data.name} department added.`);
    }
    setShowForm(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await DepartmentAPI.delete(deleteId);
    setDepartments(d => d.filter(x => x.id !== deleteId));
    setDeleteId(null);
    toast('success', 'Department Deleted');
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-48 rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Departments</h1>
          <p className="text-sm text-slate-500 mt-0.5">{departments.length} departments</p>
        </div>
        {can('department:write') && (
          <button onClick={() => { setEditDept(null); reset({}); setShowForm(true); }} className="btn-primary">
            <Plus size={16} /> Add Department
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {departments.map((dept, i) => {
          const manager = empMap[dept.managerId];
          const stats = deptStats[dept.id] ?? { count: 0, attendance: 0 };
          return (
            <motion.div
              key={dept.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="card-hover p-5"
            >
              <div className="flex items-start justify-between mb-4">
                <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center', deptColors[i % deptColors.length])}>
                  <Building2 size={22} className="text-white" />
                </div>
                {can('department:write') && (
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(dept)} className="p-1.5 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => setDeleteId(dept.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>

              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{dept.name}</h3>
              <p className="text-xs text-slate-400 font-mono mb-1">{dept.code}</p>
              {dept.description && <p className="text-sm text-slate-500 dark:text-slate-400 mb-3 line-clamp-2">{dept.description}</p>}

              <div className="flex items-center gap-3 mb-4">
                {manager && (
                  <div className="flex items-center gap-2">
                    <img src={manager.avatar} alt="" className="w-6 h-6 rounded-full" />
                    <span className="text-xs text-slate-500">{manager.firstName} {manager.lastName}</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                  <Users size={16} className="text-primary-500" />
                  <div>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{stats.count}</p>
                    <p className="text-[10px] text-slate-400">Employees</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                  <TrendingUp size={16} className="text-emerald-500" />
                  <div>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{stats.attendance}%</p>
                    <p className="text-[10px] text-slate-400">Attendance</p>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={e => e.target === e.currentTarget && setShowForm(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              className="card w-full max-w-md shadow-2xl"
            >
              <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {editDept ? 'Edit Department' : 'New Department'}
                </h2>
                <button onClick={() => setShowForm(false)} className="btn-ghost p-2 rounded-xl"><X size={18} /></button>
              </div>
              <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Name *</label>
                    <input {...register('name')} className={cn('input', errors.name && 'border-rose-400')} />
                    {errors.name && <p className="text-xs text-rose-500 mt-1">{errors.name.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Code *</label>
                    <input {...register('code')} className={cn('input uppercase', errors.code && 'border-rose-400')} />
                    {errors.code && <p className="text-xs text-rose-500 mt-1">{errors.code.message}</p>}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Manager *</label>
                  <select {...register('managerId')} className={cn('input', errors.managerId && 'border-rose-400')}>
                    <option value="">Select manager</option>
                    {employees.filter(e => e.status === 'active').map(e => (
                      <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>
                    ))}
                  </select>
                  {errors.managerId && <p className="text-xs text-rose-500 mt-1">{errors.managerId.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Description</label>
                  <textarea {...register('description')} rows={2} className="input resize-none" />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
                  <button type="submit" disabled={isSubmitting} className="btn-primary">
                    {isSubmitting ? 'Saving...' : editDept ? 'Update' : 'Create Department'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Department"
        message="Delete this department? Employees in this department will not be affected."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
