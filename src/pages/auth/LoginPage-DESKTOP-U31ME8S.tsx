import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Eye, EyeOff, ArrowRight, Clock, Users, BarChart3, Lock, ArrowLeft, Mail,
} from 'lucide-react';
import { useAuth, ALLOWED_ADMIN_EMAIL, OWNER_SIGNIN_EMAILS, formatEmailList, hydrateCloudAuthUsers } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { EmployeeAPI } from '../../data/store';
import { deviceApi } from '../../api/deviceApi';
import { authApi } from '../../api/authApi';
import { upsertEmployeesFromDeviceLogs } from '../../lib/deviceEmployeeSync';
import { cn } from '../../lib/utils';
import type { Employee } from '../../types';

type AuthMode = 'login' | 'signup-admin' | 'signup-employee' | 'signup-accountant' | 'admin-credentials';
type AdminSignupStep = 'code' | 'details';
type PortalRole = 'admin' | 'owner' | 'accountant' | 'employee';
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
  email: z.string().optional(),
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

function persistInvitedAdminLocally(input: {
  name: string;
  email: string;
  password: string;
  phone?: string;
  companyName?: string;
}) {
  try {
    const raw = localStorage.getItem('ams_auth_users');
    const users = raw ? JSON.parse(raw) as Array<Record<string, unknown>> : [];
    const email = input.email.trim().toLowerCase();
    const created = {
      id: `u-admin-${Date.now()}`,
      name: input.name.trim() || 'Admin',
      email,
      role: 'admin',
      password: input.password,
      phone: input.phone || '',
      timezone: 'Asia/Kathmandu',
      companyName: input.companyName,
      planType: 'free',
    };
    const next = [...users.filter((u) => String(u.email || '').toLowerCase() !== email), created];
    localStorage.setItem('ams_auth_users', JSON.stringify(next));
  } catch {
    /* ignore quota / parse errors */
  }
}

export default function LoginPage() {
  const {
    login,
    loginOwner,
    logout,
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
  const [ownerMode, setOwnerMode] = useState<'intro' | 'code'>('intro');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ownerCode, setOwnerCode] = useState('');
  const [ownerCodeSentAt, setOwnerCodeSentAt] = useState<number | null>(null);
  const [ownerResendSeconds, setOwnerResendSeconds] = useState(0);

  const [adminSignupStep, setAdminSignupStep] = useState<AdminSignupStep>('code');
  const [adminInviteCode, setAdminInviteCode] = useState('');
  const [adminInvitePhone, setAdminInvitePhone] = useState('');
  const [verifiedAdminInvite, setVerifiedAdminInvite] = useState<{
    email: string;
    name: string;
    companyName?: string;
    phone?: string;
  } | null>(null);
  const [createdAdmin, setCreatedAdmin] = useState<{ name: string; email: string; password: string } | null>(null);
  const [createdAccountant, setCreatedAccountant] = useState<{ name: string; email: string; password: string } | null>(null);

  const [machineEmployees, setMachineEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [inviteInputToken, setInviteInputToken] = useState('');

  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });
  const adminForm = useForm<AdminSignupForm>({
    resolver: zodResolver(adminSignupSchema),
    defaultValues: { email: '', name: '', password: '', confirmPassword: '' },
  });
  const employeeForm = useForm<EmployeeSignupForm>({
    resolver: zodResolver(employeeSignupSchema),
  });
  const accountantForm = useForm<AccountantSignupForm>({
    resolver: zodResolver(accountantSignupSchema),
  });

  const adminUserName = useMemo(() => {
    if (createdAdmin?.name?.trim()) return createdAdmin.name.trim();
    const admin = getAuthUsers().find((u) => u.role === 'admin');
    return admin?.name?.trim() || '';
  }, [getAuthUsers, createdAdmin, mode, selectedRole]);

  useEffect(() => {
    hydrateCloudAuthUsers();
  }, []);

  useEffect(() => {
    if (selectedRole === 'admin' && mode === 'login') {
      loginForm.setValue('email', adminUserName || ALLOWED_ADMIN_EMAIL);
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

  useEffect(() => {
    if (!ownerCodeSentAt) return;
    const tick = () => {
      const remaining = Math.max(0, 60 - Math.floor((Date.now() - ownerCodeSentAt) / 1000));
      setOwnerResendSeconds(remaining);
      if (remaining === 0) return;
      const id = window.setTimeout(tick, 1000);
      return () => window.clearTimeout(id);
    };
    const id = window.setTimeout(tick, 1000);
    return () => window.clearTimeout(id);
  }, [ownerCodeSentAt]);

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

  const resetAdminSignup = () => {
    setAdminSignupStep('code');
    setAdminInviteCode('');
    setAdminInvitePhone('');
    setVerifiedAdminInvite(null);
    adminForm.reset({ email: '', name: '', password: '', confirmPassword: '' });
  };

  const handleOwnerClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!e.ctrlKey && !e.metaKey) {
      return;
    }
    setSelectedRole('owner');
    setOwnerMode('intro');
    setMode('login');
    setAuthAction('login');
  };

  const selectRole = (role: PortalRole) => {
    setSelectedRole(role);
    setAuthAction('login');
    setMode('login');
    setShowPassword(false);
    resetAdminSignup();
    setCreatedAdmin(null);
    setCreatedAccountant(null);
  };

  const chooseAuthAction = (action: AuthAction) => {
    if (!selectedRole) return;
    setAuthAction(action);
    setShowPassword(false);

    if (action === 'login') {
      setMode('login');
      resetAdminSignup();
      return;
    }

    if (selectedRole === 'admin') {
      setMode('signup-admin');
      resetAdminSignup();
      return;
    }

    // Sign up for selected role
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
    resetAdminSignup();
  };

  const backToLogin = () => {
    setAuthAction('login');
    setMode('login');
    setShowPassword(false);
    resetAdminSignup();
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
        || (selectedRole === 'owner' && role === 'owner')
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

  const verifyAdminInviteCode = async () => {
    const trimmed = adminInviteCode.trim();
    const phone = adminInvitePhone.trim();
    if (!trimmed) {
      toast('error', 'Enter code', 'Enter the invitation code provided by the Owner.');
      return;
    }
    if (!phone) {
      toast('error', 'Enter phone number', 'Enter the phone number from the Owner invitation.');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.verifyAdminInvite({ code: trimmed, phone });
      if (!res.success || !res.data) {
        toast('error', 'Verification failed', res.message || 'Invalid or expired invitation code.');
        return;
      }
      setVerifiedAdminInvite({ ...res.data, phone });
      adminForm.reset({
        name: res.data.name,
        email: res.data.email,
        password: '',
        confirmPassword: '',
      });
      setAdminSignupStep('details');
    } catch (err) {
      toast('error', 'Verification failed', err instanceof Error ? err.message : 'Invalid or expired invitation code.');
    } finally {
      setLoading(false);
    }
  };

  const sendOwnerVerificationCode = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await authApi.sendAdminCode({ name: 'Owner', emails: OWNER_SIGNIN_EMAILS });
      if (!res.success || !res.emailSent) {
        toast('error', 'Verification failed', res.message || 'Could not send the owner verification code.');
        return;
      }
      setOwnerCode('');
      setOwnerCodeSentAt(Date.now());
      setOwnerResendSeconds(60);
      setOwnerMode('code');
      toast('success', 'Verification code sent', `A verification code was sent to ${formatEmailList(OWNER_SIGNIN_EMAILS)}.`);
      if (res.devCode) {
        toast('info', `Verification Code: ${res.devCode}`, `Dev Mode: code is ${res.devCode}`);
      }
    } catch (err) {
      toast('error', 'Network error', err instanceof Error ? err.message : 'Could not reach the server.');
    } finally {
      setLoading(false);
    }
  };

  const verifyOwnerCode = async () => {
    const trimmed = ownerCode.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      toast('error', 'Invalid code', 'Enter the 6-digit verification code.');
      return;
    }
    setLoading(true);
    try {
      const verified = await authApi.verifyAdminCode({ email: OWNER_SIGNIN_EMAILS[0], code: trimmed });
      if (!verified.success || !verified.verified) {
        toast('error', 'Verification failed', verified.message || 'Invalid or expired code.');
        return;
      }
      const result = await loginOwner();
      if (!result.success) {
        toast('error', 'Owner sign in failed', result.error || 'Could not sign in as owner.');
        return;
      }
      toast('success', 'Welcome back!', 'Owner sign in completed.');
      navigate('/dashboard');
    } catch (err) {
      toast('error', 'Network error', err instanceof Error ? err.message : 'Could not verify the code.');
    } finally {
      setLoading(false);
    }
  };

  const onAdminSignup = async (data?: AdminSignupForm) => {
    if (!verifiedAdminInvite) {
      toast('error', 'Verify code first', 'Enter and verify the Owner invitation code first.');
      setAdminSignupStep('code');
      return;
    }

    const values = data ?? adminForm.getValues();
    const name = (values.name || verifiedAdminInvite.name || '').trim();
    const email = (verifiedAdminInvite.email || values.email || '').trim().toLowerCase();
    const password = String(values.password || '');
    const confirmPassword = String(values.confirmPassword || '');
    const phone = (verifiedAdminInvite.phone || adminInvitePhone).trim();
    const code = adminInviteCode.trim();

    if (name.length < 2) {
      toast('error', 'Check the form', 'Name is required.');
      return;
    }
    if (!email.includes('@')) {
      toast('error', 'Check the form', 'Invitation email is missing. Verify the code again.');
      setAdminSignupStep('code');
      return;
    }
    if (password.length < 6) {
      toast('error', 'Check the form', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      toast('error', 'Check the form', 'Passwords do not match.');
      return;
    }

    persistInvitedAdminLocally({
      name,
      email,
      password,
      phone,
      companyName: verifiedAdminInvite.companyName,
    });

    setCreatedAdmin({ name, email, password: '' });
    loginForm.setValue('email', name || email);
    loginForm.setValue('password', '');
    setAuthAction('login');
    setMode('login');
    setAdminSignupStep('code');
    setAdminInviteCode('');
    setAdminInvitePhone('');
    setVerifiedAdminInvite(null);
    toast('success', 'Admin account created successfully. You can now log in.');

    void authApi.registerAdminWithInvite({ code, phone, name, password }).catch(() => {
      /* Local account is already saved so login still works. */
    });
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
    mode === 'signup-admin' && adminSignupStep === 'code' ? 'Admin Sign Up — Verify Invitation'
      : mode === 'signup-admin' ? 'Admin Sign Up'
      : mode === 'signup-employee' ? 'Create employee account'
      : mode === 'signup-accountant' ? 'Create accountant account'
        : mode === 'admin-credentials' ? 'Account ready'
          : selectedRole
            ? `Welcome, ${portalRoles.find((r) => r.id === selectedRole)?.label ?? ''}`
            : 'Welcome back 👋';

  const subtitle =
    mode === 'signup-admin'
      ? adminSignupStep === 'code'
        ? 'Enter the Invitation code provided by the Owner to continue.'
        : 'Complete your admin account to continue.'
    : (mode === 'signup-employee' || mode === 'signup-accountant')
      ? 'Invitation link required from your Administrator.'
      : mode === 'admin-credentials' ? 'Save these details — use them to sign in.'
        : selectedRole === 'admin'
          ? 'Sign in to your admin account to continue'
          : selectedRole
            ? authAction === 'login'
              ? 'Sign in to your account to continue'
              : 'Invitation required to create account'
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

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="absolute bottom-10 left-16 z-20"
        >
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleOwnerClick}
              className="text-[13px] font-semibold leading-none text-slate-700 hover:text-slate-900 transition-colors cursor-pointer select-none border-none bg-transparent p-0"
              aria-label="Owner sign in"
            >
              owner
            </button>
            <span className="text-[13px] font-semibold leading-none text-slate-700">appnep.com सर्वाधिकार सुरक्षित</span>
          </div>
        </motion.div>
      </div>

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
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
              {selectedRole === 'owner' && ownerMode === 'intro' ? 'Owner Sign In' : title}
            </h2>
            <p className="text-slate-500 dark:text-slate-400">
              {selectedRole === 'owner' && ownerMode === 'intro' ? 'Sign in with the fixed owner account.' : subtitle}
            </p>
          </div>

          {/* Role selection — Admin / Accountant / Employee */}
          {mode !== 'admin-credentials' && selectedRole !== 'owner' && (
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

          {selectedRole === 'owner' && ownerMode === 'intro' && (
            <div className="space-y-5">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Verification code will be sent to {formatEmailList(OWNER_SIGNIN_EMAILS)}.
              </p>
              <button
                type="button"
                onClick={sendOwnerVerificationCode}
                className="btn-primary w-full py-2.5 text-base font-semibold"
                disabled={loading}
              >
                {loading ? 'Sending...' : 'Send Verification Code'}
              </button>
            </div>
          )}

          {selectedRole === 'owner' && ownerMode === 'code' && (
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                void verifyOwnerCode();
              }}
            >
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Verification code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={ownerCode}
                  onChange={(e) => setOwnerCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="input"
                  autoFocus
                />
                <p className="text-xs text-slate-500 mt-1">Enter the 6-digit code sent to {formatEmailList(OWNER_SIGNIN_EMAILS)}.</p>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading || ownerCode.length !== 6}
                  className="btn-primary flex-1 py-2.5 text-base font-semibold disabled:opacity-60"
                >
                  {loading ? 'Verifying...' : 'Verify Code'}
                </button>
                <button
                  type="button"
                  onClick={sendOwnerVerificationCode}
                  disabled={loading || ownerResendSeconds > 0}
                  className="btn-secondary px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  {ownerResendSeconds > 0 ? `Resend (${ownerResendSeconds}s)` : 'Resend Code'}
                </button>
              </div>
            </form>
          )}

          {/* Log in / Sign up — shown after a role is chosen */}
          {selectedRole && selectedRole !== 'owner' && mode !== 'admin-credentials' && (
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
                    'py-2.5 px-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap',
                    authAction === 'signup'
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-700',
                  )}
                >
                  {selectedRole === 'admin' ? 'Sign Up as Admin' : 'Sign up'}
                </button>
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            {mode === 'login' && selectedRole && selectedRole !== 'owner' && (
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
                    placeholder="User name or email"
                    autoComplete="username"
                    className={cn(
                      'input',
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
                  <div className="relative">
                    <input
                      {...loginForm.register('password')}
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      autoFocus={selectedRole === 'admin'}
                      className={cn(
                        'input pr-10',
                        loginForm.formState.errors.password && 'border-rose-400 focus:border-rose-400 focus:ring-rose-500/20',
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
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

            {mode === 'signup-admin' && adminSignupStep === 'code' && (
              <motion.form
                key="signup-admin-code"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                className="space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void verifyAdminInviteCode();
                }}
              >
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Invitation code <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={adminInviteCode}
                    onChange={(e) => setAdminInviteCode(e.target.value)}
                    placeholder="Enter invitation code from Owner"
                    autoComplete="one-time-code"
                    className="input"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Phone number <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="tel"
                    value={adminInvitePhone}
                    onChange={(e) => setAdminInvitePhone(e.target.value)}
                    placeholder="e.g. +9779800000000"
                    autoComplete="tel"
                    className="input"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !adminInviteCode.trim() || !adminInvitePhone.trim()}
                  className="btn-primary w-full py-2.5 text-base font-semibold disabled:opacity-60"
                >
                  {loading ? 'Verifying...' : 'Verify Invitation'}
                </button>
              </motion.form>
            )}

            {mode === 'signup-admin' && adminSignupStep === 'details' && verifiedAdminInvite && (
              <motion.form
                key="signup-admin-details"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void onAdminSignup();
                }}
                className="space-y-5"
              >
                <div className="rounded-2xl border border-rose-100 bg-rose-50/70 dark:bg-rose-950/20 dark:border-rose-900/40 p-4 space-y-3">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Invited Admin</p>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Name</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{verifiedAdminInvite.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Email</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 break-all">{verifiedAdminInvite.email}</p>
                  </div>
                  {verifiedAdminInvite.companyName && (
                    <div>
                      <p className="text-xs text-slate-500 mb-0.5">Company</p>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{verifiedAdminInvite.companyName}</p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
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
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={verifiedAdminInvite.email}
                    readOnly
                    tabIndex={-1}
                    className="input input-email-dim"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Taken from the Owner invitation and cannot be changed.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      {...adminForm.register('password')}
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete="new-password"
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
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirm Password</label>
                  <div className="relative">
                    <input
                      {...adminForm.register('confirmPassword')}
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      className={cn('input pr-10', adminForm.formState.errors.confirmPassword && 'border-rose-400')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {adminForm.formState.errors.confirmPassword && (
                    <p className="text-xs text-rose-500 mt-1">{adminForm.formState.errors.confirmPassword.message}</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void onAdminSignup()}
                  className="btn-primary w-full py-2.5 text-base font-semibold"
                >
                  Create Admin Account
                </button>

                <button
                  type="button"
                  className="btn-ghost w-full text-sm"
                  onClick={backToLogin}
                >
                  ← Back to Login
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

            {(mode === 'signup-accountant' || mode === 'signup-employee') && (
              <motion.div
                key="signup-invite-required"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                className="space-y-6"
              >
                <div className="rounded-2xl border border-sky-200 bg-sky-50 dark:bg-sky-950/40 dark:border-sky-800/60 p-6 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center mx-auto">
                    <Mail size={24} />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    Admin Invitation Required
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    Only users invited by an Administrator can sign up for an{' '}
                    <strong>{selectedRole === 'accountant' ? 'Accountant' : 'Employee'}</strong> account.
                    Please ask your Administrator to send an invitation code to your email.
                  </p>
                </div>

                <div className="space-y-3 pt-2">
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Enter your 6-digit Invitation Code
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={inviteInputToken}
                      onChange={(e) => setInviteInputToken(e.target.value)}
                      placeholder="e.g. 849201"
                      maxLength={64}
                      className="input flex-1 font-mono tracking-wider font-semibold text-center"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const trimmed = inviteInputToken.trim();
                        if (!trimmed) return;
                        const match = trimmed.match(/\/invite\/([a-f0-9]+)/i);
                        const token = match ? match[1] : trimmed;
                        const normalized = token.match(/^[a-f0-9]{6,64}$/i) ? token.toLowerCase() : null;
                        if (!normalized) {
                          toast('error', 'Invalid invitation code', 'Enter a valid 6-digit invitation code sent to your email by your administrator.');
                          return;
                        }
                        navigate(`/invite/${normalized}`);
                      }}
                      disabled={!inviteInputToken.trim()}
                      className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
                    >
                      Continue <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <p className="text-center text-xs text-slate-400 mt-8">
            © 2026 AttendAI. Enterprise Attendance Management System.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
