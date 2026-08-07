import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, ShieldCheck, CheckCircle2, XCircle, Building2, Smartphone, Send } from 'lucide-react';
import { authApi } from '../../api/authApi';
import { useNotifications } from '../../contexts/NotificationContext';
import {
  extractInviteTokenFromLocation,
  normalizeInviteToken,
  type InvitationErrorReason,
} from '../../lib/inviteToken';
import { cn } from '../../lib/utils';
import type { Invitation } from '../../contexts/InvitationContext';

const schema = z
  .object({
    name: z.string().min(2, 'Full name is required'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string().min(6, 'Please confirm your password'),
    smsCode: z.string().length(6, 'Please enter the 6-digit SMS verification code'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormData = z.infer<typeof schema>;

const INVITE_ERROR_COPY: Record<InvitationErrorReason, { title: string; body: string }> = {
  expired: {
    title: 'Invitation Link Expired',
    body: 'This client-admin invitation link has expired. Please ask the application owner to send a new invitation.',
  },
  invalid_token: {
    title: 'Invalid Invitation Link',
    body: 'The invitation link is malformed or invalid. Please check the URL provided in your email.',
  },
  not_found: {
    title: 'Invitation Not Found',
    body: 'We could not locate this invitation record. It may have been revoked or created on another environment.',
  },
  already_used: {
    title: 'Invitation Already Used',
    body: 'This invitation has already been used to register a Client Administrator account. Please sign in instead.',
  },
  network: {
    title: 'Connection Error',
    body: 'Could not connect to the server to validate your invitation. Please check your internet connection and retry.',
  },
  server_error: {
    title: 'Server Error',
    body: 'An unexpected server error occurred while validating your invitation. Please try again shortly.',
  },
};

export default function ClientAdminSignupPage() {
  const navigate = useNavigate();
  const { toast } = useNotifications();

  const resolvedToken = useMemo(() => {
    return extractInviteTokenFromLocation(window.location);
  }, []);

  const [invite, setInvite] = useState<Invitation | null>(null);
  const [inviteError, setInviteError] = useState<InvitationErrorReason | null>(null);
  const [loading, setLoading] = useState(true);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // SMS resend cooldown timer (60 seconds)
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendingSms, setResendingSms] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', password: '', confirmPassword: '', smsCode: '' },
  });

  // Handle cooldown countdown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Validate invitation on mount
  useEffect(() => {
    if (!resolvedToken) {
      setInvite(null);
      setInviteError('invalid_token');
      setLoading(false);
      return;
    }

    let isMounted = true;
    (async () => {
      const result = await authApi.validateClientAdminInvite(resolvedToken);
      if (isMounted) {
        if (result.ok) {
          setInvite(result.invitation);
          setInviteError(null);
        } else {
          setInvite(null);
          setInviteError(result.reason);
        }
        setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [resolvedToken]);

  const handleResendSmsCode = async () => {
    if (!resolvedToken || resendCooldown > 0 || resendingSms) return;
    setResendingSms(true);
    try {
      const res = await authApi.resendClientAdminSms(resolvedToken);
      if (res.success) {
        toast('success', 'Verification Code Sent!', res.message || 'A new 6-digit verification code has been sent to owner email v-code@appnep.com.');
        setResendCooldown(res.remainingSeconds || 60);
      } else {
        toast('error', 'Resend Failed', res.message || 'We could not send the verification code. Please try again.');
      }
    } catch (err: any) {
      toast('error', 'Resend Error', err?.message || 'We could not send the verification code. Please try again.');
    } finally {
      setResendingSms(false);
    }
  };

  const onInvalid = (formErrors: any) => {
    const firstKey = Object.keys(formErrors)[0];
    const msg = firstKey ? formErrors[firstKey]?.message : 'Please fill in all required fields.';
    toast('error', 'Validation Error', msg || 'Please complete all required fields correctly.');
  };

  const onSubmit = async (data: FormData) => {
    if (!resolvedToken || !invite) return;
    setSubmitting(true);

    try {
      const res = await authApi.signupClientAdmin({
        token: resolvedToken,
        name: data.name.trim(),
        password: data.password,
        smsCode: data.smsCode.trim(),
      });

      if (res.success) {
        toast('success', 'Account Created Successfully!', 'Your Client Administrator account is now active. Please sign in.');
        setTimeout(() => {
          navigate('/login', { replace: true });
        }, 800);
      } else {
        toast('error', 'Registration Failed', res.message || 'Verification failed. Please check your verification code.');
      }
    } catch (err: any) {
      toast('error', 'Sign-up Error', err?.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin w-9 h-9 border-4 border-indigo-500 border-t-transparent rounded-full" />
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Verifying secure invitation token...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (!invite) {
    const copy = INVITE_ERROR_COPY[inviteError ?? 'invalid_token'];
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl shadow-2xl p-8 text-center border border-slate-200 dark:border-slate-800"
        >
          <XCircle size={56} className="text-rose-500 mx-auto mb-4" />
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white mb-2">
            {copy.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
            {copy.body}
          </p>
          <button
            onClick={() => navigate('/login')}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl transition-all shadow-md shadow-indigo-600/30"
          >
            Go to Login
          </button>
        </motion.div>
      </div>
    );
  }

  const companyDisplayName = invite.companyName || 'Client Organization';

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
      {/* Left panel branding */}
      <div className="hidden lg:flex flex-col justify-between w-[42%] p-12 text-white bg-gradient-to-br from-indigo-700 via-indigo-600 to-indigo-900">
        <div>
          <div className="flex items-center gap-3 mb-10">
            <div className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-md">
              <Building2 size={24} />
            </div>
            <span className="font-extrabold text-2xl tracking-tight">PACE Attendance</span>
          </div>

          <div className="space-y-3">
            <span className="inline-block px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-xs font-bold uppercase tracking-wider">
              Client Admin Registration
            </span>
            <h2 className="text-4xl font-black leading-tight">
              Welcome to <br />
              {companyDisplayName}
            </h2>
            <p className="text-white/80 text-base">
              Set up your administrator credentials and verify your mobile number to get started.
            </p>
          </div>
        </div>

        <div className="space-y-4 rounded-3xl bg-white/10 backdrop-blur-md p-6 border border-white/20">
          <div className="flex items-center gap-3">
            <ShieldCheck size={24} className="text-emerald-300 flex-shrink-0" />
            <div>
              <p className="font-bold text-sm">Two-Factor Mobile Verification</p>
              <p className="text-xs text-white/70">
                A 6-digit SMS verification code has been dispatched to your mobile number.
              </p>
            </div>
          </div>
        </div>

        <p className="text-white/50 text-xs">© {new Date().getFullYear()} PACE Attendance System</p>
      </div>

      {/* Right panel form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={20} />
              <span className="text-xs font-bold uppercase tracking-wider">Valid Client Admin Invitation</span>
            </div>

            <h1 className="text-2xl font-black text-slate-900 dark:text-white leading-tight">
              Create Admin Account
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Organization: <strong className="text-slate-700 dark:text-slate-200">{companyDisplayName}</strong>
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-5">
            {/* Full Name */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Full Name <span className="text-rose-500">*</span>
              </label>
              <input
                {...register('name')}
                type="text"
                placeholder="e.g. John Doe"
                className="w-full rounded-2xl border border-slate-200 bg-white py-3 px-4 text-xs font-medium text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                autoFocus
              />
              {errors.name && (
                <p className="text-rose-500 text-[11px] font-semibold mt-1">{errors.name.message}</p>
              )}
            </div>

            {/* Email Address (Pre-filled and Locked) */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Invited Email Address <span className="text-xs text-slate-400 font-normal">(Locked)</span>
              </label>
              <input
                type="email"
                value={invite.email}
                readOnly
                disabled
                className="w-full rounded-2xl border border-slate-200 bg-slate-100 py-3 px-4 text-xs font-semibold text-slate-500 cursor-not-allowed dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400"
              />
              <p className="text-[11px] text-slate-400 mt-1">This invitation is specifically assigned to your email.</p>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Password <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="At least 6 characters"
                  className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-4 pr-10 text-xs font-medium text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && (
                <p className="text-rose-500 text-[11px] font-semibold mt-1">{errors.password.message}</p>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Confirm Password <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  {...register('confirmPassword')}
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Re-enter your password"
                  className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-4 pr-10 text-xs font-medium text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((p) => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-rose-500 text-[11px] font-semibold mt-1">{errors.confirmPassword.message}</p>
              )}
            </div>

            {/* 6-Digit SMS Verification Code */}
            <div className="space-y-1.5 rounded-2xl bg-indigo-50/50 p-4 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/30">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                  <Smartphone size={15} className="text-indigo-600 dark:text-indigo-400" />
                  <span>6-Digit SMS Verification Code <span className="text-rose-500">*</span></span>
                </label>
                <button
                  type="button"
                  onClick={handleResendSmsCode}
                  disabled={resendCooldown > 0 || resendingSms}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-700 disabled:text-slate-400 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  {resendingSms ? (
                    'Sending verification code…'
                  ) : resendCooldown > 0 ? (
                    `Resend in ${resendCooldown}s`
                  ) : (
                    <>
                      <Send size={12} />
                      <span>Resend Code</span>
                    </>
                  )}
                </button>
              </div>

              <input
                {...register('smsCode')}
                type="text"
                maxLength={6}
                placeholder="123456"
                className="w-full tracking-widest text-center text-lg font-mono font-bold py-2.5 rounded-xl border border-indigo-200 bg-white text-slate-900 focus:border-indigo-600 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
              />
              {errors.smsCode ? (
                <p className="text-rose-500 text-[11px] font-semibold">{errors.smsCode.message}</p>
              ) : (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Enter the 6-digit code sent to owner email <strong className="text-indigo-600 dark:text-indigo-400 font-semibold">v-code@appnep.com</strong>.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className={cn(
                'w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-2xl transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer',
                submitting && 'opacity-60 cursor-not-allowed'
              )}
            >
              {submitting ? (
                <>
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  <span>Verifying & Creating Account...</span>
                </>
              ) : (
                <span>Verify & Create Client Admin Account</span>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-500">
            Already registered?{' '}
            <button
              onClick={() => navigate('/login')}
              className="text-indigo-600 hover:text-indigo-700 font-bold"
            >
              Sign in
            </button>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
