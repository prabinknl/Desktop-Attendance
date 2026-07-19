import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Camera, Lock, Activity, Save, Eye, EyeOff, User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { mockAuditLogs } from '../../data/mockData';
import { formatDateTime, getInitials, cn } from '../../lib/utils';

const tabs = [
  { id: 'personal', label: 'Personal Info', icon: User },
  { id: 'security', label: 'Security', icon: Lock },
  { id: 'activity', label: 'Activity Log', icon: Activity },
];

const passwordSchema = z.object({
  current: z.string().min(1, 'Current password required'),
  newPassword: z.string().min(6, 'Min 6 characters'),
  confirm: z.string(),
}).refine(d => d.newPassword === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });

type PasswordForm = z.infer<typeof passwordSchema>;

export default function ProfilePage() {
  const { user, updateProfile, changePassword } = useAuth();
  const { toast } = useNotifications();
  const [activeTab, setActiveTab] = useState('personal');
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

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  });

  const handleSavePersonal = () => {
    if (!personalInfo.name.trim()) {
      toast('error', 'Name required', 'Please enter your full name.');
      return;
    }
    if (!personalInfo.email.trim()) {
      toast('error', 'Email required', 'Please enter your email address.');
      return;
    }
    updateProfile({
      name: personalInfo.name.trim(),
      email: personalInfo.email.trim(),
      phone: personalInfo.phone.trim(),
      timezone: personalInfo.timezone.trim(),
    });
    toast('success', 'Profile Updated', 'Your personal information has been saved.');
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
      <div className="card p-6">
        <div className="flex items-center gap-6">
          <div className="relative flex-shrink-0">
            <div className="w-20 h-20 rounded-3xl overflow-hidden bg-gradient-to-br from-primary-400 to-violet-500 flex items-center justify-center">
              {user?.avatar ? (
                <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-bold text-white">{getInitials(user?.name ?? '')}</span>
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
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">{user?.name}</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{user?.email}</p>
            <span className={cn('badge mt-2 text-xs font-semibold', roleBadgeColors[user?.role ?? 'employee'])}>
              {roleLabels[user?.role ?? 'employee']}
            </span>
          </div>
        </div>
      </div>

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
        </div>
      </div>
    </div>
  );
}
