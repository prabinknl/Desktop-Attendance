import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, X, Copy, Check, ChevronDown, Send, Users, BriefcaseBusiness, Building2 } from 'lucide-react';
import { useInvitations, type InviteRole } from '../contexts/InvitationContext';
import { useNotifications } from '../contexts/NotificationContext';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../lib/utils';
import { authApi } from '../api/authApi';

const ROLES: { id: InviteRole; label: string; desc: string; color: string; icon: React.ElementType }[] = [
  {
    id: 'client',
    label: 'Client / Admin',
    desc: 'Create or invite organization client account',
    color: 'bg-indigo-500',
    icon: Building2,
  },
  {
    id: 'accountant',
    label: 'Accountant',
    desc: 'Access payroll, reports & finances',
    color: 'bg-sky-500',
    icon: BriefcaseBusiness,
  },
  {
    id: 'employee',
    label: 'Employee',
    desc: 'View attendance & submit leaves',
    color: 'bg-emerald-500',
    icon: Users,
  },
];

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
}

export default function InviteModal({ open, onClose }: InviteModalProps) {
  const { user } = useAuth();
  const { createInvitation } = useInvitations();
  const { toast } = useNotifications();

  // Show only Accountant and Employee roles for admin/client invites (hide Client/Admin option unless user is owner)
  const availableRoles = user?.role === 'owner' ? ROLES : ROLES.filter((r) => r.id !== 'client');

  const [step, setStep] = useState<'role' | 'email' | 'done'>('role');
  const [selectedRole, setSelectedRole] = useState<InviteRole | null>(null);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep('role');
        setSelectedRole(null);
        setEmail('');
        setEmailError('');
        setInviteCode('');
        setCopied(false);
        setSending(false);
      }, 300);
    }
  }, [open]);

  useEffect(() => {
    if (step === 'email') setTimeout(() => emailRef.current?.focus(), 100);
  }, [step]);

  function validateEmail(v: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  }

  async function handleNext() {
    if (step === 'role') {
      if (!selectedRole) return;
      setStep('email');
    } else if (step === 'email') {
      if (!validateEmail(email)) {
        setEmailError('Please enter a valid email address');
        return;
      }
      setEmailError('');
      setSending(true);
      try {
        const { token, link } = createInvitation(email.trim().toLowerCase(), selectedRole!);
        setInviteCode(token);

        const res = await authApi.sendInviteEmail({
          email: email.trim().toLowerCase(),
          role: selectedRole!,
          inviteLink: link,
          token,
          code: token,
        });

        if (res.code) setInviteCode(res.code);

        if (res.success) {
          toast('success', `Invitation code sent to ${email.trim()}`);
        } else {
          toast('warning', res.message || 'Invitation code generated, but email could not be sent.');
        }
        setStep('done');
      } catch (err) {
        console.error('Failed to send invitation email:', err);
        const msg = err instanceof Error ? err.message : 'Could not send invitation email.';
        toast('warning', `${msg} Code generated, you can share it manually.`);
        setStep('done');
      } finally {
        setSending(false);
      }
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      toast('success', 'Invite code copied!');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast('error', 'Could not copy. Please copy manually.');
    }
  }

  const roleInfo = ROLES.find((r) => r.id === selectedRole);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed z-50 inset-0 flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="pointer-events-auto w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-6 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
                    <Mail size={20} className="text-primary-600 dark:text-primary-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
                      Send Invitation
                    </h2>
                    <p className="text-xs text-slate-400">
                      {step === 'role' && 'Choose a role to invite'}
                      {step === 'email' && `Invite as ${roleInfo?.label}`}
                      {step === 'done' && 'Invitation code ready!'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-400"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Progress dots */}
              <div className="flex items-center gap-2 px-6 mb-6">
                {(['role', 'email', 'done'] as const).map((s, i) => (
                  <div
                    key={s}
                    className={cn(
                      'h-1.5 rounded-full transition-all duration-300',
                      step === s
                        ? 'w-8 bg-primary-500'
                        : i < (['role', 'email', 'done'] as const).indexOf(step)
                          ? 'w-4 bg-primary-300'
                          : 'w-4 bg-slate-200 dark:bg-slate-700',
                    )}
                  />
                ))}
              </div>

              {/* Body */}
              <div className="px-6 pb-6">
                <AnimatePresence mode="wait">
                  {/* Step 1: Role selection */}
                  {step === 'role' && (
                    <motion.div
                      key="role"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-3"
                    >
                      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                        Select the role for the person you want to invite:
                      </p>
                      {availableRoles.map((role) => {
                        const Icon = role.icon;
                        const isSelected = selectedRole === role.id;
                        return (
                          <button
                            key={role.id}
                            onClick={() => setSelectedRole(role.id)}
                            className={cn(
                              'w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left',
                              isSelected
                                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/60',
                            )}
                          >
                            <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0', role.color)}>
                              <Icon size={20} className="text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={cn(
                                'font-semibold text-sm',
                                isSelected
                                  ? 'text-primary-700 dark:text-primary-300'
                                  : 'text-slate-900 dark:text-white',
                              )}>
                                {role.label}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">{role.desc}</p>
                            </div>
                            <div className={cn(
                              'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0',
                              isSelected
                                ? 'border-primary-500 bg-primary-500'
                                : 'border-slate-300 dark:border-slate-600',
                            )}>
                              {isSelected && <Check size={12} className="text-white" />}
                            </div>
                          </button>
                        );
                      })}

                      <button
                        onClick={handleNext}
                        disabled={!selectedRole}
                        className="btn w-full py-3 mt-4 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Next <ChevronDown size={16} className="rotate-[-90deg] inline ml-1" />
                      </button>
                    </motion.div>
                  )}

                  {/* Step 2: Email input */}
                  {step === 'email' && (
                    <motion.div
                      key="email"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-4"
                    >
                      {roleInfo && (
                        <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800">
                          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', roleInfo.color)}>
                            <roleInfo.icon size={16} className="text-white" />
                          </div>
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            Inviting as <span className="text-slate-900 dark:text-white font-semibold">{roleInfo.label}</span>
                          </span>
                        </div>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          Email Address
                        </label>
                        <input
                          ref={emailRef}
                          type="email"
                          disabled={sending}
                          value={email}
                          onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
                          onKeyDown={(e) => e.key === 'Enter' && !sending && handleNext()}
                          placeholder="colleague@company.com"
                          className={cn(
                            'input-field w-full',
                            emailError && 'border-rose-500 focus:ring-rose-500',
                            sending && 'opacity-60 cursor-not-allowed bg-slate-50 dark:bg-slate-800'
                          )}
                        />
                        {emailError && (
                          <p className="text-rose-500 text-xs mt-1">{emailError}</p>
                        )}
                        <p className="text-xs text-slate-400 mt-1.5">
                          An invitation code will be sent to their email address. They will enter it when signing up.
                        </p>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={() => setStep('role')}
                          disabled={sending}
                          className="btn flex-1 py-3 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Back
                        </button>
                        <button
                          onClick={handleNext}
                          disabled={sending}
                          className="btn flex-1 py-3 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-xl flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {sending ? (
                            <>
                              <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                              Sending Code...
                            </>
                          ) : (
                            <>
                              <Send size={15} /> Send Code
                            </>
                          )}
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {/* Step 3: Done */}
                  {step === 'done' && (
                    <motion.div
                      key="done"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-5"
                    >
                      <div className="text-center py-2">
                        <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-3">
                          <Check size={32} className="text-emerald-500" />
                        </div>
                        <p className="font-semibold text-slate-900 dark:text-white">Invitation code sent!</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                          Code sent to <strong className="text-slate-700 dark:text-slate-300">{email}</strong>
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
                        <p className="text-xs text-slate-400 mb-1.5 font-medium uppercase tracking-wide">Invitation Code</p>
                        <div className="flex items-center justify-center gap-3">
                          <p className="text-3xl font-extrabold text-primary-600 dark:text-primary-400 font-mono tracking-widest">
                            {inviteCode}
                          </p>
                          <button
                            onClick={copyCode}
                            className={cn(
                              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ml-2',
                              copied
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                : 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-900/50',
                            )}
                          >
                            {copied ? <Check size={13} /> : <Copy size={13} />}
                            {copied ? 'Copied!' : 'Copy Code'}
                          </button>
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          ⏰ This invitation code expires in <strong>4 hours</strong>. The invitee must enter this code when signing up.
                        </p>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={() => { setStep('role'); setSelectedRole(null); setEmail(''); setInviteCode(''); }}
                          className="btn flex-1 py-3 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-sm"
                        >
                          New Invite
                        </button>
                        <button
                          onClick={onClose}
                          className="btn flex-1 py-3 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-xl text-sm"
                        >
                          Done
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
