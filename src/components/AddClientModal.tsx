import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  Mail,
  X,
  ChevronRight,
  Zap,
  Clock,
  Calendar,
  Send,
  Phone,
} from 'lucide-react';
import { useInvitations } from '../contexts/InvitationContext';
import { useNotifications } from '../contexts/NotificationContext';
import { cn, formatDurationLabel } from '../lib/utils';
import { authApi } from '../api/authApi';

interface AddClientModalProps {
  open: boolean;
  onClose: () => void;
}

interface DurationPreset {
  label: string;
  days: number;
}

const FREE_DURATION_PRESETS: DurationPreset[] = [
  { label: '1 Hour', days: 1 / 24 },
  { label: '2 Hours', days: 2 / 24 },
  { label: '6 Hours', days: 6 / 24 },
  { label: '12 Hours', days: 12 / 24 },
  { label: '1 Day', days: 1 },
  { label: '7 Days', days: 7 },
  { label: '15 Days', days: 15 },
  { label: '30 Days', days: 30 },
  { label: '60 Days', days: 60 },
  { label: '90 Days', days: 90 },
];

const PAID_DURATION_PRESETS: DurationPreset[] = [
  { label: '1 Hour', days: 1 / 24 },
  { label: '6 Hours', days: 6 / 24 },
  { label: '12 Hours', days: 12 / 24 },
  { label: '1 Day', days: 1 },
  { label: '7 Days', days: 7 },
  { label: '30 Days (1 Mo)', days: 30 },
  { label: '90 Days (3 Mo)', days: 90 },
  { label: '180 Days (6 Mo)', days: 180 },
  { label: '365 Days (1 Yr)', days: 365 },
];

export default function AddClientModal({ open, onClose }: AddClientModalProps) {
  const { createInvitation } = useInvitations();
  const { toast } = useNotifications();

  const [step, setStep] = useState<'form' | 'done'>('form');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [planType, setPlanType] = useState<'free' | 'paid'>('free');
  
  // Days states
  const [freeDays, setFreeDays] = useState<number>(30);
  const [paidDays, setPaidDays] = useState<number>(365);
  const [customDaysInput, setCustomDaysInput] = useState<string>('');
  const [customUnit, setCustomUnit] = useState<'days' | 'hours'>('days');
  const [isCustomDays, setIsCustomDays] = useState(false);

  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [sending, setSending] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep('form');
        setEmail('');
        setPhone('');
        setCompanyName('');
        setPlanType('free');
        setFreeDays(30);
        setPaidDays(365);
        setCustomDaysInput('');
        setCustomUnit('days');
        setIsCustomDays(false);
        setEmailError('');
        setPhoneError('');
        setSending(false);
      }, 300);
    }
  }, [open]);

  useEffect(() => {
    if (open && step === 'form') {
      setTimeout(() => emailRef.current?.focus(), 150);
    }
  }, [open, step]);

  function validateEmail(v: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  }

  const handleSelectFreeDays = (days: number) => {
    setIsCustomDays(false);
    setFreeDays(days);
    if (days < 1) {
      setCustomUnit('hours');
      setCustomDaysInput(String(Math.round(days * 24)));
    } else {
      setCustomUnit('days');
      setCustomDaysInput(String(days));
    }
  };

  const handleSelectPaidDays = (days: number) => {
    setIsCustomDays(false);
    setPaidDays(days);
    if (days < 1) {
      setCustomUnit('hours');
      setCustomDaysInput(String(Math.round(days * 24)));
    } else {
      setCustomUnit('days');
      setCustomDaysInput(String(days));
    }
  };

  const handleCustomDaysChange = (val: string, unit: 'days' | 'hours' = customUnit) => {
    setCustomDaysInput(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed > 0) {
      const calculatedDays = unit === 'hours' ? parsed / 24 : parsed;
      if (planType === 'free') {
        setFreeDays(calculatedDays);
      } else {
        setPaidDays(calculatedDays);
      }
    }
  };

  const isPresetActive = (currentDays: number, presetDays: number) => {
    return !isCustomDays && Math.abs(currentDays - presetDays) < 0.0001;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let hasErr = false;

    if (!validateEmail(email)) {
      setEmailError('Please enter a valid email address.');
      hasErr = true;
    } else {
      setEmailError('');
    }

    if (!phone.trim() || phone.trim().length < 7) {
      setPhoneError('Please enter a valid mobile number.');
      hasErr = true;
    } else {
      setPhoneError('');
    }

    if (hasErr) return;

    setSending(true);

    const activeDays = planType === 'free' ? freeDays : paidDays;
    const invitedEmail = email.trim().toLowerCase();

    try {
      const res = await authApi.createClientAdminInvite({
        email: invitedEmail,
        phone: phone.trim(),
        companyName: companyName.trim() || undefined,
        planType,
        durationDays: activeDays,
      });

      if (!res.success || !res.emailSent) {
        toast('error', 'Code Not Sent', res.message || `Could not email the 6-digit verification code to ${invitedEmail}.`);
        return;
      }

      createInvitation(invitedEmail, 'client', {
        phone: phone.trim(),
        planType,
        freeTrialDays: planType === 'free' ? freeDays : undefined,
        paidDays: planType === 'paid' ? paidDays : undefined,
        durationDays: activeDays,
        companyName: companyName.trim() || undefined,
      });

      toast('success', 'Verification Code Sent', res.message || `6-digit verification code emailed to ${invitedEmail}.`);
      setStep('done');
    } catch (err) {
      const message = err instanceof Error ? err.message : `Could not email the 6-digit verification code to ${invitedEmail}.`;
      toast('error', 'Code Not Sent', message);
    } finally {
      setSending(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
          />

          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: 'spring', stiffness: 350, damping: 28 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="pointer-events-auto w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-6 py-5 dark:border-slate-800 dark:bg-slate-800/40">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500 text-white shadow-md shadow-indigo-500/25">
                    <Building2 size={22} />
                  </div>
                  <div>
                    <h2 className="text-lg font-extrabold text-slate-900 dark:text-white leading-tight">
                      Add Client Admin
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Register client organizations with Free or Paid access duration
                    </p>
                  </div>
                </div>

                <button
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-6">
                {step === 'form' ? (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        Client Admin Email <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          ref={emailRef}
                          type="email"
                          required
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            if (emailError) setEmailError('');
                          }}
                          placeholder="client.admin@company.com"
                          className={cn(
                            'w-full rounded-2xl border bg-white py-3 pl-10 pr-4 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 dark:bg-slate-950 dark:text-white',
                            emailError
                              ? 'border-rose-500 focus:ring-rose-500/20'
                              : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 dark:border-slate-800'
                          )}
                        />
                      </div>
                      {emailError && <p className="text-[11px] font-semibold text-rose-500">{emailError}</p>}
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        The 6-digit verification code will be sent to this invited email address.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        Mobile Number <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="tel"
                          required
                          value={phone}
                          onChange={(e) => {
                            setPhone(e.target.value);
                            if (phoneError) setPhoneError('');
                          }}
                          placeholder="e.g. +977 9800000000"
                          className={cn(
                            'w-full rounded-2xl border bg-white py-3 pl-10 pr-4 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 dark:bg-slate-950 dark:text-white',
                            phoneError
                              ? 'border-rose-500 focus:ring-phone-500/20'
                              : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 dark:border-slate-800'
                          )}
                        />
                      </div>
                      {phoneError && <p className="text-[11px] font-semibold text-rose-500">{phoneError}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        Company / Client Name <span className="text-xs text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="e.g. Acme Software Solutions"
                        className="w-full rounded-2xl border border-slate-200 bg-white py-3 px-4 text-xs font-medium text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        App Access & Plan Version
                      </label>

                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setPlanType('free');
                            setIsCustomDays(false);
                          }}
                          className={cn(
                            'flex flex-col items-start p-4 rounded-2xl border-2 text-left transition-all relative',
                            planType === 'free'
                              ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30'
                              : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                          )}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Clock size={16} className={planType === 'free' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'} />
                            <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                              Free Version
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                            Fixed duration trial (hours or days)
                          </p>
                          {planType === 'free' && (
                            <span className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-indigo-500" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setPlanType('paid');
                            setIsCustomDays(false);
                          }}
                          className={cn(
                            'flex flex-col items-start p-4 rounded-2xl border-2 text-left transition-all relative',
                            planType === 'paid'
                              ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30'
                              : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                          )}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Zap size={16} className={planType === 'paid' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'} />
                            <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                              Paid Version
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                            Active paid access by hours or days
                          </p>
                          {planType === 'paid' && (
                            <span className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-emerald-500" />
                          )}
                        </button>
                      </div>
                    </div>

                    {planType === 'free' && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-2.5 rounded-2xl bg-indigo-50/60 p-4 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/30"
                      >
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                            <Calendar size={14} className="text-indigo-500" />
                            <span>Free Trial Duration</span>
                          </label>
                          <span className="text-xs font-extrabold text-indigo-600 dark:text-indigo-400">
                            {formatDurationLabel(freeDays)}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {FREE_DURATION_PRESETS.map((preset) => (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() => handleSelectFreeDays(preset.days)}
                              className={cn(
                                'px-2.5 py-1 text-xs font-semibold rounded-xl transition-all',
                                isPresetActive(freeDays, preset.days)
                                  ? 'bg-indigo-600 text-white shadow-sm'
                                  : 'bg-white text-slate-700 hover:bg-indigo-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                              )}
                            >
                              {preset.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              setIsCustomDays(true);
                              if (freeDays < 1) {
                                setCustomUnit('hours');
                                setCustomDaysInput(String(Math.round(freeDays * 24)));
                              } else {
                                setCustomUnit('days');
                                setCustomDaysInput(String(freeDays));
                              }
                            }}
                            className={cn(
                              'px-2.5 py-1 text-xs font-semibold rounded-xl transition-all',
                              isCustomDays
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'bg-white text-slate-700 hover:bg-indigo-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                            )}
                          >
                            Custom
                          </button>
                        </div>

                        {isCustomDays && (
                          <div className="pt-1 flex items-center gap-2">
                            <input
                              type="number"
                              step="any"
                              min="0.1"
                              value={customDaysInput}
                              onChange={(e) => handleCustomDaysChange(e.target.value, customUnit)}
                              placeholder={customUnit === 'hours' ? 'Enter hours (e.g. 4)' : 'Enter days (e.g. 1)'}
                              className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                            />
                            <select
                              value={customUnit}
                              onChange={(e) => {
                                const newUnit = e.target.value as 'days' | 'hours';
                                setCustomUnit(newUnit);
                                handleCustomDaysChange(customDaysInput, newUnit);
                              }}
                              className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                            >
                              <option value="hours">Hours</option>
                              <option value="days">Days</option>
                            </select>
                          </div>
                        )}
                      </motion.div>
                    )}

                    {planType === 'paid' && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-2.5 rounded-2xl bg-emerald-50/60 p-4 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30"
                      >
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5">
                            <Zap size={14} className="text-emerald-500" />
                            <span>Paid Subscription Duration</span>
                          </label>
                          <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                            {formatDurationLabel(paidDays)}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {PAID_DURATION_PRESETS.map((preset) => (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() => handleSelectPaidDays(preset.days)}
                              className={cn(
                                'px-2.5 py-1 text-xs font-semibold rounded-xl transition-all',
                                isPresetActive(paidDays, preset.days)
                                  ? 'bg-emerald-600 text-white shadow-sm'
                                  : 'bg-white text-slate-700 hover:bg-emerald-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                              )}
                            >
                              {preset.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              setIsCustomDays(true);
                              if (paidDays < 1) {
                                setCustomUnit('hours');
                                setCustomDaysInput(String(Math.round(paidDays * 24)));
                              } else {
                                setCustomUnit('days');
                                setCustomDaysInput(String(paidDays));
                              }
                            }}
                            className={cn(
                              'px-2.5 py-1 text-xs font-semibold rounded-xl transition-all',
                              isCustomDays
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'bg-white text-slate-700 hover:bg-emerald-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                            )}
                          >
                            Custom
                          </button>
                        </div>

                        {isCustomDays && (
                          <div className="pt-1 flex items-center gap-2">
                            <input
                              type="number"
                              step="any"
                              min="0.1"
                              value={customDaysInput}
                              onChange={(e) => handleCustomDaysChange(e.target.value, customUnit)}
                              placeholder={customUnit === 'hours' ? 'Enter hours (e.g. 4)' : 'Enter days (e.g. 1)'}
                              className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                            />
                            <select
                              value={customUnit}
                              onChange={(e) => {
                                const newUnit = e.target.value as 'days' | 'hours';
                                setCustomUnit(newUnit);
                                handleCustomDaysChange(customDaysInput, newUnit);
                              }}
                              className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                            >
                              <option value="hours">Hours</option>
                              <option value="days">Days</option>
                            </select>
                          </div>
                        )}
                      </motion.div>
                    )}

                    <button
                      type="submit"
                      disabled={sending}
                      className="w-full flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-700 disabled:opacity-50 transition-all cursor-pointer"
                    >
                      {sending ? (
                        <span>Sending Invitation...</span>
                      ) : (
                        <>
                          <span>Create & Send Client Invite</span>
                          <ChevronRight size={16} />
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  <div className="py-4 text-center space-y-4">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 animate-bounce">
                      <Send size={28} />
                    </div>

                    <div className="space-y-1.5">
                      <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                        Verification Code Emailed
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        A 6-digit verification code was emailed to <strong className="text-slate-700 dark:text-slate-200">{email}</strong>
                        {' '}({planType === 'free' ? `Free (${formatDurationLabel(freeDays)})` : `Paid (${formatDurationLabel(paidDays)})`}).
                        The invitee should open Admin Sign Up and enter that code with this mobile number.
                      </p>
                    </div>

                    <button
                      onClick={onClose}
                      className="w-full rounded-2xl bg-slate-900 py-3 text-xs font-bold text-white dark:bg-white dark:text-slate-900 cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
