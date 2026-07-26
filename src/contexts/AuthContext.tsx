import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { User, UserRole } from '../types';
import { mockUsers } from '../data/mockData';
import { hydratePersistedStores } from '../data/store';
import { deviceApi } from '../api/deviceApi';
import { authApi } from '../api/authApi';

/** Only this email may register as admin (one admin account total). */
export const ALLOWED_ADMIN_EMAIL = 'appnep@pacenp.com';

const USERS_KEY = 'ams_auth_users';
const SESSION_KEY = 'ams_user';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (emailOrName: string, password?: string) => Promise<{ success: boolean; error?: string }>;
  signupAdmin: (input: {
    name: string;
    email: string;
    password: string;
    emailVerified: boolean;
  }) => Promise<{ success: boolean; error?: string; alreadyExists?: boolean }>;
  signupEmployee: (input: {
    name: string;
    email: string;
    password: string;
    employeeId: string;
    departmentId?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  signupAccountant: (input: {
    name: string;
    email: string;
    password: string;
  }) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  updateProfile: (patch: Partial<Pick<User, 'name' | 'email' | 'phone' | 'timezone' | 'avatar'>>) => void;
  changePassword: (current: string, next: string) => { success: boolean; error?: string };
  hasRole: (...roles: UserRole[]) => boolean;
  can: (action: string) => boolean;
  getAuthUsers: () => User[];
  hasAdminAccount: () => boolean;
  isEmployeeRegistered: (employeeId: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const ADMIN_BOY_AVATAR =
  'https://api.dicebear.com/9.x/avataaars/svg?seed=AdminKhan&top=shortFlat&facialHairProbability=100&facialHair=beardMedium';

function migrateStoredUser(raw: User): User {
  const avatar = raw.avatar ?? '';
  if (raw.id === 'u1' && (!avatar || avatar.includes('seed=admin'))) {
    return { ...raw, avatar: ADMIN_BOY_AVATAR };
  }
  return raw;
}

function persistSession(user: User) {
  const { password: _p, ...safeUser } = user;
  localStorage.setItem(SESSION_KEY, JSON.stringify(safeUser));
  return safeUser as User;
}

function loadAuthUsers(): User[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as User[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        // One-time wipe of all admin accounts so a fresh admin can sign up
        const wipeKey = 'ams_admins_cleared_v3';
        if (!localStorage.getItem(wipeKey)) {
          const withoutAdmins = parsed.filter((u) => u.role !== 'admin');
          localStorage.setItem(USERS_KEY, JSON.stringify(withoutAdmins));
          localStorage.setItem(wipeKey, '1');
          try {
            const sessionRaw = localStorage.getItem(SESSION_KEY);
            if (sessionRaw) {
              const session = JSON.parse(sessionRaw) as User;
              if (session.role === 'admin') localStorage.removeItem(SESSION_KEY);
            }
          } catch {
            /* ignore */
          }
          return withoutAdmins;
        }
        return parsed;
      }
    }
  } catch {
    /* fall through */
  }
  // Seed without admin/employee — those roles must sign up via portal buttons
  const seeded = mockUsers.filter((u) => u.role !== 'admin' && u.role !== 'employee');
  localStorage.setItem(USERS_KEY, JSON.stringify(seeded));
  return seeded;
}

/** One-time: if an old demo session exists but auth users were reset, keep that account. */
function ensureSessionUserInStore() {
  try {
    const sessionRaw = localStorage.getItem(SESSION_KEY);
    if (!sessionRaw) return;
    const session = JSON.parse(sessionRaw) as User;
    // Clear legacy admin sessions that are not the allowed email
    if (
      session.role === 'admin'
      && session.email.toLowerCase() !== ALLOWED_ADMIN_EMAIL.toLowerCase()
    ) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    const users = loadAuthUsers();
    if (users.some((u) => u.id === session.id || u.email.toLowerCase() === session.email.toLowerCase())) {
      return;
    }
    const fromMock = mockUsers.find(
      (u) => u.id === session.id || u.email.toLowerCase() === session.email.toLowerCase(),
    );
    if (fromMock && !(fromMock.role === 'admin' && fromMock.email.toLowerCase() !== ALLOWED_ADMIN_EMAIL.toLowerCase())) {
      saveAuthUsers([...users, fromMock]);
    }
  } catch {
    /* ignore */
  }
}

function saveAuthUsers(users: User[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export async function hydrateCloudAuthUsers(): Promise<User[]> {
  try {
    const cloudUsers = await authApi.getCloudUsers();
    if (cloudUsers.length > 0) {
      const local = loadAuthUsers();
      const map = new Map<string, User>();
      for (const u of local) map.set(u.email.toLowerCase(), u);
      for (const cu of cloudUsers) {
        const key = cu.email.toLowerCase();
        // The server never returns passwords, so keep the cached one to leave
        // offline sign-in working for accounts created on this device.
        map.set(key, { ...cu, password: map.get(key)?.password ?? '' });
      }
      const merged = Array.from(map.values());
      localStorage.setItem(USERS_KEY, JSON.stringify(merged));
      return merged;
    }
  } catch {}
  return loadAuthUsers();
}

// ─── Permission map ───────────────────────────────────────────────────────────
const permissions: Record<UserRole, string[]> = {
  admin: [
    'employee:read', 'employee:write', 'employee:delete',
    'attendance:read', 'attendance:write', 'attendance:delete',
    'department:read', 'department:write', 'department:delete',
    'leave:read', 'leave:write', 'leave:approve',
    'shift:read', 'shift:write', 'shift:delete',
    'report:read', 'report:export',
    'settings:read', 'settings:write',
    'notification:read',
  ],
  account: [
    'employee:read',
    'attendance:read', 'attendance:write',
    'department:read',
    'leave:read', 'leave:approve',
    'shift:read',
    'report:read', 'report:export',
    'notification:read',
  ],
  hr: [
    'employee:read', 'employee:write',
    'attendance:read', 'attendance:write',
    'department:read',
    'leave:read', 'leave:write', 'leave:approve',
    'shift:read', 'shift:write',
    'report:read', 'report:export',
    'notification:read',
  ],
  dept_manager: [
    'employee:read',
    'attendance:read', 'attendance:write',
    'department:read',
    'leave:read', 'leave:approve',
    'shift:read',
    'report:read',
    'notification:read',
  ],
  employee: [
    'attendance:read:own',
    'leave:read:own', 'leave:write:own',
    'report:read:own',
    'notification:read',
  ],
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    ensureSessionUserInStore();
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) return null;
    try {
      const parsed = migrateStoredUser(JSON.parse(stored) as User);
      localStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
      return parsed;
    } catch {
      return null;
    }
  });

  React.useEffect(() => {
    hydrateCloudAuthUsers();
  }, []);

  const getAuthUsers = useCallback(() => loadAuthUsers(), []);

  const hasAdminAccount = useCallback(() => {
    return loadAuthUsers().some(
      (u) => u.role === 'admin' && u.email.toLowerCase() === ALLOWED_ADMIN_EMAIL.toLowerCase(),
    );
  }, []);

  const isEmployeeRegistered = useCallback((employeeId: string) => {
    const id = String(employeeId).trim();
    return loadAuthUsers().some((u) => u.employeeId === id || u.id === id);
  }, []);

  const login = useCallback(async (emailOrName: string, password = '') => {
    const identifier = emailOrName.trim();
    const key = identifier.toLowerCase();
    let found: User | undefined;

    try {
      // The server holds the credentials; a rejection here is authoritative.
      const verified = await authApi.login(identifier, password);
      if (!verified) {
        return { success: false, error: 'Invalid user name or password' };
      }
      const cached = (await hydrateCloudAuthUsers()).find(
        (u) => u.email.toLowerCase() === verified.email.toLowerCase(),
      );
      found = { ...verified, password: cached?.password || password };
    } catch {
      // Server unreachable — fall back to the offline account cache.
      found = loadAuthUsers().find((u) => {
        const matchId =
          u.email.toLowerCase() === key
          || u.name.trim().toLowerCase() === key;
        return matchId && u.password === password;
      });
    }

    if (!found) {
      return { success: false, error: 'Invalid user name or password' };
    }
    const next = migrateStoredUser(found);
    const safe = persistSession(next);
    setUser(safe);
    // Keep machine employees + attendance available after re-login
    hydratePersistedStores();
    // Reconnect the saved attendance machine automatically if it is on the same network
    deviceApi.reconnect().then((result) => {
      if (result.connected) {
        console.info('[Auth] Attendance machine reconnected automatically');
      }
    });
    return { success: true };
  }, []);

  const signupAdmin = useCallback(async (input: {
    name: string;
    email: string;
    password: string;
    emailVerified: boolean;
  }) => {
    if (!input.emailVerified) {
      return { success: false, error: 'Please verify the email code first.' };
    }

    const email = input.email.trim().toLowerCase();
    const allowed = ALLOWED_ADMIN_EMAIL.toLowerCase();
    if (email !== allowed) {
      return {
        success: false,
        error: `Verification uses ${ALLOWED_ADMIN_EMAIL} only.`,
      };
    }

    const users = loadAuthUsers();
    const created: User = {
      id: `u-admin-${Date.now()}`,
      name: input.name.trim() || 'Admin',
      email: ALLOWED_ADMIN_EMAIL,
      role: 'admin',
      password: input.password,
      phone: '',
      timezone: 'Asia/Kathmandu',
      avatar: ADMIN_BOY_AVATAR,
    };

    // Anyone may create/recreate the admin — replace previous admin accounts
    const withoutAdmins = users.filter((u) => u.role !== 'admin');
    saveAuthUsers([...withoutAdmins, created]);
    authApi.syncCloudUser(created);
    return { success: true };
  }, []);

  const signupEmployee = useCallback(async (input: {
    name: string;
    email: string;
    password: string;
    employeeId: string;
    departmentId?: string;
  }) => {
    const employeeId = String(input.employeeId).trim();
    if (!employeeId) {
      return { success: false, error: 'Select your name from the machine list.' };
    }

    const users = loadAuthUsers();
    if (users.some((u) => u.employeeId === employeeId)) {
      return { success: false, error: 'This employee already has an account. Please sign in.' };
    }

    const email = input.email.trim().toLowerCase();
    if (users.some((u) => u.email.toLowerCase() === email)) {
      return { success: false, error: 'This email is already registered.' };
    }

    const created: User = {
      id: `u-emp-${employeeId}`,
      name: input.name.trim(),
      email,
      role: 'employee',
      password: input.password,
      employeeId,
      departmentId: input.departmentId || 'd0',
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(input.name.trim() || employeeId)}`,
    };
    saveAuthUsers([...users, created]);
    authApi.syncCloudUser(created);
    const safe = persistSession(created);
    setUser(safe);
    return { success: true };
  }, []);

  const signupAccountant = useCallback(async (input: {
    name: string;
    email: string;
    password: string;
  }) => {
    const email = input.email.trim().toLowerCase();
    const users = loadAuthUsers();
    if (users.some((u) => u.email.toLowerCase() === email)) {
      return { success: false, error: 'This email is already registered.' };
    }

    const created: User = {
      id: `u-acct-${Date.now()}`,
      name: input.name.trim() || 'Accountant',
      email,
      role: 'hr',
      password: input.password,
      phone: '',
      timezone: 'Asia/Kathmandu',
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(input.name.trim() || email)}`,
    };
    saveAuthUsers([...users, created]);
    authApi.syncCloudUser(created);
    // Do not auto-login — return to sign-in
    return { success: true };
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
  }, []);

  const updateProfile = useCallback((patch: Partial<Pick<User, 'name' | 'email' | 'phone' | 'timezone' | 'avatar'>>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      const users = loadAuthUsers().map((u) => (u.id === prev.id ? { ...u, ...patch } : u));
      saveAuthUsers(users);
      authApi.syncCloudUser(next);
      return persistSession(next);
    });
  }, []);

  const changePassword = useCallback((current: string, next: string) => {
    if (!user) return { success: false, error: 'Not signed in' };
    const users = loadAuthUsers();
    const mock = users.find((u) => u.id === user.id);
    if (!mock || mock.password !== current) {
      return { success: false, error: 'Current password is incorrect.' };
    }
    mock.password = next;
    saveAuthUsers(users);
    authApi.syncCloudUser(mock);
    return { success: true };
  }, [user]);

  const hasRole = useCallback((...roles: UserRole[]) => {
    return user ? roles.includes(user.role) : false;
  }, [user]);

  const can = useCallback((action: string) => {
    if (!user) return false;
    return permissions[user.role]?.some((p) => p === action || p.startsWith(action + ':')) ?? false;
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      login,
      signupAdmin,
      signupEmployee,
      signupAccountant,
      logout,
      updateProfile,
      changePassword,
      hasRole,
      can,
      getAuthUsers,
      hasAdminAccount,
      isEmployeeRegistered,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
