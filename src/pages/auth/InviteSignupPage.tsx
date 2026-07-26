import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Clock, Users, BarChart3, Lock, CheckCircle2, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useInvitations } from '../../contexts/InvitationContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { EmployeeAPI } from '../../data/store';
import { cn } from '../../lib/utils';
import type { Employee } from '../../types';

const schema = z.object({
  name: z.string().min(2, 'Full name is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string().min(6, 'Please confirm your password'),
  employeeId: z.string().optional(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type FormData = z.infer<typeof schema>;

const features = [
  { icon: Clock, title: 'Real-time Tracking', desc: 'Track attendance with precision' },
  { icon: Users, title: 'Team Management', desc: 'Manage departments seamlessly' },
  { icon: BarChart3, title: 'Smart Analytics', desc: 'Insights to optimise workforce' },
  { icon: Lock, title: 'Secure Access', desc: 'Role-based permission system' },
];

function employeeDisplayName(e: Employee) {
  return `${e.firstName} ${e.lastName}`.trim() || e.employeeId;
}

export default function InviteSignupPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { getInvitation, markUsed } = useInvitations();
  const { signupEmployee, signupAccountant } = useAuth();
  const { toast } = useNotifications();

  const [invite, setInvite] = useState<ReturnType<typeof getInvitation>>(null);
  const [loading, setLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [empSearch, setEmpSearch] = useState('');

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const selectedEmpId = watch('employeeId');

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    const inv = getInvitation(token);
    setInvite(inv);
    setLoading(false);
  }, [token, getInvitation]);

  useEffect(() => {
    if (invite?.role === 'employee') {
      EmployeeAPI.getAll().then((list) => {
        // Only show un-registered employees
        setEmployees(list.filter((e) => !e.email.endsWith('@device.local') || e.departmentId !== 'd0'));
      });
    }
  }, [invite]);

  const filteredEmployees = employees.filter((e) => {
    const q = empSearch.toLowerCase();
    return (
      e.firstName.toLowerCase().includes(q) ||
      e.lastName.toLowerCase().includes(q) ||
      e.employeeId.toLowerCase().includes(q)
    );
  });

  const onSubmit = async (data: FormData) => {
    if (!invite || !token) return;
    setSubmitting(true);

    let result: { success: boolean; error?: string };

    if (invite.role === 'employee') {
      if (!data.employeeId) {
        toast('error', 'Please select your name from the list');
        setSubmitting(false);
        return;
      }
      result = await signupEmployee({
        name: data.name,
        email: invite.email,
        password: data.password,
        employeeId: data.employeeId,
      });
    } else {
      // accountant
      result = await signupAccountant({
        name: data.name,
        email: invite.email,
        password: data.password,
      });
    }

    if (result.success) {
      markUsed(token);
      toast('success', 'Account created! Please sign in.');
      navigate('/login');
    } else {
      toast('error', result.error ?? 'Sign-up failed');
    }
    setSubmitting(false);
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="animate-spin w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  // ── Invalid / expired token ──────────────────────────────────────────────────
  if (!invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl shadow-2xl p-10 text-center"
        >
          <XCircle size={56} className="text-rose-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
            Invalid or Expired Invite
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mb-8">
            This invitation link is no longer valid. Please ask your administrator to send a new one.
          </p>
          <button
            onClick={() => navigate('/login')}
            className="btn bg-primary-500 hover:bg-primary-600 text-white w-full py-3"
          >
            Go to Login
          </button>
        </motion.div>
      </div>
    );
  }

  const roleLabel = invite.role === 'accountant' ? 'Accountant' : 'Employee';
  const roleColor = invite.role === 'accountant' ? 'from-sky-600 to-cyan-500' : 'from-emerald-600 to-teal-500';
  const roleBadgeColor = invite.role === 'accountant'
    ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
      {/* ── Left panel ─────────────────────────────────────────────────────── */}
      <div className={cn(
        'hidden lg:flex flex-col justify-between w-[42%] p-12 text-white bg-gradient-to-br',
        roleColor,
      )}>
        <div>
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center">
              <Users size={20} />
            </div>
            <span className="font-bold text-xl">AttendanceMS</span>
          </div>
          <h2 className="text-4xl font-extrabold leading-tight mb-4">
            You've been<br />invited to join!
          </h2>
          <p className="text-white/75 text-lg">
            Create your {roleLabel} account to get started.
          </p>
        </div>

        <div className="space-y-5">
          {features.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                <Icon size={18} />
              </div>
              <div>
                <p className="font-semibold text-sm">{title}</p>
                <p className="text-white/70 text-xs">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-white/50 text-sm">© {new Date().getFullYear()} AttendanceMS</p>
      </div>

      {/* ── Right panel (form) ──────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-6">
              <CheckCircle2 size={28} className="text-emerald-500" />
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Valid invitation
              </span>
            </div>
            <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white mb-2">
              Complete your sign-up
            </h1>
            <div className="flex items-center gap-3 mt-3">
              <span className={cn('px-3 py-1 rounded-full text-xs font-semibold', roleBadgeColor)}>
                {roleLabel}
              </span>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                Invited as: <span className="font-medium text-slate-700 dark:text-slate-200">{invite.email}</span>
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Full Name */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Full Name
              </label>
              <input
                {...register('name')}
                type="text"
                placeholder="Your full name"
                className="input-field w-full"
                autoFocus
              />
              {errors.name && (
                <p className="text-rose-500 text-xs mt-1">{errors.name.message}</p>
              )}
            </div>

            {/* Email (read-only) */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                value={invite.email}
                readOnly
                className="input-field w-full bg-slate-100 dark:bg-slate-800 cursor-not-allowed text-slate-500"
              />
              <p className="text-xs text-slate-400 mt-1">Email is set by the invitation</p>
            </div>

            {/* Employee selector (only for employee role) */}
            {invite.role === 'employee' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Select Your Name (from employee list)
                </label>
                <input
                  type="text"
                  placeholder="Search name or ID…"
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  className="input-field w-full mb-2"
                />
                <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden max-h-40 overflow-y-auto">
                  {filteredEmployees.length === 0 ? (
                    <p className="text-sm text-slate-400 p-3 text-center">No employees found</p>
                  ) : (
                    filteredEmployees.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => { setValue('employeeId', e.employeeId); setValue('name', employeeDisplayName(e)); }}
                        className={cn(
                          'w-full text-left px-4 py-2.5 text-sm transition-colors',
                          selectedEmpId === e.employeeId
                            ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-medium'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300',
                        )}
                      >
                        <span className="font-medium">{employeeDisplayName(e)}</span>
                        <span className="text-slate-400 dark:text-slate-500 ml-2 text-xs">#{e.employeeId}</span>
                      </button>
                    ))
                  )}
                </div>
                <input type="hidden" {...register('employeeId')} />
              </div>
            )}

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Create a password"
                  className="input-field w-full pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && (
                <p className="text-rose-500 text-xs mt-1">{errors.password.message}</p>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  {...register('confirmPassword')}
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Repeat your password"
                  className="input-field w-full pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-rose-500 text-xs mt-1">{errors.confirmPassword.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className={cn(
                'btn w-full py-3 text-white font-semibold text-base rounded-xl transition-all',
                invite.role === 'accountant'
                  ? 'bg-sky-500 hover:bg-sky-600'
                  : 'bg-emerald-500 hover:bg-emerald-600',
                submitting && 'opacity-60 cursor-not-allowed',
              )}
            >
              {submitting ? 'Creating account…' : 'Create Account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{' '}
            <button
              onClick={() => navigate('/login')}
              className="text-primary-500 hover:text-primary-600 font-medium"
            >
              Sign in
            </button>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
