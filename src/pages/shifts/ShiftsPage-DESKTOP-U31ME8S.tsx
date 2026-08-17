import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Clock, Edit2, Trash2, X, Users, AlarmClock } from 'lucide-react';
import { ShiftAPI, EmployeeAPI } from '../../data/store';
import type { Shift, Employee } from '../../types';
import { cn } from '../../lib/utils';
import { useNotifications } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import ConfirmDialog from '../../components/ui/ConfirmDialog';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const schema = z.object({
  name: z.string().min(1, 'Name required'),
  startTime: z.string().min(1, 'Start time required'),
  endTime: z.string().min(1, 'End time required'),
  breakMinutes: z.coerce.number().min(0),
  graceMinutes: z.coerce.number().min(0),
  workingHours: z.coerce.number().min(1),
  workingDays: z.array(z.number()).min(1, 'Select at least one working day'),
});
type FormData = z.infer<typeof schema>;

const shiftColors = ['bg-primary-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500'];

export default function ShiftsPage() {
  const { can } = useAuth();
  const { toast } = useNotifications();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editShift, setEditShift] = useState<Shift | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: { workingDays: [0, 1, 2, 3, 4, 5], breakMinutes: 60, graceMinutes: 15, workingHours: 8 },
  });

  useEffect(() => {
    (async () => {
      const [s, e] = await Promise.all([ShiftAPI.getAll(), EmployeeAPI.getAll()]);
      setShifts(s); setEmployees(e);
      setLoading(false);
    })();
  }, []);

  const openEdit = (shift: Shift) => {
    setEditShift(shift);
    setSelectedDays(shift.workingDays);
    reset({
      name: shift.name, startTime: shift.startTime, endTime: shift.endTime,
      breakMinutes: shift.breakMinutes, graceMinutes: shift.graceMinutes,
      workingHours: shift.workingHours, workingDays: shift.workingDays,
    });
    setShowForm(true);
  };

  const toggleDay = (day: number) => {
    const next = selectedDays.includes(day)
      ? selectedDays.filter(d => d !== day)
      : [...selectedDays, day].sort((a, b) => a - b);
    setSelectedDays(next);
    setValue('workingDays', next);
  };

  const onSubmit = async (data: FormData) => {
    if (editShift) {
      const updated = await ShiftAPI.update(editShift.id, { ...data, workingDays: selectedDays });
      setShifts(s => s.map(x => x.id === updated.id ? updated : x));
      toast('success', 'Shift Updated');
    } else {
      const created = await ShiftAPI.create({ ...data, workingDays: selectedDays });
      setShifts(s => [...s, created]);
      toast('success', 'Shift Created');
    }
    setShowForm(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await ShiftAPI.delete(deleteId);
    setShifts(s => s.filter(x => x.id !== deleteId));
    setDeleteId(null);
    toast('success', 'Shift Deleted');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Shift Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">{shifts.length} shifts configured</p>
        </div>
        {can('shift:write') && (
          <button onClick={() => { setEditShift(null); setSelectedDays([0,1,2,3,4,5]); reset({ workingDays: [0,1,2,3,4,5], breakMinutes: 60, graceMinutes: 15, workingHours: 8 }); setShowForm(true); }} className="btn-primary">
            <Plus size={16} /> Add Shift
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-56 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {shifts.map((shift, i) => {
            const assigned = employees.filter(e => e.shiftId === shift.id && e.status === 'active');
            return (
              <motion.div
                key={shift.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="card-hover p-5"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center', shiftColors[i % shiftColors.length])}>
                    <AlarmClock size={22} className="text-white" />
                  </div>
                  {can('shift:write') && (
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(shift)} className="p-1.5 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => setDeleteId(shift.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>

                <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">{shift.name}</h3>

                <div className="flex items-center gap-2 mb-3">
                  <Clock size={14} className="text-slate-400" />
                  <span className="text-sm font-mono text-slate-600 dark:text-slate-300">
                    {shift.startTime} → {shift.endTime}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                    <p className="text-xs text-slate-400">Break</p>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{shift.breakMinutes}m</p>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                    <p className="text-xs text-slate-400">Grace</p>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{shift.graceMinutes}m</p>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                    <p className="text-xs text-slate-400">Hours</p>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{shift.workingHours}h</p>
                  </div>
                </div>

                <div className="flex gap-1 mb-3">
                  {DAY_LABELS.map((d, idx) => (
                    <div key={d} className={cn(
                      'w-7 h-7 rounded-lg text-[10px] font-bold flex items-center justify-center',
                      shift.workingDays.includes(idx)
                        ? `${shiftColors[i % shiftColors.length]} text-white`
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                    )}>
                      {d[0]}
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Users size={12} />
                  {assigned.length} employee{assigned.length !== 1 ? 's' : ''} assigned
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Form Modal */}
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
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {editShift ? 'Edit Shift' : 'New Shift'}
                </h2>
                <button onClick={() => setShowForm(false)} className="btn-ghost p-2 rounded-xl"><X size={18} /></button>
              </div>
              <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Shift Name *</label>
                  <input {...register('name')} className={cn('input', errors.name && 'border-rose-400')} placeholder="e.g. Morning Shift" />
                  {errors.name && <p className="text-xs text-rose-500 mt-1">{errors.name.message}</p>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Start Time *</label>
                    <input type="time" {...register('startTime')} className="input" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">End Time *</label>
                    <input type="time" {...register('endTime')} className="input" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Break (min)</label>
                    <input type="number" {...register('breakMinutes')} min={0} className="input" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Grace (min)</label>
                    <input type="number" {...register('graceMinutes')} min={0} className="input" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Hours</label>
                    <input type="number" step="0.5" {...register('workingHours')} min={1} className="input" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Working Days *</label>
                  <div className="flex gap-2">
                    {DAY_LABELS.map((d, idx) => (
                      <button
                        key={d} type="button"
                        onClick={() => toggleDay(idx)}
                        className={cn(
                          'w-9 h-9 rounded-xl text-xs font-bold transition-all',
                          selectedDays.includes(idx)
                            ? 'bg-primary-500 text-white shadow-sm shadow-primary-500/30'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  {errors.workingDays && <p className="text-xs text-rose-500 mt-1">Select at least one working day</p>}
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
                  <button type="submit" disabled={isSubmitting} className="btn-primary">
                    {isSubmitting ? 'Saving...' : editShift ? 'Update Shift' : 'Create Shift'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Shift"
        message="Delete this shift? Employees assigned to it will need reassignment."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
