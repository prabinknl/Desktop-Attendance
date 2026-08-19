import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Camera, Lock, Activity, Save, Eye, EyeOff, User, Users, Search, Shield, Briefcase, UserCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { mockAuditLogs } from '../../data/mockData';
import { formatDateTime, getInitials, cn } from '../../lib/utils';
import type { User as UserType } from '../../types';

const tabs = [
  { id: 'personal', label: 'Personal Info', icon: User },
  { id: 'security', label: 'Security', icon: Lock },
  { id: 'activity', label: 'Activity Log', icon: Activity },
  { id: 'team', label: 'Team Members', icon: Users },
];

const passwordSchema = z.object({
  current: z.string().min(1, 'Current password required'),
  newPassword: z.string().min(6, 'Min 6 characters'),
  confirm: z.string(),
}).refine(d => d.newPassword === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });

type PasswordForm = z.infer<typeof passwordSchema>;

export default function ProfilePage() {
  const { user, updateProfile, changePassword, getAuthUsers } = useAuth();
  const { toast } = useNotifications();
  const [activeTab, setActiveTab] = useState('personal');
  const [teamSearch, setTeamSearch] = useState('');
  const [authUsers, setAuthUsers] = useState<UserType[]>([]);

  useEffect(() => {
    setAuthUsers(getAuthUsers());
  }, [getAuthUsers]);

  const filteredTeamUsers = useMemo(() => {
    const q = teamSearch.trim().toLowerCase();
    return authUsers.filter((u) => {
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q) ||
        (u.employeeId ?? '').toLowerCase().includes(q)
      );
    });
  }, [authUsers, teamSearch]);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [personalInfo, setPersonalInfo] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '+977-9800000000',
    timezone: user?.timezone ?? 'Asia/Kathmandu',
  });

  useEffect(() => {
    if (user) {
      setPersonalInfo({
        name: user.name ?? '',
        email: user.email ?? '',
        phone: user.phone ?? '+977-9800000000',
        timezone: user.timezone ?? 'Asia/Kathmandu',
      });
    }
  }, [user]);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  });

  const handleSavePersonal = () => {
    const trimmedName = personalInfo.name.trim();
    const trimmedEmail = personalInfo.email.trim();
    if (!trimmedEmail) {
      toast('error', 'Email required', 'Please enter your email address.');
      return;
    }
    // When display name is deleted, refresh that email as the effective name
    const effectiveName = trimmedName || trimmedEmail;
    updateProfile({
      name: effectiveName,
      email: trimmedEmail,
      phone: personalInfo.phone.trim(),
      timezone: personalInfo.timezone.trim(),
    });
    setPersonalInfo(p => ({ ...p, name: effectiveName, email: trimmedEmail }));
    toast(
      'success',
      'Profile Updated',
      trimmedName
        ? 'Your personal information has been saved.'
        : 'Display name removed — refreshed to email address.',
    );
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('error', 'Invalid file', 'Please choose an image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      updateProfile({ avatar: dataUrl });
      toast('success', 'Photo Updated', 'Your profile picture has been updated.');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const onPasswordSubmit = async (data: PasswordForm) => {
    const result = changePassword(data.current, data.newPassword);
    if (!result.success) {
      toast('error', 'Wrong Password', result.error ?? 'Current password is incorrect.');
      return;
    }
    toast('success', 'Password Changed', 'Your password has been updated successfully.');
    reset();
  };

  const roleLabels: Record<string, string> = {
    admin: 'Administrator', hr: 'HR Manager',
    dept_manager: 'Dept. Manager', employee: 'Employee',
  };

  const roleBadgeColors: Record<string, string> = {
    admin: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400',
    hr: 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400',
    dept_manager: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',
    employee: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My Profile</h1>

      {/* Profile Hero */}
      {(() => {
        const displayName = user?.name?.trim() || user?.email?.trim() || 'User';
        return (
          <div className="card p-6">
            <div className="flex items-center gap-6">
              <div className="relative flex-shrink-0">
                <div className="w-20 h-20 rounded-3xl overflow-hidden bg-gradient-to-br from-primary-400 to-violet-500 flex items-center justify-center">
                  {user?.avatar ? (
                    <img src={user.avatar} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl font-bold text-white">{getInitials(displayName)}</span>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 w-7 h-7 rounded-xl bg-primary-500 text-white flex items-center justify-center shadow-lg hover:bg-primary-600 transition-colors"
                  aria-label="Change profile photo"
                >
                  <Camera size={13} />
                </button>
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">{displayName}</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm">{user?.email}</p>
                <span className={cn('badge mt-2 text-xs font-semibold', roleBadgeColors[user?.role ?? 'employee'])}>
                  {roleLabels[user?.role ?? 'employee']}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Tab navigation */}
        <div className="card p-2 lg:w-52 flex-shrink-0">
          <nav className="space-y-0.5">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn('sidebar-item w-full', activeTab === tab.id && 'active')}
              >
                <tab.icon size={16} />
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 card p-6">
          {activeTab === 'personal' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Personal Information</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { label: 'Full Name', key: 'name' as const },
                  { label: 'Email Address', key: 'email' as const },
                  { label: 'Phone Number', key: 'phone' as const },
                  { label: 'Timezone', key: 'timezone' as const },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">{f.label}</label>
                    <input
                      value={personalInfo[f.key]}
                      onChange={e => setPersonalInfo(p => ({ ...p, [f.key]: e.target.value }))}
                      className="input"
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-end pt-2">
                <button type="button" onClick={handleSavePersonal} className="btn-primary">
                  <Save size={15} /> Save Changes
                </button>
              </div>
            </motion.div>
          )}

          {activeTab === 'security' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Change Password</h2>
              <form onSubmit={handleSubmit(onPasswordSubmit)} className="space-y-4 max-w-sm">
                {[
                  { label: 'Current Password', field: 'current' as const, show: showCurrent, toggle: setShowCurrent },
                  { label: 'New Password', field: 'newPassword' as const, show: showNew, toggle: setShowNew },
                  { label: 'Confirm New Password', field: 'confirm' as const, show: showConfirm, toggle: setShowConfirm },
                ].map(item => (
                  <div key={item.field}>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">{item.label}</label>
                    <div className="relative">
                      <input
                        {...register(item.field)}
                        type={item.show ? 'text' : 'password'}
                        className={cn('input pr-10', errors[item.field] && 'border-rose-400')}
                      />
                      <button type="button" onClick={() => item.toggle(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                        {item.show ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    {errors[item.field] && (
                      <p className="text-xs text-rose-500 mt-1">{errors[item.field]?.message}</p>
                    )}
                  </div>
                ))}

                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50">
                  <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">Password requirements:</p>
                  <ul className="text-xs text-amber-600 dark:text-amber-500 mt-1 space-y-0.5">
                    <li>• Minimum 6 characters</li>
                    <li>• New password must differ from current</li>
                  </ul>
                </div>

                <button type="submit" disabled={isSubmitting} className="btn-primary">
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Updating...
                    </span>
                  ) : (
                    <><Lock size={15} /> Update Password</>
                  )}
                </button>
              </form>
            </motion.div>
          )}

          {activeTab === 'activity' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Activity Log</h2>
              <div className="space-y-3">
                {mockAuditLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="w-8 h-8 rounded-xl bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Activity size={14} className="text-primary-500" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{log.action.replace(/_/g, ' ')}</p>
                        <p className="text-xs text-slate-400 whitespace-nowrap">{formatDateTime(log.createdAt)}</p>
                      </div>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{log.details}</p>
                      {log.ipAddress && (
                        <p className="text-xs text-slate-400 mt-1">IP: {log.ipAddress}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'team' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">Team Members</h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {authUsers.length} registered user{authUsers.length !== 1 ? 's' : ''} under this account
                  </p>
                </div>
              </div>

              {/* Search */}
              <div className="relative max-w-sm">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={teamSearch}
                  onChange={(e) => setTeamSearch(e.target.value)}
                  placeholder="Search by name, email, role..."
                  className="input pl-9 py-2"
                />
              </div>

              {/* Role summary pills */}
              <div className="flex flex-wrap gap-2">
                {[
                  { role: 'admin', label: 'Admins', icon: Shield, color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' },
                  { role: 'hr', label: 'HR / Accountant', icon: Briefcase, color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
                  { role: 'employee', label: 'Employees', icon: UserCheck, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
                ].map(({ role, label, icon: Icon, color }) => {
                  const count = authUsers.filter((u) => role === 'employee' ? u.role === 'employee' : role === 'hr' ? (u.role === 'hr' || u.role === 'account') : u.role === role).length;
                  return (
                    <div key={role} className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold', color)}>
                      <Icon size={13} />
                      {count} {label}
                    </div>
                  );
                })}
              </div>

              {/* User cards */}
              <div className="grid grid-cols-1 gap-3">
                {filteredTeamUsers.length === 0 ? (
                  <div className="py-12 text-center text-slate-400">
                    <Users size={32} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No users found</p>
                  </div>
                ) : (
                  filteredTeamUsers.map((member) => (
                    <div
                      key={member.id}
                      className={cn(
                        'flex items-center gap-4 p-4 rounded-2xl border transition-all',
                        member.id === user?.id
                          ? 'border-primary-300 bg-primary-50/50 dark:border-primary-700 dark:bg-primary-900/20'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600',
                      )}
                    >
                      <div className="w-11 h-11 rounded-2xl overflow-hidden bg-gradient-to-br from-primary-400 to-violet-500 flex items-center justify-center flex-shrink-0">
                        {member.avatar ? (
                          <img src={member.avatar} alt={member.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-sm font-bold text-white">{getInitials(member.name)}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                            {member.name}
                          </p>
                          {member.id === user?.id && (
                            <span className="text-[10px] font-bold text-primary-600 dark:text-primary-400 bg-primary-100 dark:bg-primary-900/40 px-1.5 py-0.5 rounded-md">
                              You
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{member.email}</p>
                        {member.employeeId && (
                          <p className="text-[11px] text-slate-400 mt-0.5">ID: {member.employeeId}</p>
                        )}
                      </div>
                      <span className={cn('badge text-[11px] font-semibold flex-shrink-0', roleBadgeColors[member.role] ?? roleBadgeColors.employee)}>
                        {roleLabels[member.role] ?? member.role}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
