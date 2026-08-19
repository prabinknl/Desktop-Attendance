import React, { useEffect, useMemo, useState } from 'react';
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
import { deviceApi } from '../../api/deviceApi';
import { upsertEmployeesFromDeviceLogs } from '../../lib/deviceEmployeeSync';
import { cn } from '../../lib/utils';
import type { Employee } from '../../types';
import {
  extractInviteTokenFromLocation,
  normalizeInviteToken,
  type InvitationErrorReason,
} from '../../lib/inviteToken';

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

const INVITE_ERROR_COPY: Record<InvitationErrorReason, { title: string; body: string }> = {
  expired: {
    title: 'Invitation link expired',
    body: 'This invitation is no longer valid. Please ask your administrator to send a new one.',
  },
  invalid_token: {
    title: 'Invalid invitation link',
    body: 'The invitation link is malformed. Please check the link or ask your administrator for a new invite.',
  },
  not_found: {
    title: 'Invitation not found',
    body: 'We could not find this invitation. It may have been revoked or created on a different server.',
  },
  already_used: {
    title: 'Invitation already used',
    body: 'This invitation has already been used to create an account. Try signing in instead.',
  },
  network: {
    title: 'Unable to verify invitation',
    body: 'Could not reach the server to validate your invitation. Check your connection and try again.',
  },
  server_error: {
    title: 'Server error',
    body: 'Something went wrong while validating your invitation. Please try again shortly.',
  },
};

export default function InviteSignupPage() {
  const { token: routeToken } = useParams<{ token: string }>();
  const resolvedToken = useMemo(() => {
    if (routeToken) {
      const normalized = normalizeInviteToken(routeToken);
      if (normalized) return normalized;
    }
    return extractInviteTokenFromLocation(window.location);
  }, [routeToken]);
  const navigate = useNavigate();
  const { fetchInvitation, markUsed } = useInvitations();
  const { signupEmployee, signupAccountant, isEmployeeRegistered } = useAuth();
  const { toast } = useNotifications();

  const [invite, setInvite] = useState<import('../../contexts/InvitationContext').Invitation | null>(null);
  const [inviteError, setInviteError] = useState<InvitationErrorReason | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [empSearch, setEmpSearch] = useState('');
  const [manualCode, setManualCode] = useState('');

  const handleVerifyManualCode = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = normalizeInviteToken(manualCode);
    if (!clean) {
      toast('error', 'Invalid Code', 'Please enter a valid 6-digit invitation code.');
      return;
    }
    setLoading(true);
    navigate(`/invite/${clean}`);
  };

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', employeeId: '' },
  });

  const selectedEmpId = watch('employeeId');

  useEffect(() => {
    if (!resolvedToken) {
      setInvite(null);
      setInviteError('invalid_token');
      setLoading(false);
      return;
    }
    let isMounted = true;
    (async () => {
      const result = await fetchInvitation(resolvedToken);
      if (isMounted) {
        if (result.ok) {
          setInvite(result.invitation);
          if (result.invitation.name) {
            setValue('name', result.invitation.name, { shouldValidate: true, shouldDirty: true });
          }
          setInviteError(null);
        } else {
          setInvite(null);
          setInviteError(result.reason);
        }
        setLoading(false);
      }
    })();
    return () => { isMounted = false; };
  }, [resolvedToken, fetchInvitation]);

  useEffect(() => {
    if (invite?.role === 'employee') {
      let cancelled = false;
      (async () => {
        try {
          const logs = await deviceApi.getLogs();
          await upsertEmployeesFromDeviceLogs(logs);
        } catch {
          /* ignore if device offline */
        }
        const list = await EmployeeAPI.getAll();
        if (!cancelled) {
          setEmployees(list);
        }
      })();
      return () => { cancelled = true; };
    }
  }, [invite]);

  const availableEmployees = useMemo(() => {
    return employees;
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    return availableEmployees
      .filter((e) => {
        if (!q) return true;
        const name = employeeDisplayName(e).toLowerCase();
        const code = (e.employeeId || e.id || '').toLowerCase();
        return name.includes(q) || code.includes(q);
      })
      .sort((a, b) => employeeDisplayName(a).localeCompare(employeeDisplayName(b)));
  }, [availableEmployees, empSearch]);

  const onSubmit = async (data: FormData) => {
    if (!invite || !resolvedToken) return;
    setSubmitting(true);

    try {
      let result: { success: boolean; error?: string };

      if (invite.role === 'employee') {
        const matchedEmp = employees.find(
          (e) =>
            employeeDisplayName(e).toLowerCase() === (data.name || '').trim().toLowerCase() ||
            (e.email && e.email.toLowerCase() === invite.email.toLowerCase())
        );
        const effectiveEmployeeId = data.employeeId || matchedEmp?.employeeId || matchedEmp?.id || `emp-${Date.now()}`;
        const finalName = data.name.trim() || (matchedEmp ? employeeDisplayName(matchedEmp) : invite.email.split('@')[0]);

        result = await signupEmployee({
          name: finalName,
          email: invite.email,
          password: data.password,
          employeeId: effectiveEmployeeId,
        });
      } else {
        result = await signupAccountant({
          name: data.name.trim() || invite.email.split('@')[0],
          email: invite.email,
          password: data.password,
        });
      }

      if (result.success) {
        markUsed(resolvedToken);
        toast('success', 'Account Created Successfully', 'Welcome! Redirecting to your account...');
        setTimeout(() => {
          navigate('/dashboard', { replace: true });
        }, 500);
      } else {
        toast('error', 'Sign-up Failed', result.error ?? 'Could not create account');
      }
    } catch (err: any) {
      toast('error', 'Sign-up Error', err?.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const onInvalid = (fieldErrors: typeof errors) => {
    if (fieldErrors.name) {
      toast('error', 'Full Name Required', fieldErrors.name.message || 'Please click your name from the employee list below.');
    } else if (fieldErrors.confirmPassword) {
      toast('error', 'Password Mismatch', fieldErrors.confirmPassword.message || 'Passwords do not match.');
    } else if (fieldErrors.password) {
      toast('error', 'Password Required', fieldErrors.password.message || 'Password must be at least 6 characters.');
    } else {
      toast('error', 'Incomplete Form', 'Please complete all required fields before clicking Create Account.');
    }
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
    const copy = INVITE_ERROR_COPY[inviteError ?? 'invalid_token'];
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl shadow-2xl p-8 text-center space-y-6"
        >
          <XCircle size={56} className="text-rose-500 mx-auto" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
              {copy.title}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              {copy.body}
            </p>
          </div>

          {/* Code input fallback */}
          <form onSubmit={handleVerifyManualCode} className="pt-2 text-left space-y-2.5">
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Enter 6-digit Invitation Code
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. 849201"
                maxLength={64}
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                className="input flex-1 font-mono tracking-wider font-semibold text-center"
              />
              <button
                type="submit"
                className="btn bg-primary-500 hover:bg-primary-600 text-white font-semibold px-4 py-2.5 rounded-xl text-sm"
              >
                Verify Code
              </button>
            </div>
          </form>

          <div className="pt-2 flex gap-3">
            <button
              onClick={() => navigate('/login')}
              className="btn border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 w-full py-3"
            >
              Go to Login
            </button>
          </div>
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
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <span className={cn('px-3 py-1 rounded-full text-xs font-semibold', roleBadgeColor)}>
                {roleLabel}
              </span>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {invite.name ? (
                  <>
                    Invited: <strong className="font-semibold text-slate-700 dark:text-slate-200">{invite.name}</strong> ({invite.email})
                  </>
                ) : (
                  <>
                    Invited as: <span className="font-medium text-slate-700 dark:text-slate-200">{invite.email}</span>
                  </>
                )}
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-5">
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
                <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {filteredEmployees.length === 0 ? (
                    <p className="text-sm text-slate-400 p-4 text-center">No employees found</p>
                  ) : (
                    filteredEmployees.map((e) => {
                      const empId = e.employeeId || e.id;
                      const name = employeeDisplayName(e);
                      const isSelected = selectedEmpId === empId;
                      return (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => {
                            setValue('employeeId', empId, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
                            setValue('name', name, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
                          }}
                          className={cn(
                            'w-full text-left px-4 py-3 flex items-center justify-between text-sm transition-colors',
                            isSelected
                              ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-bold'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300',
                          )}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={e.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`}
                              alt=""
                              className="w-8 h-8 rounded-full bg-slate-100 flex-shrink-0 object-cover"
                            />
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900 dark:text-white truncate">{name}</p>
                              <p className="text-xs text-slate-400 truncate">
                                ID: #{empId} {e.designation ? `· ${e.designation}` : ''}
                              </p>
                            </div>
                          </div>
                          {isSelected && (
                            <span className="ml-2 flex-shrink-0 text-emerald-500 font-bold text-xs">Selected</span>
                          )}
                        </button>
                      );
                    })
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
