import React, { createContext, useContext, useCallback, type ReactNode } from 'react';

export type InviteRole = 'accountant' | 'employee';

export interface Invitation {
  token: string;
  email: string;
  role: InviteRole;
  createdAt: string;
  expiresAt: string;
  used: boolean;
}

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

function generateToken(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface InvitationContextType {
  createInvitation: (email: string, role: InviteRole) => { token: string; link: string };
  getInvitation: (token: string) => Invitation | null;
  markUsed: (token: string) => void;
  getAllInvitations: () => Invitation[];
  deleteInvitation: (token: string) => void;
}

const InvitationContext = createContext<InvitationContextType | null>(null);

export function InvitationProvider({ children }: { children: ReactNode }) {
  const createInvitation = useCallback((email: string, role: InviteRole) => {
    const token = generateToken();
    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invite: Invitation = {
      token,
      email: email.trim().toLowerCase(),
      role,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      used: false,
    };

    const invites = loadInvitations();
    // Remove any previous unused invite for this email+role combo
    const filtered = invites.filter(
      (i) => !(i.email === invite.email && i.role === role && !i.used)
    );
    saveInvitations([...filtered, invite]);

    const link = `${window.location.origin}/invite/${token}`;
    return { token, link };
  }, []);

  const getInvitation = useCallback((token: string): Invitation | null => {
    const invite = loadInvitations().find((i) => i.token === token);
    if (!invite) return null;
    if (invite.used) return null;
    if (new Date() > new Date(invite.expiresAt)) return null;
    return invite;
  }, []);

  const markUsed = useCallback((token: string) => {
    const invites = loadInvitations().map((i) =>
      i.token === token ? { ...i, used: true } : i
    );
    saveInvitations(invites);
  }, []);

  const getAllInvitations = useCallback(() => loadInvitations(), []);

  const deleteInvitation = useCallback((token: string) => {
    saveInvitations(loadInvitations().filter((i) => i.token !== token));
  }, []);

  return (
    <InvitationContext.Provider value={{
      createInvitation,
      getInvitation,
      markUsed,
      getAllInvitations,
      deleteInvitation,
    }}>
      {children}
    </InvitationContext.Provider>
  );
}

export function useInvitations() {
  const ctx = useContext(InvitationContext);
  if (!ctx) throw new Error('useInvitations must be used inside InvitationProvider');
  return ctx;
}
