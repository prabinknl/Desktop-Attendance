import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  UserPlus,
  Mail,
  Copy,
  Check,
  Search,
  Trash2,
  Clock,
  ShieldCheck,
  Sparkles,
  Zap,
  RefreshCw,
  Edit3,
  Calendar,
  X,
  Sliders,
  Play,
  Pause,
  ExternalLink,
  Activity,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useInvitations } from '../../contexts/InvitationContext';
import { useNotifications } from '../../contexts/NotificationContext';
import AddClientModal from '../../components/AddClientModal';
import ClientDetailModal from '../../components/ClientDetailModal';
import { cn, getInitials, formatDurationLabel } from '../../lib/utils';
import { buildAppUrl } from '../../lib/appEnv';

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

export default function OwnerDashboardPage() {
  const { getAuthUsers, user, updateClientAppStatus, impersonateClient, softDeleteClient } = useAuth();
  const { getAllInvitations, deleteInvitation, createInvitation, updateInvitationPlan, updateInvitationAppStatus, softDeleteInvitation } = useInvitations();
  const { toast } = useNotifications();

  const [addClientModalOpen, setAddClientModalOpen] = useState(false);
  const [selectedDetailClient, setSelectedDetailClient] = useState<ClientItem | null>(null);
  const [deletingClient, setDeletingClient] = useState<ClientItem | null>(null);
  const [editingClient, setEditingClient] = useState<ClientItem | null>(null);
  const [editPlanType, setEditPlanType] = useState<'free' | 'paid'>('free');
  const [editDays, setEditDays] = useState<number>(30);
  const [editAppStatus, setEditAppStatus] = useState<'running' | 'paused'>('running');

  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'free' | 'paid' | 'paused' | 'pending' | 'deleted'>('all');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Collect registered admins/clients + pending invitations
  const clients = useMemo<ClientItem[]>(() => {
    const registered = getAuthUsers()
      .filter((u) => u.role === 'client')
      .map((u) => {
        const pType = u.planType ?? 'free';
        const dDays = u.durationDays ?? (pType === 'free' ? u.freeDays ?? 30 : u.paidDays ?? 365);
        return {
          id: u.id,
          name: u.companyName || u.name,
          companyName: u.companyName,
          email: u.email,
          role: 'Client Admin',
          planType: pType,
          freeDays: u.freeDays ?? 30,
          paidDays: u.paidDays ?? 365,
          durationDays: dDays,
          appStatus: u.appStatus ?? 'running',
          status: (u.status || 'active') as 'active' | 'pending' | 'deleted',
          deletedAt: u.deletedAt,
          deletedBy: u.deletedBy,
          createdAt: 'Registered',
          avatar: u.avatar,
        };
      });

    const invitations = getAllInvitations()
      .filter((inv) => inv.role === 'client' && !inv.used)
      .map((inv) => {
        const pType = inv.planType ?? 'free';
        const dDays = inv.durationDays ?? (pType === 'free' ? inv.freeTrialDays ?? 30 : inv.paidDays ?? 365);
        return {
          id: `inv-${inv.token}`,
          name: inv.companyName || (inv.email.split('@')[0] ? `${inv.email.split('@')[0]} Org` : 'Client Org'),
          companyName: inv.companyName,
          email: inv.email,
          role: 'Client Admin',
          planType: pType,
          freeDays: inv.freeTrialDays ?? 30,
          paidDays: inv.paidDays ?? 365,
          durationDays: dDays,
          appStatus: inv.appStatus ?? 'running',
          status: (inv.status || 'pending') as 'active' | 'pending' | 'deleted',
          deletedAt: inv.deletedAt,
          deletedBy: inv.deletedBy,
          createdAt: new Date(inv.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
          inviteToken: inv.token,
          inviteLink: buildAppUrl(`/invite/${inv.token}`),
        };
      });

    return [...invitations, ...registered];
  }, [getAuthUsers, getAllInvitations]);

  const filteredClients = useMemo(() => {
    return clients.filter((c) => {
      const matchesSearch =
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.companyName && c.companyName.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;
      if (filterTab === 'deleted') return c.status === 'deleted';

      // Non-deleted filter views exclude deleted accounts
      if (c.status === 'deleted') return false;
      if (filterTab === 'free') return c.planType === 'free';
      if (filterTab === 'paid') return c.planType === 'paid';
      if (filterTab === 'paused') return c.appStatus === 'paused';
      if (filterTab === 'pending') return c.status === 'pending';
      return true;
    });
  }, [clients, searchQuery, filterTab]);

  const stats = useMemo(() => {
    const activeAndPending = clients.filter((c) => c.status !== 'deleted');
    const total = activeAndPending.length;
    const free = activeAndPending.filter((c) => c.planType === 'free').length;
    const paid = activeAndPending.filter((c) => c.planType === 'paid').length;
    const paused = activeAndPending.filter((c) => c.appStatus === 'paused').length;
    const pending = activeAndPending.filter((c) => c.status === 'pending').length;
    const deleted = clients.filter((c) => c.status === 'deleted').length;
    return { total, free, paid, paused, pending, deleted };
  }, [clients]);

  const handleCopyLink = async (link: string, token: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedToken(token);
      toast('success', 'Invitation link copied!');
      setTimeout(() => setCopiedToken(null), 2500);
    } catch {
      toast('error', 'Failed to copy link.');
    }
  };

  const handleDeleteClient = (client: ClientItem) => {
    setDeletingClient(client);
  };

  const confirmDeleteClient = () => {
    if (!deletingClient) return;

    if (deletingClient.inviteToken) {
      softDeleteInvitation(deletingClient.inviteToken, user?.id);
    }
    softDeleteClient(deletingClient.id);

    toast('info', `Client ${deletingClient.name} account disabled. All data safely retained.`);
    setDeletingClient(null);
  };

  const handleOpenEditPlan = (client: ClientItem) => {
    setEditingClient(client);
    setEditPlanType(client.planType);
    setEditDays(client.durationDays || (client.planType === 'free' ? client.freeDays || 30 : client.paidDays || 365));
    setEditAppStatus(client.appStatus || 'running');
  };

  const handleSavePlan = () => {
    if (!editingClient) return;

    if (editingClient.inviteToken) {
      updateInvitationPlan(editingClient.inviteToken, editPlanType, editDays);
      updateInvitationAppStatus(editingClient.inviteToken, editAppStatus);
    } else {
      updateClientAppStatus(editingClient.id, editAppStatus);
    }

    if (editAppStatus === 'paused') {
      toast('warning', `App access PAUSED for ${editingClient.name}. Client & employees cannot log in; all data is safely preserved.`);
    } else {
      toast('success', `Updated plan for ${editingClient.name} (${editPlanType === 'free' ? `Free ${editDays} Days` : `Paid ${editDays} Days`}). App is Running.`);
    }

    setEditingClient(null);
  };

  const handleToggleAppStatus = (client: ClientItem) => {
    const nextStatus = client.appStatus === 'paused' ? 'running' : 'paused';
    if (client.inviteToken) {
      updateInvitationAppStatus(client.inviteToken, nextStatus);
    } else {
      updateClientAppStatus(client.id, nextStatus);
    }

    if (nextStatus === 'paused') {
      toast('warning', `App access PAUSED for ${client.name}. Access suspended; all data is safely saved.`);
    } else {
      toast('success', `App access RESUMED for ${client.name}. Client can log in and use full data.`);
    }
  };

  const handleOpenClientApp = (client: ClientItem) => {
    impersonateClient({
      id: client.id,
      email: client.email,
      name: client.name,
      companyName: client.companyName,
      status: client.status,
    });
    if (client.status === 'deleted') {
      toast('info', `Owner viewing saved client data for soft-deleted account: ${client.companyName || client.name}`);
    } else {
      toast('info', `Opened app as Client Admin for ${client.companyName || client.name}`);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ── Top Header & Banner ────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-8 text-white shadow-xl">
        <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute right-40 -bottom-10 h-48 w-48 rounded-full bg-sky-500/10 blur-2xl" />

        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-indigo-300 backdrop-blur-md">
            <Sparkles size={14} className="text-indigo-400" />
            <span>Owner Admin & Client Portal</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Client Admin Directory
          </h1>
          <p className="max-w-2xl text-sm text-slate-300">
            Click any client name to open the app as Admin for that client and inspect all recorded client activity logs.
          </p>
        </div>
      </div>

      {/* ── KPI Stat Cards ────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
            <Building2 size={24} />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Clients</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
            <Clock size={24} />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Free Version (Trial)</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.free}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
            <Zap size={24} />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Paid Version</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.paid}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
            <Pause size={24} />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Paused Apps</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.paused}</p>
          </div>
        </div>
      </div>

      {/* ── Filter & Search Bar ───────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Filter Chips */}
        <div className="flex items-center rounded-2xl bg-slate-100 p-1 dark:bg-slate-800/80 overflow-x-auto">
          <button
            onClick={() => setFilterTab('all')}
            className={cn(
              'px-4 py-2 text-xs font-semibold rounded-xl transition-all whitespace-nowrap',
              filterTab === 'all'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            )}
          >
            All Clients ({stats.total})
          </button>
          <button
            onClick={() => setFilterTab('free')}
            className={cn(
              'px-4 py-2 text-xs font-semibold rounded-xl transition-all whitespace-nowrap',
              filterTab === 'free'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            )}
          >
            Free ({stats.free})
          </button>
          <button
            onClick={() => setFilterTab('paid')}
            className={cn(
              'px-4 py-2 text-xs font-semibold rounded-xl transition-all whitespace-nowrap',
              filterTab === 'paid'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            )}
          >
            Paid ({stats.paid})
          </button>
          <button
            onClick={() => setFilterTab('paused')}
            className={cn(
              'px-4 py-2 text-xs font-semibold rounded-xl transition-all whitespace-nowrap',
              filterTab === 'paused'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            )}
          >
            Paused ({stats.paused})
          </button>
          <button
            onClick={() => setFilterTab('pending')}
            className={cn(
              'px-4 py-2 text-xs font-semibold rounded-xl transition-all whitespace-nowrap',
              filterTab === 'pending'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            )}
          >
            Pending ({stats.pending})
          </button>
          <button
            onClick={() => setFilterTab('deleted')}
            className={cn(
              'px-4 py-2 text-xs font-semibold rounded-xl transition-all whitespace-nowrap',
              filterTab === 'deleted'
                ? 'bg-rose-600 text-white shadow-sm font-bold'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            )}
          >
            Deleted ({stats.deleted})
          </button>
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by client name or email..."
            className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          />
        </div>
      </div>

      {/* ── Client Table ──────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {filteredClients.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                  <th className="px-6 py-4 font-semibold">Client Admin & Company</th>
                  <th className="px-6 py-4 font-semibold">Role</th>
                  <th className="px-6 py-4 font-semibold">Version Plan</th>
                  <th className="px-6 py-4 font-semibold">App Access Status</th>
                  <th className="px-6 py-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredClients.map((client) => (
                  <tr
                    key={client.id}
                    className={cn(
                      'group hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors',
                      client.status === 'deleted' && 'bg-rose-50/20 dark:bg-rose-950/10',
                      client.appStatus === 'paused' && client.status !== 'deleted' && 'bg-amber-50/30 dark:bg-amber-950/10'
                    )}
                  >
                    {/* Name & Email (Clickable to view activity logs) */}
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleOpenClientApp(client)}
                        title="Click client name to open Client Admin Dashboard"
                        className="flex items-center gap-3 text-left group/name hover:opacity-90 transition-opacity cursor-pointer"
                      >
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-100 font-bold text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400 group-hover/name:ring-2 group-hover/name:ring-indigo-500 transition-all">
                          {client.avatar ? (
                            <img src={client.avatar} alt={client.name} className="h-full w-full rounded-xl object-cover" />
                          ) : (
                            getInitials(client.name)
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 dark:text-white truncate group-hover/name:text-indigo-600 dark:group-hover/name:text-indigo-400 flex items-center gap-1.5">
                            <span>{client.name}</span>
                            {client.status === 'deleted' ? (
                              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                                Soft-Deleted
                              </span>
                            ) : (
                              <Activity size={12} className="text-indigo-500 opacity-0 group-hover/name:opacity-100 transition-opacity" />
                            )}
                          </p>
                          <p className="text-slate-500 dark:text-slate-400 truncate text-[11px]">
                            {client.email}
                          </p>
                        </div>
                      </button>
                    </td>

                    {/* Role */}
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        <Building2 size={13} className="text-slate-400" />
                        Client Admin
                      </span>
                    </td>

                    {/* Version Plan Badge */}
                    <td className="px-6 py-4">
                      {client.planType === 'paid' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-bold text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/40">
                          <Zap size={13} className="fill-emerald-500 text-emerald-500" />
                          Paid ({formatDurationLabel(client.durationDays || client.paidDays || 365)})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 font-bold text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/40">
                          <Clock size={13} className="text-indigo-500" />
                          Free ({formatDurationLabel(client.durationDays || client.freeDays || 30)})
                        </span>
                      )}
                    </td>

                    {/* App Access Status */}
                    <td className="px-6 py-4">
                      {client.status === 'deleted' ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1 font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                            <Trash2 size={13} className="text-rose-600 dark:text-rose-400" />
                            Account Deleted
                          </span>
                          {client.deletedAt && (
                            <span className="text-[10px] text-slate-400 font-medium pl-1">
                              Deleted: {new Date(client.deletedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                          )}
                        </div>
                      ) : client.appStatus === 'paused' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                          <Pause size={13} className="fill-amber-600 text-amber-600" />
                          Paused (Data Saved)
                        </span>
                      ) : client.status === 'active' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Running (Active)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 font-semibold text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                          Pending Invite
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Open App as Client Admin */}
                        <button
                          onClick={() => handleOpenClientApp(client)}
                          title={client.status === 'deleted' ? 'Inspect Saved Client Data' : 'Open App as Client Admin'}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 font-extrabold text-xs text-white hover:bg-indigo-700 transition-all shadow-sm shadow-indigo-600/20 cursor-pointer"
                        >
                          <Play size={13} className="fill-white" />
                          <span>{client.status === 'deleted' ? 'View Saved Data' : 'Open App'}</span>
                          <ExternalLink size={12} className="opacity-80" />
                        </button>

                        {client.status !== 'deleted' && (
                          <>
                            {/* 1-Click Run / Pause Button */}
                            <button
                              onClick={() => handleToggleAppStatus(client)}
                              title={client.appStatus === 'paused' ? 'Click to Run App' : 'Click to Pause App'}
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-bold text-xs transition-all shadow-sm cursor-pointer',
                                client.appStatus === 'paused'
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                                  : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                              )}
                            >
                              {client.appStatus === 'paused' ? (
                                <>
                                  <Play size={13} className="fill-emerald-600 text-emerald-600" />
                                  <span>Run</span>
                                </>
                              ) : (
                                <>
                                  <Pause size={13} className="fill-amber-600 text-amber-600" />
                                  <span>Pause</span>
                                </>
                              )}
                            </button>

                            {/* Manage Plan Modal */}
                            <button
                              onClick={() => handleOpenEditPlan(client)}
                              title="Manage Plan & Access Status"
                              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
                            >
                              <Sliders size={14} />
                              <span>Manage</span>
                            </button>

                            {/* Copy Link */}
                            {client.inviteLink && (
                              <button
                                onClick={() => handleCopyLink(client.inviteLink!, client.inviteToken!)}
                                title="Copy Invitation Link"
                                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer"
                              >
                                {copiedToken === client.inviteToken ? (
                                  <Check size={14} className="text-emerald-500" />
                                ) : (
                                  <Copy size={14} />
                                )}
                              </button>
                            )}

                            {/* Delete Client */}
                            <button
                              onClick={() => handleDeleteClient(client)}
                              title="Delete Client Account"
                              className="rounded-xl p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30 dark:hover:text-rose-400 cursor-pointer"
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Empty State */
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-indigo-50 text-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-400 mb-4">
              <Building2 size={32} />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              No Client Accounts Found
            </h3>
            <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
              Add client admins to manage access duration and Run or Pause status with full data preservation.
            </p>
            <button
              onClick={() => setAddClientModalOpen(true)}
              className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-indigo-500 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-600"
            >
              <UserPlus size={16} />
              <span>Add Clients</span>
            </button>
          </div>
        )}
      </div>

      {/* Add Client Modal */}
      <AddClientModal open={addClientModalOpen} onClose={() => setAddClientModalOpen(false)} />

      {/* Client Detail & Activity Log Modal */}
      <ClientDetailModal
        client={selectedDetailClient}
        onClose={() => setSelectedDetailClient(null)}
        onOpenManagePlan={handleOpenEditPlan}
        onToggleAppStatus={handleToggleAppStatus}
      />

      {/* Delete Client Confirmation Modal */}
      <AnimatePresence>
        {deletingClient && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeletingClient(null)}
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
              <div className="pointer-events-auto w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
                  <Trash2 size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                    Delete client account?
                  </h3>
                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    This will disable the client administrator and all employees under this client. Their data will remain safely stored.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setDeletingClient(null)}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDeleteClient}
                    className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 shadow-md shadow-rose-600/20 cursor-pointer"
                  >
                    Delete Account
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Manage Plan & Execution Status Modal */}
      <AnimatePresence>
        {editingClient && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingClient(null)}
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
              <div className="pointer-events-auto w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      Manage Plan for {editingClient.name}
                    </h3>
                    <p className="text-xs text-slate-500">{editingClient.email}</p>
                  </div>
                  <button onClick={() => setEditingClient(null)} className="text-slate-400 hover:text-slate-600">
                    <X size={18} />
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Access Version */}
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Select Access Version
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setEditPlanType('free')}
                      className={cn(
                        'p-3.5 rounded-2xl border-2 text-left font-bold text-xs flex flex-col gap-1 transition-all',
                        editPlanType === 'free'
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400'
                          : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                      )}
                    >
                      <Clock size={16} />
                      <span>Free Version</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditPlanType('paid')}
                      className={cn(
                        'p-3.5 rounded-2xl border-2 text-left font-bold text-xs flex flex-col gap-1 transition-all',
                        editPlanType === 'paid'
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                          : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                      )}
                    >
                      <Zap size={16} />
                      <span>Paid Version</span>
                    </button>
                  </div>

                  {/* Duration input */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {editPlanType === 'free' ? 'Fixed Free Trial Duration (Days)' : 'Paid Subscription Duration (Days)'}
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="3650"
                      value={editDays}
                      onChange={(e) => setEditDays(parseInt(e.target.value, 10) || (editPlanType === 'free' ? 30 : 365))}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    />
                  </div>

                  {/* App Execution State (Run vs Pause) */}
                  <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      App Execution Control
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setEditAppStatus('running')}
                        className={cn(
                          'p-3.5 rounded-2xl border-2 text-left font-bold text-xs flex items-center gap-2 transition-all',
                          editAppStatus === 'running'
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-400'
                        )}
                      >
                        <Play size={16} className="fill-emerald-500 text-emerald-500" />
                        <span>Run App</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setEditAppStatus('paused')}
                        className={cn(
                          'p-3.5 rounded-2xl border-2 text-left font-bold text-xs flex items-center gap-2 transition-all',
                          editAppStatus === 'paused'
                            ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                            : 'border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-400'
                        )}
                      >
                        <Pause size={16} className="fill-amber-500 text-amber-500" />
                        <span>Pause App</span>
                      </button>
                    </div>

                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                      {editAppStatus === 'paused'
                        ? '⏸ Client and company employees cannot log in while paused. All data is 100% saved and protected.'
                        : '▶ Client and company employees have full active access with all saved data intact.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    onClick={() => setEditingClient(null)}
                    className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSavePlan}
                    className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-700"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
