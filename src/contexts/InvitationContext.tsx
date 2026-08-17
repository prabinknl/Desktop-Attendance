import React, { createContext, useContext, useCallback, type ReactNode } from 'react';
import { authApi } from '../api/authApi';
import { buildAppUrl } from '../lib/appEnv';

export type InviteRole = 'accountant' | 'employee' | 'client';

export interface Invitation {
  token: string;
  email: string;
  role: InviteRole;
  createdAt: string;
  expiresAt: string;
  used: boolean;
  phone?: string;
  planType?: 'free' | 'paid';
  freeTrialDays?: number;
  paidDays?: number;
  durationDays?: number;
  companyName?: string;
  appStatus?: 'running' | 'paused';
  status?: 'active' | 'pending' | 'deleted';
  deletedAt?: string;
  deletedBy?: string;
}

/** Keep local cache aligned with the server TTL (display only — server is authoritative). */
const INVITATION_TTL_MS = 240 * 60 * 1000;
const INVITES_KEY = 'ams_invitations';

function loadInvitations(): Invitation[] {
  try {
    const raw = localStorage.getItem(INVITES_KEY);
    if (raw) return JSON.parse(raw) as Invitation[];
  } catch { /* ignore */ }
  return [];
}

function saveInvitations(invites: Invitation[]) {
  localStorage.setItem(INVITES_KEY, JSON.stringify(invites));
}

function generateToken(role?: InviteRole): string {
  if (role === 'accountant' || role === 'employee') {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return (100000 + (arr[0] % 900000)).toString();
  }
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function cacheInvitation(invite: Invitation) {
  const invites = loadInvitations();
  const filtered = invites.filter((i) => i.token !== invite.token);
  saveInvitations([...filtered, invite]);
}

interface ClientInviteDetails {
  phone?: string;
  planType?: 'free' | 'paid';
  freeTrialDays?: number;
  paidDays?: number;
  durationDays?: number;
  companyName?: string;
  appStatus?: 'running' | 'paused';
}

interface InvitationContextType {
  createInvitation: (
    email: string,
    role: InviteRole,
    details?: ClientInviteDetails
  ) => { token: string; link: string };
  fetchInvitation: (token: string) => Promise<InvitationLookupResult>;
  markUsed: (token: string) => void;
  getAllInvitations: () => Invitation[];
  deleteInvitation: (token: string) => void;
  purgeInvitationsByEmail: (email: string) => void;
  updateInvitationPlan: (token: string, planType: 'free' | 'paid', days?: number) => void;
  updateInvitationAppStatus: (token: string, appStatus: 'running' | 'paused') => void;
  softDeleteInvitation: (tokenOrEmail: string, ownerId?: string) => void;
}

const InvitationContext = createContext<InvitationContextType | null>(null);

export function InvitationProvider({ children }: { children: ReactNode }) {
  const createInvitation = useCallback(
    (email: string, role: InviteRole, details?: ClientInviteDetails) => {
      const token = generateToken(role);
      const now = new Date();
      const expires = new Date(now.getTime() + INVITATION_TTL_MS);

      const days = details?.durationDays ?? details?.freeTrialDays ?? details?.paidDays ?? (role === 'client' ? 30 : undefined);

      const invite: Invitation = {
        token,
        email: email.trim().toLowerCase(),
        role,
        createdAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        used: false,
        phone: details?.phone,
        planType: details?.planType ?? (role === 'client' ? 'free' : undefined),
        freeTrialDays: details?.planType === 'free' ? days : undefined,
        paidDays: details?.planType === 'paid' ? days : undefined,
        durationDays: days,
        companyName: details?.companyName,
        appStatus: details?.appStatus ?? 'running',
      };

      const invites = loadInvitations();
      const filtered = invites.filter(
        (i) => !(i.email === invite.email && i.role === role && !i.used)
      );
      saveInvitations([...filtered, invite]);

      const link = buildAppUrl(`/invite/${token}`);
      return { token, link };
    },
    []
  );

  const fetchInvitation = useCallback(async (token: string): Promise<InvitationLookupResult> => {
    const result = await authApi.getInvitation(token);
    if (result.ok) {
      cacheInvitation(result.invitation);
      return result;
    }

    // Fallback to local storage for offline / standalone mode or if server miss occurs
    const norm = token.trim().toLowerCase();
    const localInvites = loadInvitations();
    const localMatch = localInvites.find(
      (i) => i.token.trim().toLowerCase() === norm && !i.used && i.status !== 'deleted'
    );
    if (localMatch) {
      const expiresAt = new Date(localMatch.expiresAt).getTime();
      if (!Number.isNaN(expiresAt) && Date.now() > expiresAt) {
        return {
          ok: false,
          reason: 'expired',
          message: 'This invitation link has expired.',
        };
      }
      return { ok: true, invitation: localMatch };
    }

    return result;
  }, []);

  const markUsed = useCallback((token: string) => {
    const invites = loadInvitations().map((i) =>
      i.token === token ? { ...i, used: true } : i
    );
    saveInvitations(invites);
    authApi.markInvitationUsed(token);
  }, []);

  const getAllInvitations = useCallback(() => loadInvitations(), []);

  const deleteInvitation = useCallback((token: string) => {
    saveInvitations(loadInvitations().filter((i) => i.token !== token));
  }, []);

  const purgeInvitationsByEmail = useCallback((email: string) => {
    const key = email.trim().toLowerCase();
    if (!key) return;
    saveInvitations(loadInvitations().filter((i) => i.email.toLowerCase() !== key));
  }, []);

  const updateInvitationPlan = useCallback(
    (token: string, planType: 'free' | 'paid', days?: number) => {
      const invites = loadInvitations().map((inv) =>
        inv.token === token
          ? {
              ...inv,
              planType,
              durationDays: days ?? inv.durationDays ?? (planType === 'free' ? 30 : 365),
              freeTrialDays: planType === 'free' ? (days ?? inv.freeTrialDays ?? 30) : undefined,
              paidDays: planType === 'paid' ? (days ?? inv.paidDays ?? 365) : undefined,
            }
          : inv
      );
      saveInvitations(invites);
    },
    []
  );

  const updateInvitationAppStatus = useCallback(
    (token: string, appStatus: 'running' | 'paused') => {
      const invites = loadInvitations().map((inv) =>
        inv.token === token ? { ...inv, appStatus } : inv
      );
      saveInvitations(invites);
    },
    []
  );

  const softDeleteInvitation = useCallback(
    (tokenOrEmail: string, ownerId?: string) => {
      const key = tokenOrEmail.toLowerCase();
      const now = new Date().toISOString();
      const invites = loadInvitations().map((inv) =>
        inv.token === tokenOrEmail || inv.email.toLowerCase() === key
          ? {
              ...inv,
              status: 'deleted' as const,
              deletedAt: now,
              deletedBy: ownerId || 'owner',
            }
          : inv
      );
      saveInvitations(invites);
    },
    []
  );

  return (
    <InvitationContext.Provider
      value={{
        createInvitation,
        fetchInvitation,
        markUsed,
        getAllInvitations,
        deleteInvitation,
        purgeInvitationsByEmail,
        updateInvitationPlan,
        updateInvitationAppStatus,
        softDeleteInvitation,
      }}
    >
      {children}
    </InvitationContext.Provider>
  );
}

export function useInvitations() {
  const ctx = useContext(InvitationContext);
  if (!ctx) throw new Error('useInvitations must be used inside InvitationProvider');
  return ctx;
}
import type { InvitationLookupResult } from '../lib/inviteToken';