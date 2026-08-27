import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { User, UserRole } from '../types';
import { mockUsers } from '../data/mockData';
import { hydratePersistedStores } from '../data/store';
import { deviceApi } from '../api/deviceApi';
import { authApi } from '../api/authApi';
import { logClientActivity, ensureSampleClientActivities } from '../lib/clientActivity';

/** Only this email may register as admin (one admin account total). */
export const ALLOWED_ADMIN_EMAIL = 'appnep@pacenp.com';
export const OWNER_EMAIL = 'appnep@pacenp.com';
export const OWNER_SIGNIN_EMAILS = ['noreply@appnep.com', OWNER_EMAIL, 'bpkhanal.app@gmail.com'];

export function formatEmailList(emails: string[]): string {
  if (emails.length <= 1) return emails[0] || '';
  if (emails.length === 2) return `${emails[0]} and ${emails[1]}`;
  return `${emails.slice(0, -1).join(', ')} and ${emails[emails.length - 1]}`;
}

const USERS_KEY = 'ams_auth_users';
const SESSION_KEY = 'ams_user';
const DELETED_CLIENTS_KEY = 'ams_deleted_clients';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (emailOrName: string, password?: string) => Promise<{ success: boolean; error?: string }>;
  loginOwner: () => Promise<{ success: boolean; error?: string }>;
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
  getDeletedClients: () => User[];
  hasAdminAccount: () => boolean;
  isEmployeeRegistered: (employeeId: string) => boolean;
  updateClientAppStatus: (userIdOrEmail: string, appStatus: 'running' | 'paused') => void;
  softDeleteClient: (clientIdOrEmail: string) => Promise<void>;
  realOwnerUser: User | null;
  isImpersonating: boolean;
  impersonateClient: (client: { email: string; name: string; id?: string; companyName?: string; status?: string }) => void;
  exitImpersonation: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const ADMIN_BOY_AVATAR =
  'https://api.dicebear.com/9.x/avataaars/svg?seed=AdminKhan&top=shortFlat&facialHairProbability=100&facialHair=beardMedium';

function ensureOwnerUser(users: User[]): User[] {
  const ownerEmail = OWNER_EMAIL.toLowerCase();
  const ownerExists = users.some((u) => u.email.toLowerCase() === ownerEmail && u.role === 'owner');

  let nextUsers = users;
  if (!ownerExists) {
    nextUsers = [
      ...users.filter((u) => u.email.toLowerCase() !== ownerEmail || u.role !== 'owner'),
      {
        id: 'u-owner-1',
        name: 'Owner',
        email: OWNER_EMAIL,
        role: 'owner',
        password: 'owner-session',
        phone: '',
        timezone: 'Asia/Kathmandu',
        avatar: ADMIN_BOY_AVATAR,
      },
    ];
  }

  // Seed sample client admin accounts if none exist. Never revive emails
  // the owner already moved to the Deleted tab.
  const deletedEmails = new Set(loadDeletedClients().map((u) => u.email.toLowerCase()));
  const hasClients = nextUsers.some(
    (u) => u.role === 'client' && u.status !== 'deleted' && !deletedEmails.has(u.email.toLowerCase()),
  );
  if (!hasClients) {
    const sampleClients: User[] = [
      {
        id: 'u-client-1',
        name: 'Acme Software Solutions',
        companyName: 'Acme Software Solutions',
        email: 'admin@acmesoft.com',
        role: 'client' as UserRole,
        password: 'client123',
        planType: 'free' as const,
        freeDays: 30,
        avatar: 'https://api.dicebear.com/7.x/identicon/svg?seed=acmesoft',
      },
      {
        id: 'u-client-2',
        name: 'Globex Global Systems',
        companyName: 'Globex Global Systems',
        email: 'contact@globex.com',
        role: 'client' as UserRole,
        password: 'client123',
        planType: 'paid' as const,
        freeDays: 0,
        avatar: 'https://api.dicebear.com/7.x/identicon/svg?seed=globex',
      },
      {
        id: 'u-client-3',
        name: 'Apex Digital Agency',
        companyName: 'Apex Digital Agency',
        email: 'hello@apexdigital.com',
        role: 'client' as UserRole,
        password: 'client123',
        planType: 'free' as const,
        freeDays: 14,
        avatar: 'https://api.dicebear.com/7.x/identicon/svg?seed=apex',
      },
    ].filter((sample) => !deletedEmails.has(sample.email.toLowerCase()));
    if (sampleClients.length > 0) {
      nextUsers = [...nextUsers, ...sampleClients];
    }
  }

  return nextUsers;
}

function migrateStoredUser(raw: User): User {
  let user = raw;
  const avatar = user.avatar ?? '';
  if (user.id === 'u1' && (!avatar || avatar.includes('seed=admin'))) {
    user = { ...user, avatar: ADMIN_BOY_AVATAR };
  }
  if ((user.role as string) === 'accountant' || (user.id && user.id.startsWith('u-acct-') && user.role === 'hr')) {
    user = { ...user, role: 'account' };
  }
  return user;
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
        }

        let changed = false;
        const migrated = parsed.map((u) => {
          if ((u.role as string) === 'accountant' || (u.id && u.id.startsWith('u-acct-') && u.role === 'hr')) {
            changed = true;
            return { ...u, role: 'account' as UserRole };
          }
          return u;
        });
        const ensured = ensureOwnerUser(migrated);
        if (changed || ensured.length !== migrated.length) {
          localStorage.setItem(USERS_KEY, JSON.stringify(ensured));
        }
        return ensured;
      }
    }
  } catch {
    /* fall through */
  }
  // Seed without admin/employee — those roles must sign up via portal buttons
  const seeded = mockUsers.filter((u) => u.role !== 'admin' && u.role !== 'employee');
  const ensured = ensureOwnerUser(seeded);
  localStorage.setItem(USERS_KEY, JSON.stringify(ensured));
  return ensured;
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

function loadDeletedClients(): User[] {
  try {
    const raw = localStorage.getItem(DELETED_CLIENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as User[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDeletedClients(users: User[]) {
  localStorage.setItem(DELETED_CLIENTS_KEY, JSON.stringify(users));
}

function isDeletedClientEmail(email: string): boolean {
  const key = email.trim().toLowerCase();
  if (!key) return false;
  return loadDeletedClients().some((u) => u.email.toLowerCase() === key);
}

/** Owner and client-admin may share an email; keep them as separate directory rows. */
function authRecordKey(u: Pick<User, 'email' | 'role'>): string {
  const email = u.email.toLowerCase();
  return u.role === 'owner' ? `owner:${email}` : email;
}

function releaseDeletedClientEmail(email: string) {
  const key = email.trim().toLowerCase();
  if (!key) return;
  saveDeletedClients(loadDeletedClients().filter((u) => u.email.toLowerCase() !== key));
}

export async function hydrateCloudAuthUsers(): Promise<User[]> {
  try {
    const cloudUsers = await authApi.getCloudUsers();
    if (cloudUsers.length > 0) {
      const local = loadAuthUsers();
      const archived = loadDeletedClients();
      const map = new Map<string, User>();
      for (const u of local) {
        const emailKey = u.email.toLowerCase();
        const locallyDeleted =
          u.role !== 'owner'
          && (u.status === 'deleted' || archived.some((d) => d.email.toLowerCase() === emailKey));
        // Keep owner-deleted accounts out of the active directory even if cloud
        // no longer has them (or still has a stale live copy).
        if (locallyDeleted) {
          map.set(authRecordKey(u), { ...u, status: 'deleted' });
          continue;
        }
        map.set(authRecordKey(u), u);
      }
      for (const cu of cloudUsers) {
        const emailKey = cu.email.toLowerCase();
        const cloudRole = ((cu.role as string ?? '').trim().toLowerCase() || undefined) as User['role'] | undefined;
        const recordKey = authRecordKey({ email: cu.email, role: cloudRole || 'employee' });
        const existing = map.get(recordKey);
        const archivedUser = archived.find((d) => d.email.toLowerCase() === emailKey);
        const localRole = existing?.role;
        const cloudDeleted = String(cu.status ?? '').toLowerCase() === 'deleted';
        const locallyDeleted =
          existing?.role !== 'owner'
          && (existing?.status === 'deleted' || Boolean(archivedUser));

        // A later signup is a new identity (new id) and may reuse the email.
        const isNewCloudIdentity =
          !cloudDeleted
          && Boolean(archivedUser)
          && (!archivedUser.id || !cu.id || cu.id !== archivedUser.id);
        if (locallyDeleted && isNewCloudIdentity) {
          releaseDeletedClientEmail(emailKey);
          map.set(recordKey, {
            ...existing,
            ...cu,
            role: (cloudRole ?? localRole ?? 'employee') as User['role'],
            password: existing?.password ?? '',
            avatar: cu.avatar || existing?.avatar || '',
            status: (cu.status as User['status']) || 'active',
            companyName: cu.companyName || existing?.companyName,
            planType: cu.planType || existing?.planType,
            clientId: cu.clientId || existing?.clientId,
            accessExpiresAt: cu.accessExpiresAt || existing?.accessExpiresAt,
          });
          continue;
        }

        if (locallyDeleted || cloudDeleted) {
          map.set(recordKey, {
            ...existing,
            ...cu,
            role: (cloudRole ?? localRole ?? 'employee') as User['role'],
            password: existing?.password ?? '',
            avatar: cu.avatar || existing?.avatar || '',
            status: 'deleted',
            deletedAt: existing?.deletedAt || archivedUser?.deletedAt,
            deletedBy: existing?.deletedBy || archivedUser?.deletedBy,
            companyName: cu.companyName || existing?.companyName,
            planType: cu.planType || existing?.planType,
            clientId: cu.clientId || existing?.clientId,
            accessExpiresAt: cu.accessExpiresAt || existing?.accessExpiresAt,
          });
          continue;
        }

        map.set(recordKey, {
          ...existing,
          ...cu,
          role: (cloudRole ?? localRole ?? 'employee') as User['role'],
          password: existing?.password ?? '',
          avatar: cu.avatar || existing?.avatar || '',
          companyName: cu.companyName || existing?.companyName,
          planType: cu.planType || existing?.planType,
          clientId: cu.clientId || existing?.clientId,
          accessExpiresAt: cu.accessExpiresAt || existing?.accessExpiresAt,
        });
      }
      const merged = Array.from(map.values());
      localStorage.setItem(USERS_KEY, JSON.stringify(merged));
      return merged;
    }
  } catch { }
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
  owner: [
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
    'attendance:read',
    'leave:read',
    'device_settings:read',
    'device_settings:write',
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
  client: [
    'employee:read', 'employee:write', 'employee:delete',
    'attendance:read', 'attendance:write', 'attendance:delete',
    'department:read', 'department:write', 'department:delete',
    'leave:read', 'leave:write', 'leave:approve',
    'shift:read', 'shift:write', 'shift:delete',
    'report:read', 'report:export',
    'settings:read', 'settings:write',
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

  const [usersVersion, setUsersVersion] = useState(0);
  const bumpAuthUsers = useCallback(() => setUsersVersion((v) => v + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    hydrateCloudAuthUsers().then(() => {
      if (!cancelled) bumpAuthUsers();
    });
    return () => {
      cancelled = true;
    };
  }, [bumpAuthUsers]);

  const getAuthUsers = useCallback(() => loadAuthUsers(), [usersVersion]);

  const getDeletedClients = useCallback(() => loadDeletedClients(), []);

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

    // Check if the identifier matches a soft-deleted client admin or employee under a soft-deleted client
    const allUsers = loadAuthUsers();
    const archivedClients = loadDeletedClients();
    const targetAccount = allUsers.find(
      (u) =>
        u.email.toLowerCase() === key ||
        u.name.trim().toLowerCase() === key ||
        (u.employeeId && u.employeeId.toLowerCase() === key)
    ) || archivedClients.find(
      (u) =>
        u.email.toLowerCase() === key ||
        u.name.trim().toLowerCase() === key ||
        (u.employeeId && u.employeeId.toLowerCase() === key)
    );

    if (isDeletedClientEmail(identifier) || archivedClients.some((u) => u.name.trim().toLowerCase() === key || (u.employeeId && u.employeeId.toLowerCase() === key))) {
      if (!OWNER_SIGNIN_EMAILS.includes(key)) {
        return {
          success: false,
          error: 'Your company account has been disabled. Please contact the application owner.',
        };
      }
    }

    if (targetAccount && targetAccount.role !== 'owner') {
      const isDeletedAccount = targetAccount.status === 'deleted';
      let isParentClientDeleted = false;
      if (targetAccount.clientId || targetAccount.companyName) {
        const parentClient = allUsers.find(
          (u) =>
            u.role === 'client' &&
            (u.id === targetAccount.clientId ||
              (u.companyName && u.companyName === targetAccount.companyName))
        );
        if (parentClient && parentClient.status === 'deleted') {
          isParentClientDeleted = true;
        }
      }

      if (isDeletedAccount || isParentClientDeleted) {
        return {
          success: false,
          error: 'Your company account has been disabled. Please contact the application owner.',
        };
      }
    }

    let found: User | undefined;

    try {
      const verified = await authApi.login(identifier, password);
      if (verified) {
        const cached = (await hydrateCloudAuthUsers()).find(
          (u) => u.email.toLowerCase() === verified.email.toLowerCase(),
        );
        found = { ...verified, password: cached?.password || password };
      }
    } catch {
      /* Server unreachable or offline */
    }

    if (!found) {
      // Fall back to local account store (offline cache / local registration)
      found = allUsers.find((u) => {
        const matchId =
          u.email.toLowerCase() === key ||
          u.name.trim().toLowerCase() === key;
        return matchId && u.password === password;
      });
    }

    if (!found) {
      return { success: false, error: 'Invalid user name or password' };
    }

    if (found.role !== 'owner') {
      const isDeletedAccount = found.status === 'deleted';
      let isParentClientDeleted = false;
      if (found.clientId || found.companyName) {
        const parentClient = allUsers.find(
          (u) =>
            u.role === 'client' &&
            (u.id === found!.clientId ||
              (u.companyName && u.companyName === found!.companyName))
        );
        if (parentClient && parentClient.status === 'deleted') {
          isParentClientDeleted = true;
        }
        // Inherit Free/Paid + expiry from the organization client record when missing
        if (found.role === 'admin' && parentClient) {
          found = {
            ...found,
            planType: found.planType ?? parentClient.planType ?? 'free',
            freeDays: found.freeDays ?? parentClient.freeDays,
            paidDays: found.paidDays ?? parentClient.paidDays,
            durationDays: found.durationDays ?? parentClient.durationDays,
            accessExpiresAt: found.accessExpiresAt ?? parentClient.accessExpiresAt,
            companyName: found.companyName ?? parentClient.companyName,
            clientId: found.clientId ?? parentClient.id,
          };
        }
      }

      if (found.role === 'admin' && !found.planType) {
        found = { ...found, planType: 'free' };
      }

      if (isDeletedAccount || isParentClientDeleted || isDeletedClientEmail(found.email)) {
        return {
          success: false,
          error: 'Your company account has been disabled. Please contact the application owner.',
        };
      }

      if (found.appStatus === 'paused') {
        return {
          success: false,
          error: 'Your organization account is currently paused by the administrator. All your data is safely retained. Please contact the administrator to resume access.',
        };
      }
    }

    const next = migrateStoredUser(found);
    const safe = persistSession(next);
    setUser(safe);
    if (next.role === 'admin' || next.role === 'client') {
      const stored = loadAuthUsers();
      const emailKey = next.email.toLowerCase();
      const idx = stored.findIndex(
        (u) => u.id === next.id || (u.role === next.role && u.email.toLowerCase() === emailKey),
      );
      const directoryUser: User = {
        ...stored[idx],
        ...next,
        planType: next.planType ?? stored[idx]?.planType ?? 'free',
        appStatus: next.appStatus ?? stored[idx]?.appStatus ?? 'running',
        status: next.status ?? stored[idx]?.status ?? 'active',
      };
      if (idx >= 0) stored[idx] = directoryUser;
      else stored.push(directoryUser);
      saveAuthUsers(stored);
      authApi.syncCloudUser(directoryUser);
    }
    bumpAuthUsers();
    // Keep machine employees + attendance available after re-login
    hydratePersistedStores();
    // Reconnect the saved attendance machine automatically if it is on the same network
    deviceApi.reconnect().then((result) => {
      if (result.connected) {
        console.info('[Auth] Attendance machine reconnected automatically');
      }
    });
    return { success: true };
  }, [bumpAuthUsers]);

  const loginOwner = useCallback(async () => {
    const users = loadAuthUsers();
    const owner = ensureOwnerUser(users).find((u) => OWNER_SIGNIN_EMAILS.includes(u.email.toLowerCase()) && u.role === 'owner');
    if (!owner) {
      return { success: false, error: 'Owner account not available.' };
    }

    const safe = persistSession({ ...owner, role: 'owner' as UserRole });
    // Keep registered client admins intact — owner sign-in must not rewrite
    // an admin row that happens to use an owner-notification email.
    saveAuthUsers(ensureOwnerUser(users));
    setUser(safe);
    bumpAuthUsers();
    hydratePersistedStores();
    deviceApi.reconnect().then((result) => {
      if (result.connected) {
        console.info('[Auth] Attendance machine reconnected automatically');
      }
    });
    return { success: true };
  }, [bumpAuthUsers]);

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
    const accessExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const created: User = {
      id: `u-admin-${Date.now()}`,
      name: input.name.trim() || 'Admin',
      email: ALLOWED_ADMIN_EMAIL,
      role: 'admin',
      password: input.password,
      phone: '',
      timezone: 'Asia/Kathmandu',
      avatar: ADMIN_BOY_AVATAR,
      companyName: input.name.trim() || 'Organization',
      planType: 'free',
      freeDays: 30,
      durationDays: 30,
      accessExpiresAt,
      appStatus: 'running',
      status: 'active',
    };

    // Recreate this admin email only — never wipe other client-admin accounts.
    const withoutSameAdmin = users.filter(
      (u) => !(u.role === 'admin' && u.email.toLowerCase() === email),
    );
    saveAuthUsers([...withoutSameAdmin, created]);
    bumpAuthUsers();
    authApi.syncCloudUser(created);
    return { success: true };
  }, [bumpAuthUsers]);

  const signupEmployee = useCallback(async (input: {
    name: string;
    email: string;
    password: string;
    employeeId: string;
    departmentId?: string;
  }) => {
    const employeeId = String(input.employeeId).trim() || `emp-${Date.now()}`;
    const email = input.email.trim().toLowerCase();
    const users = loadAuthUsers();

    const existingByEmail = users.find((u) => u.email.toLowerCase() === email);
    if (existingByEmail) {
      const updatedUser: User = {
        ...existingByEmail,
        name: input.name.trim() || existingByEmail.name,
        password: input.password,
        role: 'employee',
        employeeId: employeeId || existingByEmail.employeeId || `emp-${Date.now()}`,
      };
      const updatedList = users.map((u) => (u.id === existingByEmail.id ? updatedUser : u));
      saveAuthUsers(updatedList);
      authApi.syncCloudUser(updatedUser);
      const safe = persistSession(updatedUser);
      setUser(safe);
      return { success: true };
    }

    const created: User = {
      id: `u-emp-${employeeId}`,
      name: input.name.trim() || 'Employee',
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

    const existingByEmail = users.find((u) => u.email.toLowerCase() === email);
    if (existingByEmail) {
      const updatedUser: User = {
        ...existingByEmail,
        name: input.name.trim() || existingByEmail.name,
        password: input.password,
        role: 'account',
      };
      const updatedList = users.map((u) => (u.id === existingByEmail.id ? updatedUser : u));
      saveAuthUsers(updatedList);
      authApi.syncCloudUser(updatedUser);
      const safe = persistSession(updatedUser);
      setUser(safe);
      return { success: true };
    }

    const created: User = {
      id: `u-acct-${Date.now()}`,
      name: input.name.trim() || 'Accountant',
      email,
      role: 'account',
      password: input.password,
      phone: '',
      timezone: 'Asia/Kathmandu',
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(input.name.trim() || email)}`,
    };
    saveAuthUsers([...users, created]);
    authApi.syncCloudUser(created);
    const safe = persistSession(created);
    setUser(safe);
    return { success: true };
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
  }, []);

  const updateProfile = useCallback((patch: Partial<Pick<User, 'name' | 'email' | 'phone' | 'timezone' | 'avatar'>>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const effectiveName =
        patch.name !== undefined
          ? (patch.name.trim() || patch.email?.trim() || prev.email || '')
          : prev.name;
      const next = { ...prev, ...patch, name: effectiveName };
      const users = loadAuthUsers().map((u) => (u.id === prev.id ? { ...u, ...patch, name: effectiveName } : u));
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

  const [realOwnerUser, setRealOwnerUser] = useState<User | null>(() => {
    try {
      const raw = localStorage.getItem('ams_real_owner');
      return raw ? JSON.parse(raw) as User : null;
    } catch {
      return null;
    }
  });

  React.useEffect(() => {
    ensureSampleClientActivities();
  }, []);

  const updateClientAppStatus = useCallback((userIdOrEmail: string, appStatus: 'running' | 'paused') => {
    const key = userIdOrEmail.toLowerCase();
    const users = loadAuthUsers().map((u) => {
      if (u.id === userIdOrEmail || u.email.toLowerCase() === key) {
        return { ...u, appStatus };
      }
      return u;
    });
    saveAuthUsers(users);
    setUser((prev) => {
      if (prev && (prev.id === userIdOrEmail || prev.email.toLowerCase() === key)) {
        const next = { ...prev, appStatus };
        persistSession(next);
        return next;
      }
      return prev;
    });

    logClientActivity({
      clientId: userIdOrEmail,
      clientName: userIdOrEmail,
      action: 'STATUS_CHANGE',
      title: `App Access ${appStatus === 'paused' ? 'Paused' : 'Set to Running'}`,
      description: `Client app execution state updated to ${appStatus.toUpperCase()}. All data is preserved.`,
      actor: 'Owner Admin',
      type: appStatus === 'paused' ? 'warning' : 'success',
    });
  }, []);

  const softDeleteClient = useCallback(
    async (clientIdOrEmail: string) => {
      const key = clientIdOrEmail.toLowerCase();
      const now = new Date().toISOString();
      const currentOwnerId = user?.id || 'owner';
      const users = loadAuthUsers();
      const targetClient = users.find(
        (u) => u.id === clientIdOrEmail || u.email.toLowerCase() === key,
      );

      const related = targetClient
        ? users.filter(
            (u) =>
              u.id !== targetClient.id &&
              (u.clientId === targetClient.id ||
                (u.companyName &&
                  targetClient.companyName &&
                  u.companyName === targetClient.companyName)),
          )
        : [];

      const archivedIds = new Set([
        ...(targetClient ? [targetClient.id] : []),
        ...related.map((u) => u.id),
      ]);
      const archivedEmails = new Set(
        [targetClient, ...related]
          .filter(Boolean)
          .map((u) => u!.email.toLowerCase()),
      );
      if (key.includes('@')) archivedEmails.add(key);

      const snapshot: User[] = [targetClient, ...related]
        .filter((u): u is User => Boolean(u))
        .map((u) => ({
          ...u,
          status: 'deleted' as const,
          deletedAt: now,
          deletedBy: currentOwnerId,
        }));

      // If the directory row is only an invitation (no registered user yet),
      // still record the email so All Clients cannot revive it.
      if (snapshot.length === 0 && key.includes('@')) {
        snapshot.push({
          id: `deleted-${key}`,
          name: clientIdOrEmail,
          email: clientIdOrEmail,
          role: 'client',
          status: 'deleted',
          deletedAt: now,
          deletedBy: currentOwnerId,
        } as User);
      }

      if (snapshot.length > 0) {
        const previous = loadDeletedClients().filter(
          (u) => !archivedEmails.has(u.email.toLowerCase()) && !archivedIds.has(u.id),
        );
        saveDeletedClients([...previous, ...snapshot]);
      }

      const remaining = users.map((u) =>
        archivedIds.has(u.id) || archivedEmails.has(u.email.toLowerCase())
          ? { ...u, status: 'deleted' as const, deletedAt: now, deletedBy: currentOwnerId }
          : u,
      );
      saveAuthUsers(remaining.filter((u) => u.status !== 'deleted'));
      bumpAuthUsers();

      const purgeEmail = targetClient?.email || (key.includes('@') ? clientIdOrEmail : '');
      if (purgeEmail) {
        try {
          await authApi.purgeAdminAccount(purgeEmail);
        } catch {
          /* Keep the local Deleted-tab archive even if the server is unreachable. */
        }
      }

      logClientActivity({
        clientId: targetClient?.id || clientIdOrEmail,
        clientName: targetClient?.companyName || targetClient?.name || clientIdOrEmail,
        action: 'DELETE_CLIENT',
        title: 'Client Account Deleted',
        description: `Client account deleted by Owner (ID: ${currentOwnerId}). The account was removed from the active directory and is listed only under Deleted.`,
        actor: 'Owner Admin',
        type: 'danger',
      });
    },
    [user, bumpAuthUsers]
  );

  const impersonateClient = useCallback(
    (client: { email: string; name: string; id?: string; companyName?: string; status?: string }) => {
      const currentUser = user;
      if (!currentUser) return;

      if (currentUser.role === 'owner') {
        localStorage.setItem('ams_real_owner', JSON.stringify(currentUser));
        setRealOwnerUser(currentUser);
      }

      const existing = loadAuthUsers().find(
        (u) => u.email.toLowerCase() === client.email.toLowerCase() || (client.id && u.id === client.id)
      );

      const durationDays = existing?.durationDays ?? 30;
      const accessExpiresAt =
        existing?.accessExpiresAt ||
        (durationDays > 0
          ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString()
          : undefined);

      const clientAdminUser: User = {
        id: existing?.id || client.id || `u-client-${Date.now()}`,
        name: client.companyName || client.name || existing?.name || 'Client Admin',
        companyName: client.companyName || existing?.companyName || client.name,
        email: client.email,
        role: 'admin' as UserRole, // View & manage app with Client Admin capabilities
        password: existing?.password || 'client-pass',
        avatar: existing?.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(client.email)}`,
        planType: existing?.planType ?? 'free',
        freeDays: existing?.freeDays ?? 30,
        paidDays: existing?.paidDays ?? 365,
        durationDays,
        accessExpiresAt,
        appStatus: existing?.appStatus ?? 'running',
        status: (client.status || existing?.status || 'active') as User['status'],
        deletedAt: existing?.deletedAt,
        deletedBy: existing?.deletedBy,
      };

      setUser(clientAdminUser);
      persistSession(clientAdminUser);

      logClientActivity({
        clientId: client.id || client.email,
        clientName: client.companyName || client.name,
        action: 'OWNER_VIEW_CLIENT',
        title: 'Owner Admin Opened Client App',
        description: `Owner (ID: ${currentUser.id}) opened client dashboard for viewing. Context switched to ${client.companyName || client.name}.`,
        actor: 'Owner Admin',
        type: 'info',
      });
    },
    [user]
  );

  const exitImpersonation = useCallback(() => {
    const rawOwner = localStorage.getItem('ams_real_owner');
    if (rawOwner) {
      try {
        const owner = JSON.parse(rawOwner) as User;
        setUser(owner);
        persistSession(owner);
        localStorage.removeItem('ams_real_owner');
        setRealOwnerUser(null);
      } catch {
        localStorage.removeItem('ams_real_owner');
        setRealOwnerUser(null);
      }
    } else {
      loginOwner();
    }
  }, [loginOwner]);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      login,
      loginOwner,
      signupAdmin,
      signupEmployee,
      signupAccountant,
      logout,
      updateProfile,
      changePassword,
      hasRole,
      can,
      getAuthUsers,
      getDeletedClients,
      hasAdminAccount,
      isEmployeeRegistered,
      updateClientAppStatus,
      softDeleteClient,
      realOwnerUser,
      isImpersonating: !!realOwnerUser,
      impersonateClient,
      exitImpersonation,
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
