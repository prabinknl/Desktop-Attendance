import { query } from '../db/pool.js';
import { isMemoryMode, memoryStore, type MemoryUserRecord } from '../db/memoryStore.js';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  password: string;
  avatar: string | null;
  phone: string | null;
  timezone: string | null;
  employee_id: string | null;
  department_id: string | null;
  client_id?: string | null;
  plan_type?: string | null;
  access_expires_at?: string | null;
  status?: string | null;
  email_verified?: boolean | null;
  created_at: string;
  updated_at: string;
}

function toIso(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  } catch {
    return undefined;
  }
}

function rowToAppUser(row: UserRow) {
  const planRaw = (row.plan_type ?? '').toLowerCase();
  const planType = planRaw === 'paid' ? 'paid' : planRaw === 'free' ? 'free' : undefined;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as any,
    password: row.password,
    avatar: row.avatar ?? undefined,
    phone: row.phone ?? undefined,
    timezone: row.timezone ?? undefined,
    employeeId: row.employee_id ?? undefined,
    departmentId: row.department_id ?? undefined,
    clientId: row.client_id ?? undefined,
    planType,
    accessExpiresAt: toIso(row.access_expires_at),
    status: row.status ?? 'active',
    emailVerified: row.email_verified ?? true,
    createdAt: toIso(row.created_at),
  };
}

function memoryToAppUser(user: MemoryUserRecord) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as any,
    password: user.password,
    avatar: user.avatar,
    phone: user.phone,
    timezone: user.timezone,
    employeeId: user.employeeId,
    departmentId: user.departmentId,
    clientId: user.clientId,
    companyName: user.companyName,
    planType: user.planType,
    accessExpiresAt: user.accessExpiresAt,
    status: user.status ?? 'active',
    emailVerified: user.emailVerified ?? true,
    createdAt: user.createdAt,
  };
}

/** Same shape as rowToAppUser but without the credential. */
function toSafeUser(user: ReturnType<typeof rowToAppUser> | ReturnType<typeof memoryToAppUser>) {
  const { password: _password, ...safe } = user;
  return safe;
}

export const UserModel = {
  /** Fetch all registered user accounts from cloud DB */
  async getAll() {
    if (!isMemoryMode()) {
      try {
        const res = await query<UserRow>('SELECT * FROM app_users ORDER BY created_at ASC');
        return res.rows.map(rowToAppUser);
      } catch (err) {
        console.warn('[UserModel] getAll error, falling back to memory store:', err instanceof Error ? err.message : err);
      }
    }
    return memoryStore.getUsers().map(memoryToAppUser);
  },

  /** Account list for the client. The API is reachable from the public
   *  internet, so passwords must never be part of a read response. */
  async getAllSafe() {
    if (!isMemoryMode()) {
      try {
        const res = await query<UserRow>('SELECT * FROM app_users ORDER BY created_at ASC');
        return res.rows.map((row: UserRow) => toSafeUser(rowToAppUser(row)));
      } catch (err) {
        console.warn('[UserModel] getAllSafe error, falling back to memory store:', err instanceof Error ? err.message : err);
      }
    }
    return memoryStore.getUsers().map((u) => toSafeUser(memoryToAppUser(u)));
  },

  /** Check a login by email or display name. Returns the account without its
   *  password, or null when the credentials do not match. Returns raw row if needed for status checks. */
  async verifyCredentials(identifier: string, password: string) {
    const key = identifier.trim().toLowerCase();
    if (!key) return null;

    if (!isMemoryMode()) {
      try {
        const res = await query<UserRow>(
          `SELECT * FROM app_users
           WHERE (LOWER(email) = $1 OR LOWER(TRIM(name)) = $1) AND password = $2
           LIMIT 1`,
          [key, password],
        );
        return res.rows[0] ? toSafeUser(rowToAppUser(res.rows[0])) : null;
      } catch (err) {
        console.warn('[UserModel] verifyCredentials error, falling back to memory store:', err instanceof Error ? err.message : err);
      }
    }

    const found = memoryStore.getUsers().find((u) => {
      const emailMatch = u.email.trim().toLowerCase() === key;
      const nameMatch = u.name.trim().toLowerCase() === key;
      return (emailMatch || nameMatch) && u.password === password;
    });
    return found ? toSafeUser(memoryToAppUser(found)) : null;
  },

  async getByEmail(email: string) {
    const key = email.trim().toLowerCase();
    if (!key) return null;

    if (!isMemoryMode()) {
      try {
        const res = await query<UserRow>(
          'SELECT * FROM app_users WHERE LOWER(email) = $1 LIMIT 1',
          [key],
        );
        return res.rows[0] ? rowToAppUser(res.rows[0]) : null;
      } catch (err) {
        console.warn('[UserModel] getByEmail error, falling back to memory store:', err instanceof Error ? err.message : err);
      }
    }

    const cached = memoryStore.getUserByEmail(key);
    return cached ? memoryToAppUser(cached) : null;
  },

  /** Upsert user account (insert or update on email conflict) */
  async upsert(user: {
    id: string;
    name: string;
    email: string;
    role: string;
    password: string;
    avatar?: string;
    phone?: string;
    timezone?: string;
    employeeId?: string;
    departmentId?: string;
    clientId?: string;
    client_id?: string;
    companyName?: string;
    planType?: 'free' | 'paid';
    plan_type?: 'free' | 'paid' | string;
    accessExpiresAt?: string;
    access_expires_at?: string;
    status?: string;
    emailVerified?: boolean;
    email_verified?: boolean;
  }) {
    const now = new Date().toISOString();
    const emailLower = user.email.trim().toLowerCase();
    const clientId = user.clientId ?? user.client_id ?? undefined;
    const planRaw = String(user.planType ?? user.plan_type ?? '').toLowerCase();
    const planType = planRaw === 'paid' ? 'paid' : planRaw === 'free' ? 'free' : undefined;
    const accessExpiresAt = user.accessExpiresAt ?? user.access_expires_at ?? undefined;
    const status = user.status ?? 'active';
    const emailVerified = user.emailVerified ?? user.email_verified ?? true;

    const memoryPayload: MemoryUserRecord = {
      id: user.id,
      name: user.name,
      email: emailLower,
      role: user.role,
      password: user.password,
      avatar: user.avatar,
      phone: user.phone,
      timezone: user.timezone,
      employeeId: user.employeeId,
      departmentId: user.departmentId,
      clientId,
      companyName: user.companyName,
      planType,
      accessExpiresAt,
      status,
      emailVerified,
      createdAt: now,
      updatedAt: now,
    };

    if (!isMemoryMode()) {
      try {
        const res = await query<UserRow>(
          `INSERT INTO app_users (
            id, name, email, role, password, avatar, phone, timezone, employee_id, department_id,
            client_id, plan_type, access_expires_at, status, email_verified, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $16
          )
          ON CONFLICT (email)
          DO UPDATE SET
            name = EXCLUDED.name,
            role = EXCLUDED.role,
            password = EXCLUDED.password,
            avatar = COALESCE(EXCLUDED.avatar, app_users.avatar),
            phone = COALESCE(EXCLUDED.phone, app_users.phone),
            timezone = COALESCE(EXCLUDED.timezone, app_users.timezone),
            employee_id = COALESCE(EXCLUDED.employee_id, app_users.employee_id),
            department_id = COALESCE(EXCLUDED.department_id, app_users.department_id),
            client_id = COALESCE(EXCLUDED.client_id, app_users.client_id),
            plan_type = COALESCE(EXCLUDED.plan_type, app_users.plan_type),
            access_expires_at = COALESCE(EXCLUDED.access_expires_at, app_users.access_expires_at),
            status = EXCLUDED.status,
            email_verified = EXCLUDED.email_verified,
            updated_at = EXCLUDED.updated_at
          RETURNING *`,
          [
            user.id,
            user.name,
            emailLower,
            user.role,
            user.password,
            user.avatar ?? null,
            user.phone ?? null,
            user.timezone ?? null,
            user.employeeId ?? null,
            user.departmentId ?? null,
            clientId ?? null,
            planType ?? null,
            accessExpiresAt ?? null,
            status,
            emailVerified,
            now,
          ],
        );

        // Keep memory mirror in sync for resilience if DB later drops.
        memoryStore.upsertUser(memoryPayload);
        return res.rows[0] ? rowToAppUser(res.rows[0]) : null;
      } catch (err) {
        console.warn('[UserModel] upsert error, falling back to memory store:', err instanceof Error ? err.message : err);
      }
    }

    return memoryToAppUser(memoryStore.upsertUser(memoryPayload));
  },

  /** Update status and email_verified for a user */
  async updateStatus(email: string, status: string, emailVerified: boolean) {
    const emailLower = email.trim().toLowerCase();
    if (!isMemoryMode()) {
      try {
        await query(
          `UPDATE app_users SET status = $1, email_verified = $2, updated_at = NOW() WHERE LOWER(email) = $3`,
          [status, emailVerified, emailLower],
        );
      } catch (err) {
        console.warn('[UserModel] updateStatus error, falling back to memory store:', err instanceof Error ? err.message : err);
      }
    }
    memoryStore.updateUserStatus(emailLower, status, emailVerified);
  },

  /** Delete user account by id */
  async deleteById(id: string) {
    if (!isMemoryMode()) {
      try {
        await query('DELETE FROM app_users WHERE id = $1', [id]);
      } catch {
        /* ignore */
      }
    }
    memoryStore.deleteUserById(id);
  },

  async deleteByEmail(email: string) {
    const key = email.trim().toLowerCase();
    if (!key) return;
    if (!isMemoryMode()) {
      try {
        await query('DELETE FROM app_users WHERE LOWER(email) = $1', [key]);
      } catch {
        /* ignore */
      }
    }
    memoryStore.deleteUserByEmail(key);
  },

  /**
   * Remove the account for this email plus any users in the same organization
   * so the email can be used for a brand-new signup.
   */
  async purgeOrganizationByEmail(email: string) {
    const key = email.trim().toLowerCase();
    if (!key) return;
    const existing = await this.getByEmail(key);
    const clientId = existing?.clientId?.trim();
    const userId = existing?.id?.trim();

    try {
      await query(
        `DELETE FROM app_users
         WHERE LOWER(email) = $1
            OR ($2 <> '' AND (client_id = $2 OR id = $2))
            OR ($3 <> '' AND (client_id = $3 OR id = $3))`,
        [key, userId ?? '', clientId ?? ''],
      );
    } catch (err) {
      console.warn('[UserModel] purgeOrganizationByEmail error:', err instanceof Error ? err.message : err);
    }

    memoryStore.deleteUserByEmail(key);
    if (userId) {
      memoryStore.deleteUsersByClientId(userId);
    }
    if (clientId) {
      memoryStore.deleteUsersByClientId(clientId);
    }
  },
};
