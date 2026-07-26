import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Eye, EyeOff, ArrowRight, Clock, Users, BarChart3, Lock, ArrowLeft, Search, Check,
} from 'lucide-react';
import { useAuth, ALLOWED_ADMIN_EMAIL, hydrateCloudAuthUsers } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { EmployeeAPI } from '../../data/store';
import { deviceApi } from '../../api/deviceApi';
import { authApi } from '../../api/authApi';
import { upsertEmployeesFromDeviceLogs } from '../../lib/deviceEmployeeSync';
import { cn } from '../../lib/utils';
import type { Employee } from '../../types';

type AuthMode = 'login' | 'signup-admin' | 'signup-employee' | 'signup-accountant' | 'admin-credentials';
type AdminStep = 'details' | 'verify';
type PortalRole = 'admin' | 'accountant' | 'employee';
type AuthAction = 'login' | 'signup';

const portalRoles: { id: PortalRole; label: string; color: string; activeColor: string }[] = [
  { id: 'admin', label: 'Admin', color: 'bg-rose-500 hover:bg-rose-600', activeColor: 'ring-2 ring-offset-2 ring-rose-400' },
  { id: 'accountant', label: 'Accountant', color: 'bg-sky-500 hover:bg-sky-600', activeColor: 'ring-2 ring-offset-2 ring-sky-400' },
  { id: 'employee', label: 'Employee', color: 'bg-emerald-500 hover:bg-emerald-600', activeColor: 'ring-2 ring-offset-2 ring-emerald-400' },
];

const loginSchema = z.object({
  email: z.string().min(2, 'User name is required'),
  password: z.string().min(3, 'Password is required'),
  rememberMe: z.boolean().optional(),
});

const adminSignupSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string().min(6, 'Confirm your password'),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

const employeeSignupSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string().min(6, 'Confirm your password'),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

const accountantSignupSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string().min(6, 'Confirm your password'),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type LoginForm = z.infer<typeof loginSchema>;
type AdminSignupForm = z.infer<typeof adminSignupSchema>;
type EmployeeSignupForm = z.infer<typeof employeeSignupSchema>;
type AccountantSignupForm = z.infer<typeof accountantSignupSchema>;

const features = [
  { icon: Clock, title: 'Real-time Tracking', desc: 'Track attendance with precision timing' },
  { icon: Users, title: 'Team Management', desc: 'Manage all departments seamlessly' },
  { icon: BarChart3, title: 'Smart Analytics', desc: 'Insights to optimize workforce' },
  { icon: Lock, title: 'Role-Based Access', desc: 'Secure, permission-controlled system' },
];

function employeeDisplayName(e: Employee) {
  return `${e.firstName} ${e.lastName}`.trim() || e.employeeId;
}

function isMachineEmployee(e: Employee) {
  return (
    e.departmentId === 'd0'
    || e.email.endsWith('@device.local')
    || e.designation === 'Synced from device'
  );
}

export default function LoginPage() {
  const {
    login,
    logout,
    signupAdmin,
    signupEmployee,
    signupAccountant,
    isEmployeeRegistered,
    getAuthUsers,
  } = useAuth();
  const { toast } = useNotifications();
  const navigate = useNavigate();

  const [selectedRole, setSelectedRole] = useState<PortalRole | null>(null);
  const [authAction, setAuthAction] = useState<AuthAction>('login');
  const [mode, setMode] = useState<AuthMode>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [adminStep, setAdminStep] = useState<AdminStep>('details');
  const [verificationCode, setVerificationCode] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [otpEmailSent, setOtpEmailSent] = useState(false);
  const [otpSendError, setOtpSendError] = useState<string | null>(null);
  const [createdAdmin, setCreatedAdmin] = useState<{ name: string; email: string; password: string } | null>(null);
  const [createdAccountant, setCreatedAccountant] = useState<{ name: string; email: string; password: string } | null>(null);

  const [machineEmployees, setMachineEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });
  const adminForm = useForm<AdminSignupForm>({
    resolver: zodResolver(adminSignupSchema),
    defaultValues: { email: ALLOWED_ADMIN_EMAIL, name: '', password: '', confirmPassword: '' },
  });
  const employeeForm = useForm<EmployeeSignupForm>({
    resolver: zodResolver(employeeSignupSchema),
  });
  const accountantForm = useForm<AccountantSignupForm>({
    resolver: zodResolver(accountantSignupSchema),
  });

  const adminUserName = useMemo(() => {
    const admin = getAuthUsers().find((u) => u.role === 'admin');
    return admin?.name?.trim() || '';
  }, [getAuthUsers, createdAdmin, mode, selectedRole]);

  useEffect(() => {
    hydrateCloudAuthUsers();
  }, []);

  useEffect(() => {
    if (selectedRole === 'admin' && mode === 'login') {
      loginForm.setValue('email', adminUserName);
      loginForm.setValue('password', '');
    } else if (mode === 'login' && selectedRole && selectedRole !== 'admin') {
      loginForm.setValue('email', '');
      loginForm.setValue('password', '');
    }
  }, [selectedRole, mode, adminUserName, loginForm]);

  useEffect(() => {
    if (mode !== 'signup-employee') return;

    let cancelled = false;
    (async () => {
      setLoadingEmployees(true);
      try {
        try {
          const logs = await deviceApi.getLogs();
          await upsertEmployeesFromDeviceLogs(logs);
        } catch {
          // Device may be offline — still show any already-synced employees
        }
        const all = await EmployeeAPI.getAll();
        if (!cancelled) {
          setMachineEmployees(all.filter(isMachineEmployee));
        }
      } finally {
        if (!cancelled) setLoadingEmployees(false);
      }
    })();

    return () => { cancelled = true; };
  }, [mode]);

  const availableEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    return machineEmployees
      .filter((e) => !isEmployeeRegistered(e.employeeId))
      .filter((e) => {
        if (!q) return true;
        const name = employeeDisplayName(e).toLowerCase();
        return name.includes(q) || e.employeeId.toLowerCase().includes(q);
      })
      .sort((a, b) => employeeDisplayName(a).localeCompare(employeeDisplayName(b)));
  }, [machineEmployees, employeeSearch, isEmployeeRegistered]);

  const selectedEmployee = machineEmployees.find((e) => e.employeeId === selectedEmployeeId) ?? null;

  const closeOtpModal = () => {
    setAdminStep('details');
    setVerificationCode('');
    setEmailVerified(false);
    setOtpEmailSent(false);
    setOtpSendError(null);
  };

  const selectRole = (role: PortalRole) => {
    setSelectedRole(role);
    setAuthAction('login');
    setMode('login');
    setShowPassword(false);
    closeOtpModal();
    setCreatedAdmin(null);
    setCreatedAccountant(null);
  };

  const chooseAuthAction = (action: AuthAction) => {
    if (!selectedRole) return;
    setAuthAction(action);
    setShowPassword(false);

    if (action === 'login') {
      setMode('login');
      return;
    }

    // Sign up for selected role
    if (selectedRole === 'admin') {
      setMode('signup-admin');
      closeOtpModal();
      setCreatedAdmin(null);
      adminForm.reset({
        email: ALLOWED_ADMIN_EMAIL,
        name: '',
        password: '',
        confirmPassword: '',
      });
      return;
    }
    if (selectedRole === 'employee') {
      setMode('signup-employee');
      setSelectedEmployeeId(null);
      setEmployeeSearch('');
      employeeForm.reset({ email: '', password: '', confirmPassword: '' });
      return;
    }
    setMode('signup-accountant');
    setCreatedAccountant(null);
    accountantForm.reset({ name: '', email: '', password: '', confirmPassword: '' });
  };

  const backToRoleSelect = () => {
    setSelectedRole(null);
    setAuthAction('login');
    setMode('login');
    setShowPassword(false);
    closeOtpModal();
  };

  const backToLogin = () => {
    setAuthAction('login');
    setMode('login');
    setShowPassword(false);
    closeOtpModal();
  };

  const onLogin = async (data: LoginForm) => {
    setLoading(true);
    const result = await login(data.email, data.password);
    if (!result.success) {
      setLoading(false);
      toast('error', 'Login failed', result.error);
      return;
    }

    const stored = localStorage.getItem('ams_user');
    let roleOk = true;
    try {
      const session = stored ? JSON.parse(stored) as { role?: string } : null;
      const role = session?.role;
      roleOk =
        !selectedRole
        || (selectedRole === 'admin' && role === 'admin')
        || (selectedRole === 'employee' && role === 'employee')
        || (selectedRole === 'accountant' && (role === 'hr' || role === 'dept_manager'));
    } catch {
      roleOk = true;
    }

    if (!roleOk) {
      logout();
      setLoading(false);
      toast(
        'error',
        'Wrong portal',
        `Use the ${portalRoles.find((r) => r.id === selectedRole)?.label ?? 'correct'} button for this account.`,
      );
      return;
    }

    setLoading(false);
    toast('success', 'Welcome back!', 'Successfully logged in.');
    navigate('/dashboard');
  };

  const sendAdminVerificationCode = async () => {
    const valid = await adminForm.trigger(['name', 'email', 'password', 'confirmPassword']);
    if (!valid) return;

    const values = adminForm.getValues();
    const signupEmail = (values.email || ALLOWED_ADMIN_EMAIL).trim().toLowerCase();
    setLoading(true);
    setOtpSendError(null);
    // Open the verification popup immediately so code entry is always visible.
    setAdminStep('verify');
    setEmailVerified(false);
    setVerificationCode('');
    setOtpEmailSent(false);
    try {
      const res = await authApi.sendAdminCode({
        name: values.name,
        email: signupEmail,
      });
      if (!res.success || !res.emailSent) {
        const message =
          res.message ||
          'Could not send verification email. Set SMTP_USER and SMTP_PASS in server/.env, then resend.';
        setOtpSendError(message);
        toast('error', 'Email not sent', message);
        return;
      }
      setOtpEmailSent(true);
      setOtpSendError(null);
      if (res.devCode) {
        setVerificationCode(res.devCode);
        toast('info', 'Dev Mode: Code Generated', `Code auto-filled: ${res.devCode}. Click Verify & Sign Up.`);
      } else {
        toast('success', 'Code sent', `Check ${signupEmail} for the verification code.`);
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not send verification email. Check SMTP settings and try again.';
      setOtpSendError(message);
      toast('error', 'Could not send code', message);
    } finally {
      setLoading(false);
    }
  };

  const onAdminSignup = async (data: AdminSignupForm) => {
    if (adminStep === 'details') {
      await sendAdminVerificationCode();
      return;
    }

    if (!otpEmailSent) {
      toast('error', 'Email not sent', 'Send the verification code first, then enter it.');
      return;
    }

    if (!verificationCode.trim()) {
      toast('error', 'Enter code', 'Enter the verification code sent to your email.');
      return;
    }

    setLoading(true);
    try {
      const verified = await authApi.verifyAdminCode({
        email: ALLOWED_ADMIN_EMAIL,
        code: verificationCode.trim(),
      });
      if (!verified.success || !verified.verified) {
        toast('error', 'Verification failed', verified.message || 'Invalid code');
        setLoading(false);
        return;
      }
      setEmailVerified(true);

      const result = await signupAdmin({
        name: data.name,
        email: data.email,
        password: data.password,
        emailVerified: true,
      });

      if (result.success) {
        setCreatedAdmin({
          name: data.name.trim(),
          email: ALLOWED_ADMIN_EMAIL,
          password: data.password,
        });
        closeOtpModal();
        setMode('admin-credentials');
        toast('success', 'Admin account created', 'Save your login details below.');
      } else {
        toast('error', 'Sign up failed', result.error);
      }
    } catch (err) {
      toast('error', 'Verification failed', err instanceof Error ? err.message : 'Try again');
    } finally {
      setLoading(false);
    }
  };

  const onEmployeeSignup = async (data: EmployeeSignupForm) => {
    if (!selectedEmployee) {
      toast('error', 'Select your name', 'Choose your name from the machine list.');
      return;
    }
    setLoading(true);
    const result = await signupEmployee({
      name: employeeDisplayName(selectedEmployee),
      email: data.email,
      password: data.password,
      employeeId: selectedEmployee.employeeId,
      departmentId: selectedEmployee.departmentId,
    });
    setLoading(false);
    if (result.success) {
      toast('success', 'Account created', 'You are now signed in.');
      navigate('/dashboard');
    } else {
      toast('error', 'Sign up failed', result.error);
    }
  };

  const onAccountantSignup = async (data: AccountantSignupForm) => {
    setLoading(true);
    const result = await signupAccountant({
      name: data.name,
      email: data.email,
      password: data.password,
    });
    setLoading(false);
    if (result.success) {
      setCreatedAccountant({
        name: data.name.trim(),
        email: data.email.trim().toLowerCase(),
        password: data.password,
      });
      setMode('admin-credentials');
      toast('success', 'Accountant account created', 'Save your login details below.');
    } else {
      toast('error', 'Sign up failed', result.error);
    }
  };

  const credentialsAccount = createdAdmin ?? createdAccountant;

  const title =
    mode === 'signup-admin' ? 'Create admin account'
      : mode === 'signup-employee' ? 'Create employee account'
        : mode === 'signup-accountant' ? 'Create accountant account'
          : mode === 'admin-credentials' ? 'Account ready'
            : selectedRole
              ? `Welcome, ${portalRoles.find((r) => r.id === selectedRole)?.label ?? ''}`
              : 'Welcome back 👋';

  const subtitle =
    mode === 'signup-admin'
      ? `Only ${ALLOWED_ADMIN_EMAIL} can register as admin.`
      : mode === 'signup-employee' ? 'Pick your name from employees connected to the attendance machine.'
        : mode === 'signup-accountant' ? 'Create an accountant account to access reports and attendance.'
          : mode === 'admin-credentials' ? 'Save these details — use them to sign in.'
            : selectedRole
              ? authAction === 'login'
                ? 'Sign in to your account to continue'
                : 'Create your account to continue'
              : 'Choose your role to continue';

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
      {/* ── Left panel ── */}
      <div className="hidden lg:flex lg:w-2/5 xl:w-2/5 relative overflow-hidden bg-white border-r border-slate-200">
        <div className="relative z-10 flex flex-col justify-center px-16 py-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-12"
          >
            <img
              src="/images/logo-with-name.png"
              alt="PACE Consultant (P.) Ltd."
              className="h-20 xl:h-28 w-auto object-contain"
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mb-12"
          >
            <h2 className="text-4xl xl:text-5xl font-bold leading-tight mb-4 text-slate-900">
              Smart Workforce<br />Management Platform
            </h2>
            <p className="text-slate-500 text-lg leading-relaxed max-w-md">
              Streamline attendance tracking, leave management, and team insights with AI-powered automation.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="grid grid-cols-2 gap-4"
          >
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 + i * 0.08 }}
                className="flex items-start gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200"
              >
                <div className="w-9 h-9 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center flex-shrink-0">
                  <f.icon size={16} />
                </div>
                <div>
                  <p className="font-semibold text-sm text-slate-900">{f.title}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="flex gap-8 mt-12"
          >
            {[
              { value: '12+', label: 'Employees' },
              { value: '6', label: 'Departments' },
              { value: '99.9%', label: 'Uptime' },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
                <p className="text-slate-500 text-sm">{stat.label}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 flex items-center justify-center px-8 py-16 lg:px-16 lg:py-20">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="w-full max-w-md"
        >
          <div className="mb-12 lg:hidden">
            <img
              src="/images/logo-with-name.png"
              alt="PACE Consultant (P.) Ltd."
              className="h-14 w-auto object-contain"
            />
          </div>

          <div className="mb-8">
            {(mode !== 'login' || selectedRole) && mode !== 'admin-credentials' && (
              <button
                type="button"
                onClick={() => {
                  if (mode !== 'login') backToLogin();
                  else backToRoleSelect();
                }}
                className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4"
              >
                <ArrowLeft size={14} />
                {mode !== 'login' ? 'Back to Log in' : 'Back to roles'}
              </button>
            )}
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">{title}</h2>
            <p className="text-slate-500 dark:text-slate-400">{subtitle}</p>
          </div>

          {/* Role selection — Admin / Accountant / Employee */}
          {mode !== 'admin-credentials' && (
            <div className="mb-6">
              <p className="text-xs font-medium text-slate-500 mb-2">Continue as:</p>
              <div className="flex gap-2 flex-wrap">
                {portalRoles.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => selectRole(role.id)}
                    className={cn(
                      'flex items-center justify-center gap-2 px-5 py-3 min-w-[110px] rounded-xl text-sm font-semibold text-white transition-all hover:scale-105 active:scale-95',
                      role.color,
                      selectedRole === role.id && role.activeColor,
                    )}
                  >
                    {role.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Log in / Sign up — shown after a role is chosen */}
          {selectedRole && mode !== 'admin-credentials' && (
            <div className="mb-6">
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => chooseAuthAction('login')}
                  className={cn(
                    'py-2.5 rounded-lg text-sm font-semibold transition-all',
                    authAction === 'login'
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-700',
                  )}
                >
                  Log in
                </button>
                <button
                  type="button"
                  onClick={() => chooseAuthAction('signup')}
                  className={cn(
                    'py-2.5 rounded-lg text-sm font-semibold transition-all',
                    authAction === 'signup'
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-700',
                  )}
                >
                  Sign up
                </button>
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            {mode === 'login' && selectedRole && (
              <motion.form
                key="login"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                onSubmit={loginForm.handleSubmit(onLogin)}
                className="space-y-5"
              >
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    User Name
                  </label>
                  <input
                    {...loginForm.register('email')}
                    type="text"
                    readOnly={selectedRole === 'admin'}
                    tabIndex={selectedRole === 'admin' ? -1 : undefined}
                    placeholder={selectedRole === 'admin' ? (adminUserName || 'No admin yet — please sign up') : 'User name'}
                    autoComplete="username"
                    className={cn(
                      'input',
                      selectedRole === 'admin' && 'input-email-dim',
                      loginForm.formState.errors.email && 'border-rose-400 focus:border-rose-400 focus:ring-rose-500/20',
                    )}
                  />
                  {loginForm.formState.errors.email && (
                    <p className="text-xs text-rose-500 mt-1">{loginForm.formState.errors.email.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Password
                  </label>
                  <input
                    {...loginForm.register('password')}
                    type="password"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    autoFocus={selectedRole === 'admin'}
                    className={cn(
                      'input',
                      loginForm.formState.errors.password && 'border-rose-400 focus:border-rose-400 focus:ring-rose-500/20',
                    )}
                  />
                  {loginForm.formState.errors.password && (
                    <p className="text-xs text-rose-500 mt-1">{loginForm.formState.errors.password.message}</p>
                  )}
                </div>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    {...loginForm.register('rememberMe')}
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 text-primary-600 accent-primary-600"
                  />
                  <span className="text-sm text-slate-600 dark:text-slate-400">Remember me for 30 days</span>
                </label>

                <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 text-base font-semibold">
                  {loading ? (
                    <span className="flex items-center gap-2 justify-center">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Signing in...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 justify-center">
                      Sign In
                      <ArrowRight size={16} />
                    </span>
                  )}
                </button>
              </motion.form>
            )}

            {mode === 'signup-admin' && (
              <motion.form
                key="signup-admin"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                onSubmit={adminForm.handleSubmit(onAdminSignup)}
                className="space-y-5"
              >
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">User Name</label>
                  <input
                    {...adminForm.register('name')}
                    type="text"
                    placeholder="User name"
                    className={cn('input', adminForm.formState.errors.name && 'border-rose-400')}
                  />
                  {adminForm.formState.errors.name && (
                    <p className="text-xs text-rose-500 mt-1">{adminForm.formState.errors.name.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Admin email</label>
                  <input
                    {...adminForm.register('email')}
                    type="email"
                    readOnly
                    tabIndex={-1}
                    className="input input-email-dim"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Fixed — verification code is sent to this email.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      {...adminForm.register('password')}
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      className={cn('input pr-10', adminForm.formState.errors.password && 'border-rose-400')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {adminForm.formState.errors.password && (
                    <p className="text-xs text-rose-500 mt-1">{adminForm.formState.errors.password.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirm password</label>
                  <input
                    {...adminForm.register('confirmPassword')}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    className={cn('input', adminForm.formState.errors.confirmPassword && 'border-rose-400')}
                  />
                  {adminForm.formState.errors.confirmPassword && (
                    <p className="text-xs text-rose-500 mt-1">{adminForm.formState.errors.confirmPassword.message}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full py-2.5 text-base font-semibold disabled:opacity-60"
                >
                  {loading ? 'Sending code...' : 'Send verification code'}
                </button>
              </motion.form>
            )}

            {mode === 'admin-credentials' && credentialsAccount && (
              <motion.div
                key="admin-credentials"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                className="space-y-5"
              >
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 space-y-4">
                  <p className="text-sm font-semibold text-emerald-800">Your login credentials</p>
                  <div>
                    <p className="text-xs text-emerald-700 mb-1">User Name</p>
                    <p className="text-base font-bold text-slate-900">{credentialsAccount.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-emerald-700 mb-1">Email</p>
                    <p className="text-base font-semibold text-slate-900 break-all">{credentialsAccount.email}</p>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-primary w-full py-2.5 text-base font-semibold"
                  onClick={() => {
                    loginForm.setValue('email', credentialsAccount.name);
                    loginForm.setValue('password', '');
                    setAuthAction('login');
                    setMode('login');
                    setCreatedAdmin(null);
                    setCreatedAccountant(null);
                    toast('info', 'Ready to sign in', 'Enter your password to continue.');
                  }}
                >
                  Continue to Sign In
                  <ArrowRight size={16} className="inline ml-2" />
                </button>
              </motion.div>
            )}

            {mode === 'signup-accountant' && (
              <motion.form
                key="signup-accountant"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                onSubmit={accountantForm.handleSubmit(onAccountantSignup)}
                className="space-y-5"
              >
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Full name</label>
                  <input
                    {...accountantForm.register('name')}
                    type="text"
                    placeholder="Your name"
                    className={cn('input', accountantForm.formState.errors.name && 'border-rose-400')}
                  />
                  {accountantForm.formState.errors.name && (
                    <p className="text-xs text-rose-500 mt-1">{accountantForm.formState.errors.name.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Email Address</label>
                  <input
                    {...accountantForm.register('email')}
                    type="email"
                    placeholder="you@pacenp.com"
                    className={cn('input', accountantForm.formState.errors.email && 'border-rose-400')}
                  />
                  {accountantForm.formState.errors.email && (
                    <p className="text-xs text-rose-500 mt-1">{accountantForm.formState.errors.email.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      {...accountantForm.register('password')}
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      className={cn('input pr-10', accountantForm.formState.errors.password && 'border-rose-400')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {accountantForm.formState.errors.password && (
                    <p className="text-xs text-rose-500 mt-1">{accountantForm.formState.errors.password.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirm password</label>
                  <input
                    {...accountantForm.register('confirmPassword')}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    className={cn('input', accountantForm.formState.errors.confirmPassword && 'border-rose-400')}
                  />
                  {accountantForm.formState.errors.confirmPassword && (
                    <p className="text-xs text-rose-500 mt-1">{accountantForm.formState.errors.confirmPassword.message}</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full py-2.5 text-base font-semibold disabled:opacity-60"
                >
                  {loading ? 'Creating account...' : 'Sign Up as Accountant'}
                </button>
              </motion.form>
            )}

            {mode === 'signup-employee' && (
              <motion.form
                key="signup-employee"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                onSubmit={employeeForm.handleSubmit(onEmployeeSignup)}
                className="space-y-5"
              >
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Your name on the machine
                  </label>
                  <div className="relative mb-2">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="search"
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                      placeholder="Search employees..."
                      className="input pl-9"
                    />
                  </div>

                  <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                    {loadingEmployees && (
                      <p className="px-4 py-6 text-sm text-center text-slate-400">Loading machine employees...</p>
                    )}
                    {!loadingEmployees && availableEmployees.length === 0 && (
                      <p className="px-4 py-6 text-sm text-center text-slate-400">
                        No machine-connected employees found. Sync the attendance device first, then try again.
                      </p>
                    )}
                    {!loadingEmployees && availableEmployees.map((emp) => {
                      const name = employeeDisplayName(emp);
                      const selected = selectedEmployeeId === emp.employeeId;
                      return (
                        <button
                          key={emp.employeeId}
                          type="button"
                          onClick={() => setSelectedEmployeeId(emp.employeeId)}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
                            selected ? 'bg-primary-50' : 'hover:bg-slate-50',
                          )}
                        >
                          <img
                            src={emp.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`}
                            alt=""
                            className="w-8 h-8 rounded-full bg-slate-100"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-900 truncate">{name}</p>
                            <p className="text-xs text-slate-400">ID {emp.employeeId}</p>
                          </div>
                          {selected && <Check size={16} className="text-primary-600 flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                  {!selectedEmployeeId && (
                    <p className="text-xs text-slate-400 mt-1">Scroll and select your name from the list.</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Email Address</label>
                  <input
                    {...employeeForm.register('email')}
                    type="email"
                    placeholder="you@company.com"
                    className={cn('input', employeeForm.formState.errors.email && 'border-rose-400')}
                  />
                  {employeeForm.formState.errors.email && (
                    <p className="text-xs text-rose-500 mt-1">{employeeForm.formState.errors.email.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      {...employeeForm.register('password')}
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      className={cn('input pr-10', employeeForm.formState.errors.password && 'border-rose-400')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {employeeForm.formState.errors.password && (
                    <p className="text-xs text-rose-500 mt-1">{employeeForm.formState.errors.password.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirm password</label>
                  <input
                    {...employeeForm.register('confirmPassword')}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    className={cn('input', employeeForm.formState.errors.confirmPassword && 'border-rose-400')}
                  />
                  {employeeForm.formState.errors.confirmPassword && (
                    <p className="text-xs text-rose-500 mt-1">{employeeForm.formState.errors.confirmPassword.message}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || !selectedEmployeeId}
                  className="btn-primary w-full py-2.5 text-base font-semibold disabled:opacity-60"
                >
                  {loading ? 'Creating account...' : 'Sign Up as Employee'}
                </button>
              </motion.form>
            )}
          </AnimatePresence>

          <p className="text-center text-xs text-slate-400 mt-8">
            © 2026 AttendAI. Enterprise Attendance Management System.
          </p>
        </motion.div>
      </div>

      <AnimatePresence>
        {mode === 'signup-admin' && adminStep === 'verify' && (
          <motion.div
            key="admin-otp-modal"
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="otp-dialog-title"
          >
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/55 backdrop-blur-sm"
              aria-label="Close verification dialog"
              onClick={closeOtpModal}
            />
            <motion.div
              className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            >
              <div className="mb-5 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/40">
                  <Lock className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                </div>
                <h3 id="otp-dialog-title" className="text-lg font-semibold text-slate-900 dark:text-white">
                  Enter verification code
                </h3>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                  {otpEmailSent
                    ? <>We emailed a 6-digit code to <span className="font-medium text-slate-700 dark:text-slate-200">{ALLOWED_ADMIN_EMAIL}</span>. It expires in 10 minutes.</>
                    : loading
                      ? 'Sending verification code…'
                      : 'Enter the code from your email once delivery succeeds.'}
                </p>
              </div>

              {otpSendError && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100">
                  {otpSendError}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="admin-otp-input">
                    Verification code
                  </label>
                  <input
                    id="admin-otp-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    disabled={!otpEmailSent || loading}
                    className="input tracking-[0.4em] text-center text-2xl font-semibold disabled:opacity-60"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && otpEmailSent && verificationCode.length === 6 && !loading) {
                        e.preventDefault();
                        void adminForm.handleSubmit(onAdminSignup)();
                      }
                    }}
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void sendAdminVerificationCode()}
                    className="btn-secondary flex-1"
                  >
                    {loading ? 'Sending…' : otpEmailSent ? 'Resend code' : 'Retry send'}
                  </button>
                  <button
                    type="button"
                    disabled={loading || !otpEmailSent || verificationCode.length < 6}
                    onClick={() => void adminForm.handleSubmit(onAdminSignup)()}
                    className="btn-primary flex-1 disabled:opacity-60"
                  >
                    {loading ? 'Verifying…' : 'Verify & Sign Up'}
                  </button>
                </div>

                <button type="button" className="btn-ghost w-full text-sm" onClick={closeOtpModal}>
                  ← Back to details
                </button>

                {emailVerified && (
                  <p className="text-xs text-center text-emerald-600">Email verified</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
