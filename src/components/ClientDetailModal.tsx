import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  Mail,
  X,
  Play,
  Pause,
  Clock,
  Zap,
  Sliders,
  Activity,
  Calendar,
  ShieldCheck,
  ExternalLink,
  Plus,
  Search,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { getClientActivityLogs, logClientActivity, type ClientActivityLog } from '../lib/clientActivity';
import { cn, formatDateTime, getInitials, formatDurationLabel } from '../lib/utils';

interface ClientItem {
  id: string;
  name: string;
  companyName?: string;
  email: string;
  role: string;
  planType: 'free' | 'paid';
  freeDays: number;
  paidDays: number;
  durationDays: number;
  appStatus: 'running' | 'paused';
  status: 'active' | 'pending' | 'deleted';
  deletedAt?: string;
  deletedBy?: string;
  createdAt: string;
  avatar?: string;
  inviteToken?: string;
  inviteLink?: string;
}

interface ClientDetailModalProps {
  client: ClientItem | null;
  onClose: () => void;
  onOpenManagePlan: (client: ClientItem) => void;
  onToggleAppStatus: (client: ClientItem) => void;
}

export default function ClientDetailModal({
  client,
  onClose,
  onOpenManagePlan,
  onToggleAppStatus,
}: ClientDetailModalProps) {
  const { impersonateClient } = useAuth();
  const { toast } = useNotifications();

  const [logs, setLogs] = useState<ClientActivityLog[]>([]);
  const [logSearch, setLogSearch] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [activeTab, setActiveTab] = useState<'activity' | 'overview'>('activity');

  useEffect(() => {
    if (client) {
      setLogs(getClientActivityLogs(client.email));
    }
  }, [client]);

  if (!client) return null;

  const handleLaunchAsAdmin = () => {
    impersonateClient({
      id: client.id,
      email: client.email,
      name: client.name,
      companyName: client.companyName,
    });
    toast('info', `Opened app as Client Admin for ${client.companyName || client.name}`);
    onClose();
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteInput.trim()) return;

    logClientActivity({
      clientId: client.email,
      clientName: client.companyName || client.name,
      action: 'ADMIN_NOTE',
      title: 'Manual Activity Note Recorded',
      description: noteInput.trim(),
      actor: 'Owner Admin',
      type: 'info',
    });

    setLogs(getClientActivityLogs(client.email));
    setNoteInput('');
    setAddingNote(false);
    toast('success', 'Activity note recorded successfully.');
  };

  const filteredLogs = logs.filter(
    (l) =>
      l.title.toLowerCase().includes(logSearch.toLowerCase()) ||
      l.description.toLowerCase().includes(logSearch.toLowerCase()) ||
      l.actor.toLowerCase().includes(logSearch.toLowerCase())
  );

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="pointer-events-auto w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col rounded-3xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          {/* Header Banner */}
          <div className="border-b border-slate-100 bg-slate-50/80 px-6 py-5 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-indigo-500 font-bold text-white shadow-md shadow-indigo-500/20">
                  {client.avatar ? (
                    <img src={client.avatar} alt={client.name} className="h-full w-full rounded-2xl object-cover" />
                  ) : (
                    getInitials(client.name)
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-extrabold text-slate-900 dark:text-white leading-tight">
                      {client.name}
                    </h2>
                    {client.appStatus === 'paused' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                        <Pause size={12} className="fill-amber-600 text-amber-600" />
                        Paused
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Running
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {client.email} &bull; Client Organization Portal
                  </p>
                </div>
              </div>

              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Main Action Bar */}
            <div className="mt-4 flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800">
              <button
                onClick={handleLaunchAsAdmin}
                className="flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2 text-xs font-extrabold text-white shadow-md shadow-indigo-600/25 hover:bg-indigo-700 transition-all"
              >
                <Play size={14} className="fill-white" />
                <span>Open App as Client Admin</span>
                <ExternalLink size={13} className="opacity-80" />
              </button>

              <button
                onClick={() => {
                  onClose();
                  onOpenManagePlan(client);
                }}
                className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <Sliders size={14} />
                <span>Manage Plan ({client.planType === 'paid' ? `Paid ${client.durationDays}d` : `Free ${client.durationDays}d`})</span>
              </button>

              <button
                onClick={() => onToggleAppStatus(client)}
                className={cn(
                  'flex items-center gap-1.5 rounded-2xl border px-3.5 py-2 text-xs font-bold transition-all',
                  client.appStatus === 'paused'
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                )}
              >
                {client.appStatus === 'paused' ? (
                  <>
                    <Play size={14} className="fill-emerald-600 text-emerald-600" />
                    <span>Run App</span>
                  </>
                ) : (
                  <>
                    <Pause size={14} className="fill-amber-600 text-amber-600" />
                    <span>Pause App</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Modal Tabs */}
          <div className="flex items-center gap-6 border-b border-slate-100 px-6 dark:border-slate-800 bg-white dark:bg-slate-900">
            <button
              onClick={() => setActiveTab('activity')}
              className={cn(
                'flex items-center gap-2 py-3 text-xs font-bold border-b-2 transition-all',
                activeTab === 'activity'
                  ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
              )}
            >
              <Activity size={15} />
              <span>Recorded Activity Log ({filteredLogs.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('overview')}
              className={cn(
                'flex items-center gap-2 py-3 text-xs font-bold border-b-2 transition-all',
                activeTab === 'overview'
                  ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
              )}
            >
              <Building2 size={15} />
              <span>Client Overview & Details</span>
            </button>
          </div>

          {/* Body Content */}
          <div className="p-6 overflow-y-auto flex-1 space-y-4">
            {activeTab === 'activity' ? (
              <div className="space-y-4">
                {/* Search & Add Note */}
                <div className="flex items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                      placeholder="Search activity records..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    />
                  </div>
                  <button
                    onClick={() => setAddingNote(!addingNote)}
                    className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <Plus size={14} />
                    <span>Add Note</span>
                  </button>
                </div>

                {/* Add Note Form */}
                {addingNote && (
                  <form onSubmit={handleAddNote} className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3.5 space-y-2 dark:border-indigo-900/30 dark:bg-indigo-950/20">
                    <label className="text-xs font-bold text-indigo-950 dark:text-indigo-200 block">
                      Record Custom Administrative Note
                    </label>
                    <textarea
                      rows={2}
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      placeholder="Write notes or activity log for this client..."
                      className="w-full rounded-xl border border-indigo-200 bg-white p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setAddingNote(false)}
                        className="px-3 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="rounded-xl bg-indigo-600 px-4 py-1 text-xs font-bold text-white hover:bg-indigo-700"
                      >
                        Save Record
                      </button>
                    </div>
                  </form>
                )}

                {/* Timeline Log List */}
                {filteredLogs.length > 0 ? (
                  <div className="space-y-3 relative before:absolute before:left-4 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
                    {filteredLogs.map((log) => (
                      <div key={log.id} className="relative pl-9 group">
                        <div className="absolute left-2 top-1 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-white dark:bg-slate-900 ring-2 ring-indigo-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/60 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-xs text-slate-900 dark:text-white">
                              {log.title}
                            </span>
                            <span className="text-[10px] font-medium text-slate-400">
                              {formatDateTime(log.timestamp)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-300 leading-normal">
                            {log.description}
                          </p>
                          <div className="pt-1 flex items-center justify-between text-[10px] text-slate-400 font-semibold">
                            <span>Actor: {log.actor}</span>
                            <span className="uppercase text-[9px] px-2 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                              {log.action}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-slate-400">
                    No activity logs recorded yet for this client.
                  </div>
                )}
              </div>
            ) : (
              /* Overview Tab */
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950 space-y-1">
                    <span className="text-slate-400 font-semibold block">Company Name</span>
                    <span className="font-bold text-slate-900 dark:text-white text-sm">
                      {client.companyName || client.name}
                    </span>
                  </div>

                  <div className="rounded-2xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950 space-y-1">
                    <span className="text-slate-400 font-semibold block">Client Admin Email</span>
                    <span className="font-bold text-slate-900 dark:text-white text-sm">
                      {client.email}
                    </span>
                  </div>

                  <div className="rounded-2xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950 space-y-1">
                    <span className="text-slate-400 font-semibold block">Plan Version</span>
                    <span className="font-bold text-indigo-600 dark:text-indigo-400 text-sm">
                      {client.planType === 'paid' ? `Paid Version (${formatDurationLabel(client.durationDays)})` : `Free Version (${formatDurationLabel(client.durationDays)})`}
                    </span>
                  </div>

                  <div className="rounded-2xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950 space-y-1">
                    <span className="text-slate-400 font-semibold block">App Access Status</span>
                    <span className={cn('font-bold text-sm', client.appStatus === 'paused' ? 'text-amber-600' : 'text-emerald-600')}>
                      {client.appStatus === 'paused' ? 'Paused (Data Retained)' : 'Running (Active)'}
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-indigo-50/50 p-4 dark:border-slate-800 dark:bg-indigo-950/20 space-y-2">
                  <div className="flex items-center gap-2 text-indigo-900 dark:text-indigo-200 font-bold text-xs">
                    <ShieldCheck size={16} className="text-indigo-600" />
                    <span>Client Impersonation Security Notice</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    When you click <strong>Open App as Client Admin</strong>, the platform switches your view to operate as the Client Admin for this organization. A top exit banner will allow you to return to the Owner Portal at any time.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
